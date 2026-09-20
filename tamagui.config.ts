import { defaultConfig } from '@tamagui/config/v5';
import { createTamagui } from 'tamagui';

const lightTheme = {
  ...defaultConfig.themes.light,
  background: '#F6F7FB',
  backgroundElement: '#FFFFFF',
  backgroundSelected: '#ECEFF5',
  borderColor: '#E1E5ED',
  color: '#151821',
  // Audited ≥ 4.5:1 against white, app background, selected, and
  // accent-subtle surfaces (see tests/contrast.test.js).
  colorMuted: '#5D6779',
  accent: '#6558E8',
  accentHover: '#574ACF',
  accentForeground: '#FFFFFF',
  accentSubtle: '#ECEAFF',
  danger: '#D83B45',
  dangerHover: '#BD2F38',
  success: '#148A65',
  warning: '#B66A0A',
};

const darkTheme = {
  ...defaultConfig.themes.dark,
  background: '#090B10',
  backgroundElement: '#14171F',
  backgroundSelected: '#1D212C',
  borderColor: '#292E3A',
  color: '#F7F8FA',
  colorMuted: '#9AA3B2',
  accent: '#8B7CFF',
  accentHover: '#9D91FF',
  accentForeground: '#0C091D',
  accentSubtle: '#252044',
  danger: '#FF6B73',
  dangerHover: '#FF8188',
  success: '#45C99B',
  warning: '#F4B860',
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
