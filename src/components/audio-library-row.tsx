import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AudioPlaybackError } from '@/hooks/use-audio-library-player';
import type { LoadedAudioItem } from '@/services/audio-library-storage';

type AudioLibraryRowProps = {
  item: LoadedAudioItem;
  isActive: boolean;
  isPlaying: boolean;
  isTransitioning: boolean;
  currentPositionSeconds: number;
  loadedDurationSeconds: number | null;
  playbackError: AudioPlaybackError | null;
  onTogglePlayback: (item: LoadedAudioItem) => void;
};

export function AudioLibraryRow({
  item,
  isActive,
  isPlaying,
  isTransitioning,
  currentPositionSeconds,
  loadedDurationSeconds,
  playbackError,
  onTogglePlayback,
}: AudioLibraryRowProps) {
  const theme = useTheme();
  const positionSeconds = isActive ? currentPositionSeconds : item.lastPositionSeconds;
  const durationSeconds = isActive
    ? loadedDurationSeconds ?? item.durationSeconds
    : item.durationSeconds;
  const progress = getProgress(positionSeconds, durationSeconds);
  const itemError = playbackError?.itemId === item.id ? playbackError.message : null;
  const isBusy = isActive && isTransitioning;
  const isButtonDisabled = !item.isAvailable || isTransitioning;
  const buttonLabel = isBusy
    ? 'Loading…'
    : itemError
      ? 'Retry'
      : isActive && isPlaying
        ? 'Pause'
        : 'Play';

  return (
    <ThemedView
      type={isActive ? 'backgroundSelected' : 'backgroundElement'}
      style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.details}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {item.originalName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {durationSeconds === null
              ? `Saved at ${formatPlaybackTime(positionSeconds)} · Duration unknown`
              : `${formatPlaybackTime(positionSeconds)} / ${formatPlaybackTime(durationSeconds)}`}
          </ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${buttonLabel} ${item.originalName}`}
          accessibilityState={{ busy: isBusy, disabled: isButtonDisabled }}
          disabled={isButtonDisabled}
          onPress={() => onTogglePlayback(item)}
          style={({ pressed }) => [
            styles.playButton,
            { borderColor: theme.text },
            pressed && styles.pressed,
            isButtonDisabled && styles.disabled,
          ]}>
          <ThemedText type="smallBold">{buttonLabel}</ThemedText>
        </Pressable>
      </View>

      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`${item.originalName} playback progress`}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        style={[styles.progressTrack, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: theme.text,
              width: `${Math.round(progress * 100)}%`,
            },
          ]}
        />
      </View>

      {isActive && !itemError && (
        <ThemedText type="small" themeColor="textSecondary">
          {isBusy ? 'Preparing playback…' : isPlaying ? 'Now playing' : 'Paused'}
        </ThemedText>
      )}

      {!item.isAvailable && (
        <ThemedText type="smallBold">
          {item.unavailableReason === 'unsupported'
            ? 'Unsupported audio type. Re-import a supported recording.'
            : 'File missing. Re-import this recording to restore playback.'}
        </ThemedText>
      )}

      {itemError && (
        <ThemedText type="smallBold">{itemError}</ThemedText>
      )}
    </ThemedView>
  );
}

function getProgress(positionSeconds: number, durationSeconds: number | null): number {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  return Math.min(Math.max(positionSeconds / durationSeconds, 0), 1);
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  details: {
    flex: 1,
    gap: Spacing.one,
  },
  playButton: {
    minWidth: 76,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  progressTrack: {
    height: Spacing.one,
    borderRadius: Spacing.one,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.45,
  },
});
