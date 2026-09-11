package expo.modules.androidauto

import android.content.Context
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class PodcastMediaLibraryServiceTest {
  @Test
  fun phoneStartupRegistersSessionWithoutACarController() {
    val controller = Robolectric.buildService(PodcastMediaLibraryService::class.java).create()
    try {
      // Phone playback uses the bridge, so no MediaBrowser calls onGetSession.
      assertEquals(1, controller.get().sessions.size)
    } finally {
      controller.destroy()
    }
  }

  @Test
  fun foregroundRefreshRestartsDestroyedServiceForExistingObserver() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    var state: Map<String, Any?>? = null
    val observer: (Map<String, Any?>) -> Unit = { state = it }
    val controller = Robolectric.buildService(PodcastMediaLibraryService::class.java).create()
    PodcastMediaLibraryService.observePlaybackState(context, observer)
    shadowOf(Looper.getMainLooper()).idle()
    assertEquals(true, state?.get("serviceReady"))

    controller.destroy()
    assertEquals(false, state?.get("serviceReady"))

    val application = shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>())
    assertNull(application.nextStartedService)
    assertEquals(false, PodcastMediaLibraryService.currentPlaybackState(context)["serviceReady"])
    assertEquals(
      PodcastMediaLibraryService::class.java.name,
      application.nextStartedService.component?.className,
    )

    val restarted = Robolectric.buildService(PodcastMediaLibraryService::class.java).create()
    try {
      assertEquals(true, state?.get("serviceReady"))
      assertEquals(true, PodcastMediaLibraryService.currentPlaybackState(context)["serviceReady"])
      assertNull(application.nextStartedService)
    } finally {
      PodcastMediaLibraryService.removePlaybackStateObserver(observer)
      shadowOf(Looper.getMainLooper()).idle()
      restarted.destroy()
    }
  }
}
