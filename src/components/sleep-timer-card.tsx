import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { memo } from 'react'
import { View, XStack, YStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import { selection } from '@/services/haptics'

const SLEEP_TIMER_OPTIONS = [
  { label: '5m', minutes: 5 },
  { label: '10m', minutes: 10 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
] as const

export type SleepTimerCardProps = {
  endsAt: number | null
  durationMinutes: number | null
  remaining: string | null
  endOfEpisodeArmed: boolean
  onSetMinutes: (minutes: number) => void
  onSetEndOfEpisode: () => void
  onClear: () => void
}

/**
 * Sleep timer card shared by the local and remote player surfaces: timed
 * presets plus an End-of-episode preset that stops autoplay into the next
 * file instead of pausing mid-episode.
 *
 * Memoized (§P3): the 1 Hz sleep countdown lives in the parent, but the
 * formatted `remaining` label only changes per minute — memo prevents the
 * card (and its preset buttons) reconciling on every second tick.
 */
export const SleepTimerCard = memo(function SleepTimerCard({
  endsAt,
  durationMinutes,
  remaining,
  endOfEpisodeArmed,
  onSetMinutes,
  onSetEndOfEpisode,
  onClear,
}: SleepTimerCardProps) {
  const theme = useTheme()
  const isActive = endsAt !== null || endOfEpisodeArmed

  return (
    <ThemedView
      type="backgroundElement"
      width="100%"
      gap={Spacing.three}
      padding={Spacing.three}
      borderWidth={1}
      borderColor={isActive ? '$accent' : '$borderColor'}
      borderRadius={Radius.large}
    >
      <XStack alignItems="center" gap={Spacing.two}>
        <View
          width={42}
          height={42}
          alignItems="center"
          justifyContent="center"
          borderRadius={Radius.round}
          backgroundColor={isActive ? '$accentSubtle' : '$backgroundSelected'}
        >
          <SymbolView
            name={SLEEP_ICON}
            size={21}
            tintColor={isActive ? theme.accent : theme.textSecondary}
            weight="semibold"
          />
        </View>
        <YStack flex={1} gap={Spacing.half}>
          <ThemedText type="smallBold">Sleep timer</ThemedText>
          {remaining ? (
            <YStack gap={Spacing.half}>
              <ThemedText type="metadata" themeColor="accent">
                Playback pauses in
              </ThemedText>
              <ThemedText
                type="heading"
                themeColor="accent"
                fontSize={20}
                lineHeight={24}
                accessibilityLabel={`Sleep Timer: ${remaining}`}
                accessibilityLiveRegion="polite"
              >
                {remaining}
              </ThemedText>
            </YStack>
          ) : endOfEpisodeArmed ? (
            <ThemedText type="metadata" themeColor="accent">
              Stops at the end of this episode
            </ThemedText>
          ) : (
            <ThemedText type="metadata" themeColor="textSecondary">
              Choose when playback should pause
            </ThemedText>
          )}
        </YStack>
        {isActive && (
          <AppButton
            tone="icon"
            accessibilityLabel="Cancel sleep timer"
            onPress={() => {
              selection()
              onClear()
            }}
            borderWidth={1}
            borderColor="$accent"
            backgroundColor="$accentSubtle"
          >
            <SymbolView
              name={CLEAR_TIMER_ICON}
              size={18}
              tintColor={theme.accent}
              weight="semibold"
            />
          </AppButton>
        )}
      </XStack>

      <XStack
        accessibilityRole="radiogroup"
        width="100%"
        gap={Spacing.one}
        padding={Spacing.one}
        borderRadius={Radius.round}
        backgroundColor="$backgroundSelected"
      >
        {SLEEP_TIMER_OPTIONS.map((option) => {
          const isSelected = durationMinutes === option.minutes

          return (
            <AppButton
              key={option.minutes}
              tone="outlined"
              accessibilityLabel={
                isSelected && remaining
                  ? `Sleep Timer: ${remaining}`
                  : `Set sleep timer for ${option.label}`
              }
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              onPress={() => {
                selection()
                onSetMinutes(option.minutes)
              }}
              flex={1}
              minWidth={0}
              minHeight={44}
              paddingHorizontal={0}
              paddingVertical={Spacing.two}
              borderWidth={0}
              backgroundColor={isSelected ? '$accent' : 'transparent'}
            >
              <ThemedText
                type="smallBold"
                color={isSelected ? theme.accentForeground : theme.text}
              >
                {option.label}
              </ThemedText>
            </AppButton>
          )
        })}
      </XStack>

      <AppButton
        tone="outlined"
        accessibilityLabel={
          endOfEpisodeArmed
            ? 'Sleep timer stops at the end of this episode'
            : 'Set sleep timer to stop at the end of this episode'
        }
        accessibilityRole="radio"
        accessibilityState={{ selected: endOfEpisodeArmed }}
        onPress={() => {
          selection()
          onSetEndOfEpisode()
        }}
        width="100%"
        minHeight={44}
        borderWidth={0}
        backgroundColor={endOfEpisodeArmed ? '$accent' : '$backgroundSelected'}
      >
        <ThemedText
          type="smallBold"
          color={endOfEpisodeArmed ? theme.accentForeground : theme.text}
        >
          End of episode
        </ThemedText>
      </AppButton>
    </ThemedView>
  )
})

const SLEEP_ICON: SymbolViewProps['name'] = {
  ios: 'moon.zzz.fill',
  android: 'bedtime',
  web: 'bedtime',
}
const CLEAR_TIMER_ICON: SymbolViewProps['name'] = {
  ios: 'xmark',
  android: 'close',
  web: 'close',
}
