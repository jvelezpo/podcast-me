import { File, UploadType } from 'expo-file-system'

import {
  ApiError,
  completeAudioUpload,
  createAudioUpload,
  type RemoteAudio,
} from '@/services/api'

export const MAX_UPLOAD_SIZE_BYTES = 262_144_000

export type UploadableAudioAsset = {
  uri: string
  name: string
  mimeType?: string | null
  size?: number | null
}

export type RemoteAudioUploadProgress = {
  bytesSent: number
  totalBytes: number
}

export function inferUploadContentType(
  fileName: string,
  mimeType?: string | null,
): string | undefined {
  const trimmed = mimeType?.trim()

  if (trimmed && /^audio\//i.test(trimmed)) {
    return trimmed
  }

  const extension = /\.([a-z0-9]{2,5})$/i.exec(fileName.trim())?.[1]?.toLowerCase()
  const inferred = extension ? EXTENSION_TO_CONTENT_TYPE[extension] : undefined

  // Leave undefined so the backend infers the type from fileName when we
  // cannot determine a supported audio type locally.
  return inferred
}

export async function resolveUploadAssetSize(
  asset: UploadableAudioAsset,
): Promise<number> {
  if (
    typeof asset.size === 'number' &&
    Number.isFinite(asset.size) &&
    asset.size > 0
  ) {
    return Math.floor(asset.size)
  }

  const file = new File(asset.uri)
  const size = file.size

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('The selected file is empty or unreadable.')
  }

  return Math.floor(size)
}

/**
 * Uploads one picked file using the backend direct-upload grant flow:
 * grant -> raw PUT to R2 (no Authorization header) -> complete.
 *
 * The token provider is called before the grant and again before the
 * completion request, so a slow PUT cannot fail on an expired token.
 * A 401 on completion retries once with a forced token refresh.
 */
export async function uploadPickedAudioAsset(
  getAccessToken: (forceRefresh?: boolean) => Promise<string>,
  asset: UploadableAudioAsset,
  options: {
    onProgress?: (progress: RemoteAudioUploadProgress) => void
  } = {},
): Promise<RemoteAudio> {
  const fileName = asset.name.trim()

  if (!fileName) {
    throw new Error('The selected file needs a name.')
  }

  if (fileName.length > 255) {
    throw new Error('The file name is too long (255 characters max).')
  }

  const size = await resolveUploadAssetSize(asset)

  if (size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error('The file is larger than the 250 MB upload limit.')
  }

  const contentType = inferUploadContentType(fileName, asset.mimeType)
  const payload = contentType ? { fileName, contentType, size } : { fileName, size }

  let grant: Awaited<ReturnType<typeof createAudioUpload>>

  try {
    grant = await createAudioUpload(await getAccessToken(), payload)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error
    }

    grant = await createAudioUpload(await getAccessToken(true), payload)
  }
  const uploadContentType = grant.contentType || contentType

  if (grant.method !== 'PUT' || !grant.uploadUrl) {
    throw new Error('The upload grant was invalid. Try again.')
  }

  const file = new File(asset.uri)

  if (!file.exists) {
    throw new Error('The selected file is no longer available.')
  }

  // The presigned R2 URL already carries SigV4 auth in its query string:
  // never attach the Hushline Bearer token here, and send the exact
  // Content-Type returned by the grant.
  const result = await file.upload(grant.uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: uploadContentType ? { 'Content-Type': uploadContentType } : {},
    onProgress: options.onProgress
      ? ({ bytesSent, totalBytes }) =>
          options.onProgress!({ bytesSent, totalBytes })
      : undefined,
  })

  if (result.status < 200 || result.status >= 300) {
    throw new Error('The file could not be uploaded. Try again.')
  }

  const completePayload =
    uploadContentType && !contentType
      ? { fileName, contentType: uploadContentType, size }
      : payload

  try {
    const completed = await completeAudioUpload(
      await getAccessToken(),
      grant.uploadId,
      completePayload,
    )

    return completed.audio
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error
    }

    const retried = await completeAudioUpload(
      await getAccessToken(true),
      grant.uploadId,
      completePayload,
    )

    return retried.audio
  }
}

const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  weba: 'audio/webm',
  webm: 'audio/webm',
}
