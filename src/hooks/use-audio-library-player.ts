import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LoadedAudioItem } from '@/services/audio-library-storage';

export type AudioPlaybackError = {
  itemId: string;
  message: string;
};

type PendingLoad = {
  itemId: string;
  sawUnloadedStatus: boolean;
};

export function useAudioLibraryPlayer() {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [playbackError, setPlaybackError] = useState<AudioPlaybackError | null>(null);
  const activeItemIdRef = useRef<string | null>(null);
  const transitionInProgress = useRef(false);
  const pendingLoad = useRef<PendingLoad | null>(null);

  const finishTransition = useCallback(() => {
    transitionInProgress.current = false;
    setIsTransitioning(false);
  }, []);

  const loadAndPlay = useCallback(
    (item: LoadedAudioItem) => {
      transitionInProgress.current = true;
      setIsTransitioning(true);
      setPlaybackError(null);

      try {
        player.pause();
        activeItemIdRef.current = item.id;
        setActiveItemId(item.id);
        pendingLoad.current = { itemId: item.id, sawUnloadedStatus: false };
        player.replace(item.localUri);
        pendingLoad.current.sawUnloadedStatus = !player.isLoaded;
        player.play();
      } catch {
        pendingLoad.current = null;
        finishTransition();
        setPlaybackError({
          itemId: item.id,
          message: 'This recording could not be prepared. Re-import it or try again.',
        });
      }
    },
    [finishTransition, player]
  );

  useEffect(() => {
    const pending = pendingLoad.current;

    if (status.error && activeItemIdRef.current) {
      pendingLoad.current = null;
      finishTransition();
      setPlaybackError({ itemId: activeItemIdRef.current, message: status.error });
      return;
    }

    if (!pending) {
      return;
    }

    if (!status.isLoaded) {
      pending.sawUnloadedStatus = true;
      return;
    }

    if (
      pending.itemId !== activeItemIdRef.current ||
      (!pending.sawUnloadedStatus && !status.playing)
    ) {
      return;
    }

    pendingLoad.current = null;
    finishTransition();
  }, [finishTransition, status.error, status.isLoaded, status.playing]);

  function togglePlayback(item: LoadedAudioItem): void {
    if (!item.isAvailable) {
      setPlaybackError({
        itemId: item.id,
        message: 'This file is missing. Re-import the recording to play it.',
      });
      return;
    }

    if (transitionInProgress.current) {
      return;
    }

    if (activeItemIdRef.current !== item.id || playbackError || !status.isLoaded) {
      loadAndPlay(item);
      return;
    }

    setPlaybackError(null);

    try {
      if (status.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch {
      setPlaybackError({
        itemId: item.id,
        message: 'Playback failed. Re-import the recording or try again.',
      });
    }
  }

  return {
    activeItemId,
    currentPositionSeconds: finiteNonNegative(status.currentTime),
    durationSeconds: status.isLoaded ? finitePositive(status.duration) : null,
    isPlaying: status.playing,
    isTransitioning,
    playbackError,
    togglePlayback,
  };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}
