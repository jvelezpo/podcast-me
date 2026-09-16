import type {
  PlaybackDevice,
  PlaybackEvent,
  PlaybackEventType,
} from '@/services/api'

export type PlaybackEventSession = {
  audioId: string
  id: string
  isListening: boolean
  lastEventAt: number
}

type CreatePlaybackEventInput = {
  eventType: PlaybackEventType
  positionSeconds: number
  durationSeconds: number | null
  playbackRate: number
  device?: PlaybackDevice
  now?: number
}

export function createPlaybackEventSession(
  audioId: string,
  now = Date.now(),
): PlaybackEventSession {
  return {
    audioId,
    id: createPlaybackUuid(),
    isListening: false,
    lastEventAt: now,
  }
}

export function createPlaybackEvent(
  session: PlaybackEventSession,
  input: CreatePlaybackEventInput,
): PlaybackEvent {
  const now = input.now ?? Date.now()
  const listenedMs = session.isListening
    ? Math.min(Math.max(Math.round(now - session.lastEventAt), 0), 86_400_000)
    : 0
  const durationMs = toPositiveMilliseconds(input.durationSeconds)
  const rawPositionMs = toNonNegativeMilliseconds(input.positionSeconds)
  const positionMs =
    durationMs === undefined ? rawPositionMs : Math.min(rawPositionMs, durationMs)

  session.lastEventAt = now

  if (input.eventType === 'started') {
    session.isListening = true
  } else if (
    input.eventType === 'paused' ||
    input.eventType === 'completed'
  ) {
    session.isListening = false
  }

  return {
    eventId: createPlaybackUuid(),
    playbackSessionId: session.id,
    eventType: input.eventType,
    positionMs,
    ...(durationMs === undefined ? {} : { durationMs }),
    listenedMs,
    occurredAt: new Date(now).toISOString(),
    playbackRate: Number.isFinite(input.playbackRate)
      ? Math.min(Math.max(input.playbackRate, 0.25), 4)
      : 1,
    ...(input.device ? { device: input.device } : {}),
  }
}

export function createPlaybackUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
    .slice(6, 8)
    .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

function toNonNegativeMilliseconds(seconds: number): number {
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.round(seconds * 1_000)
    : 0
}

function toPositiveMilliseconds(seconds: number | null): number | undefined {
  return seconds !== null && Number.isFinite(seconds) && seconds > 0
    ? Math.max(1, Math.round(seconds * 1_000))
    : undefined
}
