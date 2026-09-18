import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PLAYLIST_STORAGE_KEY,
  isPlaylistAudioRef,
  type Playlist,
} from '@/models/playlist';

export type PlaylistLoadError = {
  kind: 'malformed-data' | 'read-failed';
  message: string;
};

export type PlaylistLoadResult = {
  playlists: Playlist[];
  error: PlaylistLoadError | null;
};

let writeTail: Promise<void> = Promise.resolve();

/** Loads persisted playlists without rejecting; screens render the result safely. */
export async function loadPlaylists(): Promise<PlaylistLoadResult> {
  await writeTail;

  let storedValue: string | null;

  try {
    storedValue = await AsyncStorage.getItem(PLAYLIST_STORAGE_KEY);
  } catch {
    return {
      playlists: [],
      error: {
        kind: 'read-failed',
        message: 'Playlists could not be loaded. Try restarting the app.',
      },
    };
  }

  if (storedValue === null) {
    return { playlists: [], error: null };
  }

  const playlists = parseStoredPlaylists(storedValue);

  if (playlists === null) {
    return {
      playlists: [],
      error: {
        kind: 'malformed-data',
        message: 'Saved playlist data is invalid. Create your playlists again.',
      },
    };
  }

  return { playlists, error: null };
}

/**
 * Queues a snapshot after the caller has updated its in-memory UI state.
 * Calls persist in invocation order; one failed write never blocks the next.
 */
export function savePlaylists(playlists: readonly Playlist[]): Promise<void> {
  let serialized: string;

  try {
    serialized = serializePlaylists(playlists);
  } catch (error) {
    return Promise.reject(error);
  }

  const write = writeTail.then(async () => {
    await AsyncStorage.setItem(PLAYLIST_STORAGE_KEY, serialized);
  });

  writeTail = write.catch(() => undefined);

  return write;
}

function parseStoredPlaylists(storedValue: string): Playlist[] | null {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    return null;
  }

  if (!Array.isArray(parsedValue) || !parsedValue.every(isPlaylist)) {
    return null;
  }

  const ids = new Set(parsedValue.map((playlist) => playlist.id));

  if (ids.size !== parsedValue.length) {
    return null;
  }

  return parsedValue.map(toStoredPlaylist);
}

function serializePlaylists(playlists: readonly Playlist[]): string {
  if (!playlists.every(isPlaylist)) {
    throw new TypeError('Cannot save invalid playlist data.');
  }

  return JSON.stringify(playlists.map(toStoredPlaylist));
}

function toStoredPlaylist(playlist: Playlist): Playlist {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description ?? null,
    items: playlist.items.map((ref) => ({ kind: ref.kind, audioId: ref.audioId })),
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

function isPlaylist(value: unknown): value is Playlist {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const playlist = value as Record<string, unknown>;

  return (
    isNonEmptyString(playlist.id) &&
    isNonEmptyString(playlist.name) &&
    (playlist.description === null ||
      playlist.description === undefined ||
      typeof playlist.description === 'string') &&
    Array.isArray(playlist.items) &&
    playlist.items.every(isPlaylistAudioRef) &&
    hasUniqueRefs(playlist.items as Playlist['items']) &&
    isValidTimestamp(playlist.createdAt) &&
    isValidTimestamp(playlist.updatedAt)
  );
}

function hasUniqueRefs(items: readonly { kind: string; audioId: string }[]): boolean {
  const keys = items.map((ref) => `${ref.kind}:${ref.audioId}`);
  return new Set(keys).size === keys.length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
