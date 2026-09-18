import { NativeTabs } from 'expo-router/unstable-native-tabs'

import { useTheme } from '@/hooks/use-theme'

export default function AppTabs() {
  const theme = useTheme()

  return (
    <NativeTabs
      backgroundColor={theme.backgroundElement}
      indicatorColor={theme.accentSubtle}
      iconColor={{ default: theme.textSecondary, selected: theme.accent }}
      labelStyle={{
        default: {
          color: theme.textSecondary,
          fontSize: 12,
          fontWeight: '600',
        },
        selected: { color: theme.accent, fontSize: 12, fontWeight: '700' },
      }}
      shadowColor={theme.borderColor}
      disableTransparentOnScrollEdge
      sidebarAdaptable
    >
      <NativeTabs.Trigger name="index" disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
          md={{ default: 'library_music', selected: 'library_music' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="playlists" disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Label>Playlists</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'music.note.list', selected: 'music.note.list' }}
          md={{ default: 'queue_music', selected: 'queue_music' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore" disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'safari', selected: 'safari.fill' }}
          md={{ default: 'explore', selected: 'explore' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search" disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }}
          md={{ default: 'search', selected: 'search' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile" disableTransparentOnScrollEdge>
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'person.crop.circle',
            selected: 'person.crop.circle.fill',
          }}
          md={{ default: 'person', selected: 'person' }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
