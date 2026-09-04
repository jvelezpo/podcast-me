import { defaultConfig } from '@tamagui/config/v5';
import { createTamagui } from 'tamagui';

const lightTheme = {
  ...defaultConfig.themes.light,
  background: '#FFFFFF',
  backgroundElement: '#F0F0F3',
  backgroundSelected: '#E0E1E6',
  borderColor: '#C7C9D1',
  color: '#000000',
  colorMuted: '#60646C',
  danger: '#C62828',
  dangerHover: '#A91F1F',
};

const darkTheme = {
  ...defaultConfig.themes.dark,
  background: '#000000',
  backgroundElement: '#212225',
  backgroundSelected: '#2E3135',
  borderColor: '#555961',
  color: '#FFFFFF',
  colorMuted: '#B0B4BA',
  danger: '#FF6B6B',
  dangerHover: '#FF8585',
};

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  media: {
    ...defaultConfig.media,
    compact: { maxWidth: 459 },
    wide: { minWidth: 768 },
    short: { maxHeight: 700 },
  },
  settings: {
    ...defaultConfig.settings,
    onlyAllowShorthands: false,
  },
  themes: {
    ...defaultConfig.themes,
    light: lightTheme,
    dark: darkTheme,
  },
});

export type AppTamaguiConfig = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default tamaguiConfig;
