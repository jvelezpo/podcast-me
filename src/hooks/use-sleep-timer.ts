import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const ONE_MINUTE_MS = 60_000
/**
 * Outside the final minute the card label only changes per minute and the
 * fade is idle — 1 Hz `setState` would re-render the whole player for
 * nothing (§P3). Coarse-tick above this line, precise-tick below it so the
 * 30 s fade still steps smoothly.
 */
const PRECISE_TICK_MS = 60_000

export type SleepTimerState = {
  sleepTimerEndsAt: number | null
  sleepTimerDurationMinutes: number | null
  sleepTimerRemainingMs: number | null
  sleepTimerRemaining: string | null
  handleSetSleepTimer: (minutes: number) => void
  clearSleepTimer: () => void
  /**
   * Restores a persisted countdown (app kill / relaunch). Returns false and
   * leaves state cleared when `endsAt` already passed.
   */
  restoreSleepTimer: (
    endsAt: number,
    durationMinutes: number | null,
  ) => boolean
  /**
   * Recomputes the countdown immediately. Foregrounding calls this because
   * background-throttled timers can leave a stale label or a missed expiry.
   * Kept free of `react-native` imports so the pure logic stays node-testable.
   */
  refreshSleepTimer: () => void
}

/**
 * Timed sleep countdown shared by the local and remote player surfaces.
 * When the countdown elapses, `onExpire` pauses whichever player is active.
 * End-of-episode hold is tracked separately in the audio library context so
 * both auto-advance paths (playlist queue and library order) can honor it.
 */
export function useSleepTimer(onExpire: () => void): SleepTimerState {
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null)
  const [sleepTimerDurationMinutes, setSleepTimerDurationMinutes] = useState<
    number | null
  >(null)
  const [sleepTimerRemainingMs, setSleepTimerRemainingMs] = useState<
    number | null
  >(null)
  const onExpireRef = useRef(onExpire)
  /** Immediate tick, used to reconcile the countdown on foregrounding. */
  const tickRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    if (sleepTimerEndsAt === null) {
      return
    }

    const updateSleepTimer = () => {
      const remainingMs = sleepTimerEndsAt - Date.now()

      if (remainingMs <= 0) {
        setSleepTimerEndsAt(null)
        setSleepTimerDurationMinutes(null)
        setSleepTimerRemainingMs(null)
        onExpireRef.current()
        return
      }

      // Coarse tick (§P3): avoid 1 Hz parent re-renders for a per-minute
      // label. Only publish when the visible label changes, unless we're
      // inside the precise fade window where the volume ramp needs Ms.
      if (remainingMs > PRECISE_TICK_MS) {
        const nextLabel = formatSleepTimerRemaining(remainingMs)
        setSleepTimerRemainingMs((previous) =>
          previous === null ||
          formatSleepTimerRemaining(previous) !== nextLabel
            ? remainingMs
            : previous,
        )
        return
      }

      setSleepTimerRemainingMs(remainingMs)
    }

    tickRef.current = updateSleepTimer
    updateSleepTimer()
    const interval = setInterval(updateSleepTimer, 1_000)
    return () => clearInterval(interval)
  }, [sleepTimerEndsAt])

  const handleSetSleepTimer = useCallback((minutes: number) => {
    const durationMs = minutes * ONE_MINUTE_MS
    setSleepTimerDurationMinutes(minutes)
    setSleepTimerRemainingMs(durationMs)
    setSleepTimerEndsAt(Date.now() + durationMs)
  }, [])

  const clearSleepTimer = useCallback(() => {
    setSleepTimerEndsAt(null)
    setSleepTimerDurationMinutes(null)
    setSleepTimerRemainingMs(null)
  }, [])

  const restoreSleepTimer = useCallback(
    (endsAt: number, durationMinutes: number | null): boolean => {
      if (!Number.isFinite(endsAt) || endsAt <= Date.now()) {
        return false
      }

      setSleepTimerEndsAt(endsAt)
      setSleepTimerDurationMinutes(durationMinutes)
      setSleepTimerRemainingMs(endsAt - Date.now())
      return true
    },
    [],
  )

  const refreshSleepTimer = useCallback(() => {
    tickRef.current()
  }, [])

  const sleepTimerRemaining =
    sleepTimerRemainingMs === null
      ? null
      : formatSleepTimerRemaining(sleepTimerRemainingMs)

  return useMemo(
    () => ({
      sleepTimerEndsAt,
      sleepTimerDurationMinutes,
      sleepTimerRemainingMs,
      sleepTimerRemaining,
      handleSetSleepTimer,
      clearSleepTimer,
      restoreSleepTimer,
      refreshSleepTimer,
    }),
    [
      sleepTimerEndsAt,
      sleepTimerDurationMinutes,
      sleepTimerRemainingMs,
      sleepTimerRemaining,
      handleSetSleepTimer,
      clearSleepTimer,
      restoreSleepTimer,
      refreshSleepTimer,
    ],
  )
}

export function formatSleepTimerRemaining(remainingMs: number): string {
  if (remainingMs > 60 * ONE_MINUTE_MS) {
    return `${Math.floor(remainingMs / (60 * ONE_MINUTE_MS))}h left`
  }

  return `${Math.max(1, Math.ceil(remainingMs / ONE_MINUTE_MS))}m left`
}
