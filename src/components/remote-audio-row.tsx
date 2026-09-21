import { Image } from 'expo-image'
import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  View as NativeView,
  PanResponder,
  StyleSheet,
} from 'react-native'
import { View, XStack, YStack } from 'tamagui'

import { RowActionSheet } from '@/components/row-action-sheet'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useTheme } from '@/hooks/use-theme'
import type { RemoteAudio } from '@/services/api'
import type { RemoteAudioDownloadState } from '@/services/remote-audio-file-cache'
import { formatPlaybackTime } from '@/utils/audio-display'

type RemoteAudioRowProps = {
  audio: RemoteAudio
  isCached: boolean
  downloadState: RemoteAudioDownloadState
  canDownload: boolean
  downloadError: string | null
  isActive: boolean
  isPlaying: boolean
  isTransitioning: boolean
  playbackError: string | null
  isReorderDisabled?: boolean
  reorderBounds?: { min: number; max: number }
  onOpenPlayer: (audio: RemoteAudio) => void
  onTogglePlayback: (audio: RemoteAudio) => void
  onReorder?: (audioId: string, offset: number) => void
  onPreviewReorder?: (audioId: string, offset: number) => void
  onDownload?: (audio: RemoteAudio) => void
  onRemoveDownload?: (audio: RemoteAudio) => void
  onAddToPlaylist?: (audio: RemoteAudio) => void
}

export const RemoteAudioRow = memo(function RemoteAudioRow({
  audio,
  isCached,
  downloadState,
  canDownload,
  downloadError,
  isActive,
  isPlaying,
  isTransitioning,
  playbackError,
  isReorderDisabled = false,
  reorderBounds,
  onOpenPlayer,
  onTogglePlayback,
  onReorder,
  onPreviewReorder,
  onDownload,
  onRemoveDownload,
  onAddToPlaylist,
}: RemoteAudioRowProps) {
  const theme = useTheme()
  const [dragY] = useState(() => new Animated.Value(0))
  const [isDragging, setIsDragging] = useState(false)
  const reduceMotion = useReducedMotion()
  const metadata = getRemoteAudioMetadata(audio.metadata)
  const [hasArtwork, setHasArtwork] = useState(Boolean(metadata.coverArtUrl))
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const dragDisabledRef = useRef(isReorderDisabled)
  const audioIdRef = useRef(audio.id)
  const onReorderRef = useRef(onReorder)
  const onPreviewReorderRef = useRef(onPreviewReorder)
  const reorderBoundsRef = useRef(reorderBounds)

  useEffect(() => {
    setHasArtwork(Boolean(metadata.coverArtUrl))
  }, [metadata.coverArtUrl])

  useEffect(() => {
    dragDisabledRef.current = isReorderDisabled
    audioIdRef.current = audio.id
    onReorderRef.current = onReorder
    onPreviewReorderRef.current = onPreviewReorder
    reorderBoundsRef.current = reorderBounds
  }, [audio.id, isReorderDisabled, onPreviewReorder, onReorder, reorderBounds])

  const reorderResponder = useMemo(() => {
    let previewOffset = 0

    const getPreviewOffset = (dy: number) => {
      const bounds = reorderBoundsRef.current

      if (!bounds) {
        return 0
      }

      return Math.max(
        bounds.min,
        Math.min(bounds.max, Math.round(dy / REORDER_STEP_DISTANCE)),
      )
    }

    const finishDrag = () => {
      setIsDragging(false)

      if (previewOffset !== 0) {
        onReorderRef.current?.(audioIdRef.current, previewOffset)
      }

      onPreviewReorderRef.current?.(audioIdRef.current, 0)
      previewOffset = 0

      if (reduceMotion) {
        dragY.setValue(0)
        return
      }

      Animated.spring(dragY, {
        damping: 18,
        mass: 0.8,
        stiffness: 180,
        toValue: 0,
        useNativeDriver: true,
      }).start()
    }

    return PanResponder.create({
      onStartShouldSetPanResponder: () =>
        !dragDisabledRef.current && Boolean(reorderBoundsRef.current),
      onStartShouldSetPanResponderCapture: () =>
        !dragDisabledRef.current && Boolean(reorderBoundsRef.current),
      onMoveShouldSetPanResponder: () =>
        !dragDisabledRef.current && Boolean(reorderBoundsRef.current),
      onMoveShouldSetPanResponderCapture: () =>
        !dragDisabledRef.current && Boolean(reorderBoundsRef.current),
      onPanResponderGrant: () => {
        dragY.stopAnimation()
        dragY.setValue(0)
        previewOffset = 0
        setIsDragging(true)
      },
      onPanResponderMove: (_event, gestureState) => {
        const nextPreviewOffset = getPreviewOffset(gestureState.dy)
        dragY.setValue(
          gestureState.dy - nextPreviewOffset * REORDER_STEP_DISTANCE,
        )

        if (nextPreviewOffset !== previewOffset) {
          previewOffset = nextPreviewOffset
          onPreviewReorderRef.current?.(audioIdRef.current, nextPreviewOffset)
        }
      },
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    })
  }, [dragY, reduceMotion])

  const mediaDetails = [metadata.album, metadata.releaseYear]
    .filter(Boolean)
    .join(' · ')
  const sourceType = metadata.type === 'episode' ? 'Episode' : 'Track'
  const durationSeconds =
    metadata.durationMs === null ? null : metadata.durationMs / 1000
  const canOpenOptions =
    Boolean(onReorder) || canDownload || Boolean(onAddToPlaylist)
  const isMoveEarlierDisabled =
    isReorderDisabled || !reorderBounds || reorderBounds.min === 0
  const isMoveLaterDisabled =
    isReorderDisabled || !reorderBounds || reorderBounds.max === 0

  return (
    <>
      <Animated.View
        style={{
          elevation: isDragging ? 8 : 0,
          opacity: isDragging ? 0.96 : 1,
          transform: [{ translateY: dragY }],
          zIndex: isDragging ? 10 : 0,
        }}
      >
        <ThemedView
          type="backgroundElement"
          overflow="hidden"
          borderWidth={1}
          borderColor={isActive ? '$accent' : '$borderColor'}
          borderRadius={Radius.large}
          boxShadow="0 8px 24px rgba(0,0,0,0.12)"
        >
          <XStack
            alignItems="center"
            gap={Spacing.three}
            padding={Spacing.three}
          >
            <View
              accessible
              accessibilityLabel="Available from your account library"
              width={44}
              height={44}
              flexShrink={0}
              alignItems="center"
              justifyContent="center"
              borderRadius={Radius.round}
              backgroundColor="$accentSubtle"
            >
              <SymbolView
                name={REMOTE_ICON}
                size={20}
                tintColor={theme.accent}
              />
            </View>
            <AppButton
              tone="ghost"
              accessibilityLabel={`Open now playing for ${audio.title}${
                isCached ? ', cached for offline playback' : ''
              }`}
              onPress={() => onOpenPlayer(audio)}
              minWidth={0}
              flex={1}
              justifyContent="flex-start"
              padding={0}
            >
              <View
                width={76}
                height={76}
                flexShrink={0}
                overflow="hidden"
                alignItems="center"
                justifyContent="center"
                borderRadius={Radius.medium}
                backgroundColor="$accentSubtle"
              >
                {hasArtwork && metadata.coverArtUrl ? (
                  <Image
                    source={{ uri: metadata.coverArtUrl }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    transition={180}
                    onError={() => setHasArtwork(false)}
                  />
                ) : (
                  <SymbolView
                    name={REMOTE_ICON}
                    size={30}
                    tintColor={theme.accent}
                  />
                )}
              </View>
              <YStack flex={1} minWidth={0} gap={Spacing.one}>
                <ThemedText type="episodeTitle" numberOfLines={2}>
                  {audio.title}
                </ThemedText>
                <ThemedText
                  type="metadata"
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  {metadata.artist ?? audio.source}
                </ThemedText>
                <ThemedText
                  type="metadata"
                  themeColor="textSecondary"
                  numberOfLines={1}
                >
                  {mediaDetails || `Podcast Me · ${sourceType}`}
                </ThemedText>
                <XStack alignItems="center" gap={Spacing.one}>
                  <SymbolView
                    name={
                      downloadState === 'downloaded'
                        ? CACHED_ICON
                        : downloadState === 'downloading'
                          ? DOWNLOADING_ICON
                          : REMOTE_AVAILABILITY_ICON
                    }
                    size={16}
                    tintColor={theme.accent}
                  />
                  <ThemedText type="metadata" color="$accent">
                    {downloadState === 'downloaded'
                      ? 'Saved offline'
                      : downloadState === 'downloading'
                        ? 'Downloading…'
                        : 'Available online'}
                  </ThemedText>
                </XStack>
                {playbackError ? (
                  <ThemedText
                    type="metadata"
                    color="$danger"
                    accessibilityLiveRegion="polite"
                    accessibilityRole="alert"
                  >
                    {playbackError}
                  </ThemedText>
                ) : null}
                {downloadError ? (
                  <ThemedText type="metadata" color="$danger">
                    {downloadError}
                  </ThemedText>
                ) : null}
              </YStack>
            </AppButton>
            <YStack flexShrink={0} alignItems="center" gap={Spacing.two}>
              <ThemedText type="metadata" themeColor="textSecondary">
                {formatPlaybackTime(durationSeconds)}
              </ThemedText>
              <AppButton
                tone="icon"
                accessibilityLabel={`${isTransitioning ? 'Loading' : isActive && isPlaying ? 'Pause' : playbackError ? 'Retry' : 'Play'} ${audio.title}`}
                accessibilityState={{
                  busy: isTransitioning,
                  disabled: isTransitioning,
                }}
                disabled={isTransitioning}
                onPress={() => onTogglePlayback(audio)}
                backgroundColor="$accent"
              >
                <SymbolView
                  name={isActive && isPlaying ? PAUSE_ICON : PLAY_ICON}
                  size={22}
                  tintColor={theme.accentForeground}
                  weight="bold"
                />
              </AppButton>
              <AppButton
                tone="icon"
                accessibilityLabel={`Options for ${audio.title}`}
                accessibilityState={{ disabled: !canOpenOptions }}
                disabled={!canOpenOptions}
                onPress={() => setIsSheetOpen(true)}
              >
                <SymbolView
                  name={MORE_ICON}
                  size={20}
                  tintColor={theme.textSecondary}
                />
              </AppButton>
            </YStack>
          </XStack>
        </ThemedView>
        <NativeView
          {...reorderResponder.panHandlers}
          accessible
          accessibilityLabel={`Reorder ${audio.title}`}
          accessibilityHint="Drag up or down to change its position"
          accessibilityRole="button"
          accessibilityState={{
            disabled: isReorderDisabled || !reorderBounds,
          }}
          style={[
            styles.reorderHandle,
            {
              backgroundColor: theme.backgroundSelected,
              opacity: isReorderDisabled || !reorderBounds ? 0.45 : 0.88,
              width: '100%',
              height: 12,
              marginTop: -4,
            },
          ]}
        >
          <SymbolView
            name={REORDER_ICON}
            size={18}
            tintColor={theme.textSecondary}
          />
        </NativeView>
      </Animated.View>

      {isSheetOpen ? (
        <RowActionSheet
          title={audio.title}
          onClose={() => setIsSheetOpen(false)}
          actions={[
            {
              key: 'move-earlier',
              label: 'Move earlier',
              icon: MOVE_EARLIER_ICON,
              disabled: isMoveEarlierDisabled,
              onPress: () => onReorder?.(audio.id, -1),
            },
            {
              key: 'move-later',
              label: 'Move later',
              icon: MOVE_LATER_ICON,
              disabled: isMoveLaterDisabled,
              onPress: () => onReorder?.(audio.id, 1),
            },
            ...(canDownload
              ? [
                  {
                    key: 'download',
                    label:
                      downloadState === 'downloaded'
                        ? 'Remove download'
                        : downloadState === 'downloading'
                          ? 'Downloading…'
                          : 'Download for offline playback',
                    icon:
                      downloadState === 'downloaded'
                        ? DOWNLOADED_ICON
                        : DOWNLOAD_ICON,
                    disabled: downloadState === 'downloading',
                    onPress: () =>
                      downloadState === 'downloaded'
                        ? onRemoveDownload?.(audio)
                        : onDownload?.(audio),
                  },
                ]
              : []),
            ...(onAddToPlaylist
              ? [
                  {
                    key: 'add-to-playlist',
                    label: 'Add to playlist',
                    icon: PLAYLIST_ICON,
                    disabled: false,
                    onPress: () => onAddToPlaylist(audio),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
    </>
  )
})

const REORDER_STEP_DISTANCE = 124

const REMOTE_ICON: SymbolViewProps['name'] = {
  ios: 'cloud.fill',
  android: 'cloud',
  web: 'cloud',
}
const CACHED_ICON: SymbolViewProps['name'] = {
  ios: 'checkmark.icloud.fill',
  android: 'offline_pin',
  web: 'offline_pin',
}
const DOWNLOADED_ICON: SymbolViewProps['name'] = {
  ios: 'trash',
  android: 'delete',
  web: 'delete',
}
const DOWNLOAD_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.down.circle',
  android: 'download_for_offline',
  web: 'download_for_offline',
}
const REORDER_ICON: SymbolViewProps['name'] = {
  ios: 'line.3.horizontal',
  android: 'drag_handle',
  web: 'drag_handle',
}
const MOVE_EARLIER_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.up',
  android: 'arrow_upward',
  web: 'arrow_upward',
}
const MOVE_LATER_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.down',
  android: 'arrow_downward',
  web: 'arrow_downward',
}
const DOWNLOADING_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.down.circle.fill',
  android: 'downloading',
  web: 'downloading',
}
const REMOTE_AVAILABILITY_ICON: SymbolViewProps['name'] = {
  ios: 'cloud',
  android: 'cloud_queue',
  web: 'cloud_queue',
}
const PLAY_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
}
const PLAYLIST_ICON: SymbolViewProps['name'] = {
  ios: 'music.note.list',
  android: 'queue_music',
  web: 'queue_music',
}

const styles = StyleSheet.create({
  reorderHandle: {
    position: 'absolute',
    top: Spacing.one,
    right: Spacing.one,
    zIndex: 3,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.round,
  },
})
const MORE_ICON: SymbolViewProps['name'] = {
  ios: 'ellipsis',
  android: 'more_horiz',
  web: 'more_horiz',
}
const PAUSE_ICON: SymbolViewProps['name'] = {
  ios: 'pause',
  android: 'pause',
  web: 'pause',
}

type RemoteAudioMetadata = {
  type: string | null
  artist: string | null
  album: string | null
  releaseYear: string | null
  coverArtUrl: string | null
  durationMs: number | null
}

function getRemoteAudioMetadata(value: unknown): RemoteAudioMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_METADATA
  }

  const metadata = value as Record<string, unknown>
  const coverArtUrl = toText(metadata.coverArtUrl)

  return {
    type: toText(metadata.type),
    artist: toText(metadata.artist),
    album: toText(metadata.album),
    releaseYear: toText(metadata.releaseYear),
    coverArtUrl:
      coverArtUrl && /^https:\/\//i.test(coverArtUrl) ? coverArtUrl : null,
    durationMs:
      typeof metadata.durationMs === 'number' && metadata.durationMs >= 0
        ? metadata.durationMs
        : null,
  }
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const EMPTY_METADATA: RemoteAudioMetadata = {
  type: null,
  artist: null,
  album: null,
  releaseYear: null,
  coverArtUrl: null,
  durationMs: null,
}
