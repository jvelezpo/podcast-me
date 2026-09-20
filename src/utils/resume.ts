/**
 * Continue-listening derivation shared by the Library hero and tests.
 *
 * The resume candidate is the unfinished item with the greatest saved
 * position: finished episodes reset `lastPositionSeconds` to 0, so the max
 * naturally skips them, and `isPlayed` excludes anything marked complete.
 */
export type ResumeCandidate = {
  isPlayed: boolean
  lastPositionSeconds: number
}

export function findResumeItem<T extends ResumeCandidate>(
  items: readonly T[],
): T | null {
  let best: T | null = null

  for (const item of items) {
    if (item.isPlayed || item.lastPositionSeconds <= 0) {
      continue
    }

    if (best === null || item.lastPositionSeconds > best.lastPositionSeconds) {
      best = item
    }
  }

  return best
}
