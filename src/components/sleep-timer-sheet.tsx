import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, XStack, YStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import { selection } from '@/services/haptics'

const SLEEP_TIMER_SHEET_OPTIONS = [
  { label: '5 minutes', shortLabel: '5m', minutes: 5 },
  { label: '10 minutes', shortLabel: '10m', minutes: 10 },
  { label: '15 minutes', shortLabel: '15m', minutes: 15 },
  { label: '30 minutes', shortLabel: '30m', minutes: 30 },
  { label: '45 minutes', shortLabel: '45m', minutes: 45 },
  { label: '1 hour', shortLabel: '1h', minutes: 60 },
] as const

export type SleepTimerSheetProps = {
  endsAt: number | null
  durationMinutes: number | null
  remaining: string | null
  endOfEpisodeArmed: boolean
  onSetMinutes: (minutes: number) => void
  onSetEndOfEpisode: () => void
  onClear: () => void
  onClose: () => void
}

/**
 * Spotify-style sleep timer sheet shared by the local and remote player
 * surfaces. Replaces the old inline card: a compact moon trigger next to the
 * transport opens this list, timed presets show the live remaining label on
 * the selected row, and an active timer gets a "Turn off timer" footer.
 */
export function SleepTimerSheet({
  endsAt,
  durationMinutes,
  remaining,
  endOfEpisodeArmed,
  onSetMinutes,
  onSetEndOfEpisode,
  onClear,
  onClose,
}: SleepTimerSheetProps) {
  const theme = useTheme()
  const isActive = endsAt !== null || endOfEpisodeArmed

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={onClose}
    >
      <ThemedView flex={1}>
        <SafeAreaView style={{ flex: 1 }}>
          <XStack
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal={Spacing.three}
            paddingVertical={Spacing.two}
          >
            <YStack gap={2}>
              <ThemedText type="heading">Sleep timer</ThemedText>
              <ThemedText type="metadata" themeColor="textSecondary">
                {remaining
                  ? `Playback pauses in ${remaining}`
                  : endOfEpisodeArmed
                    ? 'Stops at the end of this episode'
                    : 'Playback pauses automatically'}
              </ThemedText>
            </YStack>
            <AppButton
              tone="icon"
              accessibilityLabel="Close sleep timer options"
              onPress={onClose}
            >
              <SymbolView
                name={CLOSE_ICON}
                size={20}
                tintColor={theme.textSecondary}
              />
            </AppButton>
          </XStack>
          <ScrollView
            flex={1}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              width: '100%',
              maxWidth: 640,
              alignSelf: 'center',
              paddingHorizontal: Spacing.three,
              paddingBottom: Spacing.five,
              gap: Spacing.two,
            }}
          >
            <YStack
              accessibilityRole="radiogroup"
              accessibilityLabel="Sleep timer options"
              gap={Spacing.two}
            >
              {SLEEP_TIMER_SHEET_OPTIONS.map((option) => {
                const isSelected = durationMinutes === option.minutes

                return (
                  <AppButton
                    key={option.minutes}
                    tone="outlined"
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={
                      isSelected && remaining
                        ? `${option.label}, selected, ${remaining} left`
                        : `Set sleep timer for ${option.label}`
                    }
                    onPress={() => {
                      selection()
                      onSetMinutes(option.minutes)
                    }}
                    width="100%"
                    minHeight={56}
                    justifyContent="space-between"
                    paddingHorizontal={Spacing.three}
                    borderColor={isSelected ? '$accent' : '$borderColor'}
                    backgroundColor={
                      isSelected ? '$accentSubtle' : 'transparent'
                    }
                  >
                    <YStack alignItems="flex-start" gap={2} flex={1}>
                      <ThemedText
                        type="smallBold"
                        color={isSelected ? theme.accent : theme.text}
                      >
                        {option.label}
                      </ThemedText>
                      {isSelected && remaining ? (
                        <ThemedText type="metadata" themeColor="accent">
                          {remaining} left
                        </ThemedText>
                      ) : null}
                    </YStack>
                    {isSelected && (
                      <SymbolView
                        name={CHECK_ICON}
                        size={18}
                        tintColor={theme.accent}
                        weight="bold"
                      />
                    )}
                  </AppButton>
                )
              })}

              <AppButton
                tone="outlined"
                accessibilityRole="radio"
                accessibilityState={{ selected: endOfEpisodeArmed }}
                accessibilityLabel={
                  endOfEpisodeArmed
                    ? 'End of episode, selected. Playback stops at the end of this episode.'
                    : 'Set sleep timer to stop at the end of this episode'
                }
                onPress={() => {
                  selection()
                  onSetEndOfEpisode()
                }}
                width="100%"
                minHeight={56}
                justifyContent="space-between"
                paddingHorizontal={Spacing.three}
                borderColor={endOfEpisodeArmed ? '$accent' : '$borderColor'}
                backgroundColor={
                  endOfEpisodeArmed ? '$accentSubtle' : 'transparent'
                }
              >
                <YStack alignItems="flex-start" gap={2} flex={1}>
                  <ThemedText
                    type="smallBold"
                    color={endOfEpisodeArmed ? theme.accent : theme.text}
                  >
                    End of episode
                  </ThemedText>
                  <ThemedText
                    type="metadata"
                    themeColor={
                      endOfEpisodeArmed ? 'accent' : 'textSecondary'
                    }
                  >
                    Stops when this episode ends
                  </ThemedText>
                </YStack>
                {endOfEpisodeArmed && (
                  <SymbolView
                    name={CHECK_ICON}
                    size={18}
                    tintColor={theme.accent}
                    weight="bold"
                  />
                )}
              </AppButton>
            </YStack>

            {isActive && (
              <AppButton
                tone="secondary"
                accessibilityLabel="Turn off sleep timer"
                accessibilityHint="Clears the sleep timer so playback continues"
                onPress={() => {
                  selection()
                  onClear()
                }}
                width="100%"
                minHeight={48}
              >
                <ThemedText type="smallBold">Turn off timer</ThemedText>
              </AppButton>
            )}
            <View height={Spacing.two} />
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  )
}

const CLOSE_ICON: SymbolViewProps['name'] = {
  ios: 'xmark',
  android: 'close',
  web: 'close',
}
const CHECK_ICON: SymbolViewProps['name'] = {
  ios: 'checkmark',
  android: 'check',
  web: 'check',
}
