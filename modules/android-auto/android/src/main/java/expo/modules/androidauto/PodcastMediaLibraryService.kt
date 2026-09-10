package expo.modules.androidauto

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.lang.ref.WeakReference

private const val ROOT_ID = "podcast-me-root"
private const val LIBRARY_ID = "podcast-me-library"
private const val CHECKPOINT_INTERVAL_MS = 5_000L
private const val SEEK_INCREMENT_MS = 15_000L
private const val SEEK_BACK_15_ACTION = "expo.modules.androidauto.SEEK_BACK_15"
private const val SEEK_FORWARD_15_ACTION = "expo.modules.androidauto.SEEK_FORWARD_15"

private val seekBack15Command = skipCommand(
  SEEK_BACK_15_ACTION,
  CommandButton.ICON_SKIP_BACK_15,
)
private val seekForward15Command = skipCommand(
  SEEK_FORWARD_15_ACTION,
  CommandButton.ICON_SKIP_FORWARD_15,
)

private val podcastControls = listOf(
  CommandButton.Builder(CommandButton.ICON_SKIP_BACK_15)
    .setSessionCommand(seekBack15Command)
    .setDisplayName("Back 15 seconds")
    .setSlots(CommandButton.SLOT_BACK)
    .build(),
  CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_15)
    .setSessionCommand(seekForward15Command)
    .setDisplayName("Forward 15 seconds")
    .setSlots(CommandButton.SLOT_FORWARD)
    .build(),
)

private fun skipCommand(action: String, icon: Int) = SessionCommand(
  action,
  Bundle().apply {
    putInt(MediaConstants.EXTRAS_KEY_COMMAND_BUTTON_ICON_COMPAT, icon)
  },
)

@OptIn(UnstableApi::class)
class PodcastMediaLibraryService : MediaLibraryService() {
  private lateinit var player: ExoPlayer
  private lateinit var session: MediaLibrarySession
  private val handler = Handler(Looper.getMainLooper())
  private val artworkUri by lazy {
    Uri.parse("android.resource://$packageName/drawable/podcast_me_android_auto_artwork")
  }

  private val checkpoint = object : Runnable {
    override fun run() {
      persistCurrentPlayback()
      if (player.isPlaying) {
        handler.postDelayed(this, CHECKPOINT_INTERVAL_MS)
      }
    }
  }

  private val playerListener = object : Player.Listener {
    override fun onIsPlayingChanged(isPlaying: Boolean) {
      handler.removeCallbacks(checkpoint)
      if (isPlaying) {
        handler.postDelayed(checkpoint, CHECKPOINT_INTERVAL_MS)
      } else {
        persistCurrentPlayback()
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_ENDED) {
        persistCurrentPlayback(completed = true)
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      persistCurrentPlayback()
    }
  }

  override fun onCreate() {
    super.onCreate()
    activeService = WeakReference(this)

    player = ExoPlayer.Builder(this)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
          .build(),
        true,
      )
      .setHandleAudioBecomingNoisy(true)
      .setSeekBackIncrementMs(SEEK_INCREMENT_MS)
      .setSeekForwardIncrementMs(SEEK_INCREMENT_MS)
      .build()
      .also { it.addListener(playerListener) }

    val builder = MediaLibrarySession.Builder(this, player, LibraryCallback())
      .setId("podcast-me-android-auto")
      .setMediaButtonPreferences(podcastControls)
    packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
      builder.setSessionActivity(
        PendingIntent.getActivity(
          this,
          0,
          launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        ),
      )
    }
    session = builder.build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession =
    session

  override fun onDestroy() {
    handler.removeCallbacks(checkpoint)
    persistCurrentPlayback()
    activeService = null
    session.release()
    player.release()
    super.onDestroy()
  }

  private fun persistCurrentPlayback(completed: Boolean = false) {
    if (!::player.isInitialized) return
    val mediaId = player.currentMediaItem?.mediaId ?: return
    val duration = player.duration.takeIf { it > 0 && it != C.TIME_UNSET }
    AndroidAutoStore.recordPlayback(
      this,
      mediaId,
      if (completed) 0 else player.currentPosition.coerceAtLeast(0),
      duration,
      completed || (duration != null && player.currentPosition >= duration - 1_000),
    )
  }

  private fun handleCatalogChanged() {
    if (!::session.isInitialized) return
    val items = AndroidAutoStore.catalog(this)
    session.notifyChildrenChanged(LIBRARY_ID, items.size, null)

    val currentId = player.currentMediaItem?.mediaId
    if (currentId != null && items.none { it.id == currentId }) {
      player.stop()
      player.clearMediaItems()
    }
  }

  private fun stopForPhonePlayback() {
    if (!::player.isInitialized) return
    persistCurrentPlayback()
    player.pause()
  }

  private inner class LibraryCallback : MediaLibrarySession.Callback {
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
      val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
        .buildUpon()
        .add(seekBack15Command)
        .add(seekForward15Command)
        .build()
      val playerCommands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
        .buildUpon()
        .remove(Player.COMMAND_SEEK_TO_PREVIOUS)
        .remove(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        .remove(Player.COMMAND_SEEK_TO_NEXT)
        .remove(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
        .build()

      return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
        .setAvailableSessionCommands(sessionCommands)
        .setAvailablePlayerCommands(playerCommands)
        .setMediaButtonPreferences(podcastControls)
        .build()
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: SessionCommand,
      args: Bundle,
    ): ListenableFuture<SessionResult> {
      when (customCommand.customAction) {
        SEEK_BACK_15_ACTION -> player.seekBack()
        SEEK_FORWARD_15_ACTION -> player.seekForward()
        else -> return Futures.immediateFuture(
          SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED),
        )
      }

      return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> =
      Futures.immediateFuture(LibraryResult.ofItem(rootItem(), params))

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val item = when (mediaId) {
        ROOT_ID -> rootItem()
        LIBRARY_ID -> libraryItem()
        else -> AndroidAutoStore.catalog(this@PodcastMediaLibraryService)
          .firstOrNull { it.id == mediaId }
          ?.let(::browseItem)
      }
      return Futures.immediateFuture(
        item?.let { LibraryResult.ofItem(it, null) }
          ?: LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE),
      )
    }

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val children = when (parentId) {
        ROOT_ID -> listOf(libraryItem())
        LIBRARY_ID -> AndroidAutoStore.catalog(this@PodcastMediaLibraryService).map(::browseItem)
        else -> return Futures.immediateFuture(
          LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE),
        )
      }
      return Futures.immediateFuture(LibraryResult.ofItemList(children, params))
    }

    override fun onSearch(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> {
      session.notifySearchResultChanged(browser, query, search(query).size, params)
      return Futures.immediateFuture(LibraryResult.ofVoid(params))
    }

    override fun onGetSearchResult(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
      Futures.immediateFuture(LibraryResult.ofItemList(search(query).map(::browseItem), params))

    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
    ): ListenableFuture<List<MediaItem>> = Futures.immediateFuture(
      mediaItems.mapNotNull { requested ->
        resolveRequestedItem(requested)?.let(::playableItem)
      },
    )

    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
      startIndex: Int,
      startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val requested = mediaItems.getOrNull(startIndex.coerceAtLeast(0)) ?: mediaItems.firstOrNull()
      val selected = requested?.let(::resolveRequestedItem)
      val catalog = AndroidAutoStore.catalog(this@PodcastMediaLibraryService)

      if (selected == null) {
        return Futures.immediateFuture(
          MediaSession.MediaItemsWithStartPosition(emptyList(), C.INDEX_UNSET, C.TIME_UNSET),
        )
      }

      val selectedIndex = catalog.indexOfFirst { it.id == selected.id }.coerceAtLeast(0)
      val position = startPositionMs.takeUnless { it == C.TIME_UNSET }
        ?: selected.positionMs
      return Futures.immediateFuture(
        MediaSession.MediaItemsWithStartPosition(
          catalog.map(::playableItem),
          selectedIndex,
          position,
        ),
      )
    }

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      isForPlayback: Boolean,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val catalog = AndroidAutoStore.catalog(this@PodcastMediaLibraryService)
      val selectedIndex = catalog.indices.maxByOrNull { catalog[it].updatedAtEpochMs } ?: 0
      val selected = catalog.getOrNull(selectedIndex)
      return if (selected == null) {
        Futures.immediateFailedFuture(UnsupportedOperationException("The library is empty."))
      } else {
        Futures.immediateFuture(
          MediaSession.MediaItemsWithStartPosition(
            if (isForPlayback) catalog.map(::playableItem) else listOf(playableItem(selected)),
            if (isForPlayback) selectedIndex else 0,
            selected.positionMs,
          ),
        )
      }
    }

    private fun resolveRequestedItem(requested: MediaItem): AutoCatalogItem? {
      val catalog = AndroidAutoStore.catalog(this@PodcastMediaLibraryService)
      catalog.firstOrNull { it.id == requested.mediaId }?.let { return it }
      val query = requested.requestMetadata.searchQuery?.toString()?.trim().orEmpty()
      return catalog.firstOrNull { it.title.contains(query, ignoreCase = true) }
    }

    private fun search(query: String): List<AutoCatalogItem> =
      AndroidAutoStore.catalog(this@PodcastMediaLibraryService).filter {
        it.title.contains(query.trim(), ignoreCase = true)
      }
  }

  private fun rootItem() = MediaItem.Builder()
    .setMediaId(ROOT_ID)
    .setMediaMetadata(
      MediaMetadata.Builder()
        .setTitle("Podcast Me")
        .setArtworkUri(artworkUri)
        .setIsBrowsable(true)
        .setIsPlayable(false)
        .build(),
    )
    .build()

  private fun libraryItem() = MediaItem.Builder()
    .setMediaId(LIBRARY_ID)
    .setMediaMetadata(
      MediaMetadata.Builder()
        .setTitle("My recordings")
        .setSubtitle("Imported audio")
        .setArtworkUri(artworkUri)
        .setIsBrowsable(true)
        .setIsPlayable(false)
        .build(),
    )
    .build()

  private fun browseItem(item: AutoCatalogItem) = baseItem(item).build()

  private fun playableItem(item: AutoCatalogItem) = baseItem(item)
    .setUri(item.uri)
    .build()

  private fun baseItem(item: AutoCatalogItem): MediaItem.Builder {
    val metadata = MediaMetadata.Builder()
      .setTitle(item.title)
      .setArtist("Podcast Me")
      .setAlbumTitle("My recordings")
      .setArtworkUri(artworkUri)
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .apply { item.durationMs?.let(::setDurationMs) }
      .build()

    return MediaItem.Builder()
      .setMediaId(item.id)
      .setMediaMetadata(metadata)
  }

  companion object {
    private var activeService: WeakReference<PodcastMediaLibraryService>? = null

    fun catalogChanged() {
      activeService?.get()?.handleCatalogChanged()
    }

    fun stopPlaybackFromPhone() {
      activeService?.get()?.stopForPhonePlayback()
    }
  }
}
