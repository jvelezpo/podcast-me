import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  PanResponder,
  type AccessibilityActionEvent,
} from 'react-native'
import { View, XStack, YStack, styled } from 'tamagui'

import { EpisodeArtwork } from '@/components/episode-artwork'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import type { AudioPlaybackError } from '@/hooks/use-audio-library-player'
import { useTheme } from '@/hooks/use-theme'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import {
  formatEpisodeDate,
  formatFileSize,
  formatPlaybackTime,
  getEpisodeTitle,
} from '@/utils/audio-display'

type AudioLibraryRowProps = {
  item: LoadedAudioItem
  isActive: boolean
  isPlaying: boolean
  isTransitioning: boolean
  isPlaybackReady: boolean
  currentPositionSeconds: number
  loadedDurationSeconds: number | null
  playbackError: AudioPlaybackError | null
  duplicateHighlightToken: number
  isDeleteDisabled: boolean
  isReorderDisabled: boolean
  onDelete: (item: LoadedAudioItem) => void
  onOpenPlayer: (item: LoadedAudioItem) => void
  onReorder: (itemId: string, offset: number) => void
  onTogglePlayback: (item: LoadedAudioItem) => void
}

export function AudioLibraryRow({
  item,
  isActive,
  isPlaying,
  isTransitioning,
  isPlaybackReady,
  currentPositionSeconds,
  loadedDurationSeconds,
  playbackError,
  duplicateHighlightToken,
  isDeleteDisabled,
  isReorderDisabled,
  onDelete,
  onOpenPlayer,
  onReorder,
  onTogglePlayback,
}: AudioLibraryRowProps) {
  const theme = useTheme()
  const [dragY] = useState(() => new Animated.Value(0))
  const [highlightProgress] = useState(() => new Animated.Value(0))
  const [isDragging, setIsDragging] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const dragDisabledRef = useRef(isReorderDisabled)
  const itemIdRef = useRef(item.id)
  const onReorderRef = useRef(onReorder)

  useEffect(() => {
    dragDisabledRef.current = isReorderDisabled
    itemIdRef.current = item.id
    onReorderRef.current = onReorder
  }, [isReorderDisabled, item.id, onReorder])

  useEffect(() => {
    if (duplicateHighlightToken === 0) {
      return
    }

    highlightProgress.stopAnimation()
    highlightProgress.setValue(0)
    const animation = Animated.sequence([
      Animated.timing(highlightProgress, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(highlightProgress, {
        duration: 260,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(highlightProgress, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(highlightProgress, {
        duration: 340,
        toValue: 0,
        useNativeDriver: true,
      }),
    ])
    animation.start()

    return () => animation.stop()
  }, [duplicateHighlightToken, highlightProgress])

  const reorderResponder = useMemo(() => {
    const canDrag = () => !dragDisabledRef.current
    const finishDrag = (_event: unknown, gestureState: { dy: number }) => {
      const offset = Math.round(gestureState.dy / REORDER_STEP_DISTANCE)
      setIsDragging(false)

      if (offset !== 0) {
        dragY.setValue(0)
        onReorderRef.current(itemIdRef.current, offset)
        return
      }

      Animated.spring(dragY, {
        damping: 18,
        mass: 0.8,
        stiffness: 180,
        toValue: 0,
        useNativeDriver: true,
      }).start()
    }

    // PanResponder stores these callbacks and invokes them only for touch events.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: canDrag,
      onStartShouldSetPanResponderCapture: canDrag,
      onMoveShouldSetPanResponder: canDrag,
      onMoveShouldSetPanResponderCapture: canDrag,
      onPanResponderGrant: () => {
        dragY.stopAnimation()
        dragY.setValue(0)
        setIsDragging(true)
      },
      onPanResponderMove: (_event, gestureState) =>
        dragY.setValue(gestureState.dy),
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    })
  }, [dragY])

  const positionSeconds = isActive
    ? currentPositionSeconds
    : item.lastPositionSeconds
  const durationSeconds = isActive
    ? (loadedDurationSeconds ?? item.durationSeconds)
    : item.durationSeconds
  const progress = durationSeconds
    ? Math.min(Math.max(positionSeconds / durationSeconds, 0), 1)
    : 0
  const itemError =
    playbackError?.itemId === item.id ? playbackError.message : null
  const isBusy = isActive && isTransitioning
  const isButtonDisabled =
    !isPlaybackReady || !item.isAvailable || isTransitioning
  const title = getEpisodeTitle(item.originalName)
  const highlightScale = highlightProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.018],
  })

  const handleReorderAccessibilityAction = (
    event: AccessibilityActionEvent,
  ) => {
    if (isReorderDisabled) {
      return
    }

    if (event.nativeEvent.actionName === 'increment') {
      onReorder(item.id, 1)
    } else if (event.nativeEvent.actionName === 'decrement') {
      onReorder(item.id, -1)
    }
  }

  return (
    <AnimatedView
      borderRadius={Radius.large}
      zIndex={isDragging ? 10 : 0}
      opacity={isDragging ? 0.94 : 1}
      boxShadow={isDragging ? '0 14px 28px rgba(0,0,0,0.28)' : undefined}
      style={{ transform: [{ translateY: dragY }, { scale: highlightScale }] }}
    >
      <AnimatedView
        pointerEvents="none"
        position="absolute"
        top={0}
        right={0}
        bottom={0}
        left={0}
        zIndex={2}
        borderWidth={3}
        borderRadius={Radius.large}
        borderColor="$accent"
        style={{ opacity: highlightProgress }}
      />
      <ThemedView
        type="backgroundElement"
        overflow="hidden"
        borderWidth={1}
        borderColor={isActive ? '$accent' : '$borderColor'}
        // borderColor="red"
        borderRadius={Radius.large}
        boxShadow="0 8px 24px rgba(0,0,0,0.12)"
      >
        <XStack alignItems="center" gap={Spacing.three} padding={Spacing.three}>
          <View
            position="absolute"
            top={8}
            right={8}
            {...reorderResponder.panHandlers}
            accessible
            accessibilityActions={[
              { name: 'decrement', label: 'Move earlier' },
              { name: 'increment', label: 'Move later' },
            ]}
            accessibilityHint="Drag vertically to change the playlist position"
            accessibilityLabel={`Reorder ${title}`}
            accessibilityRole="adjustable"
            accessibilityState={{ disabled: isReorderDisabled }}
            onAccessibilityAction={handleReorderAccessibilityAction}
            minHeight={30}
            minWidth={40}
            flex={1}
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            gap={Spacing.two}
            borderWidth={1}
            borderRadius={Radius.round}
            borderColor="$borderColor"
            backgroundColor={isDragging ? '$backgroundSelected' : 'transparent'}
            opacity={isReorderDisabled ? 0.45 : 1}
            cursor={isReorderDisabled ? 'not-allowed' : 'grab'}
          >
            <SymbolView name={REORDER_ICON} size={18} tintColor={theme.text} />
          </View>
          <AppButton
            tone="ghost"
            accessibilityLabel={`Open player for ${title}`}
            disabled={!isPlaybackReady || !item.isAvailable || isTransitioning}
            onPress={() => onOpenPlayer(item)}
            minWidth={0}
            flex={1}
            justifyContent="flex-start"
            padding={0}
          >
            <EpisodeArtwork
              itemId={item.id}
              name={item.originalName}
              size={76}
            />

            <YStack flex={1} minWidth={0} gap={Spacing.one}>
              <ThemedText type="episodeTitle" numberOfLines={2}>
                {title}
              </ThemedText>
              <ThemedText
                type="metadata"
                themeColor="textSecondary"
                numberOfLines={1}
              >
                Podcast Me · {formatEpisodeDate(item.addedAt)}
              </ThemedText>
              <ThemedText
                type="metadata"
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {formatFileSize(item.sizeBytes)} · Saved offline
              </ThemedText>
              <XStack alignItems="center" gap={Spacing.one}>
                <View
                  width={7}
                  height={7}
                  borderRadius={7}
                  backgroundColor={
                    item.isPlayed
                      ? '$success'
                      : isActive
                        ? '$accent'
                        : '$warning'
                  }
                />
                <ThemedText
                  type="metadata"
                  color={
                    item.isPlayed
                      ? '$success'
                      : isActive
                        ? '$accent'
                        : '$colorMuted'
                  }
                >
                  {item.isPlayed
                    ? 'Played'
                    : isActive
                      ? isPlaying
                        ? 'Playing'
                        : 'In progress'
                      : progress > 0
                        ? 'In progress'
                        : 'Unplayed'}
                </ThemedText>
              </XStack>
            </YStack>
          </AppButton>

          <YStack flexShrink={0} alignItems="center" gap={Spacing.two} pt={30}>
            <ThemedText type="metadata" themeColor="textSecondary">
              {formatPlaybackTime(durationSeconds)}
            </ThemedText>
            <AppButton
              tone="icon"
              accessibilityLabel={`${isBusy ? 'Loading' : isActive && isPlaying ? 'Pause' : itemError ? 'Retry' : 'Play'} ${title}`}
              accessibilityState={{ busy: isBusy, disabled: isButtonDisabled }}
              disabled={isButtonDisabled}
              onPress={() => onTogglePlayback(item)}
              backgroundColor="$accent"
            >
              <SymbolView
                name={isActive && isPlaying ? PAUSE_ICON : PLAY_ICON}
                size={22}
                tintColor={theme.accentForeground}
                weight="bold"
              />
            </AppButton>
            <AppButton
              tone="ghost"
              minHeight={32}
              accessibilityLabel={`${showActions ? 'Hide' : 'Show'} options for ${title}`}
              onPress={() => setShowActions((visible) => !visible)}
            >
              <SymbolView
                name={MORE_ICON}
                size={20}
                tintColor={theme.textSecondary}
              />
            </AppButton>
          </YStack>
        </XStack>

        {(isActive || progress > 0) && durationSeconds !== null && (
          <View height={3} backgroundColor="$backgroundSelected">
            <View
              height="100%"
              width={`${progress * 100}%`}
              backgroundColor="$accent"
            />
          </View>
        )}

        {(itemError || !item.isAvailable) && (
          <YStack
            gap={Spacing.one}
            paddingHorizontal={Spacing.three}
            paddingBottom={Spacing.three}
          >
            {itemError && (
              <ThemedText type="metadata" color="$danger">
                {itemError}
              </ThemedText>
            )}
            {!item.isAvailable && (
              <ThemedText type="metadata" color="$warning">
                {item.unavailableReason === 'unsupported'
                  ? 'Unsupported audio type. Re-import a supported recording.'
                  : 'File missing. Re-import this recording to restore playback.'}
              </ThemedText>
            )}
          </YStack>
        )}

        {showActions && (
          <XStack
            gap={Spacing.two}
            paddingHorizontal={Spacing.three}
            paddingBottom={Spacing.three}
            $compact={{ flexDirection: 'column' }}
          >
            <AppButton
              tone="danger"
              accessibilityLabel={`Remove ${title}`}
              accessibilityState={{ disabled: isDeleteDisabled }}
              disabled={isDeleteDisabled}
              onPress={() => onDelete(item)}
              mt={5}
            >
              <SymbolView
                name={DELETE_ICON}
                size={17}
                tintColor={theme.danger}
              />
              <ThemedText type="smallBold" color="$danger">
                Remove
              </ThemedText>
            </AppButton>
          </XStack>
        )}
      </ThemedView>
    </AnimatedView>
  )
}

const REORDER_STEP_DISTANCE = 124

const PLAY_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
}
const PAUSE_ICON: SymbolViewProps['name'] = {
  ios: 'pause.fill',
  android: 'pause',
  web: 'pause',
}
const MORE_ICON: SymbolViewProps['name'] = {
  ios: 'ellipsis',
  android: 'more_horiz',
  web: 'more_horiz',
}
const REORDER_ICON: SymbolViewProps['name'] = {
  ios: 'line.3.horizontal',
  android: 'drag_handle',
  web: 'drag_handle',
}
const DELETE_ICON: SymbolViewProps['name'] = {
  ios: 'trash',
  android: 'delete_outline',
  web: 'delete_outline',
}

const AnimatedView = styled(Animated.View, {
  name: 'AnimatedView',
})
