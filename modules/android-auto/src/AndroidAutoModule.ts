import { NativeModule, requireOptionalNativeModule } from "expo";

export type AndroidAutoPlaybackUpdate = {
  id: string;
  durationSeconds: number | null;
  lastPositionSeconds: number;
  isPlayed: boolean;
  updatedAtEpochMs: number;
};

export type AndroidAutoPlaybackState = {
  serviceReady: boolean;
  mediaId: string | null;
  currentPositionSeconds: number;
  durationSeconds: number | null;
  isPlaying: boolean;
  isLoaded: boolean;
  isEnded: boolean;
  playbackRate: number;
  error: string | null;
};

type AndroidAutoEvents = {
  onPlaybackStateChanged(state: AndroidAutoPlaybackState): void;
};

type AndroidAutoSubscription = {
  remove(): void;
};

declare class AndroidAutoNativeModule extends NativeModule<AndroidAutoEvents> {
  syncLibrary(serializedLibrary: string): Promise<void>;
  consumePlaybackUpdates(): Promise<string>;
  getPlaybackState(): Promise<AndroidAutoPlaybackState>;
  playItem(
    mediaId: string,
    positionSeconds: number,
    rate: number,
  ): Promise<boolean>;
  pausePlayback(): Promise<boolean>;
  seekTo(positionSeconds: number): Promise<boolean>;
  setPlaybackRate(rate: number): Promise<boolean>;
  dismissPlayback(): Promise<boolean>;
  stopPlayback(): void;
}

const nativeModule = requireOptionalNativeModule<AndroidAutoNativeModule>(
  "PodcastMeAndroidAuto",
);

export async function syncAndroidAutoLibrary(
  serializedLibrary: string,
): Promise<void> {
  await nativeModule?.syncLibrary(serializedLibrary);
}

export async function consumeAndroidAutoPlaybackUpdates(): Promise<
  AndroidAutoPlaybackUpdate[]
> {
  const serializedUpdates = await nativeModule?.consumePlaybackUpdates();

  if (!serializedUpdates) {
    return [];
  }

  try {
    const updates: unknown = JSON.parse(serializedUpdates);
    return Array.isArray(updates)
      ? (updates as AndroidAutoPlaybackUpdate[])
      : [];
  } catch {
    return [];
  }
}

export function stopAndroidAutoPlayback(): void {
  nativeModule?.stopPlayback();
}

export function observeAndroidAutoPlaybackState(
  listener: (state: AndroidAutoPlaybackState) => void,
): AndroidAutoSubscription {
  return (
    nativeModule?.addListener("onPlaybackStateChanged", listener) ?? {
      remove() {},
    }
  );
}

export async function getAndroidAutoPlaybackState(): Promise<AndroidAutoPlaybackState> {
  return (await nativeModule?.getPlaybackState()) ?? EMPTY_PLAYBACK_STATE;
}

export async function playAndroidAutoItem(
  mediaId: string,
  positionSeconds: number,
  rate: number,
): Promise<boolean> {
  return (
    (await nativeModule?.playItem(mediaId, positionSeconds, rate)) ?? false
  );
}

export async function pauseAndroidAutoPlayback(): Promise<boolean> {
  return (await nativeModule?.pausePlayback()) ?? false;
}

export async function seekAndroidAutoPlayback(
  positionSeconds: number,
): Promise<boolean> {
  return (await nativeModule?.seekTo(positionSeconds)) ?? false;
}

export async function setAndroidAutoPlaybackRate(
  rate: number,
): Promise<boolean> {
  return (await nativeModule?.setPlaybackRate(rate)) ?? false;
}

export async function dismissAndroidAutoPlayback(): Promise<boolean> {
  return (await nativeModule?.dismissPlayback()) ?? false;
}

const EMPTY_PLAYBACK_STATE: AndroidAutoPlaybackState = {
  serviceReady: false,
  mediaId: null,
  currentPositionSeconds: 0,
  durationSeconds: null,
  isPlaying: false,
  isLoaded: false,
  isEnded: false,
  playbackRate: 1,
  error: null,
};
