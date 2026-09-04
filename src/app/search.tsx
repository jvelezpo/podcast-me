import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input, View, XStack, YStack, useMedia } from 'tamagui';

import { EpisodeResultRow } from '@/components/episode-result-row';
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
import { useTheme } from '@/hooks/use-theme';
import { getEpisodeTitle } from '@/utils/audio-display';

export default function SearchScreen() {
  const { library, playback } = useAudioLibraryContext();
  const [query, setQuery] = useState('');
  const media = useMedia();
  const theme = useTheme();
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(
    () =>
      normalizedQuery.length === 0
        ? library.items
        : library.items.filter((item) =>
            getEpisodeTitle(item.originalName).toLocaleLowerCase().includes(normalizedQuery)
          ),
    [library.items, normalizedQuery]
  );
  const hasPlayer = playback.activeItemId !== null;

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
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
                  Search every episode saved in your local library.
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
                  accessibilityLabel="Search audio library"
                  value={query}
                  onChangeText={setQuery}
                  flex={1}
                  unstyled
                  fontSize={16}
                  color="$color"
                  placeholder="Episode title"
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
                {normalizedQuery.length === 0
                  ? `${results.length} saved ${results.length === 1 ? 'episode' : 'episodes'}`
                  : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
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
                {library.items.length === 0 ? 'Nothing saved yet' : 'No matching episodes'}
              </ThemedText>
              <ThemedText themeColor="textSecondary" textAlign="center" maxWidth={380}>
                {library.items.length === 0
                  ? 'Add audio in Library, then find it here in an instant.'
                  : `Try another title or clear “${query.trim()}”.`}
              </ThemedText>
            </ThemedView>
          }
          renderItem={({ item }) => {
            const isActive = playback.activeItemId === item.id;

            return (
              <EpisodeResultRow
                item={item}
                isActive={isActive}
                isPlaying={isActive && playback.isPlaying}
                isTransitioning={playback.isTransitioning}
                isPlaybackReady={playback.isReady}
                onTogglePlayback={playback.togglePlayback}
              />
            );
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
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

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  list: { flex: 1 },
});
