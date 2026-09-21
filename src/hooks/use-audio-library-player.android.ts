import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import type {
  AudioItemPlaybackUpdate,
  AudioItemUpdateOptions,
} from "@/hooks/use-audio-library";
import type { LoadedAudioItem } from "@/services/audio-library-storage";
import { parseRemoteMediaId } from "@/services/android-auto-remote-sync";
import {
  dismissAndroidAutoPlayback,
  getAndroidAutoPlaybackState,
  observeAndroidAutoPlaybackState,
  pauseAndroidAutoPlayback,
  prepareAndroidAutoItem,
  playAndroidAutoItem,
  seekAndroidAutoPlayback,
  setAndroidAutoPlaybackRate,
  setAndroidAutoVolume,
  type AndroidAutoPlaybackState,
} from "../../modules/android-auto";

export type AudioPlaybackError = {
  itemId: string;
  message: string;
};

type UpdateAudioItem = (
  itemId: string,
  update: AudioItemPlaybackUpdate,
  options?: AudioItemUpdateOptions,
) => Promise<boolean>;

const CHECKPOINT_INTERVAL_MS = 5_000;
/**
 * Service pushes state every 500 ms while playing. Position-only ticks must
 * not re-render JS: skip `setState` when the push carries no meaningful
 * change (same mediaId/isPlaying/error/rate/loaded/ended and <1 s move).
 */
const POSITION_DEDUP_TOLERANCE_SECONDS = 1;
const INITIAL_STATE: AndroidAutoPlaybackState = {
  serviceReady: false,
  mediaId: null,
  currentPositionSeconds: 0,
  durationSeconds: null,
  isPlaying: false,
  isLoaded: false,
  isEnded: false,
  playbackRate: 1,
  error: null,
};

export function useAudioLibraryPlayer(
  updateAudioItem: UpdateAudioItem,
  isLibraryReady: boolean,
  onFinished?: (finishedItemId: string) => void,
) {
  const [status, setStatus] = useState(INITIAL_STATE);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [playbackError, setPlaybackError] = useState<AudioPlaybackError | null>(
    null,
  );
  const statusRef = useRef(status);
  const renderedStatusRef = useRef(status);
  const transitionSequence = useRef(0);
  const lastCheckpoint = useRef<{ itemId: string; savedAt: number } | null>(
    null,
  );
  const completedItemId = useRef<string | null>(null);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const applyPlaybackState = useCallback(
    (nextState: AndroidAutoPlaybackState) => {
      statusRef.current = nextState;

      // Keep the live ref fresh for persistence, but compare with the last
      // UI state. Comparing each 500 ms tick with the preceding tick would
      // keep every delta below the one-second threshold forever.
      if (isPlaybackStateEquivalent(renderedStatusRef.current, nextState)) {
        return;
      }

      renderedStatusRef.current = nextState;
      setStatus(nextState);
      setIsTransitioning(false);

      if (nextState.error && nextState.mediaId) {
        setPlaybackError({
          itemId: nextState.mediaId,
          message: nextState.error,
        });
      } else {
        setPlaybackError(null);
      }
    },
    [],
  );

  useEffect(() => {
    let isMounted = true;
    let stateRevision = 0;
    const subscription = observeAndroidAutoPlaybackState((nextState) => {
      if (isMounted) {
        stateRevision += 1;
        applyPlaybackState(nextState);
      }
    });

    const refreshPlaybackState = () => {
      const revision = stateRevision;
      void getAndroidAutoPlaybackState().then((nextState) => {
        // A service restart can publish a newer ready event before this resolves.
        if (isMounted && revision === stateRevision) {
          applyPlaybackState(nextState);
        }
      });
    };
    refreshPlaybackState();
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        refreshPlaybackState();
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [applyPlaybackState]);

  const beginTransition = useCallback(() => {
    transitionSequence.current += 1;
    setIsTransitioning(true);
    setPlaybackError(null);
    return transitionSequence.current;
  }, []);

  const finishTransition = useCallback((requestId: number) => {
    if (requestId === transitionSequence.current) {
      setIsTransitioning(false);
    }
  }, []);

  const failPlayback = useCallback(
    (itemId: string, message: string, requestId: number) => {
      if (requestId === transitionSequence.current) {
        setIsTransitioning(false);
        setPlaybackError({ itemId, message });
      }
    },
    [],
  );

  const persistState = useCallback(
    async (
      itemId: string,
      markPlayed = false,
      options?: AudioItemUpdateOptions,
    ) => {
      const current = statusRef.current;
      // Remote (`remote:<id>`) media is owned by the remote hook; persisting
      // it as a library item would write progress against a phantom id.
      if (current.mediaId !== itemId || parseRemoteMediaId(itemId) !== null) {
        return;
      }

      await updateAudioItem(
        itemId,
        {
          lastPositionSeconds: markPlayed ? 0 : current.currentPositionSeconds,
          ...(current.durationSeconds === null
            ? {}
            : { durationSeconds: current.durationSeconds }),
          ...(markPlayed ? { isPlayed: true } : {}),
        },
        options,
      );
    },
    [updateAudioItem],
  );

  useEffect(() => {
    const itemId = status.mediaId;
    if (!itemId || !status.isPlaying) {
      return;
    }

    const now = Date.now();
    const checkpoint = lastCheckpoint.current;
    if (
      checkpoint?.itemId === itemId &&
      now - checkpoint.savedAt < CHECKPOINT_INTERVAL_MS
    ) {
      return;
    }

    lastCheckpoint.current = { itemId, savedAt: now };
    void persistState(itemId);
  }, [
    persistState,
    status.currentPositionSeconds,
    status.isPlaying,
    status.mediaId,
  ]);

  useEffect(() => {
    const itemId = status.mediaId;
    if (!itemId || !status.isEnded || completedItemId.current === itemId) {
      if (!status.isEnded) {
        completedItemId.current = null;
      }
      return;
    }

    completedItemId.current = itemId;
    void persistState(itemId, true);
    onFinishedRef.current?.(itemId);
  }, [persistState, status.isEnded, status.mediaId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const itemId = statusRef.current.mediaId;
      if ((nextState === "inactive" || nextState === "background") && itemId) {
        void persistState(itemId, false, { forcePersist: true });
      }
    });

    return () => subscription.remove();
  }, [persistState]);

  const lastItemRef = useRef<LoadedAudioItem | null>(null);

  const loadAndPlay = useCallback(
    async (item: LoadedAudioItem, shouldPlay = true) => {
      const requestId = beginTransition();
      lastItemRef.current = item;
      try {
        const didLoad = await (shouldPlay
          ? playAndroidAutoItem(
              item.id,
              item.lastPositionSeconds,
              statusRef.current.playbackRate,
            )
          : prepareAndroidAutoItem(
              item.id,
              item.lastPositionSeconds,
              statusRef.current.playbackRate,
            ));
        if (!didLoad) {
          failPlayback(
            item.id,
            "This recording could not be prepared. Re-import it or try again.",
            requestId,
          );
          return;
        }
        finishTransition(requestId);
      } catch {
        failPlayback(
          item.id,
          "This recording could not be prepared. Re-import it or try again.",
          requestId,
        );
      }
    },
    [beginTransition, failPlayback, finishTransition],
  );

  /**
   * Stall retry: a fresh load for the current local item through the same
   * path toggle-playback uses. The generic hook owns this method on other
   * platforms; without it the stall Retry button crashes on Android.
   */
  const retryPlayback = useCallback((): void => {
    const item = lastItemRef.current;

    if (
      !item ||
      statusRef.current.mediaId !== item.id ||
      parseRemoteMediaId(item.id) !== null
    ) {
      return;
    }

    void loadAndPlay(item);
  }, [loadAndPlay]);

  const pausePlayback = useCallback(
    async (item: LoadedAudioItem) => {
      const requestId = beginTransition();
      try {
        if (!(await pauseAndroidAutoPlayback())) {
          failPlayback(
            item.id,
            "Playback could not be paused safely. Try again.",
            requestId,
          );
          return;
        }
        await persistState(item.id, false, { forcePersist: true });
        finishTransition(requestId);
      } catch {
        failPlayback(
          item.id,
          "Playback could not be paused safely. Try again.",
          requestId,
        );
      }
    },
    [beginTransition, failPlayback, finishTransition, persistState],
  );

  const resumePlayback = useCallback(
    async (item: LoadedAudioItem) => {
      const requestId = beginTransition();
      const current = statusRef.current;
      try {
        const didPlay = await playAndroidAutoItem(
          item.id,
          current.mediaId === item.id
            ? current.currentPositionSeconds
            : item.lastPositionSeconds,
          current.playbackRate,
        );
        if (!didPlay) {
          failPlayback(
            item.id,
            "Playback could not resume. Try again.",
            requestId,
          );
          return;
        }
        finishTransition(requestId);
      } catch {
        failPlayback(
          item.id,
          "Playback could not resume. Try again.",
          requestId,
        );
      }
    },
    [beginTransition, failPlayback, finishTransition],
  );

  const seekTo = useCallback(
    async (positionSeconds: number) => {
      const current = statusRef.current;
      const itemId = current.mediaId;
      if (!itemId || !Number.isFinite(positionSeconds)) {
        return;
      }

      const target = clampPosition(
        Math.max(0, positionSeconds),
        current.durationSeconds,
      );
      const requestId = beginTransition();
      setStatus((previous) => {
        const nextState = {
          ...previous,
          currentPositionSeconds: target,
        };
        statusRef.current = nextState;
        renderedStatusRef.current = nextState;
        return nextState;
      });

      try {
        if (!(await seekAndroidAutoPlayback(target))) {
          failPlayback(
            itemId,
            "Playback could not move to the requested position. Try again.",
            requestId,
          );
          return;
        }
        await updateAudioItem(
          itemId,
          { lastPositionSeconds: target },
          { forcePersist: true },
        );
        finishTransition(requestId);
      } catch {
        failPlayback(
          itemId,
          "Playback could not move to the requested position. Try again.",
          requestId,
        );
      }
    },
    [beginTransition, failPlayback, finishTransition, updateAudioItem],
  );

  const seekBy = useCallback(
    (offsetSeconds: number) => {
      const current = statusRef.current;
      void seekTo(current.currentPositionSeconds + offsetSeconds);
    },
    [seekTo],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    if (!Number.isFinite(rate)) {
      return;
    }

    const safeRate = Math.min(Math.max(rate, 0.5), 2);
    setStatus((previous) => {
      const nextState = { ...previous, playbackRate: safeRate };
      statusRef.current = nextState;
      renderedStatusRef.current = nextState;
      return nextState;
    });
    void setAndroidAutoPlaybackRate(safeRate).then((didUpdate) => {
      if (!didUpdate && statusRef.current.mediaId) {
        setPlaybackError({
          itemId: statusRef.current.mediaId,
          message: "Playback speed could not be changed. Try again.",
        });
      }
    });
  }, []);

  /**
   * Volume for the shared engine (sleep fade-out). The generic hook owns
   * this method on other platforms; without it GlobalPlayer's fade would
   * crash on Android with "setVolume is not a function".
   */
  const setVolume = useCallback((volume: number) => {
    if (!Number.isFinite(volume)) {
      return;
    }

    void setAndroidAutoVolume(Math.min(Math.max(volume, 0), 1));
  }, []);

  const removeActiveItem = useCallback(
    async (
      itemId: string,
      nextItem: LoadedAudioItem | null,
      shouldPlayNext: boolean,
    ): Promise<boolean> => {
      const currentId = statusRef.current.mediaId;
      // Remote (`remote:<id>`) owns the shared engine: there is no local
      // item to dismiss, so report success without touching the engine —
      // dismissing here would wipe the car/device remote playback.
      if (currentId !== null && parseRemoteMediaId(currentId) !== null) {
        return true;
      }
      if (currentId !== null && currentId !== itemId) {
        return false;
      }

      if (currentId === itemId) {
        await persistState(itemId, false, { forcePersist: true });
        if (!(await dismissAndroidAutoPlayback())) {
          return false;
        }
      }

      if (shouldPlayNext && nextItem) {
        await loadAndPlay(nextItem);
      }
      return true;
    },
    [loadAndPlay, persistState],
  );

  const dismissPlayer = useCallback(async () => {
    const itemId = statusRef.current.mediaId;
    if (!itemId) {
      return false;
    }
    return removeActiveItem(itemId, null, false);
  }, [removeActiveItem]);

  const togglePlayback = useCallback(
    (item: LoadedAudioItem) => {
      if (
        !isLibraryReady ||
        !statusRef.current.serviceReady ||
        !item.isAvailable ||
        isTransitioning
      ) {
        return;
      }

      const current = statusRef.current;
      if (current.mediaId !== item.id || !current.isLoaded) {
        void loadAndPlay(item);
      } else if (current.isPlaying) {
        void pausePlayback(item);
      } else {
        void resumePlayback(item);
      }
    },
    [
      isLibraryReady,
      isTransitioning,
      loadAndPlay,
      pausePlayback,
      resumePlayback,
    ],
  );

  const loadPaused = useCallback(
    (item: LoadedAudioItem): void => {
      if (!isLibraryReady || !item.isAvailable || isTransitioning) {
        return;
      }

      void loadAndPlay(item, false);
    },
    [isLibraryReady, isTransitioning, loadAndPlay],
  );

  // Remote (`remote:<id>`) media on the shared engine is owned by the
  // remote hook: report no local item (and not local-playing) so the local
  // surfaces, queue kind, and Up-next stay consistent with the remote
  // surfaces that actually render it.
  const isRemoteMedia = parseRemoteMediaId(status.mediaId) !== null;
  const activeItemId = isRemoteMedia ? null : status.mediaId;
  const currentPositionSeconds = finiteNonNegative(status.currentPositionSeconds);
  const durationSeconds = finitePositive(status.durationSeconds);
  const isPlaying = !isRemoteMedia && status.isPlaying && playbackError === null;
  const isReady = isLibraryReady && status.serviceReady;
  const playbackRate = status.playbackRate;

  return useMemo(
    () => ({
      activeItemId,
      currentPositionSeconds,
      durationSeconds,
      isBuffering: false as const,
      isPlaying,
      isReady,
      isTransitioning,
      playbackError,
      playbackRate,
      dismissPlayer,
      loadPaused,
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
      currentPositionSeconds,
      dismissPlayer,
      durationSeconds,
      isPlaying,
      isReady,
      isTransitioning,
      loadPaused,
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
      togglePlayback,
    ],
  );
}

function isPlaybackStateEquivalent(
  previous: AndroidAutoPlaybackState,
  next: AndroidAutoPlaybackState,
): boolean {
  if (
    previous.serviceReady !== next.serviceReady ||
    previous.mediaId !== next.mediaId ||
    previous.isPlaying !== next.isPlaying ||
    previous.isLoaded !== next.isLoaded ||
    previous.isEnded !== next.isEnded ||
    previous.error !== next.error ||
    previous.playbackRate !== next.playbackRate
  ) {
    return false;
  }

  const prevDuration = previous.durationSeconds ?? null;
  const nextDuration = next.durationSeconds ?? null;

  if (prevDuration !== nextDuration) {
    // Null ↔ number always matters; floats compare exactly because the
    // service emits stable duration values, not interpolated ones.
    if (
      prevDuration === null ||
      nextDuration === null ||
      Math.abs(prevDuration - nextDuration) > 0.01
    ) {
      return false;
    }
  }

  return (
    Math.abs(previous.currentPositionSeconds - next.currentPositionSeconds) <
    POSITION_DEDUP_TOLERANCE_SECONDS
  );
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finitePositive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function clampPosition(
  positionSeconds: number,
  durationSeconds: number | null,
): number {
  return durationSeconds === null
    ? positionSeconds
    : Math.min(positionSeconds, durationSeconds);
}
