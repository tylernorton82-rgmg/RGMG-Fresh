// PlayerPhoto.js
// Fetches a player's photo from Wikipedia based on their regen lineage.
//
// How it works:
//   1. Given a player name (possibly a regen or a regen-of-a-regen),
//      walk up the `pregen` chain in draftLookup until we hit a name
//      with no pregen — that's the root real NHL player.
//   2. Fetch that root name's thumbnail from Wikipedia's REST API.
//   3. Cache the result in localStorage for 30 days to avoid hammering Wikipedia.
//   4. Show silhouette placeholder if no photo exists or fetch fails.
//
// Usage:
//   <PlayerPhoto name="Kristian Larouche" draftLookup={draftLookup} size={48} />
//   <PlayerPhoto name="Kristian Larouche" draftLookup={draftLookup} size={48}
//                onLineageResolved={(chain) => console.log(chain)} />

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, Platform } from 'react-native';
import photoOverrides from './playerPhotoOverrides.json';
import DRAFT_DATA from './assets/data/draftData.json';

// ============================================================================
// FALLBACK DRAFT LOOKUP
// ============================================================================
// Built from the bundled draftData.json. Used when callers don't pass a
// draftLookup prop, OR when their lookup is empty (e.g., due to a hot-reload
// quirk or initial render before App.js has finished its useMemo). Either
// way, the regen chain still resolves correctly. Diacritics are stripped so
// "Magnus Pääjärvi" and "Magnus Paajarvi" map to the same key.
//
// The name normalizer is declared here too (matching the one further below
// used in resolveRegenChain) so this top-level IIFE can use it without
// hoisting issues.
const _normalizeForLookup = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const FALLBACK_DRAFT_LOOKUP = (() => {
  const lookup = {};
  if (Array.isArray(DRAFT_DATA)) {
    for (const d of DRAFT_DATA) {
      if (!d || !d.name) continue;
      const k = _normalizeForLookup(d.name);
      if (!lookup[k]) {
        lookup[k] = {
          draftYear: d.draftYear,
          round: d.round,
          overall: d.overall,
          pregen: d.pregen,
          team: d.team || null,
        };
      }
    }
  }
  return lookup;
})();

// ============================================================================
// MANUAL PHOTO OVERRIDES
// ============================================================================
// Static JSON list wins over Wikipedia + NHL.com. Used for:
//   - Pre-debut prospects (drafted but not yet in any public NHL index)
//   - Real players Wikipedia + NHL.com both miss
//   - Any regen the user wants to manually assign a photo to
// Keys are case-insensitive player names; empty values are ignored (treated
// as no override, so normal Wikipedia/NHL lookups still run).
const OVERRIDE_MAP = (() => {
  const out = {};
  for (const [name, url] of Object.entries(photoOverrides || {})) {
    if (name.startsWith('_')) continue; // skip _comment etc.
    if (typeof url === 'string' && url.trim()) {
      out[name.toLowerCase().trim()] = url.trim();
    }
  }
  return out;
})();

function getPhotoOverride(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().trim();
  return OVERRIDE_MAP[key] || null;
}


// ============================================================================
// REGEN CHAIN RESOLUTION
// ============================================================================

/**
 * Walk the pregen chain starting at `name` and return the full lineage as an array.
 * The LAST element is the root real NHL player (used for Wikipedia photo lookup).
 *
 * Example:
 *   Bob Smith (pregen = Kristian Larouche)
 *   Kristian Larouche (pregen = Vincent Lecavalier)
 *   Vincent Lecavalier (no pregen)
 * returns ["Bob Smith", "Kristian Larouche", "Vincent Lecavalier"]
 *
 * Handles:
 *   - Names with no draft entry (returns [name] — assume it IS the root)
 *   - Circular references (safety: bails out with visited set)
 *   - Empty/dash/whitespace pregen values (treated as no pregen)
 */
// Strip diacritics + lowercase + trim. Sim renders names in ASCII so a
// key like "Magnus Pääjärvi" must match a roster name "Magnus Paajarvi"
// when walking the chain.
const normalizeName = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export function resolveRegenChain(name, draftLookup) {
  if (!name) return [];
  // Fallback to bundled draft data if no lookup was passed (or it's empty).
  // Belt-and-suspenders: even if a caller forgets to pass draftLookup,
  // lineage still resolves correctly using the same JSON App.js builds from.
  const lookup = (draftLookup && Object.keys(draftLookup).length > 0)
    ? draftLookup
    : FALLBACK_DRAFT_LOOKUP;
  const chain = [];
  const visited = new Set();
  let current = String(name).trim();

  while (current && !visited.has(normalizeName(current))) {
    visited.add(normalizeName(current));
    chain.push(current);

    const entry = lookup?.[normalizeName(current)];
    const pregen = entry?.pregen;

    // Root reached: no entry, or entry has no pregen value
    if (!pregen || !String(pregen).trim() || String(pregen).trim() === '-') {
      break;
    }

    current = String(pregen).trim();
  }

  return chain;
}

/** Convenience: get the root (last item) of the regen chain. */
export function resolveRootPlayer(name, draftLookup) {
  const chain = resolveRegenChain(name, draftLookup);
  return chain.length > 0 ? chain[chain.length - 1] : name;
}

// ============================================================================
// WIKIPEDIA PHOTO FETCH (with localStorage cache)
// ============================================================================

/**
 * Returns true if a Wikipedia description looks like a hockey player.
 * Used to distinguish real NHL players (show their own photo) from regens
 * (fall back to the pregen chain for a photo).
 */
function looksLikeHockeyPlayer(description) {
  if (!description) return false;
  const d = String(description).toLowerCase();
  // Broad set of hockey-related keywords covering international leagues,
  // positions, and variants. More matches = fewer false rejections on
  // players whose bios use regional phrasing.
  return (
    d.includes('hockey') ||
    d.includes('nhl') ||
    d.includes('khl') ||
    d.includes('ahl') ||
    d.includes('shl') ||
    d.includes('liiga') ||
    d.includes('iihf') ||
    d.includes('goaltender') ||
    d.includes('defenceman') ||
    d.includes('defenseman')
  );
}

/**
 * Resolve the best Wikipedia match for a player.
 *
 * Strategy depends on `hasStatsInGame`:
 *   - TRUE  (player plays in the sim — real NHL player OR regen):
 *     Try ONLY their own name. If Wikipedia has a page for them, it's a
 *     real player and we use their own photo. If no Wikipedia hit, they're
 *     a regen — return null so the component shows a country flag.
 *     NEVER walk up to a comparable's photo.
 *   - FALSE (player has no stats — retired historical player or comparable
 *     target who never entered the sim, e.g. Wayne Gretzky, Pat Quinn):
 *     Walk up the pregen chain until we find a Wikipedia hit. Used when a
 *     user clicks the lineage breadcrumb on a regen's page and lands on a
 *     historical player who's the sim's comparable target.
 *
 * Returns { url, description, resolvedName, isComp } or null.
 *   - isComp=true when resolvedName differs from the requested name
 *     (i.e. we walked up the chain and landed on a different person).
 */
export async function resolveBestHockeyMatch(name, draftLookup, hasStatsInGame = true) {
  if (!name) return null;

  // Try to find an "own photo" — i.e. a photo of THIS player specifically.
  // Check override JSON first (manual real-player entries), then Wikipedia,
  // then NHL.com. This is how real NHL players — famous, young, or pre-debut
  // with a manual override — get their own face.
  const tryOwn = async (n) => {
    const override = getPhotoOverride(n);
    if (override) return { url: override, description: '', resolvedName: n, isComp: false, source: 'override' };
    const wiki = await fetchWikipediaPhoto(n);
    if (wiki && wiki.url) return { ...wiki, resolvedName: n, isComp: false, source: 'wikipedia' };
    const nhl = await fetchNHLHeadshot(n);
    if (nhl && nhl.url) return { url: nhl.url, description: '', resolvedName: n, isComp: false, source: 'nhl' };
    return null;
  };

  // 1. Try the player's own photo first. If found, use it — whether real
  //    player or regen that somehow shares a name with a Wikipedia entry.
  const own = await tryOwn(name);
  if (own) return own;

  // 2. No own photo found. Walk the pregen chain. Works for regens (whose
  //    generated name never hits any source) and also handles multi-step
  //    lineages: Divis → Larouche → Lecavalier. First ancestor with any
  //    source is used, flagged as a comp so the caller shows the caption.
  //    Real pre-debut prospects without an override will also walk here,
  //    so put them in playerPhotoOverrides.json to get their own photo.
  const chain = resolveRegenChain(name, draftLookup);
  // chain[0] is the current name (already tried). Skip it and walk ancestors.
  for (let i = 1; i < chain.length; i++) {
    const ancestor = chain[i];
    const hit = await tryOwn(ancestor);
    if (hit) {
      return { ...hit, resolvedName: ancestor, isComp: true };
    }
  }

  // 3. No photo anywhere in the lineage. Component renders country flag.
  return null;
}

// Cache prefix — BUMP THIS VERSION WHEN FETCHER LOGIC CHANGES.
// Stale entries from older logic (e.g. pre-(ice_hockey)-disambiguator fix,
// pre-encodeURI fix) would otherwise still return null for players whose
// Wikipedia pages actually exist. Bumping the prefix effectively invalidates
// all old cached results without requiring users to manually clear localStorage.
const CACHE_PREFIX = 'rgmg_wiki_photo_v6_';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for "no photo found"

const ALLOWED_PHOTO_ORIGINS = [
  'https://en.wikipedia.org',
  'https://upload.wikimedia.org',
  'https://assets.nhle.com',
];

function isAllowedPhotoUrl(url) {
  if (!url) return true; // null/undefined url means negative cache entry — allow
  return ALLOWED_PHOTO_ORIGINS.some(origin => String(url).startsWith(origin));
}

function readCache(key) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - (parsed.ts || 0) > (parsed.url ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS)) return null;
    if (!isAllowedPhotoUrl(parsed.url)) return null;
    return parsed; // { url, ts, description }
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify({ ...value, ts: Date.now() }));
    }
  } catch {
    // Silent fail — cache is optional. Quota errors shouldn't break the app.
  }
}

// In-flight dedupe so simultaneous <PlayerPhoto> mounts for the same name
// only fire one network request.
const inflight = {};

/**
 * Fetch a Wikipedia summary for `name` and return { url, description }.
 * Returns null if no photo found.
 *
 * Uses TWO strategies and picks the best hockey match:
 *   1. Direct URL variants (fast): plain name, Name_(ice_hockey), Name_(hockey)
 *   2. MediaWiki search API (robust): searches for "Name ice hockey" and
 *      returns the top-matching hockey-described page with a thumbnail.
 *
 * The search API handles cases where our URL-slug guessing doesn't find the
 * right page — e.g. players with unusual name formatting or disambiguator
 * conventions. The search still filters to hockey-described pages so a regen
 * named "Bob Smith" doesn't accidentally resolve to a politician.
 */
export async function fetchWikipediaPhoto(name) {
  if (!name) return null;
  const cacheKey = CACHE_PREFIX + name.toLowerCase();
  const cached = readCache(cacheKey);
  if (cached) {
    return cached.url ? { url: cached.url, description: cached.description || '' } : null;
  }

  if (inflight[cacheKey]) return inflight[cacheKey];

  const isHockey = (desc) => {
    if (!desc) return false;
    const d = String(desc).toLowerCase();
    return d.includes('hockey') || d.includes('nhl') || d.includes('khl') ||
      d.includes('ahl') || d.includes('shl') || d.includes('liiga') ||
      d.includes('iihf') || d.includes('goaltender') ||
      d.includes('defenceman') || d.includes('defenseman');
  };

  const promise = (async () => {
    let best = null; // fallback if nothing is specifically hockey-tagged
    let rateLimited = false;

    try {
    // ─── STRATEGY 1: Direct URL slugs ───────────────────────────────────
    const underscoreName = name.replace(/\s+/g, '_');
    const variants = [
      underscoreName,
      underscoreName + '_(ice_hockey)',
      underscoreName + '_(hockey)',
    ];

    for (const slug of variants) {
      // Slugs with disambiguators (ice_hockey, hockey) are self-proving — if
      // the page exists at that URL, it IS a hockey player. Plain slugs can
      // land on any random person who shares the name, so we require the
      // description to look hockey-related before accepting.
      const slugGuaranteesHockey = slug.includes('(ice_hockey)') || slug.includes('(hockey)');
      let attempt = 0;
      let lastRes = null;
      // Retry loop: 429 means rate-limited, not "not found." We wait and
      // retry up to 3 times. Pages that genuinely don't exist return 404
      // and break immediately.
      while (attempt < 3) {
        try {
          // encodeURI (NOT encodeURIComponent) — Wikipedia REST API needs
          // raw parens in the path; %28/%29 returns 404.
          const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURI(slug)}`, {
            headers: { 'Accept': 'application/json' },
          });
          lastRes = res;
          if (res.status === 429) {
            // Rate limited — back off and retry
            await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
            attempt++;
            continue;
          }
          if (!res.ok) { lastRes = null; break; } // 404 etc, move to next slug
          const data = await res.json();
          if (data?.type === 'disambiguation') { lastRes = null; break; }
          const url = data?.thumbnail?.source || data?.originalimage?.source || null;
          const description = data?.description || '';
          if (!url) { lastRes = null; break; }
          if (slugGuaranteesHockey) {
            // Disambiguator already guarantees it's a hockey page. Accept.
            const result = { url, description };
            writeCache(cacheKey, result);
            return result;
          }
          if (isHockey(description)) {
            const result = { url, description };
            writeCache(cacheKey, result);
            return result;
          }
          // Plain slug, no hockey keywords in description — this is probably
          // a politician/scientist/athlete who shares a name with our player.
          // DO NOT accept as "best" — leave best null so we fall through to
          // the next slug variant (and ultimately walk the pregen chain).
          break;
        } catch {
          attempt++;
          await new Promise(r => setTimeout(r, 500));
        }
      }
      // If we exhausted retries on 429, do NOT negative-cache this miss —
      // the page may actually exist, we just couldn't reach it. Throw
      // so the outer caller can choose to retry later.
      if (lastRes && lastRes.status === 429) {
        throw new Error(`Rate limited after retries for ${slug}`);
      }
    }
    // If we got ANY page from direct URL lookup (even without hockey-tagged
    // description), use it. The direct URL is authoritative — the summary
    // for "Marco_Rossi_(ice_hockey)" IS about Marco Rossi even if the terse
    // description just says "Austrian athlete". We should NOT replace it
    // with a search result that might find a different Marco Rossi.
    if (best) {
      writeCache(cacheKey, best);
      return best;
    }

    // ─── STRATEGY 2: MediaWiki search API (only when direct URL found nothing) ──
    // Searches for "Name ice hockey" and inspects top 5 results. REQUIRES the
    // returned page title to contain the searched name — otherwise queries
    // like "Marco Rossi ice hockey" can return irrelevant pages like
    // "Russia men's national ice hockey team" just because they match "hockey".
    try {
      const nameTokens = name.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 1);

      const searchUrl = 'https://en.wikipedia.org/w/api.php?' + [
        'action=query',
        'format=json',
        'formatversion=2',
        'generator=search',
        `gsrsearch=${encodeURIComponent(name + ' ice hockey')}`,
        'gsrlimit=5',
        'prop=pageimages|description',
        'piprop=thumbnail',
        'pithumbsize=400',
        'origin=*',
      ].join('&');

      const res = await fetch(searchUrl);
      if (res.ok) {
        const data = await res.json();
        const pages = data?.query?.pages || [];
        for (const page of pages) {
          const url = page?.thumbnail?.source;
          const description = page?.description || '';
          const pageTitle = (page?.title || '').toLowerCase();
          if (!url) continue;

          // Title must contain EVERY token from the searched name.
          // Filters out "Russia men's national ice hockey team" etc.
          const allTokensMatch = nameTokens.every(tok => pageTitle.includes(tok));
          if (!allTokensMatch) continue;

          if (isHockey(description)) {
            const result = { url, description };
            writeCache(cacheKey, result);
            return result;
          }
          // Don't accept non-hockey pages as `best`. A wrong face is worse
          // than a flag. Fall through to the next page or return null.
        }
      }
    } catch {
      // Search failed — return null below
    }

    if (best) {
      writeCache(cacheKey, best);
      return best;
    }
    writeCache(cacheKey, { url: null });
    return null;
    } catch (err) {
      if (err && String(err.message || err).includes('Rate limited')) {
        rateLimited = true;
      }
    }
    // Rate limited path: return null WITHOUT caching so next load retries.
    if (rateLimited) {
      return null;
    }
    return null;
  })().finally(() => {
    delete inflight[cacheKey];
  });

  inflight[cacheKey] = promise;
  return promise;
}

// ============================================================================
// NHL.COM HEADSHOT FALLBACK
// ============================================================================
//
// Wikipedia has thin coverage of young/obscure active NHL players
// (Helenius, Cristall, etc. routinely 404). When Wikipedia fails for a
// real player, we fall back to NHL.com:
//   1. Hit the public search API by name
//   2. Require an EXACT name match in the results (case-insensitive)
//   3. Grab the returned real NHL playerId
//   4. Headshot URL = https://assets.nhle.com/mugs/nhl/latest/{id}.png
//
// The exact-match guard prevents false positives when a regen's fictional
// name is a partial match for some real player (e.g. regen "Michael Smith"
// should NOT pull up an actual "Michael Smith" on NHL.com).
//
// Same cache strategy as Wikipedia — 30-day TTL positive, 7-day negative.
const NHL_CACHE_PREFIX = 'rgmg_nhl_headshot_v1_';
const nhlInflight = {};

export async function fetchNHLHeadshot(name) {
  if (!name) return null;
  const cacheKey = NHL_CACHE_PREFIX + name.toLowerCase();
  const cached = readCache(cacheKey);
  if (cached) {
    return cached.url ? { url: cached.url, source: 'nhl' } : null;
  }
  if (nhlInflight[cacheKey]) return nhlInflight[cacheKey];

  const normalizeName = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const promise = (async () => {
    try {
      const searchUrl = 'https://search.d3.nhle.com/api/v1/search/player?'
        + 'culture=en-us&limit=10&active=true&q=' + encodeURIComponent(name);
      const res = await fetch(searchUrl);
      if (!res.ok) {
        writeCache(cacheKey, { url: null });
        return null;
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        writeCache(cacheKey, { url: null });
        return null;
      }
      const target = normalizeName(name);
      const match = data.find(p => normalizeName(p.name) === target);
      if (!match || !match.playerId) {
        writeCache(cacheKey, { url: null });
        return null;
      }
      const result = { url: `https://assets.nhle.com/mugs/nhl/latest/${match.playerId}.png`, source: 'nhl' };
      writeCache(cacheKey, result);
      return result;
    } catch {
      // Network/CORS/etc — negative-cache so we don't keep retrying
      writeCache(cacheKey, { url: null });
      return null;
    }
  })().finally(() => {
    delete nhlInflight[cacheKey];
  });

  nhlInflight[cacheKey] = promise;
  return promise;
}

// ============================================================================
// <PlayerPhoto /> COMPONENT
// ============================================================================

/**
 * Renders a circular player photo. Falls back to silhouette if no photo.
 *
 * Props:
 *   name: string — the player's current name (will resolve regen chain)
 *   draftLookup: object — map from lowercased name → { pregen, draftYear, ... }
 *   size: number — pixel size (default 48)
 *   showBorder: bool — whether to show a border (default true)
 *   borderColor: string — (default "#e0e0e0")
 *   onLineageResolved: (chain) => void — callback with resolved chain array
 */
export default function PlayerPhoto({
  name,
  draftLookup,
  country = null,
  hasStatsInGame = true,
  size = 48,
  showBorder = true,
  borderColor = '#e0e0e0',
  onLineageResolved = null,
  onResolved = null, // optional: callback with { resolvedName, isComp }
}) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const latestNameRef = useRef(name);

  useEffect(() => {
    latestNameRef.current = name;
    setLoading(true);
    setPhotoUrl(null);
    setFailed(false);

    const chain = resolveRegenChain(name, draftLookup);
    if (onLineageResolved) onLineageResolved(chain);

    // Strategy controlled by hasStatsInGame:
    //   true  → own Wikipedia only; regens with no hit show country flag
    //   false → walk pregen chain for comp's photo (historical names like Gretzky)
    resolveBestHockeyMatch(name, draftLookup, hasStatsInGame).then(result => {
      if (latestNameRef.current !== name) return;
      if (result?.url) {
        setPhotoUrl(result.url);
        setFailed(false);
        if (onResolved) onResolved({
          resolvedName: result.resolvedName,
          isComp: !!result.isComp,
          source: result.source || 'wikipedia', // 'wikipedia' | 'nhl' | 'override'
        });
      } else {
        setFailed(true);
        if (onResolved) onResolved({ resolvedName: null, isComp: false, source: null });
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, draftLookup, hasStatsInGame]);

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: '#f0f0f0',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...(showBorder ? { borderWidth: 1, borderColor } : {}),
  };

  // Loaded photo
  if (photoUrl && !failed) {
    // On web, use a native <img> with object-position: top so faces stay
    // visible for portrait-oriented Wikipedia photos (which often get their
    // heads cropped off by center-crop thumbnails).
    if (Platform.OS === 'web') {
      return (
        <View style={containerStyle}>
          <img
            src={photoUrl}
            alt={name || 'player'}
            onError={() => setFailed(true)}
            style={{
              width: size,
              height: size,
              objectFit: 'cover',
              objectPosition: 'center top', // Wikipedia thumbnails have faces at the top — show the top edge
              display: 'block',
            }}
          />
        </View>
      );
    }
    return (
      <View style={containerStyle}>
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  // Loading or no photo — show flag (if country known) + initials
  const initials = String(name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const countryCode = country ? String(country).toLowerCase().trim() : null;
  const validCountryCode = countryCode && /^[a-z]{2}$/.test(countryCode) ? countryCode : null;
  const flagUrl = validCountryCode ? `https://flagcdn.com/w160/${validCountryCode}.png` : null;

  return (
    <View style={containerStyle}>
      {flagUrl && !loading ? (
        <Image
          source={{ uri: flagUrl }}
          style={{ position: 'absolute', width: size, height: size, opacity: 0.55 }}
          resizeMode="cover"
        />
      ) : null}
      <View style={{
        // Dark pill behind initials for legibility over flag
        backgroundColor: flagUrl && !loading ? 'rgba(0,0,0,0.35)' : 'transparent',
        paddingHorizontal: size * 0.15,
        paddingVertical: size * 0.05,
        borderRadius: size * 0.2,
      }}>
        <Text style={{
          fontSize: size * 0.38,
          fontWeight: '700',
          color: flagUrl && !loading ? '#fff' : '#888',
          textShadowColor: flagUrl && !loading ? 'rgba(0,0,0,0.6)' : 'transparent',
          textShadowRadius: 2,
        }}>
          {loading ? '•••' : initials}
        </Text>
      </View>
    </View>
  );
}
