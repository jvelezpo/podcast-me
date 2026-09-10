package expo.modules.audio

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.SilenceMediaSource
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAudioManager

@UnstableApi
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28, 35], manifest = Config.NONE)
class AudioFocusTest {
  private lateinit var player: ExoPlayer
  private lateinit var audioManager: ShadowAudioManager

  @Before
  fun setUp() {
    val context = RuntimeEnvironment.getApplication()
    audioManager = shadowOf(context.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
    audioManager.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
    player = ExoPlayer.Builder(context).build()
    player.configureAudioFocus(InterruptionMode.DO_NOT_MIX)
    player.setMediaSource(SilenceMediaSource(60_000_000))
    player.prepare()
  }

  @After
  fun tearDown() {
    player.release()
  }

  @Test
  fun remotePlayRequestsPermanentSpeechFocus() {
    // Car, headset, notification and media-session controls call this native player directly.
    startPlayback()
    val request = audioManager.lastAudioFocusRequest
    assertEquals(AudioManager.AUDIOFOCUS_GAIN, request.durationHint)
    assertEquals(C.USAGE_MEDIA, request.audioFocusRequest.audioAttributes.usage)
    assertEquals(C.AUDIO_CONTENT_TYPE_SPEECH, request.audioFocusRequest.audioAttributes.contentType)
    assertTrue(request.audioFocusRequest.willPauseWhenDucked())
  }

  @Test
  fun deniedFocusDoesNotStartPlayback() {
    audioManager.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
    player.play()
    await { audioManager.lastAudioFocusRequest != null && !player.playWhenReady }
    assertFalse(player.isPlaying)
  }

  @Test
  fun callSuppressesPlaybackUntilFocusReturns() {
    startPlayback()
    changeFocus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
    await { player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS }
    assertFalse(player.isPlaying)
    assertTrue(player.playWhenReady)

    changeFocus(AudioManager.AUDIOFOCUS_GAIN)
    await { player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE }
    assertTrue(player.playWhenReady)
  }

  @Test
  fun anotherAppTakingFocusDuringCallCancelsResume() {
    startPlayback()
    val listener = audioManager.lastAudioFocusRequest.listener
    changeFocus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
    await { player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS }
    changeFocus(AudioManager.AUDIOFOCUS_LOSS)
    await { !player.playWhenReady }

    listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
    drainPlaybackThread()
    assertFalse(player.playWhenReady)
    assertFalse(player.isPlaying)
  }

  @Test
  fun userPausingDuringCallCancelsResume() {
    startPlayback()
    changeFocus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
    await { player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS }
    player.pause()
    changeFocus(AudioManager.AUDIOFOCUS_GAIN)
    drainPlaybackThread()
    assertFalse(player.playWhenReady)
  }

  @Test
  fun remotePlayAfterAnotherAppReacquiresFocus() {
    startPlayback()
    val previousRequest = audioManager.lastAudioFocusRequest
    changeFocus(AudioManager.AUDIOFOCUS_LOSS)
    await { !player.playWhenReady }

    player.play()
    await { audioManager.lastAudioFocusRequest !== previousRequest }
    assertTrue(player.playWhenReady)
    assertEquals(AudioManager.AUDIOFOCUS_GAIN, audioManager.lastAudioFocusRequest.durationHint)
  }

  @Test
  fun spokenInterruptionPausesInsteadOfMixing() {
    startPlayback()
    changeFocus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
    await { player.playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS }
    assertFalse(player.isPlaying)
  }

  @Test
  fun bluetoothDisconnectCancelsPlayback() {
    startPlayback()
    RuntimeEnvironment.getApplication().sendBroadcast(Intent(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
    await { !player.playWhenReady }
    drainPlaybackThread()
    assertFalse(player.isPlaying)
  }

  private fun startPlayback() {
    player.play()
    await { audioManager.lastAudioFocusRequest != null }
    drainPlaybackThread()
  }

  private fun changeFocus(focus: Int) {
    audioManager.lastAudioFocusRequest.listener.onAudioFocusChange(focus)
  }

  private fun drainPlaybackThread() {
    // A player message is a barrier after previously queued focus and play commands.
    var delivered = false
    player.createMessage { _, _ -> delivered = true }.send().blockUntilDelivered(5_000)
    await { delivered }
  }

  private fun await(condition: () -> Boolean) {
    val deadline = System.nanoTime() + 5_000_000_000L
    do {
      shadowOf(Looper.getMainLooper()).idle()
      if (condition()) return
      Thread.sleep(10)
    } while (System.nanoTime() < deadline)
    fail("Timed out waiting for native audio focus state")
  }
}
