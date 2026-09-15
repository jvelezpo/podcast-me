import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY_PREFIX = 'podcast-me.remote-audio-position.v1.'

let writeTail: Promise<void> = Promise.resolve()

export async function loadRemoteAudioPosition(audioId: string): Promise<number> {
  await writeTail

  try {
    const storedValue = await AsyncStorage.getItem(getKey(audioId))
    const position = storedValue === null ? 0 : Number(storedValue)
    return Number.isFinite(position) && position >= 0 ? position : 0
  } catch {
    return 0
  }
}

export function saveRemoteAudioPosition(
  audioId: string,
  positionSeconds: number,
): Promise<void> {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return Promise.resolve()
  }

  const write = writeTail.then(() =>
    AsyncStorage.setItem(getKey(audioId), String(positionSeconds)),
  )
  writeTail = write.catch(() => undefined)
  return write
}

function getKey(audioId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(audioId)}`
}
