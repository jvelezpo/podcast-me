import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, XStack, YStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import { selection } from '@/services/haptics'
import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATE_OPTIONS,
  formatPlaybackRate,
} from '@/utils/playback-rate'

export type SpeedSheetProps = {
  currentRate: number
  onSelect: (rate: number) => void
  onClose: () => void
}

/**
 * Playback-speed sheet shared by the local and remote player surfaces:
 * 0.5×–3× presets plus Reset, replacing the old cycling speed button. The
 * chosen rate applies live and is remembered per show by the caller.
 */
export function SpeedSheet({ currentRate, onSelect, onClose }: SpeedSheetProps) {
  const theme = useTheme()

  const handleSelect = (rate: number) => {
    selection()
    onSelect(rate)
  }

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
            <ThemedText type="heading">Playback speed</ThemedText>
            <AppButton
              tone="icon"
              accessibilityLabel="Close speed options"
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
              accessibilityLabel="Playback speed options"
              gap={Spacing.two}
            >
              {PLAYBACK_RATE_OPTIONS.map((rate) => {
                const isSelected = currentRate === rate

                return (
                  <AppButton
                    key={rate}
                    tone="outlined"
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={
                      isSelected
                        ? `Playback speed ${formatPlaybackRate(rate)}, selected`
                        : `Set playback speed to ${formatPlaybackRate(rate)}`
                    }
                    onPress={() => handleSelect(rate)}
                    width="100%"
                    minHeight={48}
                    justifyContent="space-between"
                    paddingHorizontal={Spacing.three}
                    borderColor={isSelected ? '$accent' : '$borderColor'}
                    backgroundColor={
                      isSelected ? '$accentSubtle' : 'transparent'
                    }
                  >
                    <ThemedText
                      type="smallBold"
                      color={isSelected ? theme.accent : theme.text}
                    >
                      {formatPlaybackRate(rate)}
                      {rate === DEFAULT_PLAYBACK_RATE ? ' · Normal' : null}
                    </ThemedText>
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
            </YStack>
            <AppButton
              tone="secondary"
              accessibilityLabel="Reset playback speed to 1 times"
              accessibilityHint="Clears any custom speed back to normal"
              onPress={() => handleSelect(DEFAULT_PLAYBACK_RATE)}
              width="100%"
              minHeight={48}
            >
              <ThemedText type="smallBold">Reset</ThemedText>
            </AppButton>
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
