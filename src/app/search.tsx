import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SectionList,
  StyleSheet,
  type SectionListData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input, View, XStack, YStack, useMedia } from 'tamagui';

import { EpisodeResultRow } from '@/components/episode-result-row';
import { RemoteAudioRow } from '@/components/remote-audio-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppButton } from '@/components/ui/app-button';
import {
  BottomPlayerInset,
  BottomTabInset,
  MaxContentWidth,
  Radius,
  Spacing,
} from '@/constants/theme';
import { useAudioLibraryContext } from '@/contexts/audio-library-context';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from '@/hooks/use-theme';
import type { Playlist } from '@/models/playlist';
import type { RemoteAudio } from '@/services/api';
import type { LoadedAudioItem } from '@/services/audio-library-storage';
import {
  getRemoteAudioDownloadState,
  loadCachedRemoteAudios,
} from '@/services/remote-audio-file-cache';
import { getEpisodeTitle } from '@/utils/audio-display';

type SearchResultItem =
  | { kind: 'local'; item: LoadedAudioItem }
  | { kind: 'remote'; audio: RemoteAudio; isCached: boolean }
  | { kind: 'playlist'; playlist: Playlist };

type SearchSection = {
  key: 'local' | 'remote' | 'playlist';
  title: string;
  data: SearchResultItem[];
};

/** Debounce for the search filter so each keystroke does not refilter. */
const SEARCH_DEBOUNCE_MS = 150;

export default function SearchScreen() {
  const {
    library,
    playlists,
    playback,
    remotePlayback,
    openRemotePlayer,
  } = useAudioLibraryContext();
  const { user, loadRemoteAudios } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [remoteAudios, setRemoteAudios] = useState<RemoteAudio[]>([]);
  const [cachedRemoteIds, setCachedRemoteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const media = useMedia();
  const theme = useTheme();
  const networkState = useNetworkState();
  const isOffline =
    networkState.isConnected === false ||
    networkState.isInternetReachable === false;
  const isOnline = networkState.isConnected === true && !isOffline;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let isMounted = true;

    if (!user) {
      setRemoteAudios([]);
      setCachedRemoteIds(new Set());
      return () => {
        isMounted = false;
      };
    }

    void (async () => {
      const cachedAudios = await loadCachedRemoteAudios(user.id);

      if (!isMounted) {
        return;
      }

      setCachedRemoteIds(new Set(cachedAudios.map((audio) => audio.id)));
      setRemoteAudios(mergeRemoteAudios([], cachedAudios));

      if (!isOnline) {
        return;
      }

      try {
        const onlineAudios = await loadRemoteAudios();

        if (isMounted) {
          setRemoteAudios(mergeRemoteAudios(onlineAudios, cachedAudios));
        }
      } catch {
        // Keep downloaded audio searchable when the cloud refresh fails.
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isOnline, loadRemoteAudios, user]);

  const normalizedQuery = useMemo(
    () => normalizeSearchText(debouncedQuery.trim()),
    [debouncedQuery],
  );
  const isFiltering = normalizedQuery.length > 0;

  const localResults = useMemo(
    () =>
      isFiltering
        ? library.items.filter((item) =>
            matchesQuery(localItemHaystack(item), normalizedQuery),
          )
        : library.items,
    [isFiltering, library.items, normalizedQuery],
  );
  const remoteResults = useMemo(
    () =>
      isFiltering
        ? remoteAudios.filter((audio) =>
            matchesQuery(remoteAudioHaystack(audio), normalizedQuery),
          )
        : remoteAudios,
    [isFiltering, normalizedQuery, remoteAudios],
  );
  const playlistResults = useMemo(
    () =>
      isFiltering
        ? playlists.playlists.filter((playlist) =>
            matchesQuery(playlistHaystack(playlist), normalizedQuery),
          )
        : playlists.playlists,
    [isFiltering, normalizedQuery, playlists.playlists],
  );

  const sections = useMemo<SearchSection[]>(() => {
    const all: SearchSection[] = [
      {
        key: 'local',
        title: 'On device',
        data: localResults.map((item) => ({ kind: 'local', item })),
      },
      {
        key: 'remote',
        title: 'Cloud',
        data: remoteResults.map((audio) => ({
          kind: 'remote',
          audio,
          isCached: cachedRemoteIds.has(audio.id),
        })),
      },
      {
        key: 'playlist',
        title: 'Playlists',
        data: playlistResults.map((playlist) => ({
          kind: 'playlist',
          playlist,
        })),
      },
    ];

    // Hide empty sections for an active query so only hits stay visible.
    return isFiltering ? all.filter((section) => section.data.length > 0) : all;
  }, [cachedRemoteIds, isFiltering, localResults, playlistResults, remoteResults]);

  const totalResults =
    localResults.length + remoteResults.length + playlistResults.length;
  const hasPlayer =
    playback.activeItemId !== null || remotePlayback.activeAudioId !== null;

  const handleToggleLocalPlayback = (item: LoadedAudioItem) => {
    if (remotePlayback.activeAudioId || remotePlayback.isTransitioning) {
      remotePlayback.stop();
    }

    playback.togglePlayback(item);
  };

  const handleToggleRemotePlayback = async (audio: RemoteAudio) => {
    if (remotePlayback.activeAudioId !== audio.id && playback.activeItemId) {
      const didStopLocalPlayback = await playback.dismissPlayer();

      if (!didStopLocalPlayback) {
        return;
      }
    }

    remotePlayback.togglePlayback(audio);
  };

  const handleOpenPlaylist = (playlist: Playlist) => {
    router.push(`/playlist/${playlist.id}`);
  };

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.safeArea}>
          <SectionList
            sections={sections}
            keyExtractor={(item) => searchResultKey(item)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={styles.list}
            contentContainerStyle={{
              flexGrow: 1,
              width: '100%',
              maxWidth: MaxContentWidth,
              alignSelf: 'center',
              paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
              paddingTop: media.short ? Spacing.three : Spacing.four,
              paddingBottom: (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four,
            }}
            ItemSeparatorComponent={() => <View height={Spacing.two} />}
            SectionSeparatorComponent={() => <View height={Spacing.three} />}
            renderSectionHeader={({
              section,
            }: {
              section: SectionListData<SearchResultItem, SearchSection>;
            }) => (
              <ThemedText
                type="smallBold"
                accessibilityRole="header"
                accessibilityLabel={`${section.title}, ${section.data.length} ${
                  section.data.length === 1 ? 'result' : 'results'
                }`}>
                {section.title} · {section.data.length}
              </ThemedText>
            )}
            ListHeaderComponent={
              <YStack gap={Spacing.four} marginBottom={Spacing.four}>
                <YStack gap={Spacing.one}>
                  <ThemedText type="eyebrow" themeColor="accent">
                    Find your next listen
                  </ThemedText>
                  <ThemedText type="title" $compact={{ fontSize: 36, lineHeight: 42 }}>
                    Search
                  </ThemedText>
                  <ThemedText themeColor="textSecondary">
                    Search episodes on this device, cloud audio, and playlists.
                  </ThemedText>
                </YStack>

                <ThemedView
                  type="backgroundElement"
                  minHeight={54}
                  flexDirection="row"
                  alignItems="center"
                  gap={Spacing.two}
                  paddingHorizontal={Spacing.three}
                  borderWidth={1}
                  borderColor="$borderColor"
                  borderRadius={Radius.medium}>
                  <SymbolView name={SEARCH_ICON} size={21} tintColor={theme.textSecondary} />
                  <Input
                    accessibilityLabel="Search episodes, cloud audio, and playlists"
                    value={query}
                    onChangeText={setQuery}
                    flex={1}
                    unstyled
                    fontSize={16}
                    color="$color"
                    placeholder="Titles, artists, albums, playlists"
                    placeholderTextColor={theme.textSecondary}
                  />
                  {query.length > 0 && (
                    <AppButton
                      tone="icon"
                      width={36}
                      minWidth={36}
                      height={36}
                      minHeight={36}
                      accessibilityLabel="Clear search"
                      onPress={() => setQuery('')}>
                      <SymbolView name={CLEAR_ICON} size={17} tintColor={theme.textSecondary} />
                    </AppButton>
                  )}
                </ThemedView>

                <ThemedText type="smallBold">
                  {isFiltering
                    ? `${totalResults} ${totalResults === 1 ? 'result' : 'results'} for “${debouncedQuery.trim()}”`
                    : `${localResults.length} on device · ${remoteResults.length} in cloud · ${playlistResults.length} playlists`}
                </ThemedText>
              </YStack>
            }
            ListEmptyComponent={
              <ThemedView
                type="backgroundElement"
                flex={1}
                alignItems="center"
                justifyContent="center"
                gap={Spacing.two}
                padding={Spacing.five}
                borderWidth={1}
                borderColor="$borderColor"
                borderRadius={Radius.large}>
                <View
                  width={58}
                  height={58}
                  alignItems="center"
                  justifyContent="center"
                  borderRadius={29}
                  backgroundColor="$accentSubtle">
                  <SymbolView name={SEARCH_ICON} size={27} tintColor={theme.accent} />
                </View>
                <ThemedText type="heading" textAlign="center">
                  {isFiltering
                    ? 'No matching results'
                    : library.items.length === 0
                      ? 'Nothing saved yet'
                      : 'No matching episodes'}
                </ThemedText>
                <ThemedText themeColor="textSecondary" textAlign="center" maxWidth={380}>
                  {isFiltering
                    ? `Try a title, artist, album, or playlist name instead of “${debouncedQuery.trim()}”.`
                    : library.items.length === 0
                      ? 'Add audio in Library, then find it here in an instant.'
                      : 'Try another title or pick a section above.'}
                </ThemedText>
                {isFiltering && (
                  <AppButton
                    tone="secondary"
                    accessibilityLabel="Clear search"
                    onPress={() => setQuery('')}>
                    <ThemedText type="smallBold">Clear search</ThemedText>
                  </AppButton>
                )}
              </ThemedView>
            }
            renderItem={({ item }) => {
              if (item.kind === 'local') {
                const isActive = playback.activeItemId === item.item.id;

                return (
                  <EpisodeResultRow
                    item={item.item}
                    isActive={isActive}
                    isPlaying={isActive && playback.isPlaying}
                    isTransitioning={playback.isTransitioning}
                    isPlaybackReady={playback.isReady}
                    onTogglePlayback={handleToggleLocalPlayback}
                  />
                );
              }

              if (item.kind === 'remote') {
                const isActive = remotePlayback.activeAudioId === item.audio.id;

                return (
                  <RemoteAudioRow
                    audio={item.audio}
                    isCached={item.isCached}
                    downloadState={getRemoteAudioDownloadState(item.isCached, false)}
                    canDownload={false}
                    downloadError={null}
                    isActive={isActive}
                    isPlaying={isActive && remotePlayback.isPlaying}
                    isTransitioning={remotePlayback.isTransitioning}
                    playbackError={
                      remotePlayback.playbackError?.audioId === item.audio.id
                        ? remotePlayback.playbackError.message
                        : null
                    }
                    onOpenPlayer={openRemotePlayer}
                    onTogglePlayback={handleToggleRemotePlayback}
                  />
                );
              }

              const total = item.playlist.items.length;

              return (
                <ThemedView
                  type="backgroundElement"
                  borderWidth={1}
                  borderColor="$borderColor"
                  borderRadius={Radius.large}>
                  <XStack alignItems="center" gap={Spacing.three} padding={Spacing.three}>
                    <View
                      width={56}
                      height={56}
                      flexShrink={0}
                      alignItems="center"
                      justifyContent="center"
                      borderRadius={Radius.medium}
                      backgroundColor="$accentSubtle">
                      <SymbolView name={PLAYLIST_ICON} size={26} tintColor={theme.accent} />
                    </View>
                    <YStack flex={1} minWidth={0} gap={Spacing.one}>
                      <ThemedText type="episodeTitle" numberOfLines={1}>
                        {item.playlist.name}
                      </ThemedText>
                      <ThemedText type="metadata" themeColor="textSecondary" numberOfLines={1}>
                        {total === 0
                          ? 'Empty playlist'
                          : `${total} ${total === 1 ? 'audio' : 'audios'}`}
                      </ThemedText>
                    </YStack>
                    <AppButton
                      tone="icon"
                      accessibilityLabel={`Open playlist ${item.playlist.name}`}
                      onPress={() => handleOpenPlaylist(item.playlist)}
                      backgroundColor="$accent">
                      <SymbolView
                        name={OPEN_ICON}
                        size={20}
                        tintColor={theme.accentForeground}
                        weight="bold"
                      />
                    </AppButton>
                  </XStack>
                </ThemedView>
              );
            }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** Lowercases, strips diacritics, and trims so "café" matches "cafe". */
function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

function matchesQuery(fields: readonly (string | null | undefined)[], query: string): boolean {
  return fields.some(
    (field) => field && normalizeSearchText(field).includes(query),
  );
}

function localItemHaystack(item: LoadedAudioItem): (string | null | undefined)[] {
  return [
    item.originalName,
    getEpisodeTitle(item.originalName),
    item.metadata.title,
    item.metadata.artist,
    item.metadata.album,
    item.metadata.description,
  ];
}

function remoteAudioHaystack(audio: RemoteAudio): (string | null | undefined)[] {
  const fields: (string | null | undefined)[] = [audio.title, audio.source];

  if (
    typeof audio.metadata === 'object' &&
    audio.metadata !== null &&
    !Array.isArray(audio.metadata)
  ) {
    for (const value of Object.values(audio.metadata)) {
      if (typeof value === 'string' && value.trim()) {
        fields.push(value);
      }
    }
  }

  return fields;
}

function playlistHaystack(playlist: Playlist): (string | null | undefined)[] {
  return [playlist.name, playlist.description];
}

function searchResultKey(item: SearchResultItem): string {
  if (item.kind === 'local') {
    return `local-${item.item.id}`;
  }

  if (item.kind === 'remote') {
    return `remote-${item.audio.id}`;
  }

  return `playlist-${item.playlist.id}`;
}

function mergeRemoteAudios(
  onlineAudios: RemoteAudio[],
  cachedAudios: RemoteAudio[],
): RemoteAudio[] {
  const onlineIds = new Set(onlineAudios.map((audio) => audio.id));

  return [
    ...onlineAudios,
    ...cachedAudios.filter((audio) => !onlineIds.has(audio.id)),
  ];
}

const SEARCH_ICON: SymbolViewProps['name'] = {
  ios: 'magnifyingglass',
  android: 'search',
  web: 'search',
};
const CLEAR_ICON: SymbolViewProps['name'] = {
  ios: 'xmark.circle.fill',
  android: 'cancel',
  web: 'cancel',
};
const PLAYLIST_ICON: SymbolViewProps['name'] = {
  ios: 'music.note.list',
  android: 'queue_music',
  web: 'queue_music',
};
const OPEN_ICON: SymbolViewProps['name'] = {
  ios: 'chevron.right',
  android: 'chevron_right',
  web: 'chevron_right',
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
});
