import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useEffect, useRef, useState } from 'react'
import { Alert, FlatList, Platform, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Spinner, View, XStack, YStack, useMedia } from 'tamagui'

import { AudioLibraryRow } from '@/components/audio-library-row'
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
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import { formatPlaybackTime } from '@/utils/audio-display'

export default function HomeScreen() {
  const { library, playback, openPlayer } = useAudioLibraryContext()
  const media = useMedia()
  const theme = useTheme()
  const listRef = useRef<FlatList<LoadedAudioItem>>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRetryCountRef = useRef(0)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(
    null,
  )
  const [highlightToken, setHighlightToken] = useState(0)
  const isLibraryBusy = library.importPhase !== 'idle' || library.isMutating
  const hasPlayer = playback.activeItemId !== null
  const totalDuration = library.items.reduce(
    (total, item) => total + (item.durationSeconds ?? 0),
    0,
  )
  const contentContainerStyle = {
    flexGrow: 1,
    width: '100%' as const,
    maxWidth: MaxContentWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
    paddingTop: media.short ? Spacing.three : Spacing.four,
    paddingBottom:
      (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four,
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
      if (scrollRetryTimerRef.current) clearTimeout(scrollRetryTimerRef.current)
    }
  }, [])

  const showToast = (message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }

    setToastMessage(message)
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3_500)
  }

  const highlightDuplicate = (itemId: string) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current)
    }

    highlightTimerRef.current = setTimeout(() => {
      setHighlightedItemId(itemId)
      setHighlightToken((token) => token + 1)
    }, 600)
  }

  const handleAddAudio = async () => {
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
  }

  const handleRemoveAudio = async (item: LoadedAudioItem) => {
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
  }

  const confirmRemoveAudio = (item: LoadedAudioItem) => {
    Alert.alert(
      'Remove audio?',
      `“${item.originalName}” will be removed from the playlist and permanently deleted from app storage.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void handleRemoveAudio(item),
        },
      ],
    )
  }

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          ref={listRef}
          data={library.items}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={contentContainerStyle}
          ItemSeparatorComponent={() => <View height={Spacing.three} />}
          ListHeaderComponent={
            <YStack gap={Spacing.four} marginBottom={Spacing.four}>
              <XStack
                alignItems="flex-end"
                justifyContent="space-between"
                gap={Spacing.three}
                $compact={{ flexDirection: 'column', alignItems: 'stretch' }}
              >
                <YStack flex={1} gap={Spacing.one}>
                  <ThemedText type="eyebrow" themeColor="accent">
                    Your collection
                  </ThemedText>
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
                    onPress={() => void handleAddAudio()}
                    tintColor={theme.accentForeground}
                  />
                )}
              </XStack>

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
          }
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
                    onPress={() => void handleAddAudio()}
                    tintColor={theme.accentForeground}
                  />
                )}
              </ThemedView>
            )
          }
          onScrollToIndexFailed={({ averageItemLength, index }) => {
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
          }}
          renderItem={({ item }) => {
            const isActive = playback.activeItemId === item.id

            return (
              <AudioLibraryRow
                item={item}
                isActive={isActive}
                isPlaying={isActive && playback.isPlaying}
                isTransitioning={playback.isTransitioning}
                isPlaybackReady={playback.isReady}
                currentPositionSeconds={playback.currentPositionSeconds}
                duplicateHighlightToken={
                  highlightedItemId === item.id ? highlightToken : 0
                }
                isDeleteDisabled={isLibraryBusy || playback.isTransitioning}
                isReorderDisabled={isLibraryBusy || library.items.length < 2}
                loadedDurationSeconds={playback.durationSeconds}
                playbackError={playback.playbackError}
                onDelete={confirmRemoveAudio}
                onOpenPlayer={openPlayer}
                onReorder={(itemId, offset) =>
                  void library.reorderAudio(itemId, offset)
                }
                onTogglePlayback={playback.togglePlayback}
              />
            )
          }}
        />
        {toastMessage && (
          <ToastMessage message={toastMessage} hasPlayer={hasPlayer} />
        )}
      </SafeAreaView>
    </ThemedView>
  )
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

function StatChip({ label, value }: { label: string; value: string }) {
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
}

function ToastMessage({
  message,
  hasPlayer,
}: {
  message: string
  hasPlayer: boolean
}) {
  return (
    <ThemedView
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      type="backgroundSelected"
      position="absolute"
      right={Spacing.four}
      bottom={(hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four}
      left={Spacing.four}
      maxWidth={560}
      alignSelf="center"
      paddingHorizontal={Spacing.four}
      paddingVertical={Spacing.three}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.medium}
      boxShadow="0 10px 24px rgba(0,0,0,0.24)"
      $compact={{ right: Spacing.two, left: Spacing.two }}
    >
      <ThemedText type="smallBold" textAlign="center">
        {message}
      </ThemedText>
    </ThemedView>
  )
}

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
const LIBRARY_ICON: SymbolViewProps['name'] = {
  ios: 'headphones',
  android: 'headphones',
  web: 'headphones',
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
})
