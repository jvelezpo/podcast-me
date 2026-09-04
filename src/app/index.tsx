import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spinner, View, XStack, YStack, useMedia } from 'tamagui';

import { AudioLibraryRow } from '@/components/audio-library-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAudioLibrary } from '@/hooks/use-audio-library';
import { useAudioLibraryPlayer } from '@/hooks/use-audio-library-player';
import type { LoadedAudioItem } from '@/services/audio-library-storage';

export default function HomeScreen() {
  const library = useAudioLibrary();
  const playback = useAudioLibraryPlayer(library.updateAudioItem, !library.isLoading);
  const media = useMedia();
  const listRef = useRef<FlatList<LoadedAudioItem>>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRetryCountRef = useRef(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [highlightToken, setHighlightToken] = useState(0);
  const isLibraryBusy = library.importPhase !== 'idle' || library.isMutating;
  const contentContainerStyle = {
    flexGrow: 1,
    width: '100%' as const,
    maxWidth: MaxContentWidth,
    alignSelf: 'center' as const,
    paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
    paddingTop: media.short ? Spacing.three : Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      if (scrollRetryTimerRef.current) {
        clearTimeout(scrollRetryTimerRef.current);
      }
    };
  }, []);

  const showToast = (message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3_500);
  };

  const highlightDuplicate = (itemId: string) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }

    highlightTimerRef.current = setTimeout(() => {
      setHighlightedItemId(itemId);
      setHighlightToken((token) => token + 1);
    }, 600);
  };

  const handleAddAudio = async () => {
    const outcome = await library.addAudio();

    if (outcome.duplicateItemId === null || outcome.duplicateItemIndex === null) {
      return;
    }

    const duplicateLabel =
      outcome.duplicateNames.length === 1
        ? `${outcome.duplicateNames[0]} is already in the playlist.`
        : `${outcome.duplicateNames.length} selected files are already in the playlist.`;
    showToast(duplicateLabel);
    scrollRetryCountRef.current = 0;

    if (scrollRetryTimerRef.current) {
      clearTimeout(scrollRetryTimerRef.current);
    }

    scrollRetryTimerRef.current = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          animated: true,
          index: outcome.duplicateItemIndex!,
          viewPosition: 0.5,
        });
      } catch {
        listRef.current?.scrollToEnd({ animated: true });
      }
    }, 100);
    highlightDuplicate(outcome.duplicateItemId);
  };

  const handleRemoveAudio = async (item: LoadedAudioItem) => {
    const isActive = playback.activeItemId === item.id;
    const shouldPlayNext = isActive && playback.isPlaying;
    const removesLastItem = library.items.length === 1;
    const nextItem = shouldPlayNext ? findNextPlayableItem(library.items, item.id) : null;

    const outcome = await library.removeAudio(
      item.id,
      isActive
        ? async () => {
            const released = await playback.removeActiveItem(
              item.id,
              nextItem,
              shouldPlayNext
            );

            if (!released) {
              throw new Error('The active player could not release the audio file.');
            }
          }
        : undefined
    );

    if (outcome.removed && removesLastItem) {
      showToast('There are no more files to play.');
    } else if (outcome.removed && shouldPlayNext && nextItem === null) {
      showToast('There are no more playable files.');
    }
  };

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
      ]
    );
  };

  if (Platform.OS === 'web') {
    return (
      <ThemedView flex={1}>
        <SafeAreaView style={nativeStyles.safeArea}>
          <ThemedView
            type="backgroundElement"
            flex={1}
            alignItems="center"
            justifyContent="center"
            gap={Spacing.three}
            margin={Spacing.four}
            padding={Spacing.four}
            borderRadius={Spacing.four}>
            <ThemedText type="title" textAlign="center" $compact={{ fontSize: 38 }}>
              Audio library
            </ThemedText>
            <ThemedText textAlign="center" themeColor="textSecondary">
              Local audio importing is available in the Android and iOS app.
            </ThemedText>
          </ThemedView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={nativeStyles.safeArea}>
        <FlatList
          ref={listRef}
          data={library.items}
          keyExtractor={(item) => item.id}
          style={nativeStyles.list}
          contentContainerStyle={contentContainerStyle}
          ItemSeparatorComponent={() => <View height={Spacing.three} />}
          ListHeaderComponent={
            <YStack gap={Spacing.three} marginBottom={Spacing.four}>
              <XStack
                alignItems="center"
                justifyContent="space-between"
                gap={Spacing.three}
                $compact={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <YStack flex={1} gap={Spacing.one}>
                  <ThemedText type="title" $compact={{ fontSize: 38, lineHeight: 44 }}>
                    Audio library
                  </ThemedText>
                  <ThemedText themeColor="textSecondary">
                    Your recordings stay on this device.
                  </ThemedText>
                </YStack>

                {!library.isLoading && library.items.length > 0 && (
                  <AddAudioButton
                    disabled={isLibraryBusy}
                    importPhase={library.importPhase}
                    onPress={() => void handleAddAudio()}
                  />
                )}
              </XStack>

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
                  <Spinner size="small" color="$color" />
                  <ThemedText type="small" themeColor="textSecondary">
                    Copying audio into the library…
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
                paddingVertical={Spacing.six}>
                <Spinner color="$color" />
                <ThemedText themeColor="textSecondary">Loading your audio library…</ThemedText>
              </ThemedView>
            ) : (
              <ThemedView
                type="backgroundElement"
                flex={1}
                alignItems="center"
                justifyContent="center"
                gap={Spacing.three}
                padding={Spacing.four}
                borderRadius={Spacing.four}
                $compact={{ padding: Spacing.three }}>
                <ThemedText type="subtitle" textAlign="center" $compact={{ fontSize: 28 }}>
                  Your library is empty
                </ThemedText>
                <ThemedText textAlign="center" themeColor="textSecondary">
                  Choose audio files from your phone to keep and play them locally.
                </ThemedText>
                <AddAudioButton
                  disabled={isLibraryBusy}
                  importPhase={library.importPhase}
                  onPress={() => void handleAddAudio()}
                />
              </ThemedView>
            )
          }
          onScrollToIndexFailed={({ averageItemLength, index }) => {
            if (scrollRetryCountRef.current >= 2) {
              return;
            }

            scrollRetryCountRef.current += 1;
            listRef.current?.scrollToOffset({
              animated: true,
              offset: Math.max(0, averageItemLength * index),
            });

            if (scrollRetryTimerRef.current) {
              clearTimeout(scrollRetryTimerRef.current);
            }

            scrollRetryTimerRef.current = setTimeout(() => {
              listRef.current?.scrollToIndex({
                animated: true,
                index,
                viewPosition: 0.5,
              });
            }, 250);
          }}
          renderItem={({ item }) => {
            const isActive = playback.activeItemId === item.id;

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
                onReorder={(itemId, offset) => {
                  void library.reorderAudio(itemId, offset);
                }}
                onSeekBy={playback.seekBy}
                onSeekTo={playback.seekTo}
                onTogglePlayback={playback.togglePlayback}
              />
            );
          }}
        />
        {toastMessage && <ToastMessage message={toastMessage} />}
      </SafeAreaView>
    </ThemedView>
  );
}

function findNextPlayableItem(
  items: readonly LoadedAudioItem[],
  itemId: string
): LoadedAudioItem | null {
  const currentIndex = items.findIndex((item) => item.id === itemId);

  if (currentIndex < 0) {
    return null;
  }

  return (
    items.slice(currentIndex + 1).find((item) => item.isAvailable) ??
    items.slice(0, currentIndex).reverse().find((item) => item.isAvailable) ??
    null
  );
}

function ToastMessage({ message }: { message: string }) {
  return (
    <ThemedView
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      type="backgroundSelected"
      position="absolute"
      right={Spacing.four}
      bottom={BottomTabInset + Spacing.four}
      left={Spacing.four}
      maxWidth={560}
      alignSelf="center"
      paddingHorizontal={Spacing.four}
      paddingVertical={Spacing.three}
      borderRadius={Spacing.three}
      boxShadow="0 4px 10px rgba(0, 0, 0, 0.24)"
      $compact={{ right: Spacing.two, left: Spacing.two }}>
      <ThemedText type="smallBold" textAlign="center">
        {message}
      </ThemedText>
    </ThemedView>
  );
}

type AddAudioButtonProps = {
  disabled: boolean;
  importPhase: 'idle' | 'picking' | 'importing';
  onPress: () => void;
};

function AddAudioButton({ disabled, importPhase, onPress }: AddAudioButtonProps) {
  const label =
    importPhase === 'picking'
      ? 'Choosing…'
      : importPhase === 'importing'
        ? 'Importing…'
        : 'Add audio';

  return (
    <AppButton
      accessibilityRole="button"
      accessibilityLabel="Add audio"
      accessibilityState={{ busy: importPhase !== 'idle', disabled }}
      disabled={disabled}
      onPress={onPress}
      borderWidth={0}
      $compact={{ width: '100%' }}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </AppButton>
  );
}

type StatusNoticeProps = {
  title: string;
  message: string;
  onDismiss: () => void;
};

function StatusNotice({ title, message, onDismiss }: StatusNoticeProps) {
  return (
    <ThemedView
      type="backgroundSelected"
      flexDirection="row"
      alignItems="center"
      gap={Spacing.three}
      padding={Spacing.three}
      borderRadius={Spacing.three}
      $compact={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <YStack flex={1} gap={Spacing.one}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small">{message}</ThemedText>
      </YStack>
      <AppButton
        tone="ghost"
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${title}`}
        onPress={onDismiss}>
        <ThemedText type="smallBold">Dismiss</ThemedText>
      </AppButton>
    </ThemedView>
  );
}

const nativeStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
});
