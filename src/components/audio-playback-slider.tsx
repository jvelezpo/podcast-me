import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { View, XStack, YStack } from 'tamagui';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPlaybackTime } from '@/utils/audio-display';

type AudioPlaybackSliderProps = {
  accessibilityLabel: string;
  bufferedSeconds: number | null;
  disabled: boolean;
  durationSeconds: number | null;
  onScrubEnd: () => Promise<void> | void;
  onScrubStart: () => Promise<void> | void;
  onSeekTo: (positionSeconds: number) => Promise<void> | void;
  positionSeconds: number;
};

type ScrubRate = 0.1 | 1 | 3;
type ScrubDirection = -1 | 0 | 1;

const ACCESSIBILITY_SEEK_SECONDS = 15;
const HORIZONTAL_INTENT_THRESHOLD = 3;
const SCRUB_TOOLTIP_WIDTH = 112;
const THUMB_TOUCH_RADIUS = 22;
const VERTICAL_RATE_THRESHOLD = 40;

export function AudioPlaybackSlider({
  accessibilityLabel,
  bufferedSeconds,
  disabled,
  durationSeconds,
  onScrubEnd,
  onScrubStart,
  onSeekTo,
  positionSeconds,
}: AudioPlaybackSliderProps) {
  const theme = useTheme();
  const trackWidthRef = useRef(0);
  const durationRef = useRef(durationSeconds);
  const disabledRef = useRef(disabled);
  const onScrubEndRef = useRef(onScrubEnd);
  const onScrubStartRef = useRef(onScrubStart);
  const onSeekToRef = useRef(onSeekTo);
  const positionRef = useRef(positionSeconds);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const hasHorizontalIntentRef = useRef(false);
  const previousDragXRef = useRef(0);
  const previewRef = useRef<number | null>(null);
  const scrubStartPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const [trackWidth, setTrackWidth] = useState(0);
  const [previewSeconds, setPreviewSeconds] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [scrubRate, setScrubRate] = useState<ScrubRate>(1);
  const [scrubDirection, setScrubDirection] = useState<ScrubDirection>(0);
  const [thumbVisibility] = useState(() => new Animated.Value(0));
  const [trackProminence] = useState(() => new Animated.Value(0));
  const isPreviewing = previewSeconds !== null;
  const isPrecisionScrubbing = isScrubbing && scrubRate === 0.1;

  useEffect(() => {
    durationRef.current = durationSeconds;
    disabledRef.current = disabled;
    onScrubEndRef.current = onScrubEnd;
    onScrubStartRef.current = onScrubStart;
    onSeekToRef.current = onSeekTo;
    positionRef.current = positionSeconds;
  }, [
    disabled,
    durationSeconds,
    onScrubEnd,
    onScrubStart,
    onSeekTo,
    positionSeconds,
  ]);

  useEffect(() => {
    Animated.spring(trackProminence, {
      toValue: isPrecisionScrubbing ? 2 : isScrubbing ? 1 : 0,
      damping: 22,
      stiffness: 260,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [isPrecisionScrubbing, isScrubbing, trackProminence]);

  // The native responder must stay stable while playback status rerenders this row.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const panResponder = useMemo(() => {
    const canScrub = () =>
      !disabledRef.current &&
      durationRef.current !== null &&
      durationRef.current > 0 &&
      trackWidthRef.current > 0;

    const finishScrubbing = () => {
      const target = previewRef.current;
      const scrubStartPromise = scrubStartPromiseRef.current;
      previewRef.current = null;
      setIsScrubbing(false);
      setScrubRate(1);
      setScrubDirection(0);
      Animated.timing(thumbVisibility, {
        toValue: 0,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();

      if (target !== null) {
        void (async () => {
          try {
            await scrubStartPromise;
            await onSeekToRef.current(target);
          } finally {
            try {
              await onScrubEndRef.current();
            } finally {
              setPreviewSeconds(null);
              setIsSettling(false);
            }
          }
        })();
      } else {
        setPreviewSeconds(null);
        setIsSettling(false);
      }
    };

    // PanResponder stores these callbacks and invokes them only for touch events.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: canScrub,
      onStartShouldSetPanResponderCapture: canScrub,
      onMoveShouldSetPanResponder: canScrub,
      onMoveShouldSetPanResponderCapture: canScrub,
      onPanResponderGrant: (event) => {
        const duration = durationRef.current;
        const width = trackWidthRef.current;

        if (!duration || width <= 0) {
          return;
        }

        const currentPosition = clampPosition(positionRef.current, duration);
        const currentThumbX = (currentPosition / duration) * width;
        const touchPosition =
          Math.abs(event.nativeEvent.locationX - currentThumbX) <= THUMB_TOUCH_RADIUS
            ? currentPosition
            : clamp(event.nativeEvent.locationX / width, 0, 1) * duration;

        dragStartYRef.current = event.nativeEvent.pageY;
        dragStartXRef.current = event.nativeEvent.pageX;
        hasHorizontalIntentRef.current = false;
        previousDragXRef.current = event.nativeEvent.pageX;
        previewRef.current = touchPosition;
        scrubStartPromiseRef.current = Promise.resolve(onScrubStartRef.current());
        setPreviewSeconds(touchPosition);
        setIsScrubbing(true);
        setIsSettling(true);
        setScrubRate(1);
        setScrubDirection(0);
        thumbVisibility.stopAnimation();
        Animated.spring(thumbVisibility, {
          toValue: 1,
          damping: 16,
          stiffness: 280,
          mass: 0.55,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderMove: (event) => {
        const duration = durationRef.current;
        const width = trackWidthRef.current;

        if (!duration || width <= 0 || previewRef.current === null) {
          return;
        }

        const verticalDistance = event.nativeEvent.pageY - dragStartYRef.current;
        const rate = getScrubRate(verticalDistance);
        const horizontalDistance = event.nativeEvent.pageX - dragStartXRef.current;

        if (
          !hasHorizontalIntentRef.current &&
          !hasHorizontalIntent(horizontalDistance, verticalDistance)
        ) {
          setScrubRate(rate);
          return;
        }

        const horizontalChange = hasHorizontalIntentRef.current
          ? event.nativeEvent.pageX - previousDragXRef.current
          : horizontalDistance;
        const target = clamp(
          previewRef.current + (horizontalChange / width) * duration * rate,
          0,
          duration
        );

        hasHorizontalIntentRef.current = true;
        previousDragXRef.current = event.nativeEvent.pageX;
        previewRef.current = target;
        setPreviewSeconds(target);
        setScrubRate(rate);

        if (horizontalChange !== 0) {
          setScrubDirection(horizontalChange > 0 ? 1 : -1);
        }
      },
      onPanResponderRelease: finishScrubbing,
      onPanResponderTerminate: finishScrubbing,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }, [thumbVisibility]);

  const displayPosition = clampPosition(
    previewSeconds ?? positionSeconds,
    durationSeconds
  );
  const currentPosition = clampPosition(positionSeconds, durationSeconds);
  const safeDuration = durationSeconds ?? 0;
  const playedProgress = safeDuration > 0 ? currentPosition / safeDuration : 0;
  const previewProgress = safeDuration > 0 ? displayPosition / safeDuration : 0;
  const bufferedProgress =
    safeDuration > 0 ? clamp(bufferedSeconds ?? 0, 0, safeDuration) / safeDuration : 0;
  const tooltipEdgeInset =
    trackWidth > 0 ? Math.min(SCRUB_TOOLTIP_WIDTH / 2 / trackWidth, 0.5) : 0;
  const tooltipProgress = clamp(previewProgress, tooltipEdgeInset, 1 - tooltipEdgeInset);
  const seekDeltaSeconds = previewSeconds === null ? 0 : previewSeconds - positionSeconds;
  const currentTimeText = formatPlaybackTime(currentPosition);
  const previewTimeText = formatPlaybackTime(displayPosition);
  const totalTimeText = formatPlaybackTime(durationSeconds);
  const remainingTimeText =
    durationSeconds === null
      ? '--:--'
      : formatPlaybackTime(Math.max(0, durationSeconds - displayPosition));

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    trackWidthRef.current = width;
    setTrackWidth(width);
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled || !durationSeconds) {
      return;
    }

    const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    void onSeekTo(
      clamp(
        positionSeconds + direction * ACCESSIBILITY_SEEK_SECONDS,
        0,
        durationSeconds
      )
    );
  };

  return (
    <YStack gap={Spacing.one}>
      <View
        {...panResponder.panHandlers}
        accessible
        accessibilityActions={[
          { name: 'decrement', label: 'Move backward 15 seconds' },
          { name: 'increment', label: 'Move forward 15 seconds' },
        ]}
        accessibilityHint="Drag horizontally to seek. Pull up while dragging for finer control."
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: 0,
          max: Math.round(durationSeconds ?? 0),
          now: Math.round(displayPosition),
          text:
            durationSeconds === null
              ? previewTimeText
              : `${previewTimeText} of ${totalTimeText}, ${remainingTimeText} remaining`,
        }}
        onAccessibilityAction={handleAccessibilityAction}
        onLayout={handleLayout}
        height={48}
        justifyContent="center"
        opacity={disabled && !isScrubbing && !isSettling ? 0.45 : 1}>
        {isScrubbing && (
          <View
            pointerEvents="none"
            position="absolute"
            bottom={34}
            zIndex={2}
            minWidth={SCRUB_TOOLTIP_WIDTH}
            alignItems="center"
            paddingHorizontal={Spacing.two}
            paddingVertical={Spacing.two}
            borderRadius={10}
            backgroundColor="#111827"
            style={{
              left: `${tooltipProgress * 100}%`,
              transform: [{ translateX: -SCRUB_TOOLTIP_WIDTH / 2 }],
            }}>
            <ThemedText type="smallBold" color="#FFFFFF">
              {previewTimeText}
              {Math.abs(seekDeltaSeconds) >= 0.5
                ? `  ·  ${formatSeekDelta(seekDeltaSeconds)}`
                : ''}
            </ThemedText>
          </View>
        )}

        <View
          pointerEvents="none"
          position="absolute"
          top={23}
          right={0}
          left={0}
          height={2}
          borderRadius={1}
          backgroundColor={theme.borderColor}
        />

        <Animated.View
          pointerEvents="none"
          style={{
            width: '100%',
            height: 8,
            overflow: 'hidden',
            borderRadius: 4,
            backgroundColor: 'transparent',
            transform: [
              {
                scaleY: trackProminence.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: [0.5, 0.75, 1],
                }),
              },
            ],
          }}>
          <View
            position="absolute"
            top={0}
            bottom={0}
            left={0}
            width={`${bufferedProgress * 100}%`}
            borderRadius={4}
            backgroundColor={theme.textSecondary}
            opacity={0.32}
          />
          <View
            position="absolute"
            top={0}
            bottom={0}
            left={0}
            width={`${playedProgress * 100}%`}
            borderRadius={4}
            backgroundColor={theme.accent}
            opacity={isPreviewing ? 0.45 : 1}
          />
          {isPreviewing && (
            <View
              position="absolute"
              top={0}
              bottom={0}
              left={0}
              width={`${previewProgress * 100}%`}
              borderRadius={4}
              backgroundColor={theme.accent}
            />
          )}
        </Animated.View>

        {isScrubbing && (
          <View
            pointerEvents="none"
            position="absolute"
            top={20}
            left={`${playedProgress * 100}%`}
            width={8}
            height={8}
            marginLeft={-4}
            borderWidth={2}
            borderColor={theme.accent}
            borderRadius={4}
            backgroundColor={theme.background}
            opacity={0.72}
          />
        )}

        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 10,
            left: `${previewProgress * 100}%`,
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 14,
            backgroundColor: theme.accentSubtle,
            opacity: thumbVisibility,
            shadowColor: theme.accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.55,
            shadowRadius: 8,
            elevation: 6,
            transform: [
              { translateX: -14 },
              {
                scale: thumbVisibility.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.65, 1],
                }),
              },
              {
                scale: trackProminence.interpolate({
                  inputRange: [0, 1, 2],
                  outputRange: [1, 1, 1.15],
                }),
              },
            ],
          }}>
          <View width={16} height={16} borderRadius={8} backgroundColor={theme.accent} />
        </Animated.View>
      </View>

      <XStack justifyContent="space-between" alignItems="center">
        <ThemedText type="smallBold" color={isScrubbing ? theme.accent : theme.text}>
          {currentTimeText}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {durationSeconds === null
            ? '--:--  ·  --:--'
            : `−${remainingTimeText}  ·  ${totalTimeText}`}
        </ThemedText>
      </XStack>

      {!disabled && (
        isScrubbing ? (
          <XStack minHeight={32} alignItems="center" gap={Spacing.two}>
            <View
              width={32}
              height={32}
              alignItems="center"
              justifyContent="center"
              borderRadius={16}
              backgroundColor="$background"
              scale={scrubRate === 3 ? 1.1 : 1}>
              <SymbolView
                name={getScrubIcon(scrubRate, scrubDirection)}
                size={scrubRate === 0.1 ? 16 : scrubRate === 3 ? 24 : 20}
                tintColor={theme.text}
                weight={scrubRate === 3 ? 'bold' : 'semibold'}
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {`${getScrubRateLabel(scrubRate, scrubDirection)} · Release to seek`}
            </ThemedText>
          </XStack>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Drag to seek · pull up for precision
          </ThemedText>
        )
      )}
    </YStack>
  );
}

function getScrubRate(verticalDistance: number): ScrubRate {
  if (verticalDistance <= -VERTICAL_RATE_THRESHOLD) {
    return 0.1;
  }

  if (verticalDistance >= VERTICAL_RATE_THRESHOLD) {
    return 3;
  }

  return 1;
}

function formatSeekDelta(deltaSeconds: number): string {
  const roundedSeconds = Math.round(deltaSeconds);
  const sign = roundedSeconds >= 0 ? '+' : '−';
  const magnitude = Math.abs(roundedSeconds);

  return magnitude < 60
    ? `${sign}${magnitude}s`
    : `${sign}${formatPlaybackTime(magnitude)}`;
}

function hasHorizontalIntent(
  horizontalDistance: number,
  verticalDistance: number
): boolean {
  const absoluteHorizontalDistance = Math.abs(horizontalDistance);

  return (
    absoluteHorizontalDistance >= HORIZONTAL_INTENT_THRESHOLD &&
    absoluteHorizontalDistance >= Math.abs(verticalDistance) * 0.25
  );
}

function getScrubRateLabel(rate: ScrubRate, direction: ScrubDirection): string {
  const directionLabel =
    direction === 1 ? ' forward' : direction === -1 ? ' backward' : '';

  if (rate === 0.1) {
    return `Fine${directionLabel} 0.1×`;
  }

  if (rate === 3) {
    return `Fast${directionLabel} 3×`;
  }

  return `Normal${directionLabel} 1×`;
}

function getScrubIcon(
  rate: ScrubRate,
  direction: ScrubDirection
): SymbolViewProps['name'] {
  if (direction === 0) {
    return {
      ios: 'arrow.left.and.right',
      android: 'swap_horiz',
      web: 'swap_horiz',
    };
  }

  const isForward = direction === 1;

  if (rate === 0.1) {
    return isForward
      ? { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }
      : { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' };
  }

  if (rate === 3) {
    return isForward
      ? {
          ios: 'chevron.right.2',
          android: 'keyboard_double_arrow_right',
          web: 'keyboard_double_arrow_right',
        }
      : {
          ios: 'chevron.left.2',
          android: 'keyboard_double_arrow_left',
          web: 'keyboard_double_arrow_left',
        };
  }

  return isForward
    ? { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }
    : { ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' };
}

function clampPosition(positionSeconds: number, durationSeconds: number | null): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return 0;
  }

  return durationSeconds === null
    ? positionSeconds
    : Math.min(positionSeconds, durationSeconds);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
