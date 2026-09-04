import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { TamaguiProvider, Theme } from 'tamagui';

import { tamaguiConfig } from '../../tamagui.config';

export type ThemePreference = 'dark' | 'light' | 'system';

type ThemePreferenceContextValue = {
  preference: ThemePreference;
  resolvedTheme: 'dark' | 'light';
  setPreference: (preference: ThemePreference) => void;
};

const THEME_PREFERENCE_KEY = 'podcast-me.theme-preference.v1';
const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemTheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');

  useEffect(() => {
    void AsyncStorage.getItem(THEME_PREFERENCE_KEY).then((storedPreference) => {
      if (isThemePreference(storedPreference)) {
        setPreferenceState(storedPreference);
      }
    });
  }, []);

  const resolvedTheme =
    preference === 'system' ? (systemTheme === 'light' ? 'light' : 'dark') : preference;
  const navigationTheme = useMemo(() => {
    const baseTheme = resolvedTheme === 'dark' ? DarkTheme : DefaultTheme;
    const colors =
      resolvedTheme === 'dark'
        ? { background: '#090B10', card: '#14171F', primary: '#8B7CFF' }
        : { background: '#F6F7FB', card: '#FFFFFF', primary: '#6558E8' };

    return { ...baseTheme, colors: { ...baseTheme.colors, ...colors } };
  }, [resolvedTheme]);

  const setPreference = (nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference);
    void AsyncStorage.setItem(THEME_PREFERENCE_KEY, nextPreference);
  };

  return (
    <ThemePreferenceContext.Provider value={{ preference, resolvedTheme, setPreference }}>
      <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
        <Theme name={resolvedTheme}>
          <ThemeProvider value={navigationTheme}>
            <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
            {children}
          </ThemeProvider>
        </Theme>
      </TamaguiProvider>
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceContextValue {
  const value = useContext(ThemePreferenceContext);

  if (!value) {
    throw new Error('useThemePreference must be used inside AppThemeProvider.');
  }

  return value;
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}
