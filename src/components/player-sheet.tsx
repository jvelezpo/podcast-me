import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  BackHandler,
  PanResponder,
  Pressable,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View } from 'tamagui'

import { ThemedView } from '@/components/themed-view'
import { Radius, Spacing } from '@/constants/theme'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { resolveAnimationDuration } from '@/services/motion'

const SLIDE_IN_MS = 260
const BACKDROP_OPACITY = 0.45
const COLLAPSE_DISTANCE = 80
const COLLAPSE_VELOCITY = 0.8

type PlayerSheetProps = {
  /** Expanded state. Mirrors the old Modal `visible` prop. */
  visible: boolean
  /** Collapse the sheet (chevron, drag-down, backdrop tap, system back). */
  onClose: () => void
  /** Fixed header: grab affordance lives here plus the caller's chevron row. */
  header: ReactNode
  /** Scrolling artwork/title/metadata content. */
  children: ReactNode
  /** Sticky transport: slider + Prev/Play/Next etc. Never scrolls away. */
  footer: ReactNode
  /** Announced to screen readers for the dismiss backdrop. */
  collapseLabel?: string
}

/**
 * Draggable bottom sheet that replaces the old full-screen Modal player.
 *
 * Collapsed detent is the existing mini dock (rendered by the caller when
 * `!visible`); this sheet is the expanded detent. The header drags down to
 * collapse, the footer stays pinned so transport is reachable without scroll
 * on small screens and large-text sizes, and Android back collapses before
 * exiting (matching Modal `onRequestClose`).
 */
export function PlayerSheet({
  visible,
  onClose,
  header,
  children,
  footer,
  collapseLabel = 'Collapse player',
}: PlayerSheetProps) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const isLandscape = windowWidth > windowHeight
  const footerWidth = Math.min(Math.max(windowWidth * 0.4, 300), 420)
  const [mounted, setMounted] = useState(visible)
  const reduceMotion = useReducedMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const translateY = useRef(new Animated.Value(windowHeight)).current
  const backdrop = useRef(new Animated.Value(0)).current
  const dragY = useRef(new Animated.Value(0)).current
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Slide in on open; slide out then unmount on close so the exit animates
  // instead of vanishing like a conditional Modal. Reduced motion resolves
  // the slide instantly: the sheet still opens, it just does not travel.
  useEffect(() => {
    const duration = resolveAnimationDuration(SLIDE_IN_MS, reduceMotion)

    if (visible) {
      setMounted(true)
      dragY.setValue(0)
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: BACKDROP_OPACITY,
          duration,
          useNativeDriver: true,
        }),
      ]).start()
      return
    }

    Animated.parallel([
      Animated.timing(translateY, {
        toValue: windowHeight,
        duration,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false)
      }
    })
  }, [visible, windowHeight, translateY, backdrop, dragY, reduceMotion])

  // System back collapses before exiting (Modal onRequestClose parity).
  useEffect(() => {
    if (!mounted || !visible) {
      return
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onCloseRef.current()
        return true
      },
    )

    return () => subscription.remove()
  }, [mounted, visible])

  // Header-only drag-down: claiming gestures inside the scroll body or the
  // slider would break scrolling and scrubbing.
  const headerResponder = useMemo(() => {
    const snapDragBack = () => {
      if (reduceMotionRef.current) {
        dragY.setValue(0)
        return
      }

      Animated.spring(dragY, {
        toValue: 0,
        damping: 22,
        stiffness: 260,
        useNativeDriver: true,
      }).start()
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 10 && gesture.dy > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        dragY.stopAnimation()
      },
      onPanResponderMove: (_event, gesture) => {
        dragY.setValue(Math.max(gesture.dy, 0))
      },
      onPanResponderRelease: (_event, gesture) => {
        const shouldCollapse =
          gesture.dy > COLLAPSE_DISTANCE || gesture.vy > COLLAPSE_VELOCITY

        if (shouldCollapse) {
          dragY.setValue(0)
          onCloseRef.current()
          return
        }

        snapDragBack()
      },
      onPanResponderTerminate: snapDragBack,
      onPanResponderTerminationRequest: () => true,
    })
  }, [dragY])

  if (!mounted) {
    return null
  }

  return (
    <View
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      left={0}
      zIndex={100}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: '#000',
          opacity: backdrop,
        }}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable
          accessibilityLabel={collapseLabel}
          accessibilityRole="button"
          onPress={() => onCloseRef.current()}
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        style={{
          position: 'absolute',
          top: isLandscape ? 0 : undefined,
          right: 0,
          bottom: 0,
          left: 0,
          // Definite height (not just maxHeight): the layout inside is
          // header + ScrollView flex:1 + sticky footer. With an indefinite
          // height the scroll body sizes to its content and pushes the
          // footer — slider + transport — below the visible area where it
          // can neither be seen nor scrubbed. A fixed height lets the body
          // shrink and scroll internally while the footer stays pinned.
          height: isLandscape
            ? windowHeight
            : Math.max(windowHeight - Spacing.three, 320),
          transform: [{ translateY: Animated.add(translateY, dragY) }],
        }}
      >
        <ThemedView
          flex={1}
          overflow="hidden"
          borderTopLeftRadius={isLandscape ? 0 : Radius.large}
          borderTopRightRadius={isLandscape ? 0 : Radius.large}
          borderWidth={1}
          borderColor="$borderColor"
          boxShadow="0 -12px 40px rgba(0,0,0,0.35)"
        >
          <SafeAreaView
            style={{ flex: 1 }}
            edges={['top', 'bottom', 'left', 'right']}
          >
            <View flex={1} flexDirection={isLandscape ? 'row' : 'column'}>
              <View flex={1} minWidth={0}>
                <View
                  {...headerResponder.panHandlers}
                  accessible
                  accessibilityHint="Drag down to collapse the player"
                >
                  <View
                    alignItems="center"
                    paddingTop={Spacing.two}
                    paddingBottom={Spacing.one}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    <View
                      width={40}
                      height={4}
                      borderRadius={4}
                      backgroundColor="$backgroundSelected"
                    />
                  </View>
                  {header}
                </View>

                <ScrollView
                  flex={1}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    alignItems: 'center',
                    paddingBottom: Spacing.three,
                  }}
                >
                  {children}
                </ScrollView>
              </View>

              <ThemedView
                type="backgroundElement"
                borderTopWidth={isLandscape ? 0 : 1}
                borderLeftWidth={isLandscape ? 1 : 0}
                borderColor="$borderColor"
                width={isLandscape ? footerWidth : '100%'}
                paddingHorizontal={isLandscape ? Spacing.three : Spacing.four}
                paddingTop={Spacing.two}
                // Extra breathing room above the gesture bar so the slider
                // and transport sit comfortably in thumb reach.
                paddingBottom={Spacing.three}
              >
                {footer}
              </ThemedView>
            </View>
          </SafeAreaView>
        </ThemedView>
      </Animated.View>
    </View>
  )
}
