import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  PanResponder,
  type AccessibilityActionEvent,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, XStack, YStack } from 'tamagui'

import { EpisodeArtwork } from '@/components/episode-artwork'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useAudioLibraryContext } from '@/contexts/audio-library-context'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTheme } from '@/hooks/use-theme'
import {
  getQueueEntryKey,
  isQueueEntryPlayable,
  type QueueEntry,
} from '@/services/playback-queue'
import {
  formatPlaybackTime,
  getAudioItemTitle,
} from '@/utils/audio-display'

export type QueueSheetProps = {
  onClose: () => void
}

/** Pixels of vertical drag that move an entry one position. */
const REORDER_STEP_DISTANCE = 72
/** Leftward swipe distance that removes an entry from the queue. */
const REMOVE_SWIPE_DISTANCE = 80

/**
 * Queue bottom sheet over the single active queue: Currently Playing plus
 * the Next list (and earlier entries) with artwork, title, remaining time,
 * and progress bars. Drag the handle to reorder, swipe left (or use the
 * remove button) to remove; there is no shuffle. Auto-advance follows this
 * visible order, and VoiceOver navigates rows, handles, and actions.
 */
export function QueueSheet({ onClose }: QueueSheetProps) {
  const theme = useTheme()
  const {
    playbackQueue,
    playback,
    remotePlayback,
    playActiveQueueEntry,
    moveQueueEntry,
    removeQueueEntryById,
  } = useAudioLibraryContext()
  const entries = playbackQueue?.entries ?? []
  const isOnline = playbackQueue?.isOnline ?? true
  const activeKey =
    playback.activeItemId !== null
      ? `local:${playback.activeItemId}`
      : remotePlayback.activeAudioId !== null
        ? `remote:${remotePlayback.activeAudioId}`
        : null
  const activeIndex = useMemo(
    () => entries.findIndex((entry) => getQueueEntryKey(entry) === activeKey),
    [entries, activeKey],
  )
  const nowPlaying = activeIndex >= 0 ? entries[activeIndex] : null
  const upNext =
    activeIndex >= 0 ? entries.slice(activeIndex + 1) : [...entries]
  const earlier = activeIndex > 0 ? entries.slice(0, activeIndex) : []

  // Stable row callbacks (§P0): rows are memoized, so per-entry inline
  // arrows would break memo on every tick. Pass stable entry-aware
  // callbacks and let the memoized row bind its own entry.
  const handlePlayEntry = useCallback(
    (entry: QueueEntry) => playActiveQueueEntry(entry),
    [playActiveQueueEntry],
  )
  const handleMoveEntry = useCallback(
    (entry: QueueEntry, offset: number) =>
      moveQueueEntry(entry.kind, queueEntryId(entry), offset),
    [moveQueueEntry],
  )
  const handleRemoveEntry = useCallback(
    (entry: QueueEntry) =>
      removeQueueEntryById(entry.kind, queueEntryId(entry)),
    [removeQueueEntryById],
  )

  const renderRow = useCallback(
    (entry: QueueEntry) => (
      <QueueRow
        key={getQueueEntryKey(entry)}
        entry={entry}
        isActive={getQueueEntryKey(entry) === activeKey}
        isOnline={isOnline}
        onPlay={handlePlayEntry}
        onMove={handleMoveEntry}
        onRemove={handleRemoveEntry}
      />
    ),
    [activeKey, handleMoveEntry, handlePlayEntry, handleRemoveEntry, isOnline],
  )

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={onClose}
    >
      <ThemedView flex={1}>
        <SafeAreaView style={{ flex: 1 }}>
          <XStack
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal={Spacing.three}
            paddingVertical={Spacing.two}
          >
            <ThemedText type="heading">Queue</ThemedText>
            <AppButton
              tone="icon"
              accessibilityLabel="Close queue"
              onPress={onClose}
            >
              <SymbolView
                name={CLOSE_ICON}
                size={20}
                tintColor={theme.textSecondary}
              />
            </AppButton>
          </XStack>
          <ScrollView
            flex={1}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              width: '100%',
              maxWidth: 640,
              alignSelf: 'center',
              paddingHorizontal: Spacing.three,
              paddingBottom: Spacing.five,
            }}
          >
            <ThemedText
              type="eyebrow"
              themeColor="accent"
              accessibilityRole="header"
            >
              Now playing
            </ThemedText>
            <View height={Spacing.two} />
            {nowPlaying ? (
              renderRow(nowPlaying)
            ) : (
              <ThemedText themeColor="textSecondary">
                Nothing playing yet. Pick an episode to start the queue.
              </ThemedText>
            )}
            <View height={Spacing.three} />
            <ThemedText
              type="eyebrow"
              themeColor="accent"
              accessibilityRole="header"
              accessibilityLabel={`Up next, ${upNext.length} ${
                upNext.length === 1 ? 'episode' : 'episodes'
              }`}
            >
              Up next · {upNext.length}
            </ThemedText>
            <View height={Spacing.two} />
            {upNext.length === 0 ? (
              <ThemedText themeColor="textSecondary">
                End of queue. Add more from the library or a playlist.
              </ThemedText>
            ) : (
              <YStack gap={Spacing.two}>{upNext.map(renderRow)}</YStack>
            )}
            {earlier.length > 0 ? (
              <>
                <View height={Spacing.three} />
                <ThemedText
                  type="eyebrow"
                  themeColor="textSecondary"
                  accessibilityRole="header"
                >
                  Earlier in queue
                </ThemedText>
                <View height={Spacing.two} />
                <YStack gap={Spacing.two}>{earlier.map(renderRow)}</YStack>
              </>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  )
}

function queueEntryId(entry: QueueEntry): string {
  return entry.kind === 'local' ? entry.item.id : entry.audio.id
}

type QueueRowProps = {
  entry: QueueEntry
  isActive: boolean
  isOnline: boolean
  onPlay: (entry: QueueEntry) => void
  onMove: (entry: QueueEntry, offset: number) => void
  onRemove: (entry: QueueEntry) => void
}

const QueueRow = memo(function QueueRow({
  entry,
  isActive,
  isOnline,
  onPlay,
  onMove,
  onRemove,
}: QueueRowProps) {
  const theme = useTheme()
  const { playback, remotePlayback } = useAudioLibraryContext()
  const [dragY] = useState(() => new Animated.Value(0))
  const [swipeX] = useState(() => new Animated.Value(0))
  const [isDragging, setIsDragging] = useState(false)
  const reduceMotion = useReducedMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const title =
    entry.kind === 'local' ? getAudioItemTitle(entry.item) : entry.audio.title
  const playable = isActive || isQueueEntryPlayable(entry, isOnline)

  // Granular deps (§P0): inactive rows keep tick-stable props so memo bails
  // out; only the active row's position subscribes to the 2 Hz tick.
  const localActiveItemId = playback.activeItemId
  const localPosition = playback.currentPositionSeconds
  const localDuration = playback.durationSeconds
  const remoteActiveId = remotePlayback.activeAudio?.id ?? null
  const remotePosition = remotePlayback.currentPositionSeconds
  const remoteDuration = remotePlayback.durationSeconds
  const progress = useMemo(() => {
    if (entry.kind === 'local') {
      const isCurrent = isActive && localActiveItemId === entry.item.id
      const position = isCurrent ? localPosition : entry.item.lastPositionSeconds
      const duration = isCurrent
        ? (localDuration ?? entry.item.durationSeconds)
        : entry.item.durationSeconds
      return duration ? { position, duration } : null
    }

    if (isActive && entry.kind === 'remote' && remoteActiveId === entry.audio.id) {
      return {
        position: remotePosition,
        duration: remoteDuration,
      }
    }

    return null
  }, [
    entry,
    isActive,
    localActiveItemId,
    localDuration,
    localPosition,
    remoteActiveId,
    remoteDuration,
    remotePosition,
  ])

  const remaining =
    progress?.duration != null
      ? Math.max(0, progress.duration - progress.position)
      : null
  const progressRatio =
    progress?.duration != null && progress.duration > 0
      ? Math.min(Math.max(progress.position / progress.duration, 0), 1)
      : 0
  const subtitle =
    entry.kind === 'local'
      ? [entry.item.metadata.artist, entry.item.metadata.album]
          .filter(Boolean)
          .join(' · ') || 'Downloaded'
      : entry.isCached
        ? 'Cached · available offline'
        : 'Remote stream'

  // Vertical drag on the handle reorders; VoiceOver uses increment/decrement.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const reorderResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragY.stopAnimation()
          dragY.setValue(0)
          setIsDragging(true)
        },
        onPanResponderMove: (_event, gesture) => {
          dragY.setValue(gesture.dy)
        },
        onPanResponderRelease: (_event, gesture) => {
          setIsDragging(false)
          const offset = Math.round(gesture.dy / REORDER_STEP_DISTANCE)

          if (offset !== 0) {
            onMove(entry, offset)
          }

          dragY.setValue(0)
        },
        onPanResponderTerminate: () => {
          setIsDragging(false)
          dragY.setValue(0)
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [dragY, entry, onMove],
  )

  // Horizontal swipe anywhere on the row removes it; taps still reach the
  // inner play button because the responder only claims actual moves.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const swipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > Math.abs(gesture.dy) &&
          Math.abs(gesture.dx) > 8,
        onPanResponderMove: (_event, gesture) => {
          swipeX.setValue(Math.min(gesture.dx, 0))
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < -REMOVE_SWIPE_DISTANCE) {
            swipeX.setValue(0)
            onRemove(entry)
            return
          }

          if (reduceMotionRef.current) {
            swipeX.setValue(0)
            return
          }

          Animated.spring(swipeX, {
            toValue: 0,
            damping: 20,
            stiffness: 260,
            useNativeDriver: true,
          }).start()
        },
        onPanResponderTerminate: () => {
          swipeX.setValue(0)
        },
        onPanResponderTerminationRequest: () => true,
        onShouldBlockNativeResponder: () => false,
      }),
    [entry, onRemove, swipeX],
  )

  const handleReorderAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') {
      onMove(entry, 1)
    } else if (event.nativeEvent.actionName === 'decrement') {
      onMove(entry, -1)
    }
  }

  const handlePressPlay = useCallback(
    () => onPlay(entry),
    [entry, onPlay],
  )
  const handlePressRemove = useCallback(
    () => onRemove(entry),
    [entry, onRemove],
  )

  return (
    <Animated.View
      {...swipeResponder.panHandlers}
      style={{
        transform: [{ translateY: dragY }, { translateX: swipeX }],
        opacity: playable ? 1 : 0.55,
        zIndex: isDragging ? 10 : 0,
      }}
    >
      <ThemedView
        type="backgroundElement"
        borderWidth={1}
        borderColor={isActive ? '$accent' : '$borderColor'}
        borderRadius={Radius.medium}
        overflow="hidden"
      >
        <XStack alignItems="center" gap={Spacing.two} padding={Spacing.two}>
          <View
            {...reorderResponder.panHandlers}
            accessible
            accessibilityActions={[
              { name: 'decrement', label: 'Move earlier' },
              { name: 'increment', label: 'Move later' },
            ]}
            accessibilityHint="Drag vertically to reorder, or use VoiceOver actions"
            accessibilityLabel={`Reorder ${title}`}
            accessibilityRole="adjustable"
            onAccessibilityAction={handleReorderAction}
            width={44}
            minWidth={44}
            height={44}
            minHeight={44}
            flexShrink={0}
            alignItems="center"
            justifyContent="center"
            borderRadius={Radius.round}
            cursor="grab"
          >
            <SymbolView
              name={REORDER_ICON}
              size={20}
              tintColor={theme.textSecondary}
            />
          </View>
          <AppButton
            tone="ghost"
            accessibilityLabel={`${isActive ? 'Playing now' : playable ? 'Play' : 'Unavailable offline'}: ${title}${
              remaining !== null
                ? `, ${formatPlaybackTime(remaining)} left`
                : ''
            }`}
            accessibilityState={{ disabled: !playable }}
            disabled={!playable}
            onPress={handlePressPlay}
            minWidth={0}
            minHeight={44}
            flex={1}
            justifyContent="flex-start"
            padding={0}
          >
            <EpisodeArtwork
              imageUrl={
                entry.kind === 'local' ? entry.item.metadata.coverArtUrl : null
              }
              itemId={
                entry.kind === 'local'
                  ? entry.item.id
                  : `remote-${entry.audio.id}`
              }
              name={title}
              size={42}
            />
            <YStack flex={1} minWidth={0} gap={Spacing.half}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {title}
              </ThemedText>
              <ThemedText
                type="metadata"
                themeColor={isActive ? 'accent' : 'textSecondary'}
                numberOfLines={1}
              >
                {isActive ? `Now playing · ${subtitle}` : subtitle}
              </ThemedText>
            </YStack>
          </AppButton>
          <YStack alignItems="flex-end" flexShrink={0} gap={Spacing.half}>
            <ThemedText type="metadata" themeColor="textSecondary">
              {remaining !== null
                ? `−${formatPlaybackTime(remaining)}`
                : !playable
                  ? 'Offline'
                  : ''}
            </ThemedText>
            {!isActive && (
              <AppButton
                tone="ghost"
                accessibilityLabel={`Remove ${title} from queue`}
                accessibilityHint="Removes the episode from the queue without deleting any files"
                onPress={handlePressRemove}
                width={44}
                minWidth={44}
                height={44}
                minHeight={44}
                paddingHorizontal={0}
                paddingVertical={0}
              >
                <SymbolView
                  name={REMOVE_ICON}
                  size={18}
                  tintColor={theme.textSecondary}
                />
              </AppButton>
            )}
          </YStack>
        </XStack>
        <View height={3} backgroundColor="$backgroundSelected">
          <View
            height="100%"
            width={`${progressRatio * 100}%`}
            backgroundColor="$accent"
          />
        </View>
      </ThemedView>
    </Animated.View>
  )
})

const CLOSE_ICON: SymbolViewProps['name'] = {
  ios: 'xmark',
  android: 'close',
  web: 'close',
}
const REORDER_ICON: SymbolViewProps['name'] = {
  ios: 'line.3.horizontal',
  android: 'drag_handle',
  web: 'drag_handle',
}
const REMOVE_ICON: SymbolViewProps['name'] = {
  ios: 'trash',
  android: 'delete_outline',
  web: 'delete_outline',
}
