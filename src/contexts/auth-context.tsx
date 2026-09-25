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
  buildRemoteAudioStreamSource,
  configureApiOrigin,
  getProfile,
  getPlaybackProgress,
  listRemoteAudios,
  type PlaybackEvent,
  type PlaybackProgress,
  recordPlaybackEvent,
  refreshSession,
  requestSignInCode,
  type RemoteAudio,
  type RemoteAudioMetadataUpdate,
  type RemoteAudioStreamSource,
  revokeSession,
  revokeSessionWithRefreshToken,
  type Session,
  updateAudioMetadata,
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
  subscribeToRemoteAudioFileCache,
} from '@/services/remote-audio-file-cache'
import {
  type RemoteAudioUploadProgress,
  type UploadableAudioAsset,
  uploadPickedAudioAsset,
} from '@/services/remote-audio-upload'
import {
  buildAndroidAutoRemoteCatalogEntries,
  clearRegisteredRemoteAudios,
  registerRemoteAudiosForCar,
} from '@/services/android-auto-remote-sync'
import { setAndroidAutoRemoteCatalogSnapshot } from '@/services/android-auto-remote-catalog'

type AuthContextValue = {
  isRestoring: boolean
  user: AuthUser | null
  libraryTotal: number | null
  profileError: string | null
  requestCode: (email: string, apiOrigin: string) => Promise<void>
  verifyCode: (email: string, code: string, apiOrigin: string) => Promise<void>
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
  updateRemoteAudioMetadata: (
    audioId: string,
    update: RemoteAudioMetadataUpdate,
  ) => Promise<RemoteAudio>
  uploadRemoteAudio: (
    asset: UploadableAudioAsset,
    options?: {
      onProgress?: (progress: RemoteAudioUploadProgress) => void
    },
  ) => Promise<RemoteAudio>
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
  const sessionRef = useRef<Session | null>(null)
  const lastRemoteAudiosRef = useRef<readonly RemoteAudio[]>([])
  const hasLoadedRemoteAudiosRef = useRef(false)
  const previousAccessTokenRef = useRef<string | null>(null)
  const hadSessionRef = useRef(false)

  /**
   * Pushes freshly resolved remote sources to the Android Auto snapshot.
   * The car plays from that snapshot while the phone is locked, so every
   * push must resolve sources with the current token (and prefer freshly
   * cached files, which need no credentials at all).
   */
  const pushRemoteCatalogToCar = useCallback(
    async (
      audios: readonly RemoteAudio[],
      userId: string,
      accessToken: string,
    ): Promise<void> => {
      // The registry lets the Android remote hook resolve car-initiated
      // `remote:<id>` playback back to full audios on every platform.
      registerRemoteAudiosForCar(audios)

      if (Platform.OS !== 'android') {
        return
      }

      const resolved = (
        await Promise.all(
          audios.map(async (audio) => {
            try {
              const cached = await getCachedRemoteAudioSource(
                userId,
                audio.id,
              ).catch(() => null)
              const source =
                cached ??
                buildRemoteAudioStreamSource(audio.streamUrl, accessToken)
              return { audio, source }
            } catch {
              // One unloadable record must not block the rest of the car
              // catalog from being refreshed.
              return null
            }
          }),
        )
      ).filter((entry) => entry !== null)

      const entries = buildAndroidAutoRemoteCatalogEntries(resolved)
      // Mirror the snapshot beside the native push: per-play upserts merge
      // over this list, so it must track the last full sync.
      setAndroidAutoRemoteCatalogSnapshot(entries)
      await syncAndroidAutoRemoteLibrary(JSON.stringify(entries)).catch(
        () => undefined,
      )
    },
    [],
  )

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
          if (storedSession.apiOrigin) {
            configureApiOrigin(storedSession.apiOrigin)
          }
          setSession(storedSession)
          await refreshProfileForSession(storedSession)
        }
      } finally {
        setIsRestoring(false)
      }
    })()
  }, [refreshProfileForSession])

  const requestCode = useCallback(async (email: string, apiOrigin: string) => {
    configureApiOrigin(apiOrigin)
    await requestSignInCode(email.trim().toLowerCase())
  }, [])

  const verifyCode = useCallback(
    async (email: string, code: string, apiOrigin: string) => {
      const normalizedApiOrigin = configureApiOrigin(apiOrigin)
      const nextSession = {
        ...(await verifySignInCode(email.trim().toLowerCase(), code.trim())),
        apiOrigin: normalizedApiOrigin,
      }

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

      // A retry below can rotate past catalogSession; remember the newest
      // session so the car push below never pins a superseded token.
      let pushSession = catalogSession

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
            pushSession = activeSession
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

      void pushRemoteCatalogToCar(
        audios,
        pushSession.user.id,
        pushSession.accessToken,
      ).catch(() => undefined)
      lastRemoteAudiosRef.current = audios
      hasLoadedRemoteAudiosRef.current = true
      return audios
    },
    [pushRemoteCatalogToCar, rotateSessionForProvider, session],
  )

  // The car snapshot pins credentials (Bearer headers, presigned URLs, or
  // cached file URIs). A rotated access token invalidates the pinned Bearer
  // headers, so refresh the remote list (fresh presigned URLs included) and
  // push it as soon as the token changes. A genuine logout clears the
  // snapshot instead of leaving expired credentials behind.
  useEffect(() => {
    if (!session) {
      if (hadSessionRef.current) {
        hadSessionRef.current = false
        previousAccessTokenRef.current = null
        lastRemoteAudiosRef.current = []
        hasLoadedRemoteAudiosRef.current = false
        setAndroidAutoRemoteCatalogSnapshot([])
        clearRegisteredRemoteAudios()
        void syncAndroidAutoRemoteLibrary('[]').catch(() => undefined)
      }
      return
    }

    hadSessionRef.current = true

    if (previousAccessTokenRef.current === session.accessToken) {
      return
    }

    previousAccessTokenRef.current = session.accessToken

    if (!hasLoadedRemoteAudiosRef.current) {
      return
    }

    void loadRemoteAudios(true).catch(() => undefined)
  }, [loadRemoteAudios, session])

  // A download that finishes after the last sync promotes that audio to an
  // auth-immune cached file; push it to the car snapshot right away.
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    return subscribeToRemoteAudioFileCache((userId) => {
      const activeSession = sessionRef.current

      if (
        Platform.OS !== 'android' ||
        !activeSession ||
        activeSession.user.id !== userId
      ) {
        return
      }

      const audios = lastRemoteAudiosRef.current

      if (audios.length === 0) {
        return
      }

      void pushRemoteCatalogToCar(
        audios,
        userId,
        activeSession.accessToken,
      ).catch(() => undefined)
    })
  }, [pushRemoteCatalogToCar])

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

        return buildRemoteAudioStreamSource(
          audio.streamUrl,
          activeSession.accessToken,
        )
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

  const updateRemoteAudioMetadata = useCallback(
    async (
      audioId: string,
      update: RemoteAudioMetadataUpdate,
    ): Promise<RemoteAudio> => {
      const result = await requestWithCurrentSession((accessToken) =>
        updateAudioMetadata(accessToken, audioId, update),
      )

      if (!result) {
        throw new ApiError('Sign in to update audio details.', 401)
      }

      return result.audio
    },
    [requestWithCurrentSession],
  )

  const getFreshAccessToken = useCallback(
    async (forceRefresh = false): Promise<string> => {
      if (!session) {
        throw new ApiError('Sign in to upload audio to your library.', 401)
      }

      let activeSession = session

      if (forceRefresh || hasAccessTokenExpired(activeSession)) {
        activeSession = await rotateSessionForProvider(activeSession)
        setSession(activeSession)
      }

      return activeSession.accessToken
    },
    [rotateSessionForProvider, session],
  )

  const uploadRemoteAudio = useCallback(
    async (
      asset: UploadableAudioAsset,
      options?: {
        onProgress?: (progress: RemoteAudioUploadProgress) => void
      },
    ): Promise<RemoteAudio> => {
      if (!session) {
        throw new ApiError('Sign in to upload audio to your library.', 401)
      }

      try {
        const audio = await uploadPickedAudioAsset(
          getFreshAccessToken,
          asset,
          options,
        )

        clearRemoteAudioCache(session.user.id)
        await refreshProfileForSession(session).catch(() => undefined)

        return audio
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
    [getFreshAccessToken, refreshProfileForSession, session],
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
      setAndroidAutoRemoteCatalogSnapshot([])
      clearRegisteredRemoteAudios()
      lastRemoteAudiosRef.current = []
      hasLoadedRemoteAudiosRef.current = false
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
        updateRemoteAudioMetadata,
        uploadRemoteAudio,
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

  if (session.apiOrigin) {
    configureApiOrigin(session.apiOrigin)
  }

  const nextSession = {
    ...(await refreshSession(session.refreshToken)),
    apiOrigin: session.apiOrigin,
  }
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
