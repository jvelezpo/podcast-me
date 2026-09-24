const { version } = require('./package.json');

const [major, minor, patch] = version
  .split('-')[0]
  .split('.')
  .map(Number);
const androidVersionCode = major * 1_000_000 + minor * 1_000 + patch;

const appVariant = process.env.APP_VARIANT ?? 'production';

if (appVariant !== 'development' && appVariant !== 'production') {
  throw new Error(
    `Unsupported APP_VARIANT "${appVariant}". Use "development" or "production".`
  );
}

const isDevelopment = appVariant === 'development';

module.exports = ({ config: productionConfig }) => ({
  ...productionConfig,
  version,
  name: isDevelopment ? 'Podcast Me Dev' : productionConfig.name,
  icon: isDevelopment
    ? './assets/images/podcast-me-dev-icon.png'
    : productionConfig.icon,
  scheme: isDevelopment ? 'podcastme-dev' : productionConfig.scheme,
  ios: {
    ...productionConfig.ios,
    bundleIdentifier: isDevelopment
      ? 'com.podcastme.app.dev'
      : productionConfig.ios.bundleIdentifier,
  },
  android: {
    ...productionConfig.android,
    versionCode: androidVersionCode,
    package: isDevelopment
      ? 'com.podcastme.app.dev'
      : productionConfig.android.package,
    icon: isDevelopment
      ? './assets/images/podcast-me-dev-icon.png'
      : productionConfig.android.icon,
    adaptiveIcon: isDevelopment
      ? {
          backgroundColor: '#260063',
          foregroundImage: './assets/images/podcast-me-dev-foreground.png',
          monochromeImage: './assets/images/podcast-me-monochrome-v2.png',
        }
      : productionConfig.android.adaptiveIcon,
  },
  plugins: [
    ...productionConfig.plugins,
    'expo-secure-store',
    [
      'expo-dev-client',
      {
        addGeneratedScheme: isDevelopment,
      },
    ],
  ],
  extra: {
    ...productionConfig.extra,
    appVariant,
    apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN,
  },
});
