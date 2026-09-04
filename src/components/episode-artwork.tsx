import { View } from 'tamagui';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { getArtworkColor, getEpisodeInitials } from '@/utils/audio-display';

type EpisodeArtworkProps = {
  itemId: string;
  name: string;
  size?: number;
};

export function EpisodeArtwork({ itemId, name, size = 72 }: EpisodeArtworkProps) {
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
      style={{ backgroundColor: getArtworkColor(itemId) }}>
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
        {getEpisodeInitials(name)}
      </ThemedText>
    </View>
  );
}
