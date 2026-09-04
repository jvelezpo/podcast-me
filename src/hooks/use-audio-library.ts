import { useCallback, useEffect, useRef, useState } from 'react';

import type { AudioItem } from '@/models/audio-item';
import {
  addMissingContentFingerprints,
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

export type AddAudioOutcome = {
  importedCount: number;
  duplicateItemId: string | null;
  duplicateItemIndex: number | null;
  duplicateNames: string[];
};

export type RemoveAudioOutcome = {
  removed: boolean;
  fileDeletionFailed: boolean;
};

export type AudioItemPlaybackUpdate = Partial<
  Pick<AudioItem, 'durationSeconds' | 'lastPositionSeconds'>
>;

export function useAudioLibrary() {
  const [items, setItems] = useState<LoadedAudioItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [importPhase, setImportPhase] = useState<AudioImportPhase>('idle');
  const [isMutating, setIsMutating] = useState(false);
  const [notice, setNotice] = useState<AudioLibraryNotice | null>(null);
  const itemsRef = useRef<LoadedAudioItem[]>([]);
  const importInProgress = useRef(false);
  const mutationInProgress = useRef(false);

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

  async function addAudio(): Promise<AddAudioOutcome> {
    const emptyOutcome: AddAudioOutcome = {
      importedCount: 0,
      duplicateItemId: null,
      duplicateItemIndex: null,
      duplicateNames: [],
    };

    if (isLoading || importInProgress.current || mutationInProgress.current) {
      return emptyOutcome;
    }

    importInProgress.current = true;
    setImportPhase('picking');
    setNotice(null);

    try {
      const result = await pickAndCopyAudioFiles(() => setImportPhase('importing'));

      if (result.canceled) {
        return emptyOutcome;
      }

      if (result.items.length === 0) {
        if (result.failures.length > 0) {
          setNotice({
            kind: 'warning',
            title: 'No files imported',
            message: formatImportFailures(result.failures),
          });
        }
        return emptyOutcome;
      }

      const previousItems = itemsRef.current;
      const availableItems = previousItems.filter((item) => item.isAvailable);
      const fingerprintResult = await addMissingContentFingerprints(availableItems);

      if (fingerprintResult.failedItemIds.length > 0) {
        const cleanupFailures = deleteImportedAudioFiles(result.items);
        setNotice({
          kind: 'error',
          title: 'Import not verified',
          message: cleanupFailures.length
            ? `The existing library could not be checked for duplicates, and these temporary copies could not be removed: ${cleanupFailures.join(', ')}.`
            : 'The existing library could not be checked for duplicates. No new files were added.',
        });
        return emptyOutcome;
      }

      const fingerprintedById = new Map(
        fingerprintResult.items.map((item) => [item.id, item] as const)
      );
      const fingerprintedPreviousItems = previousItems.map(
        (item) => fingerprintedById.get(item.id) ?? item
      );
      const itemByFingerprint = new Map<string, LoadedAudioItem>();

      for (const item of fingerprintedPreviousItems) {
        if (item.contentFingerprint) {
          itemByFingerprint.set(item.contentFingerprint, item);
        }
      }

      const importedItems: LoadedAudioItem[] = [];
      const duplicateItems: AudioItem[] = [];
      const duplicateNames: string[] = [];
      let duplicateItemId: string | null = null;

      for (const item of result.items) {
        const existingItem = item.contentFingerprint
          ? itemByFingerprint.get(item.contentFingerprint)
          : undefined;

        if (existingItem) {
          duplicateItems.push(item);
          duplicateNames.push(item.originalName);
          duplicateItemId ??= existingItem.id;
          continue;
        }

        const loadedItem: LoadedAudioItem = {
          ...item,
          isAvailable: true,
          unavailableReason: null,
        };
        importedItems.push(loadedItem);

        if (item.contentFingerprint) {
          itemByFingerprint.set(item.contentFingerprint, loadedItem);
        }
      }

      const duplicateCleanupFailures = deleteImportedAudioFiles(duplicateItems);
      const nextItems = [...fingerprintedPreviousItems, ...importedItems];

      itemsRef.current = nextItems;
      setItems(nextItems);

      try {
        await saveAudioLibrary(nextItems);
      } catch {
        itemsRef.current = previousItems;
        setItems(previousItems);

        const cleanupFailures = deleteImportedAudioFiles(importedItems);
        setNotice({
          kind: 'error',
          title: 'Import not saved',
          message: cleanupFailures.length
            ? `The library could not be saved. These copied files could not be removed: ${cleanupFailures.join(', ')}.`
            : 'The library could not be saved, so the new copied files were removed.',
        });
        return emptyOutcome;
      }

      if (duplicateCleanupFailures.length > 0) {
        setNotice({
          kind: 'warning',
          title: 'Duplicate copy cleanup failed',
          message: `These duplicate temporary copies could not be removed: ${duplicateCleanupFailures.join(', ')}.`,
        });
      } else if (result.failures.length > 0) {
        setNotice({
          kind: 'warning',
          title: 'Some files were not imported',
          message: formatImportFailures(result.failures),
        });
      }

      return {
        importedCount: importedItems.length,
        duplicateItemId,
        duplicateItemIndex:
          duplicateItemId === null
            ? null
            : nextItems.findIndex((item) => item.id === duplicateItemId),
        duplicateNames,
      };
    } catch {
      setNotice({
        kind: 'error',
        title: 'Import failed',
        message: 'The file picker or audio-library folder could not be opened.',
      });
      return emptyOutcome;
    } finally {
      importInProgress.current = false;
      setImportPhase('idle');
    }
  }

  const removeAudio = useCallback(async (
    itemId: string,
    beforeFileDeletion?: () => Promise<void>
  ): Promise<RemoveAudioOutcome> => {
    if (mutationInProgress.current || importInProgress.current) {
      return { removed: false, fileDeletionFailed: false };
    }

    const previousItems = itemsRef.current;
    const item = previousItems.find((candidate) => candidate.id === itemId);

    if (!item) {
      return { removed: false, fileDeletionFailed: false };
    }

    mutationInProgress.current = true;
    setIsMutating(true);
    setNotice(null);

    const nextItems = previousItems.filter((candidate) => candidate.id !== itemId);
    itemsRef.current = nextItems;
    setItems(nextItems);

    try {
      try {
        await saveAudioLibrary(nextItems);
      } catch {
        itemsRef.current = previousItems;
        setItems(previousItems);
        setNotice({
          kind: 'error',
          title: 'Audio not removed',
          message: 'The playlist could not be saved, so the audio file was kept.',
        });
        return { removed: false, fileDeletionFailed: false };
      }

      try {
        await beforeFileDeletion?.();
      } catch {
        itemsRef.current = previousItems;
        setItems(previousItems);
        await saveAudioLibrary(previousItems).catch(() => undefined);
        setNotice({
          kind: 'error',
          title: 'Audio not removed',
          message: 'Playback could not release this audio file. Stop playback and try again.',
        });
        return { removed: false, fileDeletionFailed: false };
      }

      const fileDeletionFailed = deleteImportedAudioFiles([item]).length > 0;

      if (fileDeletionFailed) {
        setNotice({
          kind: 'warning',
          title: 'Audio removed from playlist',
          message: 'The app-owned audio copy could not be deleted from storage.',
        });
      }

      return { removed: true, fileDeletionFailed };
    } finally {
      mutationInProgress.current = false;
      setIsMutating(false);
    }
  }, []);

  const reorderAudio = useCallback(async (itemId: string, offset: number): Promise<boolean> => {
    if (
      mutationInProgress.current ||
      importInProgress.current ||
      !Number.isInteger(offset) ||
      offset === 0
    ) {
      return false;
    }

    const previousItems = itemsRef.current;
    const fromIndex = previousItems.findIndex((item) => item.id === itemId);

    if (fromIndex < 0) {
      return false;
    }

    const toIndex = Math.max(0, Math.min(fromIndex + offset, previousItems.length - 1));

    if (toIndex === fromIndex) {
      return false;
    }

    const nextItems = [...previousItems];
    const [movedItem] = nextItems.splice(fromIndex, 1);
    nextItems.splice(toIndex, 0, movedItem);

    mutationInProgress.current = true;
    setIsMutating(true);
    itemsRef.current = nextItems;
    setItems(nextItems);

    try {
      await saveAudioLibrary(nextItems);
      return true;
    } catch {
      itemsRef.current = previousItems;
      setItems(previousItems);
      setNotice({
        kind: 'error',
        title: 'Order not saved',
        message: 'The previous playlist order was restored. Try again.',
      });
      return false;
    } finally {
      mutationInProgress.current = false;
      setIsMutating(false);
    }
  }, []);

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
    isMutating,
    notice,
    addAudio,
    removeAudio,
    reorderAudio,
    updateAudioItem,
    dismissNotice: () => setNotice(null),
  };
}

function formatImportFailures(failures: AudioImportFailure[]): string {
  return failures.map(({ originalName, reason }) => `${originalName}: ${reason}`).join('\n');
}
