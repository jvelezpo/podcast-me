/**
 * Playback-speed model shared by the speed sheet, the rate memory service,
 * and both playback hooks. Pure logic only (no storage) so it stays unit
 * testable under plain `node --test`.
 */

export const PLAYBACK_RATE_OPTIONS = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const

export type PlaybackRateOption = (typeof PLAYBACK_RATE_OPTIONS)[number]

export const DEFAULT_PLAYBACK_RATE = 1
export const MIN_PLAYBACK_RATE = 0.5
export const MAX_PLAYBACK_RATE = 3

export function clampPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return DEFAULT_PLAYBACK_RATE
  }

  return Math.min(Math.max(rate, MIN_PLAYBACK_RATE), MAX_PLAYBACK_RATE)
}

export function formatPlaybackRate(rate: number): string {
  return `${rate}×`
}

/**
 * Storage key identifying a "show" for per-show rate memory, or null when
 * the audio carries no show information (rate still applies live, it just
 * is not remembered). Accepts `unknown` metadata because remote audios are
 * untyped; local items and remote audios share the shape so one memory
 * covers both players.
 */
export function getShowKey(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }

  const record = metadata as { artist?: unknown; album?: unknown }
  const artist = normalizeShowPart(record.artist)
  const album = normalizeShowPart(record.album)

  if (artist === null && album === null) {
    return null
  }

  return `show:${artist ?? ''}\n${album ?? ''}`
}

function normalizeShowPart(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()

  return normalized === '' ? null : normalized
}
