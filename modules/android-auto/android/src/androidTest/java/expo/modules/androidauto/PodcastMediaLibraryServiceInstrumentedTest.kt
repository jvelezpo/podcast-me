package expo.modules.androidauto

import android.content.ComponentName
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.media3.session.SessionResult
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@OptIn(UnstableApi::class)
@RunWith(AndroidJUnit4::class)
class PodcastMediaLibraryServiceInstrumentedTest {
  @Test
  fun mediaBrowserCanDiscoverSyncedRecordings() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val audioFile = File(context.filesDir, "android-auto-browser-test.mp3")
      .apply { writeBytes(byteArrayOf(1)) }
    AndroidAutoStore.syncLibrary(
      context,
      JSONArray().put(JSONObject().apply {
        put("id", "browser-test")
        put("originalName", "Browser test.mp3")
        put("localUri", audioFile.toURI().toString())
        put("mimeType", "audio/mpeg")
        put("durationSeconds", 60.0)
        put("lastPositionSeconds", 0.0)
        put("isPlayed", false)
        put("updatedAt", "2026-09-09T12:00:00.000Z")
      }).toString(),
    )

    val browser = onMainThread {
      MediaBrowser.Builder(
        context,
        SessionToken(context, ComponentName(context, PodcastMediaLibraryService::class.java)),
      ).buildAsync()
    }.get(10, TimeUnit.SECONDS)

    try {
      val root = onMainThread { browser.getLibraryRoot(null) }.get(10, TimeUnit.SECONDS)
      assertEquals(LibraryResult.RESULT_SUCCESS, root.resultCode)
      assertEquals(15_000L, onMainThread { browser.seekBackIncrement })
      assertEquals(15_000L, onMainThread { browser.seekForwardIncrement })

      val controls = onMainThread { browser.mediaButtonPreferences }
      assertEquals(
        listOf(CommandButton.ICON_SKIP_BACK_15, CommandButton.ICON_SKIP_FORWARD_15),
        controls.map { it.icon },
      )
      assertEquals(
        SessionResult.RESULT_SUCCESS,
        onMainThread {
          browser.sendCustomCommand(controls.first().sessionCommand!!, Bundle.EMPTY)
        }.get(10, TimeUnit.SECONDS).resultCode,
      )
      assertEquals(
        false,
        onMainThread { browser.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) },
      )

      val categories = onMainThread {
        browser.getChildren(root.value!!.mediaId, 0, 10, null)
      }
        .get(10, TimeUnit.SECONDS)
      assertEquals(LibraryResult.RESULT_SUCCESS, categories.resultCode)
      assertEquals("My recordings", categories.value!!.single().mediaMetadata.title)

      val recordings = onMainThread {
        browser.getChildren(categories.value!!.single().mediaId, 0, 10, null)
      }
        .get(10, TimeUnit.SECONDS)
      assertEquals(LibraryResult.RESULT_SUCCESS, recordings.resultCode)
      assertEquals("Browser test", recordings.value!!.single().mediaMetadata.title)
      assertEquals(
        "android.resource",
        recordings.value!!.single().mediaMetadata.artworkUri!!.scheme,
      )
    } finally {
      onMainThread { browser.release() }
      audioFile.delete()
    }
  }

  private fun <T> onMainThread(block: () -> T): T {
    val result = AtomicReference<T>()
    InstrumentationRegistry.getInstrumentation().runOnMainSync { result.set(block()) }
    return result.get()
  }
}
