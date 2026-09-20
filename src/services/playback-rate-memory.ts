import AsyncStorage from '@react-native-async-storage/async-storage'

import { DEFAULT_PLAYBACK_RATE, clampPlaybackRate } from '@/utils/playback-rate'

const KEY_PREFIX = 'podcast-me.playback-rate.v1.'

/**
 * Per-show playback-rate memory (AsyncStorage). Both the local and remote
 * players read the remembered rate when a show starts and persist every
 * change, so a show keeps its speed across restarts.
 */
export async function loadRememberedPlaybackRate(
  showKey: string | null,
): Promise<number> {
  if (showKey === null) {
    return DEFAULT_PLAYBACK_RATE
  }

  try {
    const stored = await AsyncStorage.getItem(storageKey(showKey))
    const rate = stored === null ? NaN : Number(stored)
    return Number.isFinite(rate) ? clampPlaybackRate(rate) : DEFAULT_PLAYBACK_RATE
  } catch {
    return DEFAULT_PLAYBACK_RATE
  }
}

export function saveRememberedPlaybackRate(
  showKey: string | null,
  rate: number,
): Promise<void> {
  if (showKey === null || !Number.isFinite(rate)) {
    return Promise.resolve()
  }

  return AsyncStorage.setItem(storageKey(showKey), String(rate)).catch(
    () => undefined,
  ) as Promise<void>
}

function storageKey(showKey: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(showKey)}`
}
