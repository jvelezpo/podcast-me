export const PLAYLIST_STORAGE_KEY = 'podcast-me.playlists.v1';

/** A reference to a single audio inside a playlist, preserving playlist order. */
export type PlaylistAudioRef =
  | { kind: 'local'; audioId: string }
  | { kind: 'remote'; audioId: string };

/** Persisted user-created playlist. */
export type Playlist = {
  id: string;
  name: string;
  description: string | null;
  items: PlaylistAudioRef[];
  /** ISO 8601 timestamp for when the playlist was created. */
  createdAt: string;
  /** ISO 8601 timestamp for the playlist's most recent change. */
  updatedAt: string;
};

let fallbackIdSequence = 0;

/** Creates an ID once per playlist; persisting the returned value makes it stable. */
export function createPlaylistId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `playlist-${globalThis.crypto.randomUUID()}`;
  }

  fallbackIdSequence += 1;

  const timestamp = Date.now().toString(36);
  const sequence = fallbackIdSequence.toString(36);
  const random = Math.random().toString(36).slice(2);

  return `playlist-${timestamp}-${sequence}-${random}`;
}

/** Normalizes user input so empty names/descriptions are rejected consistently. */
export function normalizePlaylistName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizePlaylistDescription(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

/** Stable key used to de-duplicate and look up a playlist entry. */
export function playlistRefKey(ref: PlaylistAudioRef): string {
  return `${ref.kind}:${ref.audioId}`;
}

export function isPlaylistAudioRef(value: unknown): value is PlaylistAudioRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const ref = value as Record<string, unknown>;

  return (
    (ref.kind === 'local' || ref.kind === 'remote') &&
    typeof ref.audioId === 'string' &&
    ref.audioId.trim().length > 0
  );
}
