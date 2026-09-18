import type { RemoteAudio } from '@/services/api';
import type { LoadedAudioItem } from '@/services/audio-library-storage';
import type { Playlist } from '@/models/playlist';
import type { QueueEntry } from '@/services/playback-queue';

/**
 * Resolves a playlist's ordered refs against the current library state.
 * Missing entries are skipped so deleted audios never break playback order.
 */
export function resolvePlaylistEntries(
  playlist: Playlist,
  localItems: readonly LoadedAudioItem[],
  remoteAudios: readonly RemoteAudio[],
  cachedRemoteIds: ReadonlySet<string>
): QueueEntry[] {
  const localById = new Map(localItems.map((item) => [item.id, item] as const));
  const remoteById = new Map(remoteAudios.map((audio) => [audio.id, audio] as const));
  const entries: QueueEntry[] = [];

  for (const ref of playlist.items) {
    if (ref.kind === 'local') {
      const item = localById.get(ref.audioId);

      if (item) {
        entries.push({ kind: 'local', item });
      }
    } else {
      const audio = remoteById.get(ref.audioId);

      if (audio) {
        entries.push({ kind: 'remote', audio, isCached: cachedRemoteIds.has(audio.id) });
      }
    }
  }

  return entries;
}

/** Counts playable entries; used for playlist subtitles and "Up next" labels. */
export function countPlayableEntries(entries: readonly QueueEntry[], isOnline: boolean): number {
  return entries.filter((entry) =>
    entry.kind === 'local' ? entry.item.isAvailable : isOnline || entry.isCached
  ).length;
}
