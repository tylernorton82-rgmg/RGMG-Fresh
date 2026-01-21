/**
 * Expo Config Plugin: Fix Gradle 8 build errors
 */
const { withAppBuildGradle } = require('expo/config-plugins');

function fixGradleIssues(buildGradle) {
  let modified = buildGradle;

  // Fix 1: Replace the packagingOptions block with Gradle 8 compatible version
  const problematicBlock = /\/\/ Apply static values from `gradle\.properties` to the `android\.packagingOptions`[\s\S]*?\["pickFirsts", "excludes", "merges", "doNotStrip"\]\.each \{ prop ->[\s\S]*?android\.packagingOptions\[prop\] \+= it[\s\S]*?\}\s*\}\s*\}/;

  const fixedPackagingBlock = `// Apply static values from gradle.properties to the android.packagingOptions
// Fixed for Gradle 8 read-only collections
android.packaging {
    def packagingProps = ["pickFirsts", "excludes", "merges", "doNotStrip"]
    packagingProps.each { prop ->
        def options = (findProperty("android.packagingOptions.$prop") ?: "").split(",")
        for (i in 0..<options.size()) options[i] = options[i].trim()
        options -= ""
        if (options.length > 0) {
            println "android.packagingOptions.$prop += $options ($options.length)"
            options.each { option ->
                switch(prop) {
                    case "pickFirsts":
                        resources.pickFirsts.add(option)
                        jniLibs.pickFirsts.add(option)
                        break
                    case "excludes":
                        resources.excludes.add(option)
                        jniLibs.excludes.add(option)
                        break
                    case "merges":
                        resources.merges.add(option)
                        break
                    case "doNotStrip":
                        jniLibs.keepDebugSymbols.add(option)
                        break
                }
            }
        }
    }
}

// Define hermesEnabled before dependencies block (Fixed for Gradle 8)
def hermesEnabled = true`;

  if (problematicBlock.test(modified)) {
    modified = modified.replace(problematicBlock, fixedPackagingBlock);
  }

  // Fix 2: The dependencies block uses hermesEnabled but it might get defined later
  // by React Native gradle plugin with a problematic line. 
  // We already defined it above, but we also need to handle if it gets added later.
  // Replace any problematic hermesEnabled definition if it exists
  modified = modified.replace(
    /def\s+hermesEnabled\s*=\s*\(project\.ext\.react\.get\("enableHermes",\s*true\)\)\.toBoolean\(\)/g,
    '// hermesEnabled already defined above'
  );

  return modified;
}

const withGradleFix = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = fixGradleIssues(config.modResults.contents);
    }
    return config;
  });
};

module.exports = withGradleFix;
