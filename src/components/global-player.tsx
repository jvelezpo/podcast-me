import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  PanResponder,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, XStack, YStack, useMedia } from 'tamagui'

import { AudioPlaybackSlider } from '@/components/audio-playback-slider'
import { EpisodeArtwork } from '@/components/episode-artwork'
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
import { useTheme } from '@/hooks/use-theme'
import type { RemoteAudio } from '@/services/api'
import {
  formatEpisodeDate,
  formatPlaybackTime,
  getEpisodeTitle,
} from '@/utils/audio-display'

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const
const SLEEP_TIMER_OPTIONS = [
  { label: '5m', minutes: 5 },
  { label: '10m', minutes: 10 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
] as const
const ONE_MINUTE_MS = 60_000
const SWIPE_DISMISS_FRACTION = 0.35
const SWIPE_DISMISS_MIN_DISTANCE = 72
const SWIPE_DISMISS_VELOCITY = 0.65
const SWIPE_INTENT_DISTANCE = 10

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
  const [sleepTimerEndsAt, setSleepTimerEndsAt] = useState<number | null>(null)
  const [sleepTimerDurationMinutes, setSleepTimerDurationMinutes] = useState<
    number | null
  >(null)
  const [sleepTimerRemainingMs, setSleepTimerRemainingMs] = useState<
    number | null
  >(null)
  const activeItemIdRef = useRef<string | null>(null)
  const canSwipeRef = useRef(false)
  const dismissPlayerRef = useRef(playback.dismissPlayer)
  const isDismissingRef = useRef(false)
  const playerWidthRef = useRef(0)
  const wasPlayingBeforeScrubRef = useRef(false)
  const sleepTimerPlaybackRef = useRef({
    isPlaying: playback.isPlaying,
    item: activeItem,
    pausePlayback: playback.pausePlayback,
  })
  const swipeOffset = useRef(new Animated.Value(0)).current
  const media = useMedia()
  const theme = useTheme()
  const activeItemId = activeItem?.id ?? null

  useEffect(() => {
    sleepTimerPlaybackRef.current = {
      isPlaying: playback.isPlaying,
      item: activeItem,
      pausePlayback: playback.pausePlayback,
    }
  }, [activeItem, playback.isPlaying, playback.pausePlayback])

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

        const currentPlayback = sleepTimerPlaybackRef.current
        if (currentPlayback.isPlaying && currentPlayback.item) {
          void currentPlayback.pausePlayback(currentPlayback.item)
        }
        return
      }

      setSleepTimerRemainingMs(remainingMs)
    }

    const interval = setInterval(updateSleepTimer, 1_000)
    return () => clearInterval(interval)
  }, [sleepTimerEndsAt])

  useEffect(() => {
    activeItemIdRef.current = activeItemId
    canSwipeRef.current =
      activeItemId !== null &&
      !isPlayerOpen &&
      !playback.isTransitioning &&
      !isDismissingRef.current
    dismissPlayerRef.current = playback.dismissPlayer
  }, [
    activeItemId,
    isPlayerOpen,
    playback.dismissPlayer,
    playback.isTransitioning,
  ])

  useEffect(() => {
    isDismissingRef.current = false
    swipeOffset.setValue(0)
  }, [activeItemId, swipeOffset])

  // Playback status updates frequently, so the responder reads current state from refs.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const swipeDismissResponder = useMemo(() => {
    const restorePlayer = () => {
      isDismissingRef.current = false
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
    ) =>
      canSwipeRef.current &&
      Math.abs(gesture.dx) >= SWIPE_INTENT_DISTANCE &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy)

    // PanResponder stores these callbacks and invokes them only for touch events.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponder: shouldClaimSwipe,
      onMoveShouldSetPanResponderCapture: shouldClaimSwipe,
      onPanResponderGrant: () => swipeOffset.stopAnimation(),
      onPanResponderMove: (_event, gesture) => swipeOffset.setValue(gesture.dx),
      onPanResponderRelease: (_event, gesture) => {
        const dismissDistance = Math.max(
          SWIPE_DISMISS_MIN_DISTANCE,
          playerWidthRef.current * SWIPE_DISMISS_FRACTION,
        )
        const movedFarEnough = Math.abs(gesture.dx) >= dismissDistance
        const movedFastEnough = Math.abs(gesture.vx) >= SWIPE_DISMISS_VELOCITY

        if (
          !canSwipeRef.current ||
          !activeItemIdRef.current ||
          (!movedFarEnough && !movedFastEnough)
        ) {
          restorePlayer()
          return
        }

        isDismissingRef.current = true
        canSwipeRef.current = false
        const direction = gesture.dx < 0 ? -1 : 1
        const target = direction * (playerWidthRef.current + Spacing.four)

        Animated.timing(swipeOffset, {
          toValue: target,
          duration: 180,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) {
            restorePlayer()
            return
          }

          void dismissPlayerRef
            .current()
            .then((didDismiss) => {
              if (!didDismiss) {
                restorePlayer()
              }
            })
            .catch(restorePlayer)
        })
      },
      onPanResponderTerminate: restorePlayer,
      onPanResponderTerminationRequest: () => true,
    })
  }, [swipeOffset])

  const remoteItem =
    playerItem?.kind === 'remote'
      ? playerItem.audio
      : playerItem?.kind === 'local'
        ? null
        : remotePlayback.activeAudio
  const remotePlayingAudio = remotePlayback.isPlaying
    ? remotePlayback.activeAudio
    : null
  const localPlayingBanner =
    activeItem && playback.isPlaying ? (
      <CurrentlyPlayingBanner
        disabled={
          playback.isTransitioning ||
          !playback.isReady ||
          !activeItem.isAvailable
        }
        itemId={activeItem.id}
        name={activeItem.originalName}
        onOpen={() => openPlayer(activeItem)}
        onToggle={() => playback.togglePlayback(activeItem)}
        tintColor={theme.accent}
        title={getEpisodeTitle(activeItem.originalName)}
      />
    ) : null
  const isViewingPlayingAudio =
    isPlayerOpen &&
    (remotePlayingAudio
      ? playerItem?.kind === 'remote' &&
        remotePlayingAudio.id === playerItem.audio.id
      : playerItem?.kind === 'local' &&
        activeItem?.id === playerItem.item.id &&
        playback.isPlaying)
  const playingBanner = isViewingPlayingAudio
    ? null
    : remotePlayingAudio
      ? (
          <CurrentlyPlayingBanner
            disabled={remotePlayback.isTransitioning}
            itemId={`remote-${remotePlayingAudio.id}`}
            name={remotePlayingAudio.title}
            onOpen={() => openRemotePlayer(remotePlayingAudio)}
            onToggle={() => remotePlayback.togglePlayback(remotePlayingAudio)}
            tintColor={theme.accent}
            title={remotePlayingAudio.title}
          />
        )
      : localPlayingBanner

  if (remoteItem) {
    return (
      <RemotePlayerSurface
        audio={remoteItem}
        closePlayer={closePlayer}
        isPlayerOpen={isPlayerOpen && playerItem?.kind === 'remote'}
        openPlayer={openRemotePlayer}
        playingBanner={playingBanner}
        remotePlayback={remotePlayback}
      />
    )
  }

  if (!item) {
    return null
  }

  const isViewingActiveItem = item.id === activeItemId
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
  const artworkSize = media.short ? 220 : media.compact ? 276 : 340
  const isDisabled =
    playback.isTransitioning || !playback.isReady || !item.isAvailable
  const isDockDisabled =
    playback.isTransitioning || !playback.isReady || !activeItem?.isAvailable
  const fadeDistance = Math.max(playerWidth, 1)
  const swipeOpacity = swipeOffset.interpolate({
    inputRange: [-fadeDistance, 0, fadeDistance],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  })

  const handlePlayerLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width
    playerWidthRef.current = width
    setPlayerWidth(width)
  }

  const handleScrubStart = () => {
    if (!isViewingActiveItem) {
      return
    }

    wasPlayingBeforeScrubRef.current = playback.isPlaying

    if (playback.isPlaying) {
      return playback.pausePlayback(item)
    }
  }

  const handleScrubEnd = () => {
    if (!isViewingActiveItem) {
      return
    }

    const shouldResume = wasPlayingBeforeScrubRef.current
    wasPlayingBeforeScrubRef.current = false

    if (shouldResume) {
      return playback.resumePlayback(item)
    }
  }

  const handleSetSleepTimer = (minutes: number) => {
    const durationMs = minutes * ONE_MINUTE_MS
    setSleepTimerDurationMinutes(minutes)
    setSleepTimerRemainingMs(durationMs)
    setSleepTimerEndsAt(Date.now() + durationMs)
  }

  const clearSleepTimer = () => {
    setSleepTimerEndsAt(null)
    setSleepTimerDurationMinutes(null)
    setSleepTimerRemainingMs(null)
  }

  const sleepTimerRemaining =
    sleepTimerRemainingMs === null
      ? null
      : formatSleepTimerRemaining(sleepTimerRemainingMs)

  return (
    <>
      {activeItem && (
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
                accessibilityLabel={`Open now playing for ${getEpisodeTitle(activeItem.originalName)}`}
                onPress={() => openPlayer(activeItem)}
                minWidth={0}
                flex={1}
                justifyContent="flex-start"
                padding={0}
              >
                <EpisodeArtwork
                  itemId={activeItem.id}
                  name={activeItem.originalName}
                  size={54}
                />
                <YStack flex={1} minWidth={0} alignItems="flex-start">
                  <ThemedText
                    type="episodeTitle"
                    numberOfLines={1}
                    width="100%"
                  >
                    {getEpisodeTitle(activeItem.originalName)}
                  </ThemedText>
                  <ThemedText
                    type="metadata"
                    themeColor="textSecondary"
                    numberOfLines={1}
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
                onPress={() => playback.togglePlayback(activeItem)}
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

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={isPlayerOpen}
        onRequestClose={closePlayer}
      >
        <ThemedView flex={1}>
          <SafeAreaView style={{ flex: 1 }}>
            <XStack
              alignItems="center"
              justifyContent="space-between"
              paddingHorizontal={Spacing.three}
              paddingVertical={Spacing.two}
            >
              <AppButton
                tone="icon"
                accessibilityLabel="Close now playing"
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
                <ThemedText type="metadata" themeColor="textSecondary">
                  Podcast Me
                </ThemedText>
              </YStack>
              <View width={44} />
            </XStack>

            {playingBanner}

            <ScrollView
              flex={1}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                alignItems: 'center',
                paddingBottom: Spacing.four,
              }}
            >
              <YStack
                width="100%"
                maxWidth={640}
                flex={1}
                alignItems="center"
                gap={media.short ? Spacing.three : Spacing.four}
                paddingHorizontal={Spacing.four}
                paddingTop={media.short ? Spacing.one : Spacing.three}
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
                    itemId={item.id}
                    name={item.originalName}
                    size={artworkSize}
                  />
                </ThemedView>

                <YStack width="100%" alignItems="center" gap={Spacing.one}>
                  <ThemedText
                    type="heading"
                    textAlign="center"
                    numberOfLines={3}
                    $compact={{ fontSize: 22, lineHeight: 28 }}
                  >
                    {getEpisodeTitle(item.originalName)}
                  </ThemedText>
                  <ThemedText type="default" themeColor="textSecondary">
                    Local recording · {formatEpisodeDate(item.addedAt)}
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

                <YStack width="100%" gap={Spacing.two}>
                  <AudioPlaybackSlider
                    accessibilityLabel={`${getEpisodeTitle(item.originalName)} playback position`}
                    bufferedSeconds={item.isAvailable ? duration : null}
                    disabled={
                      isDisabled || duration === null || !isViewingActiveItem
                    }
                    durationSeconds={duration}
                    onScrubEnd={handleScrubEnd}
                    onScrubStart={handleScrubStart}
                    onSeekTo={playback.seekTo}
                    positionSeconds={positionSeconds}
                  />
                  {playback.playbackError?.itemId === item.id && (
                    <ThemedText
                      type="metadata"
                      color="$danger"
                      textAlign="center"
                    >
                      {playback.playbackError.message}
                    </ThemedText>
                  )}
                </YStack>

                <XStack
                  width="100%"
                  alignItems="center"
                  justifyContent="space-around"
                >
                  <TransportButton
                    accessibilityLabel="Rewind 15 seconds"
                    disabled={isDisabled || !isViewingActiveItem}
                    label="15"
                    icon={REWIND_ICON}
                    onPress={() => playback.seekBy(-15)}
                    tintColor={theme.text}
                  />
                  <PlayerIconButton
                    large
                    accessibilityLabel={
                      isViewingActiveItem && playback.isPlaying
                        ? 'Pause'
                        : 'Play'
                    }
                    disabled={isDisabled}
                    icon={
                      isViewingActiveItem && playback.isPlaying
                        ? PAUSE_ICON
                        : PLAY_ICON
                    }
                    onPress={() => playback.togglePlayback(item)}
                    tintColor={theme.accentForeground}
                  />
                  <TransportButton
                    accessibilityLabel="Forward 15 seconds"
                    disabled={isDisabled || !isViewingActiveItem}
                    label="15"
                    icon={FORWARD_ICON}
                    onPress={() => playback.seekBy(15)}
                    tintColor={theme.text}
                  />
                </XStack>

                <XStack
                  width="100%"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <AppButton
                    tone="secondary"
                    accessibilityLabel={`Playback speed ${playback.playbackRate} times`}
                    onPress={() =>
                      playback.setPlaybackRate(
                        nextPlaybackRate(playback.playbackRate),
                      )
                    }
                  >
                    <ThemedText type="smallBold">
                      {playback.playbackRate}× speed
                    </ThemedText>
                  </AppButton>
                  <YStack alignItems="flex-end">
                    <ThemedText type="metadata" themeColor="textSecondary">
                      Up next
                    </ThemedText>
                    <ThemedText type="smallBold">
                      {Math.max(0, library.items.length - 1)} in queue
                    </ThemedText>
                  </YStack>
                </XStack>

                <ThemedView
                  type="backgroundElement"
                  width="100%"
                  gap={Spacing.three}
                  padding={Spacing.three}
                  borderWidth={1}
                  borderColor={
                    sleepTimerEndsAt === null ? '$borderColor' : '$accent'
                  }
                  borderRadius={Radius.large}
                >
                  <XStack alignItems="center" gap={Spacing.two}>
                    <View
                      width={42}
                      height={42}
                      alignItems="center"
                      justifyContent="center"
                      borderRadius={Radius.round}
                      backgroundColor={
                        sleepTimerEndsAt === null
                          ? '$backgroundSelected'
                          : '$accentSubtle'
                      }
                    >
                      <SymbolView
                        name={SLEEP_ICON}
                        size={21}
                        tintColor={
                          sleepTimerEndsAt === null
                            ? theme.textSecondary
                            : theme.accent
                        }
                        weight="semibold"
                      />
                    </View>
                    <YStack flex={1} gap={Spacing.half}>
                      <ThemedText type="smallBold">Sleep timer</ThemedText>
                      {sleepTimerRemaining ? (
                        <YStack gap={Spacing.half}>
                          <ThemedText type="metadata" themeColor="accent">
                            Playback pauses in
                          </ThemedText>
                          <ThemedText
                            type="heading"
                            themeColor="accent"
                            fontSize={20}
                            lineHeight={24}
                            accessibilityLabel={`Sleep Timer: ${sleepTimerRemaining}`}
                            accessibilityLiveRegion="polite"
                          >
                            {sleepTimerRemaining}
                          </ThemedText>
                        </YStack>
                      ) : (
                        <ThemedText type="metadata" themeColor="textSecondary">
                          Choose when playback should pause
                        </ThemedText>
                      )}
                    </YStack>
                    {sleepTimerEndsAt !== null && (
                      <AppButton
                        tone="icon"
                        accessibilityLabel="Cancel sleep timer"
                        onPress={clearSleepTimer}
                        borderWidth={1}
                        borderColor="$accent"
                        backgroundColor="$accentSubtle"
                      >
                        <SymbolView
                          name={CLEAR_TIMER_ICON}
                          size={18}
                          tintColor={theme.accent}
                          weight="semibold"
                        />
                      </AppButton>
                    )}
                  </XStack>

                  <XStack
                    accessibilityRole="radiogroup"
                    width="100%"
                    gap={Spacing.one}
                    padding={Spacing.one}
                    borderRadius={Radius.round}
                    backgroundColor="$backgroundSelected"
                  >
                    {SLEEP_TIMER_OPTIONS.map((option) => {
                      const isSelected =
                        sleepTimerDurationMinutes === option.minutes

                      return (
                        <AppButton
                          key={option.minutes}
                          tone="outlined"
                          accessibilityLabel={
                            isSelected && sleepTimerRemaining
                              ? `Sleep Timer: ${sleepTimerRemaining}`
                              : `Set sleep timer for ${option.label}`
                          }
                          accessibilityRole="radio"
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => handleSetSleepTimer(option.minutes)}
                          flex={1}
                          minWidth={0}
                          minHeight={44}
                          paddingHorizontal={0}
                          paddingVertical={Spacing.two}
                          borderWidth={0}
                          backgroundColor={
                            isSelected ? '$accent' : 'transparent'
                          }
                        >
                          <ThemedText
                            type="smallBold"
                            color={
                              isSelected ? theme.accentForeground : theme.text
                            }
                          >
                            {option.label}
                          </ThemedText>
                        </AppButton>
                      )
                    })}
                  </XStack>
                </ThemedView>
              </YStack>
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </Modal>
    </>
  )
}

type RemotePlayerSurfaceProps = {
  audio: RemoteAudio
  closePlayer: () => void
  isPlayerOpen: boolean
  openPlayer: (audio: RemoteAudio) => void
  playingBanner: ReactNode
  remotePlayback: {
    activeAudio: RemoteAudio | null
    currentPositionSeconds: number
    durationSeconds: number | null
    isPlaying: boolean
    isTransitioning: boolean
    playbackError: { audioId: string; message: string } | null
    playbackRate: number
    pausePlayback: (audio: RemoteAudio) => void
    resumePlayback: (audio: RemoteAudio) => void
    seekBy: (offsetSeconds: number) => void
    seekTo: (positionSeconds: number) => Promise<void>
    setPlaybackRate: (rate: number) => void
    togglePlayback: (audio: RemoteAudio) => void
  }
}

function RemotePlayerSurface({
  audio,
  closePlayer,
  isPlayerOpen,
  openPlayer,
  playingBanner,
  remotePlayback,
}: RemotePlayerSurfaceProps) {
  const media = useMedia()
  const theme = useTheme()
  const wasPlayingBeforeScrubRef = useRef(false)
  const isActive = remotePlayback.activeAudio?.id === audio.id
  const duration = isActive ? remotePlayback.durationSeconds : null
  const positionSeconds = isActive ? remotePlayback.currentPositionSeconds : 0
  const progress = duration ? Math.min(positionSeconds / duration, 1) : 0
  const isDisabled = remotePlayback.isTransitioning || !isActive
  const artworkSize = media.short ? 220 : media.compact ? 276 : 340
  const error =
    remotePlayback.playbackError?.audioId === audio.id
      ? remotePlayback.playbackError.message
      : null

  const handleScrubStart = () => {
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

  return (
    <>
      {remotePlayback.activeAudio && (
        <ThemedView
          position="absolute"
          zIndex={50}
          right={Spacing.one}
          bottom={BottomTabInset + Spacing.four}
          left={Spacing.one}
          maxWidth={Math.min(MaxContentWidth, 720)}
          height={PlayerDockHeight}
          alignSelf="center"
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
              onPress={() => openPlayer(audio)}
              minWidth={0}
              flex={1}
              justifyContent="flex-start"
              padding={0}
            >
              <EpisodeArtwork
                itemId={`remote-${audio.id}`}
                name={audio.title}
                size={54}
              />
              <YStack flex={1} minWidth={0} alignItems="flex-start">
                <ThemedText type="episodeTitle" numberOfLines={1} width="100%">
                  {audio.title}
                </ThemedText>
                <ThemedText
                  type="metadata"
                  themeColor="textSecondary"
                  numberOfLines={1}
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
              onPress={() => remotePlayback.togglePlayback(audio)}
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
      )}

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={isPlayerOpen}
        onRequestClose={closePlayer}
      >
        <ThemedView flex={1}>
          <SafeAreaView style={{ flex: 1 }}>
            <XStack
              alignItems="center"
              justifyContent="space-between"
              paddingHorizontal={Spacing.three}
              paddingVertical={Spacing.two}
            >
              <AppButton
                tone="icon"
                accessibilityLabel="Close now playing"
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
                <ThemedText type="metadata" themeColor="textSecondary">
                  Remote library
                </ThemedText>
              </YStack>
              <View width={44} />
            </XStack>

            {playingBanner}

            <ScrollView
              flex={1}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{
                alignItems: 'center',
                paddingBottom: Spacing.four,
              }}
            >
              <YStack
                width="100%"
                maxWidth={640}
                flex={1}
                alignItems="center"
                gap={media.short ? Spacing.three : Spacing.four}
                paddingHorizontal={Spacing.four}
                paddingTop={media.short ? Spacing.one : Spacing.three}
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
                    itemId={`remote-${audio.id}`}
                    name={audio.title}
                    size={artworkSize}
                  />
                </ThemedView>

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
                    Remote stream · Available while connected
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

                <YStack width="100%" gap={Spacing.two}>
                  <AudioPlaybackSlider
                    accessibilityLabel={`${audio.title} playback position`}
                    bufferedSeconds={duration}
                    disabled={isDisabled || duration === null}
                    durationSeconds={duration}
                    onScrubEnd={handleScrubEnd}
                    onScrubStart={handleScrubStart}
                    onSeekTo={remotePlayback.seekTo}
                    positionSeconds={positionSeconds}
                  />
                  {error ? (
                    <ThemedText
                      type="metadata"
                      color="$danger"
                      textAlign="center"
                    >
                      {error}
                    </ThemedText>
                  ) : null}
                </YStack>

                <XStack
                  width="100%"
                  alignItems="center"
                  justifyContent="space-around"
                >
                  <TransportButton
                    accessibilityLabel="Rewind 15 seconds"
                    disabled={isDisabled}
                    label="15"
                    icon={REWIND_ICON}
                    onPress={() => remotePlayback.seekBy(-15)}
                    tintColor={theme.text}
                  />
                  <PlayerIconButton
                    large
                    accessibilityLabel={
                      remotePlayback.isPlaying ? 'Pause' : 'Play'
                    }
                    disabled={remotePlayback.isTransitioning}
                    icon={remotePlayback.isPlaying ? PAUSE_ICON : PLAY_ICON}
                    onPress={() => remotePlayback.togglePlayback(audio)}
                    tintColor={theme.accentForeground}
                  />
                  <TransportButton
                    accessibilityLabel="Forward 15 seconds"
                    disabled={isDisabled}
                    label="15"
                    icon={FORWARD_ICON}
                    onPress={() => remotePlayback.seekBy(15)}
                    tintColor={theme.text}
                  />
                </XStack>

                <AppButton
                  tone="secondary"
                  accessibilityLabel={`Playback speed ${remotePlayback.playbackRate} times`}
                  onPress={() =>
                    remotePlayback.setPlaybackRate(
                      nextPlaybackRate(remotePlayback.playbackRate),
                    )
                  }
                >
                  <ThemedText type="smallBold">
                    {remotePlayback.playbackRate}× speed
                  </ThemedText>
                </AppButton>
              </YStack>
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </Modal>
    </>
  )
}

type CurrentlyPlayingBannerProps = {
  disabled: boolean
  itemId: string
  name: string
  onOpen: () => void
  onToggle: () => void
  tintColor: string
  title: string
}

function CurrentlyPlayingBanner({
  disabled,
  itemId,
  name,
  onOpen,
  onToggle,
  tintColor,
  title,
}: CurrentlyPlayingBannerProps) {
  return (
    <ThemedView
      type="accent"
      marginHorizontal={Spacing.one}
      marginBottom={Spacing.two}
      padding={Spacing.two}
      borderWidth={1}
      borderColor="$accentForeground"
      borderRadius={Radius.large}
      boxShadow="0 10px 24px rgba(0,0,0,0.28)"
    >
      <XStack alignItems="center" gap={Spacing.two}>
        <AppButton
          tone="ghost"
          accessibilityLabel={`Open now playing for ${title}`}
          onPress={onOpen}
          minWidth={0}
          flex={1}
          justifyContent="flex-start"
          padding={0}
        >
          <EpisodeArtwork itemId={itemId} name={name} size={42} />
          <YStack flex={1} minWidth={0} alignItems="flex-start">
            <ThemedText type="metadata" color="$accentForeground">
              Now playing
            </ThemedText>
            <ThemedText
              type="smallBold"
              color="$accentForeground"
              numberOfLines={1}
              width="100%"
            >
              {title}
            </ThemedText>
          </YStack>
        </AppButton>
        <AppButton
          tone="icon"
          accessibilityLabel="Pause current audio"
          disabled={disabled}
          onPress={onToggle}
          backgroundColor="$accentForeground"
        >
          <SymbolView
            name={PAUSE_ICON}
            size={23}
            tintColor={tintColor}
            weight="bold"
          />
        </AppButton>
      </XStack>
    </ThemedView>
  )
}

type PlayerIconButtonProps = {
  accessibilityLabel: string
  disabled: boolean
  icon: SymbolViewProps['name']
  large?: boolean
  onPress: () => void
  tintColor: string
}

function PlayerIconButton({
  accessibilityLabel,
  disabled,
  icon,
  large = false,
  onPress,
  tintColor,
}: PlayerIconButtonProps) {
  return (
    <AppButton
      tone={large ? 'player' : 'icon'}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      backgroundColor="$accent"
    >
      <SymbolView
        name={icon}
        size={large ? 32 : 23}
        tintColor={tintColor}
        weight="bold"
      />
    </AppButton>
  )
}

function TransportButton({
  label,
  ...props
}: PlayerIconButtonProps & { label: string }) {
  return (
    <YStack alignItems="center" gap={Spacing.one}>
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
      <ThemedText type="metadata" themeColor="textSecondary">
        {label} sec
      </ThemedText>
    </YStack>
  )
}

function nextPlaybackRate(currentRate: number): number {
  const currentIndex = PLAYBACK_RATES.findIndex((rate) => rate === currentRate)
  return PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length]
}

function formatSleepTimerRemaining(remainingMs: number): string {
  if (remainingMs > 60 * ONE_MINUTE_MS) {
    return `${Math.floor(remainingMs / (60 * ONE_MINUTE_MS))}h left`
  }

  return `${Math.max(1, Math.ceil(remainingMs / ONE_MINUTE_MS))}m left`
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
const SLEEP_ICON: SymbolViewProps['name'] = {
  ios: 'moon.zzz.fill',
  android: 'bedtime',
  web: 'bedtime',
}
const CLEAR_TIMER_ICON: SymbolViewProps['name'] = {
  ios: 'xmark',
  android: 'close',
  web: 'close',
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
