# Android audio focus regression tests

Podcast Me uses `doNotMix`. In expo-audio 57.0.4, JavaScript playback requests
temporary focus and starts even when that request fails. Media-session and
notification playback bypass that request entirely because ExoPlayer's focus
handling is disabled. A Bluetooth route callback also used to schedule an
unconditional restart, which could override an interruption or disconnection.

`patches/expo-audio+57.0.4.patch` makes ExoPlayer own focus for `doNotMix`, using
permanent media focus and speech attributes. This covers in-app and remote
controls, call suppression/resumption, denied focus, and headset disconnection.
The custom Bluetooth restart module has been removed. Other interruption modes
continue using Expo's existing focus handling.

The dependency is pinned and patched by `npm ci`. Android autolinking explicitly
builds expo-audio from source; otherwise Expo uses its unpatched precompiled AAR.
Rebuild the Android app to apply this fix. A JavaScript reload or Expo Go cannot
apply the native patch. Reassess the patch when upgrading expo-audio.

Run from the repository root (requires Java and the Android SDK):

```sh
npm ci
npm run prebuild:dev:android
cd android
./gradlew :expo-audio:testDebugUnitTest --init-script ../tests/audio-focus.gradle
```

The tests run the actual patched Media3 player under Robolectric on Android 9
and Android 15. Focus callbacks and request outcomes are simulated; they do not
establish compatibility with a particular phone, Spotify version, or car.

Verified locally: all 16 cases pass, and the remote-play/denied-focus cases fail
when native focus handling is disabled. The development APK builds successfully.
On an Android 15 emulator, media-session play held `GAIN` with media/speech
attributes; an incoming simulated call paused playback, and ending it restored
focus before playback resumed.

On a physical Android phone, verify both in-app and car/headset play buttons:

1. Play Spotify, then Podcast Me. Only Podcast Me should be audible.
2. Receive and end a call. Podcast Me may resume when focus returns; Spotify
   should remain paused.
3. Switch to Spotify, including during an interruption. Podcast Me should
   remain paused after the call.
4. Pause Podcast Me during an interruption. Ending it must not undo the pause.
5. Disconnect Bluetooth during playback. Podcast Me should pause and remain
   paused when Bluetooth reconnects until explicitly played.

References: [Expo SDK 57 audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/),
[Android audio focus](https://developer.android.com/media/optimize/audio-focus),
[Expo source build configuration](https://docs.expo.dev/guides/prebuilt-expo-modules/).
