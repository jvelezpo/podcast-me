import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

/**
 * Central haptics helper. Every call is safe on all platforms: web never
 * vibrates (guarded by platform check) and native failures resolve silently
 * so playback gestures can never crash on a haptic error.
 */
export function impactLight(): void {
  if (Platform.OS === 'web') {
    return
  }

  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
    // Haptics are best-effort feedback; never interrupt playback UX.
  })
}

/** Selection tick for speed / sleep option rows. Web-guarded, never throws. */
export function selection(): void {
  if (Platform.OS === 'web') {
    return
  }

  void Haptics.selectionAsync().catch(() => {
    // Best-effort only.
  })
}

/** Success ping for upload / add-to-playlist completions. Web-guarded. */
export function success(): void {
  if (Platform.OS === 'web') {
    return
  }

  void Haptics.notificationAsync(
    Haptics.NotificationFeedbackType.Success,
  ).catch(() => {
    // Best-effort only.
  })
}
