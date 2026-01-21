# RGMG Analytics - EAS Build Fixes

## Quick Start

Copy these files to your project:

```bash
# From this folder, copy to your project root:
cp .easignore /path/to/rgmg-analytics/
cp app.json /path/to/rgmg-analytics/
cp -r plugins /path/to/rgmg-analytics/
```

Then clean and rebuild:

```bash
cd /path/to/rgmg-analytics

# Clean all caches
rm -rf .expo node_modules android ios
npm install

# Clear Metro cache
npx expo start --clear
# (then Ctrl+C to stop)

# Build
eas build --platform android --profile production
```

---

## What Each Fix Does

### 1. `.easignore` - Fixes TAR Permission Errors

The EAS cloud build was failing because your project archive included directories that shouldn't be uploaded (`.expo/`, `node_modules/`, `android/`, `ios/`). On the Linux build worker, tar couldn't extract these with proper permissions.

**Files excluded:**
- `.expo/` and `.expo-shared/` - Expo cache (regenerated)
- `node_modules/` - Dependencies (reinstalled on server)
- `android/` and `ios/` - Native dirs (regenerated in managed workflow)
- Build outputs, logs, OS files

### 2. `plugins/withGradleFix.js` - Fixes Gradle "Read-Only Collection"

Expo SDK 54 with Gradle 8 / AGP 8 has breaking changes. Some generated Gradle code tries to modify immutable collections. This config plugin patches `android/app/build.gradle` during prebuild to:

- Convert old `packagingOptions { excludes += [...] }` to new `packaging { resources { ... } }` DSL
- Remove incompatible `applicationVariants.all` blocks
- Fix `variant.outputs` renaming patterns
- Add `hermesEnabled` definition if missing

### 3. `app.json` Changes

- Added the config plugin: `"plugins": ["./plugins/withGradleFix"]`
- Tightened `assetBundlePatterns` to `assets/*` and `assets/**/*` (prevents bundling everything)

### 4. App.js - No Changes Needed

Your uploaded App.js is clean with exactly one `export default function RootApp()`. If you're still seeing "Identifier 'App' has already been declared" errors, it's likely from:

- Stale Metro cache → run `npx expo start --clear`
- Old `.expo` folder → delete it entirely
- Hot reload artifacts → restart dev server

---

## Full Clean Build Process

```bash
# 1. Navigate to project
cd /path/to/rgmg-analytics

# 2. Nuclear clean
rm -rf node_modules .expo .expo-shared android ios dist build
rm -rf ~/.expo  # Global expo cache

# 3. Verify .easignore and plugins are in place
ls -la .easignore plugins/withGradleFix.js

# 4. Fresh install
npm install

# 5. Clear Metro bundler cache
npx expo start --clear
# Press Ctrl+C after it starts

# 6. Test local Android build (optional but recommended)
npx expo prebuild --clean --platform android
# Check android/app/build.gradle around line 155 for any issues
# Then clean up:
rm -rf android

# 7. EAS Build
eas build --platform android --profile production
```

---

## Troubleshooting

### Still getting TAR errors?
- Make sure `.easignore` is in project root (not a subfolder)
- Verify `.expo` folder is deleted locally before running `eas build`
- Check that no Windows read-only attributes are set on files

### Still getting Gradle errors?
- The config plugin might need adjustment for your specific error
- Run `npx expo prebuild --clean --platform android` locally
- Open `android/app/build.gradle` and look at line 155
- Share the specific error message and that section of the file

### Still getting "Identifier 'App' already declared"?
- This is a Metro bundler issue, not your code
- Delete `.expo` folder completely
- Run `npx expo start --clear`
- If using git, run `git status` to check for uncommitted duplicate files

### hermesEnabled errors return?
The plugin should handle this, but if not, manually add to your `app.json`:

```json
{
  "expo": {
    "android": {
      "jsEngine": "hermes"
    }
  }
}
```

---

## File Structure After Applying Fixes

```
rgmg-analytics/
├── .easignore          ← NEW
├── app.json            ← UPDATED (added plugins)
├── App.js              ← UNCHANGED
├── package.json
├── plugins/            ← NEW FOLDER
│   └── withGradleFix.js
├── assets/
├── storage.js
├── Rankings.js
├── bundledData.js
└── ...
```
