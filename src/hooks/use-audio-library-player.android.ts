import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { AudioItemPlaybackUpdate } from "@/hooks/use-audio-library";
import type { LoadedAudioItem } from "@/services/audio-library-storage";
import {
  dismissAndroidAutoPlayback,
  getAndroidAutoPlaybackState,
  observeAndroidAutoPlaybackState,
  pauseAndroidAutoPlayback,
  playAndroidAutoItem,
  seekAndroidAutoPlayback,
  setAndroidAutoPlaybackRate,
  type AndroidAutoPlaybackState,
} from "../../modules/android-auto";

export type AudioPlaybackError = {
  itemId: string;
  message: string;
};

type UpdateAudioItem = (
  itemId: string,
  update: AudioItemPlaybackUpdate,
) => Promise<boolean>;

const CHECKPOINT_INTERVAL_MS = 5_000;
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
    async (itemId: string, markPlayed = false) => {
      const current = statusRef.current;
      if (current.mediaId !== itemId) {
        return;
      }

      await updateAudioItem(itemId, {
        lastPositionSeconds: markPlayed ? 0 : current.currentPositionSeconds,
        ...(current.durationSeconds === null
          ? {}
          : { durationSeconds: current.durationSeconds }),
        ...(markPlayed ? { isPlayed: true } : {}),
      });
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
        void persistState(itemId);
      }
    });

    return () => subscription.remove();
  }, [persistState]);

  const loadAndPlay = useCallback(
    async (item: LoadedAudioItem) => {
      const requestId = beginTransition();
      try {
        const didPlay = await playAndroidAutoItem(
          item.id,
          item.lastPositionSeconds,
          statusRef.current.playbackRate,
        );
        if (!didPlay) {
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
        await persistState(item.id);
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
      setStatus((previous) => ({
        ...previous,
        currentPositionSeconds: target,
      }));

      try {
        if (!(await seekAndroidAutoPlayback(target))) {
          failPlayback(
            itemId,
            "Playback could not move to the requested position. Try again.",
            requestId,
          );
          return;
        }
        await updateAudioItem(itemId, { lastPositionSeconds: target });
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
    setStatus((previous) => ({ ...previous, playbackRate: safeRate }));
    statusRef.current = { ...statusRef.current, playbackRate: safeRate };
    void setAndroidAutoPlaybackRate(safeRate).then((didUpdate) => {
      if (!didUpdate && statusRef.current.mediaId) {
        setPlaybackError({
          itemId: statusRef.current.mediaId,
          message: "Playback speed could not be changed. Try again.",
        });
      }
    });
  }, []);

  const removeActiveItem = useCallback(
    async (
      itemId: string,
      nextItem: LoadedAudioItem | null,
      shouldPlayNext: boolean,
    ): Promise<boolean> => {
      const currentId = statusRef.current.mediaId;
      if (currentId !== null && currentId !== itemId) {
        return false;
      }

      if (currentId === itemId) {
        await persistState(itemId);
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

  return {
    activeItemId: status.mediaId,
    currentPositionSeconds: finiteNonNegative(status.currentPositionSeconds),
    durationSeconds: finitePositive(status.durationSeconds),
    isPlaying: status.isPlaying && playbackError === null,
    isReady: isLibraryReady && status.serviceReady,
    isTransitioning,
    playbackError,
    playbackRate: status.playbackRate,
    dismissPlayer,
    pausePlayback,
    removeActiveItem,
    resumePlayback,
    seekBy,
    seekTo,
    setPlaybackRate,
    togglePlayback,
  };
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
