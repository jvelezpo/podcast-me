import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import type {
  PlaybackEvent,
  PlaybackEventType,
  PlaybackProgress,
  RemoteAudio,
  RemoteAudioStreamSource,
} from "@/services/api";
import type { useRemoteAudioPlayer as GenericRemoteAudioPlayer } from "./use-remote-audio-player";
import {
  buildAndroidAutoRemoteCatalogEntries,
  getRegisteredRemoteAudio,
  parseRemoteMediaId,
  registerRemoteAudiosForCar,
  toRemoteMediaId,
} from "@/services/android-auto-remote-sync";
import { upsertAndroidAutoRemoteCatalogEntry } from "@/services/android-auto-remote-catalog";
import { getPlaybackDevice } from "@/services/playback-device";
import {
  loadRememberedPlaybackRate,
  saveRememberedPlaybackRate,
} from "@/services/playback-rate-memory";
import { clampPlaybackRate, getShowKey } from "@/utils/playback-rate";
import { shouldTrackRemoteAudioPosition } from "@/services/remote-audio-playback-policy";
import {
  clearRemoteAudioPosition,
  loadRemoteAudioPosition,
  saveRemoteAudioPosition,
} from "@/services/remote-audio-progress";
import {
  createPlaybackEvent,
  createPlaybackEventSession,
  type PlaybackEventSession,
} from "@/services/playback-event";
import {
  getAndroidAutoPlaybackState,
  observeAndroidAutoPlaybackState,
  pauseAndroidAutoPlayback,
  playAndroidAutoItem,
  seekAndroidAutoPlayback,
  setAndroidAutoPlaybackRate,
  setAndroidAutoVolume,
  type AndroidAutoPlaybackState,
} from "../../modules/android-auto";

type GetStreamSource = (
  audio: RemoteAudio,
) => Promise<RemoteAudioStreamSource>;

type RecordPlayback = (
  audio: RemoteAudio,
  source?: RemoteAudioStreamSource,
) => void;

type GetPlaybackProgress = (
  audioId: string,
) => Promise<PlaybackProgress | null>;

type SendPlaybackEvent = (
  audioId: string,
  event: PlaybackEvent,
) => Promise<void>;

const CHECKPOINT_INTERVAL_MS = 5_000;
const PLAYBACK_RESUME_TIMEOUT_MS = 1_500;
/**
 * The shared service pushes state every 500 ms while playing. Position-only
 * ticks must not re-render JS: skip `setState` when the push carries no
 * meaningful change (same mediaId/isPlaying/error/rate/loaded/ended and
 * <1 s move). The ref stays fresh for persist/event reads.
 */
const POSITION_DEDUP_TOLERANCE_SECONDS = 1;
/**
 * The shared car/phone ExoPlayer coerces rates into 0.5–2 natively, so the
 * Android remote hook clamps like the Android local hook (instead of the
 * 0.5–3 `clampPlaybackRate` the speed sheet offers). The mirrored service
 * rate is always the truth, so the two UIs can never disagree.
 */
const SERVICE_RATE_MIN = 0.5;
const SERVICE_RATE_MAX = 2;

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

/**
 * Android remote playback runs on the shared car/phone ExoPlayer
 * (`PodcastMediaLibraryService`) — the same engine local playback and the
 * Android Auto head unit use — instead of a separate expo-audio player.
 * Device commands (`playAndroidAutoItem`/pause/seek) move the shared
 * engine so the car UI follows, and car-initiated `remote:<id>` playback is
 * adopted into this state so the device UI follows. Either surface paused
 * or seeking is visible on the other within one service push.
 *
 * Position checkpoints, playback events, resume positions, and per-show
 * rate memory stay in JS, driven by the mirrored service state.
 *
 * `onUnexpectedPause` is accepted for interface parity but ignored: on the
 * shared engine a pause the phone did not command is usually the user
 * pausing from the car, not an interruption (same standing choice as the
 * Android local hook, which drops the fourth context argument).
 */
export function useRemoteAudioPlayer(
  getStreamSource: GetStreamSource,
  recordPlayback: RecordPlayback,
  getPlaybackProgress: GetPlaybackProgress,
  sendPlaybackEvent: SendPlaybackEvent,
  onFinished?: (finishedAudioId: string) => void,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onUnexpectedPause?: () => void,
): ReturnType<typeof GenericRemoteAudioPlayer> {
  const [serviceState, setServiceState] = useState(INITIAL_STATE);
  const [activeAudio, setActiveAudio] = useState<RemoteAudio | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isUsingCachedSource, setIsUsingCachedSource] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [playbackError, setPlaybackError] = useState<{
    audioId: string;
    message: string;
  } | null>(null);

  const serviceStateRef = useRef(serviceState);
  const activeAudioRef = useRef<RemoteAudio | null>(null);
  /** Audio our own commands addressed; car-initiated adoptions overwrite it. */
  const commandedAudioRef = useRef<RemoteAudio | null>(null);
  const transitionSequenceRef = useRef(0);
  const failedRequestRef = useRef<number | null>(null);
  const completedAudioIdRef = useRef<string | null>(null);
  const playbackRateRef = useRef(playbackRate);
  const playbackErrorRef = useRef<{ audioId: string; message: string } | null>(
    null,
  );
  const playbackEventSessionRef = useRef<PlaybackEventSession | null>(null);
  const playbackEventSendTailRef = useRef<Promise<void>>(Promise.resolve());
  const sendPlaybackEventRef = useRef(sendPlaybackEvent);
  const onFinishedRef = useRef(onFinished);
  const lastCheckpointRef = useRef<{ audioId: string; savedAt: number } | null>(
    null,
  );

  useEffect(() => {
    sendPlaybackEventRef.current = sendPlaybackEvent;
  }, [sendPlaybackEvent]);

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    playbackErrorRef.current = playbackError;
  }, [playbackError]);

  const adoptedAudioId =
    activeAudio !== null &&
    serviceState.mediaId === toRemoteMediaId(activeAudio.id)
      ? activeAudio.id
      : null;
  const adoptedPositionSeconds =
    adoptedAudioId !== null
      ? finiteNonNegative(serviceState.currentPositionSeconds)
      : 0;
  const adoptedDurationSeconds =
    adoptedAudioId !== null
      ? finitePositive(serviceState.durationSeconds)
      : null;

  const queuePlaybackEvent = useCallback(
    (
      eventType: PlaybackEventType,
      audio: RemoteAudio,
      positionSeconds: number,
      durationSeconds: number | null,
    ) => {
      let session = playbackEventSessionRef.current;

      if (
        session?.audioId === audio.id &&
        ((eventType === "started" && session.isListening) ||
          (eventType === "paused" && !session.isListening))
      ) {
        return;
      }

      if (eventType === "paused" && session?.audioId !== audio.id) {
        return;
      }

      if (!session || session.audioId !== audio.id) {
        session = createPlaybackEventSession(audio.id);
        playbackEventSessionRef.current = session;
      }

      const event = createPlaybackEvent(session, {
        eventType,
        positionSeconds,
        durationSeconds,
        playbackRate: playbackRateRef.current,
      });

      if (!event) {
        return;
      }

      const send = async () => {
        const device = await getPlaybackDevice();
        const eventWithDevice = { ...event, device };

        try {
          await sendPlaybackEventRef.current(audio.id, eventWithDevice);
        } catch {
          await sendPlaybackEventRef.current(audio.id, eventWithDevice);
        }
      };

      playbackEventSendTailRef.current = playbackEventSendTailRef.current
        .then(send, send)
        .catch(() => undefined);
    },
    [],
  );

  const persistCurrentPosition = useCallback(() => {
    const audio = activeAudioRef.current;
    const current = serviceStateRef.current;

    if (
      !audio ||
      !shouldTrackRemoteAudioPosition(audio.metadata) ||
      parseRemoteMediaId(current.mediaId) !== audio.id
    ) {
      return;
    }

    void saveRemoteAudioPosition(
      audio.id,
      finiteNonNegative(current.currentPositionSeconds),
    );
  }, []);

  const closePlaybackEventSession = useCallback(() => {
    const audio = activeAudioRef.current;
    const session = playbackEventSessionRef.current;
    const current = serviceStateRef.current;

    if (audio && session?.audioId === audio.id && session.isListening) {
      queuePlaybackEvent(
        "paused",
        audio,
        finiteNonNegative(current.currentPositionSeconds),
        parseRemoteMediaId(current.mediaId) === audio.id
          ? finitePositive(current.durationSeconds)
          : null,
      );
    }

    playbackEventSessionRef.current = null;
  }, [queuePlaybackEvent]);

  const clearAdoptedState = useCallback(() => {
    commandedAudioRef.current = null;
    activeAudioRef.current = null;
    setActiveAudio(null);
    setIsUsingCachedSource(false);
    setPlaybackError(null);
    lastCheckpointRef.current = null;
  }, []);

  const adoptOrClear = useCallback(
    (nextState: AndroidAutoPlaybackState) => {
      // A failed command owns the error copy until the next command; service
      // pushes (500ms ticks) must not wipe it first.
      if (failedRequestRef.current === null) {
        const remoteId = parseRemoteMediaId(nextState.mediaId);
        setPlaybackError(
          remoteId !== null && nextState.error
            ? { audioId: remoteId, message: nextState.error }
            : null,
        );
      }

      const remoteId = parseRemoteMediaId(nextState.mediaId);

      if (remoteId === null) {
        // The shared engine left remote (local took over / dismissed).
        if (activeAudioRef.current !== null) {
          clearAdoptedState();
        }
        return;
      }

      if (activeAudioRef.current?.id === remoteId) {
        return;
      }

      // Car-initiated (or raced) remote playback: adopt it so the device UI
      // follows. Our own commanded audio wins ties; otherwise resolve the
      // registered catalog copy the car itself was synced from.
      const commanded = commandedAudioRef.current;
      const audio =
        commanded?.id === remoteId
          ? commanded
          : getRegisteredRemoteAudio(remoteId);

      if (!audio) {
        // Unknown to JS: report nothing rather than a surface we cannot fill.
        if (activeAudioRef.current !== null) {
          clearAdoptedState();
        }
        return;
      }

      commandedAudioRef.current = audio;
      activeAudioRef.current = audio;
      setActiveAudio(audio);

      if (commanded?.id !== remoteId) {
        setIsUsingCachedSource(false);
        // Touch the file-cache recency without a source (never triggers a
        // download or network); the service already streams the bytes.
        recordPlayback(audio);
      }
    },
    [clearAdoptedState, recordPlayback],
  );

  useEffect(() => {
    let isMounted = true;
    let stateRevision = 0;
    const subscription = observeAndroidAutoPlaybackState((nextState) => {
      if (!isMounted) {
        return;
      }

      stateRevision += 1;
      const previous = serviceStateRef.current;
      serviceStateRef.current = nextState;

      // Dedup 500 ms position ticks (audit §P2).
      if (!isServiceStateEquivalent(previous, nextState)) {
        setServiceState(nextState);
        setIsTransitioning(false);
      }
      adoptOrClear(nextState);
    });

    const refreshPlaybackState = () => {
      const revision = stateRevision;
      void getAndroidAutoPlaybackState().then((nextState) => {
        if (isMounted && revision === stateRevision) {
          const previous = serviceStateRef.current;
          serviceStateRef.current = nextState;

          if (!isServiceStateEquivalent(previous, nextState)) {
            setServiceState(nextState);
            setIsTransitioning(false);
          }
          adoptOrClear(nextState);
        }
      });
    };
    refreshPlaybackState();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextAppState) => {
        if (nextAppState === "active") {
          refreshPlaybackState();
        }
      },
    );

    return () => {
      isMounted = false;
      subscription.remove();
      appStateSubscription.remove();
    };
  }, [adoptOrClear]);

  const beginTransition = useCallback(() => {
    transitionSequenceRef.current += 1;
    failedRequestRef.current = null;
    setIsTransitioning(true);
    setPlaybackError(null);
    return transitionSequenceRef.current;
  }, []);

  const finishTransition = useCallback((requestId: number) => {
    if (requestId === transitionSequenceRef.current) {
      setIsTransitioning(false);
    }
  }, []);

  const failPlayback = useCallback(
    (audioId: string, message: string, requestId: number) => {
      if (requestId !== transitionSequenceRef.current) {
        return;
      }

      failedRequestRef.current = requestId;
      closePlaybackEventSession();
      setIsTransitioning(false);
      setPlaybackError({ audioId, message });
    },
    [closePlaybackEventSession],
  );

  const loadAndPlay = useCallback(
    async (audio: RemoteAudio) => {
      const requestId = beginTransition();

      try {
        const shouldResume = shouldTrackRemoteAudioPosition(audio.metadata);

        if (!shouldResume) {
          void clearRemoteAudioPosition(audio.id).catch(() => undefined);
        }

        const [source, localResumePositionSeconds, remoteProgress, rememberedRate] =
          await Promise.all([
            getStreamSource(audio),
            shouldResume
              ? loadRemoteAudioPosition(audio.id)
              : Promise.resolve(0),
            shouldResume
              ? getPlaybackProgressWithinTimeout(
                  getPlaybackProgress,
                  audio.id,
                )
              : Promise.resolve(null),
            loadRememberedPlaybackRate(getShowKey(audio.metadata)),
          ]);
        const resumePositionSeconds = remoteProgress
          ? remoteProgress.completed
            ? 0
            : remoteProgress.positionMs / 1_000
          : localResumePositionSeconds;

        if (remoteProgress) {
          void saveRemoteAudioPosition(audio.id, resumePositionSeconds);
        }

        if (requestId !== transitionSequenceRef.current) {
          return;
        }

        // Pin the freshly resolved source into the car snapshot before
        // commanding play: the shared engine can only start `remote:<id>`
        // rows present in its snapshot, and this source carries the current
        // credentials (or a cached file needing none).
        const [entry] = buildAndroidAutoRemoteCatalogEntries([
          { audio, source },
        ]);
        registerRemoteAudiosForCar([audio]);
        await upsertAndroidAutoRemoteCatalogEntry(entry);

        if (requestId !== transitionSequenceRef.current) {
          return;
        }

        persistCurrentPosition();
        closePlaybackEventSession();
        commandedAudioRef.current = audio;
        activeAudioRef.current = audio;
        setActiveAudio(audio);
        completedAudioIdRef.current = null;
        setIsUsingCachedSource(source.uri.startsWith("file:"));
        const safeRate = clampServicePlaybackRate(rememberedRate);
        playbackRateRef.current = safeRate;
        setPlaybackRateState(safeRate);
        lastCheckpointRef.current = {
          audioId: audio.id,
          savedAt: Date.now(),
        };

        const didPlay = await playAndroidAutoItem(
          toRemoteMediaId(audio.id),
          resumePositionSeconds,
          safeRate,
        );

        if (!didPlay || requestId !== transitionSequenceRef.current) {
          if (requestId === transitionSequenceRef.current) {
            failPlayback(
              audio.id,
              "This remote audio could not be streamed. Check your connection and try again.",
              requestId,
            );
          }
          return;
        }

        recordPlayback(audio, source);
        finishTransition(requestId);
      } catch {
        failPlayback(
          audio.id,
          "This remote audio could not be streamed. Check your connection and try again.",
          requestId,
        );
      }
    },
    [
      beginTransition,
      closePlaybackEventSession,
      failPlayback,
      finishTransition,
      getPlaybackProgress,
      getStreamSource,
      persistCurrentPosition,
      recordPlayback,
    ],
  );

  const pausePlayback = useCallback(
    (audio: RemoteAudio): void => {
      if (
        activeAudioRef.current?.id !== audio.id ||
        parseRemoteMediaId(serviceStateRef.current.mediaId) !== audio.id
      ) {
        return;
      }

      const requestId = beginTransition();
      persistCurrentPosition();
      closePlaybackEventSession();

      void (async () => {
        try {
          if (!(await pauseAndroidAutoPlayback())) {
            failPlayback(
              audio.id,
              "Playback could not be paused safely. Try again.",
              requestId,
            );
            return;
          }

          finishTransition(requestId);
        } catch {
          failPlayback(
            audio.id,
            "Playback could not be paused safely. Try again.",
            requestId,
          );
        }
      })();
    },
    [beginTransition, closePlaybackEventSession, failPlayback, finishTransition, persistCurrentPosition],
  );

  const resumePlayback = useCallback(
    (audio: RemoteAudio): void => {
      if (activeAudioRef.current?.id !== audio.id) {
        return;
      }

      const requestId = beginTransition();
      const current = serviceStateRef.current;
      const position =
        parseRemoteMediaId(current.mediaId) === audio.id
          ? finiteNonNegative(current.currentPositionSeconds)
          : 0;

      void (async () => {
        try {
          const didPlay = await playAndroidAutoItem(
            toRemoteMediaId(audio.id),
            position,
            playbackRateRef.current,
          );

          if (!didPlay) {
            failPlayback(
              audio.id,
              "Playback could not resume. Try again.",
              requestId,
            );
            return;
          }

          recordPlayback(audio);
          finishTransition(requestId);
        } catch {
          failPlayback(
            audio.id,
            "Playback could not resume. Try again.",
            requestId,
          );
        }
      })();
    },
    [beginTransition, failPlayback, finishTransition, recordPlayback],
  );

  const togglePlayback = useCallback(
    (audio: RemoteAudio) => {
      if (isTransitioning) {
        return;
      }

      const current = serviceStateRef.current;
      const adoptedId = parseRemoteMediaId(current.mediaId);

      if (
        activeAudioRef.current?.id !== audio.id ||
        adoptedId !== audio.id ||
        playbackErrorRef.current?.audioId === audio.id
      ) {
        void loadAndPlay(audio);
        return;
      }

      if (current.isPlaying) {
        pausePlayback(audio);
      } else {
        resumePlayback(audio);
      }
    },
    [isTransitioning, loadAndPlay, pausePlayback, resumePlayback],
  );

  /**
   * Stall retry: a fresh load for the current audio through the same path
   * toggle-playback uses. This is the retry the stalled banner wires to.
   */
  const retryPlayback = useCallback((): void => {
    const audio = activeAudioRef.current;

    if (!audio) {
      return;
    }

    void loadAndPlay(audio);
  }, [loadAndPlay]);

  const setVolume = useCallback((volume: number): void => {
    if (!Number.isFinite(volume)) {
      return;
    }

    void setAndroidAutoVolume(Math.min(Math.max(volume, 0), 1));
  }, []);

  const setPlaybackRate = useCallback(
    (rate: number, showKey?: string | null): void => {
      if (!Number.isFinite(rate)) {
        return;
      }

      const audio = activeAudioRef.current;
      const current = serviceStateRef.current;
      const session = playbackEventSessionRef.current;

      if (
        audio &&
        parseRemoteMediaId(current.mediaId) === audio.id &&
        session?.audioId === audio.id &&
        session.isListening
      ) {
        queuePlaybackEvent(
          "progress",
          audio,
          finiteNonNegative(current.currentPositionSeconds),
          finitePositive(current.durationSeconds),
        );
      }

      const safeRate = clampServicePlaybackRate(rate);
      playbackRateRef.current = safeRate;
      setPlaybackRateState(safeRate);
      void saveRememberedPlaybackRate(
        showKey ?? getShowKey(activeAudioRef.current?.metadata),
        safeRate,
      );

      if (audio && parseRemoteMediaId(current.mediaId) === audio.id) {
        void setAndroidAutoPlaybackRate(safeRate).then((didUpdate) => {
          if (!didUpdate) {
            setPlaybackError({
              audioId: audio.id,
              message: "Playback speed could not be changed. Try again.",
            });
          }
        });
      }
    },
    [queuePlaybackEvent],
  );

  const seekTo = useCallback(
    async (positionSeconds: number): Promise<void> => {
      const audio = activeAudioRef.current;

      if (!audio || !Number.isFinite(positionSeconds)) {
        return;
      }

      const current = serviceStateRef.current;

      if (parseRemoteMediaId(current.mediaId) !== audio.id) {
        return;
      }

      const safePosition = Math.max(0, positionSeconds);
      await seekAndroidAutoPlayback(safePosition);

      if (activeAudioRef.current?.id !== audio.id) {
        return;
      }

      queuePlaybackEvent(
        "seeked",
        audio,
        safePosition,
        finitePositive(serviceStateRef.current.durationSeconds),
      );

      if (shouldTrackRemoteAudioPosition(audio.metadata)) {
        await saveRemoteAudioPosition(audio.id, safePosition);
      }
    },
    [queuePlaybackEvent],
  );

  const seekBy = useCallback(
    (offsetSeconds: number): void => {
      if (!Number.isFinite(offsetSeconds)) {
        return;
      }

      void seekTo(
        finiteNonNegative(serviceStateRef.current.currentPositionSeconds) +
          offsetSeconds,
      );
    },
    [seekTo],
  );

  /**
   * Explicit stop: persist, close the event session, and drop the adopted
   * audio. It deliberately sends NO command to the shared engine — every
   * stop() caller either follows with a replacing play (track switch,
   * atomic at the engine) or the engine already ended — so stop can never
   * pause or wipe playback the car (or a queued next track) owns. Unmount
   * persists the same way and never steals car audio.
   */
  const stop = useCallback(() => {
    persistCurrentPosition();
    closePlaybackEventSession();
    transitionSequenceRef.current += 1;
    failedRequestRef.current = null;
    commandedAudioRef.current = null;
    activeAudioRef.current = null;
    setActiveAudio(null);
    setIsUsingCachedSource(false);
    setIsTransitioning(false);
    setPlaybackError(null);
    lastCheckpointRef.current = null;
  }, [closePlaybackEventSession, persistCurrentPosition]);

  // 5s checkpoints + 15s progress heartbeats while the shared engine plays
  // our adopted audio; background transitions persist immediately.
  useEffect(() => {
    if (
      adoptedAudioId === null ||
      !activeAudio ||
      !serviceState.isPlaying
    ) {
      return;
    }

    const now = Date.now();
    const session = playbackEventSessionRef.current;

    if (
      session?.audioId === activeAudio.id &&
      session.isListening &&
      now - session.lastEventAt >= 15_000
    ) {
      queuePlaybackEvent(
        "progress",
        activeAudio,
        adoptedPositionSeconds,
        adoptedDurationSeconds,
      );
    }

    if (!shouldTrackRemoteAudioPosition(activeAudio.metadata)) {
      return;
    }

    const checkpoint = lastCheckpointRef.current;

    if (
      checkpoint?.audioId === activeAudio.id &&
      now - checkpoint.savedAt < CHECKPOINT_INTERVAL_MS
    ) {
      return;
    }

    lastCheckpointRef.current = { audioId: activeAudio.id, savedAt: now };
    void saveRemoteAudioPosition(activeAudio.id, adoptedPositionSeconds);
  }, [
    activeAudio,
    adoptedAudioId,
    adoptedDurationSeconds,
    adoptedPositionSeconds,
    queuePlaybackEvent,
    serviceState.isPlaying,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "inactive" || nextState === "background") {
        persistCurrentPosition();

        const audio = activeAudioRef.current;
        const current = serviceStateRef.current;
        const session = playbackEventSessionRef.current;

        if (
          audio &&
          parseRemoteMediaId(current.mediaId) === audio.id &&
          session?.audioId === audio.id &&
          session.isListening
        ) {
          queuePlaybackEvent(
            "progress",
            audio,
            finiteNonNegative(current.currentPositionSeconds),
            finitePositive(current.durationSeconds),
          );
        }
      }
    });

    return () => subscription.remove();
  }, [persistCurrentPosition, queuePlaybackEvent]);

  // Started/paused playback events from the mirrored engine state.
  useEffect(() => {
    if (adoptedAudioId === null || !activeAudio) {
      return;
    }

    const session = playbackEventSessionRef.current;

    if (serviceState.isPlaying) {
      if (session?.audioId !== activeAudio.id || !session.isListening) {
        queuePlaybackEvent(
          "started",
          activeAudio,
          adoptedPositionSeconds,
          adoptedDurationSeconds,
        );
      }
    } else if (
      !serviceState.isEnded &&
      session?.audioId === activeAudio.id &&
      session.isListening
    ) {
      queuePlaybackEvent(
        "paused",
        activeAudio,
        adoptedPositionSeconds,
        adoptedDurationSeconds,
      );
    }
  }, [
    activeAudio,
    adoptedAudioId,
    adoptedDurationSeconds,
    adoptedPositionSeconds,
    queuePlaybackEvent,
    serviceState.isEnded,
    serviceState.isPlaying,
  ]);

  // Natural finish on the shared engine: reset position, emit completed,
  // and hand the id to auto-advance (queue/next UI). State stays adopted so
  // both surfaces keep showing the finished episode until something plays.
  useEffect(() => {
    if (
      adoptedAudioId === null ||
      !activeAudio ||
      !serviceState.isEnded
    ) {
      if (
        activeAudio &&
        adoptedAudioId !== null &&
        !serviceState.isEnded &&
        completedAudioIdRef.current === activeAudio.id
      ) {
        completedAudioIdRef.current = null;
      }
      return;
    }

    if (completedAudioIdRef.current === activeAudio.id) {
      return;
    }

    completedAudioIdRef.current = activeAudio.id;

    if (shouldTrackRemoteAudioPosition(activeAudio.metadata)) {
      void saveRemoteAudioPosition(activeAudio.id, 0);
    }

    queuePlaybackEvent(
      "completed",
      activeAudio,
      adoptedDurationSeconds ?? adoptedPositionSeconds,
      adoptedDurationSeconds,
    );
    playbackEventSessionRef.current = null;
    onFinishedRef.current?.(activeAudio.id);
  }, [
    activeAudio,
    adoptedAudioId,
    adoptedDurationSeconds,
    adoptedPositionSeconds,
    queuePlaybackEvent,
    serviceState.isEnded,
  ]);

  useEffect(() => {
    return () => {
      persistCurrentPosition();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(
    () => ({
      activeAudio,
      activeAudioId: activeAudio?.id ?? null,
      currentPositionSeconds: adoptedPositionSeconds,
      durationSeconds: adoptedDurationSeconds,
      isBuffering: false as const,
      isPlaying:
        adoptedAudioId !== null &&
        serviceState.isPlaying &&
        playbackError === null,
      isTransitioning,
      isUsingCachedSource,
      playbackRate,
      playbackError,
      pausePlayback,
      resumePlayback,
      retryPlayback,
      seekBy,
      seekTo,
      setPlaybackRate,
      setVolume,
      stop,
      togglePlayback,
    }),
    [
      activeAudio,
      adoptedAudioId,
      adoptedDurationSeconds,
      adoptedPositionSeconds,
      isTransitioning,
      isUsingCachedSource,
      pausePlayback,
      playbackError,
      playbackRate,
      resumePlayback,
      retryPlayback,
      seekBy,
      seekTo,
      serviceState.isPlaying,
      setPlaybackRate,
      setVolume,
      stop,
      togglePlayback,
    ],
  );
}

function isServiceStateEquivalent(
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

function clampServicePlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return clampPlaybackRate(1);
  }

  return Math.min(Math.max(rate, SERVICE_RATE_MIN), SERVICE_RATE_MAX);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finitePositive(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function getPlaybackProgressWithinTimeout(
  getPlaybackProgress: GetPlaybackProgress,
  audioId: string,
): Promise<PlaybackProgress | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (progress: PlaybackProgress | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(progress);
    };
    const timeout = setTimeout(() => finish(null), PLAYBACK_RESUME_TIMEOUT_MS);

    void getPlaybackProgress(audioId).then(finish, () => finish(null));
  });
}
