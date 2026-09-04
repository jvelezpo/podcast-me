import type { ReactNode } from 'react';
import { XStack } from 'tamagui';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Spacing } from '@/constants/theme';

type HintRowProps = {
  title?: string;
  hint?: ReactNode;
};

export function HintRow({ title = 'Try editing', hint = 'app/index.tsx' }: HintRowProps) {
  return (
    <XStack
      justifyContent="space-between"
      gap={Spacing.two}
      $compact={{ flexDirection: 'column' }}>
      <ThemedText type="small">{title}</ThemedText>
      <ThemedView
        type="backgroundSelected"
        borderRadius={Spacing.two}
        paddingVertical={Spacing.half}
        paddingHorizontal={Spacing.two}>
        <ThemedText themeColor="textSecondary">{hint}</ThemedText>
      </ThemedView>
    </XStack>
  );
}
