import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useRef,
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

export type AutoAdvanceHandlers = {
  onLocalFinished?: (finishedItemId: string) => void
  onRemoteFinished?: (finishedAudioId: string) => void
}

type AudioLibraryContextValue = {
  library: ReturnType<typeof useAudioLibrary>
  playback: ReturnType<typeof useAudioLibraryPlayer>
  remotePlayback: ReturnType<typeof useRemoteAudioPlayer>
  isPlayerOpen: boolean
  playerItem: PlayerItem | null
  openPlayer: (item: LoadedAudioItem) => void
  openRemotePlayer: (audio: RemoteAudio) => void
  closePlayer: () => void
  setAutoAdvanceHandlers: (handlers: AutoAdvanceHandlers) => void
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
  const autoAdvanceRef = useRef<AutoAdvanceHandlers>({})
  const setAutoAdvanceHandlers = useCallback(
    (handlers: AutoAdvanceHandlers) => {
      autoAdvanceRef.current = handlers
    },
    [],
  )
  const handleLocalFinished = useCallback((finishedItemId: string) => {
    autoAdvanceRef.current.onLocalFinished?.(finishedItemId)
  }, [])
  const handleRemoteFinished = useCallback((finishedAudioId: string) => {
    autoAdvanceRef.current.onRemoteFinished?.(finishedAudioId)
  }, [])
  const playback = useAudioLibraryPlayer(
    library.updateAudioItem,
    !library.isLoading,
    handleLocalFinished,
  )
  const remotePlayback = useRemoteAudioPlayer(
    getRemoteAudioStreamSource,
    recordRemoteAudioPlayback,
    getRemotePlaybackProgress,
    sendRemotePlaybackEvent,
    handleRemoteFinished,
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
        setAutoAdvanceHandlers,
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
