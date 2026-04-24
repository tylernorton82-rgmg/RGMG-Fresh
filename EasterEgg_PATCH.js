// ============================================================================
// EASTER EGG WIRING — 2 edits to App.js + 1 file drop
// ============================================================================

// STEP 1: Drop the files
//   - EasterEgg.js → project root (same folder as App.js)
//   - peteyboi.jpg → the `public/` folder at project root
//     (Expo serves anything in /public at the root URL. If /public doesn't
//      exist, create it. That's where favicons and such live.)

// STEP 2: Edit App.js — add 1 import near the other imports
import EasterEgg from './EasterEgg';

// STEP 3: Edit App.js — add the <EasterEgg /> component at the very end of
// your root return statement, JUST BEFORE the closing </View> or </SafeAreaView>
// of your top-level component.
//
// Example — if your App.js has something like:
//
//   return (
//     <View style={styles.container}>
//       {/* ... all your tabs and content ... */}
//     </View>
//   );
//
// Change it to:
//
//   return (
//     <View style={styles.container}>
//       {/* ... all your tabs and content ... */}
//       <EasterEgg theme={theme} />
//     </View>
//   );

// That's it. The easter egg listens globally for mouse/keyboard/scroll
// activity. If you go still for 5 seconds anywhere in the app, it fires.
// 45-second cooldown after dismissal so it doesn't spam.
