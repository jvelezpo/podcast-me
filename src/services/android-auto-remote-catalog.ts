import { syncAndroidAutoRemoteLibrary } from '../../modules/android-auto'

import type { AndroidAutoRemoteCatalogEntry } from '@/services/android-auto-remote-sync'

/**
 * JS-side mirror of the remote half of the Android Auto catalog snapshot.
 *
 * The car plays from its snapshot while the phone is locked, and device
 * playback on Android now runs on the same shared ExoPlayer, so playing a
 * cloud audio from the phone must first pin its freshly resolved source
 * (token/URL/file) into the snapshot — otherwise `playFromPhone` finds no
 * `remote:<id>` row and the play fails while the car UI stays stale.
 *
 * Full pushes (auth context) replace the mirror; per-play upserts merge one
 * fresh row over it. Upserts serialize through a tail so concurrent plays
 * cannot interleave a read-modify-write and drop a row. Play-time sources
 * are always the freshest credentials, so last-writer-wins is correct in
 * both orders.
 */
let remoteCatalogSnapshot: AndroidAutoRemoteCatalogEntry[] = []
let syncTail: Promise<void> = Promise.resolve()

export function setAndroidAutoRemoteCatalogSnapshot(
  entries: readonly AndroidAutoRemoteCatalogEntry[],
): void {
  remoteCatalogSnapshot = [...entries]
}

export function getAndroidAutoRemoteCatalogSnapshot(): AndroidAutoRemoteCatalogEntry[] {
  return [...remoteCatalogSnapshot]
}

export function upsertAndroidAutoRemoteCatalogEntry(
  entry: AndroidAutoRemoteCatalogEntry,
): Promise<void> {
  const pending = syncTail.then(async () => {
    remoteCatalogSnapshot = [
      ...remoteCatalogSnapshot.filter(
        (candidate) => candidate.id !== entry.id,
      ),
      entry,
    ]
    await syncAndroidAutoRemoteLibrary(
      JSON.stringify(remoteCatalogSnapshot),
    ).catch(() => undefined)
  })
  syncTail = pending.catch(() => undefined)
  return pending
}
