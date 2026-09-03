import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

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
    copyToCacheDirectory: true,
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

/** Removes only the app-owned copies represented by the supplied new items. */
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
