const { withAppBuildGradle } = require('expo/config-plugins');

const legacyDefaultRules = 'getDefaultProguardFile("proguard-android.txt")';
const optimizedDefaultRules = 'getDefaultProguardFile("proguard-android-optimize.txt")';

module.exports = function withR8Optimizations(config) {
  return withAppBuildGradle(config, (config) => {
    const { contents } = config.modResults;

    if (contents.includes(legacyDefaultRules)) {
      config.modResults.contents = contents.replace(
        legacyDefaultRules,
        optimizedDefaultRules,
      );
    } else if (!contents.includes(optimizedDefaultRules)) {
      throw new Error('Unable to configure the optimized Android R8 rules file.');
    }

    return config;
  });
};
