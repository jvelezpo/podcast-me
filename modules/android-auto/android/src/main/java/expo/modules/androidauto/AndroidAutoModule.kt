package expo.modules.androidauto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AndroidAutoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PodcastMeAndroidAuto")

    AsyncFunction("syncLibrary") { serializedLibrary: String ->
      val context = requireNotNull(appContext.reactContext)
      AndroidAutoStore.syncLibrary(context, serializedLibrary)
      PodcastMediaLibraryService.catalogChanged()
    }

    AsyncFunction("consumePlaybackUpdates") {
      val context = requireNotNull(appContext.reactContext)
      AndroidAutoStore.consumePlaybackUpdates(context)
    }

    Function("stopPlayback") {
      PodcastMediaLibraryService.stopPlaybackFromPhone()
    }
  }
}
