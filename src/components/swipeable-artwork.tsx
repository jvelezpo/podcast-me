import { type ReactNode, useMemo, useRef } from 'react'
import {
  Animated,
  PanResponder,
  useWindowDimensions,
  type AccessibilityActionEvent,
} from 'react-native'
import { View } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { Spacing } from '@/constants/theme'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTheme } from '@/hooks/use-theme'
import { impactLight } from '@/services/haptics'

const INTENT_DISTANCE = 12
const TRIGGER_DISTANCE = 100
const FLING_VELOCITY = 0.7
const FLY_OFF_MS = 180
const MAX_TILT_DEG = 10

type SwipeableArtworkProps = {
  /** The artwork card (already sized by the caller). */
  children: ReactNode
  disabled?: boolean
  itemTitle: string
  /** Swipe left → next. Return false when nothing handled (card snaps back). */
  onSwipeLeft: () => boolean | void
  /** Swipe right → previous. Return false when nothing handled. */
  onSwipeRight: () => boolean | void
}

/**
 * Tinder-style track swipe for the full-player artwork: drag left for the
 * next episode, right for the previous one. The card follows the finger
 * with a slight tilt while a NEXT / PREV stamp fades in on the leading
 * edge; past the threshold (or on a fling) the card flies off and the
 * track changes, otherwise it springs back.
 *
 * Lives on the artwork — not the seek track — because the track already
 * owns horizontal drag for scrubbing.
 */
export function SwipeableArtwork({
  children,
  disabled = false,
  itemTitle,
  onSwipeLeft,
  onSwipeRight,
}: SwipeableArtworkProps) {
  const theme = useTheme()
  const { width: windowWidth } = useWindowDimensions()
  const reduceMotion = useReducedMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const onSwipeLeftRef = useRef(onSwipeLeft)
  onSwipeLeftRef.current = onSwipeLeft
  const onSwipeRightRef = useRef(onSwipeRight)
  onSwipeRightRef.current = onSwipeRight
  const dragX = useRef(new Animated.Value(0)).current
  const crossedRef = useRef(false)
  const animatingRef = useRef(false)
  const flyDistanceRef = useRef(windowWidth)
  flyDistanceRef.current = windowWidth

  const snapBack = () => {
    animatingRef.current = false

    if (reduceMotionRef.current) {
      dragX.setValue(0)
      return
    }

    Animated.spring(dragX, {
      toValue: 0,
      damping: 20,
      stiffness: 260,
      useNativeDriver: true,
    }).start()
  }

  const flyOff = (direction: 'left' | 'right') => {
    const handled =
      direction === 'left'
        ? onSwipeLeftRef.current()
        : onSwipeRightRef.current()

    if (!handled) {
      snapBack()
      return
    }

    impactLight()

    if (reduceMotionRef.current) {
      dragX.setValue(0)
      animatingRef.current = false
      return
    }

    animatingRef.current = true
    Animated.timing(dragX, {
      toValue: direction === 'left' ? -flyDistanceRef.current : flyDistanceRef.current,
      duration: FLY_OFF_MS,
      useNativeDriver: true,
    }).start(() => {
      dragX.setValue(0)
      animatingRef.current = false
    })
  }

  // Claim horizontal intent only, so vertical drags still scroll the sheet
  // and taps/scrubs elsewhere are untouched. Once claimed, the scroll view
  // must not steal the gesture mid-swipe.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !disabledRef.current &&
          !animatingRef.current &&
          Math.abs(gesture.dx) > INTENT_DISTANCE &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          crossedRef.current = false
          dragX.stopAnimation()
        },
        onPanResponderMove: (_event, gesture) => {
          dragX.setValue(gesture.dx)

          if (!crossedRef.current && Math.abs(gesture.dx) >= TRIGGER_DISTANCE) {
            crossedRef.current = true
            impactLight()
          } else if (crossedRef.current && Math.abs(gesture.dx) < TRIGGER_DISTANCE) {
            crossedRef.current = false
          }
        },
        onPanResponderRelease: (_event, gesture) => {
          const fling =
            Math.abs(gesture.vx) > FLING_VELOCITY && Math.abs(gesture.dx) > 24

          if (gesture.dx <= -TRIGGER_DISTANCE || (fling && gesture.dx < 0)) {
            flyOff('left')
          } else if (gesture.dx >= TRIGGER_DISTANCE || (fling && gesture.dx > 0)) {
            flyOff('right')
          } else {
            snapBack()
          }
        },
        onPanResponderTerminate: snapBack,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragX],
  )

  const tilt = useMemo(
    () =>
      dragX.interpolate({
        inputRange: [-160, 160],
        outputRange: [`-${MAX_TILT_DEG}deg`, `${MAX_TILT_DEG}deg`],
        extrapolate: 'clamp',
      }),
    [dragX],
  )
  const nextOpacity = useMemo(
    () =>
      dragX.interpolate({
        inputRange: [-TRIGGER_DISTANCE, -24],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      }),
    [dragX],
  )
  const prevOpacity = useMemo(
    () =>
      dragX.interpolate({
        inputRange: [24, TRIGGER_DISTANCE],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
    [dragX],
  )

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabledRef.current) {
      return
    }

    if (event.nativeEvent.actionName === 'swipeLeft') {
      onSwipeLeftRef.current()
    } else {
      onSwipeRightRef.current()
    }
  }

  return (
    <Animated.View
      style={{ transform: [{ translateX: dragX }, { rotate: tilt }] }}
    >
      <View
        {...responder.panHandlers}
        accessible
        accessibilityLabel={`Artwork for ${itemTitle}`}
        accessibilityHint="Swipe left for the next episode, swipe right for the previous episode"
        accessibilityActions={[
          { name: 'swipeLeft', label: 'Next episode' },
          { name: 'swipeRight', label: 'Previous episode' },
        ]}
        onAccessibilityAction={handleAccessibilityAction}
      >
        {children}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: Spacing.two,
            right: Spacing.two,
            opacity: nextOpacity,
            transform: [{ rotate: '12deg' }],
          }}
        >
          <View
            borderWidth={3}
            borderColor="$success"
            borderRadius={8}
            paddingHorizontal={Spacing.two}
            paddingVertical={Spacing.one}
            backgroundColor="rgba(0,0,0,0.35)"
          >
            <ThemedText type="heading" color="$success" fontSize={22} lineHeight={26}>
              NEXT
            </ThemedText>
          </View>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: Spacing.two,
            left: Spacing.two,
            opacity: prevOpacity,
            transform: [{ rotate: '-12deg' }],
          }}
        >
          <View
            borderWidth={3}
            borderColor="$accent"
            borderRadius={8}
            paddingHorizontal={Spacing.two}
            paddingVertical={Spacing.one}
            backgroundColor="rgba(0,0,0,0.35)"
          >
            <ThemedText
              type="heading"
              color={theme.accent}
              fontSize={22}
              lineHeight={26}
            >
              PREV
            </ThemedText>
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  )
}
