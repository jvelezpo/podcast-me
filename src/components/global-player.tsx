import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, View, XStack, YStack, useMedia } from 'tamagui';

import { AudioPlaybackSlider } from '@/components/audio-playback-slider';
import { EpisodeArtwork } from '@/components/episode-artwork';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import {
  BottomTabInset,
  MaxContentWidth,
  PlayerDockHeight,
  Radius,
  Spacing,
} from '@/constants/theme';
import { useAudioLibraryContext } from '@/contexts/audio-library-context';
import { useTheme } from '@/hooks/use-theme';
import {
  formatEpisodeDate,
  formatPlaybackTime,
  getEpisodeTitle,
} from '@/utils/audio-display';

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const SWIPE_DISMISS_FRACTION = 0.35;
const SWIPE_DISMISS_MIN_DISTANCE = 72;
const SWIPE_DISMISS_VELOCITY = 0.65;
const SWIPE_INTENT_DISTANCE = 10;

export function GlobalPlayer() {
  const { library, playback } = useAudioLibraryContext();
  const [isOpen, setIsOpen] = useState(false);
  const [playerWidth, setPlayerWidth] = useState(0);
  const activeItemIdRef = useRef<string | null>(null);
  const canSwipeRef = useRef(false);
  const dismissPlayerRef = useRef(playback.dismissPlayer);
  const isDismissingRef = useRef(false);
  const playerWidthRef = useRef(0);
  const swipeOffset = useRef(new Animated.Value(0)).current;
  const media = useMedia();
  const theme = useTheme();
  const item = library.items.find((candidate) => candidate.id === playback.activeItemId) ?? null;
  const activeItemId = item?.id ?? null;

  useEffect(() => {
    activeItemIdRef.current = activeItemId;
    canSwipeRef.current =
      activeItemId !== null &&
      !isOpen &&
      !playback.isTransitioning &&
      !isDismissingRef.current;
    dismissPlayerRef.current = playback.dismissPlayer;
  }, [activeItemId, isOpen, playback.dismissPlayer, playback.isTransitioning]);

  useEffect(() => {
    if (!activeItemId) {
      setIsOpen(false);
    }

    isDismissingRef.current = false;
    swipeOffset.setValue(0);
  }, [activeItemId, swipeOffset]);

  // Playback status updates frequently, so the responder reads current state from refs.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const swipeDismissResponder = useMemo(() => {
    const restorePlayer = () => {
      isDismissingRef.current = false;
      Animated.spring(swipeOffset, {
        toValue: 0,
        damping: 20,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    };

    const shouldClaimSwipe = (_event: unknown, gesture: PanResponderGestureState) =>
      canSwipeRef.current &&
      Math.abs(gesture.dx) >= SWIPE_INTENT_DISTANCE &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy);

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
          playerWidthRef.current * SWIPE_DISMISS_FRACTION
        );
        const movedFarEnough = Math.abs(gesture.dx) >= dismissDistance;
        const movedFastEnough = Math.abs(gesture.vx) >= SWIPE_DISMISS_VELOCITY;

        if (
          !canSwipeRef.current ||
          !activeItemIdRef.current ||
          (!movedFarEnough && !movedFastEnough)
        ) {
          restorePlayer();
          return;
        }

        isDismissingRef.current = true;
        canSwipeRef.current = false;
        const direction = gesture.dx < 0 ? -1 : 1;
        const target = direction * (playerWidthRef.current + Spacing.four);

        Animated.timing(swipeOffset, {
          toValue: target,
          duration: 180,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished) {
            restorePlayer();
            return;
          }

          void dismissPlayerRef
            .current()
            .then((didDismiss) => {
              if (!didDismiss) {
                restorePlayer();
              }
            })
            .catch(restorePlayer);
        });
      },
      onPanResponderTerminate: restorePlayer,
      onPanResponderTerminationRequest: () => true,
    });
  }, [swipeOffset]);

  if (!item) {
    return null;
  }

  const duration = playback.durationSeconds ?? item.durationSeconds;
  const progress = duration ? Math.min(playback.currentPositionSeconds / duration, 1) : 0;
  const artworkSize = media.short ? 220 : media.compact ? 276 : 340;
  const isDisabled = playback.isTransitioning || !playback.isReady || !item.isAvailable;
  const fadeDistance = Math.max(playerWidth, 1);
  const swipeOpacity = swipeOffset.interpolate({
    inputRange: [-fadeDistance, 0, fadeDistance],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  const handlePlayerLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    playerWidthRef.current = width;
    setPlayerWidth(width);
  };

  return (
    <>
      <Animated.View
        {...swipeDismissResponder.panHandlers}
        onLayout={handlePlayerLayout}
        style={{
          position: 'absolute',
          zIndex: 50,
          right: Spacing.three,
          bottom: BottomTabInset + Spacing.two,
          left: Spacing.three,
          maxWidth: Math.min(MaxContentWidth, 720),
          height: PlayerDockHeight,
          alignSelf: 'center',
          opacity: swipeOpacity,
          transform: [{ translateX: swipeOffset }],
        }}>
        <ThemedView
          type="backgroundElement"
          flex={1}
          overflow="hidden"
          borderWidth={1}
          borderColor="$borderColor"
          borderRadius={Radius.large}
          boxShadow="0 12px 30px rgba(0,0,0,0.28)">
          <XStack flex={1} alignItems="center" gap={Spacing.two} padding={Spacing.two}>
            <AppButton
              tone="ghost"
              accessibilityLabel={`Open now playing for ${getEpisodeTitle(item.originalName)}`}
              onPress={() => setIsOpen(true)}
              minWidth={0}
              flex={1}
              justifyContent="flex-start"
              padding={0}>
              <EpisodeArtwork itemId={item.id} name={item.originalName} size={54} />
              <YStack flex={1} minWidth={0} alignItems="flex-start">
                <ThemedText type="episodeTitle" numberOfLines={1} width="100%">
                  {getEpisodeTitle(item.originalName)}
                </ThemedText>
                <ThemedText type="metadata" themeColor="textSecondary" numberOfLines={1}>
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
              disabled={isDisabled}
              icon={playback.isPlaying ? PAUSE_ICON : PLAY_ICON}
              onPress={() => playback.togglePlayback(item)}
              tintColor={theme.accentForeground}
            />
          </XStack>
          <View
            position="absolute"
            right={0}
            bottom={0}
            left={0}
            height={3}
            backgroundColor="$backgroundSelected">
            <View height="100%" width={`${progress * 100}%`} backgroundColor="$accent" />
          </View>
        </ThemedView>
      </Animated.View>

      <Modal
        animationType="slide"
        presentationStyle="fullScreen"
        visible={isOpen}
        onRequestClose={() => setIsOpen(false)}>
        <ThemedView flex={1}>
          <SafeAreaView style={{ flex: 1 }}>
            <XStack
              alignItems="center"
              justifyContent="space-between"
              paddingHorizontal={Spacing.three}
              paddingVertical={Spacing.two}>
              <AppButton
                tone="icon"
                accessibilityLabel="Close now playing"
                onPress={() => setIsOpen(false)}>
                <SymbolView name={CLOSE_ICON} size={24} tintColor={theme.text} weight="semibold" />
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

            <ScrollView
              flex={1}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ alignItems: 'center', paddingBottom: Spacing.four }}>
              <YStack
                width="100%"
                maxWidth={640}
                flex={1}
                alignItems="center"
                gap={media.short ? Spacing.three : Spacing.four}
                paddingHorizontal={Spacing.four}
                paddingTop={media.short ? Spacing.one : Spacing.three}>
                <ThemedView
                  type="backgroundElement"
                  padding={Spacing.three}
                  borderRadius={Radius.large}
                  borderWidth={1}
                  borderColor="$borderColor"
                  boxShadow="0 22px 50px rgba(0,0,0,0.28)">
                  <EpisodeArtwork itemId={item.id} name={item.originalName} size={artworkSize} />
                </ThemedView>

                <YStack width="100%" alignItems="center" gap={Spacing.one}>
                  <ThemedText
                    type="heading"
                    textAlign="center"
                    numberOfLines={3}
                    $compact={{ fontSize: 22, lineHeight: 28 }}>
                    {getEpisodeTitle(item.originalName)}
                  </ThemedText>
                  <ThemedText type="default" themeColor="textSecondary">
                    Local recording · {formatEpisodeDate(item.addedAt)}
                  </ThemedText>
                  <XStack alignItems="center" gap={Spacing.one} marginTop={Spacing.one}>
                    <View width={7} height={7} borderRadius={7} backgroundColor="$success" />
                    <ThemedText type="metadata" themeColor="textSecondary">
                      Downloaded
                    </ThemedText>
                  </XStack>
                </YStack>

                <YStack width="100%" gap={Spacing.two}>
                  <AudioPlaybackSlider
                    accessibilityLabel={`${getEpisodeTitle(item.originalName)} playback position`}
                    disabled={isDisabled || duration === null}
                    durationSeconds={duration}
                    onSeekTo={playback.seekTo}
                    positionSeconds={playback.currentPositionSeconds}
                  />
                  {playback.playbackError?.itemId === item.id && (
                    <ThemedText type="metadata" color="$danger" textAlign="center">
                      {playback.playbackError.message}
                    </ThemedText>
                  )}
                </YStack>

                <XStack width="100%" alignItems="center" justifyContent="space-around">
                  <TransportButton
                    accessibilityLabel="Rewind 15 seconds"
                    disabled={isDisabled}
                    label="15"
                    icon={REWIND_ICON}
                    onPress={() => playback.seekBy(-15)}
                    tintColor={theme.text}
                  />
                  <PlayerIconButton
                    large
                    accessibilityLabel={playback.isPlaying ? 'Pause' : 'Play'}
                    disabled={isDisabled}
                    icon={playback.isPlaying ? PAUSE_ICON : PLAY_ICON}
                    onPress={() => playback.togglePlayback(item)}
                    tintColor={theme.accentForeground}
                  />
                  <TransportButton
                    accessibilityLabel="Forward 15 seconds"
                    disabled={isDisabled}
                    label="15"
                    icon={FORWARD_ICON}
                    onPress={() => playback.seekBy(15)}
                    tintColor={theme.text}
                  />
                </XStack>

                <XStack width="100%" alignItems="center" justifyContent="space-between">
                  <AppButton
                    tone="secondary"
                    accessibilityLabel={`Playback speed ${playback.playbackRate} times`}
                    onPress={() => playback.setPlaybackRate(nextPlaybackRate(playback.playbackRate))}>
                    <ThemedText type="smallBold">{playback.playbackRate}× speed</ThemedText>
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
              </YStack>
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </Modal>
    </>
  );
}

type PlayerIconButtonProps = {
  accessibilityLabel: string;
  disabled: boolean;
  icon: SymbolViewProps['name'];
  large?: boolean;
  onPress: () => void;
  tintColor: string;
};

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
      backgroundColor="$accent">
      <SymbolView name={icon} size={large ? 32 : 23} tintColor={tintColor} weight="bold" />
    </AppButton>
  );
}

function TransportButton({ label, ...props }: PlayerIconButtonProps & { label: string }) {
  return (
    <YStack alignItems="center" gap={Spacing.one}>
      <AppButton
        tone="icon"
        accessibilityLabel={props.accessibilityLabel}
        disabled={props.disabled}
        onPress={props.onPress}>
        <SymbolView name={props.icon} size={28} tintColor={props.tintColor} weight="semibold" />
      </AppButton>
      <ThemedText type="metadata" themeColor="textSecondary">
        {label} sec
      </ThemedText>
    </YStack>
  );
}

function nextPlaybackRate(currentRate: number): number {
  const currentIndex = PLAYBACK_RATES.findIndex((rate) => rate === currentRate);
  return PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
}

const PLAY_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
};
const PAUSE_ICON: SymbolViewProps['name'] = {
  ios: 'pause.fill',
  android: 'pause',
  web: 'pause',
};
const CLOSE_ICON: SymbolViewProps['name'] = {
  ios: 'chevron.down',
  android: 'keyboard_arrow_down',
  web: 'keyboard_arrow_down',
};
const REWIND_ICON: SymbolViewProps['name'] = {
  ios: 'gobackward.15',
  android: 'replay_10',
  web: 'replay_10',
};
const FORWARD_ICON: SymbolViewProps['name'] = {
  ios: 'goforward.15',
  android: 'forward_10',
  web: 'forward_10',
};
