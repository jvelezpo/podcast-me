import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Session } from '@/services/api';

const AUTH_SESSION_KEY = 'podcast-me.auth-session.v1';

export async function loadSession(): Promise<Session | null> {
  const value = await getItem();

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as Session;
  } catch {
    await clearSession();
    return null;
  }
}

export function saveSession(session: Session): Promise<void> {
  return setItem(JSON.stringify(session));
}

export function clearSession(): Promise<void> {
  return removeItem();
}

function getItem(): Promise<string | null> {
  return Platform.OS === 'web'
    ? AsyncStorage.getItem(AUTH_SESSION_KEY)
    : SecureStore.getItemAsync(AUTH_SESSION_KEY);
}

function setItem(value: string): Promise<void> {
  return Platform.OS === 'web'
    ? AsyncStorage.setItem(AUTH_SESSION_KEY, value)
    : SecureStore.setItemAsync(AUTH_SESSION_KEY, value);
}

function removeItem(): Promise<void> {
  return Platform.OS === 'web'
    ? AsyncStorage.removeItem(AUTH_SESSION_KEY)
    : SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
}
