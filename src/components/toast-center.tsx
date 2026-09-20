import { useEffect, useState } from 'react'
import { View, XStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { BottomPlayerInset, BottomTabInset, Radius, Spacing } from '@/constants/theme'
import { useAudioLibraryContext } from '@/contexts/audio-library-context'
import { impactLight } from '@/services/haptics'
import {
  dismissToast,
  getToastQueue,
  subscribeToastQueue,
  type ToastItem,
} from '@/services/toast-queue'

const TOAST_DURATION_MS = 3_500

/**
 * Single render point for the centralized toast queue. Sits above the
 * player dock (and the expanded sheet) so interruption toasts with actions
 * like [Resume] and [Retry] stay reachable. Any layer can notify.
 */
export function ToastCenter() {
  const [, setTick] = useState(0)
  const { playback, remotePlayback } = useAudioLibraryContext()

  useEffect(() => subscribeToastQueue(() => setTick((tick) => tick + 1)), [])

  const queue = getToastQueue()

  if (queue.length === 0) {
    return null
  }

  const hasPlayer =
    playback.activeItemId !== null || remotePlayback.activeAudioId !== null

  return (
    <View
      position="absolute"
      zIndex={200}
      right={Spacing.four}
      bottom={(hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four}
      left={Spacing.four}
      maxWidth={560}
      alignSelf="center"
      gap={Spacing.two}
      pointerEvents="box-none"
      $compact={{ right: Spacing.two, left: Spacing.two }}
    >
      {queue.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </View>
  )
}

function ToastCard({ toast }: { toast: ToastItem }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast.id])

  const handleAction = () => {
    impactLight()
    dismissToast(toast.id)
    toast.action?.onPress()
  }

  return (
    <ThemedView
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      type="backgroundSelected"
      paddingHorizontal={Spacing.four}
      paddingVertical={Spacing.three}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.medium}
      boxShadow="0 10px 24px rgba(0,0,0,0.24)"
    >
      {toast.action ? (
        <XStack alignItems="center" gap={Spacing.three}>
          <ThemedText type="smallBold" flex={1} flexShrink={1}>
            {toast.message}
          </ThemedText>
          <AppButton
            tone="secondary"
            accessibilityLabel={
              toast.action.accessibilityLabel ?? toast.action.label
            }
            accessibilityHint={toast.action.accessibilityHint}
            onPress={handleAction}
            minHeight={44}
            flexShrink={0}
          >
            <ThemedText type="smallBold">{toast.action.label}</ThemedText>
          </AppButton>
        </XStack>
      ) : (
        <ThemedText type="smallBold" textAlign="center">
          {toast.message}
        </ThemedText>
      )}
    </ThemedView>
  )
}
