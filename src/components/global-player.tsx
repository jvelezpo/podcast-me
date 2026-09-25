import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Animated,
  AppState,
  PanResponder,
  type LayoutChangeEvent,
  type PanResponderGestureState,
  useWindowDimensions,
} from 'react-native'
import { Spinner, View, XStack, YStack, useMedia } from 'tamagui'

import { AudioPlaybackSlider } from '@/components/audio-playback-slider'
import { EpisodeArtwork } from '@/components/episode-artwork'
import { PlayerSheet } from '@/components/player-sheet'
import { QueueSheet } from '@/components/queue-sheet'
import { SleepTimerSheet } from '@/components/sleep-timer-sheet'
import { SpeedSheet } from '@/components/speed-sheet'
import { SwipeableArtwork } from '@/components/swipeable-artwork'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import {
  BottomTabInset,
  MaxContentWidth,
  PlayerDockHeight,
  Radius,
  Spacing,
} from '@/constants/theme'
import { useAudioLibraryContext } from '@/contexts/audio-library-context'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useSleepTimer } from '@/hooks/use-sleep-timer'
import { useStalled } from '@/hooks/use-stalled'
import { useTheme } from '@/hooks/use-theme'
import type { RemoteAudio } from '@/services/api'
import { impactLight } from '@/services/haptics'
import { findNextQueueEntry, type QueueEntry } from '@/services/playback-queue'
import {
  clearSleepTimerState,
  loadSleepTimerState,
  saveSleepTimerState,
} from '@/services/sleep-timer-storage'
import {
  formatEpisodeDate,
  formatPlaybackTime,
  getAudioItemTitle,
} from '@/utils/audio-display'
import { getShowKey } from '@/utils/playback-rate'

const SWIPE_INTENT_DISTANCE = 10
const DOCK_EXPAND_DISTANCE = 48
const DOCK_DISMISS_DISTANCE = 80
/** Sleep fade-out: volume ramps 1 → 0 across the final 30s of a timed sleep. */
const SLEEP_FADE_MS = 30_000
/** A load/buffer that never resolves within ~8s is a stall, not a spinner. */
const STALL_NOTICE_DELAY_MS = 8_000

export function GlobalPlayer() {
  const {
    library,
    playback,
    remotePlayback,
    closePlayer,
    isPlayerOpen,
    openPlayer,
    openRemotePlayer,
    playerItem,
    skipToNext,
    skipToPrevious,
    skipToNextPreservingPlayback,
    skipToPreviousPreservingPlayback,
    endOfEpisodeArmed,
    armEndOfEpisode,
    consumeEndOfEpisodeHold,
    playbackQueue,
  } = useAudioLibraryContext()
  const activeItem =
    library.items.find((candidate) => candidate.id === playback.activeItemId) ??
    null
  const selectedLocalItem =
    playerItem?.kind === 'local'
      ? (library.items.find(
          (candidate) => candidate.id === playerItem.item.id,
        ) ?? playerItem.item)
      : null
  const item = selectedLocalItem ?? activeItem
  const [playerWidth, setPlayerWidth] = useState(0)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [isSpeedOpen, setIsSpeedOpen] = useState(false)
  const [isSleepOpen, setIsSleepOpen] = useState(false)
  const canSwipeRef = useRef(false)
  const playerWidthRef = useRef(0)
  const wasPlayingBeforeScrubRef = useRef(false)
  // Vertical drag distance on the collapsed dock; upward flings expand the
  // sheet. Tracked in a ref because the responder outlives render state.
  const dockDragYRef = useRef(0)
  const expandDockRef = useRef<(() => void) | null>(null)
  const dismissDockRef = useRef<(() => void) | null>(null)
  // The sleep timer pauses whichever player is active, so the countdown is
  // shared by the local and remote surfaces. Playback refs are read lazily
  // because status updates frequently.
  const sleepPlaybackRef = useRef({
    isLocalPlaying: playback.isPlaying,
    localItem: activeItem,
    pauseLocalPlayback: playback.pausePlayback,
    isRemotePlaying: remotePlayback.isPlaying,
    remoteAudio: remotePlayback.activeAudio,
    pauseRemotePlayback: remotePlayback.pausePlayback,
  })
  const sleepTimer = useSleepTimer(() => {
    const current = sleepPlaybackRef.current

    // The fade-out lowers volume toward expiry; always restore full volume
    // before pausing so the next session never starts silent.
    playback.setVolume(1)
    remotePlayback.setVolume(1)

    if (current.isLocalPlaying && current.localItem) {
      void current.pauseLocalPlayback(current.localItem)
    } else if (current.isRemotePlaying && current.remoteAudio) {
      current.pauseRemotePlayback(current.remoteAudio)
    }
  })
  const swipeOffset = useRef(new Animated.Value(0)).current
  const media = useMedia()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const isLandscape = windowWidth > windowHeight
  const theme = useTheme()
  const reduceMotion = useReducedMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const activeItemId = activeItem?.id ?? null

  useEffect(() => {
    sleepPlaybackRef.current = {
      isLocalPlaying: playback.isPlaying,
      localItem: activeItem,
      pauseLocalPlayback: playback.pausePlayback,
      isRemotePlaying: remotePlayback.isPlaying,
      remoteAudio: remotePlayback.activeAudio,
      pauseRemotePlayback: remotePlayback.pausePlayback,
    }
  }, [
    activeItem,
    playback.isPlaying,
    playback.pausePlayback,
    remotePlayback.activeAudio,
    remotePlayback.isPlaying,
    remotePlayback.pausePlayback,
  ])

  useEffect(() => {
    canSwipeRef.current =
      activeItemId !== null && !isPlayerOpen && !playback.isTransitioning
  }, [activeItemId, isPlayerOpen, playback.isTransitioning])

  useEffect(() => {
    swipeOffset.setValue(0)
  }, [activeItemId, swipeOffset])

  // Dock-up drag expands the collapsed dock into the sheet.
  useEffect(() => {
    expandDockRef.current = activeItem ? () => openPlayer(activeItem) : null
  }, [activeItem, openPlayer])

  useEffect(() => {
    dismissDockRef.current = () => {
      void playback.dismissPlayer()
    }
  }, [playback.dismissPlayer])

  // Sleep persistence: restore a countdown (or the end-of-episode hold) that
  // survived an app kill, then persist every later change. Saves wait until
  // the restore completes so mounting never wipes the stored state first.
  const sleepRestoredRef = useRef(false)
  const { restoreSleepTimer, refreshSleepTimer } = sleepTimer
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      // Foreground reconcile: background-throttled timers can leave a stale
      // remaining label or a missed expiry; tick immediately on return.
      if (nextState === 'active') {
        refreshSleepTimer()
      }
    })

    return () => subscription.remove()
  }, [refreshSleepTimer])
  useEffect(() => {
    void (async () => {
      const saved = await loadSleepTimerState()

      if (saved) {
        if (saved.endsAt !== null && saved.endsAt > Date.now()) {
          restoreSleepTimer(saved.endsAt, saved.durationMinutes)
        } else {
          if (saved.endOfEpisode) {
            armEndOfEpisode()
          }

          void clearSleepTimerState()
        }
      }

      sleepRestoredRef.current = true
    })()
  }, [armEndOfEpisode, restoreSleepTimer])

  useEffect(() => {
    if (!sleepRestoredRef.current) {
      return
    }

    if (sleepTimer.sleepTimerEndsAt === null && !endOfEpisodeArmed) {
      void clearSleepTimerState()
      return
    }

    void saveSleepTimerState({
      endsAt: sleepTimer.sleepTimerEndsAt,
      durationMinutes: sleepTimer.sleepTimerDurationMinutes,
      endOfEpisode: endOfEpisodeArmed,
    })
  }, [
    endOfEpisodeArmed,
    sleepTimer.sleepTimerDurationMinutes,
    sleepTimer.sleepTimerEndsAt,
  ])

  // Sleep fade-out: ramp the active player's volume 1 → 0 across the final
  // 30s of a timed countdown. End-of-episode has no clock, so it never fades.
  // Guarded so the volume bridge fires only when the stepped value changes,
  // and the effect only re-runs on real inputs (not every 500 ms tick).
  const lastFadeVolumeRef = useRef(1)
  useEffect(() => {
    const remainingMs = sleepTimer.sleepTimerRemainingMs

    if (
      sleepTimer.sleepTimerEndsAt === null ||
      remainingMs === null ||
      remainingMs > SLEEP_FADE_MS ||
      remainingMs <= 0
    ) {
      lastFadeVolumeRef.current = 1
      return
    }

    const volume = Math.min(Math.max(remainingMs / SLEEP_FADE_MS, 0), 1)

    if (volume === lastFadeVolumeRef.current) {
      return
    }

    lastFadeVolumeRef.current = volume

    if (playback.activeItemId !== null) {
      playback.setVolume(volume)
    } else if (remotePlayback.activeAudioId !== null) {
      remotePlayback.setVolume(volume)
    }
  }, [
    playback.activeItemId,
    playback.setVolume,
    remotePlayback.activeAudioId,
    remotePlayback.setVolume,
    sleepTimer.sleepTimerEndsAt,
    sleepTimer.sleepTimerRemainingMs,
  ])

  // Stall inputs stay early-safe: the remote early-return below skips the
  // rest of this body, so no item-dependent hooks may come after it.
  const [localRetryToken, setLocalRetryToken] = useState(0)
  const viewingActiveItem = item?.id === activeItemId
  const localStalled = useStalled(
    (viewingActiveItem ?? false) &&
      (playback.isTransitioning || playback.isBuffering),
    STALL_NOTICE_DELAY_MS,
    localRetryToken,
  )

  const handleRetryLocalPlayback = useCallback(() => {
    impactLight()
    setLocalRetryToken((token) => token + 1)
    playback.retryPlayback()
  }, [playback.retryPlayback])

  // Playback status updates frequently, so the responder reads current state from refs.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const swipeDismissResponder = useMemo(() => {
    const restorePlayer = () => {
      dockDragYRef.current = 0

      if (reduceMotionRef.current) {
        swipeOffset.setValue(0)
        return
      }

      Animated.spring(swipeOffset, {
        toValue: 0,
        damping: 20,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }).start()
    }

    const shouldClaimSwipe = (
      _event: unknown,
      gesture: PanResponderGestureState,
    ) => {
      if (!canSwipeRef.current) {
        return false
      }

      // Horizontal swipe dismisses the collapsed dock; vertical dock-up
      // expands it into the full player.
      if (
        Math.abs(gesture.dx) >= SWIPE_INTENT_DISTANCE &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy)
      ) {
        return true
      }

      // Vertical dock-up: expands the collapsed dock into the sheet.
      return (
        gesture.dy <= -SWIPE_INTENT_DISTANCE &&
        Math.abs(gesture.dy) > Math.abs(gesture.dx)
      )
    }

    // PanResponder stores these callbacks and invokes them only for touch events.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponder: shouldClaimSwipe,
      onMoveShouldSetPanResponderCapture: shouldClaimSwipe,
      onPanResponderGrant: () => {
        dockDragYRef.current = 0
        swipeOffset.stopAnimation()
      },
      onPanResponderMove: (_event, gesture) => {
        dockDragYRef.current = gesture.dy
        swipeOffset.setValue(gesture.dx)
      },
      onPanResponderRelease: (_event, gesture) => {
        if (
          Math.abs(gesture.dx) >= DOCK_DISMISS_DISTANCE &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy)
        ) {
          dockDragYRef.current = 0
          const flyDistance = Math.max(playerWidthRef.current, 1)

          if (reduceMotionRef.current) {
            swipeOffset.setValue(0)
            dismissDockRef.current?.()
            return
          }

          Animated.timing(swipeOffset, {
            toValue: gesture.dx < 0 ? -flyDistance : flyDistance,
            duration: 180,
            useNativeDriver: true,
          }).start(({ finished }) => {
            swipeOffset.setValue(0)

            if (finished) {
              dismissDockRef.current?.()
            }
          })
          return
        }

        // Drag dock-up expands the full player.
        if (
          gesture.dy <= -DOCK_EXPAND_DISTANCE &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx)
        ) {
          dockDragYRef.current = 0
          swipeOffset.setValue(0)
          expandDockRef.current?.()
          return
        }

        restorePlayer()
      },
      onPanResponderTerminate: restorePlayer,
      onPanResponderTerminationRequest: () => true,
    })
  }, [swipeOffset])

  const clearSleepTimer = useCallback(() => {
    consumeEndOfEpisodeHold()
    sleepTimer.clearSleepTimer()
    // A cleared timer must never leave faded volume behind.
    lastFadeVolumeRef.current = 1
    playback.setVolume(1)
    remotePlayback.setVolume(1)
  }, [
    consumeEndOfEpisodeHold,
    playback.setVolume,
    remotePlayback.setVolume,
    sleepTimer,
  ])

  const handleSetSleepMinutes = useCallback(
    (minutes: number) => {
      sleepTimer.handleSetSleepTimer(minutes)
    },
    [sleepTimer],
  )

  const handleArmEndOfEpisode = useCallback(() => {
    armEndOfEpisode()
  }, [armEndOfEpisode])

  const handleOpenQueue = useCallback(() => setIsQueueOpen(true), [])
  const handleCloseQueue = useCallback(() => setIsQueueOpen(false), [])
  const handleOpenSleep = useCallback(() => {
    impactLight()
    setIsSleepOpen(true)
  }, [])
  const handleCloseSleep = useCallback(() => setIsSleepOpen(false), [])

  const sleepIsActive = useMemo(
    () => sleepTimer.sleepTimerEndsAt !== null || endOfEpisodeArmed,
    [endOfEpisodeArmed, sleepTimer.sleepTimerEndsAt],
  )
  const sleepTriggerLabel = useMemo(() => {
    if (sleepTimer.sleepTimerRemaining !== null) {
      return sleepTimer.sleepTimerRemaining
    }

    if (endOfEpisodeArmed) {
      return 'End of episode'
    }

    return 'Sleep'
  }, [endOfEpisodeArmed, sleepTimer.sleepTimerRemaining])

  const handleSelectSleepMinutes = useCallback(
    (minutes: number) => {
      handleSetSleepMinutes(minutes)
      setIsSleepOpen(false)
    },
    [handleSetSleepMinutes],
  )

  const handleSelectEndOfEpisode = useCallback(() => {
    handleArmEndOfEpisode()
    setIsSleepOpen(false)
  }, [handleArmEndOfEpisode])

  const sleepSheet = useMemo(
    () =>
      isSleepOpen ? (
        <SleepTimerSheet
          endsAt={sleepTimer.sleepTimerEndsAt}
          durationMinutes={sleepTimer.sleepTimerDurationMinutes}
          remaining={sleepTimer.sleepTimerRemaining}
          endOfEpisodeArmed={endOfEpisodeArmed}
          onSetMinutes={handleSelectSleepMinutes}
          onSetEndOfEpisode={handleSelectEndOfEpisode}
          onClear={() => {
            clearSleepTimer()
            setIsSleepOpen(false)
          }}
          onClose={handleCloseSleep}
        />
      ) : null,
    [
      clearSleepTimer,
      endOfEpisodeArmed,
      handleCloseSleep,
      handleSelectEndOfEpisode,
      handleSelectSleepMinutes,
      isSleepOpen,
      sleepTimer.sleepTimerDurationMinutes,
      sleepTimer.sleepTimerEndsAt,
      sleepTimer.sleepTimerRemaining,
    ],
  )

  const remoteItem =
    playerItem?.kind === 'remote'
      ? playerItem.audio
      : playerItem?.kind === 'local'
        ? null
        : remotePlayback.activeAudio
  const openQueueButton = useMemo(
    () => <OpenQueueButton onPress={handleOpenQueue} />,
    [handleOpenQueue],
  )
  const queueActiveKind: QueueEntry['kind'] | null = useMemo(
    () =>
      playback.activeItemId !== null
        ? 'local'
        : remotePlayback.activeAudioId !== null
          ? 'remote'
          : null,
    [playback.activeItemId, remotePlayback.activeAudioId],
  )
  const queueActiveId =
    playback.activeItemId ?? remotePlayback.activeAudioId ?? null
  // Honest Up-next: the entry auto-advance will actually play, or end of
  // queue. Reads the same active queue as the transport and the sheet.
  const upNextEntry = useMemo(
    () =>
      queueActiveKind !== null &&
      queueActiveId !== null &&
      playbackQueue !== null
        ? findNextQueueEntry(
            playbackQueue.entries,
            queueActiveKind,
            queueActiveId,
            playbackQueue.isOnline,
          )
        : null,
    [playbackQueue, queueActiveId, queueActiveKind],
  )
  const upNextTitle = useMemo(
    () =>
      upNextEntry
        ? upNextEntry.kind === 'local'
          ? getAudioItemTitle(upNextEntry.item)
          : upNextEntry.audio.title
        : null,
    [upNextEntry],
  )
  const queueSheet = useMemo(
    () => (isQueueOpen ? <QueueSheet onClose={handleCloseQueue} /> : null),
    [handleCloseQueue, isQueueOpen],
  )

  // All hooks must run unconditionally before any early return: the
  // remote / empty branches below skip rendering (not hooks), otherwise
  // toggling between local and remote surfaces throws "rendered more hooks
  // than during the previous render".
  const isViewingActiveItem = item?.id === activeItemId
  const fadeDistance = Math.max(playerWidth, 1)
  // Per-render Animated interpolation nodes (§P1): memoize so the 2 Hz
  // tick doesn't rebuild them for the whole dock/sheet tree.
  const swipeOpacity = useMemo(
    () =>
      swipeOffset.interpolate({
        inputRange: [-fadeDistance, 0, fadeDistance],
        outputRange: [0, 1, 0],
        extrapolate: 'clamp',
      }),
    [fadeDistance, swipeOffset],
  )

  const handlePlayerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width
    playerWidthRef.current = width
    setPlayerWidth(width)
  }, [])

  const handleScrubStart = useCallback(() => {
    if (!isViewingActiveItem || !item) {
      return
    }

    impactLight()
    wasPlayingBeforeScrubRef.current = playback.isPlaying

    if (playback.isPlaying) {
      return playback.pausePlayback(item)
    }
  }, [isViewingActiveItem, item, playback.isPlaying, playback.pausePlayback])

  const handleScrubEnd = useCallback(() => {
    if (!isViewingActiveItem || !item) {
      return
    }

    const shouldResume = wasPlayingBeforeScrubRef.current
    wasPlayingBeforeScrubRef.current = false

    if (shouldResume) {
      return playback.resumePlayback(item)
    }
  }, [isViewingActiveItem, item, playback.resumePlayback])

  if (remoteItem) {
    return (
      <>
        <RemotePlayerSurface
          audio={remoteItem}
          closePlayer={closePlayer}
          isPlayerOpen={isPlayerOpen && playerItem?.kind === 'remote'}
          onOpenQueue={handleOpenQueue}
          onSkipToNext={skipToNext}
          onSkipToPrevious={skipToPrevious}
          onSwipeToNext={skipToNextPreservingPlayback}
          onSwipeToPrevious={skipToPreviousPreservingPlayback}
          openPlayer={openRemotePlayer}
          remotePlayback={remotePlayback}
          sleepEndsAt={sleepTimer.sleepTimerEndsAt}
          sleepDurationMinutes={sleepTimer.sleepTimerDurationMinutes}
          sleepRemaining={sleepTimer.sleepTimerRemaining}
          endOfEpisodeArmed={endOfEpisodeArmed}
          onSetSleepMinutes={handleSetSleepMinutes}
          onSetEndOfEpisode={handleArmEndOfEpisode}
          onClearSleep={clearSleepTimer}
        />
        {queueSheet}
        {sleepSheet}
      </>
    )
  }

  if (!item) {
    return null
  }

  const duration = isViewingActiveItem
    ? (playback.durationSeconds ?? item.durationSeconds)
    : item.durationSeconds
  const positionSeconds = isViewingActiveItem
    ? playback.currentPositionSeconds
    : item.lastPositionSeconds
  const progress = duration ? Math.min(positionSeconds / duration, 1) : 0
  const activeDuration =
    playback.durationSeconds ?? activeItem?.durationSeconds ?? null
  const activeProgress = activeDuration
    ? Math.min(playback.currentPositionSeconds / activeDuration, 1)
    : 0
  const artworkSize = isLandscape
    ? 160
    : media.short
      ? 220
      : media.compact
        ? 276
        : 340
  const itemTitle = getAudioItemTitle(item)
  const itemMetadataSummary = [
    item.metadata.artist,
    item.metadata.album,
    item.metadata.releaseYear,
  ]
    .filter(Boolean)
    .join(' · ')
  const isDisabled =
    playback.isTransitioning || !playback.isReady || !item.isAvailable
  const isDockDisabled =
    playback.isTransitioning || !playback.isReady || !activeItem?.isAvailable
  return (
    <>
      {activeItem && !isPlayerOpen && (
        <Animated.View
          {...swipeDismissResponder.panHandlers}
          onLayout={handlePlayerLayout}
          style={{
            position: 'absolute',
            zIndex: 50,
            right: Spacing.one,
            bottom: BottomTabInset + Spacing.four,
            left: Spacing.one,
            maxWidth: Math.min(MaxContentWidth, 720),
            height: PlayerDockHeight,
            alignSelf: 'center',
            opacity: swipeOpacity,
            transform: [{ translateX: swipeOffset }],
          }}
        >
          <ThemedView
            type="backgroundElement"
            flex={1}
            overflow="hidden"
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius={Radius.large}
            boxShadow="0 12px 30px rgba(0,0,0,0.28)"
          >
            <XStack
              flex={1}
              alignItems="center"
              gap={Spacing.two}
              padding={Spacing.two}
            >
              <AppButton
                tone="ghost"
                accessibilityLabel={`Open now playing for ${getAudioItemTitle(activeItem)}`}
                accessibilityHint="Drag up to expand the full player"
                onPress={() => openPlayer(activeItem)}
                minWidth={0}
                flex={1}
                justifyContent="flex-start"
                padding={0}
              >
                <EpisodeArtwork
                  imageUrl={activeItem.metadata.coverArtUrl}
                  itemId={activeItem.id}
                  name={getAudioItemTitle(activeItem)}
                  size={54}
                  isBuffering={playback.isTransitioning}
                />
                <YStack flex={1} minWidth={0} alignItems="flex-start">
                  <ThemedText
                    type="episodeTitle"
                    numberOfLines={1}
                    width="100%"
                    maxFontSizeMultiplier={2}
                  >
                    {getAudioItemTitle(activeItem)}
                  </ThemedText>
                  <ThemedText
                    type="metadata"
                    themeColor="textSecondary"
                    numberOfLines={1}
                    maxFontSizeMultiplier={2}
                  >
                    {playback.isTransitioning
                      ? 'Loading…'
                      : playback.isPlaying
                        ? `${formatPlaybackTime(playback.currentPositionSeconds)} · Playing`
                        : 'Paused'}
                  </ThemedText>
                </YStack>
              </AppButton>

              <PlayerIconButton
                accessibilityLabel={playback.isPlaying ? 'Pause' : 'Play'}
                disabled={isDockDisabled}
                icon={playback.isPlaying ? PAUSE_ICON : PLAY_ICON}
                isLoading={playback.isTransitioning}
                onPress={() => {
                  impactLight()
                  playback.togglePlayback(activeItem)
                }}
                tintColor={theme.accentForeground}
              />
            </XStack>
            <View
              position="absolute"
              right={0}
              bottom={0}
              left={0}
              height={3}
              backgroundColor="$backgroundSelected"
            >
              <View
                height="100%"
                width={`${activeProgress * 100}%`}
                backgroundColor="$accent"
              />
            </View>
          </ThemedView>
        </Animated.View>
      )}

      <PlayerSheet
        visible={isPlayerOpen}
        onClose={closePlayer}
        header={
          <>
            <XStack
              alignItems="center"
              justifyContent="space-between"
              paddingHorizontal={Spacing.three}
              paddingVertical={Spacing.two}
            >
              <AppButton
                tone="icon"
                accessibilityLabel="Close now playing"
                accessibilityHint="Collapses the player back to the mini dock"
                onPress={closePlayer}
              >
                <SymbolView
                  name={CLOSE_ICON}
                  size={24}
                  tintColor={theme.text}
                  weight="semibold"
                />
              </AppButton>
              <YStack alignItems="center">
                <ThemedText type="eyebrow" themeColor="accent">
                  Now playing
                </ThemedText>
                <ThemedText
                  type="metadata"
                  themeColor="textSecondary"
                  maxFontSizeMultiplier={2}
                >
                  Podcast Me
                </ThemedText>
              </YStack>
              <View width={44} />
            </XStack>

            {openQueueButton}
          </>
        }
        footer={
          <YStack gap={Spacing.two}>
            {localStalled && <StallNotice onRetry={handleRetryLocalPlayback} />}
            <AudioPlaybackSlider
              accessibilityLabel={`${itemTitle} playback position`}
              // Local files are fully on disk and expo-audio exposes no
              // buffered position: null hides the buffered layer (honest).
              bufferedSeconds={null}
              disabled={isDisabled || duration === null || !isViewingActiveItem}
              durationSeconds={duration}
              onScrubEnd={handleScrubEnd}
              onScrubStart={handleScrubStart}
              onSeekTo={playback.seekTo}
              positionSeconds={positionSeconds}
            />
            {playback.playbackError?.itemId === item.id && (
              <XStack
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                alignItems="center"
                justifyContent="space-between"
                gap={Spacing.two}
                width="100%"
              >
                <ThemedText
                  type="metadata"
                  color="$danger"
                  flex={1}
                  flexShrink={1}
                >
                  {playback.playbackError.message}
                </ThemedText>
                <AppButton
                  tone="secondary"
                  accessibilityLabel={`Retry ${itemTitle}`}
                  accessibilityHint="Restarts loading the current episode"
                  onPress={handleRetryLocalPlayback}
                  minHeight={44}
                  flexShrink={0}
                >
                  <ThemedText type="smallBold">Retry</ThemedText>
                </AppButton>
              </XStack>
            )}

            <XStack
              width="100%"
              alignItems="center"
              justifyContent="space-around"
            >
              <SkipButton
                accessibilityLabel="Previous episode"
                disabled={isDisabled || !isViewingActiveItem}
                icon={PREV_ICON}
                onPress={() => {
                  impactLight()
                  skipToPrevious()
                }}
                tintColor={theme.text}
              />
              <TransportButton
                accessibilityLabel="Rewind 15 seconds"
                accessibilityHint={
                  (duration ?? 0) > 3_600
                    ? 'Long-press to rewind 60 seconds on this long episode'
                    : 'Long-press to rewind 30 seconds'
                }
                disabled={isDisabled || !isViewingActiveItem}
                label="15"
                icon={REWIND_ICON}
                onPress={() => {
                  impactLight()
                  playback.seekBy(-15)
                }}
                onLongPress={() => {
                  impactLight()
                  playback.seekBy(-getLongPressSeekSeconds(duration))
                }}
                tintColor={theme.text}
              />
              <PlayerIconButton
                large
                accessibilityLabel={
                  isViewingActiveItem && playback.isPlaying ? 'Pause' : 'Play'
                }
                disabled={isDisabled}
                icon={
                  isViewingActiveItem && playback.isPlaying
                    ? PAUSE_ICON
                    : PLAY_ICON
                }
                isLoading={isViewingActiveItem && playback.isTransitioning}
                onPress={() => {
                  impactLight()
                  playback.togglePlayback(item)
                }}
                tintColor={theme.accentForeground}
              />
              <TransportButton
                accessibilityLabel="Forward 15 seconds"
                accessibilityHint={
                  (duration ?? 0) > 3_600
                    ? 'Long-press to jump forward 60 seconds on this long episode'
                    : 'Long-press to jump forward 30 seconds'
                }
                disabled={isDisabled || !isViewingActiveItem}
                label="15"
                icon={FORWARD_ICON}
                onPress={() => {
                  impactLight()
                  playback.seekBy(15)
                }}
                onLongPress={() => {
                  impactLight()
                  playback.seekBy(getLongPressSeekSeconds(duration))
                }}
                tintColor={theme.text}
              />
              <SkipButton
                accessibilityLabel="Next episode"
                disabled={isDisabled || !isViewingActiveItem}
                icon={NEXT_ICON}
                onPress={() => {
                  impactLight()
                  skipToNext()
                }}
                tintColor={theme.text}
              />
            </XStack>
            <LongPressHint visible={(duration ?? 0) > 3_600} />

            <XStack
              width="100%"
              alignItems="center"
              justifyContent="space-between"
              gap={Spacing.two}
            >
              <XStack alignItems="center" gap={Spacing.two} flexShrink={0}>
                <AppButton
                  tone="secondary"
                  accessibilityLabel={`Playback speed ${playback.playbackRate} times`}
                  accessibilityHint="Opens speed options from half to triple speed"
                  onPress={() => setIsSpeedOpen(true)}
                >
                  <ThemedText type="smallBold">
                    {playback.playbackRate}× speed
                  </ThemedText>
                </AppButton>
                <SleepTriggerButton
                  active={sleepIsActive}
                  label={sleepTriggerLabel}
                  onPress={handleOpenSleep}
                />
              </XStack>
              <YStack alignItems="flex-end" flexShrink={1}>
                <ThemedText
                  type="metadata"
                  themeColor="textSecondary"
                  maxFontSizeMultiplier={2}
                >
                  Up next
                </ThemedText>
                <ThemedText
                  type="smallBold"
                  numberOfLines={1}
                  maxWidth={200}
                  maxFontSizeMultiplier={2}
                  accessibilityLabel={
                    upNextTitle ? `Up next: ${upNextTitle}` : 'End of queue'
                  }
                >
                  {upNextTitle ?? 'End of queue'}
                </ThemedText>
              </YStack>
            </XStack>
          </YStack>
        }
      >
        <YStack
          width="100%"
          maxWidth={640}
          flex={1}
          alignItems="center"
          gap={
            isLandscape ? Spacing.two : media.short ? Spacing.three : Spacing.four
          }
          paddingHorizontal={isLandscape ? Spacing.three : Spacing.four}
          paddingTop={
            isLandscape ? Spacing.two : media.short ? Spacing.one : Spacing.three
          }
        >
          <SwipeableArtwork
            itemTitle={itemTitle}
            onSwipeLeft={() => skipToNextPreservingPlayback()}
            onSwipeRight={() => skipToPreviousPreservingPlayback()}
          >
            <ThemedView
              type="backgroundElement"
              padding={Spacing.three}
              borderRadius={Radius.large}
              borderWidth={1}
              borderColor="$borderColor"
              boxShadow="0 22px 50px rgba(0,0,0,0.28)"
            >
              <EpisodeArtwork
                imageUrl={item.metadata.coverArtUrl}
                itemId={item.id}
                name={itemTitle}
                size={artworkSize}
                isBuffering={isViewingActiveItem && playback.isTransitioning}
              />
            </ThemedView>
          </SwipeableArtwork>

          <YStack width="100%" alignItems="center" gap={Spacing.one}>
            <ThemedText
              type="heading"
              textAlign="center"
              numberOfLines={3}
              $compact={{ fontSize: 22, lineHeight: 28 }}
            >
              {itemTitle}
            </ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              {itemMetadataSummary ||
                `Local recording · ${formatEpisodeDate(item.addedAt)}`}
            </ThemedText>
            <XStack
              alignItems="center"
              gap={Spacing.one}
              marginTop={Spacing.one}
            >
              <View
                width={7}
                height={7}
                borderRadius={7}
                backgroundColor="$success"
              />
              <ThemedText type="metadata" themeColor="textSecondary">
                Downloaded
              </ThemedText>
            </XStack>
          </YStack>
        </YStack>
      </PlayerSheet>
      {isSpeedOpen && (
        <SpeedSheet
          currentRate={playback.playbackRate}
          onClose={() => setIsSpeedOpen(false)}
          onSelect={(rate) => {
            playback.setPlaybackRate(rate, getShowKey(item.metadata))
            setIsSpeedOpen(false)
          }}
        />
      )}
      {sleepSheet}
      {queueSheet}
    </>
  )
}

type RemotePlayerSurfaceProps = {
  audio: RemoteAudio
  closePlayer: () => void
  isPlayerOpen: boolean
  onOpenQueue: () => void
  onSkipToNext: () => void
  onSkipToPrevious: () => void
  onSwipeToNext: () => boolean
  onSwipeToPrevious: () => boolean
  openPlayer: (audio: RemoteAudio) => void
  sleepEndsAt: number | null
  sleepDurationMinutes: number | null
  sleepRemaining: string | null
  endOfEpisodeArmed: boolean
  onSetSleepMinutes: (minutes: number) => void
  onSetEndOfEpisode: () => void
  onClearSleep: () => void
  remotePlayback: {
    activeAudio: RemoteAudio | null
    currentPositionSeconds: number
    durationSeconds: number | null
    isBuffering: boolean
    isPlaying: boolean
    isTransitioning: boolean
    isUsingCachedSource: boolean
    playbackError: { audioId: string; message: string } | null
    playbackRate: number
    pausePlayback: (audio: RemoteAudio) => void
    resumePlayback: (audio: RemoteAudio) => void
    retryPlayback: () => void
    seekBy: (offsetSeconds: number) => void
    seekTo: (positionSeconds: number) => Promise<void>
    setPlaybackRate: (rate: number, showKey?: string | null) => void
    togglePlayback: (audio: RemoteAudio) => void
  }
}

function RemotePlayerSurface({
  audio,
  closePlayer,
  isPlayerOpen,
  onOpenQueue,
  onSkipToNext,
  onSkipToPrevious,
  onSwipeToNext,
  onSwipeToPrevious,
  openPlayer,
  remotePlayback,
  sleepEndsAt,
  sleepDurationMinutes,
  sleepRemaining,
  endOfEpisodeArmed,
  onSetSleepMinutes,
  onSetEndOfEpisode,
  onClearSleep,
}: RemotePlayerSurfaceProps) {
  const media = useMedia()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const isLandscape = windowWidth > windowHeight
  const theme = useTheme()
  const wasPlayingBeforeScrubRef = useRef(false)
  const [isSpeedOpen, setIsSpeedOpen] = useState(false)
  const [isSleepOpen, setIsSleepOpen] = useState(false)
  const sleepActive = sleepEndsAt !== null || endOfEpisodeArmed
  const sleepLabel =
    sleepRemaining ?? (endOfEpisodeArmed ? 'End of episode' : 'Sleep')
  const isActive = remotePlayback.activeAudio?.id === audio.id
  const duration = isActive ? remotePlayback.durationSeconds : null
  const positionSeconds = isActive ? remotePlayback.currentPositionSeconds : 0
  const progress = duration ? Math.min(positionSeconds / duration, 1) : 0
  const isDisabled = remotePlayback.isTransitioning || !isActive
  const [remoteRetryToken, setRemoteRetryToken] = useState(0)
  const remoteStalled = useStalled(
    isActive && (remotePlayback.isTransitioning || remotePlayback.isBuffering),
    STALL_NOTICE_DELAY_MS,
    remoteRetryToken,
  )

  const handleRetryRemotePlayback = () => {
    impactLight()
    setRemoteRetryToken((token) => token + 1)
    remotePlayback.retryPlayback()
  }
  const artworkSize = isLandscape
    ? 160
    : media.short
      ? 220
      : media.compact
        ? 276
        : 340
  const imageUrl = getRemoteAudioCoverArtUrl(audio.metadata)
  const error =
    remotePlayback.playbackError?.audioId === audio.id
      ? remotePlayback.playbackError.message
      : null

  const handleScrubStart = () => {
    impactLight()
    wasPlayingBeforeScrubRef.current = remotePlayback.isPlaying

    if (remotePlayback.isPlaying) {
      remotePlayback.pausePlayback(audio)
    }
  }

  const handleScrubEnd = () => {
    if (wasPlayingBeforeScrubRef.current) {
      remotePlayback.resumePlayback(audio)
    }

    wasPlayingBeforeScrubRef.current = false
  }

  // Drag dock-up expands the collapsed remote dock into the sheet.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const dockExpandResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !isPlayerOpen &&
          gesture.dy <= -SWIPE_INTENT_DISTANCE &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (
            gesture.dy <= -DOCK_EXPAND_DISTANCE &&
            Math.abs(gesture.dy) > Math.abs(gesture.dx)
          ) {
            impactLight()
            openPlayer(audio)
          }
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [audio, isPlayerOpen, openPlayer],
  )

  return (
    <>
      {remotePlayback.activeAudio && !isPlayerOpen && (
        <Animated.View
          {...dockExpandResponder.panHandlers}
          style={{
            position: 'absolute',
            zIndex: 50,
            right: Spacing.one,
            bottom: BottomTabInset + Spacing.four,
            left: Spacing.one,
            maxWidth: Math.min(MaxContentWidth, 720),
            height: PlayerDockHeight,
            alignSelf: 'center',
          }}
        >
          <ThemedView
            flex={1}
            overflow="hidden"
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius={Radius.large}
            boxShadow="0 12px 30px rgba(0,0,0,0.28)"
          >
            <XStack
              flex={1}
              alignItems="center"
              gap={Spacing.two}
              padding={Spacing.two}
            >
              <AppButton
                tone="ghost"
                accessibilityLabel={`Open now playing for ${audio.title}`}
                accessibilityHint="Drag up to expand the full player"
                onPress={() => openPlayer(audio)}
                minWidth={0}
                flex={1}
                justifyContent="flex-start"
                padding={0}
              >
                <EpisodeArtwork
                  imageUrl={imageUrl}
                  itemId={`remote-${audio.id}`}
                  name={audio.title}
                  size={54}
                  isBuffering={remotePlayback.isTransitioning}
                />
                <YStack flex={1} minWidth={0} alignItems="flex-start">
                  <ThemedText
                    type="episodeTitle"
                    numberOfLines={1}
                    width="100%"
                    maxFontSizeMultiplier={2}
                  >
                    {audio.title}
                  </ThemedText>
                  <ThemedText
                    type="metadata"
                    themeColor="textSecondary"
                    numberOfLines={1}
                    maxFontSizeMultiplier={2}
                  >
                    {remotePlayback.isTransitioning
                      ? 'Loading remote stream…'
                      : remotePlayback.isPlaying
                        ? `${formatPlaybackTime(positionSeconds)} · Playing`
                        : 'Paused'}
                  </ThemedText>
                </YStack>
              </AppButton>
              <PlayerIconButton
                accessibilityLabel={remotePlayback.isPlaying ? 'Pause' : 'Play'}
                disabled={remotePlayback.isTransitioning}
                icon={remotePlayback.isPlaying ? PAUSE_ICON : PLAY_ICON}
                isLoading={remotePlayback.isTransitioning}
                onPress={() => {
                  impactLight()
                  remotePlayback.togglePlayback(audio)
                }}
                tintColor={theme.accentForeground}
              />
            </XStack>
            <View
              position="absolute"
              right={0}
              bottom={0}
              left={0}
              height={3}
              backgroundColor="$backgroundSelected"
            >
              <View
                height="100%"
                width={`${progress * 100}%`}
                backgroundColor="$accent"
              />
            </View>
          </ThemedView>
        </Animated.View>
      )}

      <PlayerSheet
        visible={isPlayerOpen}
        onClose={closePlayer}
        header={
          <>
            <XStack
              alignItems="center"
              justifyContent="space-between"
              paddingHorizontal={Spacing.three}
              paddingVertical={Spacing.two}
            >
              <AppButton
                tone="icon"
                accessibilityLabel="Close now playing"
                accessibilityHint="Collapses the player back to the mini dock"
                onPress={closePlayer}
              >
                <SymbolView
                  name={CLOSE_ICON}
                  size={24}
                  tintColor={theme.text}
                  weight="semibold"
                />
              </AppButton>
              <YStack alignItems="center">
                <ThemedText type="eyebrow" themeColor="accent">
                  Now playing
                </ThemedText>
                <ThemedText
                  type="metadata"
                  themeColor="textSecondary"
                  maxFontSizeMultiplier={2}
                >
                  Remote library
                </ThemedText>
              </YStack>
              <View width={44} />
            </XStack>

            <OpenQueueButton onPress={onOpenQueue} />
          </>
        }
        footer={
          <YStack gap={Spacing.two}>
            {remoteStalled && (
              <StallNotice onRetry={handleRetryRemotePlayback} />
            )}
            <AudioPlaybackSlider
              accessibilityLabel={`${audio.title} playback position`}
              // expo-audio exposes `isBuffering` but no buffered position:
              // null hides the buffered layer instead of faking it.
              bufferedSeconds={null}
              disabled={isDisabled || duration === null}
              durationSeconds={duration}
              onScrubEnd={handleScrubEnd}
              onScrubStart={handleScrubStart}
              onSeekTo={remotePlayback.seekTo}
              positionSeconds={positionSeconds}
            />
            {error ? (
              <XStack
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                alignItems="center"
                justifyContent="space-between"
                gap={Spacing.two}
                width="100%"
              >
                <ThemedText
                  type="metadata"
                  color="$danger"
                  flex={1}
                  flexShrink={1}
                >
                  {error}
                </ThemedText>
                <AppButton
                  tone="secondary"
                  accessibilityLabel={`Retry ${audio.title}`}
                  accessibilityHint="Restarts loading the current episode"
                  onPress={handleRetryRemotePlayback}
                  minHeight={44}
                  flexShrink={0}
                >
                  <ThemedText type="smallBold">Retry</ThemedText>
                </AppButton>
              </XStack>
            ) : null}

            <XStack
              width="100%"
              alignItems="center"
              justifyContent="space-around"
            >
              <SkipButton
                accessibilityLabel="Previous episode"
                disabled={isDisabled}
                icon={PREV_ICON}
                onPress={() => {
                  impactLight()
                  onSkipToPrevious()
                }}
                tintColor={theme.text}
              />
              <TransportButton
                accessibilityLabel="Rewind 15 seconds"
                accessibilityHint={
                  (duration ?? 0) > 3_600
                    ? 'Long-press to rewind 60 seconds on this long episode'
                    : 'Long-press to rewind 30 seconds'
                }
                disabled={isDisabled}
                label="15"
                icon={REWIND_ICON}
                onPress={() => {
                  impactLight()
                  remotePlayback.seekBy(-15)
                }}
                onLongPress={() => {
                  impactLight()
                  remotePlayback.seekBy(-getLongPressSeekSeconds(duration))
                }}
                tintColor={theme.text}
              />
              <PlayerIconButton
                large
                accessibilityLabel={remotePlayback.isPlaying ? 'Pause' : 'Play'}
                disabled={remotePlayback.isTransitioning}
                icon={remotePlayback.isPlaying ? PAUSE_ICON : PLAY_ICON}
                isLoading={isActive && remotePlayback.isTransitioning}
                onPress={() => {
                  impactLight()
                  remotePlayback.togglePlayback(audio)
                }}
                tintColor={theme.accentForeground}
              />
              <TransportButton
                accessibilityLabel="Forward 15 seconds"
                accessibilityHint={
                  (duration ?? 0) > 3_600
                    ? 'Long-press to jump forward 60 seconds on this long episode'
                    : 'Long-press to jump forward 30 seconds'
                }
                disabled={isDisabled}
                label="15"
                icon={FORWARD_ICON}
                onPress={() => {
                  impactLight()
                  remotePlayback.seekBy(15)
                }}
                onLongPress={() => {
                  impactLight()
                  remotePlayback.seekBy(getLongPressSeekSeconds(duration))
                }}
                tintColor={theme.text}
              />
              <SkipButton
                accessibilityLabel="Next episode"
                disabled={isDisabled}
                icon={NEXT_ICON}
                onPress={() => {
                  impactLight()
                  onSkipToNext()
                }}
                tintColor={theme.text}
              />
            </XStack>
            <LongPressHint visible={(duration ?? 0) > 3_600} />

            <XStack
              width="100%"
              alignItems="center"
              gap={Spacing.two}
            >
              <AppButton
                tone="secondary"
                accessibilityLabel={`Playback speed ${remotePlayback.playbackRate} times`}
                accessibilityHint="Opens speed options from half to triple speed"
                onPress={() => setIsSpeedOpen(true)}
              >
                <ThemedText type="smallBold">
                  {remotePlayback.playbackRate}× speed
                </ThemedText>
              </AppButton>
              <SleepTriggerButton
                active={sleepActive}
                label={sleepLabel}
                onPress={() => {
                  impactLight()
                  setIsSleepOpen(true)
                }}
              />
            </XStack>
          </YStack>
        }
      >
        <YStack
          width="100%"
          maxWidth={640}
          flex={1}
          alignItems="center"
          gap={
            isLandscape ? Spacing.two : media.short ? Spacing.three : Spacing.four
          }
          paddingHorizontal={isLandscape ? Spacing.three : Spacing.four}
          paddingTop={
            isLandscape ? Spacing.two : media.short ? Spacing.one : Spacing.three
          }
        >
          <SwipeableArtwork
            itemTitle={audio.title}
            onSwipeLeft={onSwipeToNext}
            onSwipeRight={onSwipeToPrevious}
          >
            <ThemedView
              type="backgroundElement"
              padding={Spacing.three}
              borderRadius={Radius.large}
              borderWidth={1}
              borderColor="$borderColor"
              boxShadow="0 22px 50px rgba(0,0,0,0.28)"
            >
              <EpisodeArtwork
                imageUrl={imageUrl}
                itemId={`remote-${audio.id}`}
                name={audio.title}
                size={artworkSize}
                isBuffering={isActive && remotePlayback.isTransitioning}
              />
            </ThemedView>
          </SwipeableArtwork>

          <YStack width="100%" alignItems="center" gap={Spacing.one}>
            <ThemedText
              type="heading"
              textAlign="center"
              numberOfLines={3}
              $compact={{ fontSize: 22, lineHeight: 28 }}
            >
              {audio.title}
            </ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              {remotePlayback.isUsingCachedSource
                ? 'Cached audio · Available offline'
                : 'Remote stream · Caching for offline playback'}
            </ThemedText>
            <XStack
              alignItems="center"
              gap={Spacing.one}
              marginTop={Spacing.one}
            >
              <View
                width={7}
                height={7}
                borderRadius={7}
                backgroundColor="$accent"
              />
              <ThemedText type="metadata" themeColor="textSecondary">
                Streaming
              </ThemedText>
            </XStack>
          </YStack>
        </YStack>
      </PlayerSheet>
      {isSpeedOpen && (
        <SpeedSheet
          currentRate={remotePlayback.playbackRate}
          onClose={() => setIsSpeedOpen(false)}
          onSelect={(rate) => {
            remotePlayback.setPlaybackRate(rate, getShowKey(audio.metadata))
            setIsSpeedOpen(false)
          }}
        />
      )}
      {isSleepOpen && (
        <SleepTimerSheet
          endsAt={sleepEndsAt}
          durationMinutes={sleepDurationMinutes}
          remaining={sleepRemaining}
          endOfEpisodeArmed={endOfEpisodeArmed}
          onSetMinutes={(minutes) => {
            onSetSleepMinutes(minutes)
            setIsSleepOpen(false)
          }}
          onSetEndOfEpisode={() => {
            onSetEndOfEpisode()
            setIsSleepOpen(false)
          }}
          onClear={() => {
            onClearSleep()
            setIsSleepOpen(false)
          }}
          onClose={() => setIsSleepOpen(false)}
        />
      )}
    </>
  )
}

type PlayerIconButtonProps = {
  accessibilityLabel: string
  disabled: boolean
  icon: SymbolViewProps['name']
  large?: boolean
  isLoading?: boolean
  onPress: () => void
  tintColor: string
}

const PlayerIconButton = memo(function PlayerIconButton({
  accessibilityLabel,
  disabled,
  icon,
  large = false,
  isLoading = false,
  onPress,
  tintColor,
}: PlayerIconButtonProps) {
  return (
    <AppButton
      tone={large ? 'player' : 'icon'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: isLoading, disabled: disabled || isLoading }}
      disabled={disabled || isLoading}
      onPress={onPress}
      backgroundColor="$accent"
    >
      {isLoading ? (
        <Spinner
          size="small"
          color="$accentForeground"
          accessibilityLabel="Loading audio"
        />
      ) : (
        <SymbolView
          name={icon}
          size={large ? 32 : 23}
          tintColor={tintColor}
          weight="bold"
        />
      )}
    </AppButton>
  )
})

/**
 * Compact Spotify-style sleep trigger pinned next to the transport: a moon
 * pill showing `Sleep` when idle or the live remaining label
 * (`5m left`, `End of episode`) when armed. Opens the sleep timer sheet.
 */
const SleepTriggerButton = memo(function SleepTriggerButton({
  active,
  label,
  onPress,
}: {
  active: boolean
  label: string
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <AppButton
      tone="secondary"
      accessibilityLabel={
        active
          ? `Sleep timer ${label}, open sleep timer options`
          : 'Open sleep timer options'
      }
      accessibilityHint="Choose when playback should pause"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      minHeight={44}
      paddingHorizontal={Spacing.three}
      borderColor={active ? '$accent' : '$backgroundSelected'}
      backgroundColor={active ? '$accentSubtle' : '$backgroundSelected'}
    >
      <SymbolView
        name={SLEEP_ICON}
        size={16}
        tintColor={active ? theme.accent : theme.textSecondary}
        weight="semibold"
      />
      <ThemedText
        type="smallBold"
        color={active ? theme.accent : theme.text}
        maxFontSizeMultiplier={2}
      >
        {label}
      </ThemedText>
    </AppButton>
  )
})

/**
 * Stall notice pinned above the transport when a load or buffer never
 * resolves within ~8s. Retry restarts the current load through the same
 * path toggle-playback uses after an error.
 */
const StallNotice = memo(function StallNotice({
  onRetry,
}: {
  onRetry: () => void
}) {
  return (
    <XStack
      accessibilityRole="alert"
      alignItems="center"
      justifyContent="space-between"
      gap={Spacing.two}
      width="100%"
      paddingVertical={Spacing.two}
      paddingLeft={Spacing.three}
      paddingRight={Spacing.two}
      borderWidth={1}
      borderColor="$warning"
      borderRadius={Radius.medium}
      backgroundColor="$backgroundSelected"
    >
      <ThemedText type="smallBold" flex={1} flexShrink={1}>
        Stalled — Check connection
      </ThemedText>
      <AppButton
        tone="secondary"
        accessibilityLabel="Retry playback"
        accessibilityHint="Restarts loading the current episode"
        onPress={onRetry}
        minHeight={44}
      >
        <ThemedText type="smallBold">Retry</ThemedText>
      </AppButton>
    </XStack>
  )
})

/**
 * 44×44 Prev/Next queue control (`tone="icon"` is 44×44). TalkBack/VoiceOver
 * announce "Previous episode" / "Next episode" via `accessibilityLabel`.
 */
const SkipButton = memo(function SkipButton(props: PlayerIconButtonProps) {
  return (
    <AppButton
      tone="icon"
      accessibilityLabel={props.accessibilityLabel}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <SymbolView
        name={props.icon}
        size={28}
        tintColor={props.tintColor}
        weight="semibold"
      />
    </AppButton>
  )
})

/**
 * Opens the queue sheet from inside the full-player Modal, replacing the
 * old inline now-playing banner.
 */
const OpenQueueButton = memo(function OpenQueueButton({
  onPress,
}: {
  onPress: () => void
}) {
  const theme = useTheme()

  return (
    <View
      paddingHorizontal={Spacing.three}
      paddingBottom={Spacing.two}
      alignItems="center"
    >
      <AppButton
        tone="outlined"
        accessibilityLabel="Open queue"
        accessibilityHint="Shows what is playing and what plays next"
        onPress={onPress}
        minHeight={44}
      >
        <SymbolView
          name={QUEUE_ICON}
          size={20}
          tintColor={theme.text}
          weight="semibold"
        />
        <ThemedText type="smallBold">Open queue</ThemedText>
      </AppButton>
    </View>
  )
})

/**
 * ±15s transport with long-press acceleration: a long-press jumps ±60s on
 * long-form episodes (> 60 min) where 15s steps feel slow. `formatPlaybackTime`
 * already keeps `h:mm:ss` for those files, so the time labels stay honest.
 */
const TransportButton = memo(function TransportButton({
  label,
  onLongPress,
  accessibilityHint,
  ...props
}: PlayerIconButtonProps & {
  label: string
  onLongPress?: () => void
  accessibilityHint?: string
}) {
  return (
    <YStack alignItems="center" gap={Spacing.one}>
      <AppButton
        tone="icon"
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={
          accessibilityHint ??
          'Long-press to jump 60 seconds on episodes over an hour'
        }
        disabled={props.disabled}
        onPress={props.onPress}
        onLongPress={onLongPress}
      >
        <SymbolView
          name={props.icon}
          size={28}
          tintColor={props.tintColor}
          weight="semibold"
        />
      </AppButton>
      <ThemedText type="metadata" themeColor="textSecondary">
        {label} sec
      </ThemedText>
    </YStack>
  )
})

const LongPressHint = memo(function LongPressHint({
  visible,
}: {
  visible: boolean
}) {
  if (!visible) {
    return null
  }

  return (
    <ThemedText
      type="metadata"
      themeColor="textSecondary"
      textAlign="center"
      maxFontSizeMultiplier={2}
    >
      Tip: long-press −15s / +15s to jump ∓60s on long episodes
    </ThemedText>
  )
})

/** Long-press jumps a full minute on long-form audio, 30s otherwise. */
function getLongPressSeekSeconds(durationSeconds: number | null): number {
  return durationSeconds !== null && durationSeconds > 3_600 ? 60 : 30
}

function getRemoteAudioCoverArtUrl(metadata: unknown): string | null {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return null
  }

  const coverArtUrl = (metadata as Record<string, unknown>).coverArtUrl

  return typeof coverArtUrl === 'string' &&
    /^https:\/\//i.test(coverArtUrl.trim())
    ? coverArtUrl.trim()
    : null
}

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
const CLOSE_ICON: SymbolViewProps['name'] = {
  ios: 'chevron.down',
  android: 'keyboard_arrow_down',
  web: 'keyboard_arrow_down',
}
const DOCK_STOP_ICON: SymbolViewProps['name'] = {
  ios: 'xmark',
  android: 'close',
  web: 'close',
}
const QUEUE_ICON: SymbolViewProps['name'] = {
  ios: 'list.bullet',
  android: 'list',
  web: 'list',
}
const REWIND_ICON: SymbolViewProps['name'] = {
  ios: 'gobackward.15',
  android: 'replay_10',
  web: 'replay_10',
}
const FORWARD_ICON: SymbolViewProps['name'] = {
  ios: 'goforward.15',
  android: 'forward_10',
  web: 'forward_10',
}
const PREV_ICON: SymbolViewProps['name'] = {
  ios: 'backward.end.fill',
  android: 'skip_previous',
  web: 'skip_previous',
}
const NEXT_ICON: SymbolViewProps['name'] = {
  ios: 'forward.end.fill',
  android: 'skip_next',
  web: 'skip_next',
}
const SLEEP_ICON: SymbolViewProps['name'] = {
  ios: 'moon.zzz.fill',
  android: 'bedtime',
  web: 'bedtime',
}
