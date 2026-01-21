const { withAppBuildGradle } = require("@expo/config-plugins");

module.exports = ({ config }) => {
  return withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;

    // Patch missing hermesEnabled variable in generated Gradle
    if (
      contents.includes("hermesEnabled") &&
      !contents.includes("def hermesEnabled")
    ) {
      contents = contents.replace(
        /dependencies\s*\{/,
        `def hermesEnabled = (project.ext.react.get("enableHermes", true)).toBoolean()\n\ndependencies {`
      );
    }

    mod.modResults.contents = contents;
    return mod;
  });
};
