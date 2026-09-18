import type { RemoteAudio } from '@/services/api'
import type { LoadedAudioItem } from '@/services/audio-library-storage'

export type QueueEntry =
  | { kind: 'local'; item: LoadedAudioItem }
  | { kind: 'remote'; audio: RemoteAudio; isCached: boolean }

/**
 * Finds the next playable entry after the finished audio in list order.
 *
 * Local entries must be available. Remote entries require connectivity unless
 * already downloaded. There is no wrap-around: the last entry has no next,
 * so playback stops instead of looping forever.
 */
export function findNextQueueEntry(
  entries: readonly QueueEntry[],
  finishedKind: QueueEntry['kind'],
  finishedId: string,
  isOnline: boolean,
): QueueEntry | null {
  const finishedIndex = entries.findIndex((entry) =>
    finishedKind === 'local'
      ? entry.kind === 'local' && entry.item.id === finishedId
      : entry.kind === 'remote' && entry.audio.id === finishedId,
  )

  if (finishedIndex < 0) {
    return null
  }

  for (let index = finishedIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index]

    if (entry.kind === 'local') {
      if (entry.item.isAvailable) {
        return entry
      }
      continue
    }

    if (isOnline || entry.isCached) {
      return entry
    }
  }

  return null
}
