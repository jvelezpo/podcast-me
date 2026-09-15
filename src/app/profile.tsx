import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ScrollView, View, XStack, YStack, useMedia } from 'tamagui'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { AppButton } from '@/components/ui/app-button'
import {
  BottomPlayerInset,
  BottomTabInset,
  MaxContentWidth,
  Radius,
  Spacing,
} from '@/constants/theme'
import { useAudioLibraryContext } from '@/contexts/audio-library-context'
import { useAuth } from '@/contexts/auth-context'
import {
  type ThemePreference,
  useThemePreference,
} from '@/contexts/theme-preference-context'
import { useTheme } from '@/hooks/use-theme'
import { formatPlaybackTime } from '@/utils/audio-display'
import { version } from '../../package.json'

export default function ProfileScreen() {
  const { library, playback } = useAudioLibraryContext()
  const { preference, setPreference } = useThemePreference()
  const media = useMedia()
  const theme = useTheme()
  const listenedSeconds = library.items.reduce(
    (total, item) => total + item.lastPositionSeconds,
    0,
  )
  const hasPlayer = playback.activeItemId !== null

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
            gap: Spacing.four,
            paddingHorizontal: media.wide ? Spacing.five : Spacing.three,
            paddingTop: media.short ? Spacing.three : Spacing.four,
            paddingBottom:
              (hasPlayer ? BottomPlayerInset : BottomTabInset) + Spacing.four,
          }}
        >
          <YStack gap={Spacing.one}>
            <ThemedText type="eyebrow" themeColor="accent">
              Your listening
            </ThemedText>
            <ThemedText
              type="title"
              $compact={{ fontSize: 36, lineHeight: 42 }}
            >
              Profile
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              Playback preferences and an at-a-glance view of your local
              collection.
            </ThemedText>
          </YStack>

          <AccountCard />

          <XStack flexWrap="wrap" gap={Spacing.three}>
            <StatCard
              icon={DOWNLOAD_ICON}
              label="Downloads"
              value={`${library.items.filter((item) => item.isAvailable).length}`}
              tintColor={theme.success}
            />
            <StatCard
              icon={QUEUE_ICON}
              label="In queue"
              value={`${library.items.length}`}
              tintColor={theme.accent}
            />
            <StatCard
              icon={TIME_ICON}
              label="Resume time"
              value={formatPlaybackTime(listenedSeconds)}
              tintColor={theme.warning}
            />
          </XStack>

          <SectionCard title="Appearance" subtitle="Dark mode is the default.">
            <XStack gap={Spacing.two} $compact={{ flexDirection: 'column' }}>
              <ThemeChoice
                label="Dark"
                value="dark"
                selected={preference === 'dark'}
                onSelect={setPreference}
              />
              <ThemeChoice
                label="Light"
                value="light"
                selected={preference === 'light'}
                onSelect={setPreference}
              />
              <ThemeChoice
                label="System"
                value="system"
                selected={preference === 'system'}
                onSelect={setPreference}
              />
            </XStack>
          </SectionCard>

          <SectionCard
            title="Playback"
            subtitle="Media controls stay predictable wherever you listen."
          >
            <SettingsRow
              icon={BACKGROUND_ICON}
              title="Background playback"
              description="Continues while the app is minimized or the phone is locked."
              tintColor={theme.accent}
            />
            <SettingsDivider />
            <SettingsRow
              icon={BLUETOOTH_ICON}
              title="Bluetooth recovery"
              description="Pauses safely during route changes, then resumes automatically."
              tintColor={theme.accent}
            />
            <SettingsDivider />
            <SettingsRow
              icon={SPEED_ICON}
              title="Playback speed"
              description={`${playback.playbackRate}× · Change it from Now Playing.`}
              tintColor={theme.accent}
            />
          </SectionCard>

          <SectionCard
            title="Storage & privacy"
            subtitle="Your audio is yours, and stays that way."
          >
            <SettingsRow
              icon={LOCK_ICON}
              title="On-device only"
              description="Audio, ordering, and resume progress stay in app-owned local storage."
              tintColor={theme.success}
            />
            <SettingsDivider />
            <SettingsRow
              icon={OFFLINE_ICON}
              title="Available offline"
              description={`${library.items.filter((item) => item.isAvailable).length} files ready without a connection.`}
              tintColor={theme.success}
            />
          </SectionCard>
          <ThemedText
            type="metadata"
            themeColor="textSecondary"
            textAlign="center"
          >
            Podcast Me · Version {version}
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  )
}

function AccountCard() {
  const {
    isRestoring,
    libraryTotal,
    profileError,
    refreshProfile,
    requestCode,
    signOut,
    user,
    verifyCode,
  } = useAuth()
  const theme = useTheme()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeRequested, setCodeRequested] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const submitRequest = async () => {
    setIsSubmitting(true)
    setMessage(null)

    try {
      await requestCode(email)
      setCodeRequested(true)
      setMessage('Check your inbox for the 6-digit sign-in code.')
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitVerification = async () => {
    setIsSubmitting(true)
    setMessage(null)

    try {
      await verifyCode(email, code)
      setCode('')
      setCodeRequested(false)
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitSignOut = async () => {
    setIsSubmitting(true)
    setMessage(null)

    try {
      await signOut()
    } catch (error) {
      setMessage(toErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isRestoring) {
    return (
      <SectionCard title="Account" subtitle="Restoring your account.">
        <XStack alignItems="center" gap={Spacing.two}>
          <ActivityIndicator color={theme.accent} />
          <ThemedText themeColor="textSecondary">
            Checking your saved session…
          </ThemedText>
        </XStack>
      </SectionCard>
    )
  }

  if (user) {
    return (
      <SectionCard
        title="Account"
        subtitle="Signed in with a secure email session."
      >
        <YStack gap={Spacing.one}>
          <ThemedText type="smallBold">{user.email}</ThemedText>
          <ThemedText type="metadata" themeColor="textSecondary">
            {libraryTotal === null
              ? 'Updating your library…'
              : `${libraryTotal} audio${libraryTotal === 1 ? '' : 's'} in your account library.`}
          </ThemedText>
        </YStack>
        {profileError ? (
          <ThemedText type="metadata" color="$danger">
            {profileError}
          </ThemedText>
        ) : null}
        <XStack gap={Spacing.two} flexWrap="wrap">
          {profileError ? (
            <AppButton
              tone="outlined"
              disabled={isSubmitting}
              onPress={() => void refreshProfile()}
            >
              <ThemedText type="smallBold">Retry</ThemedText>
            </AppButton>
          ) : null}
          <AppButton
            tone="outlined"
            disabled={isSubmitting}
            onPress={() => void submitSignOut()}
          >
            <ThemedText type="smallBold">Sign out</ThemedText>
          </AppButton>
        </XStack>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Account"
      subtitle="Sign in to keep your account library connected. Podcast Me stays free to use."
    >
      <YStack gap={Spacing.two}>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="Email address"
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.input,
            {
              backgroundColor: theme.background,
              borderColor: theme.borderColor,
              color: theme.text,
            },
          ]}
          value={email}
          onChangeText={(value) => {
            setEmail(value)
            setCodeRequested(false)
            setCode('')
            setMessage(null)
          }}
        />
        {codeRequested ? (
          <TextInput
            autoComplete="one-time-code"
            keyboardType="number-pad"
            maxLength={6}
            placeholder="6-digit code"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              {
                backgroundColor: theme.background,
                borderColor: theme.borderColor,
                color: theme.text,
              },
            ]}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          />
        ) : null}
      </YStack>
      {message ? (
        <ThemedText type="metadata" color="$accent">
          {message}
        </ThemedText>
      ) : null}
      <AppButton
        className="bg-cyan-500"
        disabled={
          isSubmitting || !email.trim() || (codeRequested && code.length !== 6)
        }
        onPress={() => {
          void (codeRequested ? submitVerification() : submitRequest())
        }}
      >
        <ThemedText color="white" type="smallBold">
          {isSubmitting
            ? 'Please wait…'
            : codeRequested
              ? 'Verify code'
              : 'Email me a code'}
        </ThemedText>
      </AppButton>
    </SectionCard>
  )
}

type StatCardProps = {
  icon: SymbolViewProps['name']
  label: string
  value: string
  tintColor: string
}

function StatCard({ icon, label, value, tintColor }: StatCardProps) {
  return (
    <ThemedView
      type="backgroundElement"
      minWidth={150}
      flex={1}
      gap={Spacing.two}
      padding={Spacing.three}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.medium}
    >
      <View
        width={40}
        height={40}
        alignItems="center"
        justifyContent="center"
        borderRadius={20}
        backgroundColor="$backgroundSelected"
      >
        <SymbolView
          name={icon}
          size={21}
          tintColor={tintColor}
          weight="semibold"
        />
      </View>
      <ThemedText type="heading">{value}</ThemedText>
      <ThemedText type="metadata" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  )
}

function SectionCard({
  children,
  subtitle,
  title,
}: {
  children: React.ReactNode
  subtitle: string
  title: string
}) {
  return (
    <ThemedView
      type="backgroundElement"
      gap={Spacing.three}
      padding={Spacing.four}
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius={Radius.large}
    >
      <YStack gap={Spacing.one}>
        <ThemedText type="heading">{title}</ThemedText>
        <ThemedText type="metadata" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </YStack>
      {children}
    </ThemedView>
  )
}

function ThemeChoice({
  label,
  onSelect,
  selected,
  value,
}: {
  label: string
  onSelect: (value: ThemePreference) => void
  selected: boolean
  value: ThemePreference
}) {
  return (
    <AppButton
      tone={selected ? 'secondary' : 'outlined'}
      accessibilityLabel={`Use ${label.toLowerCase()} theme`}
      accessibilityState={{ selected }}
      flex={1}
      borderColor={selected ? '$accent' : '$borderColor'}
      onPress={() => onSelect(value)}
    >
      <View
        width={9}
        height={9}
        borderRadius={9}
        backgroundColor={selected ? '$accent' : '$colorMuted'}
      />
      <ThemedText type="smallBold">{label}</ThemedText>
    </AppButton>
  )
}

function SettingsRow({
  description,
  icon,
  tintColor,
  title,
}: {
  description: string
  icon: SymbolViewProps['name']
  tintColor: string
  title: string
}) {
  return (
    <XStack alignItems="center" gap={Spacing.three}>
      <View
        width={42}
        height={42}
        flexShrink={0}
        alignItems="center"
        justifyContent="center"
        borderRadius={14}
        backgroundColor="$backgroundSelected"
      >
        <SymbolView name={icon} size={21} tintColor={tintColor} />
      </View>
      <YStack flex={1} gap={Spacing.one}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="metadata" themeColor="textSecondary">
          {description}
        </ThemedText>
      </YStack>
      <View width={8} height={8} borderRadius={8} backgroundColor="$success" />
    </XStack>
  )
}

function SettingsDivider() {
  return <View height={1} backgroundColor="$borderColor" />
}

const DOWNLOAD_ICON: SymbolViewProps['name'] = {
  ios: 'arrow.down.circle.fill',
  android: 'download_for_offline',
  web: 'download_for_offline',
}
const QUEUE_ICON: SymbolViewProps['name'] = {
  ios: 'text.line.first.and.arrowtriangle.forward',
  android: 'queue_music',
  web: 'queue_music',
}
const TIME_ICON: SymbolViewProps['name'] = {
  ios: 'clock.fill',
  android: 'schedule',
  web: 'schedule',
}
const BACKGROUND_ICON: SymbolViewProps['name'] = {
  ios: 'lock.open.rotation',
  android: 'screen_lock_portrait',
  web: 'screen_lock_portrait',
}
const BLUETOOTH_ICON: SymbolViewProps['name'] = {
  ios: 'wave.3.right',
  android: 'bluetooth_audio',
  web: 'bluetooth_audio',
}
const SPEED_ICON: SymbolViewProps['name'] = {
  ios: 'gauge.with.dots.needle.67percent',
  android: 'speed',
  web: 'speed',
}
const LOCK_ICON: SymbolViewProps['name'] = {
  ios: 'lock.shield.fill',
  android: 'privacy_tip',
  web: 'privacy_tip',
}
const OFFLINE_ICON: SymbolViewProps['name'] = {
  ios: 'checkmark.icloud.fill',
  android: 'offline_pin',
  web: 'offline_pin',
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
})

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unable to reach your account.'
}
