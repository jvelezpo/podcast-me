import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'

import type {
  PlaybackEvent,
  PlaybackEventType,
  PlaybackProgress,
  RemoteAudio,
  RemoteAudioStreamSource,
} from '@/services/api'
import { getPlaybackDevice } from '@/services/playback-device'
import {
  loadRememberedPlaybackRate,
  saveRememberedPlaybackRate,
} from '@/services/playback-rate-memory'
import { clampPlaybackRate, getShowKey } from '@/utils/playback-rate'
import {
  createPlaybackEvent,
  createPlaybackEventSession,
  type PlaybackEventSession,
} from '@/services/playback-event'
import { shouldTrackRemoteAudioPosition } from '@/services/remote-audio-playback-policy'
import {
  clearRemoteAudioPosition,
  loadRemoteAudioPosition,
  saveRemoteAudioPosition,
} from '@/services/remote-audio-progress'

type PendingLoad = {
  audio: RemoteAudio
  source: RemoteAudioStreamSource
  requestId: number
  sawUnloadedStatus: boolean
  isStarting: boolean
  resumePositionSeconds: number
}

type GetStreamSource = (
  audio: RemoteAudio,
) => Promise<RemoteAudioStreamSource>

type RecordPlayback = (
  audio: RemoteAudio,
  source?: RemoteAudioStreamSource,
) => void

type GetPlaybackProgress = (
  audioId: string,
) => Promise<PlaybackProgress | null>

type SendPlaybackEvent = (
  audioId: string,
  event: PlaybackEvent,
) => Promise<void>

const PLAYBACK_RESUME_TIMEOUT_MS = 1_500

export function useRemoteAudioPlayer(
  getStreamSource: GetStreamSource,
  recordPlayback: RecordPlayback,
  getPlaybackProgress: GetPlaybackProgress,
  sendPlaybackEvent: SendPlaybackEvent,
  onFinished?: (finishedAudioId: string) => void,
  onUnexpectedPause?: () => void,
) {
  const player = useAudioPlayer(null, { updateInterval: 500 })
  const status = useAudioPlayerStatus(player)
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null)
  const [activeAudio, setActiveAudio] = useState<RemoteAudio | null>(null)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isUsingCachedSource, setIsUsingCachedSource] = useState(false)
  const [playbackRate, setPlaybackRateState] = useState(1)
  const [playbackError, setPlaybackError] = useState<{
    audioId: string
    message: string
  } | null>(null)
  const activeAudioRef = useRef<RemoteAudio | null>(null)
  const pendingLoadRef = useRef<PendingLoad | null>(null)
  const transitionSequenceRef = useRef(0)
  const statusRef = useRef(status)
  const playbackRateRef = useRef(playbackRate)
  const playbackEventSessionRef = useRef<PlaybackEventSession | null>(null)
  const playbackEventSendTailRef = useRef<Promise<void>>(Promise.resolve())
  const sendPlaybackEventRef = useRef(sendPlaybackEvent)
  const onFinishedRef = useRef(onFinished)
  const onUnexpectedPauseRef = useRef(onUnexpectedPause)
  const playbackErrorRef = useRef<{ audioId: string; message: string } | null>(
    null,
  )
  /**
   * True while the latest pause came from our own code (pause, stop, track
   * switch, failure teardown). The unexpected-pause watcher consumes it;
   * anything else that stops playback is external (call, route change).
   */
  const internalPauseRef = useRef(false)
  const prevPlayingRef = useRef(false)

  useEffect(() => {
    sendPlaybackEventRef.current = sendPlaybackEvent
  }, [sendPlaybackEvent])

  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  useEffect(() => {
    onUnexpectedPauseRef.current = onUnexpectedPause
  }, [onUnexpectedPause])
  const lastCheckpointRef = useRef<{ audioId: string; savedAt: number } | null>(
    null,
  )

  const queuePlaybackEvent = useCallback(
    (
      eventType: PlaybackEventType,
      audio: RemoteAudio,
      positionSeconds: number,
      durationSeconds: number | null,
    ) => {
      let session = playbackEventSessionRef.current

      if (
        session?.audioId === audio.id &&
        ((eventType === 'started' && session.isListening) ||
          (eventType === 'paused' && !session.isListening))
      ) {
        return
      }

      if (eventType === 'paused' && session?.audioId !== audio.id) {
        return
      }

      if (!session || session.audioId !== audio.id) {
        session = createPlaybackEventSession(audio.id)
        playbackEventSessionRef.current = session
      }

      const event = createPlaybackEvent(session, {
        eventType,
        positionSeconds,
        durationSeconds,
        playbackRate: playbackRateRef.current,
      })

      if (!event) {
        // Filtered as noise (stalled heartbeat, no-op seek): nothing to store.
        return
      }

      const send = async () => {
        const device = await getPlaybackDevice()
        const eventWithDevice = { ...event, device }

        try {
          await sendPlaybackEventRef.current(audio.id, eventWithDevice)
        } catch {
          // Retrying with the same eventId is safe and avoids duplicate history.
          await sendPlaybackEventRef.current(audio.id, eventWithDevice)
        }
      }

      playbackEventSendTailRef.current = playbackEventSendTailRef.current
        .then(send, send)
        .catch(() => undefined)
      // Player actions never await this network tail, so telemetry cannot block UI.
    },
    [],
  )

  const closePlaybackEventSession = useCallback(() => {
    const audio = activeAudioRef.current
    const session = playbackEventSessionRef.current
    const currentStatus = statusRef.current

    if (audio && session?.audioId === audio.id && session.isListening) {
      queuePlaybackEvent(
        'paused',
        audio,
        finiteNonNegative(currentStatus.currentTime),
        currentStatus.isLoaded ? finitePositive(currentStatus.duration) : null,
      )
    }

    playbackEventSessionRef.current = null
  }, [queuePlaybackEvent])

  const activateLockScreenControls = useCallback(
    (audio: RemoteAudio) => {
      player.setActiveForLockScreen(
        true,
        { title: audio.title, artist: 'Podcast Me · Remote library' },
        { isLiveStream: false, showSeekBackward: true, showSeekForward: true },
      )
    },
    [player],
  )

  const persistCurrentPosition = useCallback(() => {
    const activeAudio = activeAudioRef.current
    const currentStatus = statusRef.current

    if (
      !activeAudio ||
      !shouldTrackRemoteAudioPosition(activeAudio.metadata) ||
      !currentStatus.isLoaded
    ) {
      return
    }

    void saveRemoteAudioPosition(
      activeAudio.id,
      finiteNonNegative(currentStatus.currentTime),
    )
  }, [])

  const stop = useCallback(() => {
    persistCurrentPosition()
    closePlaybackEventSession()
    transitionSequenceRef.current += 1
    pendingLoadRef.current = null
    internalPauseRef.current = true

    try {
      player.pause()
      player.setActiveForLockScreen(false)
    } catch {
      // The player can already be unavailable after a failed source replacement.
    }

    activeAudioRef.current = null
    setActiveAudioId(null)
    setActiveAudio(null)
    setIsTransitioning(false)
    setIsUsingCachedSource(false)
    setPlaybackError(null)
    lastCheckpointRef.current = null
  }, [closePlaybackEventSession, persistCurrentPosition, player])

  const failPlayback = useCallback(
    (audioId: string, message: string, requestId?: number) => {
      if (
        requestId !== undefined &&
        requestId !== transitionSequenceRef.current
      ) {
        return
      }

      pendingLoadRef.current = null
      closePlaybackEventSession()
      internalPauseRef.current = true
      try {
        player.pause()
        player.setActiveForLockScreen(false)
      } catch {
        // The player can already be unavailable after a failed source replacement.
      }
      setIsTransitioning(false)
      setPlaybackError({ audioId, message })
    },
    [closePlaybackEventSession, player],
  )

  const loadAndPlay = useCallback(
    async (audio: RemoteAudio) => {
      const requestId = transitionSequenceRef.current + 1
      transitionSequenceRef.current = requestId
      setIsTransitioning(true)
      setPlaybackError(null)

      try {
        const shouldResume = shouldTrackRemoteAudioPosition(audio.metadata)

        if (!shouldResume) {
          void clearRemoteAudioPosition(audio.id).catch(() => undefined)
        }

        await setAudioModeAsync({
          allowsRecording: false,
          interruptionMode: 'doNotMix',
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          shouldRouteThroughEarpiece: false,
        })
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
          ])
        const resumePositionSeconds = remoteProgress
          ? remoteProgress.completed
            ? 0
            : remoteProgress.positionMs / 1_000
          : localResumePositionSeconds

        if (remoteProgress) {
          void saveRemoteAudioPosition(audio.id, resumePositionSeconds)
        }

        if (requestId !== transitionSequenceRef.current) {
          return
        }

        persistCurrentPosition()
        closePlaybackEventSession()
        internalPauseRef.current = true
        player.pause()
        activeAudioRef.current = audio
        setActiveAudioId(audio.id)
        setActiveAudio(audio)
        setIsUsingCachedSource(source.uri.startsWith('file:'))
        // Per-show memory: a returning show resumes at its own speed. The
        // pending-load effect applies `playbackRateRef` when playback starts.
        playbackRateRef.current = rememberedRate
        setPlaybackRateState(rememberedRate)

        const pendingLoad: PendingLoad = {
          audio,
          source,
          requestId,
          sawUnloadedStatus: false,
          isStarting: false,
          resumePositionSeconds,
        }
        pendingLoadRef.current = pendingLoad
        player.replace({ ...source, name: audio.title })
        pendingLoad.sawUnloadedStatus = !player.isLoaded
      } catch {
        failPlayback(
          audio.id,
          'This remote audio could not be streamed. Check your connection and try again.',
          requestId,
        )
      }
    },
    [
      closePlaybackEventSession,
      failPlayback,
      getPlaybackProgress,
      getStreamSource,
      persistCurrentPosition,
      player,
    ],
  )

  const togglePlayback = useCallback(
    (audio: RemoteAudio) => {
      if (isTransitioning) {
        return
      }

      if (
        activeAudioRef.current?.id !== audio.id ||
        !status.isLoaded ||
        playbackError?.audioId === audio.id
      ) {
        void loadAndPlay(audio)
        return
      }

      try {
        if (status.playing) {
          internalPauseRef.current = true
          player.pause()
          persistCurrentPosition()
        } else {
          internalPauseRef.current = false
          player.play()
          recordPlayback(audio)
        }
      } catch {
        failPlayback(audio.id, 'This remote audio could not be played.')
      }
    },
    [
      failPlayback,
      isTransitioning,
      loadAndPlay,
      persistCurrentPosition,
      playbackError?.audioId,
      player,
      recordPlayback,
      status.isLoaded,
      status.playing,
    ],
  )

  const pausePlayback = useCallback(
    (audio: RemoteAudio): void => {
      if (activeAudioRef.current?.id === audio.id && status.isLoaded) {
        internalPauseRef.current = true
        player.pause()
        persistCurrentPosition()
      }
    },
    [persistCurrentPosition, player, status.isLoaded],
  )

  const resumePlayback = useCallback(
    (audio: RemoteAudio): void => {
      if (activeAudioRef.current?.id === audio.id && status.isLoaded) {
        internalPauseRef.current = false
        player.play()
        recordPlayback(audio)
      }
    },
    [player, recordPlayback, status.isLoaded],
  )

  useEffect(() => {
    const pendingLoad = pendingLoadRef.current

    if (!pendingLoad) {
      return
    }

    if (!status.isLoaded) {
      pendingLoad.sawUnloadedStatus = true
    }

    if (pendingLoad.sawUnloadedStatus && status.error) {
      failPlayback(
        pendingLoad.audio.id,
        `Streaming failed: ${status.error}`,
        pendingLoad.requestId,
      )
      return
    }

    if (
      !status.isLoaded ||
      !pendingLoad.sawUnloadedStatus ||
      pendingLoad.isStarting
    ) {
      return
    }

    pendingLoad.isStarting = true

    void (async () => {
      try {
        const duration = finitePositive(status.duration)
        const resumePosition =
          duration === null
            ? pendingLoad.resumePositionSeconds
            : Math.min(pendingLoad.resumePositionSeconds, duration)

        await player.seekTo(resumePosition)

        if (pendingLoadRef.current?.requestId !== pendingLoad.requestId) {
          return
        }

        player.play()
        recordPlayback(pendingLoad.audio, pendingLoad.source)
        activateLockScreenControls(pendingLoad.audio)
        internalPauseRef.current = false
        pendingLoadRef.current = null
        lastCheckpointRef.current = {
          audioId: pendingLoad.audio.id,
          savedAt: Date.now(),
        }
        setIsTransitioning(false)
      } catch {
        failPlayback(
          pendingLoad.audio.id,
          'This remote audio could not be started.',
          pendingLoad.requestId,
        )
      }
    })()
  }, [
    activateLockScreenControls,
    failPlayback,
    player,
    recordPlayback,
    status.duration,
    status.error,
    status.isLoaded,
  ])

  useEffect(() => {
    statusRef.current = status

    if (playbackErrorRef.current?.audioId !== playbackError?.audioId) {
      playbackErrorRef.current = playbackError
    }
  }, [playbackError, status])

  useEffect(() => {
    const wasPlaying = prevPlayingRef.current
    prevPlayingRef.current = status.playing

    if (status.playing) {
      // Fresh play: any pause marker that never met its stop is obsolete.
      internalPauseRef.current = false
      return
    }

    if (!wasPlaying) {
      return
    }

    // External pause detector (phone call, headphone/route change): playback
    // was going and stopped without our code pausing, stopping, failing, or
    // switching tracks. The context debounces this into an interruption toast.
    if (
      status.didJustFinish ||
      pendingLoadRef.current ||
      playbackErrorRef.current !== null
    ) {
      internalPauseRef.current = false
      return
    }

    if (internalPauseRef.current) {
      internalPauseRef.current = false
      return
    }

    onUnexpectedPauseRef.current?.()
  }, [status.didJustFinish, status.playing])

  useEffect(() => {
    const activeAudio = activeAudioRef.current

    if (!activeAudio || !status.isLoaded || !status.playing) {
      return
    }

    const now = Date.now()
    const eventSession = playbackEventSessionRef.current

    if (
      eventSession?.audioId === activeAudio.id &&
      eventSession.isListening &&
      now - eventSession.lastEventAt >= 15_000
    ) {
      queuePlaybackEvent(
        'progress',
        activeAudio,
        finiteNonNegative(status.currentTime),
        finitePositive(status.duration),
      )
    }

    if (!shouldTrackRemoteAudioPosition(activeAudio.metadata)) {
      return
    }

    const checkpoint = lastCheckpointRef.current

    if (
      checkpoint?.audioId === activeAudio.id &&
      now - checkpoint.savedAt < 5_000
    ) {
      return
    }

    lastCheckpointRef.current = { audioId: activeAudio.id, savedAt: now }
    void saveRemoteAudioPosition(
      activeAudio.id,
      finiteNonNegative(status.currentTime),
    )
  }, [queuePlaybackEvent, status])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'inactive' || nextState === 'background') {
        persistCurrentPosition()

        const audio = activeAudioRef.current
        const currentStatus = statusRef.current
        const eventSession = playbackEventSessionRef.current

        if (
          audio &&
          currentStatus.isLoaded &&
          eventSession?.audioId === audio.id &&
          eventSession.isListening
        ) {
          queuePlaybackEvent(
            'progress',
            audio,
            finiteNonNegative(currentStatus.currentTime),
            finitePositive(currentStatus.duration),
          )
        }
      }
    })

    return () => subscription.remove()
  }, [persistCurrentPosition, queuePlaybackEvent])

  useEffect(() => {
    const activeAudio = activeAudioRef.current

    if (
      !activeAudio ||
      pendingLoadRef.current ||
      !status.isLoaded ||
      !status.playing
    ) {
      return
    }

    activateLockScreenControls(activeAudio)
  }, [activateLockScreenControls, activeAudioId, status.isLoaded, status.playing])

  useEffect(() => {
    const activeAudio = activeAudioRef.current
    const eventSession = playbackEventSessionRef.current

    if (
      !activeAudio ||
      pendingLoadRef.current ||
      !status.isLoaded
    ) {
      return
    }

    if (
      status.didJustFinish &&
      eventSession?.audioId === activeAudio.id
    ) {
      const duration = finitePositive(status.duration)
      queuePlaybackEvent(
        'completed',
        activeAudio,
        duration ?? finiteNonNegative(status.currentTime),
        duration,
      )
      playbackEventSessionRef.current = null
    } else if (status.playing) {
      if (
        eventSession?.audioId !== activeAudio.id ||
        !eventSession.isListening
      ) {
        queuePlaybackEvent(
          'started',
          activeAudio,
          finiteNonNegative(status.currentTime),
          finitePositive(status.duration),
        )
      }
    } else if (
      eventSession?.audioId === activeAudio.id &&
      eventSession.isListening
    ) {
      queuePlaybackEvent(
        'paused',
        activeAudio,
        finiteNonNegative(status.currentTime),
        finitePositive(status.duration),
      )
    }
  }, [
    activeAudioId,
    queuePlaybackEvent,
    status.currentTime,
    status.didJustFinish,
    status.duration,
    status.isLoaded,
    status.playing,
  ])

  useEffect(() => {
    const activeAudio = activeAudioRef.current

    if (!status.error || !activeAudio || pendingLoadRef.current) {
      return
    }

    failPlayback(activeAudio.id, `Streaming failed: ${status.error}`)
  }, [failPlayback, status.error])

  useEffect(() => {
    if (!status.didJustFinish || pendingLoadRef.current) {
      return
    }

    const finishedAudio = activeAudioRef.current

    stop()

    if (
      finishedAudio &&
      shouldTrackRemoteAudioPosition(finishedAudio.metadata)
    ) {
      void saveRemoteAudioPosition(finishedAudio.id, 0)
    }

    if (finishedAudio) {
      onFinishedRef.current?.(finishedAudio.id)
    }
  }, [status.didJustFinish, stop])

  useEffect(() => stop, [stop])

  const seekTo = useCallback(
    async (positionSeconds: number): Promise<void> => {
      if (!status.isLoaded || !Number.isFinite(positionSeconds)) {
        return
      }

      const safePosition = Math.max(0, positionSeconds)
      await player.seekTo(safePosition)
      const activeAudio = activeAudioRef.current

      if (activeAudio) {
        queuePlaybackEvent(
          'seeked',
          activeAudio,
          safePosition,
          finitePositive(status.duration),
        )
      }

      if (activeAudio && shouldTrackRemoteAudioPosition(activeAudio.metadata)) {
        await saveRemoteAudioPosition(activeAudio.id, safePosition)
      }
    },
    [player, queuePlaybackEvent, status.duration, status.isLoaded],
  )

  const seekBy = useCallback(
    (offsetSeconds: number): void => {
      if (!Number.isFinite(offsetSeconds)) {
        return
      }

      void seekTo(status.currentTime + offsetSeconds)
    },
    [seekTo, status.currentTime],
  )

  /**
   * Stall retry: starts a fresh load for the current audio, superseding any
   * stuck transition. This is the same load path toggle-playback uses when
   * streaming errors or never became ready.
   */
  const retryPlayback = useCallback((): void => {
    const activeAudio = activeAudioRef.current

    if (!activeAudio) {
      return
    }

    void loadAndPlay(activeAudio)
  }, [loadAndPlay])

  const setVolume = useCallback(
    (volume: number): void => {
      if (!Number.isFinite(volume)) {
        return
      }

      player.volume = Math.min(Math.max(volume, 0), 1)
    },
    [player],
  )

  const setPlaybackRate = useCallback(
    (rate: number, showKey?: string | null): void => {
      if (!Number.isFinite(rate)) {
        return
      }

      const activeAudio = activeAudioRef.current
      const currentStatus = statusRef.current
      const eventSession = playbackEventSessionRef.current

      if (
        activeAudio &&
        currentStatus.isLoaded &&
        eventSession?.audioId === activeAudio.id &&
        eventSession.isListening
      ) {
        queuePlaybackEvent(
          'progress',
          activeAudio,
          finiteNonNegative(currentStatus.currentTime),
          finitePositive(currentStatus.duration),
        )
      }

      const safeRate = clampPlaybackRate(rate)
      player.setPlaybackRate(safeRate)
      playbackRateRef.current = safeRate
      setPlaybackRateState(safeRate)
      void saveRememberedPlaybackRate(
        showKey ?? getShowKey(activeAudioRef.current?.metadata),
        safeRate,
      )
    },
    [player, queuePlaybackEvent],
  )

  return useMemo(
    () => ({
      activeAudio,
      activeAudioId,
      currentPositionSeconds: finiteNonNegative(status.currentTime),
      durationSeconds: status.isLoaded ? finitePositive(status.duration) : null,
      isBuffering: status.isBuffering,
      isPlaying: status.playing && playbackError === null,
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
      activeAudioId,
      isTransitioning,
      isUsingCachedSource,
      pausePlayback,
      playbackError,
      playbackRate,
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
      stop,
      togglePlayback,
    ],
  )
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}

function getPlaybackProgressWithinTimeout(
  getPlaybackProgress: GetPlaybackProgress,
  audioId: string,
): Promise<PlaybackProgress | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (progress: PlaybackProgress | null) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(progress)
    }
    const timeout = setTimeout(() => finish(null), PLAYBACK_RESUME_TIMEOUT_MS)

    void getPlaybackProgress(audioId).then(finish, () => finish(null))
  })
}
