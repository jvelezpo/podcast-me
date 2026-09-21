package expo.modules.androidauto

import android.app.ForegroundServiceStartNotAllowedException
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaStyleNotificationHelper
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.lang.ref.WeakReference

private const val ROOT_ID = "podcast-me-root"
private const val LIBRARY_ID = "podcast-me-library"
private const val CHECKPOINT_INTERVAL_MS = 5_000L
private const val PLAYBACK_STATE_INTERVAL_MS = 500L
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
  private lateinit var player: Player
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

  private val playbackStateUpdate = object : Runnable {
    override fun run() {
      notifyPlaybackState()
      if (player.isPlaying) {
        handler.postDelayed(this, PLAYBACK_STATE_INTERVAL_MS)
      }
    }
  }

  private val playerListener = object : Player.Listener {
    override fun onIsPlayingChanged(isPlaying: Boolean) {
      handler.removeCallbacks(checkpoint)
      handler.removeCallbacks(playbackStateUpdate)
      if (isPlaying) {
        handler.postDelayed(checkpoint, CHECKPOINT_INTERVAL_MS)
        handler.postDelayed(playbackStateUpdate, PLAYBACK_STATE_INTERVAL_MS)
      } else {
        persistCurrentPlayback()
      }
      notifyPlaybackState()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_ENDED) {
        persistCurrentPlayback(completed = true)
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      persistCurrentPlayback()
      notifyPlaybackState()
    }

    override fun onEvents(player: Player, events: Player.Events) {
      notifyPlaybackState()
    }
  }

  override fun onCreate() {
    super.onCreate()

    val upstreamDataSourceFactory = DefaultDataSource.Factory(
      this,
      DefaultHttpDataSource.Factory(),
    )
    val mediaSourceFactory = DefaultMediaSourceFactory(this)
      .setDataSourceFactory(
        ResolvingDataSource.Factory(upstreamDataSourceFactory) { dataSpec: DataSpec ->
          val headers = AndroidAutoStore.catalog(this)
            .firstOrNull { it.uri == dataSpec.uri }
            ?.requestHeaders
            .orEmpty()
          if (headers.isEmpty()) dataSpec else dataSpec.withRequestHeaders(headers)
        },
      )

    player = ExoPlayer.Builder(this)
      .setMediaSourceFactory(mediaSourceFactory)
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
      .let { exoPlayer ->
        object : ForwardingPlayer(exoPlayer) {
          override fun play() = setPlayWhenReady(true)

          override fun setPlayWhenReady(playWhenReady: Boolean) {
            if (playWhenReady && Build.VERSION.SDK_INT >= 35) {
              // Android 15 requires foreground status before requesting audio focus.
              if (!startForegroundForPlayback()) return
            }
            super.setPlayWhenReady(playWhenReady)
          }
        }
      }
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
    // Phone commands bypass onGetSession, so register for Media3 notifications
    // and foreground playback even when no car/browser controller connects.
    addSession(session)
    activeService = WeakReference(this)
    notifyPlaybackState()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession =
    session

  @RequiresApi(35)
  private fun startForegroundForPlayback(): Boolean {
    if (isPlaybackOngoing || player.currentMediaItem == null) return true
    val channelId = DefaultMediaNotificationProvider.DEFAULT_CHANNEL_ID
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(
        channelId,
        getString(DefaultMediaNotificationProvider.DEFAULT_CHANNEL_NAME_RESOURCE_ID),
        NotificationManager.IMPORTANCE_LOW,
      ),
    )
    // Media3 replaces this notification with its normal controls once its
    // asynchronous notification controller has received the new playlist.
    return try {
      startForeground(
        DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID,
        NotificationCompat.Builder(this, channelId)
          .setSmallIcon(R.drawable.ic_android_auto_attribution)
          .setContentTitle(player.mediaMetadata.title ?: "Podcast Me")
          .setContentIntent(session.sessionActivity)
          .setStyle(MediaStyleNotificationHelper.MediaStyle(session))
          .setOngoing(true)
          .build(),
      )
      true
    } catch (error: ForegroundServiceStartNotAllowedException) {
      Log.w("PodcastMediaLibrary", "Android blocked background playback startup", error)
      false
    }
  }

  override fun onDestroy() {
    handler.removeCallbacks(checkpoint)
    handler.removeCallbacks(playbackStateUpdate)
    persistCurrentPlayback()
    if (activeService?.get() === this) {
      activeService = null
    }
    session.release()
    player.release()
    notifyUnavailable()
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

  private fun playFromPhone(mediaId: String, positionMs: Long, rate: Float): Boolean {
    val catalog = AndroidAutoStore.catalog(this)
    val selectedIndex = catalog.indexOfFirst { it.id == mediaId }
    if (selectedIndex < 0) return false

    if (player.currentMediaItem?.mediaId != mediaId) {
      player.setMediaItems(catalog.map(::playableItem), selectedIndex, positionMs)
      player.prepare()
    } else if (player.playbackState == Player.STATE_ENDED) {
      player.seekTo(0)
    } else if (player.playbackState == Player.STATE_IDLE) {
      player.prepare()
    }

    player.setPlaybackSpeed(rate.coerceIn(0.5f, 2f))
    player.play()
    notifyPlaybackState()
    return true
  }

  private fun prepareFromPhone(mediaId: String, positionMs: Long, rate: Float): Boolean {
    val catalog = AndroidAutoStore.catalog(this)
    val selectedIndex = catalog.indexOfFirst { it.id == mediaId }
    if (selectedIndex < 0) return false

    // A paused selection must never inherit `playWhenReady` from the
    // previously playing row while the replacement source is prepared.
    player.pause()
    if (player.currentMediaItem?.mediaId != mediaId) {
      player.setMediaItems(catalog.map(::playableItem), selectedIndex, positionMs)
      player.prepare()
    } else if (player.playbackState == Player.STATE_ENDED) {
      player.seekTo(0)
    } else if (player.playbackState == Player.STATE_IDLE) {
      player.prepare()
    }

    player.setPlaybackSpeed(rate.coerceIn(0.5f, 2f))
    player.pause()
    notifyPlaybackState()
    return true
  }

  private fun pauseFromPhone(): Boolean {
    if (player.currentMediaItem == null) return false
    persistCurrentPlayback()
    player.pause()
    notifyPlaybackState()
    return true
  }

  private fun seekFromPhone(positionMs: Long): Boolean {
    if (player.currentMediaItem == null) return false
    player.seekTo(positionMs.coerceAtLeast(0))
    persistCurrentPlayback()
    notifyPlaybackState()
    return true
  }

  private fun setPlaybackRateFromPhone(rate: Float): Boolean {
    if (player.currentMediaItem == null) return false
    player.setPlaybackSpeed(rate.coerceIn(0.5f, 2f))
    notifyPlaybackState()
    return true
  }

  private fun setVolumeFromPhone(volume: Float): Boolean {
    if (!::player.isInitialized || player.currentMediaItem == null) return false
    player.volume = volume.coerceIn(0f, 1f)
    return true
  }

  private fun dismissFromPhone(): Boolean {
    if (player.currentMediaItem == null) return false
    persistCurrentPlayback()
    player.stop()
    player.clearMediaItems()
    notifyPlaybackState()
    return true
  }

  private fun playbackState(): Map<String, Any?> {
    val duration = player.duration.takeIf { it > 0 && it != C.TIME_UNSET }
    return mapOf(
      "serviceReady" to true,
      "mediaId" to player.currentMediaItem?.mediaId,
      "currentPositionSeconds" to player.currentPosition.coerceAtLeast(0) / 1_000.0,
      "durationSeconds" to duration?.div(1_000.0),
      "isPlaying" to player.isPlaying,
      "isLoaded" to (player.currentMediaItem != null),
      "isEnded" to (player.playbackState == Player.STATE_ENDED),
      "playbackRate" to player.playbackParameters.speed.toDouble(),
      "error" to player.playerError?.message,
    )
  }

  private fun notifyPlaybackState() {
    playbackStateObserver?.invoke(playbackState())
  }

  private fun dispatchFromBridge(action: PodcastMediaLibraryService.() -> Unit) {
    val service = this
    val runnable = Runnable {
      if (activeService?.get() === service) {
        service.action()
      }
    }

    if (Looper.myLooper() === handler.looper) {
      runnable.run()
    } else {
      handler.post(runnable)
    }
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
      // The player holds the full catalog as its playlist, so native
      // seek-to-next/previous (car buttons, BT/headset double-press,
      // lock-screen controls) advances within library order. No
      // shuffle/repeat commands are exposed.
      val playerCommands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
        .buildUpon()
        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
        .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
        .add(Player.COMMAND_SEEK_TO_NEXT)
        .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
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
      .setArtworkUri(item.artworkUri ?: artworkUri)
      .setIsBrowsable(false)
      .setIsPlayable(true)
      .apply { item.durationMs?.let(::setDurationMs) }
      .build()

    return MediaItem.Builder()
      .setMediaId(item.id)
      .setMediaMetadata(metadata)
  }

  companion object {
    @Volatile
    private var activeService: WeakReference<PodcastMediaLibraryService>? = null
    @Volatile
    private var playbackStateObserver: ((Map<String, Any?>) -> Unit)? = null

    fun catalogChanged() {
      activeService?.get()?.dispatchFromBridge { handleCatalogChanged() }
    }

    fun stopPlaybackFromPhone() {
      activeService?.get()?.dispatchFromBridge { stopForPhonePlayback() }
    }

    fun observePlaybackState(
      context: android.content.Context,
      observer: (Map<String, Any?>) -> Unit,
    ) {
      Handler(Looper.getMainLooper()).post {
        playbackStateObserver = observer
        observer(currentPlaybackState(context))
      }
    }

    fun removePlaybackStateObserver(observer: (Map<String, Any?>) -> Unit) {
      Handler(Looper.getMainLooper()).post {
        if (playbackStateObserver === observer) {
          playbackStateObserver = null
        }
      }
    }

    fun currentPlaybackState(context: android.content.Context): Map<String, Any?> {
      activeService?.get()?.let { return it.playbackState() }
      // Foreground state refreshes must recover a service stopped by Android.
      // onCreate publishes the ready state to the existing observer.
      context.applicationContext.startService(
        Intent(context.applicationContext, PodcastMediaLibraryService::class.java),
      )
      return unavailablePlaybackState()
    }

    fun playFromPhone(mediaId: String, positionMs: Long, rate: Float): Boolean =
      activeService?.get()?.playFromPhone(mediaId, positionMs, rate) ?: false

    fun prepareFromPhone(mediaId: String, positionMs: Long, rate: Float): Boolean =
      activeService?.get()?.prepareFromPhone(mediaId, positionMs, rate) ?: false

    fun pauseFromPhone(): Boolean =
      activeService?.get()?.pauseFromPhone() ?: false

    fun seekFromPhone(positionMs: Long): Boolean =
      activeService?.get()?.seekFromPhone(positionMs) ?: false

    fun setPlaybackRateFromPhone(rate: Float): Boolean =
      activeService?.get()?.setPlaybackRateFromPhone(rate) ?: false

    fun setVolumeFromPhone(volume: Float): Boolean =
      activeService?.get()?.setVolumeFromPhone(volume) ?: false

    fun dismissFromPhone(): Boolean =
      activeService?.get()?.dismissFromPhone() ?: false

    private fun notifyUnavailable() {
      playbackStateObserver?.invoke(unavailablePlaybackState())
    }

    private fun unavailablePlaybackState(): Map<String, Any?> = mapOf(
      "serviceReady" to false,
      "mediaId" to null,
      "currentPositionSeconds" to 0.0,
      "durationSeconds" to null,
      "isPlaying" to false,
      "isLoaded" to false,
      "isEnded" to false,
      "playbackRate" to 1.0,
      "error" to null,
    )
  }
}
