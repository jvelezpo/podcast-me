package expo.modules.androidauto

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

internal data class AutoCatalogItem(
  val id: String,
  val title: String,
  val uri: Uri,
  val artworkUri: Uri?,
  val requestHeaders: Map<String, String>,
  val durationMs: Long?,
  val positionMs: Long,
  val isPlayed: Boolean,
  val updatedAtEpochMs: Long,
)

internal object AndroidAutoStore {
  private const val PREFERENCES = "podcast_me_android_auto"
  private const val LEGACY_CATALOG = "catalog"
  private const val LOCAL_CATALOG = "local_catalog"
  private const val REMOTE_CATALOG = "remote_catalog"
  private const val PLAYBACK_UPDATES = "playback_updates"

  fun syncLibrary(context: Context, serializedLibrary: String) {
    // Parse before saving so a corrupt JS payload cannot replace a valid car catalogue.
    val itemIds = parseCatalog(serializedLibrary).mapTo(mutableSetOf()) { it.id }
    preferences(context).edit()
      .putString(LOCAL_CATALOG, serializedLibrary)
      .remove(LEGACY_CATALOG)
      .apply()
    writeProgress(context, readProgress(context).filterKeys(itemIds::contains))
  }

  fun syncRemoteLibrary(context: Context, serializedLibrary: String) {
    // Validate before replacing the previous remote catalogue for the same reason as local audio.
    parseCatalog(serializedLibrary)
    preferences(context).edit().putString(REMOTE_CATALOG, serializedLibrary).apply()
  }

  fun catalog(context: Context): List<AutoCatalogItem> {
    val serialized = listOfNotNull(
      preferences(context).getString(LOCAL_CATALOG, null)
        ?: preferences(context).getString(LEGACY_CATALOG, null),
      preferences(context).getString(REMOTE_CATALOG, null),
    )
    if (serialized.isEmpty()) return emptyList()
    val progress = readProgress(context)

    return serialized.flatMap(::parseCatalog).map { item ->
      progress[item.id]?.let { update ->
        item.copy(
          durationMs = update.durationMs ?: item.durationMs,
          positionMs = update.positionMs,
          isPlayed = update.isPlayed,
          updatedAtEpochMs = update.updatedAtEpochMs,
        )
      } ?: item
    }
  }

  fun recordPlayback(
    context: Context,
    itemId: String,
    positionMs: Long,
    durationMs: Long?,
    isPlayed: Boolean,
  ) {
    val progress = readProgress(context).toMutableMap()
    val wasPlayed = progress[itemId]?.isPlayed == true ||
      catalog(context).firstOrNull { it.id == itemId }
        ?.isPlayed == true
    progress[itemId] = PlaybackUpdate(
      positionMs = positionMs.coerceAtLeast(0),
      durationMs = durationMs?.takeIf { it > 0 },
      isPlayed = wasPlayed || isPlayed,
      updatedAtEpochMs = System.currentTimeMillis(),
    )
    writeProgress(context, progress)
  }

  fun consumePlaybackUpdates(context: Context): String {
    val progress = readProgress(context)
    val result = JSONArray()

    progress.forEach { (id, update) ->
      result.put(JSONObject().apply {
        put("id", id)
        put("lastPositionSeconds", update.positionMs / 1_000.0)
        put(
          "durationSeconds",
          update.durationMs?.div(1_000.0) ?: JSONObject.NULL,
        )
        put("isPlayed", update.isPlayed)
        put("updatedAtEpochMs", update.updatedAtEpochMs)
      })
    }

    preferences(context).edit().remove(PLAYBACK_UPDATES).apply()
    return result.toString()
  }

  private fun parseCatalog(serialized: String): List<AutoCatalogItem> {
    val array = JSONArray(serialized)

    return buildList {
      for (index in 0 until array.length()) {
        val value = array.optJSONObject(index) ?: continue
        val id = value.optString("id").trim()
        val originalTitle = value.optString("originalName").trim()
        val metadataTitle = value.optJSONObject("metadata")
          ?.takeUnless { it.isNull("title") }
          ?.optString("title")
          ?.trim()
          .orEmpty()
        val title = metadataTitle.ifEmpty { originalTitle.withoutAudioFileExtension() }
        val uri = Uri.parse(value.optString("localUri"))
        val mimeType = if (value.isNull("mimeType")) "" else value.optString("mimeType").trim()
        val requestHeaders = value.optJSONObject("requestHeaders")
          ?.let(::parseRequestHeaders)
          .orEmpty()
        val artworkUri = value.optJSONObject("metadata")
          ?.optString("coverArtUrl")
          ?.trim()
          ?.takeIf(::isHttpUri)
          ?.let(Uri::parse)
        val isLocalFile = uri.scheme == "file" && uri.path?.let(::File)?.isFile == true
        val isRemoteStream = isHttpUri(uri.toString())

        if (
          id.isEmpty() || originalTitle.isEmpty() || (!isLocalFile && !isRemoteStream) ||
          (mimeType.isNotEmpty() && !mimeType.startsWith("audio/", ignoreCase = true))
        ) {
          continue
        }

        add(
          AutoCatalogItem(
            id = id,
            title = title,
            uri = uri,
            artworkUri = artworkUri,
            requestHeaders = requestHeaders,
            durationMs = value.optNullableSeconds("durationSeconds"),
            positionMs = value.optSeconds("lastPositionSeconds"),
            isPlayed = value.optBoolean("isPlayed", false),
            updatedAtEpochMs = parseTimestamp(value.optString("updatedAt")),
          ),
        )
      }
    }
  }

  private fun readProgress(context: Context): Map<String, PlaybackUpdate> {
    val serialized = preferences(context).getString(PLAYBACK_UPDATES, null) ?: return emptyMap()
    val json = runCatching { JSONObject(serialized) }.getOrNull() ?: return emptyMap()

    return buildMap {
      json.keys().forEach { id ->
        val value = json.optJSONObject(id) ?: return@forEach
        put(
          id,
          PlaybackUpdate(
            positionMs = value.optLong("positionMs").coerceAtLeast(0),
            durationMs = value.optLong("durationMs").takeIf { it > 0 },
            isPlayed = value.optBoolean("isPlayed", false),
            updatedAtEpochMs = value.optLong("updatedAtEpochMs"),
          ),
        )
      }
    }
  }

  private fun writeProgress(context: Context, progress: Map<String, PlaybackUpdate>) {
    val json = JSONObject()
    progress.forEach { (id, update) ->
      json.put(id, JSONObject().apply {
        put("positionMs", update.positionMs)
        put("durationMs", update.durationMs ?: JSONObject.NULL)
        put("isPlayed", update.isPlayed)
        put("updatedAtEpochMs", update.updatedAtEpochMs)
      })
    }
    preferences(context).edit().putString(PLAYBACK_UPDATES, json.toString()).apply()
  }

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  private fun JSONObject.optSeconds(name: String): Long =
    (optDouble(name, 0.0) * 1_000).toLong().coerceAtLeast(0)

  private fun JSONObject.optNullableSeconds(name: String): Long? =
    if (isNull(name)) null else optSeconds(name).takeIf { it > 0 }

  private fun parseTimestamp(value: String): Long = runCatching {
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US).apply {
      isLenient = false
      timeZone = TimeZone.getTimeZone("UTC")
    }.parse(value)?.time ?: 0
  }.getOrDefault(0)

  private fun parseRequestHeaders(headers: JSONObject): Map<String, String> = buildMap {
    headers.keys().forEach { name ->
      val value = headers.optString(name).trim()
      if (name.isNotBlank() && value.isNotEmpty()) put(name, value)
    }
  }

  private fun isHttpUri(value: String): Boolean =
    Uri.parse(value).scheme?.lowercase(Locale.US) in setOf("http", "https")

  private fun String.withoutAudioFileExtension(): String =
    replace(Regex("(?i)\\.(mp3|m4a|aac|wav|flac|ogg|opus|webm|mp4)$"), "")
      .trim()
      .ifEmpty { this }

  private data class PlaybackUpdate(
    val positionMs: Long,
    val durationMs: Long?,
    val isPlayed: Boolean,
    val updatedAtEpochMs: Long,
  )
}
