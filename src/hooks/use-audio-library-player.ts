import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type {
  AudioItemPlaybackUpdate,
  AudioItemUpdateOptions,
} from '@/hooks/use-audio-library';
import type { LoadedAudioItem } from '@/services/audio-library-storage';
import {
  loadRememberedPlaybackRate,
  saveRememberedPlaybackRate,
} from '@/services/playback-rate-memory';
import { clampPlaybackRate, getShowKey } from '@/utils/playback-rate';
import { getAudioItemTitle } from '@/utils/audio-display';
import { stopAndroidAutoPlayback } from '../../modules/android-auto';

export type AudioPlaybackError = {
  itemId: string;
  message: string;
};

type UpdateAudioItem = (
  itemId: string,
  update: AudioItemPlaybackUpdate,
  options?: AudioItemUpdateOptions,
) => Promise<boolean>;

type PendingLoad = {
  requestId: number;
  item: LoadedAudioItem;
  sawUnloadedStatus: boolean;
  isStarting: boolean;
};

const CHECKPOINT_INTERVAL_MS = 5_000;

export function useAudioLibraryPlayer(
  updateAudioItem: UpdateAudioItem,
  isLibraryReady: boolean,
  onFinished?: (finishedItemId: string) => void,
  onUnexpectedPause?: () => void
) {
  // Native focus and route handling own recovery; delayed JS play() can override interruptions.
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
  const playbackRateRef = useRef(1);
  const onFinishedRef = useRef(onFinished);
  const onUnexpectedPauseRef = useRef(onUnexpectedPause);
  const playbackErrorRef = useRef<AudioPlaybackError | null>(null);
  /**
   * True while the latest pause came from our own code (pause, stop,
   * track switch, failure teardown). The unexpected-pause watcher consumes
   * it; anything else that stops playback is external (call, route change).
   */
  const internalPauseRef = useRef(false);
  const prevPlayingRef = useRef(false);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    onUnexpectedPauseRef.current = onUnexpectedPause;
  }, [onUnexpectedPause]);

  useEffect(() => {
    playbackErrorRef.current = playbackError;
  }, [playbackError]);

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
          title: getAudioItemTitle(item),
          artist: item.metadata.artist ?? 'Podcast Me',
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
    async (
      itemId: string,
      update: AudioItemPlaybackUpdate,
      options?: AudioItemUpdateOptions,
    ) => {
      if (activeItemRef.current?.id === itemId) {
        activeItemRef.current = { ...activeItemRef.current, ...update };
      }
      await updateAudioItem(itemId, update, options);
    },
    [updateAudioItem]
  );

  const failPlayback = useCallback(
    (itemId: string, message: string, requestId?: number) => {
      if (requestId !== undefined && requestId !== transitionSequence.current) {
        return;
      }

      pendingLoad.current = null;
      internalPauseRef.current = true;
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
      durationSeconds: number | null,
      options?: AudioItemUpdateOptions,
    ) => {
      const position = safePosition(positionSeconds, durationSeconds);

      if (activeItemRef.current?.id !== itemId || position === null) {
        return;
      }

      lastCheckpoint.current = { itemId, savedAt: Date.now() };
      await persistMetadata(itemId, { lastPositionSeconds: position }, options);
    },
    [persistMetadata]
  );

  const persistCurrentPosition = useCallback(
    async (itemId: string, options?: AudioItemUpdateOptions) => {
      const activeItem = activeItemRef.current;

      if (!activeItem || activeItem.id !== itemId || pendingLoad.current) {
        return;
      }

      const currentStatus = statusRef.current;
      const duration =
        finitePositive(currentStatus.duration) ?? activeItem.durationSeconds;

      await persistPosition(itemId, currentStatus.currentTime, duration, options);
    },
    [persistPosition]
  );

  const loadAndPlay = useCallback(
    async (item: LoadedAudioItem) => {
      const requestId = beginTransition();
      const previousItemId = activeItemRef.current?.id ?? null;
      setPlaybackError(null);

      try {
        stopAndroidAutoPlayback();
        await ensureAudioMode();
        internalPauseRef.current = true;
        player.pause();

        if (previousItemId && previousItemId !== item.id) {
          await persistCurrentPosition(previousItemId, { forcePersist: true });
        }

        if (requestId !== transitionSequence.current) {
          return;
        }

        activeItemRef.current = item;
        setActiveItemId(item.id);

        // Per-show memory: a returning show resumes at its own speed.
        const rememberedRate = await loadRememberedPlaybackRate(
          getShowKey(item.metadata)
        );

        if (requestId !== transitionSequence.current) {
          return;
        }

        playbackRateRef.current = rememberedRate;
        setPlaybackRateState(rememberedRate);

        const pending: PendingLoad = {
          requestId,
          item,
          sawUnloadedStatus: false,
          isStarting: false,
        };
        pendingLoad.current = pending;
        player.replace({ uri: item.localUri, name: getAudioItemTitle(item) });
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
      setPlaybackError(null);

      try {
        internalPauseRef.current = true;
        player.pause();
        await persistCurrentPosition(item.id, { forcePersist: true });

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
      setPlaybackError(null);

      try {
        stopAndroidAutoPlayback();
        await ensureAudioMode();
        internalPauseRef.current = false;
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
          await persistPosition(item.id, savedPosition, duration, { forcePersist: true });
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
    async (positionSeconds: number): Promise<void> => {
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

      try {
        await player.seekTo(targetPosition);

        if (requestId !== transitionSequence.current) {
          return;
        }

        await persistPosition(activeItem.id, targetPosition, duration, {
          forcePersist: true,
        });

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
        void seekTo(currentPosition + offsetSeconds);
      }
    },
    [seekTo]
  );

  const setPlaybackRate = useCallback(
    (rate: number, showKey?: string | null): void => {
      if (!Number.isFinite(rate)) {
        return;
      }

      const safeRate = clampPlaybackRate(rate);
      playbackRateRef.current = safeRate;
      player.setPlaybackRate(safeRate);
      setPlaybackRateState(safeRate);
      void saveRememberedPlaybackRate(
        showKey ?? getShowKey(activeItemRef.current?.metadata),
        safeRate
      );
    },
    [player]
  );

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // External pause detector (phone call, headphone/route change): playback
  // was going and stopped without our code pausing, finishing, failing, or
  // switching tracks. The context debounces this into an interruption toast.
  useEffect(() => {
    const wasPlaying = prevPlayingRef.current;
    prevPlayingRef.current = status.playing;

    if (status.playing) {
      // Fresh play: any pause marker that never met its stop is obsolete.
      internalPauseRef.current = false;
      return;
    }

    if (!wasPlaying) {
      return;
    }

    if (
      status.didJustFinish ||
      pendingLoad.current ||
      transitionInProgress.current ||
      playbackErrorRef.current !== null
    ) {
      internalPauseRef.current = false;
      return;
    }

    if (internalPauseRef.current) {
      internalPauseRef.current = false;
      return;
    }

    onUnexpectedPauseRef.current?.();
  }, [status.didJustFinish, status.playing]);

  useEffect(() => {
    void ensureAudioMode().catch(() => undefined);
  }, [ensureAudioMode]);

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
        void persistCurrentPosition(activeItem.id, { forcePersist: true });
      }
    });

    return () => {
      subscription.remove();

      const activeItem = activeItemRef.current;

      if (activeItem) {
        void persistCurrentPosition(activeItem.id, { forcePersist: true });
      }
    };
  }, [persistCurrentPosition]);

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

        await persistPosition(pending.item.id, savedPosition, duration, {
          forcePersist: true,
        });

        if (pendingLoad.current?.requestId !== pending.requestId) {
          return;
        }

        player.setPlaybackRate(playbackRateRef.current);
        activateLockScreenControls(pending.item);
        internalPauseRef.current = false;
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
      setPlaybackError(null);
      let didStopPlayer = false;

      try {
        internalPauseRef.current = true;
        player.pause();
        await persistCurrentPosition(itemId, { forcePersist: true });
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
    onFinishedRef.current?.(activeItem.id);
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

  /**
   * Stall retry: starts a fresh load for the current item, superseding any
   * stuck transition. This is the same load path toggle-playback uses when
   * playback errors or never became ready.
   */
  const retryPlayback = useCallback((): void => {
    const activeItem = activeItemRef.current;

    if (!activeItem) {
      return;
    }

    void loadAndPlay(activeItem);
  }, [loadAndPlay]);

  const setVolume = useCallback(
    (volume: number): void => {
      if (!Number.isFinite(volume)) {
        return;
      }

      player.volume = Math.min(Math.max(volume, 0), 1);
    },
    [player]
  );

  return useMemo(
    () => ({
      activeItemId,
      currentPositionSeconds: finiteNonNegative(status.currentTime),
      durationSeconds: status.isLoaded ? finitePositive(status.duration) : null,
      isBuffering: status.isBuffering,
      isPlaying: status.playing && playbackError === null,
      isReady: isLibraryReady,
      isTransitioning,
      playbackError,
      playbackRate,
      dismissPlayer,
      pausePlayback,
      removeActiveItem,
      resumePlayback,
      retryPlayback,
      seekBy,
      seekTo,
      setPlaybackRate,
      setVolume,
      togglePlayback,
    }),
    [
      activeItemId,
      dismissPlayer,
      isLibraryReady,
      isTransitioning,
      pausePlayback,
      playbackError,
      playbackRate,
      removeActiveItem,
      resumePlayback,
      retryPlayback,
      seekBy,
      seekTo,
      setPlaybackRate,
      setVolume,
      status.currentTime,
      status.duration,
      status.isBuffering,
      status.isLoaded,
      status.playing,
      togglePlayback,
    ],
  );
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
