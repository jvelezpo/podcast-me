import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { memo } from 'react'
import { View, XStack, YStack } from 'tamagui'

import { EpisodeArtwork } from '@/components/episode-artwork'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import { formatPlaybackTime, getAudioItemTitle } from '@/utils/audio-display'

type ResumeHeroProps = {
  item: LoadedAudioItem
  positionSeconds: number
  durationSeconds: number | null
  isResumeDisabled: boolean
  onResume: () => void
}

export const ResumeHero = memo(function ResumeHero({
  item,
  positionSeconds,
  durationSeconds,
  isResumeDisabled,
  onResume,
}: ResumeHeroProps) {
  const theme = useTheme()
  const title = getAudioItemTitle(item)
  const remainingSeconds =
    durationSeconds === null
      ? null
      : Math.max(0, durationSeconds - positionSeconds)
  const progress =
    durationSeconds !== null && durationSeconds > 0
      ? Math.min(Math.max(positionSeconds / durationSeconds, 0), 1)
      : 0
  const positionLabel =
    durationSeconds === null
      ? formatPlaybackTime(positionSeconds)
      : `${formatPlaybackTime(positionSeconds)} of ${formatPlaybackTime(durationSeconds)}`

  return (
    <ThemedView
      type="backgroundElement"
      gap={Spacing.three}
      padding={Spacing.three}
      borderWidth={1}
      borderColor="$accent"
      borderRadius={Radius.large}
    >
      <XStack alignItems="center" gap={Spacing.three}>
        <EpisodeArtwork
          imageUrl={item.metadata.coverArtUrl}
          itemId={item.id}
          name={title}
          size={56}
        />
        <YStack flex={1} minWidth={0} gap={Spacing.half}>
          <ThemedText type="eyebrow" themeColor="accent">
            Continue listening
          </ThemedText>
          <ThemedText type="episodeTitle" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText
            type="metadata"
            themeColor="textSecondary"
            numberOfLines={1}
          >
            {positionLabel}
            {remainingSeconds !== null
              ? ` · ${formatPlaybackTime(remainingSeconds)} left`
              : null}
          </ThemedText>
        </YStack>
      </XStack>
      <View
        height={4}
        borderRadius={4}
        backgroundColor="$backgroundSelected"
        accessibilityElementsHidden
      >
        <View
          height="100%"
          width={`${progress * 100}%`}
          borderRadius={4}
          backgroundColor="$accent"
        />
      </View>
      <AppButton
        accessibilityLabel={`Resume ${title} from ${formatPlaybackTime(positionSeconds)}`}
        accessibilityHint="Starts playback from where you left off"
        disabled={isResumeDisabled}
        onPress={onResume}
        minHeight={48}
      >
        <SymbolView
          name={RESUME_ICON}
          size={18}
          tintColor={theme.accentForeground}
          weight="bold"
        />
        <ThemedText type="smallBold" color="$accentForeground">
          Resume
        </ThemedText>
      </AppButton>
    </ThemedView>
  )
})

const RESUME_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
}
