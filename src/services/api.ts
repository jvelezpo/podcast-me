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
  headers: { Authorization: string }
}

type AudioPage = {
  audios: RemoteAudio[]
  page: number
  pageSize: number
  hasMore: boolean
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
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

export function getRemoteAudioStreamUrl(streamUrl: string): string {
  try {
    return new URL(streamUrl, `${getApiOrigin()}/`).toString()
  } catch {
    throw new ApiError('This remote audio has an invalid stream address.')
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
  options: { method?: 'POST'; body?: string; accessToken?: string } = {},
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

  if (typeof apiOrigin !== 'string' || !apiOrigin) {
    throw new ApiError('Sign-in is not configured for this app build.')
  }

  return apiOrigin.replace(/\/+$/, '')
}
