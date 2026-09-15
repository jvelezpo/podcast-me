import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  ApiError,
  type AuthUser,
  getProfile,
  getRemoteAudioStreamUrl,
  listRemoteAudios,
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
import {
  clearRemoteAudioCache,
  getCachedRemoteAudios,
} from '@/services/remote-audio-cache'

type AuthContextValue = {
  isRestoring: boolean
  user: AuthUser | null
  libraryTotal: number | null
  profileError: string | null
  requestCode: (email: string) => Promise<void>
  verifyCode: (email: string, code: string) => Promise<void>
  loadRemoteAudios: () => Promise<RemoteAudio[]>
  getRemoteAudioStreamSource: (
    audio: RemoteAudio,
  ) => Promise<RemoteAudioStreamSource>
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

  const loadRemoteAudios = useCallback(async (): Promise<RemoteAudio[]> => {
    if (!session) {
      return []
    }

    return getCachedRemoteAudios(session.user.id, async () => {
      try {
        let activeSession = session

        if (hasAccessTokenExpired(activeSession)) {
          activeSession = await rotateSessionForProvider(activeSession)
          setSession(activeSession)
        }

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
          setSession(null)
          setLibraryTotal(null)
          setProfileError(null)
          await clearSession()
        }

        throw error
      }
    })
  }, [rotateSessionForProvider, session])

  const getRemoteAudioStreamSource = useCallback(
    async (audio: RemoteAudio): Promise<RemoteAudioStreamSource> => {
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
      if (session) {
        clearRemoteAudioCache(session.user.id)
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
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
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
