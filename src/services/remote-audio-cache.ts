import type { RemoteAudio } from '@/services/api'

const CACHE_TTL_MS = 60_000

type CacheEntry = {
  audios: RemoteAudio[]
  expiresAt: number
  pending: Promise<RemoteAudio[]> | null
}

const entries = new Map<string, CacheEntry>()

export function getCachedRemoteAudios(
  userId: string,
  load: () => Promise<RemoteAudio[]>,
  forceRefresh = false,
): Promise<RemoteAudio[]> {
  const existing = entries.get(userId)

  if (!forceRefresh && existing && existing.expiresAt > Date.now()) {
    return Promise.resolve(existing.audios)
  }

  if (existing?.pending) {
    return existing.pending
  }

  const pending = load()
    .then((audios) => {
      entries.set(userId, {
        audios,
        expiresAt: Date.now() + CACHE_TTL_MS,
        pending: null,
      })
      return audios
    })
    .catch((error: unknown) => {
      if (entries.get(userId)?.pending === pending) {
        entries.delete(userId)
      }
      throw error
    })

  entries.set(userId, {
    audios: existing?.audios ?? [],
    expiresAt: 0,
    pending,
  })

  return pending
}

export function clearRemoteAudioCache(userId: string): void {
  entries.delete(userId)
}
