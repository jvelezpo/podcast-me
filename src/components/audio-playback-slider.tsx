import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Slider, View, XStack, YStack } from 'tamagui';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type AudioPlaybackSliderProps = {
  accessibilityLabel: string;
  disabled: boolean;
  durationSeconds: number | null;
  onSeekTo: (positionSeconds: number) => void;
  positionSeconds: number;
};

type ScrubRate = 0.1 | 1 | 3;
type ScrubDirection = -1 | 0 | 1;

const ACCESSIBILITY_SEEK_SECONDS = 15;
const HORIZONTAL_INTENT_THRESHOLD = 3;
const THUMB_TOUCH_RADIUS = 22;
const VERTICAL_RATE_THRESHOLD = 40;

export function AudioPlaybackSlider({
  accessibilityLabel,
  disabled,
  durationSeconds,
  onSeekTo,
  positionSeconds,
}: AudioPlaybackSliderProps) {
  const theme = useTheme();
  const trackWidthRef = useRef(0);
  const durationRef = useRef(durationSeconds);
  const disabledRef = useRef(disabled);
  const onSeekToRef = useRef(onSeekTo);
  const positionRef = useRef(positionSeconds);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const hasHorizontalIntentRef = useRef(false);
  const previousDragXRef = useRef(0);
  const previewRef = useRef<number | null>(null);
  const [previewSeconds, setPreviewSeconds] = useState<number | null>(null);
  const [scrubRate, setScrubRate] = useState<ScrubRate>(1);
  const [scrubDirection, setScrubDirection] = useState<ScrubDirection>(0);

  useEffect(() => {
    durationRef.current = durationSeconds;
    disabledRef.current = disabled;
    onSeekToRef.current = onSeekTo;
    positionRef.current = positionSeconds;
  }, [disabled, durationSeconds, onSeekTo, positionSeconds]);

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
      previewRef.current = null;
      setPreviewSeconds(null);
      setScrubRate(1);
      setScrubDirection(0);

      if (target !== null) {
        onSeekToRef.current(target);
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
        setPreviewSeconds(touchPosition);
        setScrubRate(1);
        setScrubDirection(0);
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
  }, []);

  const displayPosition = clampPosition(
    previewSeconds ?? positionSeconds,
    durationSeconds
  );
  const isScrubbing = previewSeconds !== null;

  const handleLayout = (event: LayoutChangeEvent) => {
    trackWidthRef.current = event.nativeEvent.layout.width;
  };

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled || !durationSeconds) {
      return;
    }

    const direction = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    onSeekTo(
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
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: 0,
          max: Math.round(durationSeconds ?? 0),
          now: Math.round(displayPosition),
          text: `${formatPlaybackTime(displayPosition)} of ${formatPlaybackTime(durationSeconds)}`,
        }}
        onAccessibilityAction={handleAccessibilityAction}
        onLayout={handleLayout}
        minHeight={44}
        justifyContent="center"
        opacity={disabled ? 0.45 : 1}>
        <Slider
          pointerEvents="none"
          accessible={false}
          width="100%"
          min={0}
          max={durationSeconds ?? 1}
          step={0.01}
          value={[displayPosition]}>
          <Slider.Track height={6} borderRadius={3} backgroundColor="$background">
            <Slider.TrackActive borderRadius={3} backgroundColor="$color" />
          </Slider.Track>
          <Slider.Thumb
            index={0}
            width={20}
            height={20}
            borderWidth={0}
            borderRadius={10}
            backgroundColor="$color"
          />
        </Slider>
      </View>

      <XStack justifyContent="space-between">
        <ThemedText type="smallBold">{formatPlaybackTime(displayPosition)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatPlaybackTime(durationSeconds)}
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
            Drag up for precision · down for speed
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

function formatPlaybackTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
