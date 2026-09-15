import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import {
  AUDIO_LIBRARY_STORAGE_KEY,
  EMPTY_AUDIO_METADATA,
  type AudioItem,
  type AudioMetadata,
} from '@/models/audio-item';
import {
  consumeAndroidAutoPlaybackUpdates,
  syncAndroidAutoLibrary,
  type AndroidAutoPlaybackUpdate,
} from '../../modules/android-auto';

export type LoadedAudioItem = AudioItem & {
  /** Runtime-only state; this value is not written to AsyncStorage. */
  isAvailable: boolean;
  /** Runtime-only explanation used to disable playback and guide recovery. */
  unavailableReason: 'missing' | 'unsupported' | null;
};

export type AudioLibraryLoadError = {
  kind: 'malformed-data' | 'read-failed';
  message: string;
};

export type AudioLibraryLoadResult = {
  items: LoadedAudioItem[];
  error: AudioLibraryLoadError | null;
};

let writeTail: Promise<void> = Promise.resolve();

/**
 * Loads persisted metadata and derives file availability without rejecting.
 * A screen can render the returned items and surface the optional error safely.
 */
export async function loadAudioLibrary(): Promise<AudioLibraryLoadResult> {
  await writeTail;

  let storedValue: string | null;

  try {
    storedValue = await AsyncStorage.getItem(AUDIO_LIBRARY_STORAGE_KEY);
  } catch {
    return {
      items: [],
      error: {
        kind: 'read-failed',
        message: 'The audio library could not be loaded. Try restarting the app.',
      },
    };
  }

  if (storedValue === null) {
    await syncAndroidAutoLibrary('[]');
    return { items: [], error: null };
  }

  const items = parseStoredAudioItems(storedValue);

  if (items === null) {
    return {
      items: [],
      error: {
        kind: 'malformed-data',
        message: 'Saved audio library data is invalid. Re-import the audio files to rebuild it.',
      },
    };
  }

  const reconciledItems = await mergeAndroidAutoPlaybackUpdates(items);
  const serializedItems = serializeAudioItems(reconciledItems);

  if (reconciledItems !== items) {
    await AsyncStorage.setItem(AUDIO_LIBRARY_STORAGE_KEY, serializedItems);
  }
  await syncAndroidAutoLibrary(serializedItems);

  return {
    items: reconciledItems.map((item) => {
      const unavailableReason = getUnavailableReason(item);

      return {
        ...item,
        isAvailable: unavailableReason === null,
        unavailableReason,
      };
    }),
    error: null,
  };
}

/**
 * Queues a snapshot after the caller has updated its in-memory UI state.
 * Calls are persisted in invocation order, and one failed write does not block the next.
 */
export function saveAudioLibrary(items: readonly AudioItem[]): Promise<void> {
  let serializedItems: string;

  try {
    serializedItems = serializeAudioItems(items);
  } catch (error) {
    return Promise.reject(error);
  }

  const write = writeTail.then(async () => {
    await AsyncStorage.setItem(AUDIO_LIBRARY_STORAGE_KEY, serializedItems);
    await syncAndroidAutoLibrary(serializedItems);
  });

  writeTail = write.catch(() => undefined);

  return write;
}

/** Applies positions saved by the native car player after the app returns to foreground. */
export async function refreshAudioLibraryFromAndroidAuto(
  items: readonly LoadedAudioItem[]
): Promise<LoadedAudioItem[]> {
  await writeTail;
  const reconciledItems = await mergeAndroidAutoPlaybackUpdates(items);

  if (reconciledItems === items) {
    return items as LoadedAudioItem[];
  }

  const serializedItems = serializeAudioItems(reconciledItems);
  await AsyncStorage.setItem(AUDIO_LIBRARY_STORAGE_KEY, serializedItems);
  await syncAndroidAutoLibrary(serializedItems);
  return reconciledItems;
}

async function mergeAndroidAutoPlaybackUpdates<T extends AudioItem>(
  items: readonly T[]
): Promise<T[]> {
  const updates = await consumeAndroidAutoPlaybackUpdates();
  const validUpdates = new Map(
    updates.filter(isAndroidAutoPlaybackUpdate).map((update) => [update.id, update])
  );

  if (validUpdates.size === 0) {
    return items as T[];
  }

  let didChange = false;
  const mergedItems = items.map((item) => {
    const update = validUpdates.get(item.id);

    if (!update) {
      return item;
    }

    if (update.updatedAtEpochMs < Date.parse(item.updatedAt)) {
      return item;
    }

    didChange = true;
    return {
      ...item,
      durationSeconds: update.durationSeconds ?? item.durationSeconds,
      lastPositionSeconds: update.lastPositionSeconds,
      isPlayed: item.isPlayed || update.isPlayed,
      updatedAt: new Date(update.updatedAtEpochMs).toISOString(),
    };
  });

  return didChange ? mergedItems : (items as T[]);
}

function isAndroidAutoPlaybackUpdate(
  update: AndroidAutoPlaybackUpdate
): update is AndroidAutoPlaybackUpdate {
  return (
    isNonEmptyString(update?.id) &&
    isNullableNonNegativeNumber(update.durationSeconds) &&
    isNonNegativeNumber(update.lastPositionSeconds) &&
    typeof update.isPlayed === 'boolean' &&
    isNonNegativeNumber(update.updatedAtEpochMs)
  );
}

function parseStoredAudioItems(storedValue: string): AudioItem[] | null {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    return null;
  }

  if (!Array.isArray(parsedValue) || !parsedValue.every(isAudioItem)) {
    return null;
  }

  const itemIds = new Set(parsedValue.map((item) => item.id));

  return itemIds.size === parsedValue.length ? parsedValue.map(toStoredAudioItem) : null;
}

function serializeAudioItems(items: readonly AudioItem[]): string {
  if (!items.every(isAudioItem)) {
    throw new TypeError('Cannot save invalid audio library data.');
  }

  return JSON.stringify(items.map(toStoredAudioItem));
}

function toStoredAudioItem(item: AudioItem): AudioItem {
  return {
    id: item.id,
    originalName: item.originalName,
    localUri: item.localUri,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    contentFingerprint: item.contentFingerprint ?? null,
    durationSeconds: item.durationSeconds,
    lastPositionSeconds: item.lastPositionSeconds,
    isPlayed: item.isPlayed ?? false,
    metadata: toStoredAudioMetadata(item.metadata),
    addedAt: item.addedAt,
    updatedAt: item.updatedAt,
  };
}

function isAudioItem(value: unknown): value is AudioItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;

  return (
    isNonEmptyString(item.id) &&
    isNonEmptyString(item.originalName) &&
    isNonEmptyString(item.localUri) &&
    isNullableString(item.mimeType) &&
    isNullableNonNegativeNumber(item.sizeBytes) &&
    isOptionalFingerprint(item.contentFingerprint) &&
    isNullableNonNegativeNumber(item.durationSeconds) &&
    isNonNegativeNumber(item.lastPositionSeconds) &&
    isOptionalBoolean(item.isPlayed) &&
    isOptionalAudioMetadata(item.metadata) &&
    isValidTimestamp(item.addedAt) &&
    isValidTimestamp(item.updatedAt)
  );
}

function toStoredAudioMetadata(metadata: AudioMetadata | undefined): AudioMetadata {
  return {
    title: toOptionalText(metadata?.title),
    artist: toOptionalText(metadata?.artist),
    album: toOptionalText(metadata?.album),
    releaseYear: toOptionalText(metadata?.releaseYear),
    genre: toOptionalText(metadata?.genre),
    coverArtUrl: toOptionalText(metadata?.coverArtUrl),
    description: toOptionalText(metadata?.description),
  };
}

function isOptionalAudioMetadata(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const metadata = value as Record<keyof AudioMetadata, unknown>;

  return Object.keys(EMPTY_AUDIO_METADATA).every((key) =>
    isOptionalNullableString(metadata[key as keyof AudioMetadata])
  );
}

function toOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isFileAvailable(localUri: string): boolean {
  try {
    return new File(localUri).exists;
  } catch {
    return false;
  }
}

function getUnavailableReason(item: AudioItem): LoadedAudioItem['unavailableReason'] {
  if (item.mimeType && !item.mimeType.toLowerCase().startsWith('audio/')) {
    return 'unsupported';
  }

  return isFileAvailable(item.localUri) ? null : 'missing';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isOptionalNullableString(
  value: unknown
): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isOptionalFingerprint(value: unknown): value is string | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && /^[a-fA-F0-9]{32}$/.test(value))
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
