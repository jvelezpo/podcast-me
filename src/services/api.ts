export type AuthUser = {
  id: string
  email: string
  role: 'admin' | 'user' | 'guest'
  createdAt: string
}

export type Session = {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresAt: string
  refreshExpiresAt: string
  user: AuthUser
}

export type Profile = {
  user: AuthUser
  libraryTotal: number
}

export type RemoteAudio = {
  id: string
  title: string
  source: string
  spotifyId: string | null
  metadata: unknown
  createdAt: string
  streamUrl: string
}

export type RemoteAudioStreamSource = {
  uri: string
  headers: Record<string, string>
}

export type PlaybackDevice = {
  id?: string
  platform?: 'ios' | 'android' | 'web' | 'other'
  appVersion?: string
}

export type PlaybackEventType =
  | 'started'
  | 'progress'
  | 'paused'
  | 'seeked'
  | 'completed'

export type PlaybackEvent = {
  eventId: string
  playbackSessionId: string
  eventType: PlaybackEventType
  positionMs: number
  durationMs?: number
  listenedMs?: number
  occurredAt: string
  playbackRate?: number
  device?: PlaybackDevice
}

export type PlaybackProgress = {
  audioId: string
  positionMs: number
  durationMs: number | null
  completed: boolean
  playbackSessionId: string
  deviceId: string | null
  updatedAt: string
}

type PlaybackReadResult = {
  playback: PlaybackProgress | null
}

type PlaybackWriteResult = {
  eventAccepted: boolean
  playback: PlaybackProgress
}

type AudioPage = {
  audios: RemoteAudio[]
  page: number
  pageSize: number
  hasMore: boolean
}

export type AudioUploadInput = {
  fileName: string
  contentType?: string
  size: number
}

export type AudioUploadGrant = {
  uploadId: string
  uploadUrl: string
  method: 'PUT'
  contentType: string
  expiresIn: number
}

type AudioUploadGrantResult = {
  upload: AudioUploadGrant
}

export class ApiError extends Error {
  public readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export async function requestSignInCode(email: string): Promise<void> {
  await request('/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function verifySignInCode(
  email: string,
  code: string,
): Promise<Session> {
  return request('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

export function getProfile(accessToken: string): Promise<Profile> {
  return request('/me', { accessToken })
}

export function listRemoteAudios(
  accessToken: string,
  page: number,
): Promise<AudioPage> {
  return request(`/audios?page=${page}&sort=newest`, { accessToken })
}

export function createAudioUpload(
  accessToken: string,
  input: AudioUploadInput,
): Promise<AudioUploadGrant> {
  return request<AudioUploadGrantResult>('/audios/uploads', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      fileName: input.fileName,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      size: input.size,
    }),
  }).then((result) => result.upload)
}

export function completeAudioUpload(
  accessToken: string,
  uploadId: string,
  input: AudioUploadInput,
): Promise<{ audio: RemoteAudio }> {
  return request<{ audio: RemoteAudio }>(
    `/audios/uploads/${encodeURIComponent(uploadId)}/complete`,
    {
      method: 'POST',
      accessToken,
      body: JSON.stringify({
        fileName: input.fileName,
        ...(input.contentType ? { contentType: input.contentType } : {}),
        size: input.size,
      }),
    },
  )
}

export type RemoteAudioMetadataUpdate = {
  title?: string
  artist?: string
  album?: string
  releaseYear?: string
  coverArtUrl?: string
  description?: string
}

export function updateAudioMetadata(
  accessToken: string,
  audioId: string,
  update: RemoteAudioMetadataUpdate,
): Promise<{ audio: RemoteAudio }> {
  return request<{ audio: RemoteAudio }>(
    `/audios/${encodeURIComponent(audioId)}`,
    {
      method: 'PATCH',
      accessToken,
      body: JSON.stringify(update),
    },
  )
}

export async function getPlaybackProgress(
  accessToken: string,
  audioId: string,
): Promise<PlaybackProgress | null> {
  const result = await request<PlaybackReadResult>(
    `/audios/${encodeURIComponent(audioId)}/playback`,
    { accessToken },
  )
  return result.playback
}

export function recordPlaybackEvent(
  accessToken: string,
  audioId: string,
  event: PlaybackEvent,
): Promise<PlaybackWriteResult> {
  return request(`/audios/${encodeURIComponent(audioId)}/playback`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify(event),
  })
}

export function getRemoteAudioStreamUrl(streamUrl: string): string {
  try {
    return new URL(streamUrl, `${getApiOrigin()}/`).toString()
  } catch {
    throw new ApiError('This remote audio has an invalid stream address.')
  }
}

/**
 * Builds the playback/download source for a remote audio.
 *
 * Audio bytes must NOT be proxied through Vercel: Vercel bills every
 * response byte as egress even when the backend fetched them from R2.
 * The backend therefore serves presigned R2 URLs (absolute, cross-origin)
 * that the client streams directly from Cloudflare.
 *
 * Such URLs already carry their authorization in the query string, so the
 * app's Bearer token is only attached when the URL points back at the API
 * origin (the legacy same-origin proxy route). Sending an `Authorization`
 * header to R2 alongside SigV4 query-string auth can make the request
 * fail, so cross-origin URLs always get clean headers.
 */
export function buildRemoteAudioStreamSource(
  streamUrl: string,
  accessToken: string,
): RemoteAudioStreamSource {
  const uri = getRemoteAudioStreamUrl(streamUrl)

  return {
    uri,
    headers: isApiOriginUrl(uri)
      ? { Authorization: `Bearer ${accessToken}` }
      : {},
  }
}

function isApiOriginUrl(uri: string): boolean {
  try {
    return new URL(uri).origin === new URL(getApiOrigin()).origin
  } catch {
    return false
  }
}

export function refreshSession(refreshToken: string): Promise<Session> {
  return request('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  })
}

export async function revokeSession(accessToken: string): Promise<void> {
  await request('/auth/logout', { method: 'POST', accessToken })
}

export async function revokeSessionWithRefreshToken(
  refreshToken: string,
): Promise<void> {
  await request('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  })
}

async function request<T>(
  path: string,
  options: {
    method?: 'POST' | 'PUT' | 'PATCH'
    body?: string
    accessToken?: string
  } = {},
): Promise<T> {
  const response = await fetch(`${getApiOrigin()}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.accessToken
        ? { Authorization: `Bearer ${options.accessToken}` }
        : {}),
    },
    body: options.body,
  })

  if (response.status === 204) {
    return undefined as T
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | T
    | null

  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error
      ?.message
    throw new ApiError(
      message || 'Unable to reach your account.',
      response.status,
    )
  }

  return payload as T
}

function getApiOrigin(): string {
  const apiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN
  // const apiOrigin = 'http://192.168.40.172:3000'

  if (typeof apiOrigin !== 'string' || !apiOrigin) {
    throw new ApiError('Sign-in is not configured for this app build.')
  }

  return apiOrigin.replace(/\/+$/, '')
}
