import { Pressable, StyleSheet, View } from 'react-native';

import { AudioPlaybackSlider } from '@/components/audio-playback-slider';
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
  isPlaybackReady: boolean;
  currentPositionSeconds: number;
  loadedDurationSeconds: number | null;
  playbackError: AudioPlaybackError | null;
  onSeekBy: (seconds: number) => void;
  onSeekTo: (positionSeconds: number) => void;
  onTogglePlayback: (item: LoadedAudioItem) => void;
};

export function AudioLibraryRow({
  item,
  isActive,
  isPlaying,
  isTransitioning,
  isPlaybackReady,
  currentPositionSeconds,
  loadedDurationSeconds,
  playbackError,
  onSeekBy,
  onSeekTo,
  onTogglePlayback,
}: AudioLibraryRowProps) {
  const theme = useTheme();
  const positionSeconds = isActive ? currentPositionSeconds : item.lastPositionSeconds;
  const durationSeconds = isActive
    ? loadedDurationSeconds ?? item.durationSeconds
    : item.durationSeconds;
  const itemError = playbackError?.itemId === item.id ? playbackError.message : null;
  const isBusy = isActive && isTransitioning;
  const isButtonDisabled = !isPlaybackReady || !item.isAvailable || isTransitioning;
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

      <AudioPlaybackSlider
        accessibilityLabel={`${item.originalName} playback position`}
        disabled={!isActive || isButtonDisabled || durationSeconds === null}
        durationSeconds={durationSeconds}
        onSeekTo={onSeekTo}
        positionSeconds={positionSeconds}
      />

      {isActive && (
        <View style={styles.seekControls}>
          <SeekButton
            accessibilityLabel={`Rewind ${item.originalName} by 15 seconds`}
            disabled={isButtonDisabled}
            label="−15 sec"
            onPress={() => onSeekBy(-15)}
          />
          <SeekButton
            accessibilityLabel={`Move ${item.originalName} forward by 15 seconds`}
            disabled={isButtonDisabled}
            label="+15 sec"
            onPress={() => onSeekBy(15)}
          />
        </View>
      )}

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

type SeekButtonProps = {
  accessibilityLabel: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
};

function SeekButton({ accessibilityLabel, disabled, label, onPress }: SeekButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.seekButton,
        { borderColor: theme.text },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
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
  seekControls: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  seekButton: {
    minHeight: 44,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.45,
  },
});
