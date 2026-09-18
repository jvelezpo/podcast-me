import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { View, XStack, YStack } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import { Radius, Spacing } from '@/constants/theme'
import { useTheme } from '@/hooks/use-theme'
import type { Playlist } from '@/models/playlist'

type PlaylistRowProps = {
  playlist: Playlist
  playableCount: number
  onOpen: (playlist: Playlist) => void
  onDelete: (playlist: Playlist) => void
  isDeleteDisabled: boolean
}

export function PlaylistRow({
  playlist,
  playableCount,
  onOpen,
  onDelete,
  isDeleteDisabled,
}: PlaylistRowProps) {
  const theme = useTheme()
  const total = playlist.items.length

  return (
    <ThemedView
      type="backgroundElement"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.large}
      boxShadow="0 8px 24px rgba(0,0,0,0.12)"
    >
      <XStack alignItems="center" gap={Spacing.three} padding={Spacing.three}>
        <View
          width={56}
          height={56}
          flexShrink={0}
          alignItems="center"
          justifyContent="center"
          borderRadius={Radius.medium}
          backgroundColor="$accentSubtle"
        >
          <SymbolView name={PLAYLIST_ICON} size={26} tintColor={theme.accent} />
        </View>
        <AppButton
          tone="ghost"
          accessibilityLabel={`Open playlist ${playlist.name}`}
          onPress={() => onOpen(playlist)}
          minWidth={0}
          flex={1}
          justifyContent="flex-start"
          padding={0}
        >
          <YStack flex={1} minWidth={0} gap={Spacing.one}>
            <ThemedText type="episodeTitle" numberOfLines={1}>
              {playlist.name}
            </ThemedText>
            {playlist.description ? (
              <ThemedText type="metadata" themeColor="textSecondary" numberOfLines={1}>
                {playlist.description}
              </ThemedText>
            ) : null}
            <ThemedText type="metadata" themeColor="textSecondary" numberOfLines={1}>
              {total === 0
                ? 'Empty playlist'
                : `${total} ${total === 1 ? 'audio' : 'audios'} · ${playableCount} playable`}
            </ThemedText>
          </YStack>
        </AppButton>
        <AppButton
          tone="icon"
          accessibilityLabel={`Open playlist ${playlist.name}`}
          onPress={() => onOpen(playlist)}
          backgroundColor="$accent"
        >
          <SymbolView name={OPEN_ICON} size={20} tintColor={theme.accentForeground} weight="bold" />
        </AppButton>
        <AppButton
          tone="danger"
          accessibilityLabel={`Delete playlist ${playlist.name}`}
          accessibilityState={{ disabled: isDeleteDisabled }}
          disabled={isDeleteDisabled}
          onPress={() => onDelete(playlist)}
        >
          <SymbolView name={DELETE_ICON} size={17} tintColor={theme.danger} />
        </AppButton>
      </XStack>
    </ThemedView>
  )
}

const PLAYLIST_ICON: SymbolViewProps['name'] = {
  ios: 'music.note.list',
  android: 'queue_music',
  web: 'queue_music',
}
const OPEN_ICON: SymbolViewProps['name'] = {
  ios: 'chevron.right',
  android: 'chevron_right',
  web: 'chevron_right',
}
const DELETE_ICON: SymbolViewProps['name'] = {
  ios: 'trash',
  android: 'delete_outline',
  web: 'delete_outline',
}
