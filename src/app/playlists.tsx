import { useNetworkState } from 'expo-network'
import { useRouter } from 'expo-router'
import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useState } from 'react'
import { Alert, FlatList, Modal, StyleSheet, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Spinner, View, XStack, YStack, useMedia } from 'tamagui'

import { PlaylistDetailContent } from '@/components/playlist-detail-content'
import { PlaylistRow } from '@/components/playlist-row'
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
import { useTheme } from '@/hooks/use-theme'
import type { Playlist } from '@/models/playlist'
import { resolvePlaylistEntries } from '@/services/playlist-queue'

export default function PlaylistsScreen() {
  const { library, playback, playlists } = useAudioLibraryContext()
  const router = useRouter()
  const media = useMedia()
  const theme = useTheme()
  const networkState = useNetworkState()
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null)
  const isOnline = networkState.isConnected !== false
  const hasPlayer = playback.activeItemId !== null

  const handleCreate = async () => {
    if (isCreating) {
      return
    }

    setIsCreating(true)
    const playlist = await playlists.createPlaylist(newName)
    setIsCreating(false)

    if (playlist) {
      setNewName('')
      setToastMessage(`“${playlist.name}” was created.`)
      setTimeout(() => setToastMessage(null), 3_500)
    }
  }

  const handleOpen = (playlist: Playlist) => {
    // Tapping a playlist opens its audios immediately as a modal view,
    // so it works identically on native and web without relying on stack pushes.
    setOpenPlaylistId(playlist.id)
  }

  const confirmDelete = (playlist: Playlist) => {
    Alert.alert(
      'Delete playlist?',
      `“${playlist.name}” will be removed. Your audio files stay in the library.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void playlists.deletePlaylist(playlist.id),
        },
      ],
    )
  }

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList<Playlist>
          data={playlists.playlists}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={{
            flexGrow: 1,
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
            paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
            paddingTop: media.short ? Spacing.three : Spacing.four,
            paddingBottom:
              (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four,
          }}
          ItemSeparatorComponent={() => <View height={Spacing.three} />}
          ListHeaderComponent={
            <YStack gap={Spacing.four} marginBottom={Spacing.four}>
              <YStack gap={Spacing.one}>
                <ThemedText type="eyebrow" themeColor="accent">
                  Grouped listening
                </ThemedText>
                <ThemedText
                  type="title"
                  $compact={{ fontSize: 36, lineHeight: 42 }}
                >
                  Playlists
                </ThemedText>
                <ThemedText themeColor="textSecondary">
                  Group audios and play them in your own order. Add anything
                  from your library to a playlist.
                </ThemedText>
              </YStack>

              <ThemedView
                type="backgroundElement"
                gap={Spacing.two}
                padding={Spacing.three}
                borderWidth={1}
                borderColor="$borderColor"
                borderRadius={Radius.large}
              >
                <ThemedText type="smallBold">New playlist</ThemedText>
                <XStack gap={Spacing.two} alignItems="center">
                  <TextInput
                    accessibilityLabel="New playlist name"
                    placeholder="Road trip, focus, favorites…"
                    placeholderTextColor={theme.textSecondary}
                    value={newName}
                    onChangeText={setNewName}
                    maxLength={80}
                    onSubmitEditing={() => void handleCreate()}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.background,
                        borderColor: theme.borderColor,
                        color: theme.text,
                      },
                    ]}
                  />
                  <AppButton
                    accessibilityLabel="Create playlist"
                    accessibilityState={{ busy: isCreating }}
                    disabled={isCreating || playlists.isMutating}
                    onPress={() => void handleCreate()}
                  >
                    {isCreating ? (
                      <Spinner size="small" color="$accentForeground" />
                    ) : (
                      <XStack alignItems="center" gap={Spacing.one}>
                        <SymbolView
                          name={ADD_ICON}
                          size={16}
                          tintColor={theme.accentForeground}
                          weight="bold"
                        />
                        <ThemedText type="smallBold" color="$accentForeground">
                          Create
                        </ThemedText>
                      </XStack>
                    )}
                  </AppButton>
                </XStack>
              </ThemedView>

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
            playlists.isLoading ? (
              <YStack
                alignItems="center"
                gap={Spacing.three}
                paddingVertical={Spacing.six}
              >
                <Spinner color="$accent" />
                <ThemedText themeColor="textSecondary">
                  Loading your playlists…
                </ThemedText>
              </YStack>
            ) : (
              <ThemedView
                type="backgroundElement"
                alignItems="center"
                gap={Spacing.three}
                padding={Spacing.five}
                borderWidth={1}
                borderColor="$borderColor"
                borderRadius={Radius.large}
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
                    name={EMPTY_ICON}
                    size={30}
                    tintColor={theme.accent}
                  />
                </View>
                <ThemedText type="heading" textAlign="center">
                  No playlists yet
                </ThemedText>
                <ThemedText
                  textAlign="center"
                  themeColor="textSecondary"
                  maxWidth={420}
                >
                  Create a playlist above, then add audios from your library to
                  play them in a specific order.
                </ThemedText>
              </ThemedView>
            )
          }
          renderItem={({ item }) => {
            const entries = resolvePlaylistEntries(
              item,
              library.items,
              [],
              new Set(),
            )
            const playableCount = entries.filter((entry) =>
              entry.kind === 'local'
                ? entry.item.isAvailable
                : isOnline || entry.isCached,
            ).length

            return (
              <PlaylistRow
                playlist={item}
                playableCount={playableCount}
                onOpen={handleOpen}
                onDelete={confirmDelete}
                isDeleteDisabled={playlists.isMutating}
              />
            )
          }}
        />
        {toastMessage && (
          <ThemedView
            accessibilityLiveRegion="polite"
            type="backgroundSelected"
            position="absolute"
            right={Spacing.four}
            bottom={
              (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four
            }
            left={Spacing.four}
            maxWidth={560}
            alignSelf="center"
            paddingHorizontal={Spacing.four}
            paddingVertical={Spacing.three}
            borderWidth={1}
            borderColor="$borderColor"
            borderRadius={Radius.medium}
          >
            <ThemedText type="smallBold" textAlign="center">
              {toastMessage}
            </ThemedText>
          </ThemedView>
        )}
        <Modal
          animationType="slide"
          presentationStyle="fullScreen"
          visible={openPlaylistId !== null}
          onRequestClose={() => setOpenPlaylistId(null)}
        >
          {openPlaylistId && (
            <PlaylistDetailContent
              playlistId={openPlaylistId}
              onClose={() => setOpenPlaylistId(null)}
              onOpenLibrary={() => {
                setOpenPlaylistId(null)
                router.push('/')
              }}
              onDeleted={() => setOpenPlaylistId(null)}
            />
          )}
        </Modal>
      </SafeAreaView>
    </ThemedView>
  )
}

const ADD_ICON: SymbolViewProps['name'] = {
  ios: 'plus',
  android: 'add',
  web: 'add',
}
const EMPTY_ICON: SymbolViewProps['name'] = {
  ios: 'music.note.list',
  android: 'queue_music',
  web: 'queue_music',
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
  input: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
})
