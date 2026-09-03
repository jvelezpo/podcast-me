import { useCallback, useEffect, useRef, useState } from 'react';

import type { AudioItem } from '@/models/audio-item';
import {
  deleteImportedAudioFiles,
  pickAndCopyAudioFiles,
  type AudioImportFailure,
} from '@/services/audio-library-import';
import {
  loadAudioLibrary,
  saveAudioLibrary,
  type LoadedAudioItem,
} from '@/services/audio-library-storage';

export type AudioLibraryNotice = {
  kind: 'error' | 'warning';
  title: string;
  message: string;
};

export type AudioImportPhase = 'idle' | 'picking' | 'importing';

export type AudioItemPlaybackUpdate = Partial<
  Pick<AudioItem, 'durationSeconds' | 'lastPositionSeconds'>
>;

export function useAudioLibrary() {
  const [items, setItems] = useState<LoadedAudioItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [importPhase, setImportPhase] = useState<AudioImportPhase>('idle');
  const [notice, setNotice] = useState<AudioLibraryNotice | null>(null);
  const itemsRef = useRef<LoadedAudioItem[]>([]);
  const importInProgress = useRef(false);

  useEffect(() => {
    let isMounted = true;

    void loadAudioLibrary().then(({ items: loadedItems, error }) => {
      if (!isMounted) {
        return;
      }

      itemsRef.current = loadedItems;
      setItems(loadedItems);
      setIsLoading(false);

      if (error) {
        setNotice({
          kind: 'error',
          title: 'Audio library unavailable',
          message: error.message,
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function addAudio(): Promise<void> {
    if (isLoading || importInProgress.current) {
      return;
    }

    importInProgress.current = true;
    setImportPhase('picking');
    setNotice(null);

    try {
      const result = await pickAndCopyAudioFiles(() => setImportPhase('importing'));

      if (result.canceled) {
        return;
      }

      if (result.items.length === 0) {
        if (result.failures.length > 0) {
          setNotice({
            kind: 'warning',
            title: 'No files imported',
            message: formatImportFailures(result.failures),
          });
        }
        return;
      }

      const previousItems = itemsRef.current;
      const importedItems: LoadedAudioItem[] = result.items.map((item) => ({
        ...item,
        isAvailable: true,
        unavailableReason: null,
      }));
      const nextItems = [...previousItems, ...importedItems];

      itemsRef.current = nextItems;
      setItems(nextItems);

      try {
        await saveAudioLibrary(nextItems);
      } catch {
        itemsRef.current = previousItems;
        setItems(previousItems);

        const cleanupFailures = deleteImportedAudioFiles(result.items);
        setNotice({
          kind: 'error',
          title: 'Import not saved',
          message: cleanupFailures.length
            ? `The library could not be saved. These copied files could not be removed: ${cleanupFailures.join(', ')}.`
            : 'The library could not be saved, so the new copied files were removed.',
        });
        return;
      }

      if (result.failures.length > 0) {
        setNotice({
          kind: 'warning',
          title: 'Some files were not imported',
          message: formatImportFailures(result.failures),
        });
      }
    } catch {
      setNotice({
        kind: 'error',
        title: 'Import failed',
        message: 'The file picker or audio-library folder could not be opened.',
      });
    } finally {
      importInProgress.current = false;
      setImportPhase('idle');
    }
  }

  const updateAudioItem = useCallback(
    async (itemId: string, update: AudioItemPlaybackUpdate): Promise<boolean> => {
      const currentItem = itemsRef.current.find((item) => item.id === itemId);

      if (!currentItem) {
        return false;
      }

      const hasDurationChange =
        update.durationSeconds !== undefined &&
        update.durationSeconds !== currentItem.durationSeconds;
      const hasPositionChange =
        update.lastPositionSeconds !== undefined &&
        update.lastPositionSeconds !== currentItem.lastPositionSeconds;

      if (!hasDurationChange && !hasPositionChange) {
        return true;
      }

      const nextItems = itemsRef.current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              ...update,
              updatedAt: new Date().toISOString(),
            }
          : item
      );

      itemsRef.current = nextItems;
      setItems(nextItems);

      try {
        await saveAudioLibrary(nextItems);
        return true;
      } catch {
        setNotice({
          kind: 'warning',
          title: 'Playback progress not saved',
          message: 'Playback can continue, but the latest position or duration could not be saved.',
        });
        return false;
      }
    },
    []
  );

  return {
    items,
    isLoading,
    importPhase,
    notice,
    addAudio,
    updateAudioItem,
    dismissNotice: () => setNotice(null),
  };
}

function formatImportFailures(failures: AudioImportFailure[]): string {
  return failures.map(({ originalName, reason }) => `${originalName}: ${reason}`).join('\n');
}
