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
export function getQueueEntryId(entry: QueueEntry): string {
  return entry.kind === 'local' ? entry.item.id : entry.audio.id
}

/** Stable identity used to detect membership/order changes. */
export function getQueueEntryKey(entry: QueueEntry): string {
  return `${entry.kind}:${getQueueEntryId(entry)}`
}

/** True when both lists contain the same entries in the same order. */
export function hasSameQueueOrder(
  a: readonly QueueEntry[],
  b: readonly QueueEntry[],
): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => getQueueEntryKey(entry) === getQueueEntryKey(b[index]))
  )
}

/**
 * Moves one entry by an offset, clamping at the ends. Returns a new array;
 * unknown ids return the input unchanged.
 */
export function reorderQueueEntries(
  entries: readonly QueueEntry[],
  kind: QueueEntry['kind'],
  id: string,
  offset: number,
): QueueEntry[] {
  const fromIndex = findQueueEntryIndex(entries, kind, id)

  if (fromIndex < 0 || offset === 0) {
    return [...entries]
  }

  const toIndex = Math.min(
    Math.max(fromIndex + offset, 0),
    entries.length - 1,
  )

  if (toIndex === fromIndex) {
    return [...entries]
  }

  const next = [...entries]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

/**
 * Drops one entry from the queue. Returns a new array; unknown ids return
 * the input unchanged.
 */
export function removeQueueEntry(
  entries: readonly QueueEntry[],
  kind: QueueEntry['kind'],
  id: string,
): QueueEntry[] {
  const index = findQueueEntryIndex(entries, kind, id)

  if (index < 0) {
    return [...entries]
  }

  return entries.filter((_, entryIndex) => entryIndex !== index)
}

export function isQueueEntryPlayable(
  entry: QueueEntry,
  isOnline: boolean,
): boolean {
  return entry.kind === 'local'
    ? entry.item.isAvailable
    : isOnline || entry.isCached
}

function findQueueEntryIndex(
  entries: readonly QueueEntry[],
  kind: QueueEntry['kind'],
  id: string,
): number {
  return entries.findIndex((entry) =>
    kind === 'local'
      ? entry.kind === 'local' && entry.item.id === id
      : entry.kind === 'remote' && entry.audio.id === id,
  )
}

export function findNextQueueEntry(
  entries: readonly QueueEntry[],
  finishedKind: QueueEntry['kind'],
  finishedId: string,
  isOnline: boolean,
): QueueEntry | null {
  const finishedIndex = findQueueEntryIndex(entries, finishedKind, finishedId)

  if (finishedIndex < 0) {
    return null
  }

  for (let index = finishedIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index]

    if (isQueueEntryPlayable(entry, isOnline)) {
      return entry
    }
  }

  return null
}

/**
 * Finds the previous playable entry before the current audio in list order.
 *
 * Mirrors {@link findNextQueueEntry}: unavailable local entries and
 * offline uncached remote entries are skipped. There is no wrap-around:
 * the first entry has no previous, so the button stays on the current audio.
 */
export function findPreviousQueueEntry(
  entries: readonly QueueEntry[],
  currentKind: QueueEntry['kind'],
  currentId: string,
  isOnline: boolean,
): QueueEntry | null {
  const currentIndex = findQueueEntryIndex(entries, currentKind, currentId)

  if (currentIndex < 0) {
    return null
  }

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const entry = entries[index]

    if (isQueueEntryPlayable(entry, isOnline)) {
      return entry
    }
  }

  return null
}
