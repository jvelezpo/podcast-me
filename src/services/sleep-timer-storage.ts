import AsyncStorage from '@react-native-async-storage/async-storage'

const SLEEP_TIMER_STORAGE_KEY = 'podcast-me.sleep-timer.v1'

/**
 * Persisted sleep timer: the absolute expiry plus the mode. Stored on every
 * set/clear so an app kill mid-countdown can be reconciled on relaunch (and
 * on foreground): a future `endsAt` resumes ticking, anything else is dead.
 */
export type PersistedSleepTimer = {
  endsAt: number | null
  durationMinutes: number | null
  endOfEpisode: boolean
}

export async function loadSleepTimerState(): Promise<PersistedSleepTimer | null> {
  try {
    const stored = await AsyncStorage.getItem(SLEEP_TIMER_STORAGE_KEY)

    if (stored === null) {
      return null
    }

    const parsed: unknown = JSON.parse(stored)

    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }

    const { endsAt, durationMinutes, endOfEpisode } =
      parsed as Partial<PersistedSleepTimer>

    return {
      endsAt:
        typeof endsAt === 'number' && Number.isFinite(endsAt) ? endsAt : null,
      durationMinutes:
        typeof durationMinutes === 'number' &&
        Number.isFinite(durationMinutes) &&
        durationMinutes > 0
          ? durationMinutes
          : null,
      endOfEpisode: endOfEpisode === true,
    }
  } catch {
    return null
  }
}

export function saveSleepTimerState(state: PersistedSleepTimer): Promise<void> {
  return AsyncStorage.setItem(
    SLEEP_TIMER_STORAGE_KEY,
    JSON.stringify(state),
  ).catch(() => undefined) as Promise<void>
}

export function clearSleepTimerState(): Promise<void> {
  return AsyncStorage.removeItem(SLEEP_TIMER_STORAGE_KEY).catch(
    () => undefined,
  ) as Promise<void>
}
