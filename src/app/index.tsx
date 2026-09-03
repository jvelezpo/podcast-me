import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudioLibraryRow } from '@/components/audio-library-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAudioLibrary } from '@/hooks/use-audio-library';
import { useAudioLibraryPlayer } from '@/hooks/use-audio-library-player';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const library = useAudioLibrary();
  const playback = useAudioLibraryPlayer(library.updateAudioItem, !library.isLoading);
  const theme = useTheme();
  const isImportBusy = library.importPhase !== 'idle';

  if (Platform.OS === 'web') {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedView type="backgroundElement" style={styles.emptyState}>
            <ThemedText type="title" style={styles.centerText}>
              Audio library
            </ThemedText>
            <ThemedText style={styles.centerText} themeColor="textSecondary">
              Local audio importing is available in the Android and iOS app.
            </ThemedText>
          </ThemedView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={library.items}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.contentContainer}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.headerTitleRow}>
                <View style={styles.headerCopy}>
                  <ThemedText type="title">Audio library</ThemedText>
                  <ThemedText themeColor="textSecondary">
                    Your recordings stay on this device.
                  </ThemedText>
                </View>

                {!library.isLoading && library.items.length > 0 && (
                  <AddAudioButton
                    disabled={isImportBusy}
                    importPhase={library.importPhase}
                    onPress={library.addAudio}
                  />
                )}
              </View>

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
                <View style={styles.inlineStatus}>
                  <ActivityIndicator size="small" color={theme.text} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Copying audio into the library…
                  </ThemedText>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            library.isLoading ? (
              <ThemedView style={styles.loadingState}>
                <ActivityIndicator color={theme.text} />
                <ThemedText themeColor="textSecondary">Loading your audio library…</ThemedText>
              </ThemedView>
            ) : (
              <ThemedView type="backgroundElement" style={styles.emptyState}>
                <ThemedText type="subtitle" style={styles.centerText}>
                  Your library is empty
                </ThemedText>
                <ThemedText style={styles.centerText} themeColor="textSecondary">
                  Choose audio files from your phone to keep and play them locally.
                </ThemedText>
                <AddAudioButton
                  disabled={isImportBusy}
                  importPhase={library.importPhase}
                  onPress={library.addAudio}
                />
              </ThemedView>
            )
          }
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
                loadedDurationSeconds={playback.durationSeconds}
                playbackError={playback.playbackError}
                onTogglePlayback={playback.togglePlayback}
              />
            );
          }}
        />
      </SafeAreaView>
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add audio"
      accessibilityState={{ busy: importPhase !== 'idle', disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}>
      <ThemedView type="backgroundSelected" style={styles.addButton}>
        <ThemedText type="smallBold">{label}</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

type StatusNoticeProps = {
  title: string;
  message: string;
  onDismiss: () => void;
};

function StatusNotice({ title, message, onDismiss }: StatusNoticeProps) {
  return (
    <ThemedView type="backgroundSelected" style={styles.notice}>
      <View style={styles.noticeCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="small">{message}</ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${title}`}
        onPress={onDismiss}
        style={({ pressed }) => pressed && styles.pressed}>
        <ThemedText type="smallBold">Dismiss</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  header: {
    gap: Spacing.three,
    marginBottom: Spacing.four,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  headerCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  separator: {
    height: Spacing.three,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.six,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  addButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  noticeCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
