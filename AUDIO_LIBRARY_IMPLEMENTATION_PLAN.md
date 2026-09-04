# Local Audio Library Implementation Plan

This plan targets the current Expo SDK 57 mobile app on Android and iOS. "Phone storage" means files that the user explicitly selects through the operating system's document picker; the app should not request broad storage access or silently scan the device. Web support is outside this feature's initial scope.

## 1. Define the behavior and acceptance criteria

- [x] File selection and cancellation behavior is defined: the native picker opens only from the user-visible "Add audio" action and allows one or more audio files to be selected. Canceling is a no-op: it adds, removes, and updates nothing. After a non-canceled selection, every file that imports successfully appears exactly once in the Home screen list; one failed file does not hide successful files from the same selection.
- [x] Restart persistence is defined: each successful import is copied from its picker/cache URI into the app's persistent document directory, and library metadata stores the copied URI. After a full process termination and relaunch, the item remains listed and playable without selecting the source file again.
- [x] Completed-track behavior is defined: a track is complete when the player reports that it finished, or when its known duration minus its saved position is strictly less than three seconds. Completion stores position `0`; the next Play action seeks to `0` before playback rather than resuming near the final frame.
- [x] Resume accuracy is defined: pause, seek completion, track change, and a normal inactive/background transition save the latest finite player-reported position without rounding or an intentional rewind. Playback resumes from that saved value. During playback, durable checkpoints occur at the interval defined in section 8, so after an abrupt force-quit the recovered position may trail only by that interval.
- [x] The version-one privacy boundary is defined: imported bytes, library metadata, and playback state remain in app-owned on-device storage. The app has no account, upload, analytics transfer of library data, or cloud-sync path. A document provider may download a file the user explicitly selects, but the app retains only its private local copy and does not synchronize it back to that provider.

### Acceptance scenarios

| ID | Given | When | Then |
| --- | --- | --- | --- |
| AL-01 | The Home screen is open | The user presses "Add audio" | The operating system's document picker opens and permits multiple audio selections. |
| AL-02 | The library already contains any number of items | The user cancels the picker | The visible list is unchanged and the serialized library value is byte-for-byte unchanged. |
| AL-03 | A picker result contains one or more importable audio files | Import finishes | Every successfully imported file appears once in the Home screen list, including files sharing the same display name. |
| AL-04 | A picker result contains both importable and failed files | Import finishes | Successful files appear in the list, failed files do not, and the failures do not roll back successful imports. |
| AL-05 | At least one file was imported successfully | The app process is terminated and relaunched | The item is still listed and plays from its app-owned persistent URI without picker access. |
| AL-06 | A track finishes or its remaining time is `< 3` seconds | The user presses Play again | Playback starts from `0`, and the persisted position is `0`. |
| AL-07 | Playback is paused, a seek completes, the active track changes, or the app normally becomes inactive/backgrounded | The library is persisted and playback later resumes | The saved position equals the latest valid player-reported position for that track, with no app-added rounding or rewind. |
| AL-08 | A track is playing and periodic checkpoints are enabled | The app is force-quit and relaunched | The recovered position is no more than one checkpoint interval behind the last position available before termination. |
| AL-09 | Audio has been imported and played | App-owned storage and configured integrations are inspected | Audio bytes, metadata, and progress exist only on device; no account, upload, or cloud-synchronization mechanism exists. |

These scenarios define the target behavior. Runtime verification is intentionally tracked in section 10 and is not implied by completing this definition step.

## 2. Install SDK-compatible dependencies

- [x] Run `npx expo install expo-audio expo-document-picker expo-file-system @react-native-async-storage/async-storage` so Expo selects versions compatible with the project's SDK 57 release.
- [x] Run `npx expo install --check` and resolve only dependency-version issues introduced by the new packages.
- [x] Configure the `expo-audio` plugin with `microphonePermission: false`, `recordAudioAndroid: false`, `enableBackgroundRecording: false`, and `enableBackgroundPlayback: false`; do not add the `expo-document-picker` iCloud-container configuration unless the app later needs its own iCloud container.

## 3. Define the local audio data model

- [x] Add an `AudioItem` type containing `id`, `originalName`, `localUri`, `mimeType`, `sizeBytes`, `durationSeconds`, `lastPositionSeconds`, `addedAt`, and `updatedAt`.
- [x] Store playback times in seconds because Expo Audio's `currentTime`, `duration`, and `seekTo()` APIs use seconds.
- [x] Generate a stable unique `id` and a collision-safe internal filename for every import so two recordings with the same display name cannot overwrite one another.
- [x] Use a versioned AsyncStorage key such as `podcast-me.audio-library.v1` so the stored data can be migrated later without colliding with unrelated app settings.

## 4. Build the persistence layer

- [x] Create a small storage module, for example `src/services/audio-library-storage.ts`, that owns loading and saving the `AudioItem[]` JSON value in AsyncStorage.
- [x] Make the loader return an empty list when no library exists and surface malformed-data errors without crashing the Home screen.
- [x] Validate each loaded `localUri` with `expo-file-system`; mark missing files unavailable in the UI rather than attempting to play a broken URI.
- [x] Serialize library writes through one save path so a progress update cannot overwrite a newly imported item with stale state.
- [x] Keep the in-memory library as the UI's immediate source of truth and persist mutations after updating that state.

## 5. Import audio from phone storage

- [x] Add an "Add audio" action to the Home screen and call `DocumentPicker.getDocumentAsync` with `type: 'audio/*'` and `multiple: true` only from that user action. Copy to the picker cache on iOS; on Android, retain the picker-granted `content://` URI long enough to copy directly into app storage so Expo Go's experience-scoped FileSystem does not reject its own global picker cache.
- [x] Return immediately when the picker result has `canceled: true` and leave the current library unchanged.
- [x] Create an app-owned `audio-library` directory under `Paths.document` on first import; use idempotent directory creation so later imports do not fail.
- [x] For each selected asset, create a `File` from its picker URI and copy it to a uniquely named `File` inside the persistent `audio-library` directory.
- [x] Preserve the picker asset's original filename for display while saving only the new persistent URI for playback.
- [x] Reject assets with an explicitly non-audio MIME type or files that cannot be copied, continue importing the remaining valid assets, and show one concise result message listing failures.
- [x] Allow a user to re-import the same source as a separate library item; unique internal IDs and filenames must prevent the copies from overwriting one another.
- [x] If file copying succeeds but the metadata save fails, delete only the new orphaned copy so the app does not accumulate invisible files.

## 6. Render the audio library

- [x] Replace the placeholder content inside `src/app/index.tsx` with an audio-library screen while preserving the existing Expo Router route and shared theme components where useful.
- [x] Show a clear empty state with the "Add audio" action when the persisted library has no items.
- [x] Render each audio row with its original name, total duration when known, saved position, and a Play/Pause control.
- [x] Visually identify the active item and display its current position and progress without writing to storage on every render.
- [x] Disable playback for missing or unsupported files and show an actionable message that the user can re-import the recording.
- [x] Show loading, picker-open, importing, and playback-error states so repeated taps cannot start overlapping imports or player transitions.

## 7. Implement one shared playback controller

- [x] Create one `expo-audio` player for the Home screen with `useAudioPlayer` and read reactive state with `useAudioPlayerStatus`; do not create one native player per list row.
- [x] Configure a reasonable status update interval, such as 500 ms, for responsive progress display without unnecessary update frequency.
- [x] When Play is pressed for a different item, pause the current item, persist its latest position, replace the player's source with the new `localUri`, and wait until the new source reports `isLoaded`.
- [x] Clamp the saved position to the loaded duration, call `seekTo(savedPosition)`, and call `play()` only after seeking completes so playback never audibly starts from zero first.
- [x] When Play is pressed for the active paused item, seek to its saved position if needed and resume it; when Pause is pressed, pause first and immediately persist the reported `currentTime`.
- [x] Guard source loading with the selected item ID so rapid taps on different rows cannot cause an older load callback to start the wrong recording.
- [x] Update the active item's duration from the loaded audio status and persist it when the duration first becomes available or changes.
- [x] When `didJustFinish` is true, persist `lastPositionSeconds: 0`, stop showing the item as active playback, and make its next Play action start at the beginning.
- [x] Display playback errors from the audio status, preserve the last valid checkpoint, and allow the user to retry.

## 8. Persist resume progress safely

- [x] Update the active item's position in memory from player status while it is playing.
- [x] Throttle durable AsyncStorage checkpoints to approximately once every five seconds during playback instead of writing on every 500 ms status event.
- [x] Force an immediate checkpoint on Pause, seek completion, track change, app transition to inactive/background, and playback-controller cleanup.
- [x] Flush the previous item's checkpoint before replacing the audio source so switching tracks cannot assign one recording's time to another.
- [x] Ignore non-finite or negative times and never persist a position greater than the known duration.
- [x] Load the library before enabling Play controls so the first playback action always has access to the saved resume position.

## 9. Route playback and provide a native media experience

- [x] Configure playback as media audio with `allowsRecording: false` and `shouldRouteThroughEarpiece: false`, then allow Android and iOS to send sound to the operating system's currently active media-output route.
- [ ] Treat Bluetooth earbuds, headphones, speakers, car stereos, CarPlay systems, and equivalent devices as valid only when the operating system exposes them as the active media-audio output, such as an A2DP or LE Audio output.
- [ ] Do not enumerate all paired Bluetooth devices or request Bluetooth permissions merely to decide where sound should play; a connected peripheral is not necessarily an audio-output device.
- [ ] Keep playback on the phone or another active media output when a watch is connected only for notifications, controls, health data, or other non-audio services.
- [ ] Do not identify watches by device name, manufacturer text, or a hard-coded denylist because names can change and the same Bluetooth audio profiles are used by legitimate speakers and headsets.
- [ ] Document the platform boundary: if a watch deliberately advertises itself as a media-audio output and the user or operating system selects it, Expo Audio cannot reliably distinguish it from another Bluetooth speaker; an absolute device-specific block would require a separately scoped native investigation and may also block legitimate devices.
- [x] When a Bluetooth media-output connection changes while playback is requested, pause immediately, persist the checkpoint, wait briefly for the operating-system route to settle, and resume automatically on the new route.
- [x] Configure a standalone Android/iOS application identity and launcher icon so Podcast Me installs as its own app instead of running under Expo Go.
- [x] Provide accessible controls that seek the active recording backward or forward by 15 seconds, clamped to the recording bounds.
- [x] Provide an accessible playback-position slider with current and total time, horizontal seeking, fine scrubbing above the track, and fast scrubbing below it. Preserve the previewed time when changing vertical speed zones and show speed-and-direction feedback while dragging.
- [x] Enable background playback, lock-screen media controls, and the Android media-playback foreground service so playback continues while the app is minimized or the device is locked.
- [ ] Test Bluetooth routing with representative earbuds, a speaker, and a car: connect each device, make it the system's active media output, press Play, and confirm that no sound comes from the phone speaker.
- [ ] Test with a watch connected by itself and with a valid Bluetooth audio output connected at the same time; confirm that the watch is ignored unless the operating system explicitly exposes it as the selected media output.
- [ ] Test connecting, switching, and disconnecting Bluetooth outputs during playback and confirm that playback state and saved resume time remain correct.

## 10. Verify behavior and prevent regressions

- [ ] Add unit tests for empty and malformed storage values, library save/load round trips, repeated imports, time clamping, completed-track reset, and serialized writes.
- [ ] Add controller tests with a mocked Expo Audio player for resume-before-play ordering, pause checkpoints, track switching, rapid selection changes, and `didJustFinish` reset.
- [ ] Run `npx tsc --noEmit` and `npm run lint`, then fix only issues caused by this feature.
- [ ] Test on a physical Android device with recordings from at least two storage providers and verify that selected `content://` assets still play after a full app restart because the app uses its copied persistent URI.
- [ ] Test on a physical iOS device with local Files and iCloud Drive selections and verify that importing, restarting, and resuming work without microphone permission.
- [ ] Play a recording for at least 30 seconds, pause, restart the app, press Play, and verify that playback resumes at the saved position.
- [ ] Repeat the resume test after switching to another recording, backgrounding the app, and force-quitting; verify force-quit recovery is no more than one checkpoint interval behind.
- [ ] Let a recording finish and verify that its next Play action starts at `0` rather than at the final frame.
- [ ] Test canceling the picker, selecting an unsupported/corrupt audio file, importing files with identical names, and rapidly tapping different Play controls.
- [ ] Confirm that only one recording can play at a time and that imported files and progress survive normal upgrades/reloads but are removed when the user clears app data or uninstalls the app.

## Expo SDK 57 references

The implementation should follow the versioned Expo documentation for [DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/), [FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/), [Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/), and [AsyncStorage](https://docs.expo.dev/versions/v57.0.0/sdk/async-storage/).
