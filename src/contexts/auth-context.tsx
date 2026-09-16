import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Platform } from 'react-native'

import {
  ApiError,
  type AuthUser,
  getProfile,
  getPlaybackProgress,
  getRemoteAudioStreamUrl,
  listRemoteAudios,
  type PlaybackEvent,
  type PlaybackProgress,
  recordPlaybackEvent,
  refreshSession,
  requestSignInCode,
  type RemoteAudio,
  type RemoteAudioStreamSource,
  revokeSession,
  revokeSessionWithRefreshToken,
  type Session,
  verifySignInCode,
} from '@/services/api'
import {
  clearSession,
  loadSession,
  saveSession,
} from '@/services/auth-session-storage'
import { syncAndroidAutoRemoteLibrary } from '../../modules/android-auto'
import {
  clearRemoteAudioCache,
  getCachedRemoteAudios,
} from '@/services/remote-audio-cache'
import {
  clearRemoteAudioFileCache,
  getCachedRemoteAudioSource,
  recordRemoteAudioPlayback,
} from '@/services/remote-audio-file-cache'

type AuthContextValue = {
  isRestoring: boolean
  user: AuthUser | null
  libraryTotal: number | null
  profileError: string | null
  requestCode: (email: string) => Promise<void>
  verifyCode: (email: string, code: string) => Promise<void>
  loadRemoteAudios: (forceRefresh?: boolean) => Promise<RemoteAudio[]>
  getRemoteAudioStreamSource: (
    audio: RemoteAudio,
  ) => Promise<RemoteAudioStreamSource>
  recordRemoteAudioPlayback: (
    audio: RemoteAudio,
    source?: RemoteAudioStreamSource,
  ) => void
  getRemotePlaybackProgress: (
    audioId: string,
  ) => Promise<PlaybackProgress | null>
  sendRemotePlaybackEvent: (
    audioId: string,
    event: PlaybackEvent,
  ) => Promise<void>
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [libraryTotal, setLibraryTotal] = useState<number | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const sessionRefreshRef = useRef<{
    refreshToken: string
    promise: Promise<Session>
  } | null>(null)

  const rotateSessionForProvider = useCallback((currentSession: Session) => {
    const pendingRefresh = sessionRefreshRef.current

    if (pendingRefresh?.refreshToken === currentSession.refreshToken) {
      return pendingRefresh.promise
    }

    const promise = rotateSession(currentSession).finally(() => {
      if (sessionRefreshRef.current?.promise === promise) {
        sessionRefreshRef.current = null
      }
    })

    sessionRefreshRef.current = {
      refreshToken: currentSession.refreshToken,
      promise,
    }

    return promise
  }, [])

  const refreshProfileForSession = useCallback(
    async (currentSession: Session) => {
      try {
        let activeSession = currentSession

        if (hasAccessTokenExpired(activeSession)) {
          activeSession = await rotateSessionForProvider(activeSession)
          setSession(activeSession)
        }

        let profile

        try {
          profile = await getProfile(activeSession.accessToken)
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) {
            throw error
          }

          activeSession = await rotateSessionForProvider(activeSession)
          setSession(activeSession)
          profile = await getProfile(activeSession.accessToken)
        }

        const updatedSession = { ...activeSession, user: profile.user }

        setSession(updatedSession)
        setLibraryTotal(profile.libraryTotal)
        setProfileError(null)
        await saveSession(updatedSession)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearRemoteAudioCache(currentSession.user.id)
          await clearRemoteAudioFileCache(currentSession.user.id)
          setSession(null)
          setLibraryTotal(null)
          setProfileError(null)
          await clearSession()
          return
        }

        setProfileError(toErrorMessage(error))
      }
    },
    [rotateSessionForProvider],
  )

  useEffect(() => {
    void (async () => {
      try {
        const storedSession = await loadSession()

        if (storedSession) {
          setSession(storedSession)
          await refreshProfileForSession(storedSession)
        }
      } finally {
        setIsRestoring(false)
      }
    })()
  }, [refreshProfileForSession])

  const requestCode = useCallback(async (email: string) => {
    await requestSignInCode(email.trim().toLowerCase())
  }, [])

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      const nextSession = await verifySignInCode(
        email.trim().toLowerCase(),
        code.trim(),
      )

      await saveSession(nextSession)
      setSession(nextSession)
      setLibraryTotal(null)
      await refreshProfileForSession(nextSession)
    },
    [refreshProfileForSession],
  )

  const refreshProfile = useCallback(async () => {
    if (session) {
      await refreshProfileForSession(session)
    }
  }, [refreshProfileForSession, session])

  const loadRemoteAudios = useCallback(
    async (forceRefresh = false): Promise<RemoteAudio[]> => {
      if (!session) {
        return []
      }

      let catalogSession = session

      if (hasAccessTokenExpired(catalogSession)) {
        catalogSession = await rotateSessionForProvider(catalogSession)
        setSession(catalogSession)
      }

      const audios = await getCachedRemoteAudios(catalogSession.user.id, async () => {
        try {
          let activeSession = catalogSession

          try {
            return await loadAllRemoteAudios(activeSession.accessToken)
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) {
              throw error
            }

            activeSession = await rotateSessionForProvider(activeSession)
            setSession(activeSession)
            return await loadAllRemoteAudios(activeSession.accessToken)
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            clearRemoteAudioCache(session.user.id)
            await clearRemoteAudioFileCache(session.user.id)
            setSession(null)
            setLibraryTotal(null)
            setProfileError(null)
            await clearSession()
          }

          throw error
        }
      }, forceRefresh)

      void syncRemoteLibraryForAndroidAuto(
        audios,
        catalogSession.user.id,
        catalogSession.accessToken,
      )
      return audios
    },
    [rotateSessionForProvider, session],
  )

  const getRemoteAudioStreamSource = useCallback(
    async (audio: RemoteAudio): Promise<RemoteAudioStreamSource> => {
      if (session) {
        const cachedSource = await getCachedRemoteAudioSource(
          session.user.id,
          audio.id,
        )

        if (cachedSource) {
          return cachedSource
        }
      }

      if (!session) {
        throw new ApiError('Sign in to play audio from your remote library.', 401)
      }

      try {
        let activeSession = session

        if (hasAccessTokenExpired(activeSession)) {
          activeSession = await rotateSessionForProvider(activeSession)
          setSession(activeSession)
        }

        return {
          uri: getRemoteAudioStreamUrl(audio.streamUrl),
          headers: { Authorization: `Bearer ${activeSession.accessToken}` },
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearRemoteAudioCache(session.user.id)
          await clearRemoteAudioFileCache(session.user.id)
          setSession(null)
          setLibraryTotal(null)
          setProfileError(null)
          await clearSession()
        }

        throw error
      }
    },
    [rotateSessionForProvider, session],
  )

  const recordRemotePlayback = useCallback(
    (audio: RemoteAudio, source?: RemoteAudioStreamSource) => {
      if (session) {
        recordRemoteAudioPlayback(session.user.id, audio, source)
      }
    },
    [session],
  )

  const requestWithCurrentSession = useCallback(
    async <T,>(operation: (accessToken: string) => Promise<T>) => {
      if (!session) {
        return null
      }

      try {
        let activeSession = session

        if (hasAccessTokenExpired(activeSession)) {
          activeSession = await rotateSessionForProvider(activeSession)
          setSession(activeSession)
        }

        try {
          return await operation(activeSession.accessToken)
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) {
            throw error
          }

          activeSession = await rotateSessionForProvider(activeSession)
          setSession(activeSession)
          return await operation(activeSession.accessToken)
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearRemoteAudioCache(session.user.id)
          await clearRemoteAudioFileCache(session.user.id)
          setSession(null)
          setLibraryTotal(null)
          setProfileError(null)
          await clearSession()
        }

        throw error
      }
    },
    [rotateSessionForProvider, session],
  )

  const getRemotePlaybackProgress = useCallback(
    async (audioId: string): Promise<PlaybackProgress | null> => {
      return await requestWithCurrentSession((accessToken) =>
        getPlaybackProgress(accessToken, audioId),
      )
    },
    [requestWithCurrentSession],
  )

  const sendRemotePlaybackEvent = useCallback(
    async (audioId: string, event: PlaybackEvent): Promise<void> => {
      await requestWithCurrentSession((accessToken) =>
        recordPlaybackEvent(accessToken, audioId, event),
      )
    },
    [requestWithCurrentSession],
  )

  const signOut = useCallback(async () => {
    try {
      if (session) {
        if (hasAccessTokenExpired(session)) {
          await revokeSessionWithRefreshToken(session.refreshToken)
        } else {
          try {
            await revokeSession(session.accessToken)
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) {
              throw error
            }

            await revokeSessionWithRefreshToken(session.refreshToken)
          }
        }
      }
    } finally {
      await syncAndroidAutoRemoteLibrary('[]').catch(() => undefined)
      if (session) {
        clearRemoteAudioCache(session.user.id)
        await clearRemoteAudioFileCache(session.user.id)
      }
      setSession(null)
      setLibraryTotal(null)
      setProfileError(null)
      await clearSession()
    }
  }, [session])

  return (
    <AuthContext.Provider
      value={{
        isRestoring,
        user: session?.user ?? null,
        libraryTotal,
        profileError,
        requestCode,
        verifyCode,
        loadRemoteAudios,
        getRemoteAudioStreamSource,
        recordRemoteAudioPlayback: recordRemotePlayback,
        getRemotePlaybackProgress,
        sendRemotePlaybackEvent,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

function syncRemoteLibraryForAndroidAuto(
  audios: readonly RemoteAudio[],
  userId: string,
  accessToken: string,
): Promise<void> {
  if (Platform.OS !== 'android') {
    return Promise.resolve()
  }

  return Promise.all(
    audios.map(async (audio) => {
      const source = await getCachedRemoteAudioSource(userId, audio.id)

      return {
        id: `remote:${audio.id}`,
        originalName: audio.title,
        localUri: source?.uri ?? getRemoteAudioStreamUrl(audio.streamUrl),
        mimeType: null,
        durationSeconds: getRemoteDurationSeconds(audio.metadata),
        lastPositionSeconds: 0,
        isPlayed: false,
        metadata: { coverArtUrl: getRemoteCoverArtUrl(audio.metadata) },
        updatedAt: audio.createdAt,
        requestHeaders:
          source?.headers ?? { Authorization: `Bearer ${accessToken}` },
      }
    }),
  )
    .then((catalog) => syncAndroidAutoRemoteLibrary(JSON.stringify(catalog)))
    .catch(() => undefined)
}

function getRemoteCoverArtUrl(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }

  const coverArtUrl = (metadata as Record<string, unknown>).coverArtUrl
  return typeof coverArtUrl === 'string' && /^https?:\/\//i.test(coverArtUrl.trim())
    ? coverArtUrl.trim()
    : null
}

function getRemoteDurationSeconds(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return null
  }

  const durationMs = (metadata as Record<string, unknown>).durationMs
  return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs / 1_000
    : null
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }

  return value
}

async function rotateSession(session: Session): Promise<Session> {
  if (!session.refreshToken) {
    throw new ApiError('Your saved session has expired. Please sign in again.', 401)
  }

  const nextSession = await refreshSession(session.refreshToken)
  await saveSession(nextSession)
  return nextSession
}

function hasAccessTokenExpired(session: Session): boolean {
  const expiresAt = Date.parse(session.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

async function loadAllRemoteAudios(accessToken: string): Promise<RemoteAudio[]> {
  const audios: RemoteAudio[] = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const response = await listRemoteAudios(accessToken, page)
    audios.push(...response.audios)
    hasMore = response.hasMore
    page += 1
  }

  return audios
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unable to reach your account.'
}
