import { Image } from 'expo-image';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { View } from 'tamagui';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { getArtworkColor, getEpisodeInitials } from '@/utils/audio-display';

type EpisodeArtworkProps = {
  itemId: string;
  name: string;
  imageUrl?: string | null;
  size?: number;
  /** Pulsing "Buffering…" shimmer shown while the player is transitioning. */
  isBuffering?: boolean;
};

export const EpisodeArtwork = memo(function EpisodeArtwork({
  itemId,
  name,
  imageUrl = null,
  size = 72,
  isBuffering = false,
}: EpisodeArtworkProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const shouldShowImage = imageUrl !== null && imageUrl !== failedImageUrl;
  const reduceMotion = useReducedMotion();
  const shimmer = useRef(new Animated.Value(0.35)).current;
  // Per-render color + initials are cheap but run 2 Hz inside the tick
  // storm for every row; memoize on stable inputs (§P2).
  const artworkColor = useMemo(() => getArtworkColor(itemId), [itemId]);
  const episodeInitials = useMemo(() => getEpisodeInitials(name), [name]);

  useEffect(() => {
    if (!isBuffering) {
      return;
    }

    // Reduced motion keeps a static dim veil instead of the pulse loop.
    if (reduceMotion) {
      shimmer.setValue(0.5);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 0.65,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [isBuffering, reduceMotion, shimmer]);

  return (
    <View
      accessibilityElementsHidden
      width={size}
      height={size}
      flexShrink={0}
      overflow="hidden"
      alignItems="center"
      justifyContent="center"
      borderRadius={Math.min(Radius.large, size * 0.24)}
      style={{ backgroundColor: artworkColor }}>
      {shouldShowImage ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height: '100%' }}
          contentFit="cover"
          transition={180}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <>
          <View
            position="absolute"
            width={size * 0.86}
            height={size * 0.86}
            top={-size * 0.42}
            right={-size * 0.34}
            borderRadius={size}
            backgroundColor="rgba(255,255,255,0.16)"
          />
          <View
            position="absolute"
            width={size * 0.58}
            height={size * 0.58}
            bottom={-size * 0.28}
            left={-size * 0.16}
            borderRadius={size}
            backgroundColor="rgba(0,0,0,0.12)"
          />
          <ThemedText
            color="#FFFFFF"
            fontSize={Math.max(18, size * 0.3)}
            lineHeight={Math.max(22, size * 0.34)}
            fontWeight="800"
            letterSpacing={-0.8}>
            {episodeInitials}
          </ThemedText>
        </>
      )}
      {isBuffering && (
        <Animated.View
          accessible
          accessibilityLabel="Buffering"
          accessibilityLiveRegion="polite"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000000',
            opacity: shimmer,
          }}>
          {size >= 140 && (
            <ThemedText color="#FFFFFF" fontSize={14} fontWeight="700">
              Buffering…
            </ThemedText>
          )}
        </Animated.View>
      )}
    </View>
  );
})
