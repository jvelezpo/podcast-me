import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { Modal, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { YStack, XStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'

export type RowAction = {
  key: string
  label: string
  icon: SymbolViewProps['name']
  disabled: boolean
  destructive?: boolean
  onPress: () => void
}

type RowActionSheetProps = {
  title: string
  actions: RowAction[]
  onClose: () => void
}

export function RowActionSheet({
  title,
  actions,
  onClose,
}: RowActionSheetProps) {
  const theme = useTheme()

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={onClose}
    >
      <ThemedView flex={1}>
        <SafeAreaView style={styles.safeArea}>
          <YStack
            width="100%"
            maxWidth={640}
            alignSelf="center"
            gap={Spacing.two}
            paddingHorizontal={Spacing.three}
            paddingTop={Spacing.three}
            paddingBottom={Spacing.five}
          >
            <XStack alignItems="center" justifyContent="space-between">
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                flex={1}
                minWidth={0}
              >
                {title}
              </ThemedText>
              <AppButton
                tone="icon"
                accessibilityLabel="Close options"
                onPress={onClose}
              >
                <SymbolView
                  name={CLOSE_ICON}
                  size={18}
                  tintColor={theme.textSecondary}
                />
              </AppButton>
            </XStack>
            {actions.map((action) => (
              <AppButton
                key={action.key}
                tone="ghost"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={() => {
                  onClose()
                  action.onPress()
                }}
                minHeight={52}
                justifyContent="flex-start"
                paddingHorizontal={Spacing.two}
              >
                <SymbolView
                  name={action.icon}
                  size={20}
                  tintColor={
                    action.destructive ? theme.danger : theme.text
                  }
                />
                <ThemedText
                  type="default"
                  color={action.destructive ? '$danger' : undefined}
                >
                  {action.label}
                </ThemedText>
              </AppButton>
            ))}
          </YStack>
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

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
})
