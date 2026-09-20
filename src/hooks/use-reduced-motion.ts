import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/**
 * System reduced-motion setting as reactive state. Gate every
 * `Animated.spring/timing` scale/shine effect behind this: when true,
 * animations resolve instantly (or are skipped) instead of playing.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceMotion(enabled)
        }
      })
      .catch(() => undefined)

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    )

    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return reduceMotion
}
