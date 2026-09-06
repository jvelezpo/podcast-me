import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { addBluetoothRouteChangeListener } from '../../modules/audio-route-monitor';
import type { AudioItemPlaybackUpdate } from '@/hooks/use-audio-library';
import type { LoadedAudioItem } from '@/services/audio-library-storage';

export type AudioPlaybackError = {
  itemId: string;
  message: string;
};

type UpdateAudioItem = (
  itemId: string,
  update: AudioItemPlaybackUpdate
) => Promise<boolean>;

type PendingLoad = {
  requestId: number;
  item: LoadedAudioItem;
  sawUnloadedStatus: boolean;
  isStarting: boolean;
};

const CHECKPOINT_INTERVAL_MS = 5_000;
const ROUTE_SETTLE_DELAY_MS = 600;

export function useAudioLibraryPlayer(
  updateAudioItem: UpdateAudioItem,
  isLibraryReady: boolean
) {
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [playbackError, setPlaybackError] = useState<AudioPlaybackError | null>(null);
  const activeItemRef = useRef<LoadedAudioItem | null>(null);
  const statusRef = useRef(status);
  const transitionInProgress = useRef(false);
  const transitionSequence = useRef(0);
  const pendingLoad = useRef<PendingLoad | null>(null);
  const lastCheckpoint = useRef<{ itemId: string; savedAt: number } | null>(null);
  const audioModePromise = useRef<Promise<void> | null>(null);
  const playbackRequested = useRef(false);
  const playbackRateRef = useRef(1);

  const finishTransition = useCallback(() => {
    transitionInProgress.current = false;
    setIsTransitioning(false);
  }, []);

  const beginTransition = useCallback(() => {
    transitionSequence.current += 1;
    transitionInProgress.current = true;
    setIsTransitioning(true);
    return transitionSequence.current;
  }, []);

  const ensureAudioMode = useCallback(() => {
    if (!audioModePromise.current) {
      audioModePromise.current = setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: 'doNotMix',
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false,
      }).catch((error) => {
        audioModePromise.current = null;
        throw error;
      });
    }

    return audioModePromise.current;
  }, []);

  const activateLockScreenControls = useCallback(
    (item: LoadedAudioItem) => {
      player.setActiveForLockScreen(
        true,
        {
          title: item.originalName,
          artist: 'Podcast Me',
        },
        {
          isLiveStream: false,
          showSeekBackward: true,
          showSeekForward: true,
        }
      );
    },
    [player]
  );

  const persistMetadata = useCallback(
    async (itemId: string, update: AudioItemPlaybackUpdate) => {
      if (activeItemRef.current?.id === itemId) {
        activeItemRef.current = { ...activeItemRef.current, ...update };
      }
      await updateAudioItem(itemId, update);
    },
    [updateAudioItem]
  );

  const failPlayback = useCallback(
    (itemId: string, message: string, requestId?: number) => {
      if (requestId !== undefined && requestId !== transitionSequence.current) {
        return;
      }

      pendingLoad.current = null;
      playbackRequested.current = false;
      try {
        player.pause();
        player.setActiveForLockScreen(false);
      } catch {
        // The native player may already be unavailable after a load failure.
      }
      finishTransition();
      setPlaybackError({ itemId, message });
    },
    [finishTransition, player]
  );

  const persistPosition = useCallback(
    async (
      itemId: string,
      positionSeconds: number,
      durationSeconds: number | null
    ) => {
      const position = safePosition(positionSeconds, durationSeconds);

      if (activeItemRef.current?.id !== itemId || position === null) {
        return;
      }

      lastCheckpoint.current = { itemId, savedAt: Date.now() };
      await persistMetadata(itemId, { lastPositionSeconds: position });
    },
    [persistMetadata]
  );

  const persistCurrentPosition = useCallback(
    async (itemId: string) => {
      const activeItem = activeItemRef.current;

      if (!activeItem || activeItem.id !== itemId || pendingLoad.current) {
        return;
      }

      const currentStatus = statusRef.current;
      const duration =
        finitePositive(currentStatus.duration) ?? activeItem.durationSeconds;

      await persistPosition(itemId, currentStatus.currentTime, duration);
    },
    [persistPosition]
  );

  const loadAndPlay = useCallback(
    async (item: LoadedAudioItem) => {
      const requestId = beginTransition();
      const previousItemId = activeItemRef.current?.id ?? null;
      playbackRequested.current = true;
      setPlaybackError(null);

      try {
        await ensureAudioMode();
        player.pause();

        if (previousItemId && previousItemId !== item.id) {
          await persistCurrentPosition(previousItemId);
        }

        if (requestId !== transitionSequence.current) {
          return;
        }

        activeItemRef.current = item;
        setActiveItemId(item.id);

        const pending: PendingLoad = {
          requestId,
          item,
          sawUnloadedStatus: false,
          isStarting: false,
        };
        pendingLoad.current = pending;
        player.replace({ uri: item.localUri, name: item.originalName });
        pending.sawUnloadedStatus = !player.isLoaded;
      } catch {
        failPlayback(
          item.id,
          'This recording could not be prepared. Re-import it or try again.',
          requestId
        );
      }
    },
    [beginTransition, ensureAudioMode, failPlayback, persistCurrentPosition, player]
  );

  const pausePlayback = useCallback(
    async (item: LoadedAudioItem) => {
      const requestId = beginTransition();
      playbackRequested.current = false;
      setPlaybackError(null);

      try {
        player.pause();
        await persistCurrentPosition(item.id);

        if (requestId === transitionSequence.current) {
          finishTransition();
        }
      } catch {
        failPlayback(item.id, 'Playback could not be paused safely. Try again.', requestId);
      }
    },
    [beginTransition, failPlayback, finishTransition, persistCurrentPosition, player]
  );

  const resumePlayback = useCallback(
    async (item: LoadedAudioItem) => {
      const requestId = beginTransition();
      playbackRequested.current = true;
      setPlaybackError(null);

      try {
        await ensureAudioMode();
        const currentStatus = statusRef.current;
        const activeItem = activeItemRef.current ?? item;
        const duration =
          finitePositive(currentStatus.duration) ?? activeItem.durationSeconds;
        const savedPosition = clampPosition(activeItem.lastPositionSeconds, duration);
        const currentPosition = clampPosition(
          finiteNonNegative(currentStatus.currentTime),
          duration
        );

        if (Math.abs(savedPosition - currentPosition) > 0.05) {
          await player.seekTo(savedPosition);
          await persistPosition(item.id, savedPosition, duration);
        }

        if (requestId !== transitionSequence.current) {
          return;
        }

        lastCheckpoint.current = { itemId: item.id, savedAt: Date.now() };
        player.setPlaybackRate(playbackRateRef.current);
        activateLockScreenControls(item);
        player.play();
        finishTransition();
      } catch {
        failPlayback(item.id, 'Playback could not resume. Try again.', requestId);
      }
    },
    [
      activateLockScreenControls,
      beginTransition,
      ensureAudioMode,
      failPlayback,
      finishTransition,
      persistPosition,
      player,
    ]
  );

  const seekTo = useCallback(
    (positionSeconds: number): void => {
      const activeItem = activeItemRef.current;
      const currentStatus = statusRef.current;

      if (
        !activeItem ||
        !currentStatus.isLoaded ||
        pendingLoad.current ||
        transitionInProgress.current
      ) {
        return;
      }

      const duration =
        finitePositive(currentStatus.duration) ?? activeItem.durationSeconds;

      if (!Number.isFinite(positionSeconds)) {
        return;
      }

      const targetPosition = clampPosition(Math.max(positionSeconds, 0), duration);

      const requestId = beginTransition();

      void (async () => {
        try {
          await player.seekTo(targetPosition);

          if (requestId !== transitionSequence.current) {
            return;
          }

          await persistPosition(activeItem.id, targetPosition, duration);

          if (requestId === transitionSequence.current) {
            finishTransition();
          }
        } catch {
          failPlayback(
            activeItem.id,
            'Playback could not move to the requested position. Try again.',
            requestId
          );
        }
      })();
    },
    [beginTransition, failPlayback, finishTransition, persistPosition, player]
  );

  const seekBy = useCallback(
    (offsetSeconds: number): void => {
      const activeItem = activeItemRef.current;

      if (!activeItem) {
        return;
      }

      const currentStatus = statusRef.current;
      const duration =
        finitePositive(currentStatus.duration) ?? activeItem.durationSeconds;
      const currentPosition = safePosition(currentStatus.currentTime, duration);

      if (currentPosition !== null) {
        seekTo(currentPosition + offsetSeconds);
      }
    },
    [seekTo]
  );

  const setPlaybackRate = useCallback(
    (rate: number): void => {
      if (!Number.isFinite(rate)) {
        return;
      }

      const safeRate = Math.min(Math.max(rate, 0.5), 2);
      playbackRateRef.current = safeRate;
      player.setPlaybackRate(safeRate);
      setPlaybackRateState(safeRate);
    },
    [player]
  );

  useEffect(() => {
    statusRef.current = status;

    if (
      status.isLoaded &&
      !pendingLoad.current &&
      !transitionInProgress.current
    ) {
      playbackRequested.current = status.playing;
    }
  }, [status]);

  useEffect(() => {
    void ensureAudioMode().catch(() => undefined);
  }, [ensureAudioMode]);

  useEffect(() => {
    const subscription = addBluetoothRouteChangeListener(() => {
      const activeItem = activeItemRef.current;

      if (
        !activeItem ||
        !statusRef.current.isLoaded ||
        !playbackRequested.current ||
        pendingLoad.current ||
        transitionInProgress.current
      ) {
        return;
      }

      const requestId = beginTransition();
      player.pause();

      void (async () => {
        try {
          await persistCurrentPosition(activeItem.id);
          await delay(ROUTE_SETTLE_DELAY_MS);

          if (
            requestId !== transitionSequence.current ||
            activeItemRef.current?.id !== activeItem.id ||
            !playbackRequested.current
          ) {
            return;
          }

          await ensureAudioMode();

          if (requestId !== transitionSequence.current) {
            return;
          }

          activateLockScreenControls(activeItem);
          player.play();
          finishTransition();
        } catch {
          failPlayback(
            activeItem.id,
            'Playback could not recover after the Bluetooth route changed. Try again.',
            requestId
          );
        }
      })();
    });

    return () => subscription.remove();
  }, [
    activateLockScreenControls,
    beginTransition,
    ensureAudioMode,
    failPlayback,
    finishTransition,
    persistCurrentPosition,
    player,
  ]);

  useEffect(() => {
    const activeItem = activeItemRef.current;

    if (!activeItem || !status.isLoaded || !status.playing || pendingLoad.current) {
      return;
    }

    const duration = finitePositive(status.duration) ?? activeItem.durationSeconds;
    const position = safePosition(status.currentTime, duration);

    if (position === null) {
      return;
    }

    activeItemRef.current = {
      ...activeItem,
      lastPositionSeconds: position,
    };

    const checkpoint = lastCheckpoint.current;
    const now = Date.now();

    if (
      checkpoint?.itemId === activeItem.id &&
      now - checkpoint.savedAt < CHECKPOINT_INTERVAL_MS
    ) {
      return;
    }

    lastCheckpoint.current = { itemId: activeItem.id, savedAt: now };
    void persistMetadata(activeItem.id, { lastPositionSeconds: position });
  }, [persistMetadata, status.currentTime, status.duration, status.isLoaded, status.playing]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'inactive' && nextState !== 'background') {
        return;
      }

      const activeItem = activeItemRef.current;

      if (activeItem) {
        void persistCurrentPosition(activeItem.id);
      }
    });

    return () => {
      subscription.remove();

      const activeItem = activeItemRef.current;

      if (activeItem) {
        void persistCurrentPosition(activeItem.id);
      }

      player.setActiveForLockScreen(false);
    };
  }, [persistCurrentPosition, player]);

  useEffect(() => {
    const pending = pendingLoad.current;

    if (!pending) {
      return;
    }

    if (!status.isLoaded) {
      pending.sawUnloadedStatus = true;
    }

    if (pending.sawUnloadedStatus && status.error) {
      failPlayback(
        pending.item.id,
        `Playback failed: ${status.error}`,
        pending.requestId
      );
      return;
    }

    if (!status.isLoaded || !pending.sawUnloadedStatus || pending.isStarting) {
      return;
    }

    pending.isStarting = true;
    const duration = finitePositive(status.duration);
    const savedPosition = clampPosition(pending.item.lastPositionSeconds, duration);

    void (async () => {
      try {
        await player.seekTo(savedPosition);

        if (pendingLoad.current?.requestId !== pending.requestId) {
          return;
        }

        await persistPosition(pending.item.id, savedPosition, duration);

        if (pendingLoad.current?.requestId !== pending.requestId) {
          return;
        }

        player.setPlaybackRate(playbackRateRef.current);
        activateLockScreenControls(pending.item);
        player.play();

        if (pendingLoad.current?.requestId !== pending.requestId) {
          return;
        }

        pendingLoad.current = null;
        finishTransition();
      } catch {
        failPlayback(
          pending.item.id,
          'This recording could not be started. Re-import it or try again.',
          pending.requestId
        );
      }
    })();
  }, [
    failPlayback,
    finishTransition,
    activateLockScreenControls,
    persistPosition,
    player,
    status.duration,
    status.error,
    status.isLoaded,
  ]);

  useEffect(() => {
    const activeItem = activeItemRef.current;
    const pending = pendingLoad.current;
    const duration = finitePositive(status.duration);

    if (
      !activeItem ||
      !status.isLoaded ||
      !duration ||
      (pending && !pending.sawUnloadedStatus) ||
      (activeItem.durationSeconds !== null &&
        Math.abs(activeItem.durationSeconds - duration) <= 0.01)
    ) {
      return;
    }

    void persistMetadata(activeItem.id, { durationSeconds: duration });
  }, [persistMetadata, status.duration, status.isLoaded]);

  useEffect(() => {
    const activeItem = activeItemRef.current;

    if (!status.error || !activeItem || pendingLoad.current) {
      return;
    }

    failPlayback(activeItem.id, `Playback failed: ${status.error}`);
  }, [failPlayback, status.error]);

  const removeActiveItem = useCallback(
    async (
      itemId: string,
      nextItem: LoadedAudioItem | null,
      shouldPlayNext: boolean
    ): Promise<boolean> => {
      if (activeItemRef.current?.id !== itemId || transitionInProgress.current) {
        return false;
      }

      const requestId = beginTransition();
      playbackRequested.current = false;
      setPlaybackError(null);
      let didStopPlayer = false;

      try {
        player.pause();
        await persistCurrentPosition(itemId);
      } catch {
        // Removal still has to stop playback even if its final checkpoint fails.
      } finally {
        if (requestId === transitionSequence.current) {
          pendingLoad.current = null;
          try {
            player.setActiveForLockScreen(false);
            // `useAudioPlayer` owns this player. Android's native `replace` method
            // requires an AudioSource, so `replace(null)` cannot clear it safely.
            // The next load replaces the retained paused source.
            didStopPlayer = true;
          } catch {
            setPlaybackError({
              itemId,
              message: 'Playback could not stop this recording. Try again.',
            });
          }

          if (didStopPlayer) {
            activeItemRef.current = null;
            lastCheckpoint.current = null;
            setActiveItemId(null);
          }
          finishTransition();
        }
      }

      if (requestId !== transitionSequence.current || !didStopPlayer) {
        return false;
      }

      if (shouldPlayNext && nextItem) {
        await loadAndPlay(nextItem);
      }

      return true;
    },
    [beginTransition, finishTransition, loadAndPlay, persistCurrentPosition, player]
  );

  useEffect(() => {
    const activeItem = activeItemRef.current;

    if (!status.didJustFinish || !activeItem || pendingLoad.current) {
      return;
    }

    transitionSequence.current += 1;
    finishTransition();
    lastCheckpoint.current = null;
    playbackRequested.current = false;
    activeItemRef.current = null;
    player.setActiveForLockScreen(false);
    setActiveItemId(null);
    setPlaybackError(null);

    const duration = finitePositive(status.duration);
    void updateAudioItem(activeItem.id, {
      lastPositionSeconds: 0,
      isPlayed: true,
      ...(duration === null ? {} : { durationSeconds: duration }),
    });
  }, [finishTransition, player, status.didJustFinish, status.duration, updateAudioItem]);

  const togglePlayback = useCallback(
    (item: LoadedAudioItem): void => {
      if (!isLibraryReady || !item.isAvailable || transitionInProgress.current) {
        return;
      }

      const currentStatus = statusRef.current;
      const isRetry = playbackError?.itemId === item.id;

      if (activeItemRef.current?.id !== item.id || isRetry || !currentStatus.isLoaded) {
        void loadAndPlay(item);
        return;
      }

      if (currentStatus.playing) {
        void pausePlayback(item);
      } else {
        void resumePlayback(item);
      }
    },
    [isLibraryReady, loadAndPlay, pausePlayback, playbackError?.itemId, resumePlayback]
  );

  const dismissPlayer = useCallback(async (): Promise<boolean> => {
    const itemId = activeItemRef.current?.id;

    if (!itemId) {
      return false;
    }

    return removeActiveItem(itemId, null, false);
  }, [removeActiveItem]);

  return {
    activeItemId,
    currentPositionSeconds: finiteNonNegative(status.currentTime),
    durationSeconds: status.isLoaded ? finitePositive(status.duration) : null,
    isPlaying: status.playing && playbackError === null,
    isReady: isLibraryReady,
    isTransitioning,
    playbackError,
    playbackRate,
    dismissPlayer,
    pausePlayback,
    removeActiveItem,
    seekBy,
    seekTo,
    setPlaybackRate,
    togglePlayback,
  };
}

function finiteNonNegative(value: number): number {
  return safePosition(value, null) ?? 0;
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function clampPosition(positionSeconds: number, durationSeconds: number | null): number {
  return safePosition(positionSeconds, durationSeconds) ?? 0;
}

function safePosition(positionSeconds: number, durationSeconds: number | null): number | null {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return null;
  }

  return durationSeconds === null ? positionSeconds : Math.min(positionSeconds, durationSeconds);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
