import { version } from 'expo/package.json';
import { Image } from 'expo-image';
import { YStack, useThemeName } from 'tamagui';

import { ThemedText } from './themed-text';

import { Spacing } from '@/constants/theme';

export function WebBadge() {
  const isDark = useThemeName().startsWith('dark');

  return (
    <YStack padding={Spacing.five} alignItems="center" gap={Spacing.two}>
      <ThemedText type="code" themeColor="textSecondary" textAlign="center">
        v{version}
      </ThemedText>
      <Image
        source={
          isDark
            ? require('@/assets/images/expo-badge-white.png')
            : require('@/assets/images/expo-badge.png')
        }
        style={imageStyle}
      />
    </YStack>
  );
}

const imageStyle = { width: 123, aspectRatio: 123 / 24 } as const;
