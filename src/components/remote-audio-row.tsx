import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { Image } from 'expo-image'
import { memo, useEffect, useState } from 'react'
import { Spinner, View, XStack, YStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
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
  onOpenPlayer: (audio: RemoteAudio) => void
  onTogglePlayback: (audio: RemoteAudio) => void
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
  onOpenPlayer,
  onTogglePlayback,
  onDownload,
  onRemoveDownload,
  onAddToPlaylist,
}: RemoteAudioRowProps) {
  const theme = useTheme()
  const metadata = getRemoteAudioMetadata(audio.metadata)
  const [hasArtwork, setHasArtwork] = useState(Boolean(metadata.coverArtUrl))

  useEffect(() => {
    setHasArtwork(Boolean(metadata.coverArtUrl))
  }, [metadata.coverArtUrl])

  const mediaDetails = [metadata.album, metadata.releaseYear]
    .filter(Boolean)
    .join(' · ')
  const sourceType = metadata.type === 'episode' ? 'Episode' : 'Track'

  return (
    <ThemedView
      type="backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.large}
      boxShadow="0 8px 24px rgba(0,0,0,0.12)"
    >
      <XStack alignItems="center" gap={Spacing.three} padding={Spacing.three}>
        <AppButton
          tone="ghost"
          accessibilityLabel={`Open now playing for ${audio.title}${
            isCached ? ', cached for offline playback' : ''
          }`}
          onPress={() => onOpenPlayer(audio)}
          minWidth={0}
          flex={1}
          justifyContent="flex-start"
          gap={Spacing.three}
          padding={0}
        >
          <View
            width={84}
            height={84}
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
              type="smallBold"
              themeColor="textSecondary"
              numberOfLines={1}
            >
              {metadata.artist ?? audio.source}
            </ThemedText>
            {mediaDetails ? (
              <ThemedText type="metadata" themeColor="textSecondary">
                {mediaDetails}
              </ThemedText>
            ) : null}
            <XStack alignItems="center" gap={Spacing.one} marginTop={Spacing.half}>
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
                  ? 'Downloaded · Available offline'
                  : downloadState === 'downloading'
                    ? 'Downloading…'
                    : `Remote · ${sourceType} · Available for download`}
              </ThemedText>
              {metadata.durationMs !== null ? (
                <ThemedText type="metadata" themeColor="textSecondary">
                  · {formatPlaybackTime(metadata.durationMs / 1000)}
                </ThemedText>
              ) : null}
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
        {canDownload ? (
          <YStack gap={Spacing.one} alignItems="center">
            <AppButton
              tone="icon"
              accessibilityLabel={
                downloadState === 'downloaded'
                  ? `Remove download for ${audio.title}`
                  : downloadState === 'downloading'
                    ? `Downloading ${audio.title}`
                    : `Download ${audio.title} for offline playback`
              }
              accessibilityState={{
                busy: downloadState === 'downloading',
                disabled: downloadState === 'downloading',
              }}
              disabled={downloadState === 'downloading'}
              onPress={() =>
                downloadState === 'downloaded'
                  ? onRemoveDownload?.(audio)
                  : onDownload?.(audio)
              }
              backgroundColor="$backgroundSelected"
            >
              {downloadState === 'downloading' ? (
                <Spinner size="small" color="$accent" />
              ) : (
                <SymbolView
                  name={
                    downloadState === 'downloaded'
                      ? DOWNLOADED_ICON
                      : DOWNLOAD_ICON
                  }
                  size={20}
                  tintColor={theme.accent}
                  weight="bold"
                />
              )}
            </AppButton>
          </YStack>
        ) : null}
        {onAddToPlaylist ? (
          <AppButton
            tone="icon"
            accessibilityLabel={`Add ${audio.title} to playlist`}
            onPress={() => onAddToPlaylist(audio)}
            backgroundColor="$backgroundSelected"
          >
            <SymbolView
              name={PLAYLIST_ICON}
              size={20}
              tintColor={theme.accent}
              weight="bold"
            />
          </AppButton>
        ) : null}
        <AppButton
          tone="icon"
          accessibilityLabel={`${isTransitioning ? 'Loading' : isActive && isPlaying ? 'Pause' : playbackError ? 'Retry' : 'Play'} ${audio.title}`}
          accessibilityState={{ busy: isTransitioning, disabled: isTransitioning }}
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
      </XStack>
    </ThemedView>
  )
})

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
