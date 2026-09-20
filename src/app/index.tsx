import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useNetworkState } from 'expo-network'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Alert, FlatList, Platform, RefreshControl, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Spinner, View, XStack, YStack, useMedia } from 'tamagui'

import { AudioLibraryRow } from '@/components/audio-library-row'
import { AddToPlaylistSheet } from '@/components/add-to-playlist-sheet'
import { EpisodeArtwork } from '@/components/episode-artwork'
import { RemoteAudioRow } from '@/components/remote-audio-row'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import {
  BottomPlayerInset,
  BottomTabInset,
  MaxContentWidth,
  Radius,
  Spacing,
} from '@/constants/theme'
import { useAudioLibraryContext } from '@/contexts/audio-library-context'
import { useAuth } from '@/contexts/auth-context'
import { useTheme } from '@/hooks/use-theme'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import type { RemoteAudio } from '@/services/api'
import {
  findNextQueueEntry,
  findPreviousQueueEntry,
} from '@/services/playback-queue'
import { reconcileLibraryAudio } from '@/services/audio-reconciliation'
import {
  downloadRemoteAudioFile,
  getRemoteAudioDownloadState,
  isRemoteAudioFileDownloadPending,
  loadCachedRemoteAudios,
  removeRemoteAudioDownload,
  subscribeToRemoteAudioFileCache,
} from '@/services/remote-audio-file-cache'
import {
  type RemoteAudioUploadProgress,
  type UploadableAudioAsset,
} from '@/services/remote-audio-upload'
import { buildRemoteMetadataUpdate } from '@/services/remote-audio-metadata'
import {
  formatEpisodeDate,
  formatPlaybackTime,
  getAudioItemTitle,
} from '@/utils/audio-display'
import { findResumeItem } from '@/utils/resume'
import { notifyToast } from '@/services/toast-queue'
import { success } from '@/services/haptics'
import type { PlaylistAudioRef } from '@/models/playlist'

type CollectionItem =
  | { kind: 'local'; item: LoadedAudioItem }
  | { kind: 'remote'; audio: RemoteAudio; isCached: boolean }

type RemoteCollection = {
  userId: string | null
  audios: RemoteAudio[]
  cachedAudioIds: Set<string>
}

export default function HomeScreen() {
  const {
    library,
    playlists,
    playback,
    openPlayer,
    openRemotePlayer,
    remotePlayback,
    playerItem,
    setAutoAdvanceHandlers,
    consumeEndOfEpisodeHold,
    queuePlayNext,
    consumePlayNextEntry,
    setLibraryQueue,
  } = useAudioLibraryContext()
  const { getRemoteAudioStreamSource, loadRemoteAudios, uploadRemoteAudio, updateRemoteAudioMetadata, user } =
    useAuth()
  const media = useMedia()
  const theme = useTheme()
  const networkState = useNetworkState()
  const listRef = useRef<FlatList<CollectionItem>>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRetryCountRef = useRef(0)
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(
    null,
  )
  const [highlightToken, setHighlightToken] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [downloadingAudioIds, setDownloadingAudioIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>(
    {},
  )
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null)
  const [playlistSheet, setPlaylistSheet] = useState<{
    ref: PlaylistAudioRef
    title: string
  } | null>(null)
  const [uploadProgress, setUploadProgress] =
    useState<RemoteAudioUploadProgress | null>(null)
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({})
  const [remoteCollection, setRemoteCollection] = useState<RemoteCollection>({
    userId: null,
    audios: [],
    cachedAudioIds: new Set(),
  })
  const isLibraryBusy = library.importPhase !== 'idle' || library.isMutating
  const isOffline =
    networkState.isConnected === false ||
    networkState.isInternetReachable === false
  const isOnline = networkState.isConnected === true && !isOffline
  const hasPlayer = playback.activeItemId !== null
  const totalDuration = useMemo(
    () =>
      library.items.reduce(
        (total, item) => total + (item.durationSeconds ?? 0),
        0,
      ),
    [library.items],
  )
  // Continue-listening hero: the unfinished episode with the greatest saved
  // position. Persisted every 5s while playing (plus pause/background saves),
  // so kill-app → relaunch → 1-tap Resume lands within seconds of the spot.
  const resumeItem = useMemo(
    () => findResumeItem(library.items),
    [library.items],
  )
  const isResumeItemActive =
    resumeItem !== null && playback.activeItemId === resumeItem.id
  const resumePositionSeconds =
    resumeItem === null
      ? 0
      : isResumeItemActive
        ? playback.currentPositionSeconds
        : resumeItem.lastPositionSeconds
  const resumeDurationSeconds =
    resumeItem === null
      ? null
      : (isResumeItemActive
          ? (playback.durationSeconds ?? resumeItem.durationSeconds)
          : resumeItem.durationSeconds)
  // Recently added (folded in from Discover): 3 most recent local imports.
  const recentItems = useMemo(
    () =>
      [...library.items]
        .sort((first, second) => second.addedAt.localeCompare(first.addedAt))
        .slice(0, 3),
    [library.items],
  )
  const visibleRemoteCollection =
    user && remoteCollection.userId === user.id ? remoteCollection : null
  const reconciliation = useMemo(
    () =>
      reconcileLibraryAudio(
        library.items,
        visibleRemoteCollection?.audios ?? null,
        isOnline,
      ),
    [isOnline, library.items, visibleRemoteCollection],
  )
  const collectionItems: CollectionItem[] = useMemo(
    () => [
      ...library.items.map((item) => ({ kind: 'local' as const, item })),
      ...(visibleRemoteCollection?.audios ?? [])
        .filter((audio) => !reconciliation.hiddenRemoteIds.has(audio.id))
        .map((audio) => ({
          kind: 'remote' as const,
          audio,
          isCached:
            visibleRemoteCollection?.cachedAudioIds.has(audio.id) ?? false,
        })),
    ],
    [library.items, reconciliation.hiddenRemoteIds, visibleRemoteCollection],
  )
  const contentContainerStyle = useMemo(
    () => ({
      flexGrow: 1 as const,
      width: '100%' as const,
      maxWidth: MaxContentWidth,
      alignSelf: 'center' as const,
      paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
      paddingTop: media.short ? Spacing.three : Spacing.four,
      paddingBottom:
        (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four,
    }),
    [hasPlayer, media.short, media.wide],
  )

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      if (scrollRetryTimerRef.current) clearTimeout(scrollRetryTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    if (!user) {
      remotePlayback.stop()
      setDownloadingAudioIds(new Set())
      setDownloadErrors({})
      return () => {
        isMounted = false
      }
    }

    const refreshRemoteAudios = async () => {
      const cachedAudios = await loadCachedRemoteAudios(user.id)
      const cachedAudioIds = new Set(cachedAudios.map((audio) => audio.id))

      if (isMounted) {
        const audios = mergeRemoteAudios([], cachedAudios)
        setRemoteCollection({
          userId: user.id,
          audios,
          cachedAudioIds,
        })
        setDownloadingAudioIds(
          syncDownloadingIds(user.id, audios, cachedAudioIds),
        )
      }

      if (!isOnline) {
        return
      }

      try {
        const onlineAudios = await loadRemoteAudios()

        if (isMounted) {
          const audios = mergeRemoteAudios(onlineAudios, cachedAudios)
          setRemoteCollection({
            userId: user.id,
            audios,
            cachedAudioIds,
          })
          setDownloadingAudioIds(
            syncDownloadingIds(user.id, audios, cachedAudioIds),
          )
        }
      } catch {
        // Keep downloaded audio visible when refreshing the remote library fails.
      }
    }

    void refreshRemoteAudios()
    const unsubscribe = subscribeToRemoteAudioFileCache((changedUserId) => {
      if (changedUserId === user.id) {
        void refreshRemoteAudios()
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [isOnline, loadRemoteAudios, remotePlayback.stop, user])

  const handleRefresh = useCallback(async () => {
    if (!user || !isOnline || isRefreshing) {
      return
    }

    setIsRefreshing(true)

    try {
      const [onlineAudios, cachedAudios] = await Promise.all([
        loadRemoteAudios(true),
        loadCachedRemoteAudios(user.id),
      ])

      setRemoteCollection({
        userId: user.id,
        audios: mergeRemoteAudios(onlineAudios, cachedAudios),
        cachedAudioIds: new Set(cachedAudios.map((audio) => audio.id)),
      })
      setDownloadingAudioIds(
        syncDownloadingIds(
          user.id,
          mergeRemoteAudios(onlineAudios, cachedAudios),
          new Set(cachedAudios.map((audio) => audio.id)),
        ),
      )
    } catch {
      // Keep the current collection when the refresh request fails.
    } finally {
      setIsRefreshing(false)
    }
  }, [isOnline, isRefreshing, loadRemoteAudios, user])

  // Centralized toasts: the ToastCenter mounted at the root renders these.
  const showToast = useCallback((message: string) => {
    notifyToast(message)
  }, [])

  const highlightDuplicate = useCallback((itemId: string) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
    }

    highlightTimerRef.current = setTimeout(() => {
      setHighlightedItemId(itemId)
      setHighlightToken((token) => token + 1)
    }, 600)
  }, [])

  const handleAddAudio = useCallback(async () => {
    const outcome = await library.addAudio()

    if (
      outcome.duplicateItemId === null ||
      outcome.duplicateItemIndex === null
    ) {
      return
    }

    showToast(
      outcome.duplicateNames.length === 1
        ? `${outcome.duplicateNames[0]} is already in the playlist.`
        : `${outcome.duplicateNames.length} selected files are already in the playlist.`,
    )
    scrollRetryCountRef.current = 0

    if (scrollRetryTimerRef.current) {
      clearTimeout(scrollRetryTimerRef.current)
    }

    scrollRetryTimerRef.current = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          animated: true,
          index: outcome.duplicateItemIndex!,
          viewPosition: 0.5,
        })
      } catch {
        listRef.current?.scrollToEnd({ animated: true })
      }
    }, 100)
    highlightDuplicate(outcome.duplicateItemId)
  }, [highlightDuplicate, library, showToast])

  const handleRemoveAudio = useCallback(
    async (item: LoadedAudioItem) => {
      const isActive = playback.activeItemId === item.id
      const shouldPlayNext = isActive && playback.isPlaying
      const removesLastItem = library.items.length === 1
      const nextItem = shouldPlayNext
        ? findNextPlayableItem(library.items, item.id)
        : null

      const outcome = await library.removeAudio(
        item.id,
        isActive
          ? async () => {
              const stopped = await playback.removeActiveItem(
                item.id,
                nextItem,
                shouldPlayNext,
              )

              if (!stopped) {
                throw new Error(
                  'The active player could not stop the audio file.',
                )
              }
            }
          : undefined,
      )

      if (outcome.removed && removesLastItem) {
        showToast('There are no more files to play.')
      } else if (outcome.removed && shouldPlayNext && nextItem === null) {
        showToast('There are no more playable files.')
      }

      if (outcome.removed) {
        // Keep playlists consistent: dropping a file removes it from every playlist.
        void playlists.pruneLocalAudio(item.id)
      }
    },
    [
      library.items,
      library.removeAudio,
      playback.activeItemId,
      playback.isPlaying,
      playback.removeActiveItem,
      playlists,
    ],
  )

  const confirmRemoveAudio = useCallback(
    (item: LoadedAudioItem) => {
      Alert.alert(
        'Remove audio?',
        `“${getAudioItemTitle(item)}” will be removed from the playlist and permanently deleted from app storage.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => void handleRemoveAudio(item),
          },
        ],
      )
    },
    [handleRemoveAudio],
  )

  const handleToggleLocalPlayback = useCallback(
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

  const handleToggleRemotePlayback = useCallback(
    async (audio: RemoteAudio) => {
      if (remotePlayback.activeAudioId !== audio.id && playback.activeItemId) {
        const didStopLocalPlayback = await playback.dismissPlayer()

        if (!didStopLocalPlayback) {
          return
        }
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

  const playCollectionEntry = useCallback(
    (
      entry:
        | { kind: 'local'; item: LoadedAudioItem }
        | { kind: 'remote'; audio: RemoteAudio },
    ) => {
      if (entry.kind === 'local') {
        openPlayer(entry.item)
        handleToggleLocalPlayback(entry.item)
      } else {
        openRemotePlayer(entry.audio)
        void handleToggleRemotePlayback(entry.audio)
      }
    },
    [
      handleToggleLocalPlayback,
      handleToggleRemotePlayback,
      openPlayer,
      openRemotePlayer,
    ],
  )

  const advanceQueue = useCallback(
    (finishedKind: 'local' | 'remote', finishedId: string) => {
      // An armed End-of-episode sleep hold stops autoplay into the next file.
      if (consumeEndOfEpisodeHold()) {
        return
      }

      // A queued Play-next entry wins over natural collection order, one-shot.
      const playNext = consumePlayNextEntry()

      if (playNext) {
        if (
          (playerItem?.kind === 'local' &&
            finishedKind === 'local' &&
            playerItem.item.id === finishedId) ||
          (playerItem?.kind === 'remote' &&
            finishedKind === 'remote' &&
            playerItem.audio.id === finishedId)
        ) {
          if (playNext.kind === 'local') {
            openPlayer(playNext.item)
          } else {
            openRemotePlayer(playNext.audio)
          }
        }

        playCollectionEntry(playNext)
        return
      }

      const next = findNextQueueEntry(
        collectionItems,
        finishedKind,
        finishedId,
        isOnline,
      )

      if (
        next &&
        ((playerItem?.kind === 'local' &&
          finishedKind === 'local' &&
          playerItem.item.id === finishedId) ||
          (playerItem?.kind === 'remote' &&
            finishedKind === 'remote' &&
            playerItem.audio.id === finishedId))
      ) {
        if (next.kind === 'local') {
          openPlayer(next.item)
        } else {
          openRemotePlayer(next.audio)
        }
      }

      if (!next) {
        return
      }

      if (next.kind === 'local') {
        handleToggleLocalPlayback(next.item)
      } else {
        void handleToggleRemotePlayback(next.audio)
      }
    },
    [
      collectionItems,
      consumeEndOfEpisodeHold,
      consumePlayNextEntry,
      handleToggleLocalPlayback,
      handleToggleRemotePlayback,
      isOnline,
      openPlayer,
      openRemotePlayer,
      playCollectionEntry,
      playerItem,
    ],
  )

  const skipInCollection = useCallback(
    (direction: 'next' | 'previous'): boolean => {
      // Manual navigation cancels a stale End-of-episode hold.
      consumeEndOfEpisodeHold()
      const activeKind = playback.activeItemId !== null
        ? ('local' as const)
        : remotePlayback.activeAudioId !== null
          ? ('remote' as const)
          : playerItem?.kind ?? null
      const activeId =
        playback.activeItemId ??
        remotePlayback.activeAudioId ??
        (playerItem?.kind === 'local' ? playerItem.item.id : playerItem?.audio.id) ??
        null

      if (activeKind === null || activeId === null) {
        return false
      }

      const findAdjacent =
        direction === 'next' ? findNextQueueEntry : findPreviousQueueEntry
      const adjacent = findAdjacent(
        collectionItems,
        activeKind,
        activeId,
        isOnline,
      )

      if (!adjacent) {
        return false
      }

      if (adjacent.kind === 'local') {
        openPlayer(adjacent.item)
        handleToggleLocalPlayback(adjacent.item)
      } else {
        openRemotePlayer(adjacent.audio)
        void handleToggleRemotePlayback(adjacent.audio)
      }

      return true
    },
    [
      collectionItems,
      consumeEndOfEpisodeHold,
      handleToggleLocalPlayback,
      handleToggleRemotePlayback,
      isOnline,
      openPlayer,
      openRemotePlayer,
      playback.activeItemId,
      playerItem,
      remotePlayback.activeAudioId,
    ],
  )

  useEffect(() => {
    // Publish library order as the active queue source of truth. The
    // context keeps user reorder/removals and yields to explicit queues.
    setLibraryQueue(collectionItems, isOnline)
    setAutoAdvanceHandlers({
      onLocalFinished: (finishedItemId) =>
        advanceQueue('local', finishedItemId),
      onRemoteFinished: (finishedAudioId) =>
        advanceQueue('remote', finishedAudioId),
      onSkipToNext: () => skipInCollection('next'),
      onSkipToPrevious: () => skipInCollection('previous'),
    })

    return () => setAutoAdvanceHandlers({})
  }, [
    advanceQueue,
    collectionItems,
    isOnline,
    setAutoAdvanceHandlers,
    setLibraryQueue,
    skipInCollection,
  ])

  const handleDownloadRemoteAudio = useCallback(
    async (audio: RemoteAudio) => {
      if (!user) {
        return
      }

      if (Platform.OS === 'web') {
        return
      }

      if (!isOnline) {
        setDownloadErrors((previous) => ({
          ...previous,
          [audio.id]: 'Connect to the internet to download this audio.',
        }))
        return
      }

      setDownloadErrors((previous) => {
        if (!(audio.id in previous)) {
          return previous
        }

        const next = { ...previous }
        delete next[audio.id]
        return next
      })
      setDownloadingAudioIds((previous) => new Set(previous).add(audio.id))

      try {
        const source = await getRemoteAudioStreamSource(audio)
        await downloadRemoteAudioFile(user.id, audio, source)
      } catch (error) {
        setDownloadErrors((previous) => ({
          ...previous,
          [audio.id]:
            error instanceof Error
              ? error.message
              : 'The audio download failed. Try again.',
        }))
        setDownloadingAudioIds((previous) => {
          const next = new Set(previous)
          next.delete(audio.id)
          return next
        })
      }
    },
    [getRemoteAudioStreamSource, isOnline, user],
  )

  const handleRemoveRemoteDownload = useCallback(
    (audio: RemoteAudio) => {
      if (!user || Platform.OS === 'web') {
        return
      }

      Alert.alert(
        'Remove download?',
        `“${audio.title}” will remain in your remote library, but its offline copy will be deleted from this device.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                await removeRemoteAudioDownload(user.id, audio.id)
                setDownloadErrors((previous) => {
                  if (!(audio.id in previous)) {
                    return previous
                  }

                  const next = { ...previous }
                  delete next[audio.id]
                  return next
                })
              })()
            },
          },
        ],
      )
    },
    [user],
  )

  // Local rows are the not-uploaded audios: they get an upload icon.
  // Remote rows already live in the account library, so they never show one.
  const canUploadRow = Platform.OS !== 'web' && user !== null

  const handleUploadLocalItem = useCallback(
    async (item: LoadedAudioItem) => {
      if (!user || Platform.OS === 'web' || uploadingItemId !== null) {
        return
      }

      if (!isOnline) {
        setUploadErrors((previous) => ({
          ...previous,
          [item.id]: 'Connect to the internet to upload audio.',
        }))
        return
      }

      setUploadErrors((previous) => {
        if (!(item.id in previous)) {
          return previous
        }

        const next = { ...previous }
        delete next[item.id]
        return next
      })
      setUploadingItemId(item.id)
      setUploadProgress({ bytesSent: 0, totalBytes: 0 })

      const asset: UploadableAudioAsset = {
        uri: item.localUri,
        name: item.originalName,
        mimeType: item.mimeType,
        size: item.sizeBytes,
      }

      try {
        const audio = await uploadRemoteAudio(asset, {
          onProgress: ({ bytesSent, totalBytes }) =>
            setUploadProgress({ bytesSent, totalBytes }),
        })
        // Persist the server-returned unique id so this file is recognised
        // as uploaded (and not shown twice) on every later library pull.
        await library.linkUploadedAudio(item.id, audio.id)
        // The file bytes carry no app-side details, so push the local
        // metadata (including the artwork URL) to the new cloud copy.
        const metadataUpdate = buildRemoteMetadataUpdate(item.metadata)

        if (metadataUpdate) {
          try {
            await updateRemoteAudioMetadata(audio.id, metadataUpdate)
          } catch {
            showToast(
              `“${audio.title}” was uploaded, but its artwork and details could not be synced.`,
            )
            await handleRefresh()
            return
          }
        }

        success()
        showToast(`“${audio.title}” was uploaded to your library.`)
        await handleRefresh()
      } catch (error) {
        setUploadErrors((previous) => ({
          ...previous,
          [item.id]:
            error instanceof Error
              ? error.message
              : `“${getAudioItemTitle(item)}” could not be uploaded. Try again.`,
        }))
      } finally {
        setUploadProgress(null)
        setUploadingItemId(null)
      }
    },
    [
      handleRefresh,
      isOnline,
      library,
      uploadingItemId,
      uploadRemoteAudio,
      updateRemoteAudioMetadata,
      user,
    ],
  )

  // Stable row callbacks (§P0): inline arrows would break `memo` rows on
  // every tick. Inactive rows receive tick-stable props (0 / null / false)
  // so only the active row re-renders while playing.
  const handlePlayNext = useCallback(
    (rowItem: LoadedAudioItem) => {
      queuePlayNext({ kind: 'local', item: rowItem })
      showToast(`“${getAudioItemTitle(rowItem)}” will play next.`)
    },
    [queuePlayNext],
  )
  const handleReorderRow = useCallback(
    (itemId: string, offset: number) => {
      void library.reorderAudio(itemId, offset)
    },
    [library],
  )
  const handleUploadRow = useCallback(
    (rowItem: LoadedAudioItem) => {
      void handleUploadLocalItem(rowItem)
    },
    [handleUploadLocalItem],
  )
  const handleAddLocalToPlaylist = useCallback(
    (rowItem: LoadedAudioItem) => {
      setPlaylistSheet({
        ref: { kind: 'local', audioId: rowItem.id },
        title: getAudioItemTitle(rowItem),
      })
    },
    [],
  )
  const handleAddRemoteToPlaylist = useCallback((audio: RemoteAudio) => {
    setPlaylistSheet({
      ref: { kind: 'remote', audioId: audio.id },
      title: audio.title,
    })
  }, [])
  const handleDownloadRow = useCallback(
    (audio: RemoteAudio) => {
      void handleDownloadRemoteAudio(audio)
    },
    [handleDownloadRemoteAudio],
  )
  const handleToggleRemoteRow = useCallback(
    (audio: RemoteAudio) => {
      void handleToggleRemotePlayback(audio)
    },
    [handleToggleRemotePlayback],
  )
  const handleResumeHero = useCallback(() => {
    if (resumeItem) {
      playCollectionEntry({ kind: 'local', item: resumeItem })
    }
  }, [playCollectionEntry, resumeItem])
  const handlePlayRecentRow = useCallback(
    (item: LoadedAudioItem) => {
      playCollectionEntry({ kind: 'local', item })
    },
    [playCollectionEntry],
  )
  const handleRefreshRow = useCallback(() => {
    void handleRefresh()
  }, [handleRefresh])
  const handleAddAudioRow = useCallback(() => {
    void handleAddAudio()
  }, [handleAddAudio])

  const renderCollectionItem = useCallback(
    ({ item }: { item: CollectionItem }) => {
      if (item.kind === 'remote') {
        const isDownloading = downloadingAudioIds.has(item.audio.id)
        const isActive = remotePlayback.activeAudioId === item.audio.id

        return (
          <RemoteAudioRow
            audio={item.audio}
            isCached={item.isCached}
            downloadState={getRemoteAudioDownloadState(
              item.isCached,
              isDownloading,
            )}
            canDownload={Platform.OS !== 'web' && user !== null}
            downloadError={downloadErrors[item.audio.id] ?? null}
            isActive={isActive}
            isPlaying={isActive && remotePlayback.isPlaying}
            isTransitioning={remotePlayback.isTransitioning}
            playbackError={
              remotePlayback.playbackError?.audioId === item.audio.id
                ? remotePlayback.playbackError.message
                : null
            }
            onOpenPlayer={openRemotePlayer}
            onTogglePlayback={handleToggleRemoteRow}
            onDownload={handleDownloadRow}
            onRemoveDownload={handleRemoveRemoteDownload}
            onAddToPlaylist={handleAddRemoteToPlaylist}
          />
        )
      }

      const localItem = item.item
      const isActive = playback.activeItemId === localItem.id
      const isUploadingItem = uploadingItemId === localItem.id
      const isUploaded = reconciliation.uploadedLocalIds.has(localItem.id)
      const itemUploadProgress =
        isUploadingItem && uploadProgress && uploadProgress.totalBytes > 0
          ? Math.min(
              100,
              Math.round(
                (uploadProgress.bytesSent / uploadProgress.totalBytes) * 100,
              ),
            )
          : null

      return (
        <AudioLibraryRow
          item={localItem}
          isActive={isActive}
          isPlaying={isActive && playback.isPlaying}
          isTransitioning={playback.isTransitioning}
          isPlaybackReady={playback.isReady}
          currentPositionSeconds={
            isActive ? playback.currentPositionSeconds : 0
          }
          duplicateHighlightToken={
            highlightedItemId === localItem.id ? highlightToken : 0
          }
          isDeleteDisabled={isLibraryBusy || playback.isTransitioning}
          isMetadataDisabled={isLibraryBusy}
          isReorderDisabled={isLibraryBusy || library.items.length < 2}
          loadedDurationSeconds={
            isActive ? playback.durationSeconds : null
          }
          playbackError={playback.playbackError}
          canUpload={canUploadRow && !isUploaded}
          isUploading={isUploadingItem}
          isUploaded={isUploaded}
          uploadProgressPercent={itemUploadProgress}
          uploadError={uploadErrors[localItem.id] ?? null}
          onDelete={confirmRemoveAudio}
          onOpenPlayer={openPlayer}
          onPlayNext={handlePlayNext}
          onReorder={handleReorderRow}
          onSaveMetadata={library.updateAudioMetadata}
          onTogglePlayback={handleToggleLocalPlayback}
          onUpload={handleUploadRow}
          onAddToPlaylist={handleAddLocalToPlaylist}
        />
      )
    },
    [
      canUploadRow,
      confirmRemoveAudio,
      downloadErrors,
      downloadingAudioIds,
      handleAddRemoteToPlaylist,
      handleDownloadRow,
      handlePlayNext,
      handleReorderRow,
      handleRemoveRemoteDownload,
      handleToggleLocalPlayback,
      handleToggleRemoteRow,
      handleUploadRow,
      handleAddLocalToPlaylist,
      highlightedItemId,
      highlightToken,
      isLibraryBusy,
      library,
      openPlayer,
      openRemotePlayer,
      playback.activeItemId,
      playback.currentPositionSeconds,
      playback.durationSeconds,
      playback.isPlaying,
      playback.isReady,
      playback.isTransitioning,
      playback.playbackError,
      reconciliation.uploadedLocalIds,
      remotePlayback.activeAudioId,
      remotePlayback.isPlaying,
      remotePlayback.isTransitioning,
      remotePlayback.playbackError,
      uploadErrors,
      uploadingItemId,
      uploadProgress,
      user,
    ],
  )

  const renderItemSeparator = useCallback(
    () => <View height={Spacing.three} />,
    [],
  )

  const handleScrollToIndexFailed = useCallback(
    ({ averageItemLength, index }: { averageItemLength: number; index: number }) => {
      if (scrollRetryCountRef.current >= 2) {
        return
      }

      scrollRetryCountRef.current += 1
      listRef.current?.scrollToOffset({
        animated: true,
        offset: Math.max(0, averageItemLength * index),
      })

      if (scrollRetryTimerRef.current) {
        clearTimeout(scrollRetryTimerRef.current)
      }

      scrollRetryTimerRef.current = setTimeout(() => {
        listRef.current?.scrollToIndex({
          animated: true,
          index,
          viewPosition: 0.5,
        })
      }, 250)
    },
    [],
  )

  const listHeader = useMemo(
    () => (
      <YStack gap={Spacing.four} marginBottom={Spacing.four}>
        {isOffline && <OfflineNotice />}
        <XStack
          alignItems="flex-end"
          justifyContent="space-between"
          gap={Spacing.three}
          $compact={{ flexDirection: 'column', alignItems: 'stretch' }}
        >
          <YStack flex={1} gap={Spacing.one}>
            <XStack alignItems="center" gap={Spacing.two}>
              <ThemedText type="eyebrow" themeColor="accent">
                Your collection
              </ThemedText>
              {isOnline && (
                <View
                  width={8}
                  height={8}
                  borderRadius={8}
                  backgroundColor="$success"
                  accessibilityLabel="Internet connected"
                />
              )}
            </XStack>
            <ThemedText
              type="title"
              $compact={{ fontSize: 36, lineHeight: 42 }}
            >
              Library
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              Everything you save stays private on this device.
            </ThemedText>
          </YStack>

          {Platform.OS !== 'web' && !library.isLoading && (
            <AddAudioButton
              disabled={isLibraryBusy}
              importPhase={library.importPhase}
              onPress={handleAddAudioRow}
              tintColor={theme.accentForeground}
            />
          )}
        </XStack>

        {!library.isLoading && resumeItem && (
          <ResumeHero
            item={resumeItem}
            positionSeconds={resumePositionSeconds}
            durationSeconds={resumeDurationSeconds}
            isResumeDisabled={
              playback.isTransitioning || !playback.isReady
            }
            onResume={handleResumeHero}
          />
        )}

        {!library.isLoading && library.items.length > 0 && (
          <XStack flexWrap="wrap" gap={Spacing.two}>
            <StatChip
              value={`${library.items.length}`}
              label="Episodes"
            />
            <StatChip
              value={`${library.items.filter((item) => !item.isPlayed).length}`}
              label="Unplayed"
            />
            <StatChip
              value={formatPlaybackTime(totalDuration)}
              label="Total time"
            />
          </XStack>
        )}

        {!library.isLoading && recentItems.length > 0 && (
          <RecentlyAdded
            items={recentItems}
            activeItemId={playback.activeItemId}
            isPlaying={playback.isPlaying}
            onPlay={handlePlayRecentRow}
          />
        )}

        {Platform.OS === 'web' && (
          <ThemedView
            type="backgroundElement"
            padding={Spacing.three}
            borderRadius={Radius.medium}
            borderWidth={1}
            borderColor="$borderColor"
          >
            <ThemedText type="small" themeColor="textSecondary">
              Import new files from the Android or iOS app. Your existing
              library remains available here.
            </ThemedText>
          </ThemedView>
        )}

        {library.notice && (
          <StatusNotice
            title={library.notice.title}
            message={library.notice.message}
            onDismiss={library.dismissNotice}
          />
        )}

        {library.importPhase === 'picking' && (
          <ThemedText type="small" themeColor="textSecondary">
            File picker open…
          </ThemedText>
        )}

        {library.importPhase === 'importing' && (
          <XStack alignItems="center" gap={Spacing.two}>
            <Spinner size="small" color="$accent" />
            <ThemedText type="small" themeColor="textSecondary">
              Copying audio into your library…
            </ThemedText>
          </XStack>
        )}
      </YStack>
    ),
    [
      handleAddAudioRow,
      handlePlayRecentRow,
      handleResumeHero,
      isOffline,
      isOnline,
      isLibraryBusy,
      library.dismissNotice,
      library.importPhase,
      library.isLoading,
      library.items,
      library.notice,
      playback.activeItemId,
      playback.isPlaying,
      playback.isReady,
      playback.isTransitioning,
      recentItems,
      resumeDurationSeconds,
      resumeItem,
      resumePositionSeconds,
      theme.accentForeground,
      totalDuration,
    ],
  )

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList<CollectionItem>
          ref={listRef}
          data={collectionItems}
          keyExtractor={(item) =>
            `${item.kind}-${item.kind === 'local' ? item.item.id : item.audio.id}`
          }
          style={styles.list}
          contentContainerStyle={contentContainerStyle}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefreshRow}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
          ItemSeparatorComponent={renderItemSeparator}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            library.isLoading ? (
              <ThemedView
                flex={1}
                alignItems="center"
                justifyContent="center"
                gap={Spacing.three}
                paddingVertical={Spacing.six}
              >
                <Spinner color="$accent" />
                <ThemedText themeColor="textSecondary">
                  Loading your library…
                </ThemedText>
              </ThemedView>
            ) : (
              <ThemedView
                type="backgroundElement"
                flex={1}
                alignItems="center"
                justifyContent="center"
                gap={Spacing.three}
                padding={Spacing.five}
                borderWidth={1}
                borderColor="$borderColor"
                borderRadius={Radius.large}
                boxShadow="0 12px 32px rgba(0,0,0,0.1)"
                $compact={{ padding: Spacing.four }}
              >
                <View
                  width={64}
                  height={64}
                  alignItems="center"
                  justifyContent="center"
                  borderRadius={32}
                  backgroundColor="$accentSubtle"
                >
                  <SymbolView
                    name={LIBRARY_ICON}
                    size={30}
                    tintColor={theme.accent}
                  />
                </View>
                <YStack alignItems="center" gap={Spacing.one}>
                  <ThemedText type="heading" textAlign="center">
                    Build your listening space
                  </ThemedText>
                  <ThemedText
                    textAlign="center"
                    themeColor="textSecondary"
                    maxWidth={420}
                  >
                    Add audio from your phone and it will be ready offline,
                    exactly where you left off.
                  </ThemedText>
                </YStack>
                {Platform.OS !== 'web' && (
                  <AddAudioButton
                    disabled={isLibraryBusy}
                    importPhase={library.importPhase}
                    onPress={handleAddAudioRow}
                    tintColor={theme.accentForeground}
                  />
                )}
              </ThemedView>
            )
          }
          onScrollToIndexFailed={handleScrollToIndexFailed}
          renderItem={renderCollectionItem}
          removeClippedSubviews
          windowSize={7}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
        />
        {playlistSheet && (
          <AddToPlaylistSheet
            audioRef={playlistSheet.ref}
            audioTitle={playlistSheet.title}
            onClose={() => setPlaylistSheet(null)}
            onAdded={(playlistName) =>
              showToast(`Added to “${playlistName}”.`)
            }
          />
        )}
      </SafeAreaView>
    </ThemedView>
  )
}

function mergeRemoteAudios(
  onlineAudios: RemoteAudio[],
  cachedAudios: RemoteAudio[],
): RemoteAudio[] {
  const onlineIds = new Set(onlineAudios.map((audio) => audio.id))

  return [
    ...onlineAudios,
    ...cachedAudios.filter((audio) => !onlineIds.has(audio.id)),
  ]
}

function syncDownloadingIds(
  userId: string,
  audios: RemoteAudio[],
  cachedAudioIds: Set<string>,
): Set<string> {
  const next = new Set<string>()

  for (const audio of audios) {
    if (!cachedAudioIds.has(audio.id) && isRemoteAudioFileDownloadPending(userId, audio.id)) {
      next.add(audio.id)
    }
  }

  return next
}

function findNextPlayableItem(
  items: readonly LoadedAudioItem[],
  itemId: string,
): LoadedAudioItem | null {
  const currentIndex = items.findIndex((item) => item.id === itemId)

  if (currentIndex < 0) {
    return null
  }

  return (
    items.slice(currentIndex + 1).find((item) => item.isAvailable) ??
    items
      .slice(0, currentIndex)
      .reverse()
      .find((item) => item.isAvailable) ??
    null
  )
}

function OfflineNotice() {
  return (
    <ThemedView
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      flexDirection="row"
      alignItems="center"
      gap={Spacing.two}
      paddingHorizontal={Spacing.three}
      paddingVertical={Spacing.two}
      borderWidth={1}
      borderColor="$danger"
      borderRadius={Radius.medium}
      backgroundColor="$backgroundElement"
    >
      <View width={8} height={8} borderRadius={8} backgroundColor="$danger" />
      <ThemedText type="smallBold" color="$danger">
        No internet connection
      </ThemedText>
    </ThemedView>
  )
}

type ResumeHeroProps = {
  item: LoadedAudioItem
  positionSeconds: number
  durationSeconds: number | null
  isResumeDisabled: boolean
  onResume: () => void
}

/**
 * Continue-listening hero at the top of the Library: the unfinished episode
 * with the greatest saved position, shown as
 * `title · position of duration · remaining left · [Resume]`. One tap opens
 * the player and resumes from the saved position (the loader seeks there).
 */
function ResumeHero({
  item,
  positionSeconds,
  durationSeconds,
  isResumeDisabled,
  onResume,
}: ResumeHeroProps) {
  return (
    <ResumeHeroView
      item={item}
      positionSeconds={positionSeconds}
      durationSeconds={durationSeconds}
      isResumeDisabled={isResumeDisabled}
      onResume={onResume}
    />
  )
}

const ResumeHeroView = memo(function ResumeHeroView({
  item,
  positionSeconds,
  durationSeconds,
  isResumeDisabled,
  onResume,
}: ResumeHeroProps) {
  const theme = useTheme()
  const title = getAudioItemTitle(item)
  const remainingSeconds =
    durationSeconds === null
      ? null
      : Math.max(0, durationSeconds - positionSeconds)
  const progress =
    durationSeconds !== null && durationSeconds > 0
      ? Math.min(Math.max(positionSeconds / durationSeconds, 0), 1)
      : 0
  const positionLabel =
    durationSeconds === null
      ? formatPlaybackTime(positionSeconds)
      : `${formatPlaybackTime(positionSeconds)} of ${formatPlaybackTime(durationSeconds)}`

  return (
    <ThemedView
      type="backgroundElement"
      gap={Spacing.three}
      padding={Spacing.three}
      borderWidth={1}
      borderColor="$accent"
      borderRadius={Radius.large}
    >
      <XStack alignItems="center" gap={Spacing.three}>
        <EpisodeArtwork
          imageUrl={item.metadata.coverArtUrl}
          itemId={item.id}
          name={title}
          size={56}
        />
        <YStack flex={1} minWidth={0} gap={Spacing.half}>
          <ThemedText type="eyebrow" themeColor="accent">
            Continue listening
          </ThemedText>
          <ThemedText type="episodeTitle" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText
            type="metadata"
            themeColor="textSecondary"
            numberOfLines={1}
          >
            {positionLabel}
            {remainingSeconds !== null
              ? ` · ${formatPlaybackTime(remainingSeconds)} left`
              : null}
          </ThemedText>
        </YStack>
      </XStack>
      <View
        height={4}
        borderRadius={4}
        backgroundColor="$backgroundSelected"
        accessibilityElementsHidden
      >
        <View
          height="100%"
          width={`${progress * 100}%`}
          borderRadius={4}
          backgroundColor="$accent"
        />
      </View>
      <AppButton
        accessibilityLabel={`Resume ${title} from ${formatPlaybackTime(positionSeconds)}`}
        accessibilityHint="Starts playback from where you left off"
        disabled={isResumeDisabled}
        onPress={onResume}
        minHeight={48}
      >
        <SymbolView
          name={RESUME_ICON}
          size={18}
          tintColor={theme.accentForeground}
          weight="bold"
        />
        <ThemedText type="smallBold" color="$accentForeground">
          Resume
        </ThemedText>
      </AppButton>
    </ThemedView>
  )
})

/**
 * Recently added (folded in from Discover): the 3 most recent imports with
 * a 44px play affordance. The full collection below stays in queue order;
 * this section surfaces fresh arrivals without leaving Library.
 */
const RecentlyAdded = memo(function RecentlyAdded({
  items,
  activeItemId,
  isPlaying,
  onPlay,
}: {
  items: LoadedAudioItem[]
  activeItemId: string | null
  isPlaying: boolean
  onPlay: (item: LoadedAudioItem) => void
}) {
  const theme = useTheme()

  return (
    <YStack gap={Spacing.two}>
      <YStack gap={Spacing.half}>
        <ThemedText type="heading">Recently added</ThemedText>
        <ThemedText type="metadata" themeColor="textSecondary">
          Fresh arrivals in your library.
        </ThemedText>
      </YStack>
      {items.map((item) => {
        const title = getAudioItemTitle(item)
        const isActive = activeItemId === item.id

        return (
          <ThemedView
            key={item.id}
            type="backgroundElement"
            flexDirection="row"
            alignItems="center"
            gap={Spacing.two}
            padding={Spacing.two}
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius={Radius.medium}
          >
            <EpisodeArtwork
              imageUrl={item.metadata.coverArtUrl}
              itemId={item.id}
              name={title}
              size={44}
            />
            <YStack flex={1} minWidth={0} gap={2}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {title}
              </ThemedText>
              <ThemedText
                type="metadata"
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {formatEpisodeDate(item.addedAt)}
                {item.durationSeconds !== null
                  ? ` · ${formatPlaybackTime(item.durationSeconds)}`
                  : null}
              </ThemedText>
            </YStack>
            <AppButton
              tone="icon"
              accessibilityLabel={
                isActive && isPlaying
                  ? `Pause ${title}`
                  : `Play ${title}`
              }
              onPress={() => onPlay(item)}
              minHeight={44}
              minWidth={44}
            >
              <SymbolView
                name={isActive && isPlaying ? PAUSE_ICON : PLAY_ICON}
                size={20}
                tintColor={theme.text}
                weight="bold"
              />
            </AppButton>
          </ThemedView>
        )
      })}
    </YStack>
  )
})

const StatChip = memo(function StatChip({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <ThemedView
      type="backgroundElement"
      flexDirection="row"
      alignItems="baseline"
      gap={Spacing.one}
      paddingHorizontal={Spacing.three}
      paddingVertical={Spacing.two}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.round}
    >
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="metadata" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  )
})

type AddAudioButtonProps = {
  disabled: boolean
  importPhase: 'idle' | 'picking' | 'importing'
  onPress: () => void
  tintColor: string
}

function AddAudioButton({
  disabled,
  importPhase,
  onPress,
  tintColor,
}: AddAudioButtonProps) {
  const label =
    importPhase === 'picking'
      ? 'Choosing…'
      : importPhase === 'importing'
        ? 'Importing…'
        : 'Add audio'

  return (
    <AppButton
      accessibilityLabel="Add audio"
      accessibilityState={{ busy: importPhase !== 'idle', disabled }}
      disabled={disabled}
      onPress={onPress}
      borderWidth={0}
      $compact={{ width: '100%' }}
    >
      <SymbolView
        name={ADD_ICON}
        size={18}
        tintColor={tintColor}
        weight="bold"
      />
      <ThemedText type="smallBold" color="$accentForeground">
        {label}
      </ThemedText>
    </AppButton>
  )
}

type StatusNoticeProps = {
  title: string
  message: string
  onDismiss: () => void
}

function StatusNotice({ title, message, onDismiss }: StatusNoticeProps) {
  return (
    <ThemedView
      type="backgroundSelected"
      flexDirection="row"
      alignItems="center"
      gap={Spacing.three}
      padding={Spacing.three}
      borderRadius={Radius.medium}
      $compact={{ flexDirection: 'column', alignItems: 'stretch' }}
    >
      <YStack flex={1} gap={Spacing.one}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      </YStack>
      <AppButton
        tone="ghost"
        accessibilityLabel={`Dismiss ${title}`}
        onPress={onDismiss}
      >
        <ThemedText type="smallBold">Dismiss</ThemedText>
      </AppButton>
    </ThemedView>
  )
}

const ADD_ICON: SymbolViewProps['name'] = {
  ios: 'plus',
  android: 'add',
  web: 'add',
}
const RESUME_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
}
const PLAY_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
}
const PAUSE_ICON: SymbolViewProps['name'] = {
  ios: 'pause.fill',
  android: 'pause',
  web: 'pause',
}
const LIBRARY_ICON: SymbolViewProps['name'] = {
  ios: 'headphones',
  android: 'headphones',
  web: 'headphones',
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
})
