import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  type AccessibilityActionEvent,
} from 'react-native';
import { View, XStack, YStack, styled } from 'tamagui';

import { AudioPlaybackSlider } from '@/components/audio-playback-slider';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { Spacing } from '@/constants/theme';
import type { AudioPlaybackError } from '@/hooks/use-audio-library-player';
import type { LoadedAudioItem } from '@/services/audio-library-storage';

type AudioLibraryRowProps = {
  item: LoadedAudioItem;
  isActive: boolean;
  isPlaying: boolean;
  isTransitioning: boolean;
  isPlaybackReady: boolean;
  currentPositionSeconds: number;
  loadedDurationSeconds: number | null;
  playbackError: AudioPlaybackError | null;
  duplicateHighlightToken: number;
  isDeleteDisabled: boolean;
  isReorderDisabled: boolean;
  onDelete: (item: LoadedAudioItem) => void;
  onReorder: (itemId: string, offset: number) => void;
  onSeekBy: (seconds: number) => void;
  onSeekTo: (positionSeconds: number) => void;
  onTogglePlayback: (item: LoadedAudioItem) => void;
};

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
  onReorder,
  onSeekBy,
  onSeekTo,
  onTogglePlayback,
}: AudioLibraryRowProps) {
  const [dragY] = useState(() => new Animated.Value(0));
  const [highlightProgress] = useState(() => new Animated.Value(0));
  const dragDisabledRef = useRef(isReorderDisabled);
  const itemIdRef = useRef(item.id);
  const onReorderRef = useRef(onReorder);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    dragDisabledRef.current = isReorderDisabled;
    itemIdRef.current = item.id;
    onReorderRef.current = onReorder;
  }, [isReorderDisabled, item.id, onReorder]);

  useEffect(() => {
    if (duplicateHighlightToken === 0) {
      return;
    }

    highlightProgress.stopAnimation();
    highlightProgress.setValue(0);
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
    ]);
    animation.start();

    return () => animation.stop();
  }, [duplicateHighlightToken, highlightProgress]);

  // The handle owns one stable responder so list/status rerenders cannot interrupt a drag.
  const reorderResponder = useMemo(() => {
    const canDrag = () => !dragDisabledRef.current;

    const finishDrag = (_event: unknown, gestureState: { dy: number }) => {
      const offset = Math.round(gestureState.dy / REORDER_STEP_DISTANCE);
      setIsDragging(false);

      if (offset !== 0) {
        dragY.setValue(0);
        onReorderRef.current(itemIdRef.current, offset);
        return;
      }

      Animated.spring(dragY, {
        damping: 18,
        mass: 0.8,
        stiffness: 180,
        toValue: 0,
        useNativeDriver: true,
      }).start();
    };

    // PanResponder stores these callbacks and invokes them only for touch events.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: canDrag,
      onStartShouldSetPanResponderCapture: canDrag,
      onMoveShouldSetPanResponder: canDrag,
      onMoveShouldSetPanResponderCapture: canDrag,
      onPanResponderGrant: () => {
        dragY.stopAnimation();
        dragY.setValue(0);
        setIsDragging(true);
      },
      onPanResponderMove: (_event, gestureState) => {
        dragY.setValue(gestureState.dy);
      },
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, [dragY]);

  const positionSeconds = isActive ? currentPositionSeconds : item.lastPositionSeconds;
  const durationSeconds = isActive
    ? loadedDurationSeconds ?? item.durationSeconds
    : item.durationSeconds;
  const itemError = playbackError?.itemId === item.id ? playbackError.message : null;
  const isBusy = isActive && isTransitioning;
  const isButtonDisabled = !isPlaybackReady || !item.isAvailable || isTransitioning;
  const buttonLabel = isBusy
    ? 'Loading…'
    : itemError
      ? 'Retry'
      : isActive && isPlaying
        ? 'Pause'
        : 'Play';
  const highlightScale = highlightProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.018],
  });

  const handleReorderAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (isReorderDisabled) {
      return;
    }

    if (event.nativeEvent.actionName === 'increment') {
      onReorder(item.id, 1);
    } else if (event.nativeEvent.actionName === 'decrement') {
      onReorder(item.id, -1);
    }
  };

  return (
    <AnimatedView
      borderRadius={Spacing.three}
      zIndex={isDragging ? 10 : 0}
      opacity={isDragging ? 0.92 : 1}
      boxShadow={isDragging ? '0 8px 18px rgba(0, 0, 0, 0.2)' : undefined}
      style={{ transform: [{ translateY: dragY }, { scale: highlightScale }] }}>
      <AnimatedView
        pointerEvents="none"
        position="absolute"
        top={0}
        right={0}
        bottom={0}
        left={0}
        zIndex={2}
        borderWidth={3}
        borderRadius={Spacing.three}
        borderColor="$color"
        style={{ opacity: highlightProgress }}
      />
      <ThemedView
        type={isActive ? 'backgroundSelected' : 'backgroundElement'}
        padding={Spacing.three}
        borderRadius={Spacing.three}
        gap={Spacing.two}
        $compact={{ padding: Spacing.two }}>
        <XStack alignItems="center" gap={Spacing.three}>
          <YStack flex={1} gap={Spacing.one}>
            <ThemedText type="smallBold" numberOfLines={2}>
              {item.originalName}
            </ThemedText>
          </YStack>

          <AppButton
            tone="outlined"
            accessibilityRole="button"
            accessibilityLabel={`${buttonLabel} ${item.originalName}`}
            accessibilityState={{ busy: isBusy, disabled: isButtonDisabled }}
            disabled={isButtonDisabled}
            onPress={() => onTogglePlayback(item)}
            minWidth={76}>
            <ThemedText type="smallBold">{buttonLabel}</ThemedText>
          </AppButton>
        </XStack>

        <AudioPlaybackSlider
          accessibilityLabel={`${item.originalName} playback position`}
          disabled={!isActive || isButtonDisabled || durationSeconds === null}
          durationSeconds={durationSeconds}
          onSeekTo={onSeekTo}
          positionSeconds={positionSeconds}
        />

        {isActive && (
          <XStack gap={Spacing.two} $compact={{ flexDirection: 'column' }}>
            <SeekButton
              accessibilityLabel={`Rewind ${item.originalName} by 15 seconds`}
              disabled={isButtonDisabled}
              label="−15 sec"
              onPress={() => onSeekBy(-15)}
            />
            <SeekButton
              accessibilityLabel={`Move ${item.originalName} forward by 15 seconds`}
              disabled={isButtonDisabled}
              label="+15 sec"
              onPress={() => onSeekBy(15)}
            />
          </XStack>
        )}

        {isActive && !itemError && (
          <ThemedText type="small" themeColor="textSecondary">
            {isBusy ? 'Preparing playback…' : isPlaying ? 'Now playing' : 'Paused'}
          </ThemedText>
        )}

        {!item.isAvailable && (
          <ThemedText type="smallBold">
            {item.unavailableReason === 'unsupported'
              ? 'Unsupported audio type. Re-import a supported recording.'
              : 'File missing. Re-import this recording to restore playback.'}
          </ThemedText>
        )}

        {itemError && <ThemedText type="smallBold">{itemError}</ThemedText>}

        <XStack gap={Spacing.two} $compact={{ flexDirection: 'column' }}>
          <View
            {...reorderResponder.panHandlers}
            accessible
            accessibilityActions={[
              { name: 'decrement', label: 'Move earlier' },
              { name: 'increment', label: 'Move later' },
            ]}
            accessibilityHint="Drag vertically to change the playlist position"
            accessibilityLabel={`Reorder ${item.originalName}`}
            accessibilityRole="adjustable"
            accessibilityState={{ disabled: isReorderDisabled }}
            onAccessibilityAction={handleReorderAccessibilityAction}
            minHeight={44}
            flex={1}
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            gap={Spacing.two}
            borderWidth={1}
            borderRadius={Spacing.three}
            borderColor="$borderColor"
            backgroundColor={isDragging ? '$backgroundSelected' : 'transparent'}
            opacity={isReorderDisabled ? 0.45 : 1}
            cursor={isReorderDisabled ? 'not-allowed' : 'grab'}>
            <ThemedText type="smallBold" fontSize={22} lineHeight={22}>
              ≡
            </ThemedText>
            <ThemedText type="smallBold">Drag to reorder</ThemedText>
          </View>

          <AppButton
            tone="danger"
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.originalName}`}
            accessibilityState={{ disabled: isDeleteDisabled }}
            disabled={isDeleteDisabled}
            onPress={() => onDelete(item)}>
            <ThemedText type="smallBold" color="$danger">
              Remove
            </ThemedText>
          </AppButton>
        </XStack>
      </ThemedView>
    </AnimatedView>
  );
}

type SeekButtonProps = {
  accessibilityLabel: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
};

function SeekButton({ accessibilityLabel, disabled, label, onPress }: SeekButtonProps) {
  return (
    <AppButton
      tone="outlined"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      flex={1}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </AppButton>
  );
}

const REORDER_STEP_DISTANCE = 112;

const AnimatedView = styled(Animated.View, {
  name: 'AnimatedView',
});
