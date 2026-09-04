import { useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, View, XStack, YStack, useMedia } from 'tamagui';

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

export default function DiscoverScreen() {
  const { library, playback } = useAudioLibraryContext();
  const router = useRouter();
  const media = useMedia();
  const theme = useTheme();
  const activeItem =
    library.items.find((item) => item.id === playback.activeItemId) ??
    library.items.find((item) => item.lastPositionSeconds > 0) ??
    library.items[0] ??
    null;
  const recentItems = [...library.items]
    .sort((first, second) => second.addedAt.localeCompare(first.addedAt))
    .slice(0, 3);
  const hasPlayer = playback.activeItemId !== null;

  return (
    <ThemedView flex={1}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          flex={1}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            width: '100%',
            maxWidth: MaxContentWidth,
            alignSelf: 'center',
            gap: Spacing.five,
            paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
            paddingTop: media.short ? Spacing.three : Spacing.four,
            paddingBottom: (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four,
          }}>
          <YStack gap={Spacing.one}>
            <ThemedText type="eyebrow" themeColor="accent">
              Made for your queue
            </ThemedText>
            <ThemedText type="title" $compact={{ fontSize: 36, lineHeight: 42 }}>
              Discover
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              Pick up where you left off and rediscover what you saved.
            </ThemedText>
          </YStack>

          <ThemedView
            type="accentSubtle"
            overflow="hidden"
            gap={Spacing.four}
            padding={Spacing.five}
            borderWidth={1}
            borderColor="$accent"
            borderRadius={Radius.large}
            $compact={{ padding: Spacing.four }}>
            <View
              position="absolute"
              top={-80}
              right={-70}
              width={210}
              height={210}
              borderRadius={210}
              backgroundColor="$accent"
              opacity={0.12}
            />
            <View
              position="absolute"
              right={50}
              bottom={-90}
              width={180}
              height={180}
              borderRadius={180}
              backgroundColor="$accent"
              opacity={0.08}
            />
            <YStack maxWidth={560} gap={Spacing.two}>
              <ThemedText type="eyebrow" themeColor="accent">
                Private by design
              </ThemedText>
              <ThemedText type="subtitle" $compact={{ fontSize: 27, lineHeight: 33 }}>
                Your audio, your pace, your device.
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                Offline listening, reliable resume progress, and no account between you and your
                next episode.
              </ThemedText>
            </YStack>
            <AppButton
              alignSelf="flex-start"
              accessibilityLabel="Open audio library"
              onPress={() => router.navigate('/')}>
              <ThemedText type="smallBold" color="$accentForeground">
                Open library
              </ThemedText>
              <SymbolView name={ARROW_ICON} size={17} tintColor={theme.accentForeground} />
            </AppButton>
          </ThemedView>

          <YStack gap={Spacing.three}>
            <SectionHeading
              title="Continue listening"
              subtitle="Jump back in without losing your place."
            />
            {activeItem ? (
              <EpisodeResultRow
                item={activeItem}
                isActive={playback.activeItemId === activeItem.id}
                isPlaying={playback.activeItemId === activeItem.id && playback.isPlaying}
                isTransitioning={playback.isTransitioning}
                isPlaybackReady={playback.isReady}
                onTogglePlayback={playback.togglePlayback}
              />
            ) : (
              <EmptyDiscoverCard onOpenLibrary={() => router.navigate('/')} />
            )}
          </YStack>

          <YStack gap={Spacing.three}>
            <SectionHeading
              title="Listening essentials"
              subtitle="The features that travel with every episode."
            />
            <XStack flexWrap="wrap" gap={Spacing.three}>
              <FeatureCard
                icon={DOWNLOAD_ICON}
                title="Offline ready"
                description="Imported episodes are copied into private app storage."
                tintColor={theme.success}
              />
              <FeatureCard
                icon={QUEUE_ICON}
                title="Your queue"
                description="Library order is saved, including every drag-and-drop change."
                tintColor={theme.accent}
              />
              <FeatureCard
                icon={BACKGROUND_ICON}
                title="Keep listening"
                description="Playback continues in the background and on the lock screen."
                tintColor={theme.warning}
              />
            </XStack>
          </YStack>

          {recentItems.length > 0 && (
            <YStack gap={Spacing.three}>
              <SectionHeading title="Recently added" subtitle="Fresh arrivals in your library." />
              {recentItems.map((item) => {
                const isActive = playback.activeItemId === item.id;

                return (
                  <EpisodeResultRow
                    key={item.id}
                    item={item}
                    isActive={isActive}
                    isPlaying={isActive && playback.isPlaying}
                    isTransitioning={playback.isTransitioning}
                    isPlaybackReady={playback.isReady}
                    onTogglePlayback={playback.togglePlayback}
                  />
                );
              })}
            </YStack>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SectionHeading({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <YStack gap={Spacing.one}>
      <ThemedText type="heading">{title}</ThemedText>
      <ThemedText type="metadata" themeColor="textSecondary">
        {subtitle}
      </ThemedText>
    </YStack>
  );
}

function FeatureCard({
  description,
  icon,
  tintColor,
  title,
}: {
  description: string;
  icon: SymbolViewProps['name'];
  tintColor: string;
  title: string;
}) {
  return (
    <ThemedView
      type="backgroundElement"
      minWidth={210}
      flex={1}
      gap={Spacing.three}
      padding={Spacing.four}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.large}>
      <View
        width={46}
        height={46}
        alignItems="center"
        justifyContent="center"
        borderRadius={15}
        backgroundColor="$backgroundSelected">
        <SymbolView name={icon} size={23} tintColor={tintColor} />
      </View>
      <YStack gap={Spacing.one}>
        <ThemedText type="episodeTitle">{title}</ThemedText>
        <ThemedText type="metadata" themeColor="textSecondary">
          {description}
        </ThemedText>
      </YStack>
    </ThemedView>
  );
}

function EmptyDiscoverCard({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <ThemedView
      type="backgroundElement"
      alignItems="center"
      gap={Spacing.two}
      padding={Spacing.four}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.large}>
      <ThemedText type="episodeTitle" textAlign="center">
        Your next episode starts in Library
      </ThemedText>
      <ThemedText type="metadata" themeColor="textSecondary" textAlign="center">
        Add a local audio file to start listening offline.
      </ThemedText>
      <AppButton tone="secondary" onPress={onOpenLibrary}>
        <ThemedText type="smallBold">Go to Library</ThemedText>
      </AppButton>
    </ThemedView>
  );
}

const ARROW_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.right',
  android: 'arrow_forward',
  web: 'arrow_forward',
};
const DOWNLOAD_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.down.circle.fill',
  android: 'download_for_offline',
  web: 'download_for_offline',
};
const QUEUE_ICON: SymbolViewProps['name'] = {
  ios: 'text.line.first.and.arrowtriangle.forward',
  android: 'queue_music',
  web: 'queue_music',
};
const BACKGROUND_ICON: SymbolViewProps['name'] = {
  ios: 'lock.open.rotation',
  android: 'screen_lock_portrait',
  web: 'screen_lock_portrait',
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
});
