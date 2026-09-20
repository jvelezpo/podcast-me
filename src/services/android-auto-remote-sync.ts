import type { RemoteAudio, RemoteAudioStreamSource } from '@/services/api'

/**
 * Media-id prefix the Android Auto catalog uses for cloud audios. The phone
 * and the car share one ExoPlayer (`PodcastMediaLibraryService`), so this
 * prefix is also how JS tells car-driven remote playback apart from local
 * items: a service `mediaId` starting with `remote:` is owned by the remote
 * playback state, anything else by the local playback state.
 */
export const REMOTE_MEDIA_ID_PREFIX = 'remote:'

export function toRemoteMediaId(audioId: string): string {
  return `${REMOTE_MEDIA_ID_PREFIX}${audioId}`
}

/** `remote:<audioId>` → `<audioId>`; anything else → null. */
export function parseRemoteMediaId(mediaId: string | null): string | null {
  if (!mediaId || !mediaId.startsWith(REMOTE_MEDIA_ID_PREFIX)) {
    return null
  }

  const audioId = mediaId.slice(REMOTE_MEDIA_ID_PREFIX.length)
  return audioId.length > 0 ? audioId : null
}

/**
 * Registry of cloud audios the car knows about, keyed by audio id. The car
 * can start playback on its own (head-unit tap, voice, auto-resume), in
 * which case the phone only sees `remote:<id>` in the shared playback
 * state — this registry resolves it back to the full `RemoteAudio` so the
 * device UI can adopt what the car started and stay in sync.
 *
 * Filled from every car-catalog push (auth context) and every
 * device-initiated remote play; bounded FIFO so it cannot grow forever.
 */
const registeredRemoteAudios = new Map<string, RemoteAudio>()
const MAX_REGISTERED_REMOTE_AUDIOS = 1000

export function registerRemoteAudiosForCar(
  audios: readonly RemoteAudio[],
): void {
  for (const audio of audios) {
    if (registeredRemoteAudios.has(audio.id)) {
      registeredRemoteAudios.delete(audio.id)
    }

    registeredRemoteAudios.set(audio.id, audio)

    while (registeredRemoteAudios.size > MAX_REGISTERED_REMOTE_AUDIOS) {
      const oldest = registeredRemoteAudios.keys().next()

      if (oldest.done) {
        break
      }

      registeredRemoteAudios.delete(oldest.value)
    }
  }
}

export function getRegisteredRemoteAudio(
  audioId: string,
): RemoteAudio | null {
  return registeredRemoteAudios.get(audioId) ?? null
}

export function clearRegisteredRemoteAudios(): void {
  registeredRemoteAudios.clear()
}

export type AndroidAutoRemoteCatalogSource = {
  audio: RemoteAudio
  source: RemoteAudioStreamSource
}

export type AndroidAutoRemoteCatalogEntry = {
  id: string
  originalName: string
  localUri: string
  mimeType: null
  durationSeconds: number | null
  lastPositionSeconds: number
  isPlayed: boolean
  metadata: { coverArtUrl: string | null }
  updatedAt: string
  requestHeaders: Record<string, string>
}

/**
 * Maps resolved remote sources to the catalog rows stored for Android Auto.
 *
 * The car keeps a snapshot of these rows (including the auth headers and the
 * stream/file URI) and plays from it while the phone is locked, so callers
 * must rebuild and re-sync the snapshot whenever the credentials behind a
 * source can change: fresh access token, fresh presigned URL, or a newly
 * cached file. A stale snapshot makes the car request bytes with an expired
 * Bearer token or presigned URL, which the host surfaces as an
 * authentication error ("Unlock Phone to access Podcast Me") while the phone
 * UI keeps working because it resolves a fresh source on every play.
 */
export function buildAndroidAutoRemoteCatalogEntries(
  resolved: readonly AndroidAutoRemoteCatalogSource[],
): AndroidAutoRemoteCatalogEntry[] {
  return resolved.map(({ audio, source }) => ({
    id: toRemoteMediaId(audio.id),
    originalName: audio.title,
    localUri: source.uri,
    mimeType: null,
    durationSeconds: getRemoteDurationSeconds(audio.metadata),
    lastPositionSeconds: 0,
    isPlayed: false,
    metadata: { coverArtUrl: getRemoteCoverArtUrl(audio.metadata) },
    updatedAt: audio.createdAt,
    requestHeaders: { ...source.headers },
  }))
}

export function getRemoteCoverArtUrl(metadata: unknown): string | null {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null
  }

  const coverArtUrl = (metadata as Record<string, unknown>).coverArtUrl
  return typeof coverArtUrl === 'string' &&
    /^https?:\/\//i.test(coverArtUrl.trim())
    ? coverArtUrl.trim()
    : null
}

export function getRemoteDurationSeconds(metadata: unknown): number | null {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null
  }

  const durationMs = (metadata as Record<string, unknown>).durationMs
  return typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs > 0
    ? durationMs / 1_000
    : null
}
