import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView, YStack } from 'tamagui';

import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { Collapsible } from '@/components/ui/collapsible';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabTwoScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };
  const theme = useTheme();

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
    },
    web: {
      paddingTop: Spacing.six,
      paddingBottom: Spacing.four,
    },
  });
  const contentContainerStyle = {
    ...contentStyles.container,
    ...contentPlatformStyle,
  };

  return (
    <ScrollView
      flex={1}
      backgroundColor="$background"
      contentInset={insets}
      contentContainerStyle={contentContainerStyle}>
      <ThemedView width="100%" maxWidth={MaxContentWidth} flexGrow={1}>
        <ThemedView
          gap={Spacing.three}
          alignItems="center"
          paddingHorizontal={Spacing.four}
          paddingVertical={Spacing.six}
          $compact={{ paddingHorizontal: Spacing.three, paddingVertical: Spacing.five }}
          $short={{ paddingVertical: Spacing.four }}>
          <ThemedText type="subtitle">Explore</ThemedText>
          <ThemedText textAlign="center" themeColor="textSecondary">
            This starter app includes example{`\n`}code to help you get started.
          </ThemedText>

          <ExternalLink href="https://docs.expo.dev" asChild>
            <AppButton borderWidth={0} borderRadius={Spacing.five}>
              <ThemedText type="link">Expo documentation</ThemedText>
              <SymbolView
                tintColor={theme.text}
                name={{ ios: 'arrow.up.right.square', android: 'link', web: 'link' }}
                size={12}
              />
            </AppButton>
          </ExternalLink>
        </ThemedView>

        <YStack
          gap={Spacing.five}
          paddingHorizontal={Spacing.four}
          paddingTop={Spacing.three}
          $compact={{ gap: Spacing.four, paddingHorizontal: Spacing.three }}>
          <Collapsible title="File-based routing">
            <ThemedText type="small">
              This app has two screens: <ThemedText type="code">src/app/index.tsx</ThemedText> and{' '}
              <ThemedText type="code">src/app/explore.tsx</ThemedText>
            </ThemedText>
            <ThemedText type="small">
              The layout file in <ThemedText type="code">src/app/_layout.tsx</ThemedText> sets up
              the tab navigator.
            </ThemedText>
            <ExternalLink href="https://docs.expo.dev/router/introduction">
              <ThemedText type="linkPrimary">Learn more</ThemedText>
            </ExternalLink>
          </Collapsible>

          <Collapsible title="Android, iOS, and web support">
            <ThemedView type="backgroundElement" alignItems="center">
              <ThemedText type="small">
                You can open this project on Android, iOS, and the web. To open the web version,
                press <ThemedText type="smallBold">w</ThemedText> in the terminal running this
                project.
              </ThemedText>
              <Image
                source={require('@/assets/images/tutorial-web.png')}
                style={imageStyles.tutorial}
              />
            </ThemedView>
          </Collapsible>

          <Collapsible title="Images">
            <ThemedText type="small">
              For static images, you can use the <ThemedText type="code">@2x</ThemedText> and{' '}
              <ThemedText type="code">@3x</ThemedText> suffixes to provide files for different
              screen densities.
            </ThemedText>
            <Image source={require('@/assets/images/react-logo.png')} style={imageStyles.react} />
            <ExternalLink href="https://reactnative.dev/docs/images">
              <ThemedText type="linkPrimary">Learn more</ThemedText>
            </ExternalLink>
          </Collapsible>

          <Collapsible title="Light and dark mode components">
            <ThemedText type="small">
              This template has light and dark mode support. The{' '}
              <ThemedText type="code">useColorScheme()</ThemedText> hook lets you inspect what the
              user&apos;s current color scheme is, and so you can adjust UI colors accordingly.
            </ThemedText>
            <ExternalLink href="https://docs.expo.dev/develop/user-interface/color-themes/">
              <ThemedText type="linkPrimary">Learn more</ThemedText>
            </ExternalLink>
          </Collapsible>

          <Collapsible title="Animations">
            <ThemedText type="small">
              This template includes an example of an animated component. The{' '}
              <ThemedText type="code">src/components/ui/collapsible.tsx</ThemedText> component uses
              the powerful <ThemedText type="code">react-native-reanimated</ThemedText> library to
              animate opening this hint.
            </ThemedText>
          </Collapsible>
        </YStack>
        {Platform.OS === 'web' && <WebBadge />}
      </ThemedView>
    </ScrollView>
  );
}

const contentStyles = {
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
} as const;

const imageStyles = {
  tutorial: {
    width: '100%',
    aspectRatio: 296 / 171,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  react: {
    width: 100,
    height: 100,
    alignSelf: 'center',
  },
} as const;
