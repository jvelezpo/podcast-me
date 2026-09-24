# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

## App version

The bottom of **Profile** displays the version from `package.json`. Expo also reads
that version in `app.config.js`, so the app and build configuration share one source.

`npm install` / `npm ci` installs the pre-commit hook. For an existing checkout, run
`npm run prepare` once. The installer preserves the global TokenSave hooks, which
delegate to `.git/hooks/pre-commit`. Other custom global hooks must also delegate
to the repository hook.

Each commit with staged changes bumps the patch version (for example, `1.0.0` →
`1.0.1`) and stages `package.json` and `package-lock.json`. Fully stage or stash
changes to those files first; the hook stops if they have unstaged changes.
Retries keep an already staged version bump instead of incrementing it again.

Choose a semantic minor version for new features or a major version for breaking
changes before committing:

```bash
npm version minor --no-git-tag-version
# Or: npm version major --no-git-tag-version
git add package.json package-lock.json
```

The hook honors that staged version. It does not infer release types from commit
messages. Android's `versionCode` remains a separate build number to increase for
distributed updates. Run the hook regression checks with `npm run test:version`.

## Development app

Podcast Me has a separate development-only app that can be installed alongside production:

| Variant | App name | Android package / iOS bundle identifier |
| --- | --- | --- |
| Development | `Podcast Me Dev` | `com.podcastme.app.dev` |
| Production | `Podcast Me` | `com.podcastme.app` |

Build and install the development app locally, then start its development server:

```bash
npm run android:dev
npm run start:dev
```

Use `npm run ios:dev` instead for iOS. These commands regenerate the ignored native project with the correct variant before compiling. The normal `npm run android` and `npm run ios` commands regenerate the production identity first.

### Test Android Auto locally

Podcast Me publishes its imported recordings through an Android Media3 library service. After
installing a new build, open the phone app once so its current library is synchronized for Android
Auto. Imports, removals, ordering, playback position, and completion state are synchronized after
that.

Build a test APK without launching the app:

```bash
npm run prebuild:dev:android
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

For reliable real-car testing, install Podcast Me from a Google Play internal testing release.
Build the store bundle with `eas build --platform android --profile production`, upload the
resulting `.aab` to the Play Console internal testing track, and install it from the tester link.
Android Auto requires a trusted install source for real vehicles unless its separate **Unknown
sources** developer option is enabled. A signed production APK installed directly is still a
sideloaded app and cannot be made permanently visible in the car launcher by app code.

For local APK testing, enable Android Auto developer mode and **Unknown sources** in Android Auto's
developer settings. This is separate from Android's permission to install APKs.

If the app disappears from the car launcher or Android Auto says **opened on phone**:

1. Check the installed app and version on the phone. **Podcast Me** and **Podcast Me Dev** are
   separate installations; updating one does not update the other.
2. In Android Auto settings, tap the version information 10 times to enable developer mode,
   then open the overflow menu, choose **Developer settings**, and enable **Unknown sources**.
3. Open the updated phone app once, then check **Customize launcher** in Android Auto settings
   and enable the matching app. Disconnect and reconnect Android Auto.

Android Auto controls whether sideloaded apps appear; the app cannot enable this setting itself.
See Google's [trusted-source and developer-mode requirements](https://developer.android.com/training/cars/testing#unknown-sources).

For the Desktop Head Unit (DHU), also
start the head unit server in those settings, connect the phone over USB, then run:

```bash
adb forward tcp:5277 tcp:5277
$ANDROID_HOME/extras/google/auto/desktop-head-unit
```

In Android Auto, open the app launcher, choose **Podcast Me Dev**, then open **My recordings**.
The player provides play/pause, seek, next/previous, title search, and resume position. The native
catalogue and service tests can be run with:

```bash
cd android
./gradlew :android-auto:testDebugUnitTest
./gradlew :android-auto:connectedDebugAndroidTest
```

Every EAS Android build now checks the finished build for Android Auto discovery metadata and
fails if its browsable media service or `media` descriptor is missing. Local `npm run android`
and `npm run android:dev` do the same for their APKs. To check a manually built APK, run
`APP_VARIANT=development npm run verify:android-auto -- path/to/app.apk` (use
`APP_VARIANT=production` for the production package).

The connected tests cover both Media3 and the platform MediaBrowser interface used by Android
Auto. They verify manifest discovery and the media descriptor, browse recordings and start
playback without opening a phone activity, and exercise resume position, pause, seek, and the
15-second car controls. They also cover phone/car synchronization and sustained background
playback. These tests do not verify Android Auto's launcher or its trusted-source filtering.
The cold-launch test runs first so a phone activity from another test cannot mask Android 15's
audio-focus restriction. The service enters the foreground before requesting focus on Android
15 and later, then Media3 replaces the startup notification with the regular playback controls.
Rebuild and reinstall the native APK to apply this change; a JavaScript reload is insufficient.
See the official
[Android Auto DHU instructions](https://developer.android.com/training/cars/testing/dhu) and
[media app testing guide](https://developer.android.com/training/cars/testing/media).

EAS development builds use internal distribution and are not store artifacts:

```bash
eas build --profile development --platform android
eas build --profile development --platform ios
eas build --profile development-simulator --platform ios
```

Only the `production` submit profile exists. Do not submit a development build by file path or reuse its `.dev` identifier for a store application.

## Install the production app directly on Android

The `production-apk` EAS profile creates a signed, optimized APK using the production name, icon, and package `com.podcastme.app`. It is a standalone app: Expo Go, Metro, and a Play Store account are not required.

### 1. Build the APK

Prerequisites: install EAS CLI, sign in with `eas login`, and confirm the account with `eas whoami`. Local compilation also requires Java and the Android SDK.

Build on EAS and receive a temporary download URL:

```bash
npm run build:android:production
```

Or compile on this Mac using the installed Android toolchain:

```bash
npm run build:android:production:local
```

The local command still securely retrieves the EAS-managed signing key, but compilation happens on this computer. Its output is `dist/podcast-me-production.apk` and the temporary build workspace containing signing material is automatically removed. Do not enable `EAS_LOCAL_BUILD_SKIP_CLEANUP` for production builds.

The first build may ask to create Android signing credentials. Choose **Generate new keystore** and keep using that EAS-managed keystore for every future production build. When a cloud build finishes, open the URL printed by EAS and download the `.apk` file.

For every distributed update, increase `expo.android.versionCode` in `app.json`, keep the package name unchanged, and build with the same EAS project and signing key. This lets Android update the existing installation without deleting the app's local audio library.

### 2A. Install from the phone

1. Send the EAS build URL or downloaded APK to the Android phone.
2. Open the APK from the browser or Files app.
3. If Android blocks it, open the offered settings screen and temporarily enable **Allow from this source** for that browser or Files app.
4. Return to the installer, tap **Install**, and accept any Play Protect warning only if the APK came from your trusted build link.
5. Open **Podcast Me** from the launcher. Disable **Allow from this source** afterward if it is no longer needed.

### 2B. Install over USB with ADB

1. On the phone, enable Developer options by tapping **Build number** seven times, then enable **USB debugging**.
2. Connect the phone by USB and approve the computer's debugging prompt.
3. Confirm the phone is visible and install or update the APK:

```bash
adb devices
adb install -r dist/podcast-me-production.apk
```

The `-r` option keeps app data when the installed APK has the same package and signing key. If Android reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, do not uninstall immediately: uninstalling Podcast Me deletes its app-owned audio files and saved progress. Use an APK signed with the original production key instead.

Android may show a warning because this APK did not come through Play Store review. Podcast Me supports Android 7 and newer under Expo SDK 57.

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
