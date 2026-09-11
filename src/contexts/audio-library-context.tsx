import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useState,
} from 'react'

import { useAudioLibrary } from '@/hooks/use-audio-library'
import { useAudioLibraryPlayer } from '@/hooks/use-audio-library-player'
import type { LoadedAudioItem } from '@/services/audio-library-storage'

type AudioLibraryContextValue = {
  library: ReturnType<typeof useAudioLibrary>
  playback: ReturnType<typeof useAudioLibraryPlayer>
  isPlayerOpen: boolean
  playerItemId: string | null
  openPlayer: (item: LoadedAudioItem) => void
  closePlayer: () => void
}

const AudioLibraryContext = createContext<AudioLibraryContextValue | null>(null)

export function AudioLibraryProvider({ children }: PropsWithChildren) {
  const library = useAudioLibrary()
  const playback = useAudioLibraryPlayer(
    library.updateAudioItem,
    !library.isLoading,
  )
  const [isPlayerOpen, setIsPlayerOpen] = useState(false)
  const [playerItemId, setPlayerItemId] = useState<string | null>(null)
  const openPlayer = useCallback((item: LoadedAudioItem) => {
    setPlayerItemId(item.id)
    setIsPlayerOpen(true)
  }, [])
  const closePlayer = useCallback(() => {
    setIsPlayerOpen(false)
    setPlayerItemId(null)
  }, [])

  return (
    <AudioLibraryContext.Provider
      value={{
        library,
        playback,
        isPlayerOpen,
        playerItemId,
        openPlayer,
        closePlayer,
      }}
    >
      {children}
    </AudioLibraryContext.Provider>
  )
}

export function useAudioLibraryContext(): AudioLibraryContextValue {
  const value = useContext(AudioLibraryContext)

  if (!value) {
    throw new Error(
      'useAudioLibraryContext must be used inside AudioLibraryProvider.',
    )
  }

  return value
}
