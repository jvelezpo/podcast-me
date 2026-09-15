export const REMOTE_AUDIO_CACHE_TTL_MS = 10 * 24 * 60 * 60 * 1_000

export function isRemoteAudioCacheFresh(
  lastPlayedAt: number,
  now: number,
): boolean {
  return lastPlayedAt + REMOTE_AUDIO_CACHE_TTL_MS > now
}
