import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useState } from 'react'
import { Modal, Platform, StyleSheet, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, Spinner, View, XStack, YStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useAudioLibraryContext } from '@/contexts/audio-library-context'
import { useTheme } from '@/hooks/use-theme'
import { selection, success } from '@/services/haptics'
import type { PlaylistAudioRef } from '@/models/playlist'

type AddToPlaylistSheetProps = {
  audioRef: PlaylistAudioRef
  audioTitle: string
  onClose: () => void
  onAdded: (playlistName: string) => void
}

export function AddToPlaylistSheet({ audioRef, audioTitle, onClose, onAdded }: AddToPlaylistSheetProps) {
  const { playlists } = useAudioLibraryContext()
  const theme = useTheme()
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [pendingPlaylistId, setPendingPlaylistId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async (playlistId: string, playlistName: string) => {
    setPendingPlaylistId(playlistId)
    setError(null)
    selection()
    const outcome = await playlists.addToPlaylist(playlistId, audioRef)
    setPendingPlaylistId(null)

    if (outcome === 'added') {
      success()
      onAdded(playlistName)
      onClose()
    } else if (outcome === 'duplicate') {
      setError(`“${audioTitle}” is already in “${playlistName}”.`)
    } else if (outcome === 'missing') {
      setError('That playlist no longer exists.')
    } else {
      setError('Could not add to the playlist. Try again.')
    }
  }

  const handleCreate = async () => {
    if (isCreating) {
      return
    }

    setIsCreating(true)
    setError(null)
    const playlist = await playlists.createPlaylist(newName)
    setIsCreating(false)

    if (!playlist) {
      if (!newName.trim()) {
        setError('Give your playlist a name to create it.')
      } else {
        setError('Could not create the playlist. Try again.')
      }
      return
    }

    setNewName('')
    await handleAdd(playlist.id, playlist.name)
  }

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
            <AppButton tone="ghost" accessibilityLabel="Close add to playlist" onPress={onClose}>
              <ThemedText type="smallBold">Cancel</ThemedText>
            </AppButton>
            <ThemedText type="heading">Add to playlist</ThemedText>
            <View width={64} />
          </XStack>

          <ScrollView
            flex={1}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <YStack width="100%" maxWidth={640} alignSelf="center" gap={Spacing.three}>
              <ThemedText type="metadata" themeColor="textSecondary" numberOfLines={2}>
                {audioTitle}
              </ThemedText>

              <YStack gap={Spacing.one}>
                <ThemedText type="smallBold">New playlist</ThemedText>
                <XStack gap={Spacing.two} alignItems="center">
                  <TextInput
                    accessibilityLabel="New playlist name"
                    placeholder="Playlist name"
                    placeholderTextColor={theme.textSecondary}
                    value={newName}
                    onChangeText={setNewName}
                    maxLength={80}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.borderColor,
                        color: theme.text,
                      },
                    ]}
                  />
                  <AppButton
                    accessibilityLabel="Create playlist and add audio"
                    accessibilityState={{ busy: isCreating }}
                    disabled={isCreating || playlists.isMutating}
                    onPress={() => void handleCreate()}
                  >
                    {isCreating ? (
                      <Spinner size="small" color="$accentForeground" />
                    ) : (
                      <ThemedText type="smallBold" color="$accentForeground">
                        Create
                      </ThemedText>
                    )}
                  </AppButton>
                </XStack>
              </YStack>

              {error ? (
                <ThemedText accessibilityLiveRegion="polite" type="metadata" color="$danger">
                  {error}
                </ThemedText>
              ) : null}

              {playlists.isLoading ? (
                <XStack alignItems="center" gap={Spacing.two}>
                  <Spinner size="small" color="$accent" />
                  <ThemedText type="small" themeColor="textSecondary">
                    Loading playlists…
                  </ThemedText>
                </XStack>
              ) : playlists.playlists.length === 0 ? (
                <ThemedView
                  type="backgroundElement"
                  padding={Spacing.four}
                  borderWidth={1}
                  borderColor="$borderColor"
                  borderRadius={Radius.large}
                >
                  <ThemedText type="small" themeColor="textSecondary" textAlign="center">
                    No playlists yet. Create your first one above.
                  </ThemedText>
                </ThemedView>
              ) : (
                <YStack gap={Spacing.two}>
                  {playlists.playlists.map((playlist) => {
                    const isPending = pendingPlaylistId === playlist.id

                    return (
                      <ThemedView
                        key={playlist.id}
                        type="backgroundElement"
                        borderWidth={1}
                        borderColor="$borderColor"
                        borderRadius={Radius.large}
                      >
                        <XStack alignItems="center" gap={Spacing.two} padding={Spacing.three}>
                          <YStack flex={1} minWidth={0}>
                            <ThemedText type="smallBold" numberOfLines={1}>
                              {playlist.name}
                            </ThemedText>
                            <ThemedText type="metadata" themeColor="textSecondary" numberOfLines={1}>
                              {playlist.items.length} {playlist.items.length === 1 ? 'audio' : 'audios'}
                            </ThemedText>
                          </YStack>
                          <AppButton
                            tone="secondary"
                            accessibilityLabel={`Add to ${playlist.name}`}
                            accessibilityState={{ busy: isPending }}
                            disabled={isPending || playlists.isMutating}
                            onPress={() => void handleAdd(playlist.id, playlist.name)}
                          >
                            {isPending ? (
                              <Spinner size="small" color="$accent" />
                            ) : (
                              <XStack alignItems="center" gap={Spacing.one}>
                                <SymbolView
                                  name={ADD_ICON}
                                  size={16}
                                  tintColor={theme.text}
                                  weight="bold"
                                />
                                <ThemedText type="smallBold">Add</ThemedText>
                              </XStack>
                            )}
                          </AppButton>
                        </XStack>
                      </ThemedView>
                    )
                  })}
                </YStack>
              )}

              {Platform.OS === 'web' ? <View height={Spacing.four} /> : null}
            </YStack>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  )
}

const ADD_ICON: SymbolViewProps['name'] = {
  ios: 'plus',
  android: 'add',
  web: 'add',
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
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
