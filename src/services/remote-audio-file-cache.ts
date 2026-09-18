import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import { Platform } from 'react-native'

import type { RemoteAudio, RemoteAudioStreamSource } from '@/services/api'
import { isRemoteAudioCacheFresh } from '@/services/remote-audio-file-cache-policy'

const CACHE_INDEX_PREFIX = 'podcast-me.remote-audio-file-cache.v1.'
const CACHE_DIRECTORY = 'remote-audio-cache-v1'
const AUDIO_EXTENSIONS = new Set([
  'aac',
  'flac',
  'm4a',
  'mp3',
  'mp4',
  'ogg',
  'opus',
  'wav',
  'webm',
])

type CacheEntry = {
  audio: RemoteAudio
  fileName: string
  lastPlayedAt: number
}

type PendingDownload = {
  abortController: AbortController
  lastPlayedAt: number
  promise: Promise<void>
}

type CacheListener = (userId: string) => void

const listeners = new Set<CacheListener>()
const pendingDownloads = new Map<string, PendingDownload>()
let cacheOperationTail: Promise<void> = Promise.resolve()

export async function loadCachedRemoteAudios(
  userId: string,
): Promise<RemoteAudio[]> {
  if (Platform.OS === 'web') {
    return []
  }

  return withCacheIndex(userId, (entries) => ({
    entries,
    result: entries.map((entry) => entry.audio),
  })).catch(() => [])
}

export async function getCachedRemoteAudioSource(
  userId: string,
  audioId: string,
): Promise<RemoteAudioStreamSource | null> {
  if (Platform.OS === 'web') {
    return null
  }

  return withCacheIndex(userId, (entries) => {
    const entry = entries.find((candidate) => candidate.audio.id === audioId)

    return {
      entries,
      result: entry
        ? { uri: getCacheFile(userId, entry.fileName).uri, headers: {} }
        : null,
    }
  }).catch(() => null)
}

export function recordRemoteAudioPlayback(
  userId: string,
  audio: RemoteAudio,
  source?: RemoteAudioStreamSource,
): void {
  if (Platform.OS === 'web') {
    return
  }

  const playedAt = Date.now()
  const pendingKey = getPendingKey(userId, audio.id)
  const pending = pendingDownloads.get(pendingKey)

  if (pending) {
    pending.lastPlayedAt = playedAt
    return
  }

  if (source && !isLocalSource(source.uri)) {
    startDownload(userId, audio, source, playedAt)
    return
  }

  void withCacheIndex(userId, (entries) => ({
    entries: entries.map((entry) =>
      entry.audio.id === audio.id
        ? { ...entry, audio, lastPlayedAt: playedAt }
        : entry,
    ),
    result: undefined,
  })).catch(() => undefined)
}

export function subscribeToRemoteAudioFileCache(
  listener: CacheListener,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export type RemoteAudioDownloadState =
  | 'downloaded'
  | 'downloading'
  | 'available'

export function isRemoteAudioFileDownloadPending(
  userId: string,
  audioId: string,
): boolean {
  if (Platform.OS === 'web') {
    return false
  }

  return pendingDownloads.has(getPendingKey(userId, audioId))
}

export function getRemoteAudioDownloadState(
  isCached: boolean,
  isDownloading: boolean,
): RemoteAudioDownloadState {
  if (isCached) {
    return 'downloaded'
  }

  return isDownloading ? 'downloading' : 'available'
}

export async function downloadRemoteAudioFile(
  userId: string,
  audio: RemoteAudio,
  source: RemoteAudioStreamSource,
): Promise<'downloaded' | 'already-cached' | 'already-downloading'> {
  if (Platform.OS === 'web') {
    throw new Error('Downloads are not supported on web.')
  }

  const pendingKey = getPendingKey(userId, audio.id)

  if (pendingDownloads.has(pendingKey)) {
    return 'already-downloading'
  }

  const cachedSource = await getCachedRemoteAudioSource(userId, audio.id).catch(
    () => null,
  )

  if (cachedSource) {
    await withCacheIndex(userId, (entries) => ({
      entries: entries.map((entry) =>
        entry.audio.id === audio.id ? { ...entry, audio } : entry,
      ),
      result: undefined,
    })).catch(() => undefined)
    return 'already-cached'
  }

  if (!source.uri) {
    throw new Error('This remote audio has no downloadable address.')
  }

  if (isLocalSource(source.uri)) {
    return 'already-cached'
  }

  startDownload(userId, audio, source, Date.now())
  const pending = pendingDownloads.get(pendingKey)

  if (!pending) {
    throw new Error('The audio download could not be started.')
  }

  await pending.promise
  const stored = await getCachedRemoteAudioSource(userId, audio.id).catch(
    () => null,
  )

  if (!stored) {
    throw new Error(
      'The audio download failed. Check your connection and try again.',
    )
  }

  return 'downloaded'
}

export async function removeRemoteAudioDownload(
  userId: string,
  audioId: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    return
  }

  const pending = pendingDownloads.get(getPendingKey(userId, audioId))

  if (pending) {
    pending.abortController.abort()
    await pending.promise.catch(() => undefined)
  }

  await withCacheIndex(userId, (entries) => {
    const entry = entries.find((candidate) => candidate.audio.id === audioId)

    if (entry) {
      deleteFileIfPresent(getCacheFile(userId, entry.fileName))
    }

    return {
      entries: entries.filter((candidate) => candidate.audio.id !== audioId),
      result: undefined,
    }
  }).catch(() => undefined)

  notifyListeners(userId)
}

export async function clearRemoteAudioFileCache(userId: string): Promise<void> {
  if (Platform.OS === 'web') {
    return
  }

  const pendingForUser = [...pendingDownloads.entries()]
    .filter(([key]) => key.startsWith(`${userId}\u0000`))
    .map(([, pending]) => pending)

  pendingForUser.forEach((pending) => pending.abortController.abort())
  await Promise.allSettled(pendingForUser.map((pending) => pending.promise))

  await enqueueCacheOperation(async () => {
    await AsyncStorage.removeItem(getCacheIndexKey(userId))
    const directory = getUserCacheDirectory(userId)

    if (directory.exists) {
      directory.delete()
    }
  }).catch(() => undefined)

  notifyListeners(userId)
}

function startDownload(
  userId: string,
  audio: RemoteAudio,
  source: RemoteAudioStreamSource,
  playedAt: number,
): void {
  const pendingKey = getPendingKey(userId, audio.id)
  const abortController = new AbortController()
  const pending: PendingDownload = {
    abortController,
    lastPlayedAt: playedAt,
    promise: Promise.resolve(),
  }

  pending.promise = downloadAndStore(
    userId,
    audio,
    source,
    pending,
  ).finally(() => {
    if (pendingDownloads.get(pendingKey) === pending) {
      pendingDownloads.delete(pendingKey)
    }
  })
  pendingDownloads.set(pendingKey, pending)
  notifyListeners(userId)
}

async function downloadAndStore(
  userId: string,
  audio: RemoteAudio,
  source: RemoteAudioStreamSource,
  pending: PendingDownload,
): Promise<void> {
  let temporary: File | null = null

  try {
    const directory = getUserCacheDirectory(userId)
    directory.create({ idempotent: true, intermediates: true })
    const fileName = getCacheFileName(audio)
    const destination = new File(directory, fileName)
    temporary = new File(directory, `${fileName}.download`)

    if (temporary.exists) {
      temporary.delete()
    }

    const downloaded = await File.downloadFileAsync(source.uri, temporary, {
      headers: source.headers,
      idempotent: true,
      signal: pending.abortController.signal,
    })

    if (!downloaded.exists || downloaded.size <= 0) {
      throw new Error('The cached audio download was empty.')
    }

    await downloaded.move(destination, { overwrite: true })

    await withCacheIndex(userId, (entries) => {
      const previous = entries.find((entry) => entry.audio.id === audio.id)

      if (previous && previous.fileName !== fileName) {
        deleteFileIfPresent(getCacheFile(userId, previous.fileName))
      }

      return {
        entries: [
          ...entries.filter((entry) => entry.audio.id !== audio.id),
          { audio, fileName, lastPlayedAt: pending.lastPlayedAt },
        ],
        result: undefined,
      }
    })

    notifyListeners(userId)
  } catch {
    if (temporary) {
      deleteFileIfPresent(temporary)
    }
  }
}

async function withCacheIndex<T>(
  userId: string,
  operation: (
    entries: CacheEntry[],
  ) => { entries: CacheEntry[]; result: T },
): Promise<T> {
  let result: T

  await enqueueCacheOperation(async () => {
    const current = await readValidCacheEntries(userId)
    const outcome = operation(current.entries)
    result = outcome.result

    if (current.changed || outcome.entries !== current.entries) {
      await writeCacheEntries(userId, outcome.entries)
    }
  })

  return result!
}

function enqueueCacheOperation(operation: () => Promise<void>): Promise<void> {
  const queued = cacheOperationTail.then(operation)
  cacheOperationTail = queued.catch(() => undefined)
  return queued
}

async function readValidCacheEntries(
  userId: string,
): Promise<{ entries: CacheEntry[]; changed: boolean }> {
  const serialized = await AsyncStorage.getItem(getCacheIndexKey(userId))

  if (!serialized) {
    return { entries: [], changed: false }
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(serialized)
  } catch {
    return { entries: [], changed: true }
  }

  if (!Array.isArray(parsed)) {
    return { entries: [], changed: true }
  }

  const now = Date.now()
  const entries: CacheEntry[] = []
  let changed = false

  for (const value of parsed) {
    if (!isCacheEntry(value)) {
      changed = true
      continue
    }

    const file = getCacheFile(userId, value.fileName)
    const isFresh = isRemoteAudioCacheFresh(value.lastPlayedAt, now)

    if (!isFresh || !file.exists || file.size <= 0) {
      deleteFileIfPresent(file)
      changed = true
      continue
    }

    entries.push(value)
  }

  return { entries, changed }
}

async function writeCacheEntries(
  userId: string,
  entries: CacheEntry[],
): Promise<void> {
  if (entries.length === 0) {
    await AsyncStorage.removeItem(getCacheIndexKey(userId))
    return
  }

  await AsyncStorage.setItem(getCacheIndexKey(userId), JSON.stringify(entries))
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const entry = value as Partial<CacheEntry>

  return (
    isRemoteAudio(entry.audio) &&
    typeof entry.fileName === 'string' &&
    entry.fileName.length > 0 &&
    !/[\\/]/.test(entry.fileName) &&
    typeof entry.lastPlayedAt === 'number' &&
    Number.isFinite(entry.lastPlayedAt) &&
    entry.lastPlayedAt >= 0
  )
}

function isRemoteAudio(value: unknown): value is RemoteAudio {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const audio = value as Partial<RemoteAudio>

  return (
    typeof audio.id === 'string' &&
    typeof audio.title === 'string' &&
    typeof audio.source === 'string' &&
    (audio.spotifyId === null || typeof audio.spotifyId === 'string') &&
    typeof audio.createdAt === 'string' &&
    typeof audio.streamUrl === 'string'
  )
}

function getUserCacheDirectory(userId: string): Directory {
  return new Directory(Paths.document, CACHE_DIRECTORY, encodeURIComponent(userId))
}

function getCacheFile(userId: string, fileName: string): File {
  return new File(getUserCacheDirectory(userId), fileName)
}

function getCacheFileName(audio: RemoteAudio): string {
  return `${encodeURIComponent(audio.id)}${getAudioExtension(audio.source)}`
}

function getAudioExtension(source: string): string {
  const path = source.split(/[?#]/, 1)[0]
  const extension = /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase()

  return extension && AUDIO_EXTENSIONS.has(extension)
    ? `.${extension}`
    : '.mp3'
}

function getCacheIndexKey(userId: string): string {
  return `${CACHE_INDEX_PREFIX}${userId}`
}

function getPendingKey(userId: string, audioId: string): string {
  return `${userId}\u0000${audioId}`
}

function isLocalSource(uri: string): boolean {
  return uri.startsWith('file:')
}

function deleteFileIfPresent(file: File): void {
  try {
    if (file.exists) {
      file.delete()
    }
  } catch {
    // A missing or OS-removed cache file is equivalent to a cache miss.
  }
}

function notifyListeners(userId: string): void {
  listeners.forEach((listener) => listener(userId))
}
