package expo.modules.audioroutemonitor

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.os.bundleOf
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ROUTE_CHANGE_EVENT = "onBluetoothRouteChanged"

class AudioRouteMonitorModule : Module() {
  private var knownBluetoothOutputIds = emptySet<Int>()
  private var isObserving = false

  private val audioManager: AudioManager?
    get() = appContext.reactContext
      ?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  private val audioDeviceCallback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
      notifyIfBluetoothRouteChanged()
    }

    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      notifyIfBluetoothRouteChanged()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("AudioRouteMonitor")

    Events(ROUTE_CHANGE_EVENT)

    OnStartObserving(ROUTE_CHANGE_EVENT) {
      startObserving()
    }

    OnStopObserving(ROUTE_CHANGE_EVENT) {
      stopObserving()
    }

    OnDestroy {
      stopObserving()
    }
  }

  private fun startObserving() {
    if (isObserving || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return
    }

    val manager = audioManager ?: return
    knownBluetoothOutputIds = bluetoothOutputIds(manager)
    manager.registerAudioDeviceCallback(
      audioDeviceCallback,
      Handler(Looper.getMainLooper())
    )
    isObserving = true
  }

  private fun stopObserving() {
    if (!isObserving) {
      return
    }

    audioManager?.unregisterAudioDeviceCallback(audioDeviceCallback)
    knownBluetoothOutputIds = emptySet()
    isObserving = false
  }

  private fun notifyIfBluetoothRouteChanged() {
    val manager = audioManager ?: return
    val currentIds = bluetoothOutputIds(manager)

    if (currentIds == knownBluetoothOutputIds) {
      return
    }

    val previousIds = knownBluetoothOutputIds
    knownBluetoothOutputIds = currentIds

    val reason = when {
      currentIds.isEmpty() -> "disconnected"
      previousIds.isEmpty() -> "connected"
      else -> "changed"
    }

    sendEvent(
      ROUTE_CHANGE_EVENT,
      bundleOf(
        "connected" to currentIds.isNotEmpty(),
        "reason" to reason
      )
    )
  }

  private fun bluetoothOutputIds(manager: AudioManager): Set<Int> =
    manager
      .getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      .asSequence()
      .filter(::isBluetoothOutput)
      .map(AudioDeviceInfo::getId)
      .toSet()

  private fun isBluetoothOutput(device: AudioDeviceInfo): Boolean {
    if (!device.isSink) {
      return false
    }

    return when (device.type) {
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_HEARING_AID -> true
      else -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        (device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
          device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER ||
          (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            device.type == AudioDeviceInfo.TYPE_BLE_BROADCAST))
    }
  }
}
