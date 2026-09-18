import type { RemoteAudioMetadataUpdate } from '@/services/api'

export type LocalAudioMetadata = {
  title: string | null | undefined
  artist: string | null | undefined
  album: string | null | undefined
  releaseYear: string | null | undefined
  coverArtUrl: string | null | undefined
  description: string | null | undefined
}

/**
 * Maps app-owned metadata to a server metadata update.
 *
 * Only explicit, valid values are sent: the server derives title and tags
 * from the file itself, so blank local fields must not overwrite them.
 * Release years must be four digits and artwork must be an http(s) URL,
 * matching the server validation. Returns null when there is nothing
 * worth sending (also saves a rate-limited request).
 */
export function buildRemoteMetadataUpdate(
  metadata: LocalAudioMetadata,
): RemoteAudioMetadataUpdate | null {
  const update: RemoteAudioMetadataUpdate = {}
  const title = metadata.title?.trim()
  const artist = metadata.artist?.trim()
  const album = metadata.album?.trim()
  const releaseYear = metadata.releaseYear?.trim()
  const coverArtUrl = metadata.coverArtUrl?.trim()
  const description = metadata.description?.trim()

  if (title) {
    update.title = title
  }

  if (artist) {
    update.artist = artist
  }

  if (album) {
    update.album = album
  }

  if (releaseYear && /^\d{4}$/.test(releaseYear)) {
    update.releaseYear = releaseYear
  }

  if (coverArtUrl && /^https?:\/\//i.test(coverArtUrl)) {
    update.coverArtUrl = coverArtUrl
  }

  if (description) {
    update.description = description
  }

  return Object.keys(update).length > 0 ? update : null
}
