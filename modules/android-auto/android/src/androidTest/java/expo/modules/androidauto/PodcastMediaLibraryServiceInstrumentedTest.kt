package expo.modules.androidauto

import android.app.ActivityManager
import android.app.Activity
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.media.session.MediaController
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.media3.session.SessionResult
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.xmlpull.v1.XmlPullParser
import android.media.browse.MediaBrowser as LegacyMediaBrowser

@OptIn(UnstableApi::class)
@RunWith(AndroidJUnit4::class)
// Run the cold car launch before any phone test makes this UID foreground.
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class PodcastMediaLibraryServiceInstrumentedTest {
  @Test
  fun androidAutoCanDiscoverBrowseAndControlPlaybackWithoutOpeningPhone() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val services = context.packageManager.queryIntentServices(
      Intent("android.media.browse.MediaBrowserService").setPackage(context.packageName),
      PackageManager.GET_META_DATA,
    )
    val service = services.single {
      it.serviceInfo.name == PodcastMediaLibraryService::class.java.name
    }
    assertTrue(service.serviceInfo.exported)
    val application = context.packageManager.getApplicationInfo(
      context.packageName,
      PackageManager.GET_META_DATA,
    )
    val descriptor = application.metaData.getInt("com.google.android.gms.car.application")
    assertTrue("Missing Android Auto media descriptor", descriptor != 0)
    context.resources.getXml(descriptor).use { xml ->
      var supportsMedia = false
      while (xml.next() != XmlPullParser.END_DOCUMENT) {
        if (xml.eventType == XmlPullParser.START_TAG && xml.name == "uses") {
          supportsMedia = supportsMedia || xml.getAttributeValue(null, "name") == "media"
        }
      }
      assertTrue("Android Auto descriptor must declare media support", supportsMedia)
    }

    val serviceIntent = Intent(context, PodcastMediaLibraryService::class.java)
    context.stopService(serviceIntent)
    InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    val audioFile = File(context.filesDir, "android-auto-legacy-test.wav")
      .apply { writeBytes(silentWave(durationSeconds = 60)) }
    AndroidAutoStore.syncLibrary(context, JSONArray().put(JSONObject().apply {
      put("id", "legacy-test")
      put("originalName", "Car recording.wav")
      put("localUri", audioFile.toURI().toString())
      put("mimeType", "audio/wav")
      put("durationSeconds", 60.0)
      put("lastPositionSeconds", 12.0)
      put("isPlayed", false)
      put("updatedAt", "2026-09-09T12:00:00.000Z")
    }).toString())
    val connected = CompletableFuture<Unit>()
    val browser = onMainThread {
      LegacyMediaBrowser(
        context,
        ComponentName(context.packageName, service.serviceInfo.name),
        object : LegacyMediaBrowser.ConnectionCallback() {
          override fun onConnected() {
            connected.complete(Unit)
          }

          override fun onConnectionFailed() {
            connected.completeExceptionally(AssertionError("Car browser connection failed"))
          }
        },
        null,
      ).also { it.connect() }
    }
    try {
      connected.get(10, TimeUnit.SECONDS)
      val categories = legacyChildren(browser, onMainThread { browser.root })
      assertEquals("My recordings", categories.single().description.title.toString())
      val recordings = legacyChildren(browser, categories.single().mediaId!!)
      assertEquals("Car recording", recordings.single().description.title.toString())
      assertTrue(recordings.single().isPlayable)
      val controller = onMainThread { MediaController(context, browser.sessionToken) }
      onMainThread { controller.transportControls.playFromMediaId("legacy-test", null) }
      awaitCondition { controller.playbackState?.state == PlaybackState.STATE_PLAYING }
      assertTrue(controller.playbackState!!.position >= 12_000)
      val activityManager = context.getSystemService(ActivityManager::class.java)
      awaitCondition {
        activityManager.getRunningServices(Int.MAX_VALUE).any {
          it.service.className == PodcastMediaLibraryService::class.java.name && it.foreground
        }
      }
      // The startup notification must be replaced by Media3's normal controls.
      val notificationManager = context.getSystemService(NotificationManager::class.java)
      awaitCondition {
        notificationManager.activeNotifications.any {
          it.id == DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID &&
            (it.notification.actions?.size ?: 0) >= 3
        }
      }
      onMainThread { controller.transportControls.pause() }
      awaitCondition { controller.playbackState?.state == PlaybackState.STATE_PAUSED }
      onMainThread { controller.transportControls.seekTo(20_000) }
      awaitCondition { controller.playbackState?.position == 20_000L }
      onMainThread {
        controller.transportControls.sendCustomAction("expo.modules.androidauto.SEEK_FORWARD_15", null)
      }
      awaitCondition { controller.playbackState?.position == 35_000L }
      onMainThread {
        controller.transportControls.sendCustomAction("expo.modules.androidauto.SEEK_BACK_15", null)
      }
      awaitCondition { controller.playbackState?.position == 20_000L }
    } finally {
      onMainThread { browser.disconnect() }
      context.stopService(serviceIntent)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      audioFile.delete()
    }
  }

  private fun legacyChildren(
    browser: LegacyMediaBrowser,
    parentId: String,
  ): List<LegacyMediaBrowser.MediaItem> {
    val result = CompletableFuture<List<LegacyMediaBrowser.MediaItem>>()
    onMainThread {
      browser.subscribe(parentId, object : LegacyMediaBrowser.SubscriptionCallback() {
        override fun onChildrenLoaded(
          parentId: String,
          children: MutableList<LegacyMediaBrowser.MediaItem>,
        ) {
          result.complete(children)
        }

        override fun onError(parentId: String) {
          result.completeExceptionally(AssertionError("Car could not browse $parentId"))
        }
      })
    }
    return result.get(10, TimeUnit.SECONDS)
  }

  @Test
  fun phonePlaybackStaysInForegroundWithoutACarAndRecoversAfterServiceStops() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext
    val activityIntent = Intent(context, Activity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    var activity = instrumentation.startActivitySync(activityIntent)
    val serviceIntent = Intent(context, PodcastMediaLibraryService::class.java)
    context.stopService(serviceIntent)
    InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    val audioFile = File(context.filesDir, "phone-background-test.wav")
      .apply { writeBytes(silentWave(durationSeconds = 180)) }
    AndroidAutoStore.syncLibrary(
      context,
      JSONArray().put(JSONObject().apply {
        put("id", "phone-test")
        put("originalName", "Phone test.wav")
        put("localUri", audioFile.toURI().toString())
        put("mimeType", "audio/wav")
        put("durationSeconds", 180.0)
        put("lastPositionSeconds", 0.0)
        put("isPlayed", false)
        put("updatedAt", "2026-09-09T12:00:00.000Z")
      }).toString(),
    )
    val observedState = AtomicReference<Map<String, Any?>>(emptyMap())
    val observer: (Map<String, Any?>) -> Unit = observedState::set
    try {
      // Match the phone bridge without connecting a car/browser controller.
      PodcastMediaLibraryService.observePlaybackState(context, observer)
      awaitCondition { observedState.get()["serviceReady"] == true }
      assertTrue(onMainThread {
        PodcastMediaLibraryService.playFromPhone("phone-test", 0, 1f)
      })
      awaitCondition { observedState.get()["isPlaying"] == true }
      val activityManager = context.getSystemService(ActivityManager::class.java)
      awaitCondition {
        activityManager.getRunningServices(Int.MAX_VALUE).any {
          it.service.className == PodcastMediaLibraryService::class.java.name && it.foreground
        }
      }
      onMainThread { activity.finish() }
      instrumentation.waitForIdleSync()

      // Exercise the reported roughly one-minute background cutoff.
      Thread.sleep(75_000)
      assertEquals(true, observedState.get()["isPlaying"])
      assertTrue((observedState.get()["currentPositionSeconds"] as Double) >= 70)

      context.stopService(serviceIntent)
      awaitCondition { observedState.get()["serviceReady"] == false }
      activity = instrumentation.startActivitySync(activityIntent)
      onMainThread { PodcastMediaLibraryService.currentPlaybackState(context) }
      awaitCondition { observedState.get()["serviceReady"] == true }
      assertEquals(false, observedState.get()["isPlaying"])
      val savedPosition = AndroidAutoStore.catalog(context).single().positionMs
      assertTrue(savedPosition >= 70_000)
      assertTrue(onMainThread {
        PodcastMediaLibraryService.playFromPhone("phone-test", savedPosition, 1f)
      })
      awaitCondition { observedState.get()["isPlaying"] == true }
      assertTrue((observedState.get()["currentPositionSeconds"] as Double) >= 70)
    } finally {
      PodcastMediaLibraryService.removePlaybackStateObserver(observer)
      context.stopService(serviceIntent)
      onMainThread { activity.finish() }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      audioFile.delete()
    }
  }

  @Test
  fun mediaBrowserCanDiscoverSyncedRecordings() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val audioFile = File(context.filesDir, "android-auto-browser-test.wav")
      .apply { writeBytes(silentWave(durationSeconds = 60)) }
    AndroidAutoStore.syncLibrary(
      context,
      JSONArray().put(JSONObject().apply {
        put("id", "browser-test")
        put("originalName", "Browser test.wav")
        put("localUri", audioFile.toURI().toString())
        put("mimeType", "audio/wav")
        put("durationSeconds", 60.0)
        put("lastPositionSeconds", 0.0)
        put("isPlayed", false)
        put("metadata", JSONObject().put("title", JSONObject.NULL))
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
      // Next/Prev track controls are exposed so car buttons, BT/headset
      // double-press, and lock-screen controls can traverse the queue.
      assertEquals(
        true,
        onMainThread { browser.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) },
      )
      assertEquals(
        true,
        onMainThread { browser.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT) },
      )
      assertEquals(
        true,
        onMainThread { browser.isCommandAvailable(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) },
      )
      assertEquals(
        true,
        onMainThread { browser.isCommandAvailable(Player.COMMAND_SEEK_TO_PREVIOUS) },
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

      val observedState = AtomicReference<Map<String, Any?>>()
      val observer: (Map<String, Any?>) -> Unit = observedState::set
      PodcastMediaLibraryService.observePlaybackState(context, observer)
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      assertEquals(true, observedState.get()["serviceReady"])

      assertTrue(onMainThread {
        PodcastMediaLibraryService.playFromPhone("browser-test", 12_000, 1.5f)
      })
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      assertEquals("browser-test", onMainThread { browser.currentMediaItem?.mediaId })
      assertEquals("browser-test", observedState.get()["mediaId"])
      assertEquals(1.5, observedState.get()["playbackRate"])

      onMainThread { browser.pause() }
      onMainThread { browser.seekTo(20_000) }
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      assertEquals(20.0, observedState.get()["currentPositionSeconds"])

      assertTrue(onMainThread { PodcastMediaLibraryService.dismissFromPhone() })
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
      assertNull(onMainThread { browser.currentMediaItem })
      assertNull(observedState.get()["mediaId"])
      PodcastMediaLibraryService.removePlaybackStateObserver(observer)

      val bridgeError = AtomicReference<Throwable?>()
      Thread {
        try {
          PodcastMediaLibraryService.catalogChanged()
          PodcastMediaLibraryService.stopPlaybackFromPhone()
        } catch (error: Throwable) {
          bridgeError.set(error)
        }
      }.apply {
        start()
        join()
      }
      assertNull(bridgeError.get())
      InstrumentationRegistry.getInstrumentation().waitForIdleSync()
    } finally {
      onMainThread { browser.release() }
      audioFile.delete()
    }
  }

  private fun awaitCondition(condition: () -> Boolean) {
    val deadline = SystemClock.elapsedRealtime() + 10_000
    while (!condition() && SystemClock.elapsedRealtime() < deadline) {
      Thread.sleep(100)
    }
    assertTrue("Timed out waiting for playback service state", condition())
  }

  private fun <T> onMainThread(block: () -> T): T {
    val result = AtomicReference<T>()
    InstrumentationRegistry.getInstrumentation().runOnMainSync { result.set(block()) }
    return result.get()
  }

  private fun silentWave(durationSeconds: Int): ByteArray {
    val sampleRate = 8_000
    val channelCount = 1
    val bytesPerSample = 2
    val dataSize = durationSeconds * sampleRate * channelCount * bytesPerSample
    return ByteBuffer.allocate(44 + dataSize)
      .order(ByteOrder.LITTLE_ENDIAN)
      .apply {
        put("RIFF".toByteArray())
        putInt(36 + dataSize)
        put("WAVE".toByteArray())
        put("fmt ".toByteArray())
        putInt(16)
        putShort(1.toShort())
        putShort(channelCount.toShort())
        putInt(sampleRate)
        putInt(sampleRate * channelCount * bytesPerSample)
        putShort((channelCount * bytesPerSample).toShort())
        putShort((bytesPerSample * 8).toShort())
        put("data".toByteArray())
        putInt(dataSize)
      }
      .array()
  }
}
