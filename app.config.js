const { expo: productionConfig } = require('./app.json');

const appVariant = process.env.APP_VARIANT ?? 'production';

if (appVariant !== 'development' && appVariant !== 'production') {
  throw new Error(
    `Unsupported APP_VARIANT "${appVariant}". Use "development" or "production".`
  );
}

const isDevelopment = appVariant === 'development';

module.exports = {
  ...productionConfig,
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
          monochromeImage: './assets/images/podcast-me-dev-foreground.png',
        }
      : productionConfig.android.adaptiveIcon,
  },
  plugins: [
    ...productionConfig.plugins,
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
  },
};
