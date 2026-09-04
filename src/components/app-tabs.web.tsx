import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  type TabTriggerSlotProps,
  type TabListProps,
} from 'expo-router/ui';
import { SymbolView } from 'expo-symbols';
import { View, XStack, type GetProps } from 'tamagui';

import { ExternalLink } from './external-link';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { AppButton } from './ui/app-button';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="explore" href="/explore" asChild>
            <TabButton>Explore</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const buttonProps = props as unknown as GetProps<typeof AppButton>;

  return (
    <AppButton
      {...buttonProps}
      tone="ghost"
      minHeight={36}
      paddingVertical={Spacing.one}
      paddingHorizontal={Spacing.three}
      backgroundColor={isFocused ? '$backgroundSelected' : 'transparent'}>
      <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
        {children}
      </ThemedText>
    </AppButton>
  );
}

export function CustomTabList(props: TabListProps) {
  const theme = useTheme();
  const viewProps = props as unknown as GetProps<typeof View>;

  return (
    <View
      {...viewProps}
      position="absolute"
      width="100%"
      padding={Spacing.three}
      alignItems="center"
      justifyContent="center"
      flexDirection="row"
      $compact={{ padding: Spacing.two }}>
      <ThemedView
        type="backgroundElement"
        maxWidth={MaxContentWidth}
        flexGrow={1}
        flexDirection="row"
        alignItems="center"
        gap={Spacing.two}
        paddingVertical={Spacing.two}
        paddingHorizontal={Spacing.five}
        borderRadius={Spacing.five}
        $compact={{ paddingHorizontal: Spacing.two }}>
        <ThemedText type="smallBold" marginRight="auto" $compact={{ display: 'none' }}>
          Podcast Me
        </ThemedText>

        {props.children}

        <ExternalLink href="https://docs.expo.dev" asChild>
          <AppButton tone="ghost" minHeight={36} paddingHorizontal={Spacing.one}>
            <XStack alignItems="center" gap={Spacing.one}>
              <ThemedText type="link" $compact={{ display: 'none' }}>
                Docs
              </ThemedText>
              <SymbolView
                tintColor={theme.text}
                name={{ ios: 'arrow.up.right.square', web: 'link' }}
                size={12}
              />
            </XStack>
          </AppButton>
        </ExternalLink>
      </ThemedView>
    </View>
  );
}
