import { NativeModule, requireOptionalNativeModule } from 'expo';

export type BluetoothRouteChangeEvent = {
  connected: boolean;
  reason: 'connected' | 'disconnected' | 'changed';
};

type AudioRouteMonitorEvents = {
  onBluetoothRouteChanged(event: BluetoothRouteChangeEvent): void;
};

declare class AudioRouteMonitorNativeModule extends NativeModule<AudioRouteMonitorEvents> {}

const nativeModule =
  requireOptionalNativeModule<AudioRouteMonitorNativeModule>('AudioRouteMonitor');

export function addBluetoothRouteChangeListener(
  listener: (event: BluetoothRouteChangeEvent) => void
) {
  return nativeModule?.addListener('onBluetoothRouteChanged', listener) ?? {
    remove() {},
  };
}
