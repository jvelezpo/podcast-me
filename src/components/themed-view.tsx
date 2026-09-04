import { View, type GetProps } from 'tamagui';

import { ThemeColor } from '@/constants/theme';

export type ThemedViewProps = GetProps<typeof View> & {
  type?: ThemeColor;
};

export function ThemedView({ type, ...otherProps }: ThemedViewProps) {
  return <View bg={themeColorTokens[type ?? 'background']} {...otherProps} />;
}

const themeColorTokens = {
  background: '$background',
  backgroundElement: '$backgroundElement',
  backgroundSelected: '$backgroundSelected',
  text: '$color',
  textSecondary: '$colorMuted',
} as const;
