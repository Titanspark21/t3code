const { withAppBuildGradle } = require("expo/config-plugins");

const signingConfig = `
        // T3 Code release CI supplies these as Gradle project properties. Local
        // builds continue to use Expo's debug key when they are absent.
        if (project.hasProperty("T3CODE_ANDROID_KEYSTORE_FILE")) {
            release {
                storeFile file(project.property("T3CODE_ANDROID_KEYSTORE_FILE"))
                storePassword project.property("T3CODE_ANDROID_KEYSTORE_PASSWORD")
                keyAlias project.property("T3CODE_ANDROID_KEY_ALIAS")
                keyPassword project.property("T3CODE_ANDROID_KEY_PASSWORD")
            }
        }
`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    if (nextConfig.modResults.language !== "groovy") {
      throw new Error("T3 Code Android release signing requires a Groovy app build.gradle.");
    }

    let contents = nextConfig.modResults.contents;
    if (contents.includes("T3CODE_ANDROID_KEYSTORE_FILE")) {
      return nextConfig;
    }

    const buildTypesMarker = "\n    buildTypes {";
    const buildTypesIndex = contents.indexOf(buildTypesMarker);
    if (buildTypesIndex === -1) {
      throw new Error("Unable to locate Android buildTypes for release signing configuration.");
    }

    const signingConfigsEnd = contents.lastIndexOf("\n    }", buildTypesIndex);
    if (signingConfigsEnd === -1) {
      throw new Error("Unable to locate Android signingConfigs for release signing configuration.");
    }

    contents = `${contents.slice(0, signingConfigsEnd)}${signingConfig}${contents.slice(signingConfigsEnd)}`;

    const defaultReleaseSigning = "signingConfig signingConfigs.debug";
    const releaseSigningIndex = contents.lastIndexOf(defaultReleaseSigning);
    if (releaseSigningIndex === -1) {
      throw new Error("Unable to locate Expo's default Android release signing configuration.");
    }

    contents = `${contents.slice(0, releaseSigningIndex)}signingConfig project.hasProperty("T3CODE_ANDROID_KEYSTORE_FILE") ? signingConfigs.release : signingConfigs.debug${contents.slice(releaseSigningIndex + defaultReleaseSigning.length)}`;
    nextConfig.modResults.contents = contents;
    return nextConfig;
  });
};
