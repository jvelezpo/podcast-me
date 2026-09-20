import { useEffect, useState } from 'react'

/**
 * Stall detector: reports true when `stalled` stays continuously true for
 * `timeoutMs` (default ~8s). Any flicker back to false resets the clock, so
 * brief buffering never trips the notice. `resetKey` restarts the clock on
 * demand (used by the Retry button, which keeps the player transitioning).
 */
export function useStalled(
  stalled: boolean,
  timeoutMs = 8_000,
  resetKey: unknown = null,
): boolean {
  const [isStalled, setIsStalled] = useState(false)

  useEffect(() => {
    if (!stalled) {
      setIsStalled(false)
      return
    }

    const timer = setTimeout(() => setIsStalled(true), timeoutMs)
    return () => clearTimeout(timer)
  }, [stalled, timeoutMs, resetKey])

  return isStalled
}
