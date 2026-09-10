import { NativeModule, requireOptionalNativeModule } from 'expo';

export type AndroidAutoPlaybackUpdate = {
  id: string;
  durationSeconds: number | null;
  lastPositionSeconds: number;
  isPlayed: boolean;
  updatedAtEpochMs: number;
};

declare class AndroidAutoNativeModule extends NativeModule {
  syncLibrary(serializedLibrary: string): Promise<void>;
  consumePlaybackUpdates(): Promise<string>;
  stopPlayback(): void;
}

const nativeModule =
  requireOptionalNativeModule<AndroidAutoNativeModule>('PodcastMeAndroidAuto');

export async function syncAndroidAutoLibrary(serializedLibrary: string): Promise<void> {
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
    return Array.isArray(updates) ? (updates as AndroidAutoPlaybackUpdate[]) : [];
  } catch {
    return [];
  }
}

export function stopAndroidAutoPlayback(): void {
  nativeModule?.stopPlayback();
}
