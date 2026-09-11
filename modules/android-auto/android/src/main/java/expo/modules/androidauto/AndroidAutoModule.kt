package expo.modules.androidauto

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AndroidAutoModule : Module() {
  private var playbackStateObserver: ((Map<String, Any?>) -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("PodcastMeAndroidAuto")

    Events(PLAYBACK_STATE_EVENT)

    OnStartObserving(PLAYBACK_STATE_EVENT) {
      val context = requireNotNull(appContext.reactContext)
      val observer: (Map<String, Any?>) -> Unit = { state ->
        sendEvent(PLAYBACK_STATE_EVENT, state)
      }
      playbackStateObserver = observer
      PodcastMediaLibraryService.observePlaybackState(context, observer)
    }

    OnStopObserving(PLAYBACK_STATE_EVENT) {
      playbackStateObserver?.let(PodcastMediaLibraryService::removePlaybackStateObserver)
      playbackStateObserver = null
    }

    OnDestroy {
      playbackStateObserver?.let(PodcastMediaLibraryService::removePlaybackStateObserver)
      playbackStateObserver = null
    }

    AsyncFunction("syncLibrary") { serializedLibrary: String ->
      val context = requireNotNull(appContext.reactContext)
      AndroidAutoStore.syncLibrary(context, serializedLibrary)
      PodcastMediaLibraryService.catalogChanged()
    }

    AsyncFunction("consumePlaybackUpdates") {
      val context = requireNotNull(appContext.reactContext)
      AndroidAutoStore.consumePlaybackUpdates(context)
    }

    AsyncFunction("getPlaybackState") {
      PodcastMediaLibraryService.currentPlaybackState(requireNotNull(appContext.reactContext))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("playItem") { mediaId: String, positionSeconds: Double, rate: Double ->
      PodcastMediaLibraryService.playFromPhone(
        mediaId,
        positionSeconds.toMilliseconds(),
        rate.toFloat(),
      )
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pausePlayback") {
      PodcastMediaLibraryService.pauseFromPhone()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { positionSeconds: Double ->
      PodcastMediaLibraryService.seekFromPhone(positionSeconds.toMilliseconds())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setPlaybackRate") { rate: Double ->
      PodcastMediaLibraryService.setPlaybackRateFromPhone(rate.toFloat())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("dismissPlayback") {
      PodcastMediaLibraryService.dismissFromPhone()
    }.runOnQueue(Queues.MAIN)

    Function("stopPlayback") {
      PodcastMediaLibraryService.stopPlaybackFromPhone()
    }
  }

  private fun Double.toMilliseconds(): Long =
    takeIf(Double::isFinite)?.times(1_000)?.toLong()?.coerceAtLeast(0) ?: 0

  private companion object {
    const val PLAYBACK_STATE_EVENT = "onPlaybackStateChanged"
  }
}
