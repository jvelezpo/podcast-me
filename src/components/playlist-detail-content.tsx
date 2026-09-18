import { useNetworkState } from 'expo-network'
import { useFocusEffect } from 'expo-router'
import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, FlatList, Modal, StyleSheet, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Spinner, View, XStack, YStack, useMedia } from 'tamagui'

import { AudioLibraryRow } from '@/components/audio-library-row'
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
import type { RemoteAudio } from '@/services/api'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import type { QueueEntry } from '@/services/playback-queue'
import {
  countPlayableEntries,
  resolvePlaylistEntries,
} from '@/services/playlist-queue'
import {
  getRemoteAudioDownloadState,
  loadCachedRemoteAudios,
} from '@/services/remote-audio-file-cache'
import { formatPlaybackTime, getAudioItemTitle } from '@/utils/audio-display'

type PlaylistDetailContentProps = {
  playlistId: string
  /** Closes the view: router.back() for the route, modal dismiss for the tap-to-open modal. */
  onClose: () => void
  /** Sends the user to the library to pick audios. */
  onOpenLibrary: () => void
  /** Called after the playlist is deleted so the host can close itself. */
  onDeleted?: () => void
}

export function PlaylistDetailContent({
  playlistId,
  onClose,
  onOpenLibrary,
  onDeleted,
}: PlaylistDetailContentProps) {
  const media = useMedia()
  const theme = useTheme()
  const networkState = useNetworkState()
  const { user, loadRemoteAudios } = useAuth()
  const {
    library,
    playlists,
    playback,
    remotePlayback,
    openPlayer,
    openRemotePlayer,
    playQueueEntry,
    setPlaybackQueue,
  } = useAudioLibraryContext()
  const [remoteAudios, setRemoteAudios] = useState<RemoteAudio[]>([])
  const [cachedRemoteIds, setCachedRemoteIds] = useState<Set<string>>(new Set())
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isOnline = networkState.isConnected !== false
  const hasPlayer = playback.activeItemId !== null

  const playlist =
    playlists.playlists.find((candidate) => candidate.id === playlistId) ?? null

  useEffect(() => {
    setDraftName(playlist?.name ?? '')
    setDraftDescription(playlist?.description ?? '')
  }, [playlist?.description, playlist?.id, playlist?.name])

  useEffect(() => {
    let isMounted = true

    if (!user) {
      setRemoteAudios([])
      setCachedRemoteIds(new Set())
      return () => {
        isMounted = false
      }
    }

    void (async () => {
      const cached = await loadCachedRemoteAudios(user.id)

      if (isMounted) {
        setRemoteAudios((previous) => mergeRemoteAudios(previous, cached))
        setCachedRemoteIds(new Set(cached.map((audio) => audio.id)))
      }

      if (networkState.isConnected === false) {
        return
      }

      try {
        const online = await loadRemoteAudios()

        if (isMounted) {
          setRemoteAudios((previous) => mergeRemoteAudios(online, previous))
        }
      } catch {
        // Keep cached audios visible when the remote library refresh fails.
      }
    })()

    return () => {
      isMounted = false
    }
  }, [loadRemoteAudios, networkState.isConnected, user])

  const entries: QueueEntry[] = useMemo(
    () =>
      playlist
        ? resolvePlaylistEntries(
            playlist,
            library.items,
            remoteAudios,
            cachedRemoteIds,
          )
        : [],
    [cachedRemoteIds, library.items, playlist, remoteAudios],
  )
  const playableCount = useMemo(
    () => countPlayableEntries(entries, isOnline),
    [entries, isOnline],
  )

  useFocusEffect(
    useCallback(() => {
      setPlaybackQueue(entries, isOnline)

      return () => setPlaybackQueue(null, isOnline)
    }, [entries, isOnline, setPlaybackQueue]),
  )

  const handlePlayEntry = useCallback(
    (entry: QueueEntry) => {
      if (entry.kind === 'local') {
        if (remotePlayback.activeAudioId || remotePlayback.isTransitioning) {
          remotePlayback.stop()
        }

        openPlayer(entry.item)
        playback.togglePlayback(entry.item)
      } else {
        if (
          remotePlayback.activeAudioId !== entry.audio.id &&
          playback.activeItemId
        ) {
          void playback.dismissPlayer().then((didStop) => {
            if (didStop) {
              openRemotePlayer(entry.audio)
              remotePlayback.togglePlayback(entry.audio)
            }
          })
          return
        }

        openRemotePlayer(entry.audio)
        remotePlayback.togglePlayback(entry.audio)
      }

      setPlaybackQueue(entries, isOnline)
    },
    [
      entries,
      isOnline,
      openPlayer,
      openRemotePlayer,
      playback,
      remotePlayback,
      setPlaybackQueue,
    ],
  )

  const handlePlayAll = useCallback(() => {
    const first = entries.find((entry) =>
      entry.kind === 'local'
        ? entry.item.isAvailable
        : isOnline || entry.isCached,
    )

    if (first) {
      playQueueEntry(first, entries, isOnline)
    }
  }, [entries, isOnline, playQueueEntry])

  const handleDeleted = useCallback(() => {
    if (onDeleted) {
      onDeleted()
    } else {
      onClose()
    }
  }, [onClose, onDeleted])

  if (playlists.isLoading || library.isLoading) {
    return (
      <ThemedView flex={1}>
        <SafeAreaView style={styles.safeArea}>
          <YStack
            flex={1}
            alignItems="center"
            justifyContent="center"
            gap={Spacing.three}
          >
            <Spinner color="$accent" />
            <ThemedText themeColor="textSecondary">
              Loading playlist…
            </ThemedText>
          </YStack>
        </SafeAreaView>
      </ThemedView>
    )
  }

  if (!playlist) {
    return (
      <ThemedView flex={1}>
        <SafeAreaView style={styles.safeArea}>
          <YStack
            flex={1}
            alignItems="center"
            justifyContent="center"
            gap={Spacing.three}
            padding={Spacing.five}
          >
            <ThemedText type="heading" textAlign="center">
              Playlist not found
            </ThemedText>
            <ThemedText themeColor="textSecondary" textAlign="center">
              It may have been deleted on another screen.
            </ThemedText>
            <AppButton tone="secondary" onPress={onClose}>
              <ThemedText type="smallBold">Back to playlists</ThemedText>
            </AppButton>
          </YStack>
        </SafeAreaView>
      </ThemedView>
    )
  }

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <XStack>
          <YStack
            width="20%"
            alignSelf="center"
            maxWidth={MaxContentWidth}
            paddingHorizontal={media.wide ? Spacing.five : Spacing.three}
            paddingTop={media.short ? Spacing.three : Spacing.four}
            paddingBottom={Spacing.two}
          >
            <AppButton
              tone="ghost"
              alignSelf="flex-start"
              accessibilityLabel="Back to playlists"
              onPress={onClose}
            >
              <SymbolView
                name={BACK_ICON}
                size={25}
                tintColor={theme.text}
                weight="bold"
              />
            </AppButton>
          </YStack>
          <YStack>
            <XStack alignItems="flex-end" gap={12} mb={Spacing.two}>
              <ThemedText type="title">{playlist.name}</ThemedText>
            </XStack>
            {playlist.description ? (
              <ThemedText themeColor="textSecondary">
                {playlist.description}
              </ThemedText>
            ) : null}
            <ThemedText type="metadata" themeColor="textSecondary">
              {entries.length === 0
                ? 'Empty playlist'
                : `${entries.length} ${entries.length === 1 ? 'audio' : 'audios'} · ${playableCount} playable · plays in order`}
            </ThemedText>
          </YStack>
        </XStack>
        <FlatList<QueueEntry>
          data={entries}
          keyExtractor={(entry) =>
            entry.kind === 'local'
              ? `local-${entry.item.id}`
              : `remote-${entry.audio.id}`
          }
          style={styles.list}
          contentContainerStyle={{
            flexGrow: 1,
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
            paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
            paddingTop: Spacing.two,
            paddingBottom:
              (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four,
          }}
          ItemSeparatorComponent={() => <View height={Spacing.three} />}
          ListHeaderComponent={
            <YStack gap={Spacing.four} marginBottom={Spacing.four}>
              <XStack gap={Spacing.two} flexWrap="wrap">
                <AppButton
                  accessibilityLabel={`Play ${playlist.name}`}
                  disabled={playableCount === 0 || playback.isTransitioning}
                  onPress={handlePlayAll}
                >
                  <SymbolView
                    name={PLAY_ICON}
                    size={18}
                    tintColor={theme.accentForeground}
                    weight="bold"
                  />
                  <ThemedText type="smallBold" color="$accentForeground">
                    Play in order
                  </ThemedText>
                </AppButton>
                <AppButton
                  tone="outlined"
                  accessibilityLabel={`Rename ${playlist.name}`}
                  disabled={playlists.isMutating}
                  onPress={() => setIsRenameOpen(true)}
                >
                  <ThemedText type="smallBold">Rename</ThemedText>
                </AppButton>
              </XStack>

              {playlists.notice && (
                <ThemedView
                  type="backgroundSelected"
                  flexDirection="row"
                  alignItems="center"
                  gap={Spacing.three}
                  padding={Spacing.three}
                  borderRadius={Radius.medium}
                >
                  <YStack flex={1} gap={Spacing.one}>
                    <ThemedText type="smallBold">
                      {playlists.notice.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {playlists.notice.message}
                    </ThemedText>
                  </YStack>
                  <AppButton tone="ghost" onPress={playlists.dismissNotice}>
                    <ThemedText type="smallBold">Dismiss</ThemedText>
                  </AppButton>
                </ThemedView>
              )}
            </YStack>
          }
          ListEmptyComponent={
            <ThemedView
              type="backgroundElement"
              alignItems="center"
              gap={Spacing.two}
              padding={Spacing.five}
              borderWidth={1}
              borderColor="$borderColor"
              borderRadius={Radius.large}
            >
              <ThemedText type="heading" textAlign="center">
                Add audios to start
              </ThemedText>
              <ThemedText
                themeColor="textSecondary"
                textAlign="center"
                maxWidth={420}
              >
                Open your library, use “Add to playlist” on any audio, and
                choose “{playlist.name}”.
              </ThemedText>
              <AppButton tone="secondary" onPress={onOpenLibrary}>
                <ThemedText type="smallBold">Open library</ThemedText>
              </AppButton>
            </ThemedView>
          }
          renderItem={({ item, index }) => (
            <PlaylistEntryRow
              entry={item}
              index={index}
              isFirst={index === 0}
              isLast={index === entries.length - 1}
              isMutating={playlists.isMutating || library.isMutating}
              onPlay={() => handlePlayEntry(item)}
              onMove={(offset) =>
                void playlists.reorderPlaylistItem(
                  playlist.id,
                  item.kind === 'local'
                    ? { kind: 'local', audioId: item.item.id }
                    : { kind: 'remote', audioId: item.audio.id },
                  offset,
                )
              }
              onRemove={() =>
                void playlists.removeFromPlaylist(
                  playlist.id,
                  item.kind === 'local'
                    ? { kind: 'local', audioId: item.item.id }
                    : { kind: 'remote', audioId: item.audio.id },
                )
              }
            />
          )}
        />

        {isRenameOpen && (
          <RenamePlaylistModal
            name={draftName}
            description={draftDescription}
            isSaving={isSaving}
            onNameChange={setDraftName}
            onDescriptionChange={setDraftDescription}
            onClose={() => {
              if (!isSaving) {
                setIsRenameOpen(false)
                setDraftName(playlist.name)
                setDraftDescription(playlist.description ?? '')
              }
            }}
            onSave={() => {
              setIsSaving(true)
              void playlists
                .renamePlaylist(playlist.id, draftName, draftDescription)
                .then((didSave) => {
                  setIsSaving(false)

                  if (didSave) {
                    setIsRenameOpen(false)
                  }
                })
            }}
            onDelete={() => {
              Alert.alert(
                'Delete playlist?',
                `“${playlist.name}” will be removed. Your audio files stay in the library.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      setIsRenameOpen(false)
                      void playlists
                        .deletePlaylist(playlist.id)
                        .then(handleDeleted)
                    },
                  },
                ],
              )
            }}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  )
}

function mergeRemoteAudios(
  online: RemoteAudio[],
  cached: RemoteAudio[],
): RemoteAudio[] {
  const onlineIds = new Set(online.map((audio) => audio.id))
  return [...online, ...cached.filter((audio) => !onlineIds.has(audio.id))]
}

type PlaylistEntryRowProps = {
  entry: QueueEntry
  index: number
  isFirst: boolean
  isLast: boolean
  isMutating: boolean
  onPlay: () => void
  onMove: (offset: number) => void
  onRemove: () => void
}

function PlaylistEntryRow({
  entry,
  index,
  isFirst,
  isLast,
  isMutating,
  onPlay,
  onMove,
  onRemove,
}: PlaylistEntryRowProps) {
  const { playback, remotePlayback, openPlayer, openRemotePlayer, library } =
    useAudioLibraryContext()

  if (entry.kind === 'remote') {
    const audio = entry.audio
    const isActive = remotePlayback.activeAudioId === audio.id

    return (
      <YStack gap={Spacing.two}>
        <PlaylistOrderControls
          index={index}
          isFirst={isFirst}
          isLast={isLast}
          isMutating={isMutating}
          title={audio.title}
          onMove={onMove}
          onRemove={onRemove}
        />
        <RemoteAudioRow
          audio={audio}
          isCached={entry.isCached}
          downloadState={getRemoteAudioDownloadState(entry.isCached, false)}
          canDownload={false}
          downloadError={null}
          isActive={isActive}
          isPlaying={isActive && remotePlayback.isPlaying}
          isTransitioning={remotePlayback.isTransitioning}
          playbackError={
            remotePlayback.playbackError?.audioId === audio.id
              ? remotePlayback.playbackError.message
              : null
          }
          onOpenPlayer={openRemotePlayer}
          onTogglePlayback={() => onPlay()}
        />
      </YStack>
    )
  }

  const item: LoadedAudioItem = entry.item
  const isActive = playback.activeItemId === item.id
  const freshItem =
    library.items.find((candidate) => candidate.id === item.id) ?? item

  return (
    <YStack gap={Spacing.two}>
      <PlaylistOrderControls
        index={index}
        isFirst={isFirst}
        isLast={isLast}
        isMutating={isMutating}
        title={getAudioItemTitle(item)}
        onMove={onMove}
        onRemove={onRemove}
      />
      <AudioLibraryRow
        item={freshItem}
        isActive={isActive}
        isPlaying={isActive && playback.isPlaying}
        isTransitioning={playback.isTransitioning}
        isPlaybackReady={playback.isReady}
        currentPositionSeconds={playback.currentPositionSeconds}
        duplicateHighlightToken={0}
        isDeleteDisabled
        isMetadataDisabled={library.isMutating}
        isReorderDisabled
        loadedDurationSeconds={playback.durationSeconds}
        playbackError={playback.playbackError}
        canUpload={false}
        isUploading={false}
        isUploaded={false}
        uploadProgressPercent={null}
        uploadError={null}
        onDelete={() => undefined}
        onOpenPlayer={openPlayer}
        onReorder={() => undefined}
        onSaveMetadata={library.updateAudioMetadata}
        onTogglePlayback={() => onPlay()}
        onUpload={() => undefined}
      />
      <ThemedText type="metadata" themeColor="textSecondary">
        {item.durationSeconds !== null
          ? `${index + 1} of playlist · ${formatPlaybackTime(item.durationSeconds)}`
          : `${index + 1} of playlist`}
      </ThemedText>
    </YStack>
  )
}

function PlaylistOrderControls({
  index,
  isFirst,
  isLast,
  isMutating,
  title,
  onMove,
  onRemove,
}: {
  index: number
  isFirst: boolean
  isLast: boolean
  isMutating: boolean
  title: string
  onMove: (offset: number) => void
  onRemove: () => void
}) {
  const theme = useTheme()

  const confirmRemove = () => {
    Alert.alert('Remove from playlist?', `“${title}” stays in your library.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: onRemove },
    ])
  }

  return (
    <XStack alignItems="center" gap={Spacing.two}>
      <ThemedView
        type="backgroundElement"
        width={32}
        height={32}
        alignItems="center"
        justifyContent="center"
        borderRadius={16}
        borderWidth={1}
        borderColor="$borderColor"
      >
        <ThemedText type="smallBold">{index + 1}</ThemedText>
      </ThemedView>
      <ThemedText type="metadata" themeColor="textSecondary" flex={1}>
        Position {index + 1}
      </ThemedText>
      <AppButton
        tone="icon"
        accessibilityLabel={`Move ${title} earlier`}
        accessibilityState={{ disabled: isMutating || isFirst }}
        disabled={isMutating || isFirst}
        onPress={() => onMove(-1)}
      >
        <SymbolView
          name={UP_ICON}
          size={18}
          tintColor={theme.text}
          weight="bold"
        />
      </AppButton>
      <AppButton
        tone="icon"
        accessibilityLabel={`Move ${title} later`}
        accessibilityState={{ disabled: isMutating || isLast }}
        disabled={isMutating || isLast}
        onPress={() => onMove(1)}
      >
        <SymbolView
          name={DOWN_ICON}
          size={18}
          tintColor={theme.text}
          weight="bold"
        />
      </AppButton>
      <AppButton
        tone="danger"
        accessibilityLabel={`Remove ${title} from playlist`}
        accessibilityState={{ disabled: isMutating }}
        disabled={isMutating}
        onPress={confirmRemove}
      >
        <SymbolView name={REMOVE_ICON} size={17} tintColor={theme.danger} />
      </AppButton>
    </XStack>
  )
}

function RenamePlaylistModal({
  name,
  description,
  isSaving,
  onNameChange,
  onDescriptionChange,
  onClose,
  onSave,
  onDelete,
}: {
  name: string
  description: string
  isSaving: boolean
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}) {
  const theme = useTheme()

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={onClose}
    >
      <ThemedView flex={1}>
        <SafeAreaView style={styles.safeArea}>
          <XStack
            alignItems="center"
            justifyContent="space-between"
            gap={Spacing.two}
            paddingHorizontal={Spacing.three}
            paddingVertical={Spacing.two}
          >
            <AppButton
              tone="ghost"
              accessibilityLabel="Cancel rename"
              disabled={isSaving}
              onPress={onClose}
            >
              <ThemedText type="smallBold">Cancel</ThemedText>
            </AppButton>
            <ThemedText type="heading">Edit playlist</ThemedText>
            <AppButton
              accessibilityLabel="Save playlist"
              accessibilityState={{ busy: isSaving }}
              disabled={isSaving}
              onPress={onSave}
            >
              <ThemedText type="smallBold" color="$accentForeground">
                {isSaving ? 'Saving…' : 'Save'}
              </ThemedText>
            </AppButton>
          </XStack>
          <YStack
            width="100%"
            maxWidth={640}
            alignSelf="center"
            gap={Spacing.three}
            paddingHorizontal={Spacing.three}
            paddingTop={Spacing.two}
          >
            <YStack gap={Spacing.one}>
              <ThemedText type="smallBold">Name</ThemedText>
              <TextInput
                accessibilityLabel="Playlist name"
                value={name}
                onChangeText={onNameChange}
                maxLength={80}
                placeholder="Playlist name"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.borderColor,
                    color: theme.text,
                  },
                ]}
              />
            </YStack>
            <YStack gap={Spacing.one}>
              <ThemedText type="smallBold">Description (optional)</ThemedText>
              <TextInput
                accessibilityLabel="Playlist description"
                value={description}
                onChangeText={onDescriptionChange}
                multiline
                placeholder="What is this playlist for?"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  styles.multiline,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.borderColor,
                    color: theme.text,
                  },
                ]}
              />
            </YStack>
            <AppButton
              tone="danger"
              accessibilityLabel="Delete playlist"
              disabled={isSaving}
              onPress={onDelete}
            >
              <ThemedText type="smallBold" color="$danger">
                Delete playlist
              </ThemedText>
            </AppButton>
          </YStack>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  )
}

const BACK_ICON: SymbolViewProps['name'] = {
  ios: 'chevron.left',
  android: 'arrow_back',
  web: 'arrow_back',
}
const PLAY_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
}
const UP_ICON: SymbolViewProps['name'] = {
  ios: 'chevron.up',
  android: 'keyboard_arrow_up',
  web: 'keyboard_arrow_up',
}
const DOWN_ICON: SymbolViewProps['name'] = {
  ios: 'chevron.down',
  android: 'keyboard_arrow_down',
  web: 'keyboard_arrow_down',
}
const REMOVE_ICON: SymbolViewProps['name'] = {
  ios: 'minus.circle',
  android: 'remove_circle_outline',
  web: 'remove_circle_outline',
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
})
