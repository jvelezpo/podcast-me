import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import type { RemoteAudio, RemoteAudioStreamSource } from '@/services/api'
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

export function useRemoteAudioPlayer(
  getStreamSource: GetStreamSource,
  recordPlayback: RecordPlayback,
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
  const lastCheckpointRef = useRef<{ audioId: string; savedAt: number } | null>(
    null,
  )

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
    transitionSequenceRef.current += 1
    pendingLoadRef.current = null

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
  }, [persistCurrentPosition, player])

  const failPlayback = useCallback(
    (audioId: string, message: string, requestId?: number) => {
      if (
        requestId !== undefined &&
        requestId !== transitionSequenceRef.current
      ) {
        return
      }

      pendingLoadRef.current = null
      try {
        player.pause()
        player.setActiveForLockScreen(false)
      } catch {
        // The player can already be unavailable after a failed source replacement.
      }
      setIsTransitioning(false)
      setPlaybackError({ audioId, message })
    },
    [player],
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
        const [source, resumePositionSeconds] = await Promise.all([
          getStreamSource(audio),
          shouldResume
            ? loadRemoteAudioPosition(audio.id)
            : Promise.resolve(0),
        ])

        if (requestId !== transitionSequenceRef.current) {
          return
        }

        persistCurrentPosition()
        player.pause()
        activeAudioRef.current = audio
        setActiveAudioId(audio.id)
        setActiveAudio(audio)
        setIsUsingCachedSource(source.uri.startsWith('file:'))

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
    [failPlayback, getStreamSource, persistCurrentPosition, player],
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
          player.pause()
          persistCurrentPosition()
        } else {
          player.play()
          recordPlayback(audio)
        }
      } catch {
        failPlayback(audio.id, 'This remote audio could not be played.')
      }
    },
    [failPlayback, isTransitioning, loadAndPlay, persistCurrentPosition, playbackError?.audioId, player, recordPlayback, status.isLoaded, status.playing],
  )

  const pausePlayback = useCallback(
    (audio: RemoteAudio): void => {
      if (activeAudioRef.current?.id === audio.id && status.isLoaded) {
        player.pause()
        persistCurrentPosition()
      }
    },
    [persistCurrentPosition, player, status.isLoaded],
  )

  const resumePlayback = useCallback(
    (audio: RemoteAudio): void => {
      if (activeAudioRef.current?.id === audio.id && status.isLoaded) {
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
  }, [activateLockScreenControls, failPlayback, player, recordPlayback, status.duration, status.error, status.isLoaded])

  useEffect(() => {
    statusRef.current = status

    const activeAudio = activeAudioRef.current

    if (
      !activeAudio ||
      !shouldTrackRemoteAudioPosition(activeAudio.metadata) ||
      !status.isLoaded ||
      !status.playing
    ) {
      return
    }

    const checkpoint = lastCheckpointRef.current
    const now = Date.now()

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
  }, [status])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'inactive' || nextState === 'background') {
        persistCurrentPosition()
      }
    })

    return () => subscription.remove()
  }, [persistCurrentPosition])

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
  }, [status.didJustFinish, stop])

  useEffect(() => stop, [stop])

  const seekTo = useCallback(
    async (positionSeconds: number): Promise<void> => {
      if (!status.isLoaded || !Number.isFinite(positionSeconds)) {
        return
      }

      await player.seekTo(Math.max(0, positionSeconds))
      const activeAudio = activeAudioRef.current

      if (
        activeAudio &&
        shouldTrackRemoteAudioPosition(activeAudio.metadata)
      ) {
        await saveRemoteAudioPosition(
          activeAudio.id,
          Math.max(0, positionSeconds),
        )
      }
    },
    [player, status.isLoaded],
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

  const setPlaybackRate = useCallback(
    (rate: number): void => {
      if (!Number.isFinite(rate)) {
        return
      }

      const safeRate = Math.min(Math.max(rate, 0.5), 2)
      player.setPlaybackRate(safeRate)
      setPlaybackRateState(safeRate)
    },
    [player],
  )

  return {
    activeAudio,
    activeAudioId,
    currentPositionSeconds: finiteNonNegative(status.currentTime),
    durationSeconds: status.isLoaded ? finitePositive(status.duration) : null,
    isPlaying: status.playing && playbackError === null,
    isTransitioning,
    isUsingCachedSource,
    playbackRate,
    playbackError,
    pausePlayback,
    resumePlayback,
    seekBy,
    seekTo,
    setPlaybackRate,
    stop,
    togglePlayback,
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}
