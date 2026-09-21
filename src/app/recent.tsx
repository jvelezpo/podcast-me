import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useCallback, useMemo } from 'react'
import { FlatList, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, XStack, YStack, useMedia } from 'tamagui'

import { EpisodeArtwork } from '@/components/episode-artwork'
import { ResumeHero } from '@/components/resume-hero'
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
import {
  formatEpisodeDate,
  formatPlaybackTime,
  getAudioItemTitle,
} from '@/utils/audio-display'
import { findResumeItem } from '@/utils/resume'

export default function RecentScreen() {
  const { library, openPlayer, playback, remotePlayback } =
    useAudioLibraryContext()
  const media = useMedia()
  const theme = useTheme()
  const recentItems = useMemo(
    () =>
      [...library.items]
        .sort((first, second) => second.addedAt.localeCompare(first.addedAt))
        .slice(0, 3),
    [library.items],
  )
  const hasPlayer =
    playback.activeItemId !== null || remotePlayback.activeAudioId !== null
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

  const handlePlay = useCallback(
    (item: LoadedAudioItem) => {
      openPlayer(item)

      if (remotePlayback.activeAudioId || remotePlayback.isTransitioning) {
        remotePlayback.stop()
      }

      playback.togglePlayback(item)
    },
    [
      openPlayer,
      playback.togglePlayback,
      remotePlayback.activeAudioId,
      remotePlayback.isTransitioning,
      remotePlayback.stop,
    ],
  )
  const handleResume = useCallback(() => {
    if (resumeItem) {
      handlePlay(resumeItem)
    }
  }, [handlePlay, resumeItem])

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={recentItems}
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
          ItemSeparatorComponent={() => <View height={Spacing.two} />}
          ListHeaderComponent={
            <YStack gap={Spacing.four} marginBottom={Spacing.four}>
              {!library.isLoading && resumeItem && (
                <ResumeHero
                  item={resumeItem}
                  positionSeconds={resumePositionSeconds}
                  durationSeconds={resumeDurationSeconds}
                  isResumeDisabled={
                    playback.isTransitioning || !playback.isReady
                  }
                  onResume={handleResume}
                />
              )}
              <YStack gap={Spacing.one}>
                <ThemedText type="eyebrow" themeColor="accent">
                  Your library
                </ThemedText>
                <ThemedText
                  type="title"
                  $compact={{ fontSize: 36, lineHeight: 42 }}
                >
                  Recently added
                </ThemedText>
                <ThemedText themeColor="textSecondary">
                  Fresh arrivals in your library.
                </ThemedText>
              </YStack>
            </YStack>
          }
          ListEmptyComponent={
            !library.isLoading ? (
              <ThemedView
                type="backgroundElement"
                alignItems="center"
                gap={Spacing.two}
                padding={Spacing.four}
                borderWidth={1}
                borderColor="$borderColor"
                borderRadius={Radius.large}
              >
                <ThemedText type="heading">Nothing added yet</ThemedText>
                <ThemedText textAlign="center" themeColor="textSecondary">
                  Add audio in Library and it will appear here.
                </ThemedText>
              </ThemedView>
            ) : null
          }
          renderItem={({ item }) => {
            const title = getAudioItemTitle(item)
            const isActive = playback.activeItemId === item.id

            return (
              <ThemedView
                type="backgroundElement"
                flexDirection="row"
                alignItems="center"
                gap={Spacing.two}
                padding={Spacing.two}
                borderWidth={1}
                borderColor={isActive ? '$accent' : '$borderColor'}
                borderRadius={Radius.medium}
              >
                <EpisodeArtwork
                  imageUrl={item.metadata.coverArtUrl}
                  itemId={item.id}
                  name={title}
                  size={56}
                />
                <YStack flex={1} minWidth={0} gap={Spacing.half}>
                  <ThemedText type="episodeTitle" numberOfLines={1}>
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
                    isActive && playback.isPlaying
                      ? `Pause ${title}`
                      : `Play ${title}`
                  }
                  disabled={!item.isAvailable || playback.isTransitioning}
                  onPress={() => handlePlay(item)}
                >
                  <SymbolView
                    name={isActive && playback.isPlaying ? PAUSE_ICON : PLAY_ICON}
                    size={22}
                    tintColor={theme.text}
                    weight="bold"
                  />
                </AppButton>
              </ThemedView>
            )
          }}
        />
      </SafeAreaView>
    </ThemedView>
  )
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

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
})
