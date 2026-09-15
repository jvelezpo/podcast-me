package expo.modules.androidauto

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

@RunWith(RobolectricTestRunner::class)
class AndroidAutoStoreTest {
  private lateinit var context: Context
  private lateinit var audioFile: File

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    context.getSharedPreferences("podcast_me_android_auto", Context.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
    audioFile = File(context.filesDir, "recording.mp3").apply { writeBytes(byteArrayOf(1)) }
  }

  @After
  fun tearDown() {
    audioFile.delete()
  }

  @Test
  fun syncLibraryPublishesOnlyPlayableLocalAudio() {
    AndroidAutoStore.syncLibrary(
      context,
      JSONArray()
        .put(catalogItem("available", audioFile.toURI().toString()))
        .put(catalogItem("missing", File(context.filesDir, "missing.mp3").toURI().toString()))
        .toString(),
    )

    val catalog = AndroidAutoStore.catalog(context)

    assertEquals(listOf("available"), catalog.map { it.id })
    assertEquals("available", catalog.single().title)
    assertEquals(12_500L, catalog.single().positionMs)
  }

  @Test
  fun syncLibraryPublishesAudioWithoutMimeMetadata() {
    AndroidAutoStore.syncLibrary(
      context,
      JSONArray().put(catalogItem("available", audioFile.toURI().toString(), null)).toString(),
    )

    assertEquals(listOf("available"), AndroidAutoStore.catalog(context).map { it.id })
  }

  @Test
  fun syncLibraryFallsBackToFilenameWhenMetadataTitleIsNull() {
    val item = catalogItem("available", audioFile.toURI().toString()).apply {
      put("metadata", JSONObject().put("title", JSONObject.NULL))
    }
    AndroidAutoStore.syncLibrary(context, JSONArray().put(item).toString())

    assertEquals("available", AndroidAutoStore.catalog(context).single().title)
  }

  @Test
  fun invalidSyncDoesNotReplaceExistingCatalog() {
    val validCatalog = JSONArray()
      .put(catalogItem("available", audioFile.toURI().toString()))
      .toString()
    AndroidAutoStore.syncLibrary(context, validCatalog)

    assertThrows(Exception::class.java) {
      AndroidAutoStore.syncLibrary(context, "not-json")
    }

    assertEquals("available", AndroidAutoStore.catalog(context).single().id)
  }

  @Test
  fun nativeProgressOverridesCatalogUntilJavascriptConsumesIt() {
    AndroidAutoStore.syncLibrary(
      context,
      JSONArray().put(catalogItem("available", audioFile.toURI().toString())).toString(),
    )
    AndroidAutoStore.recordPlayback(context, "available", 44_000, 90_000, true)
    AndroidAutoStore.recordPlayback(context, "available", 45_000, 90_000, false)

    val effectiveItem = AndroidAutoStore.catalog(context).single()
    val updates = JSONArray(AndroidAutoStore.consumePlaybackUpdates(context))
    val update = updates.getJSONObject(0)

    assertEquals(45_000L, effectiveItem.positionMs)
    assertEquals(90_000L, effectiveItem.durationMs)
    assertEquals(45.0, update.getDouble("lastPositionSeconds"), 0.001)
    assertEquals(90.0, update.getDouble("durationSeconds"), 0.001)
    assertEquals(true, update.getBoolean("isPlayed"))
    assertFalse(AndroidAutoStore.consumePlaybackUpdates(context).let(::JSONArray).length() > 0)
  }

  private fun catalogItem(id: String, uri: String, mimeType: String? = "audio/mpeg") = JSONObject().apply {
    put("id", id)
    put("originalName", "$id.mp3")
    put("localUri", uri)
    put("mimeType", mimeType ?: JSONObject.NULL)
    put("durationSeconds", 60.0)
    put("lastPositionSeconds", 12.5)
    put("isPlayed", false)
    put("updatedAt", "2026-09-09T12:00:00.000Z")
  }
}
