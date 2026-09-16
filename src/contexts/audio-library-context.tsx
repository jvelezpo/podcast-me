import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useState,
} from 'react'

import { useAudioLibrary } from '@/hooks/use-audio-library'
import { useAudioLibraryPlayer } from '@/hooks/use-audio-library-player'
import { useRemoteAudioPlayer } from '@/hooks/use-remote-audio-player'
import { useAuth } from '@/contexts/auth-context'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import type { RemoteAudio } from '@/services/api'

type PlayerItem =
  | { kind: 'local'; item: LoadedAudioItem }
  | { kind: 'remote'; audio: RemoteAudio }

type AudioLibraryContextValue = {
  library: ReturnType<typeof useAudioLibrary>
  playback: ReturnType<typeof useAudioLibraryPlayer>
  remotePlayback: ReturnType<typeof useRemoteAudioPlayer>
  isPlayerOpen: boolean
  playerItem: PlayerItem | null
  openPlayer: (item: LoadedAudioItem) => void
  openRemotePlayer: (audio: RemoteAudio) => void
  closePlayer: () => void
}

const AudioLibraryContext = createContext<AudioLibraryContextValue | null>(null)

export function AudioLibraryProvider({ children }: PropsWithChildren) {
  const {
    getRemoteAudioStreamSource,
    getRemotePlaybackProgress,
    recordRemoteAudioPlayback,
    sendRemotePlaybackEvent,
  } = useAuth()
  const library = useAudioLibrary()
  const playback = useAudioLibraryPlayer(
    library.updateAudioItem,
    !library.isLoading,
  )
  const remotePlayback = useRemoteAudioPlayer(
    getRemoteAudioStreamSource,
    recordRemoteAudioPlayback,
    getRemotePlaybackProgress,
    sendRemotePlaybackEvent,
  )
  const [isPlayerOpen, setIsPlayerOpen] = useState(false)
  const [playerItem, setPlayerItem] = useState<PlayerItem | null>(null)
  const openPlayer = useCallback((item: LoadedAudioItem) => {
    setPlayerItem({ kind: 'local', item })
    setIsPlayerOpen(true)
  }, [])
  const openRemotePlayer = useCallback((audio: RemoteAudio) => {
    setPlayerItem({ kind: 'remote', audio })
    setIsPlayerOpen(true)
  }, [])
  const closePlayer = useCallback(() => {
    setIsPlayerOpen(false)
    setPlayerItem(null)
  }, [])

  return (
    <AudioLibraryContext.Provider
      value={{
        library,
        playback,
        remotePlayback,
        isPlayerOpen,
        playerItem,
        openPlayer,
        openRemotePlayer,
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
