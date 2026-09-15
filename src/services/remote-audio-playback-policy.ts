export function shouldTrackRemoteAudioPosition(metadata: unknown): boolean {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    Array.isArray(metadata)
  ) {
    return false
  }

  return (metadata as { type?: unknown }).type === 'episode'
}
