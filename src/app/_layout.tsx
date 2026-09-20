import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { GlobalPlayer } from '@/components/global-player';
import { ToastCenter } from '@/components/toast-center';
import { AudioLibraryProvider } from '@/contexts/audio-library-context';
import { AuthProvider } from '@/contexts/auth-context';
import { AppThemeProvider } from '@/contexts/theme-preference-context';

import '@/global.css';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  return (
    <AppThemeProvider>
      <AuthProvider>
        <AudioLibraryProvider>
          <AnimatedSplashOverlay />
          <AppTabs />
          <GlobalPlayer />
          <ToastCenter />
        </AudioLibraryProvider>
      </AuthProvider>
    </AppThemeProvider>
  );
}
