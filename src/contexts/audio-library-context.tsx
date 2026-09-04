import { createContext, type PropsWithChildren, useContext } from 'react';

import { useAudioLibrary } from '@/hooks/use-audio-library';
import { useAudioLibraryPlayer } from '@/hooks/use-audio-library-player';

type AudioLibraryContextValue = {
  library: ReturnType<typeof useAudioLibrary>;
  playback: ReturnType<typeof useAudioLibraryPlayer>;
};

const AudioLibraryContext = createContext<AudioLibraryContextValue | null>(null);

export function AudioLibraryProvider({ children }: PropsWithChildren) {
  const library = useAudioLibrary();
  const playback = useAudioLibraryPlayer(library.updateAudioItem, !library.isLoading);

  return (
    <AudioLibraryContext.Provider value={{ library, playback }}>
      {children}
    </AudioLibraryContext.Provider>
  );
}

export function useAudioLibraryContext(): AudioLibraryContextValue {
  const value = useContext(AudioLibraryContext);

  if (!value) {
    throw new Error('useAudioLibraryContext must be used inside AudioLibraryProvider.');
  }

  return value;
}
