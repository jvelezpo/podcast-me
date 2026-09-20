import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { memo, useCallback } from 'react';
import { View, XStack, YStack } from 'tamagui';

import { EpisodeArtwork } from '@/components/episode-artwork';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { LoadedAudioItem } from '@/services/audio-library-storage';
import { formatEpisodeDate, formatPlaybackTime, getEpisodeTitle } from '@/utils/audio-display';

type EpisodeResultRowProps = {
  item: LoadedAudioItem;
  isActive: boolean;
  isPlaying: boolean;
  isTransitioning: boolean;
  isPlaybackReady: boolean;
  onTogglePlayback: (item: LoadedAudioItem) => void;
};

export const EpisodeResultRow = memo(function EpisodeResultRow({
  item,
  isActive,
  isPlaying,
  isTransitioning,
  isPlaybackReady,
  onTogglePlayback,
}: EpisodeResultRowProps) {
  const theme = useTheme();
  const title = getEpisodeTitle(item.originalName);
  const isDisabled = !isPlaybackReady || !item.isAvailable || isTransitioning;
  const handleToggle = useCallback(
    () => onTogglePlayback(item),
    [item, onTogglePlayback],
  );

  return (
    <ThemedView
      type="backgroundElement"
      overflow="hidden"
      borderWidth={1}
      borderColor={isActive ? '$accent' : '$borderColor'}
      borderRadius={Radius.medium}>
      <XStack alignItems="center" gap={Spacing.three} padding={Spacing.three}>
        <EpisodeArtwork itemId={item.id} name={item.originalName} size={58} />
        <YStack flex={1} minWidth={0} gap={Spacing.one}>
          <ThemedText type="episodeTitle" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText type="metadata" themeColor="textSecondary" numberOfLines={1}>
            Podcast Me · {formatEpisodeDate(item.addedAt)}
          </ThemedText>
          <XStack alignItems="center" gap={Spacing.one}>
            <View width={7} height={7} borderRadius={7} backgroundColor="$success" />
            <ThemedText type="metadata" themeColor="textSecondary">
              Downloaded · {formatPlaybackTime(item.durationSeconds)}
            </ThemedText>
          </XStack>
        </YStack>
        <AppButton
          tone="icon"
          accessibilityLabel={`${isActive && isPlaying ? 'Pause' : 'Play'} ${title}`}
          accessibilityState={{ disabled: isDisabled }}
          disabled={isDisabled}
          onPress={handleToggle}
          backgroundColor={isActive ? '$accent' : '$backgroundSelected'}>
          <SymbolView
            name={isActive && isPlaying ? PAUSE_ICON : PLAY_ICON}
            size={21}
            tintColor={isActive ? theme.accentForeground : theme.text}
            weight="bold"
          />
        </AppButton>
      </XStack>
    </ThemedView>
  );
})

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
