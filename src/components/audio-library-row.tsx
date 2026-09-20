import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  TextInput,
  type AccessibilityActionEvent,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, Spinner, View, XStack, YStack, styled } from 'tamagui'

import { EpisodeArtwork } from '@/components/episode-artwork'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import type { AudioPlaybackError } from '@/hooks/use-audio-library-player'
import { useTheme } from '@/hooks/use-theme'
import type { AudioMetadata } from '@/models/audio-item'
import type { LoadedAudioItem } from '@/services/audio-library-storage'
import {
  getAudioItemTitle,
  formatEpisodeDate,
  formatFileSize,
  formatPlaybackTime,
} from '@/utils/audio-display'

type AudioLibraryRowProps = {
  item: LoadedAudioItem
  isActive: boolean
  isPlaying: boolean
  isTransitioning: boolean
  isPlaybackReady: boolean
  currentPositionSeconds: number
  loadedDurationSeconds: number | null
  playbackError: AudioPlaybackError | null
  duplicateHighlightToken: number
  isDeleteDisabled: boolean
  isMetadataDisabled: boolean
  isReorderDisabled: boolean
  canUpload: boolean
  isUploading: boolean
  isUploaded: boolean
  uploadProgressPercent: number | null
  uploadError: string | null
  onDelete: (item: LoadedAudioItem) => void
  onOpenPlayer: (item: LoadedAudioItem) => void
  onPlayNext: (item: LoadedAudioItem) => void
  onReorder: (itemId: string, offset: number) => void
  onSaveMetadata: (
    itemId: string,
    metadata: AudioMetadata,
  ) => Promise<boolean>
  onTogglePlayback: (item: LoadedAudioItem) => void
  onUpload: (item: LoadedAudioItem) => void
  onAddToPlaylist?: (item: LoadedAudioItem) => void
}

export const AudioLibraryRow = memo(function AudioLibraryRow({
  item,
  isActive,
  isPlaying,
  isTransitioning,
  isPlaybackReady,
  currentPositionSeconds,
  loadedDurationSeconds,
  playbackError,
  duplicateHighlightToken,
  isDeleteDisabled,
  isMetadataDisabled,
  isReorderDisabled,
  canUpload,
  isUploading,
  isUploaded,
  uploadProgressPercent,
  uploadError,
  onDelete,
  onOpenPlayer,
  onPlayNext,
  onReorder,
  onSaveMetadata,
  onTogglePlayback,
  onUpload,
  onAddToPlaylist,
}: AudioLibraryRowProps) {
  const theme = useTheme()
  const [dragY] = useState(() => new Animated.Value(0))
  const [highlightProgress] = useState(() => new Animated.Value(0))
  const [isDragging, setIsDragging] = useState(false)
  const reduceMotion = useReducedMotion()
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const dragDisabledRef = useRef(isReorderDisabled)
  const itemIdRef = useRef(item.id)
  const onReorderRef = useRef(onReorder)

  useEffect(() => {
    dragDisabledRef.current = isReorderDisabled
    itemIdRef.current = item.id
    onReorderRef.current = onReorder
  }, [isReorderDisabled, item.id, onReorder])

  useEffect(() => {
    if (duplicateHighlightToken === 0) {
      return
    }

    // Reduced motion skips the duplicate flash; the row still scrolls into
    // view and VoiceOver still announces it.
    if (reduceMotion) {
      highlightProgress.setValue(0)
      return
    }

    highlightProgress.stopAnimation()
    highlightProgress.setValue(0)
    const animation = Animated.sequence([
      Animated.timing(highlightProgress, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(highlightProgress, {
        duration: 260,
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(highlightProgress, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(highlightProgress, {
        duration: 340,
        toValue: 0,
        useNativeDriver: true,
      }),
    ])
    animation.start()

    return () => animation.stop()
  }, [duplicateHighlightToken, highlightProgress, reduceMotion])

  const reorderResponder = useMemo(() => {
    const canDrag = () => !dragDisabledRef.current
    const finishDrag = (_event: unknown, gestureState: { dy: number }) => {
      const offset = Math.round(gestureState.dy / REORDER_STEP_DISTANCE)
      setIsDragging(false)

      if (offset !== 0) {
        dragY.setValue(0)
        onReorderRef.current(itemIdRef.current, offset)
        return
      }

      if (reduceMotionRef.current) {
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

    // PanResponder stores these callbacks and invokes them only for touch events.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onStartShouldSetPanResponder: canDrag,
      onStartShouldSetPanResponderCapture: canDrag,
      onMoveShouldSetPanResponder: canDrag,
      onMoveShouldSetPanResponderCapture: canDrag,
      onPanResponderGrant: () => {
        dragY.stopAnimation()
        dragY.setValue(0)
        setIsDragging(true)
      },
      onPanResponderMove: (_event, gestureState) =>
        dragY.setValue(gestureState.dy),
      onPanResponderRelease: finishDrag,
      onPanResponderTerminate: finishDrag,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    })
  }, [dragY])

  const positionSeconds = isActive
    ? currentPositionSeconds
    : item.lastPositionSeconds
  const durationSeconds = isActive
    ? (loadedDurationSeconds ?? item.durationSeconds)
    : item.durationSeconds
  const progress = durationSeconds
    ? Math.min(Math.max(positionSeconds / durationSeconds, 0), 1)
    : 0
  const itemError =
    playbackError?.itemId === item.id ? playbackError.message : null
  const isBusy = isActive && isTransitioning
  const isButtonDisabled =
    !isPlaybackReady || !item.isAvailable || isTransitioning
  const title = getAudioItemTitle(item)
  const metadataSummary = [
    item.metadata.artist,
    item.metadata.album,
    item.metadata.releaseYear,
  ]
    .filter(Boolean)
    .join(' · ')
  const highlightScale = highlightProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.018],
  })

  const handleReorderAccessibilityAction = (
    event: AccessibilityActionEvent,
  ) => {
    if (isReorderDisabled) {
      return
    }

    if (event.nativeEvent.actionName === 'increment') {
      onReorder(item.id, 1)
    } else if (event.nativeEvent.actionName === 'decrement') {
      onReorder(item.id, -1)
    }
  }

  return (
    <>
      <AnimatedView
        borderRadius={Radius.large}
        zIndex={isDragging ? 10 : 0}
        opacity={isDragging ? 0.94 : 1}
        boxShadow={isDragging ? '0 14px 28px rgba(0,0,0,0.28)' : undefined}
        style={{ transform: [{ translateY: dragY }, { scale: highlightScale }] }}
      >
      <AnimatedView
        pointerEvents="none"
        position="absolute"
        top={0}
        right={0}
        bottom={0}
        left={0}
        zIndex={2}
        borderWidth={3}
        borderRadius={Radius.large}
        borderColor="$accent"
        style={{ opacity: highlightProgress }}
      />
      <ThemedView
        type="backgroundElement"
        overflow="hidden"
        borderWidth={1}
        borderColor={isActive ? '$accent' : '$borderColor'}
        // borderColor="red"
        borderRadius={Radius.large}
        boxShadow="0 8px 24px rgba(0,0,0,0.12)"
      >
        <XStack alignItems="center" gap={Spacing.three} padding={Spacing.three}>
          <View
            {...reorderResponder.panHandlers}
            accessible
            accessibilityActions={[
              { name: 'decrement', label: 'Move earlier' },
              { name: 'increment', label: 'Move later' },
            ]}
            accessibilityHint="Drag vertically to change the playlist position"
            accessibilityLabel={`Reorder ${title}`}
            accessibilityRole="adjustable"
            accessibilityState={{ disabled: isReorderDisabled }}
            onAccessibilityAction={handleReorderAccessibilityAction}
            width={44}
            minWidth={44}
            height={44}
            minHeight={44}
            flexShrink={0}
            alignItems="center"
            justifyContent="center"
            borderWidth={1}
            borderRadius={Radius.round}
            borderColor="$borderColor"
            backgroundColor={isDragging ? '$backgroundSelected' : 'transparent'}
            opacity={isReorderDisabled ? 0.45 : 1}
            cursor={isReorderDisabled ? 'not-allowed' : 'grab'}
          >
            <SymbolView name={REORDER_ICON} size={20} tintColor={theme.text} />
          </View>
          <AppButton
            tone="ghost"
            accessibilityLabel={`Open player for ${title}`}
            disabled={!isPlaybackReady || !item.isAvailable || isTransitioning}
            onPress={() => onOpenPlayer(item)}
            minWidth={0}
            flex={1}
            justifyContent="flex-start"
            padding={0}
          >
            <EpisodeArtwork
              imageUrl={item.metadata.coverArtUrl}
              itemId={item.id}
              name={title}
              size={76}
            />

            <YStack flex={1} minWidth={0} gap={Spacing.one}>
              <ThemedText type="episodeTitle" numberOfLines={2}>
                {title}
              </ThemedText>
              <ThemedText
                type="metadata"
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {metadataSummary ||
                  `Podcast Me · ${formatEpisodeDate(item.addedAt)}`}
              </ThemedText>
              <ThemedText
                type="metadata"
                themeColor="textSecondary"
                numberOfLines={1}
              >
                {formatFileSize(item.sizeBytes)} · Local · Saved offline
              </ThemedText>
              <XStack alignItems="center" gap={Spacing.one}>
                <View
                  width={7}
                  height={7}
                  borderRadius={7}
                  backgroundColor={
                    item.isPlayed
                      ? '$success'
                      : isActive
                        ? '$accent'
                        : '$warning'
                  }
                />
                <ThemedText
                  type="metadata"
                  color={
                    item.isPlayed
                      ? '$success'
                      : isActive
                        ? '$accent'
                        : '$colorMuted'
                  }
                >
                  {item.isPlayed
                    ? 'Played'
                    : isActive
                      ? isPlaying
                        ? 'Playing'
                        : 'In progress'
                      : progress > 0
                        ? 'In progress'
                        : 'Unplayed'}
                </ThemedText>
              </XStack>
              {isUploading ? (
                <ThemedText type="metadata" color="$accent">
                  {uploadProgressPercent !== null
                    ? `Uploading… ${uploadProgressPercent}%`
                    : 'Uploading…'}
                </ThemedText>
              ) : null}
              {isUploaded ? (
                <XStack alignItems="center" gap={Spacing.one}>
                  <SymbolView
                    name={UPLOADED_ICON}
                    size={14}
                    tintColor={theme.accent}
                  />
                  <ThemedText type="metadata" color="$accent">
                    Uploaded · in your account library
                  </ThemedText>
                </XStack>
              ) : null}
              {uploadError ? (
                <ThemedText type="metadata" color="$danger">
                  {uploadError}
                </ThemedText>
              ) : null}
            </YStack>
          </AppButton>

          <YStack flexShrink={0} alignItems="center" gap={Spacing.two}>
            <ThemedText type="metadata" themeColor="textSecondary">
              {formatPlaybackTime(durationSeconds)}
            </ThemedText>
            {canUpload && !isUploaded ? (
              <AppButton
                tone="icon"
                accessibilityLabel={`Upload ${title} to your account library`}
                accessibilityState={{ busy: isUploading, disabled: isUploading }}
                disabled={isUploading}
                onPress={() => onUpload(item)}
                backgroundColor="$backgroundSelected"
              >
                {isUploading ? (
                  <Spinner size="small" color="$accent" />
                ) : (
                  <SymbolView
                    name={UPLOAD_ICON}
                    size={20}
                    tintColor={theme.accent}
                    weight="bold"
                  />
                )}
              </AppButton>
            ) : null}
            <AppButton
              tone="icon"
              accessibilityLabel={`${isBusy ? 'Loading' : isActive && isPlaying ? 'Pause' : itemError ? 'Retry' : 'Play'} ${title}`}
              accessibilityState={{ busy: isBusy, disabled: isButtonDisabled }}
              disabled={isButtonDisabled}
              onPress={() => onTogglePlayback(item)}
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
              accessibilityLabel={`Options for ${title}`}
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

        {(isActive || progress > 0) && durationSeconds !== null && (
          <View height={3} backgroundColor="$backgroundSelected">
            <View
              height="100%"
              width={`${progress * 100}%`}
              backgroundColor="$accent"
            />
          </View>
        )}

        {(itemError || !item.isAvailable) && (
          <YStack
            gap={Spacing.one}
            paddingHorizontal={Spacing.three}
            paddingBottom={Spacing.three}
          >
            {itemError && (
              <ThemedText
                type="metadata"
                color="$danger"
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
              >
                {itemError}
              </ThemedText>
            )}
            {!item.isAvailable && (
              <ThemedText type="metadata" color="$warning">
                {item.unavailableReason === 'unsupported'
                  ? 'Unsupported audio type. Re-import a supported recording.'
                  : 'File missing. Re-import this recording to restore playback.'}
              </ThemedText>
            )}
          </YStack>
        )}

      </ThemedView>
      </AnimatedView>

      {isSheetOpen && (
        <RowActionSheet
          title={title}
          onClose={() => setIsSheetOpen(false)}
          actions={[
            {
              key: 'play-next',
              label: isActive ? 'Playing now' : 'Play next',
              icon: PLAY_NEXT_ICON,
              disabled: isActive,
              onPress: () => onPlayNext(item),
            },
            ...(onAddToPlaylist
              ? [
                  {
                    key: 'add-to-playlist',
                    label: 'Add to playlist',
                    icon: PLAYLIST_ICON,
                    disabled: false,
                    onPress: () => onAddToPlaylist(item),
                  },
                ]
              : []),
            {
              key: 'edit-metadata',
              label: 'Edit metadata',
              icon: EDIT_ICON,
              disabled: isMetadataDisabled,
              onPress: () => setIsMetadataModalOpen(true),
            },
            {
              key: 'remove',
              label: 'Remove',
              icon: DELETE_ICON,
              disabled: isDeleteDisabled,
              destructive: true,
              onPress: () => onDelete(item),
            },
          ]}
        />
      )}

      {isMetadataModalOpen && (
        <AudioMetadataModal
          item={item}
          onClose={() => setIsMetadataModalOpen(false)}
          onSave={onSaveMetadata}
        />
      )}
    </>
  )
})

type RowAction = {
  key: string
  label: string
  icon: SymbolViewProps['name']
  disabled: boolean
  destructive?: boolean
  onPress: () => void
}

type RowActionSheetProps = {
  title: string
  actions: RowAction[]
  onClose: () => void
}

/**
 * Bottom action sheet for a single row. Row height stays stable because
 * actions live in the sheet instead of an expanding inline section.
 */
function RowActionSheet({ title, actions, onClose }: RowActionSheetProps) {
  const theme = useTheme()

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={onClose}
    >
      <ThemedView flex={1}>
        <SafeAreaView style={styles.safeArea}>
          <YStack
            width="100%"
            maxWidth={640}
            alignSelf="center"
            gap={Spacing.two}
            paddingHorizontal={Spacing.three}
            paddingTop={Spacing.three}
            paddingBottom={Spacing.five}
          >
            <XStack alignItems="center" justifyContent="space-between">
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                flex={1}
                minWidth={0}
              >
                {title}
              </ThemedText>
              <AppButton
                tone="icon"
                accessibilityLabel="Close options"
                onPress={onClose}
              >
                <SymbolView
                  name={CLOSE_ICON}
                  size={18}
                  tintColor={theme.textSecondary}
                />
              </AppButton>
            </XStack>
            {actions.map((action) => (
              <AppButton
                key={action.key}
                tone="ghost"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={() => {
                  onClose()
                  action.onPress()
                }}
                minHeight={52}
                justifyContent="flex-start"
                paddingHorizontal={Spacing.two}
              >
                <SymbolView
                  name={action.icon}
                  size={20}
                  tintColor={
                    action.destructive ? theme.danger : theme.text
                  }
                />
                <ThemedText
                  type="default"
                  color={action.destructive ? '$danger' : undefined}
                >
                  {action.label}
                </ThemedText>
              </AppButton>
            ))}
          </YStack>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  )
}

type MetadataDraft = Record<keyof AudioMetadata, string>

type AudioMetadataModalProps = {
  item: LoadedAudioItem
  onClose: () => void
  onSave: (itemId: string, metadata: AudioMetadata) => Promise<boolean>
}

function AudioMetadataModal({
  item,
  onClose,
  onSave,
}: AudioMetadataModalProps) {
  const theme = useTheme()
  const [draft, setDraft] = useState<MetadataDraft>(() =>
    metadataToDraft(item.metadata),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const updateField = (field: keyof AudioMetadata, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setSaveError(null)
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveError(null)

    const didSave = await onSave(item.id, metadataFromDraft(draft))

    if (didSave) {
      onClose()
      return
    }

    setIsSaving(false)
    setSaveError('Metadata could not be saved. Try again.')
  }

  return (
    <Modal
      animationType="slide"
      presentationStyle="pageSheet"
      visible
      onRequestClose={() => {
        if (!isSaving) onClose()
      }}
    >
      <ThemedView flex={1}>
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.safeArea}
          >
            <XStack
              alignItems="center"
              justifyContent="space-between"
              gap={Spacing.two}
              paddingHorizontal={Spacing.three}
              paddingVertical={Spacing.two}
            >
              <AppButton
                tone="ghost"
                accessibilityLabel="Cancel metadata changes"
                disabled={isSaving}
                onPress={onClose}
              >
                <ThemedText type="smallBold">Cancel</ThemedText>
              </AppButton>
              <ThemedText type="heading">Audio metadata</ThemedText>
              <AppButton
                accessibilityLabel="Save audio metadata"
                accessibilityState={{ busy: isSaving }}
                disabled={isSaving}
                onPress={() => void handleSave()}
              >
                <ThemedText type="smallBold" color="$accentForeground">
                  {isSaving ? 'Saving…' : 'Save'}
                </ThemedText>
              </AppButton>
            </XStack>

            <ScrollView
              flex={1}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formContent}
            >
              <YStack
                width="100%"
                maxWidth={640}
                alignSelf="center"
                gap={Spacing.three}
              >
                <YStack gap={Spacing.one}>
                  <ThemedText type="smallBold">
                    Add as much or as little as you want
                  </ThemedText>
                  <ThemedText type="metadata" themeColor="textSecondary">
                    Every field is optional. The original audio file is not
                    modified.
                  </ThemedText>
                </YStack>

                <MetadataInput
                  label="Title"
                  placeholder={getAudioItemTitle(item)}
                  value={draft.title}
                  onChangeText={(value) => updateField('title', value)}
                />
                <MetadataInput
                  label="Artist or creator"
                  placeholder="Artist, host, or creator"
                  value={draft.artist}
                  onChangeText={(value) => updateField('artist', value)}
                />
                <MetadataInput
                  label="Album or show"
                  placeholder="Album, podcast, or series"
                  value={draft.album}
                  onChangeText={(value) => updateField('album', value)}
                />
                <MetadataInput
                  label="Release year"
                  placeholder="2026"
                  keyboardType="number-pad"
                  value={draft.releaseYear}
                  onChangeText={(value) => updateField('releaseYear', value)}
                />
                <MetadataInput
                  label="Genre"
                  placeholder="Music, technology, interview…"
                  value={draft.genre}
                  onChangeText={(value) => updateField('genre', value)}
                />
                <MetadataInput
                  label="Artwork URL"
                  placeholder="https://example.com/artwork.jpg"
                  autoCapitalize="none"
                  keyboardType="url"
                  value={draft.coverArtUrl}
                  onChangeText={(value) => updateField('coverArtUrl', value)}
                />
                <MetadataInput
                  multiline
                  label="Description or notes"
                  placeholder="Add a description, credits, or personal notes"
                  value={draft.description}
                  onChangeText={(value) => updateField('description', value)}
                />

                {saveError ? (
                  <ThemedText
                    accessibilityLiveRegion="polite"
                    type="metadata"
                    color="$danger"
                  >
                    {saveError}
                  </ThemedText>
                ) : null}
              </YStack>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  )
}

type MetadataInputProps = {
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  keyboardType?: 'default' | 'number-pad' | 'url'
  label: string
  multiline?: boolean
  onChangeText: (value: string) => void
  placeholder: string
  value: string
}

function MetadataInput({
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  label,
  multiline = false,
  onChangeText,
  placeholder,
  value,
}: MetadataInputProps) {
  const theme = useTheme()

  return (
    <YStack gap={Spacing.one}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.borderColor,
            color: theme.text,
          },
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </YStack>
  )
}

function metadataToDraft(metadata: AudioMetadata): MetadataDraft {
  return {
    title: metadata.title ?? '',
    artist: metadata.artist ?? '',
    album: metadata.album ?? '',
    releaseYear: metadata.releaseYear ?? '',
    genre: metadata.genre ?? '',
    coverArtUrl: metadata.coverArtUrl ?? '',
    description: metadata.description ?? '',
  }
}

function metadataFromDraft(draft: MetadataDraft): AudioMetadata {
  return {
    title: normalizeOptionalText(draft.title),
    artist: normalizeOptionalText(draft.artist),
    album: normalizeOptionalText(draft.album),
    releaseYear: normalizeOptionalText(draft.releaseYear),
    genre: normalizeOptionalText(draft.genre),
    coverArtUrl: normalizeOptionalText(draft.coverArtUrl),
    description: normalizeOptionalText(draft.description),
  }
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim()
  return normalized || null
}

const REORDER_STEP_DISTANCE = 124

const PLAY_ICON: SymbolViewProps['name'] = {
  ios: 'play.fill',
  android: 'play_arrow',
  web: 'play_arrow',
}
const UPLOAD_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.up.circle',
  android: 'cloud_upload',
  web: 'cloud_upload',
}
const UPLOADED_ICON: SymbolViewProps['name'] = {
  ios: 'checkmark.icloud.fill',
  android: 'cloud_done',
  web: 'cloud_done',
}
const PAUSE_ICON: SymbolViewProps['name'] = {
  ios: 'pause.fill',
  android: 'pause',
  web: 'pause',
}
const MORE_ICON: SymbolViewProps['name'] = {
  ios: 'ellipsis',
  android: 'more_horiz',
  web: 'more_horiz',
}
const PLAY_NEXT_ICON: SymbolViewProps['name'] = {
  ios: 'text.line.first.and.arrowtriangle.forward',
  android: 'queue_play_next',
  web: 'queue_play_next',
}
const CLOSE_ICON: SymbolViewProps['name'] = {
  ios: 'xmark',
  android: 'close',
  web: 'close',
}
const REORDER_ICON: SymbolViewProps['name'] = {
  ios: 'line.3.horizontal',
  android: 'drag_handle',
  web: 'drag_handle',
}
const DELETE_ICON: SymbolViewProps['name'] = {
  ios: 'trash',
  android: 'delete_outline',
  web: 'delete_outline',
}
const PLAYLIST_ICON: SymbolViewProps['name'] = {
  ios: 'music.note.list',
  android: 'queue_music',
  web: 'queue_music',
}
const EDIT_ICON: SymbolViewProps['name'] = {
  ios: 'pencil',
  android: 'edit',
  web: 'edit',
}

const AnimatedView = styled(Animated.View, {
  name: 'AnimatedView',
})

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  formContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 120,
  },
})
