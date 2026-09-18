import {
  TabList,
  TabSlot,
  TabTrigger,
  Tabs,
  type TabListProps,
  type TabTriggerSlotProps,
} from 'expo-router/ui'
import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { View, YStack, type GetProps } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="library" href="/" asChild>
            <TabButton icon={LIBRARY_ICON}>Library</TabButton>
          </TabTrigger>
          <TabTrigger name="playlists" href="/playlists" asChild>
            <TabButton icon={PLAYLIST_ICON}>Playlists</TabButton>
          </TabTrigger>
          <TabTrigger name="discover" href="/explore" asChild>
            <TabButton icon={DISCOVER_ICON}>Discover</TabButton>
          </TabTrigger>
          <TabTrigger name="search" href="/search" asChild>
            <TabButton icon={SEARCH_ICON}>Search</TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton icon={PROFILE_ICON}>Profile</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  )
}

type TabButtonProps = TabTriggerSlotProps & {
  children: string
  icon: SymbolViewProps['name']
}

export function TabButton({
  children,
  icon,
  isFocused,
  ...props
}: TabButtonProps) {
  const buttonProps = props as unknown as GetProps<typeof AppButton>
  const theme = useTheme()

  return (
    <AppButton
      {...buttonProps}
      tone="ghost"
      minWidth={74}
      minHeight={54}
      flex={1}
      paddingVertical={Spacing.one}
      paddingHorizontal={Spacing.two}
      backgroundColor={isFocused ? '$accentSubtle' : 'transparent'}
    >
      <YStack alignItems="center" gap={Spacing.half}>
        <SymbolView
          name={icon}
          size={20}
          tintColor={isFocused ? theme.accent : theme.textSecondary}
          weight={isFocused ? 'bold' : 'medium'}
        />
        <ThemedText
          type="metadata"
          color={isFocused ? '$accent' : '$colorMuted'}
          fontWeight={isFocused ? '700' : '600'}
        >
          {children}
        </ThemedText>
      </YStack>
    </AppButton>
  )
}

export function CustomTabList(props: TabListProps) {
  const viewProps = props as unknown as GetProps<typeof View>

  return (
    <View
      {...viewProps}
      position="absolute"
      zIndex={40}
      right={Spacing.three}
      bottom={Spacing.three}
      left={Spacing.three}
      alignItems="center"
    >
      <ThemedView
        type="backgroundElement"
        width="100%"
        maxWidth={720}
        flexDirection="row"
        alignItems="center"
        gap={Spacing.one}
        padding={Spacing.one}
        borderWidth={1}
        borderColor="$borderColor"
        borderRadius={Radius.large}
        boxShadow="0 12px 32px rgba(0,0,0,0.22)"
      >
        {props.children}
      </ThemedView>
    </View>
  )
}

const LIBRARY_ICON: SymbolViewProps['name'] = {
  ios: 'books.vertical.fill',
  android: 'library_music',
  web: 'library_music',
}
const PLAYLIST_ICON: SymbolViewProps['name'] = {
  ios: 'music.note.list',
  android: 'queue_music',
  web: 'queue_music',
}
const DISCOVER_ICON: SymbolViewProps['name'] = {
  ios: 'safari.fill',
  android: 'explore',
  web: 'explore',
}
const SEARCH_ICON: SymbolViewProps['name'] = {
  ios: 'magnifyingglass',
  android: 'search',
  web: 'search',
}
const PROFILE_ICON: SymbolViewProps['name'] = {
  ios: 'person.crop.circle.fill',
  android: 'person',
  web: 'person',
}
