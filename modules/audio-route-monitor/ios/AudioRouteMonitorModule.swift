import AVFAudio
import ExpoModulesCore

private let routeChangeEvent = "onBluetoothRouteChanged"

public final class AudioRouteMonitorModule: Module {
  private var knownBluetoothOutputIDs = Set<String>()

  public func definition() -> ModuleDefinition {
    Name("AudioRouteMonitor")

    Events(routeChangeEvent)

    OnStartObserving(routeChangeEvent) {
      self.knownBluetoothOutputIDs = self.bluetoothOutputIDs(
        in: AVAudioSession.sharedInstance().currentRoute
      )
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(self.handleRouteChange(_:)),
        name: AVAudioSession.routeChangeNotification,
        object: AVAudioSession.sharedInstance()
      )
    }

    OnStopObserving(routeChangeEvent) {
      NotificationCenter.default.removeObserver(
        self,
        name: AVAudioSession.routeChangeNotification,
        object: AVAudioSession.sharedInstance()
      )
      self.knownBluetoothOutputIDs.removeAll()
    }
  }

  @objc
  private func handleRouteChange(_ notification: Notification) {
    let currentIDs = bluetoothOutputIDs(
      in: AVAudioSession.sharedInstance().currentRoute
    )

    guard currentIDs != knownBluetoothOutputIDs else {
      return
    }

    let previousIDs = knownBluetoothOutputIDs
    knownBluetoothOutputIDs = currentIDs

    let reason: String
    if currentIDs.isEmpty {
      reason = "disconnected"
    } else if previousIDs.isEmpty {
      reason = "connected"
    } else {
      reason = "changed"
    }

    sendEvent(routeChangeEvent, [
      "connected": !currentIDs.isEmpty,
      "reason": reason
    ])
  }

  private func bluetoothOutputIDs(
    in route: AVAudioSessionRouteDescription
  ) -> Set<String> {
    Set(route.outputs.compactMap { output in
      switch output.portType {
      case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE:
        return output.uid
      default:
        return nil
      }
    })
  }
}
