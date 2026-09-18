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
import { usePlaylists } from '@/hooks/use-playlists'
import { useRemoteAudioPlayer } from '@/hooks/use-remote-audio-player'
import { useAuth } from '@/contexts/auth-context'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import type { RemoteAudio } from '@/services/api'
import {
  findNextQueueEntry,
  type QueueEntry,
} from '@/services/playback-queue'

type PlayerItem =
  | { kind: 'local'; item: LoadedAudioItem }
  | { kind: 'remote'; audio: RemoteAudio }

export type AutoAdvanceHandlers = {
  onLocalFinished?: (finishedItemId: string) => void
  onRemoteFinished?: (finishedAudioId: string) => void
}

type AudioLibraryContextValue = {
  library: ReturnType<typeof useAudioLibrary>
  playlists: ReturnType<typeof usePlaylists>
  playback: ReturnType<typeof useAudioLibraryPlayer>
  remotePlayback: ReturnType<typeof useRemoteAudioPlayer>
  isPlayerOpen: boolean
  playerItem: PlayerItem | null
  openPlayer: (item: LoadedAudioItem) => void
  openRemotePlayer: (audio: RemoteAudio) => void
  closePlayer: () => void
  setAutoAdvanceHandlers: (handlers: AutoAdvanceHandlers) => void
  /** Ordered queue used when playing from a playlist; null means library order. */
  setPlaybackQueue: (entries: readonly QueueEntry[] | null, isOnline: boolean) => void
  playQueueEntry: (entry: QueueEntry, queue: readonly QueueEntry[], isOnline: boolean) => void
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
  const playlists = usePlaylists()
  const autoAdvanceRef = useRef<AutoAdvanceHandlers>({})
  const queueRef = useRef<{ entries: QueueEntry[]; isOnline: boolean } | null>(null)
  const setAutoAdvanceHandlers = useCallback(
    (handlers: AutoAdvanceHandlers) => {
      autoAdvanceRef.current = handlers
    },
    [],
  )
  const setPlaybackQueue = useCallback(
    (entries: readonly QueueEntry[] | null, isOnline: boolean) => {
      queueRef.current = entries ? { entries: [...entries], isOnline } : null
    },
    []
  )
  const handleLocalFinished = useCallback((finishedItemId: string) => {
    const queue = queueRef.current

    if (queue) {
      advanceQueueRef.current?.('local', finishedItemId, queue)
      return
    }

    autoAdvanceRef.current.onLocalFinished?.(finishedItemId)
  }, [])
  const handleRemoteFinished = useCallback((finishedAudioId: string) => {
    const queue = queueRef.current

    if (queue) {
      advanceQueueRef.current?.('remote', finishedAudioId, queue)
      return
    }

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
  const toggleLocalEntry = useCallback(
    (item: LoadedAudioItem) => {
      if (remotePlayback.activeAudioId || remotePlayback.isTransitioning) {
        remotePlayback.stop()
      }

      playback.togglePlayback(item)
    },
    [playback, remotePlayback]
  )
  const toggleRemoteEntry = useCallback(
    (audio: RemoteAudio) => {
      if (remotePlayback.activeAudioId !== audio.id && playback.activeItemId) {
        void playback.dismissPlayer().then((didStop) => {
          if (didStop) {
            remotePlayback.togglePlayback(audio)
          }
        })
        return
      }

      remotePlayback.togglePlayback(audio)
    },
    [playback, remotePlayback]
  )
  const advanceQueueRef = useRef<
    | ((
      finishedKind: QueueEntry['kind'],
      finishedId: string,
      queue: { entries: QueueEntry[]; isOnline: boolean }
    ) => void)
    | null
  >(null)
  advanceQueueRef.current = (finishedKind, finishedId, queue) => {
    const next = findNextQueueEntry(queue.entries, finishedKind, finishedId, queue.isOnline)

    if (!next) {
      return
    }

    if (next.kind === 'local') {
      openPlayer(next.item)
      toggleLocalEntry(next.item)
    } else {
      openRemotePlayer(next.audio)
      toggleRemoteEntry(next.audio)
    }
  }
  const playQueueEntry = useCallback(
    (entry: QueueEntry, queue: readonly QueueEntry[], isOnline: boolean) => {
      queueRef.current = { entries: [...queue], isOnline }

      if (entry.kind === 'local') {
        openPlayer(entry.item)
        toggleLocalEntry(entry.item)
      } else {
        openRemotePlayer(entry.audio)
        toggleRemoteEntry(entry.audio)
      }
    },
    [openPlayer, openRemotePlayer, toggleLocalEntry, toggleRemoteEntry]
  )

  return (
    <AudioLibraryContext.Provider
      value={{
        library,
        playlists,
        playback,
        remotePlayback,
        isPlayerOpen,
        playerItem,
        openPlayer,
        openRemotePlayer,
        closePlayer,
        setAutoAdvanceHandlers,
        setPlaybackQueue,
        playQueueEntry,
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
