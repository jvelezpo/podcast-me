import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppState } from 'react-native'

import { useAudioLibrary } from '@/hooks/use-audio-library'
import { useAudioLibraryPlayer } from '@/hooks/use-audio-library-player'
import { usePlaylists } from '@/hooks/use-playlists'
import { useRemoteAudioPlayer } from '@/hooks/use-remote-audio-player'
import { useAuth } from '@/contexts/auth-context'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import type { RemoteAudio } from '@/services/api'
import {
  findNextQueueEntry,
  findPreviousQueueEntry,
  getQueueEntryKey,
  hasSameQueueOrder,
  removeQueueEntry,
  reorderQueueEntries,
  type QueueEntry,
} from '@/services/playback-queue'
import { notifyToast } from '@/services/toast-queue'

/**
 * Grace window before an unexpected pause becomes a toast: transient
 * interruptions that the OS auto-resumes stay silent.
 */
const INTERRUPTION_GRACE_MS = 3_000

type PlayerItem =
  | { kind: 'local'; item: LoadedAudioItem }
  | { kind: 'remote'; audio: RemoteAudio }

export type AutoAdvanceHandlers = {
  onLocalFinished?: (finishedItemId: string) => void
  onRemoteFinished?: (finishedAudioId: string) => void
  /** Manual track change in library order; returns true when handled. */
  onSkipToNext?: () => boolean
  /** Manual track change in library order; returns true when handled. */
  onSkipToPrevious?: () => boolean
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
  /**
   * Ordered queue used when playing from a playlist; null clears back to
   * library order. The explicit queue always wins over the published library
   * queue, forming a single active queue source of truth.
   */
  setPlaybackQueue: (entries: readonly QueueEntry[] | null, isOnline: boolean) => void
  /**
   * Library collection order published by the Library screen, unified with
   * local and remote entries. Forms the active queue when no explicit
   * playlist queue is set.
   */
  setLibraryQueue: (entries: readonly QueueEntry[], isOnline: boolean) => void
  playQueueEntry: (entry: QueueEntry, queue: readonly QueueEntry[], isOnline: boolean) => void
  /** Play an entry without disturbing the active queue order. */
  playActiveQueueEntry: (entry: QueueEntry) => void
  /** Move an entry within the active queue; no shuffle exists. */
  moveQueueEntry: (kind: QueueEntry['kind'], id: string, offset: number) => void
  /** Remove an entry from the active queue (never deletes files). */
  removeQueueEntryById: (kind: QueueEntry['kind'], id: string) => void
  /** Advance to the next playable entry; returns true when playback started. */
  skipToNext: () => boolean
  /** Return to the previous playable entry; returns true when playback started. */
  skipToPrevious: () => boolean
  /** Navigate without changing whether the current audio was playing. */
  skipToNextPreservingPlayback: () => boolean
  /** Navigate without changing whether the current audio was playing. */
  skipToPreviousPreservingPlayback: () => boolean
  /**
   * Active queue snapshot for the queue sheet and Up-next label: the
   * explicit playlist queue when set, otherwise the published library queue.
   */
  playbackQueue: { entries: QueueEntry[]; isOnline: boolean } | null
  /**
   * Queue an entry to play when the current audio finishes. Consumed once
   * by the next auto-advance; a manual skip clears it.
   */
  queuePlayNext: (entry: QueueEntry) => void
  /** Take a queued Play-next entry, disarming it. Used by auto-advance paths. */
  consumePlayNextEntry: () => QueueEntry | null
  /** True while the sleep timer's End-of-episode hold is armed. */
  endOfEpisodeArmed: boolean
  /** Arm the End-of-episode hold: the next finished episode stops playback. */
  armEndOfEpisode: () => void
  /**
   * Disarm the hold, returning true when it was armed. Auto-advance paths
   * call this first and stop when it returns true; manual skips call it to
   * cancel a stale hold.
   */
  consumeEndOfEpisodeHold: () => boolean
}

const AudioLibraryContext = createContext<AudioLibraryContextValue | null>(null)

/**
 * Split contexts (§P0): the single provider value used to re-render every
 * consumer on each 500 ms position tick. Library membership, playback
 * status, and UI chrome now have independent boundaries so e.g. the Library
 * list (`useLibraryData`) and DownloadManager no longer re-render while
 * audio plays. `useAudioLibraryContext` remains as a backwards-compatible
 * combined selector for migrated callers.
 */
type LibraryDataValue = Pick<AudioLibraryContextValue, 'library' | 'playlists'>
type PlaybackStateValue = Pick<
  AudioLibraryContextValue,
  'playback' | 'remotePlayback'
>
type PlayerUIValue = Omit<
  AudioLibraryContextValue,
  'library' | 'playlists' | 'playback' | 'remotePlayback'
>

const LibraryDataContext = createContext<LibraryDataValue | null>(null)
const PlaybackStateContext = createContext<PlaybackStateValue | null>(null)
const PlayerUIContext = createContext<PlayerUIValue | null>(null)

export function useLibraryData(): LibraryDataValue {
  const value = useContext(LibraryDataContext)

  if (!value) {
    throw new Error('useLibraryData must be used inside AudioLibraryProvider.')
  }

  return value
}

export function usePlaybackState(): PlaybackStateValue {
  const value = useContext(PlaybackStateContext)

  if (!value) {
    throw new Error(
      'usePlaybackState must be used inside AudioLibraryProvider.',
    )
  }

  return value
}

export function usePlayerUI(): PlayerUIValue {
  const value = useContext(PlayerUIContext)

  if (!value) {
    throw new Error('usePlayerUI must be used inside AudioLibraryProvider.')
  }

  return value
}

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
  type StoredQueue = {
    entries: QueueEntry[]
    isOnline: boolean
    /** Session-scoped reorder/removal promoted from the library queue. */
    promoted: boolean
  }
  const explicitQueueRef = useRef<StoredQueue | null>(null)
  const libraryQueueRef = useRef<{
    entries: QueueEntry[]
    isOnline: boolean
  } | null>(null)
  const [endOfEpisodeArmed, setEndOfEpisodeArmed] = useState(false)
  const endOfEpisodeRef = useRef(false)
  const armEndOfEpisode = useCallback(() => {
    endOfEpisodeRef.current = true
    setEndOfEpisodeArmed(true)
  }, [])
  const consumeEndOfEpisodeHold = useCallback(() => {
    if (!endOfEpisodeRef.current) {
      return false
    }

    endOfEpisodeRef.current = false
    setEndOfEpisodeArmed(false)
    return true
  }, [])
  const setAutoAdvanceHandlers = useCallback(
    (handlers: AutoAdvanceHandlers) => {
      autoAdvanceRef.current = handlers
    },
    [],
  )
  const [playbackQueue, setPlaybackQueueState] = useState<{
    entries: QueueEntry[]
    isOnline: boolean
  } | null>(null)
  const publishActiveQueue = useCallback(() => {
    const active = explicitQueueRef.current ?? libraryQueueRef.current
    setPlaybackQueueState(
      active ? { entries: active.entries, isOnline: active.isOnline } : null,
    )
  }, [])
  const setPlaybackQueue = useCallback(
    (entries: readonly QueueEntry[] | null, isOnline: boolean) => {
      if (entries === null) {
        explicitQueueRef.current = null
      } else {
        const current = explicitQueueRef.current
        // Keep user reorder/removals when the source order is unchanged
        // (progress saves rebuild entry arrays without reordering).
        explicitQueueRef.current =
          current && hasSameQueueOrder(current.entries, entries)
            ? { ...current, isOnline }
            : { entries: [...entries], isOnline, promoted: false }
      }
      publishActiveQueue()
    },
    [publishActiveQueue]
  )
  const setLibraryQueue = useCallback(
    (entries: readonly QueueEntry[], isOnline: boolean) => {
      const current = libraryQueueRef.current
      const next = [...entries]
      const orderChanged =
        !current || !hasSameQueueOrder(current.entries, next)

      if (!orderChanged && current?.isOnline === isOnline) {
        return
      }

      const currentKeys = new Set(
        current?.entries.map(getQueueEntryKey) ?? [],
      )
      const membershipChanged =
        !current ||
        current.entries.length !== next.length ||
        next.some((entry) => !currentKeys.has(getQueueEntryKey(entry)))
      libraryQueueRef.current = { entries: next, isOnline }
      // A changed library membership drops a promoted session queue so new
      // imports and deletions rejoin the visible order.
      if (explicitQueueRef.current?.promoted && membershipChanged) {
        explicitQueueRef.current = null
      }
      publishActiveQueue()
    },
    [publishActiveQueue]
  )
  /**
   * Returns a mutable explicit queue, promoting the library queue to a
   * session-scoped copy on first edit so Library order itself is untouched.
   */
  const ensureMutableQueue = useCallback((): StoredQueue | null => {
    if (explicitQueueRef.current) {
      return explicitQueueRef.current
    }

    const library = libraryQueueRef.current

    if (!library) {
      return null
    }

    const promoted: StoredQueue = {
      entries: [...library.entries],
      isOnline: library.isOnline,
      promoted: true,
    }
    explicitQueueRef.current = promoted
    return promoted
  }, [])
  const moveQueueEntry = useCallback(
    (kind: QueueEntry['kind'], id: string, offset: number) => {
      const target = ensureMutableQueue()

      if (!target) {
        return
      }

      target.entries = reorderQueueEntries(target.entries, kind, id, offset)
      publishActiveQueue()
    },
    [ensureMutableQueue, publishActiveQueue]
  )
  const removeQueueEntryById = useCallback(
    (kind: QueueEntry['kind'], id: string) => {
      const target = ensureMutableQueue()

      if (!target) {
        return
      }

      target.entries = removeQueueEntry(target.entries, kind, id)
      publishActiveQueue()
    },
    [ensureMutableQueue, publishActiveQueue]
  )
  const playNextRef = useRef<QueueEntry | null>(null)
  const queuePlayNext = useCallback((entry: QueueEntry) => {
    playNextRef.current = entry
  }, [])
  const consumePlayNextEntry = useCallback((): QueueEntry | null => {
    const entry = playNextRef.current
    playNextRef.current = null
    return entry
  }, [])
  const handleLocalFinished = useCallback((finishedItemId: string) => {
    const active = explicitQueueRef.current ?? libraryQueueRef.current

    if (active) {
      advanceQueueRef.current?.('local', finishedItemId, active)
      return
    }

    autoAdvanceRef.current.onLocalFinished?.(finishedItemId)
  }, [])
  const handleRemoteFinished = useCallback((finishedAudioId: string) => {
    const active = explicitQueueRef.current ?? libraryQueueRef.current

    if (active) {
      advanceQueueRef.current?.('remote', finishedAudioId, active)
      return
    }

    autoAdvanceRef.current.onRemoteFinished?.(finishedAudioId)
  }, [])
  // Latest playback state for interruption resume: the toast action fires
  // after user delay, so it must read fresh state instead of render closures.
  const interruptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestStateRef = useRef<{
    playback: ReturnType<typeof useAudioLibraryPlayer> | null
    remotePlayback: ReturnType<typeof useRemoteAudioPlayer> | null
    libraryItems: LoadedAudioItem[]
  }>({ playback: null, remotePlayback: null, libraryItems: [] })
  const resumeInterruptedPlayback = useCallback(
    (kind: 'local' | 'remote'): void => {
      const { playback, remotePlayback, libraryItems } = latestStateRef.current

      if (kind === 'local' && playback) {
        const item = playback.activeItemId
          ? (libraryItems.find(
              (candidate) => candidate.id === playback.activeItemId,
            ) ?? null)
          : null

        if (item) {
          void playback.resumePlayback(item)
        }
      } else if (kind === 'remote' && remotePlayback) {
        const audio = remotePlayback.activeAudio

        if (audio) {
          remotePlayback.resumePlayback(audio)
        }
      }
    },
    [],
  )
  const handleUnexpectedPause = useCallback(
    (kind: 'local' | 'remote'): void => {
      if (interruptionTimerRef.current) {
        clearTimeout(interruptionTimerRef.current)
      }

      // expo-audio exposes no call/route reason: a backgrounded app most
      // likely lost audio to a phone call, a foregrounded one to a
      // headphone/route disconnect. Either way there is no autoplay — only
      // a manual Resume toast action.
      const wasBackgrounded = AppState.currentState !== 'active'
      interruptionTimerRef.current = setTimeout(() => {
        interruptionTimerRef.current = null
        const { playback, remotePlayback } = latestStateRef.current
        const stillPaused =
          kind === 'local'
            ? playback !== null &&
              playback.activeItemId !== null &&
              !playback.isPlaying &&
              !playback.isTransitioning
            : remotePlayback !== null &&
              remotePlayback.activeAudioId !== null &&
              !remotePlayback.isPlaying &&
              !remotePlayback.isTransitioning

        // Auto-resumed by the OS: stay silent per the exit criteria.
        if (!stillPaused) {
          return
        }

        notifyToast(
          wasBackgrounded
            ? 'Paused for phone call'
            : 'Paused — headphones disconnected',
          {
            label: 'Resume',
            accessibilityLabel: wasBackgrounded
              ? 'Resume playback after the phone call'
              : 'Resume playback after headphones disconnected',
            onPress: () => resumeInterruptedPlayback(kind),
          },
        )
      }, INTERRUPTION_GRACE_MS)
    },
    [resumeInterruptedPlayback],
  )
  const playback = useAudioLibraryPlayer(
    library.updateAudioItem,
    !library.isLoading,
    handleLocalFinished,
    () => handleUnexpectedPause('local'),
  )
  const remotePlayback = useRemoteAudioPlayer(
    getRemoteAudioStreamSource,
    recordRemoteAudioPlayback,
    getRemotePlaybackProgress,
    sendRemotePlaybackEvent,
    handleRemoteFinished,
    () => handleUnexpectedPause('remote'),
  )
  const [isPlayerOpen, setIsPlayerOpen] = useState(false)
  const [playerItem, setPlayerItem] = useState<PlayerItem | null>(null)
  // Ref mirror must not run every render inside the 2–4 Hz tick storm:
  // it only needs to refresh when the values it mirrors actually change.
  useEffect(() => {
    latestStateRef.current = {
      playback,
      remotePlayback,
      libraryItems: library.items,
    }
  }, [playback, remotePlayback, library.items])
  useEffect(
    () => () => {
      if (interruptionTimerRef.current) {
        clearTimeout(interruptionTimerRef.current)
      }
    },
    [],
  )
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
    [
      playback.togglePlayback,
      remotePlayback.activeAudioId,
      remotePlayback.isTransitioning,
      remotePlayback.stop,
    ],
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
    [
      playback.activeItemId,
      playback.dismissPlayer,
      remotePlayback.activeAudioId,
      remotePlayback.togglePlayback,
    ],
  )
  const playEntry = useCallback(
    (entry: QueueEntry) => {
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
  const advanceQueueRef = useRef<
    | ((
      finishedKind: QueueEntry['kind'],
      finishedId: string,
      queue: { entries: QueueEntry[]; isOnline: boolean }
    ) => void)
    | null
  >(null)
  advanceQueueRef.current = (finishedKind, finishedId, queue) => {
    // An armed End-of-episode sleep hold stops autoplay into the next file.
    if (consumeEndOfEpisodeHold()) {
      return
    }

    // A queued Play-next entry wins over natural queue order, one-shot.
    const playNext = consumePlayNextEntry()

    if (playNext) {
      playEntry(playNext)
      return
    }

    const next = findNextQueueEntry(queue.entries, finishedKind, finishedId, queue.isOnline)

    if (!next) {
      return
    }

    playEntry(next)
  }
  const playQueueEntry = useCallback(
    (entry: QueueEntry, queue: readonly QueueEntry[], isOnline: boolean) => {
      setPlaybackQueue(queue, isOnline)
      playEntry(entry)
    },
    [playEntry, setPlaybackQueue]
  )
  const playActiveQueueEntry = useCallback(
    (entry: QueueEntry) => {
      playEntry(entry)
    },
    [playEntry]
  )
  const loadEntryPaused = useCallback(
    (entry: QueueEntry) => {
      if (entry.kind === 'local') {
        openPlayer(entry.item)

        if (remotePlayback.activeAudioId || remotePlayback.isTransitioning) {
          remotePlayback.stop()
        }

        playback.loadPaused(entry.item)
        return
      }

      openRemotePlayer(entry.audio)

      if (playback.activeItemId) {
        void playback.dismissPlayer().then((didStop) => {
          if (didStop) {
            remotePlayback.loadPaused(entry.audio)
          }
        })
        return
      }

      remotePlayback.loadPaused(entry.audio)
    },
    [
      openPlayer,
      openRemotePlayer,
      playback.activeItemId,
      playback.dismissPlayer,
      playback.loadPaused,
      remotePlayback.activeAudioId,
      remotePlayback.isTransitioning,
      remotePlayback.loadPaused,
      remotePlayback.stop,
    ],
  )
  /**
   * Manual track change for the Prev/Next transport buttons. Inside a
   * playlist the explicit queue wins; otherwise the Library screen owns the
   * collection order and handles the skip via `onSkipToNext/onSkipToPrevious`.
   * The anchor is the actively playing entry, falling back to the open sheet.
   */
  const skipInDirection = useCallback(
    (
      direction: 'next' | 'previous',
      preservePlaybackState = false,
    ): boolean => {
      // Manual navigation cancels a stale End-of-episode hold and any
      // queued Play-next entry.
      consumeEndOfEpisodeHold()
      consumePlayNextEntry()
      const queue = explicitQueueRef.current ?? libraryQueueRef.current
      const activeKind: QueueEntry['kind'] | null =
        playback.activeItemId !== null
          ? 'local'
          : remotePlayback.activeAudioId !== null
            ? 'remote'
            : playerItem?.kind ?? null
      const activeId =
        playback.activeItemId ??
        remotePlayback.activeAudioId ??
        (playerItem?.kind === 'local' ? playerItem.item.id : playerItem?.audio.id) ??
        null

      if (queue && activeKind !== null && activeId !== null) {
        const findAdjacent =
          direction === 'next' ? findNextQueueEntry : findPreviousQueueEntry
        const adjacent = findAdjacent(
          queue.entries,
          activeKind,
          activeId,
          queue.isOnline,
        )

        if (!adjacent) {
          return false
        }

        const wasPlaying =
          activeKind === 'local'
            ? playback.isPlaying
            : remotePlayback.isPlaying

        if (preservePlaybackState && !wasPlaying) {
          loadEntryPaused(adjacent)
        } else {
          playEntry(adjacent)
        }

        return true
      }

      if (direction === 'next') {
        return autoAdvanceRef.current.onSkipToNext?.() ?? false
      }

      return autoAdvanceRef.current.onSkipToPrevious?.() ?? false
    },
    [
      consumeEndOfEpisodeHold,
      consumePlayNextEntry,
      loadEntryPaused,
      playback.activeItemId,
      playback.isPlaying,
      playEntry,
      playerItem,
      remotePlayback.activeAudioId,
      remotePlayback.isPlaying,
    ]
  )
  const skipToNext = useCallback(
    () => skipInDirection('next'),
    [skipInDirection]
  )
  const skipToPrevious = useCallback(
    () => skipInDirection('previous'),
    [skipInDirection]
  )
  const skipToNextPreservingPlayback = useCallback(
    () => skipInDirection('next', true),
    [skipInDirection],
  )
  const skipToPreviousPreservingPlayback = useCallback(
    () => skipInDirection('previous', true),
    [skipInDirection],
  )

  const libraryDataValue = useMemo<LibraryDataValue>(
    () => ({ library, playlists }),
    [library, playlists],
  )
  const playbackStateValue = useMemo<PlaybackStateValue>(
    () => ({ playback, remotePlayback }),
    [playback, remotePlayback],
  )
  const playerUIValue = useMemo<PlayerUIValue>(
    () => ({
      isPlayerOpen,
      playerItem,
      openPlayer,
      openRemotePlayer,
      closePlayer,
      setAutoAdvanceHandlers,
      setPlaybackQueue,
      setLibraryQueue,
      playQueueEntry,
      playActiveQueueEntry,
      moveQueueEntry,
      removeQueueEntryById,
      skipToNext,
      skipToPrevious,
      skipToNextPreservingPlayback,
      skipToPreviousPreservingPlayback,
      playbackQueue,
      queuePlayNext,
      consumePlayNextEntry,
      endOfEpisodeArmed,
      armEndOfEpisode,
      consumeEndOfEpisodeHold,
    }),
    [
      isPlayerOpen,
      playerItem,
      openPlayer,
      openRemotePlayer,
      closePlayer,
      setAutoAdvanceHandlers,
      setPlaybackQueue,
      setLibraryQueue,
      playQueueEntry,
      playActiveQueueEntry,
      moveQueueEntry,
      removeQueueEntryById,
      skipToNext,
      skipToPrevious,
      skipToNextPreservingPlayback,
      skipToPreviousPreservingPlayback,
      playbackQueue,
      queuePlayNext,
      consumePlayNextEntry,
      endOfEpisodeArmed,
      armEndOfEpisode,
      consumeEndOfEpisodeHold,
    ],
  )
  // Backwards-compatible combined value, memoized so unrelated provider
  // re-renders don't cascade when nothing in the value changed.
  const combinedValue = useMemo<AudioLibraryContextValue>(
    () => ({
      ...libraryDataValue,
      ...playbackStateValue,
      ...playerUIValue,
    }),
    [libraryDataValue, playbackStateValue, playerUIValue],
  )

  return (
    <LibraryDataContext.Provider value={libraryDataValue}>
      <PlaybackStateContext.Provider value={playbackStateValue}>
        <PlayerUIContext.Provider value={playerUIValue}>
          <AudioLibraryContext.Provider value={combinedValue}>
            {children}
          </AudioLibraryContext.Provider>
        </PlayerUIContext.Provider>
      </PlaybackStateContext.Provider>
    </LibraryDataContext.Provider>
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
