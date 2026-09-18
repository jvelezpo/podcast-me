export type ReconciliableLocalAudio = {
  id: string
  remoteAudioId: string | null | undefined
  isAvailable: boolean
}

export type ReconciliableRemoteAudio = {
  id: string
}

export type AudioReconciliation = {
  /** Ids present in the current cloud list. */
  remoteIds: Set<string>
  /** Local item ids considered already uploaded. */
  uploadedLocalIds: Set<string>
  /** Remote ids claimed by an available local copy; shown once as local. */
  hiddenRemoteIds: Set<string>
}

/**
 * Reconciles device audios with the account-library list by unique id.
 *
 * A local item is "uploaded" when its stored remote id still appears in the
 * cloud list. When online and the id is absent, the cloud copy is treated as
 * deleted, so the item becomes uploadable again. While offline the stored id
 * cannot be verified, so the item keeps its uploaded state instead of
 * offering a duplicate upload.
 *
 * A remote entry claimed by an available local copy is hidden so each audio
 * appears only once, preferring the locally stored copy.
 */
export function reconcileLibraryAudio(
  localItems: readonly ReconciliableLocalAudio[],
  remoteAudios: readonly ReconciliableRemoteAudio[] | null,
  isOnline: boolean,
): AudioReconciliation {
  const remoteIds = new Set((remoteAudios ?? []).map((audio) => audio.id))
  const uploadedLocalIds = new Set<string>()
  const hiddenRemoteIds = new Set<string>()

  for (const item of localItems) {
    if (!item.remoteAudioId) {
      continue
    }

    if (remoteIds.has(item.remoteAudioId)) {
      uploadedLocalIds.add(item.id)

      if (item.isAvailable) {
        hiddenRemoteIds.add(item.remoteAudioId)
      }
    } else if (!isOnline) {
      uploadedLocalIds.add(item.id)
    }
  }

  return { remoteIds, uploadedLocalIds, hiddenRemoteIds }
}
