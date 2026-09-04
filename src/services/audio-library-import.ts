import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { getInfoAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import {
  createAudioItemId,
  createAudioLibraryFilename,
  type AudioItem,
} from '@/models/audio-item';

export type AudioImportFailure = {
  originalName: string;
  reason: string;
};

export type AudioImportResult =
  | { canceled: true; items: []; failures: [] }
  | { canceled: false; items: AudioItem[]; failures: AudioImportFailure[] };

const AUDIO_LIBRARY_DIRECTORY_NAME = 'audio-library';

/** Opens the native picker and copies each valid selection into app-owned storage. */
export async function pickAndCopyAudioFiles(
  onSelection?: () => void
): Promise<AudioImportResult> {
  const pickerResult = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    multiple: true,
    // Expo Go's Android cache is outside the experience-scoped FileSystem sandbox.
    // Copy directly from the picker-granted content URI there; iOS still needs a cache copy.
    copyToCacheDirectory: Platform.OS !== 'android',
  });

  if (pickerResult.canceled) {
    return { canceled: true, items: [], failures: [] };
  }

  onSelection?.();

  const libraryDirectory = new Directory(Paths.document, AUDIO_LIBRARY_DIRECTORY_NAME);
  libraryDirectory.create({ idempotent: true, intermediates: true });

  const items: AudioItem[] = [];
  const failures: AudioImportFailure[] = [];

  for (const asset of pickerResult.assets) {
    const mimeType = asset.mimeType?.trim() || null;

    if (mimeType && !mimeType.toLowerCase().startsWith('audio/')) {
      failures.push({
        originalName: asset.name,
        reason: 'The selected file is not audio.',
      });
      continue;
    }

    let destination: File | null = null;

    try {
      const id = createAudioItemId();
      destination = new File(
        libraryDirectory,
        createAudioLibraryFilename(id, asset.name)
      );
      const source = new File(asset.uri);
      await source.copy(destination);

      if (!destination.exists) {
        throw new Error('The copied file is unavailable.');
      }

      const contentFingerprint = await getAudioContentFingerprint(destination.uri);

      const timestamp = new Date().toISOString();

      items.push({
        id,
        originalName: asset.name,
        localUri: destination.uri,
        mimeType: (mimeType ?? destination.type) || null,
        sizeBytes:
          typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size >= 0
            ? asset.size
            : destination.size,
        contentFingerprint,
        durationSeconds: null,
        lastPositionSeconds: 0,
        addedAt: timestamp,
        updatedAt: timestamp,
      });
    } catch {
      if (destination) {
        tryDeleteFile(destination);
      }
      failures.push({
        originalName: asset.name,
        reason: 'The file could not be copied.',
      });
    }
  }

  return { canceled: false, items, failures };
}

/** Adds fingerprints to records created before duplicate protection was introduced. */
export async function addMissingContentFingerprints<T extends AudioItem>(
  items: readonly T[]
): Promise<{ items: T[]; failedItemIds: string[] }> {
  const fingerprintedItems: T[] = [];
  const failedItemIds: string[] = [];

  for (const item of items) {
    if (item.contentFingerprint) {
      fingerprintedItems.push(item);
      continue;
    }

    try {
      const contentFingerprint = await getAudioContentFingerprint(item.localUri);
      fingerprintedItems.push({ ...item, contentFingerprint });
    } catch {
      fingerprintedItems.push(item);
      failedItemIds.push(item.id);
    }
  }

  return { items: fingerprintedItems, failedItemIds };
}

/** Removes only the app-owned copies represented by the supplied items. */
export function deleteImportedAudioFiles(items: readonly AudioItem[]): string[] {
  const failedDeletions: string[] = [];

  for (const item of items) {
    try {
      if (!tryDeleteFile(new File(item.localUri))) {
        failedDeletions.push(item.originalName);
      }
    } catch {
      failedDeletions.push(item.originalName);
    }
  }

  return failedDeletions;
}

function tryDeleteFile(file: File): boolean {
  try {
    if (file.exists) {
      file.delete();
    }
    return true;
  } catch {
    return false;
  }
}

async function getAudioContentFingerprint(fileUri: string): Promise<string> {
  const info = await getInfoAsync(fileUri, { md5: true });

  if (!info.exists || !info.md5) {
    throw new Error('The copied file could not be fingerprinted.');
  }

  return info.md5.toLowerCase();
}
