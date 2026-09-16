import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

import type { PlaybackDevice } from '@/services/api'
import { createPlaybackUuid } from '@/services/playback-event'

const INSTALLATION_ID_KEY = 'podcast-me.playback-installation-id.v1'

let devicePromise: Promise<PlaybackDevice> | null = null

export function getPlaybackDevice(): Promise<PlaybackDevice> {
  if (!devicePromise) {
    devicePromise = loadPlaybackDevice()
  }

  return devicePromise
}

async function loadPlaybackDevice(): Promise<PlaybackDevice> {
  let id: string | null = null

  try {
    id = await AsyncStorage.getItem(INSTALLATION_ID_KEY)

    if (!id) {
      id = createPlaybackUuid()
      await AsyncStorage.setItem(INSTALLATION_ID_KEY, id)
    }
  } catch {
    id = createPlaybackUuid()
  }

  const appVersion = Constants.expoConfig?.version

  return {
    id,
    platform:
      Platform.OS === 'ios' ||
      Platform.OS === 'android' ||
      Platform.OS === 'web'
        ? Platform.OS
        : 'other',
    ...(appVersion ? { appVersion } : {}),
  }
}
