export const AUDIO_LIBRARY_STORAGE_KEY = 'podcast-me.audio-library.v1';

export type AudioMetadata = {
  title: string | null;
  artist: string | null;
  album: string | null;
  releaseYear: string | null;
  genre: string | null;
  coverArtUrl: string | null;
  description: string | null;
};

export const EMPTY_AUDIO_METADATA: AudioMetadata = {
  title: null,
  artist: null,
  album: null,
  releaseYear: null,
  genre: null,
  coverArtUrl: null,
  description: null,
};

/** Persisted metadata for one app-owned audio file. */
export type AudioItem = {
  id: string;
  originalName: string;
  localUri: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** Lowercase MD5 of the app-owned copy, used only to prevent duplicate imports. */
  contentFingerprint: string | null;
  /** Total playback duration in seconds, or null until the player reports it. */
  durationSeconds: number | null;
  /** Resume position in seconds. */
  lastPositionSeconds: number;
  /** Whether the listener has completed this audio at least once. */
  isPlayed: boolean;
  /** Optional listener-provided information about this audio. */
  metadata: AudioMetadata;
  /** ISO 8601 timestamp for when the item was imported. */
  addedAt: string;
  /** ISO 8601 timestamp for the item's most recent metadata change. */
  updatedAt: string;
};

let fallbackIdSequence = 0;

/** Creates an ID once per import; persisting the returned value makes it stable. */
export function createAudioItemId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `audio-${globalThis.crypto.randomUUID()}`;
  }

  fallbackIdSequence += 1;

  const timestamp = Date.now().toString(36);
  const sequence = fallbackIdSequence.toString(36);
  const random = Math.random().toString(36).slice(2);

  return `audio-${timestamp}-${sequence}-${random}`;
}

/** Builds an app-owned filename that cannot collide solely because display names match. */
export function createAudioLibraryFilename(itemId: string, originalName: string): string {
  const extension = /\.([a-zA-Z0-9]{1,10})$/.exec(originalName.trim())?.[1]?.toLowerCase();

  return extension ? `${itemId}.${extension}` : itemId;
}
