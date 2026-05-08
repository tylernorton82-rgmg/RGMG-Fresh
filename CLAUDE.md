# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RGMG Analytics — companion app for the **30-team** RGMG hockey simulation league. Single Expo (SDK 54) / React Native 0.81 codebase that ships to web (Vercel), Android (Play Store), and iOS (App Store). React 19.1, Hermes on Android. No test suite is configured — there is no `jest`/`vitest` runner. Don't claim tests pass; if behavior needs verifying, run the dev server and exercise the feature in a browser.

> **30 teams, not 32.** Tier sizes, rank cutoffs, line-count math, and draft slots all anchor to 30. Don't "fix" them to 32.

## Common commands

```
npx expo start --clear                        # dev server, clears Metro cache
npx expo start                                # dev server
npx expo export --platform web                # build web bundle into dist/

eas build --platform android --profile production
eas submit --platform android
eas build --platform ios --profile production
eas submit --platform ios
eas build:list                                # build status

node update-season.js --season 12 --type regular   --players playersSeason12.csv  --goalies goaliesSeason12.csv
node update-season.js --season 10 --type playoffs  --players playersSeason10p.csv --goalies goaliesSeason10p.csv
node update-season.js --season 10 --images --east "url" --west "url" --playoffs "url"
```

If Metro acts up after dependency or SDK changes: delete `.expo/`, `node_modules/`, `android/`, `ios/`, `dist/`, then `npm install` and `npx expo start --clear`. The `.easignore` and `plugins/withGradleFix.js` exist specifically to keep EAS cloud builds working — see `README.md` if you have to touch them.

## High-level architecture

`index.js` → `App.js` (`MainApp`) is one big tabbed component (`activeTab` state). Public tabs:

- **Stats** / **My Roster** — built into `App.js` directly
- **Rankings** (`Rankings.js`) — TrueI charts/tables across seasons
- **Teams** (`renderTeamStatsTab`) — team comparison view
- **Cap Dashboard** (`CapDashboard.js`) — cap tracking + contract value scatter
- **Lines Builder** (`LinesBuilder.js`) — line-builder UI
- **Roster Cap Summary** (`RosterCapSummary.js`)
- **Trade Calc** (`TradeCalcV2.js`, lazy-loaded as `TradeCalc`)
- **Analysis** (`renderAnalysisTab`) — player tier / role / replacement-delta analysis
- **Remix** (`Remix.js`) — fantasy/remix tab

Player/goalie data is **bundled at build time**, not fetched at runtime. `bundledData.js` statically `require()`s every season file in `assets/data/` and exports `PLAYER_DATA`, `GOALIE_DATA`, `SEASONS`, `SEASON_TO_NUMBER`, `SEASON_IMAGES`. Adding a new season means landing the JSON files in `assets/data/` **and** wiring the new `require` lines into `bundledData.js` — `update-season.js` does both.

### Storage

`storage.js` exposes `storageGetItem/Set/Remove` plus `migrateStorageToIndexedDb` (called once at app start). On native it uses `@react-native-async-storage/async-storage`; on web it routes through IndexedDB (`rgmgapp` DB, `kv` store). Use these helpers — don't reach for AsyncStorage or localStorage directly.

### API: proxy-or-upstream pattern

There are two ways data reaches the app: bundled JSON (above) and a live rgmg.ca upstream. On the Vercel-hosted site, `api/*.js` are serverless functions that proxy and normalize the upstream. On local Expo dev there's no serverless layer, so a bare `/api/...` call hits the dev server's HTML fallback and explodes parsing `<!doctype html>` as JSON.

`lib/apiClient.js` `fetchProxyOrUpstream(proxyPath, upstreamPath, opts?)` tries the proxy first, falls back to the direct upstream on failure or non-JSON. **Use it for any new API call** — don't hand-roll `fetch('/api/...')`. `transformUpstream` lets each call site reshape the upstream body to match what the proxy would have returned.

### Other notable modules

- **`PlayerModal.js` / `PlayerPhoto.js`** — the player detail card; `PlayerPhoto` resolves via Wikipedia → NHL → manual override → country flag, reporting the source back via `onResolved` so the My Team row can render a colored status dot (green/blue/red).
- **`ImportFromRGMG.js`** — paste-text importer that maps RGMG site exports into local roster shape.
- **`PeteyRejection.js`** / **`EasterEgg.js`** — UI flourish.

## Conventions worth preserving

- **Vercel functions cache:** `Cache-Control: s-maxage=3600, stale-while-revalidate=86400` is standard on the proxy endpoints — match that if you add new ones.
- **Lazy imports need Suspense fallbacks** — when adding a new lazy tab, copy the pattern in App.js (it already has one Suspense wrapper around the lazy tabs).
