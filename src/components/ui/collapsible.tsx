import { SymbolView } from 'expo-symbols';
import { PropsWithChildren, useState } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { styled } from 'tamagui';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Collapsible({ children, title }: PropsWithChildren & { title: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const theme = useTheme();

  return (
    <ThemedView>
      <AppButton
        tone="ghost"
        width="100%"
        justifyContent="flex-start"
        paddingHorizontal={0}
        onPress={() => setIsOpen((value) => !value)}>
        <ThemedView
          type="backgroundElement"
          width={Spacing.four}
          height={Spacing.four}
          borderRadius={12}
          alignItems="center"
          justifyContent="center">
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={14}
            weight="bold"
            tintColor={theme.text}
            style={{ transform: [{ rotate: isOpen ? '-90deg' : '90deg' }] }}
          />
        </ThemedView>

        <ThemedText type="small">{title}</ThemedText>
      </AppButton>
      {isOpen && (
        <AnimatedView entering={FadeIn.duration(200)}>
          <ThemedView
            type="backgroundElement"
            marginTop={Spacing.three}
            marginLeft={Spacing.four}
            padding={Spacing.four}
            borderRadius={Spacing.three}
            $compact={{ marginLeft: 0, padding: Spacing.three }}>
            {children}
          </ThemedView>
        </AnimatedView>
      )}
    </ThemedView>
  );
}

const AnimatedView = styled(Animated.View, {
  name: 'CollapsibleAnimatedView',
});
