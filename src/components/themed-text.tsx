import { Platform } from 'react-native';
import { Text, type GetProps } from 'tamagui';

import { Fonts, ThemeColor } from '@/constants/theme';

export type ThemedTextProps = GetProps<typeof Text> & {
  type?:
    | 'default'
    | 'title'
    | 'heading'
    | 'episodeTitle'
    | 'eyebrow'
    | 'metadata'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  return (
    <Text
      color={themeColorTokens[themeColor ?? 'text']}
      style={[
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'heading' && styles.heading,
        type === 'episodeTitle' && styles.episodeTitle,
        type === 'eyebrow' && styles.eyebrow,
        type === 'metadata' && styles.metadata,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const themeColorTokens = {
  background: '$background',
  backgroundElement: '$backgroundElement',
  backgroundSelected: '$backgroundSelected',
  text: '$color',
  textSecondary: '$colorMuted',
  accent: '$accent',
  accentSubtle: '$accentSubtle',
} as const;

const styles = {
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 40,
    fontWeight: 700,
    lineHeight: 46,
    letterSpacing: -1.2,
  },
  heading: {
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 30,
    letterSpacing: -0.35,
  },
  episodeTitle: {
    fontSize: 17,
    fontWeight: 700,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 16,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  metadata: {
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: 700,
    letterSpacing: -0.6,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#6558E8',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
} as const;
