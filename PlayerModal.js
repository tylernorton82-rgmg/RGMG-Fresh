// PlayerModal.js
// A modal overlay that shows a detailed player dossier:
//   - Photo (resolved from Wikipedia via regen chain)
//   - Name, team, position, handedness, type, age
//   - Contract details
//   - Current season stats
//   - Career history (TRUEi per season)
//   - Clickable regen lineage at the bottom
//   - Back button navigates through player browse history
//
// The modal maintains its own navigation stack — when a user clicks a
// lineage link, we push the current player onto the stack so "Back" works.
//
// Usage:
//   const [modalPlayer, setModalPlayer] = useState(null);
//   <PlayerModal
//     playerName={modalPlayer}
//     onClose={() => setModalPlayer(null)}
//     draftLookup={draftLookup}
//     groupedPlayers={groupedPlayers}
//     rosterContracts={rosterContracts}
//     calculateTRUEi={calculateTRUEi}
//     theme={theme}
//     darkMode={darkMode}
//   />
//   ...
//   <TouchableOpacity onPress={() => setModalPlayer('Kristian Larouche')}>
//     <Text>Kristian Larouche</Text>
//   </TouchableOpacity>

import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Platform } from 'react-native';
import PlayerPhoto, { resolveRegenChain, fetchWikipediaPhoto } from './PlayerPhoto';
import { fetchProxyOrUpstream } from './lib/apiClient.js';

// Career sparkline — shows the player's per-season output as a tiny bar chart.
// For skaters the bar height is points (G+A). For goalies we use SV% mapped
// onto a 0-100 range (multiply by 100). No SVG dependency — pure View bars.
//
// Tapping a bar fires `onSelectSeason(season)` so the parent can switch the
// stat block below to that specific year. The currently-selected bar gets
// the accent color; otherwise the latest season is highlighted by default.
//
// Props:
//   seasons: array of season rows, ordered most-recent FIRST (we reverse here)
//   isGoalie: bool — picks the metric (points vs sv%)
//   accentColor: highlight color for the selected/latest bar
//   barColor: base color for non-highlighted seasons
//   textSecondary: muted text for axis labels
//   selectedSeason: season string (e.g. "2024-25") that's currently picked
//   onSelectSeason: (seasonStr) => void
function CareerSparkline({ seasons, isGoalie, accentColor, barColor, textSecondary, selectedSeason, onSelectSeason }) {
  const ordered = useMemo(() => (seasons || []).slice().reverse(), [seasons]);
  if (ordered.length < 2) return null;

  const getValue = (s) => {
    if (isGoalie) {
      const sv = parseFloat(s.sv || s.svPct || s.savePct || 0) || 0;
      return sv > 1 ? sv : sv * 100;
    }
    return (parseInt(s.g, 10) || 0) + (parseInt(s.a, 10) || 0);
  };

  const values = ordered.map(getValue);
  const max = Math.max(...values, 1);
  const min = isGoalie ? Math.min(...values, max) : 0;
  const range = Math.max(max - min, 1);
  const peakIdx = values.indexOf(Math.max(...values));
  const latestIdx = values.length - 1;
  // If a specific season is selected, use that. Otherwise default to latest.
  const selectedIdx = selectedSeason
    ? ordered.findIndex(s => s.season === selectedSeason)
    : latestIdx;

  return (
    <View style={{ marginBottom: 10, paddingHorizontal: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: 11, color: textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Career Arc · {isGoalie ? 'SV%' : 'Points'}
        </Text>
        <Text style={{ fontSize: 10, color: textSecondary }}>
          tap a bar
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2 }}>
        {ordered.map((s, i) => {
          const v = values[i];
          const pct = (v - min) / range;
          const height = Math.max(4, pct * 44);
          const isSelected = i === selectedIdx;
          const isPeak = i === peakIdx && !isSelected;
          // Selected/latest gets the accent color. Peak gets a distinct
          // light blue so it doesn't blend with the accent (which is often
          // green). Everything else falls back to the muted bar color.
          const color = isSelected ? accentColor : isPeak ? '#7ab8e6' : barColor;
          return (
            <TouchableOpacity
              key={`${s.season}-${i}`}
              onPress={() => onSelectSeason && onSelectSeason(s.season)}
              activeOpacity={0.6}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 48 }}
            >
              <View style={{ width: '100%', height, backgroundColor: color, borderRadius: 2, minHeight: 4 }} />
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 }}>
        <Text style={{ fontSize: 9, color: textSecondary }}>
          {formatSeasonLabel(ordered[0]?.season)}
        </Text>
        <Text style={{ fontSize: 9, color: accentColor, fontWeight: '600' }}>
          {formatSeasonLabel(ordered[selectedIdx]?.season)} · {isGoalie ? values[selectedIdx].toFixed(1) : values[selectedIdx]}
        </Text>
        <Text style={{ fontSize: 9, color: textSecondary }}>
          {formatSeasonLabel(ordered[ordered.length - 1]?.season)}
        </Text>
      </View>
    </View>
  );
}

// Season label helper — "2024-25" stays as-is
const formatSeasonLabel = (season) => {
  if (!season) return '—';
  if (/^\d{4}-\d{4}$/.test(season)) return season;
  const m = String(season).match(/^(\d{4})-(\d{2})$/);
  if (!m) return season;
  const start = parseInt(m[1], 10);
  return `${start}-${String(start + 1).slice(-2)}`;
};

// Fetch the rgmg.ca player record (for trade history + awards). Cached in
// localStorage for 2 hours so reopening the modal doesn't refetch. Returns
// null on any error / not-found so callers can render gracefully.
const RGMG_CACHE_PREFIX = 'rgmg_player_v1_';
const RGMG_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const rgmgInflight = {};

async function fetchRGMGPlayer(name) {
  if (!name) return null;
  const cacheKey = RGMG_CACHE_PREFIX + name.toLowerCase();
  // Try cache first
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(cacheKey) : null;
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && cached.savedAt && (Date.now() - cached.savedAt) < RGMG_CACHE_TTL_MS) {
        return cached.player;
      }
    }
  } catch {}

  if (rgmgInflight[cacheKey]) return rgmgInflight[cacheKey];

  const promise = (async () => {
    try {
      // Vercel proxy wraps the response as { found, player }; on local dev we
      // fall back to the upstream `/api/players/{name}` which returns the raw
      // player object — wrap it to match the proxy shape so the consumer
      // doesn't need to branch on transport.
      const data = await fetchProxyOrUpstream(
        `/api/rgmg-player?name=${encodeURIComponent(name)}`,
        `/api/players/${encodeURIComponent(name)}`,
        {
          transformUpstream: (player) => ({ found: true, player }),
          notFoundValue: { found: false },
        },
      );
      if (!data) return null;
      const player = data?.found ? data.player : null;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(cacheKey, JSON.stringify({ player, savedAt: Date.now() }));
        }
      } catch {}
      return player;
    } catch {
      return null;
    }
  })().finally(() => {
    delete rgmgInflight[cacheKey];
  });

  rgmgInflight[cacheKey] = promise;
  return promise;
}

export default function PlayerModal({
  playerName,
  onClose,
  draftLookup,
  groupedPlayers,
  goalieDatabase,
  rosterContracts,
  calculateTRUEi,
  calculateTRUEiBreakdown,
  calculateTRUEiZ,
  calculateGSAA,
  leagueAvgSvPct,
  onNavigateToTeam,
  convertAhlToNhl,
  theme,
  darkMode,
}) {
  // Identity fallback if convertAhlToNhl not provided
  const mapTeam = convertAhlToNhl || ((t) => t);
  // Navigation stack: array of names. Current player = last item.
  const [stack, setStack] = useState([]);
  const [wikiSummary, setWikiSummary] = useState(null);
  // Career view mode: 'single' (most recent), 'last3' (last 3 summed), 'all'
  // (summed), or 'specific' (a particular season picked from the sparkline).
  const [careerMode, setCareerMode] = useState('single');
  // When mode is 'specific', this holds the season string (e.g. "2024-25")
  const [selectedSeason, setSelectedSeason] = useState(null);
  // Trades pulled from the rgmg.ca player API. null = not loaded, [] = no trades
  const [rgmgTrades, setRgmgTrades] = useState(null);
  // Full rgmg.ca player record. Used to fill in attribute gaps when the sim
  // API doesn't have a record yet (e.g. brand-new draftees show in
  // draftData.json + on rgmg.ca but haven't been added to /api/players).
  const [rgmgPlayer, setRgmgPlayer] = useState(null);

  // When playerName prop changes (modal opened on a new player), reset stack.
  useEffect(() => {
    if (playerName) {
      setStack([playerName]);
    } else {
      setStack([]);
    }
  }, [playerName]);

  const currentName = stack.length > 0 ? stack[stack.length - 1] : null;

  // Walk to a new player (push onto stack)
  const navigateTo = (name) => {
    if (!name || name === currentName) return;
    setStack(prev => [...prev, name]);
  };

  // Back button — pop one off the stack
  const goBack = () => {
    setStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev);
  };

  // Resolve regen chain for current player
  const lineage = useMemo(() => {
    return currentName ? resolveRegenChain(currentName, draftLookup) : [];
  }, [currentName, draftLookup]);

  // Photo resolution is owned by <PlayerPhoto>. It calls back with the
  // resolved name + whether we landed on a comparable (walked up the chain).
  // This also drives the Wikipedia summary text and the comp-photo caption.
  const [resolvedName, setResolvedName] = useState(null);
  const [isCompPhoto, setIsCompPhoto] = useState(false);
  // Fetch Wikipedia summary text separately using whatever name we resolved to
  useEffect(() => {
    if (!resolvedName) { setWikiSummary(null); return; }
    let cancelled = false;
    fetchWikipediaPhoto(resolvedName).then(result => {
      if (cancelled) return;
      setWikiSummary(result?.description || null);
    });
    return () => { cancelled = true; };
  }, [resolvedName]);

  // Fetch trade history from rgmg.ca for the current player. Resets between
  // player navigations so we don't show stale data from the previous player.
  useEffect(() => {
    if (!currentName) { setRgmgTrades(null); setRgmgPlayer(null); return; }
    let cancelled = false;
    setRgmgTrades(null);
    setRgmgPlayer(null);
    setCareerMode('single');
    setSelectedSeason(null);
    fetchRGMGPlayer(currentName).then(player => {
      if (cancelled) return;
      setRgmgPlayer(player || null);
      setRgmgTrades(Array.isArray(player?.trades) ? player.trades : []);
    });
    return () => { cancelled = true; };
  }, [currentName]);

  // Find player data — check skater groupedPlayers first, fall back to goalieDatabase.
  // Goalies are stored separately in the app, so we need to group them on-the-fly here.
  const playerData = useMemo(() => {
    if (!currentName) return null;
    // Strip diacritics on BOTH sides of every comparison. Some draft data
    // names carry diacritics ("Magnus Pääjärvi") while the sim's roster
    // database stores the ASCII form ("Magnus Paajarvi"). Without
    // normalization, clicking the lineage link would fail to find the
    // player and incorrectly flag them as a comparable.
    const stripDiacritics = (s) => String(s || '')
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const lowerName = stripDiacritics(currentName);

    // 1. Exact skater match
    const asSkater = groupedPlayers?.find(p => stripDiacritics(p.name) === lowerName);
    if (asSkater && asSkater.seasons && asSkater.seasons.length > 0) {
      return { ...asSkater, isGoalie: false };
    }

    // 2. Exact goalie match — group by name on-the-fly
    if (goalieDatabase && goalieDatabase.length > 0) {
      const goalieSeasons = goalieDatabase.filter(g => stripDiacritics(g.name || '') === lowerName);
      if (goalieSeasons.length > 0) {
        return { name: goalieSeasons[0].name, seasons: goalieSeasons, isGoalie: true };
      }
    }

    // 3. Fuzzy skater match — case-insensitive substring or first-last partial
    // Handles name variants like "Anton Divis" vs "Antonin Divis" that come
    // from URL shares where the shared name may be abbreviated.
    if (groupedPlayers && groupedPlayers.length > 0) {
      const fuzzy = groupedPlayers.find(p => {
        const pName = stripDiacritics(p.name || '');
        if (!pName) return false;
        // Match if either name contains the other (either direction)
        return pName.includes(lowerName) || lowerName.includes(pName);
      });
      if (fuzzy && fuzzy.seasons && fuzzy.seasons.length > 0) {
        return { ...fuzzy, isGoalie: false };
      }
    }

    // 4. Fuzzy goalie match
    if (goalieDatabase && goalieDatabase.length > 0) {
      const candidates = goalieDatabase.filter(g => {
        const gName = stripDiacritics(g.name || '');
        return gName && (gName.includes(lowerName) || lowerName.includes(gName));
      });
      if (candidates.length > 0) {
        return { name: candidates[0].name, seasons: candidates, isGoalie: true };
      }
    }

    return null;
  }, [currentName, groupedPlayers, goalieDatabase]);

  // Show the lineage breadcrumb when:
  //   - the photo we resolved is a comp (walked up the chain — a regen)
  //   - OR the player isn't in the game (!playerData — comparable view),
  //     so the user can navigate back to the regen who sent them here
  // Show the lineage breadcrumb whenever there is a chain. Real NHL
  // players with comparables (Marco Rossi → comp), regens walking up to
  // their original generator, and comparable pages all benefit. Players
  // not in the draft data (Group 1, sim-start veterans) won't have a
  // chain in draftLookup so they naturally skip this.
  const showLineage = lineage.length > 1;

  // A "comparable" page is for historical real players who exist purely as
  // style/regen targets — Wayne Gretzky, Pat Quinn, Brian Campbell. They
  // are NOT in the sim. We recompute isComparable below once `contract` is
  // available, so a player who shows up in their team's roster is never
  // flagged as a comparable even if their name didn't match draft data.
  // Same diacritic-aware normalization App.js uses to build draftLookup.
  // Without this, "Edvin Tomth" → pregen "Magnus Pääjärvi" can't be looked
  // up because the sim renders the roster name as "Magnus Paajarvi".
  const normalizeName = (s) =>
    String(s || '')
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  // For DISPLAY: strip diacritics but preserve casing. Sim renders names
  // in plain ASCII so "Magnus Pääjärvi" should show as "Magnus Paajarvi".
  const displayName = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const isDraftedByName = !!(draftLookup && currentName &&
    draftLookup[normalizeName(currentName)]);

  // Helper: identify regular vs playoff rows using app's `seasonType` field
  const isPlayoffSeason = (s) => {
    const t = String(s?.seasonType || 'regular').trim().toLowerCase();
    return t === 'playoffs' || t === 'playoff' || t === 'postseason' || t === 'po';
  };

  // Career seasons — keep FULL raw stat rows so we can aggregate them later.
  // Sorted most-recent first.
  const careerTruei = useMemo(() => {
    if (!playerData) return [];
    return playerData.seasons
      .filter(s => !isPlayoffSeason(s))
      .slice()
      .sort((a, b) => String(b.season || '').localeCompare(String(a.season || '')));
  }, [playerData]);

  const careerPlayoffTruei = useMemo(() => {
    if (!playerData) return [];
    return playerData.seasons
      .filter(s => isPlayoffSeason(s))
      .slice()
      .sort((a, b) => String(b.season || '').localeCompare(String(a.season || '')));
  }, [playerData]);

  // Pull the latest regular-season row just for header info (team, pos)
  const latestSeason = careerTruei[0] || null;
  const latestPlayoff = careerPlayoffTruei[0] || null;

  // Contract lookup — try the literal name first, then ASCII'd version
  // for cases where draft data has diacritics but the roster API doesn't.
  let contract = rosterContracts?.[currentName] || null;
  if (!contract && rosterContracts && currentName) {
    const target = normalizeName(currentName);
    const matchKey = Object.keys(rosterContracts).find(k => normalizeName(k) === target);
    if (matchKey) contract = rosterContracts[matchKey];
  }
  const draftInfo = draftLookup?.[normalizeName(currentName)] || null;

  // A drafted player has ANY of: stats in game, a draft entry, or a roster
  // contract. If none of these, they're a true historical comparable.
  const isComparable = !playerData && !isDraftedByName && !contract;

  if (!currentName) return null;

  const t = theme || {};
  const bgModal = darkMode ? '#1a1e2e' : '#ffffff';
  const bgCard = t.bgCard || (darkMode ? '#242838' : '#f7f9fc');
  const textColor = t.text || (darkMode ? '#e8e8e8' : '#1a1a1a');
  const textSecondary = t.textSecondary || (darkMode ? '#a0a0a8' : '#606070');
  const borderColor = t.border || (darkMode ? '#333' : '#e0e0e0');
  const accentColor = t.accent || '#1565c0';

  return (
    <Modal
      visible={!!playerName}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <View style={{
          backgroundColor: bgModal,
          borderRadius: 12,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90%',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor,
        }}>
          {/* Top bar: back arrow + close X */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: borderColor }}>
            {stack.length > 1 ? (
              <TouchableOpacity onPress={goBack} style={{ flexDirection: 'row', alignItems: 'center', padding: 4 }}>
                <Text style={{ fontSize: 18, color: accentColor, marginRight: 4 }}>←</Text>
                <Text style={{ fontSize: 13, color: accentColor, fontWeight: '600' }}>Back</Text>
              </TouchableOpacity>
            ) : <View style={{ width: 60 }} />}
            <Text style={{ fontSize: 13, color: textSecondary, fontWeight: '600' }}>Player</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4, minWidth: 60, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 20, color: textSecondary, fontWeight: '600' }}>×</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* Photo + name block */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}>
              <View style={{ alignItems: 'center' }}>
                <PlayerPhoto
                  name={currentName}
                  draftLookup={draftLookup}
                  country={contract?.country || latestSeason?.country}
                  hasStatsInGame={!!playerData}
                  size={88}
                  onResolved={({ resolvedName: r, isComp }) => {
                    setResolvedName(r);
                    setIsCompPhoto(!!isComp);
                  }}
                />
                {isCompPhoto && resolvedName ? (
                  <Text style={{
                    fontSize: 10,
                    color: textSecondary,
                    fontStyle: 'italic',
                    marginTop: 4,
                    maxWidth: 100,
                    textAlign: 'center',
                  }} numberOfLines={2}>
                    Photo: {displayName(resolvedName)}
                  </Text>
                ) : null}
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: textColor }} numberOfLines={2}>
                  {currentName}
                </Text>
                {latestSeason?.team ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (onNavigateToTeam) {
                        onNavigateToTeam(mapTeam(latestSeason.team), latestSeason.season);
                      }
                    }}
                    disabled={!onNavigateToTeam}
                  >
                    <Text style={{ fontSize: 13, color: onNavigateToTeam ? accentColor : textSecondary, marginTop: 2, textDecorationLine: onNavigateToTeam ? 'underline' : 'none' }}>
                      {mapTeam(latestSeason.team)} · {latestSeason.pos || contract?.pos || '—'}
                    </Text>
                  </TouchableOpacity>
                ) : contract?.pos ? (
                  <Text style={{ fontSize: 13, color: textSecondary, marginTop: 2 }}>
                    {contract.pos}
                  </Text>
                ) : null}
                {wikiSummary ? (
                  <Text style={{ fontSize: 11, color: textSecondary, marginTop: 4, fontStyle: 'italic' }} numberOfLines={2}>
                    {wikiSummary}
                  </Text>
                ) : null}
                {isComparable ? (
                  <View style={{
                    alignSelf: 'flex-start',
                    backgroundColor: accentColor + '22',
                    borderWidth: 1,
                    borderColor: accentColor,
                    borderRadius: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    marginTop: 6,
                  }}>
                    <Text style={{ fontSize: 10, color: accentColor, fontWeight: '700', letterSpacing: 0.5 }}>
                      COMPARABLE
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* Key info grid — age, handedness, type, draft. Pulled from sim
                playerData when available, falls back to rgmg.ca's record so
                brand-new draftees (not yet in /api/players) still show their
                attributes. Hidden only when there's truly nothing to show. */}
            {(() => {
              const age = contract?.age || latestSeason?.age || rgmgPlayer?.age;
              const handedness = contract?.handedness || latestSeason?.handedness || rgmgPlayer?.handedness;
              const type = contract?.type || rgmgPlayer?.type;
              const hasAnything = age || handedness || type || draftInfo?.draftYear || playerData;
              if (!hasAnything) return null;
              return (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16, gap: 8 }}>
              {age ? (
                <InfoPill label="Age" value={String(age)} bg={bgCard} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
              ) : null}
              {handedness ? (
                <InfoPill label="Shoots" value={String(handedness)} bg={bgCard} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
              ) : null}
              {type ? (
                <InfoPill label="Type" value={type} bg={bgCard} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
              ) : null}
              {draftInfo?.draftYear ? (
                <InfoPill label="Draft" value={`${draftInfo.draftYear} R${draftInfo.round || '?'} #${draftInfo.overall || '?'}`} bg={bgCard} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
              ) : null}
              {/* Role tier + Z-score — shown for latest season only.
                  Z=0 is average for the role, +1 ≈ 84th pctile, +2 ≈ elite. */}
              {calculateTRUEiZ && latestSeason ? (() => {
                const zInfo = calculateTRUEiZ(latestSeason);
                if (!zInfo || !zInfo.tier) return null;
                const zNum = zInfo.z;
                // Map z → 0-100 rating (mirrors zToRating in App.js).
                const rating = (zNum == null || !Number.isFinite(zNum))
                  ? null
                  : Math.max(0, 50 + (zNum / 3) * 50);
                const color = rating == null ? textSecondary
                  : rating >= 80 ? '#2e7d32'
                  : rating <= 35 ? '#c62828'
                  : textColor;
                const ratingText = rating == null ? '—' : Math.round(rating).toString();
                return (
                  <InfoPill
                    label={`Role · ${zInfo.tierLabel}`}
                    value={ratingText}
                    bg={bgCard}
                    text={color}
                    sub={textSecondary}
                    mapTeam={mapTeam}
                  />
                );
              })() : null}
            </View>
              );
            })()}
            {/* Contract */}
            {contract && contract.salary > 0 ? (
              <Section title="Contract" bg={bgCard} text={textColor} sub={textSecondary} border={borderColor}>
                <Row label="Cap Hit" value={`$${contract.salary.toFixed(2)}M`} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                <Row label="Term" value={`${contract.contract_duration}yr`} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                <Row label="Expires as" value={contract.expiry_type || '—'} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                <Row label="Status" value={contract.status || '—'} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                {contract.retention_count > 0 ? (
                  <Row label="Retentions" value={`${contract.retention_count} prior`} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                ) : null}
              </Section>
            ) : null}

            {/* Career arc sparkline — only shows if player has 2+ seasons */}
            {careerTruei.length >= 2 ? (
              <CareerSparkline
                seasons={careerTruei}
                isGoalie={!!playerData?.isGoalie}
                accentColor={accentColor}
                barColor={borderColor}
                textSecondary={textSecondary}
                selectedSeason={careerMode === 'specific' ? selectedSeason : null}
                onSelectSeason={(season) => {
                  setCareerMode('specific');
                  setSelectedSeason(season);
                }}
              />
            ) : null}

            {/* Trade history pulled from rgmg.ca. Hidden if no trades. */}
            {Array.isArray(rgmgTrades) && rgmgTrades.length > 0 ? (
              <View style={{ marginBottom: 10, padding: 12, backgroundColor: bgCard, borderRadius: 8, borderWidth: 1, borderColor }}>
                <Text style={{ fontSize: 11, color: textSecondary, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Trade History · {rgmgTrades.length}
                </Text>
                {rgmgTrades.map((t, idx) => {
                  const team1 = t.team_1 || 'Team 1';
                  const team2 = t.team_2 || 'Team 2';
                  const players1 = String(t.players_1 || '').split(',').map(s => s.trim()).filter(Boolean);
                  const players2 = String(t.players_2 || '').split(',').map(s => s.trim()).filter(Boolean);
                  // Highlight current player in their list
                  const renderPlayerList = (names) => names.map((n, i) => {
                    const isCurrent = n.toLowerCase() === String(currentName || '').toLowerCase();
                    return (
                      <Text key={`${n}-${i}`} style={{ fontSize: 12, color: isCurrent ? accentColor : textColor, fontWeight: isCurrent ? '700' : '400' }}>
                        {n}{i < names.length - 1 ? ', ' : ''}
                      </Text>
                    );
                  });
                  return (
                    <View key={`trade-${idx}`} style={{
                      paddingVertical: 8,
                      borderTopWidth: idx === 0 ? 0 : 1,
                      borderTopColor: borderColor,
                    }}>
                      <Text style={{ fontSize: 10, color: textSecondary, marginBottom: 4 }}>
                        {t.season || ''}
                      </Text>
                      <View style={{ marginBottom: 4 }}>
                        <Text style={{ fontSize: 11, color: textSecondary, fontWeight: '600' }}>
                          {team1} → {team2}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
                          {renderPlayerList(players1)}
                        </View>
                      </View>
                      <View>
                        <Text style={{ fontSize: 11, color: textSecondary, fontWeight: '600' }}>
                          {team2} → {team1}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 }}>
                          {renderPlayerList(players2)}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            {/* Current season stats */}
            {/* Stats mode selector — applies to both regular + playoff sections below */}
            {(careerTruei.length > 0 || careerPlayoffTruei.length > 0) ? (
              <View style={{ flexDirection: 'row', backgroundColor: bgCard, borderRadius: 8, padding: 3, marginBottom: 10, borderWidth: 1, borderColor, alignSelf: 'stretch' }}>
                {[
                  { key: 'single', label: 'Latest' },
                  { key: 'last3', label: 'Last 3' },
                  { key: 'all', label: 'All Seasons' },
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.key}
                    style={{ flex: 1, paddingVertical: 6, borderRadius: 6, alignItems: 'center', backgroundColor: careerMode === opt.key ? accentColor : 'transparent' }}
                    onPress={() => { setCareerMode(opt.key); setSelectedSeason(null); }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: careerMode === opt.key ? '#fff' : textSecondary }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Regular season stats (mode-driven) */}
            {careerTruei.length > 0 ? (() => {
              const specificRow = careerMode === 'specific' && selectedSeason
                ? careerTruei.find(s => s.season === selectedSeason)
                : null;
              const subset = careerMode === 'single' ? careerTruei.slice(0, 1)
                : careerMode === 'last3' ? careerTruei.slice(0, 3)
                : careerMode === 'specific' ? (specificRow ? [specificRow] : careerTruei.slice(0, 1))
                : careerTruei;
              const isGoalie = playerData?.isGoalie || subset[0]?.sha != null;
              const summary = isGoalie
                ? aggregateGoalieSeasons(subset, calculateGSAA, leagueAvgSvPct)
                : aggregateSeasons(subset, calculateTRUEi, false);
              const label = careerMode === 'single' ? `${formatSeasonLabel(subset[0]?.season)} Regular Season`
                : careerMode === 'last3' ? `Last ${subset.length} Seasons · Regular`
                : careerMode === 'specific' ? `${formatSeasonLabel(subset[0]?.season)} Regular Season`
                : `All Seasons · Regular (${subset.length})`;
              return (
                <Section title={label} bg={bgCard} text={textColor} sub={textSecondary} border={borderColor}>
                  {isGoalie
                    ? <GoalieStatsGrid stats={summary} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                    : <StatsGrid stats={summary} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                  }
                </Section>
              );
            })() : null}

            {/* TRUEi breakdown — only for skaters with a breakdown fn + at least
                one regular-season row. Shows what drove the score. */}
            {calculateTRUEiBreakdown && careerTruei.length > 0 && !(playerData?.isGoalie || careerTruei[0]?.sha != null) ? (
              <TrueiBreakdownPanel
                seasonRow={careerMode === 'specific' && selectedSeason
                    ? (careerTruei.find(s => s.season === selectedSeason) || careerTruei[0])
                  : careerMode === 'single' ? careerTruei[0]
                  : careerMode === 'last3' ? (careerTruei[0])
                  : careerTruei[0]}
                calculateTRUEiBreakdown={calculateTRUEiBreakdown}
                bg={bgCard}
                text={textColor}
                sub={textSecondary}
                border={borderColor}
              />
            ) : null}

            {/* Playoff stats (mode-driven) */}
            {careerPlayoffTruei.length > 0 ? (() => {
              const subset = careerMode === 'single' ? careerPlayoffTruei.slice(0, 1)
                : careerMode === 'last3' ? careerPlayoffTruei.slice(0, 3)
                : careerPlayoffTruei;
              const isGoalie = playerData?.isGoalie || subset[0]?.sha != null;
              const summary = isGoalie
                ? aggregateGoalieSeasons(subset, calculateGSAA, leagueAvgSvPct)
                : aggregateSeasons(subset, calculateTRUEi, true);
              const label = careerMode === 'single' ? `${formatSeasonLabel(subset[0]?.season)} Playoffs`
                : careerMode === 'last3' ? `Last ${subset.length} Playoff Runs`
                : `All Playoffs (${subset.length})`;
              return (
                <Section title={label} bg={bgCard} text={textColor} sub={textSecondary} border={borderColor}>
                  {isGoalie
                    ? <GoalieStatsGrid stats={summary} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                    : <StatsGrid stats={summary} text={textColor} sub={textSecondary} mapTeam={mapTeam} />
                  }
                </Section>
              );
            })() : null}

            {/* Regen lineage — clickable. Only shown for true regens (player
                name didn't resolve to own Wikipedia page). Real players with
                just a style "comparable" in draft data won't show this. */}
            {showLineage ? (
              <View style={{ marginTop: 8, padding: 12, backgroundColor: bgCard, borderRadius: 8, borderWidth: 1, borderColor }}>
                <Text style={{ fontSize: 11, color: textSecondary, fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Regen Lineage
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                  {lineage.map((linkName, idx) => (
                    <React.Fragment key={linkName}>
                      {linkName === currentName ? (
                        <Text style={{ fontSize: 13, fontWeight: '700', color: textColor }}>{linkName}</Text>
                      ) : (
                        <TouchableOpacity onPress={() => navigateTo(linkName)}>
                          <Text style={{ fontSize: 13, color: accentColor, textDecorationLine: 'underline' }}>
                            {linkName}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {idx < lineage.length - 1 ? (
                        <Text style={{ fontSize: 13, color: textSecondary, marginHorizontal: 6 }}>→</Text>
                      ) : null}
                    </React.Fragment>
                  ))}
                </View>
                {lineage.length > 1 ? (
                  <Text style={{ fontSize: 10, color: textSecondary, marginTop: 6, fontStyle: 'italic' }}>
                    Root: {lineage[lineage.length - 1]} (photo source)
                  </Text>
                ) : null}
              </View>
            ) : null}

            {!playerData ? null : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// Small presentational helpers
// ============================================================================

function InfoPill({ label, value, bg, text, sub }) {
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 70 }}>
      <Text style={{ fontSize: 10, color: sub, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</Text>
      <Text style={{ fontSize: 13, color: text, fontWeight: '600', marginTop: 1 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Section({ title, children, bg, text, sub, border }) {
  return (
    <View style={{ marginBottom: 12, backgroundColor: bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: border }}>
      <Text style={{ fontSize: 11, color: sub, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/**
 * Goalie aggregator — different fields than skater.
 * Counting stats summed: gp, w, l, t, sha, ga, so, g, a, p, pim, toi
 * Derived: svPct = (SHA - GA) / SHA; gaa = (GA * 60) / TOI; gsaa via calculateGSAA
 */
function aggregateGoalieSeasons(rows, calculateGSAA, leagueAvgSvPct) {
  if (!rows || rows.length === 0) return null;
  const totals = { gp: 0, w: 0, l: 0, t: 0, sha: 0, ga: 0, so: 0, g: 0, a: 0, p: 0, pim: 0, toi: 0 };
  const teamSet = new Set();

  rows.forEach(s => {
    totals.gp += s.gp || 0;
    totals.w += s.w || 0;
    totals.l += s.l || 0;
    totals.t += s.t || 0;
    totals.sha += s.sha || 0;
    totals.ga += s.ga || 0;
    totals.so += s.so || 0;
    totals.g += s.g || 0;
    totals.a += s.a || 0;
    totals.p += s.p || 0;
    totals.pim += s.pim || 0;
    totals.toi += s.toi || 0;
    if (s.team) teamSet.add(s.team);
  });

  const svPct = totals.sha > 0 ? (totals.sha - totals.ga) / totals.sha : 0;
  const gaa = totals.toi > 0 ? (totals.ga * 60) / totals.toi : 0;
  const gsaa = (calculateGSAA && leagueAvgSvPct)
    ? calculateGSAA({ sha: totals.sha, ga: totals.ga }, leagueAvgSvPct)
    : 0;

  return {
    ...totals,
    svPct,
    gaa,
    gsaa,
    teams: [...teamSet],
  };
}

/**
 * Goalie stats grid — shows W/L/GAA/SV%/GSAA/etc. in same mini-card layout.
 */
function GoalieStatsGrid({ stats, text, sub, mapTeam = (t) => t }) {
  if (!stats) return null;
  const cells = [
    { label: 'GP', value: String(stats.gp || 0), show: true },
    { label: 'W', value: String(stats.w || 0), show: true, highlight: true },
    { label: 'L', value: String(stats.l || 0), show: true },
    { label: 'T', value: String(stats.t || 0), show: (stats.t || 0) > 0 },
    { label: 'SO', value: String(stats.so || 0), show: true },
    { label: 'SV%', value: `${(stats.svPct * 100).toFixed(1)}%`, show: stats.sha > 0, highlight: true },
    { label: 'GAA', value: stats.gaa.toFixed(2), show: stats.toi > 0 },
    { label: 'GSAA', value: (stats.gsaa >= 0 ? '+' : '') + stats.gsaa.toFixed(1),
      show: stats.sha > 0, highlight: true, color: stats.gsaa >= 0 ? '#2e7d32' : '#c62828' },
    { label: 'Saves', value: String((stats.sha || 0) - (stats.ga || 0)), show: stats.sha > 0 },
    { label: 'SA', value: String(stats.sha || 0), show: stats.sha > 0 },
    { label: 'GA', value: String(stats.ga || 0), show: stats.ga > 0 },
    { label: 'TOI', value: String(stats.toi || 0), show: (stats.toi || 0) > 0 },
    { label: 'PIM', value: String(stats.pim || 0), show: (stats.pim || 0) > 0 },
  ].filter(c => c.show);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {cells.map((cell, idx) => (
        <View key={idx} style={{
          minWidth: 60,
          paddingVertical: 4,
          paddingHorizontal: 8,
          backgroundColor: cell.highlight ? 'rgba(21, 101, 192, 0.08)' : 'rgba(0,0,0,0.03)',
          borderRadius: 5,
          borderWidth: cell.highlight ? 1 : 0,
          borderColor: 'rgba(21, 101, 192, 0.25)',
        }}>
          <Text style={{ fontSize: 9, color: sub, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: '600' }}>{cell.label}</Text>
          <Text style={{ fontSize: 13, color: cell.color || text, fontWeight: '700', marginTop: 1 }}>{cell.value}</Text>
        </View>
      ))}
      {stats.teams && stats.teams.length > 0 ? (() => {
        const mappedTeams = [...new Set(stats.teams.map(t => mapTeam(t)).filter(Boolean))];
        return (
          <View style={{ width: '100%', marginTop: 4 }}>
            <Text style={{ fontSize: 10, color: sub, fontStyle: 'italic' }}>
              {mappedTeams.length === 1 ? `Team: ${mappedTeams[0]}` : `Teams: ${mappedTeams.join(', ')}`}
            </Text>
          </View>
        );
      })() : null}
    </View>
  );
}

function Row({ label, value, text, sub, bold }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}>
      <Text style={{ flex: 1, fontSize: 12, color: sub }}>{label}</Text>
      <Text style={{ fontSize: 12, color: text, fontWeight: bold ? '700' : '500' }}>{value}</Text>
    </View>
  );
}

/**
 * Aggregate an array of season rows into a summary object.
 *   - Counting stats (G, A, P, GP, PIM, SOG, etc.) are SUMMED.
 *   - Rate stats (ATOI, FO%, S%, PP TOI, PK TOI) are GP-weighted averages.
 *   - TRUEi is GP-weighted average across seasons (not sum).
 *   - isPlayoffs=true: skips per-60 stuff that's not tracked in playoffs.
 */
function aggregateSeasons(rows, calculateTRUEi, isPlayoffs = false) {
  if (!rows || rows.length === 0) return null;
  if (rows.length === 1) {
    const s = rows[0];
    return {
      gp: s.gp || 0, g: s.g || 0, a: s.a || 0, p: s.p || 0,
      plusMinus: s.plusMinus ?? null, pim: s.pim || 0,
      ppp: s.ppp || 0, shp: s.shp || 0,
      sog: s.sog || 0, sPct: s.sPct || 0,
      ht: s.ht || 0, sb: s.sb || 0, ta: s.ta || 0, ga: s.ga || 0,
      atoi: s.atoi || 0, appt: s.appt || 0, apkt: s.apkt || 0,
      foPct: s.foPct || 0,
      truei: calculateTRUEi ? parseFloat(calculateTRUEi(s)) || 0 : 0,
      teams: s.team ? [s.team] : [],
    };
  }

  const sum = { gp: 0, g: 0, a: 0, p: 0, pim: 0, ppp: 0, shp: 0, sog: 0, ht: 0, sb: 0, ta: 0, ga: 0 };
  let plusMinusSum = 0, plusMinusCount = 0;
  let atoiWeighted = 0, apptWeighted = 0, apktWeighted = 0;
  let sPctWeighted = 0, sPctGames = 0;
  let foPctWeighted = 0, foPctGames = 0;
  let trueiWeighted = 0, trueiGames = 0;
  const teamSet = new Set();

  rows.forEach(s => {
    const gp = s.gp || 0;
    sum.gp += gp;
    sum.g += s.g || 0;
    sum.a += s.a || 0;
    sum.p += s.p || 0;
    sum.pim += s.pim || 0;
    sum.ppp += s.ppp || 0;
    sum.shp += s.shp || 0;
    sum.sog += s.sog || 0;
    sum.ht += s.ht || 0;
    sum.sb += s.sb || 0;
    sum.ta += s.ta || 0;
    sum.ga += s.ga || 0;
    if (s.plusMinus != null) { plusMinusSum += s.plusMinus; plusMinusCount++; }
    atoiWeighted += (s.atoi || 0) * gp;
    apptWeighted += (s.appt || 0) * gp;
    apktWeighted += (s.apkt || 0) * gp;
    if (s.sPct > 0) { sPctWeighted += s.sPct * gp; sPctGames += gp; }
    if (s.foPct > 0) { foPctWeighted += s.foPct * gp; foPctGames += gp; }
    if (calculateTRUEi) {
      const t = parseFloat(calculateTRUEi(s)) || 0;
      trueiWeighted += t * gp;
      trueiGames += gp;
    }
    if (s.team) teamSet.add(s.team);
  });

  return {
    gp: sum.gp, g: sum.g, a: sum.a, p: sum.p,
    plusMinus: plusMinusCount > 0 ? plusMinusSum : null,
    pim: sum.pim, ppp: sum.ppp, shp: sum.shp,
    sog: sum.sog, sPct: sPctGames > 0 ? sPctWeighted / sPctGames : 0,
    ht: sum.ht, sb: sum.sb, ta: sum.ta, ga: sum.ga,
    atoi: sum.gp > 0 ? atoiWeighted / sum.gp : 0,
    appt: sum.gp > 0 ? apptWeighted / sum.gp : 0,
    apkt: sum.gp > 0 ? apktWeighted / sum.gp : 0,
    foPct: foPctGames > 0 ? foPctWeighted / foPctGames : 0,
    truei: trueiGames > 0 ? trueiWeighted / trueiGames : 0,
    teams: [...teamSet],
  };
}

/**
 * Compact stats grid — shows stats as mini-cards in a flexwrap row.
 * Each cell: small label on top, large value on bottom.
 */
function StatsGrid({ stats, text, sub, mapTeam = (t) => t }) {
  if (!stats) return null;
  const cells = [
    { label: 'GP', value: String(stats.gp || 0), show: true },
    { label: 'G', value: String(stats.g || 0), show: true },
    { label: 'A', value: String(stats.a || 0), show: true },
    { label: 'P', value: String(stats.p || 0), show: true, highlight: true },
    { label: '+/−', value: stats.plusMinus != null ? (stats.plusMinus > 0 ? `+${stats.plusMinus}` : String(stats.plusMinus)) : '—',
      show: stats.plusMinus != null, color: stats.plusMinus > 0 ? '#2e7d32' : stats.plusMinus < 0 ? '#c62828' : null },
    { label: 'PIM', value: String(stats.pim || 0), show: (stats.pim || 0) > 0 },
    { label: 'SOG', value: String(stats.sog || 0), show: (stats.sog || 0) > 0 },
    { label: 'S%', value: `${stats.sPct.toFixed(1)}%`, show: stats.sPct > 0 },
    { label: 'PP Pts', value: String(stats.ppp || 0), show: (stats.ppp || 0) > 0 },
    { label: 'SH Pts', value: String(stats.shp || 0), show: (stats.shp || 0) > 0 },
    { label: 'Hits', value: String(stats.ht || 0), show: (stats.ht || 0) > 0 },
    { label: 'Blocks', value: String(stats.sb || 0), show: (stats.sb || 0) > 0 },
    { label: 'TA', value: String(stats.ta || 0), show: (stats.ta || 0) > 0 },
    { label: 'GA', value: String(stats.ga || 0), show: (stats.ga || 0) > 0 },
    { label: 'ATOI', value: stats.atoi > 0 ? `${stats.atoi.toFixed(1)}` : '—', show: stats.atoi > 0 },
    { label: 'PP TOI', value: `${stats.appt.toFixed(1)}`, show: stats.appt > 0 },
    { label: 'PK TOI', value: `${stats.apkt.toFixed(1)}`, show: stats.apkt > 0 },
    { label: 'FO%', value: `${stats.foPct.toFixed(1)}`, show: stats.foPct > 0 },
    { label: 'TRUEi', value: stats.truei.toFixed(1), show: true, highlight: true, color: '#1565c0' },
  ].filter(c => c.show);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {cells.map((cell, idx) => (
        <View key={idx} style={{
          minWidth: 54,
          paddingVertical: 4,
          paddingHorizontal: 8,
          backgroundColor: cell.highlight ? 'rgba(21, 101, 192, 0.08)' : 'rgba(0,0,0,0.03)',
          borderRadius: 5,
          borderWidth: cell.highlight ? 1 : 0,
          borderColor: 'rgba(21, 101, 192, 0.25)',
        }}>
          <Text style={{ fontSize: 9, color: sub, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: '600' }}>{cell.label}</Text>
          <Text style={{ fontSize: 13, color: cell.color || text, fontWeight: '700', marginTop: 1 }}>{cell.value}</Text>
        </View>
      ))}
      {stats.teams && stats.teams.length > 0 ? (() => {
        const mappedTeams = [...new Set(stats.teams.map(t => mapTeam(t)).filter(Boolean))];
        return (
          <View style={{ width: '100%', marginTop: 4 }}>
            <Text style={{ fontSize: 10, color: sub, fontStyle: 'italic' }}>
              {mappedTeams.length === 1 ? `Team: ${mappedTeams[0]}` : `Teams: ${mappedTeams.join(', ')}`}
            </Text>
          </View>
        );
      })() : null}
    </View>
  );
}

// Collapsible "Why is TRUEi this number?" panel. Shows per-82 contributions
// for each stat, then the position/role multiplier, then team-context adjustments,
// summing to the final score. No recommendations, no predictions — just the math.
function TrueiBreakdownPanel({ seasonRow, calculateTRUEiBreakdown, bg, text, sub, border }) {
  const [open, setOpen] = useState(false);
  if (!seasonRow) return null;
  const bd = calculateTRUEiBreakdown(seasonRow);
  if (!bd) return null;

  const sign = (v) => (v >= 0 ? '+' : '−');
  const mag = (v) => Math.abs(v).toFixed(2);
  const colorFor = (v) => (v > 0 ? '#2e7d32' : v < 0 ? '#c62828' : text);

  const BreakdownRow = ({ label, sub: subText, value, bold, muted }) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 4, borderBottomWidth: muted ? 0 : 1, borderBottomColor: 'rgba(128,128,128,0.12)' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, color: muted ? sub : text, fontWeight: bold ? '700' : '500' }}>{label}</Text>
        {subText ? <Text style={{ fontSize: 10, color: sub }}>{subText}</Text> : null}
      </View>
      <Text style={{ fontSize: 13, color: muted ? sub : colorFor(value), fontWeight: bold ? '700' : '500', fontVariant: ['tabular-nums'] }}>
        {value == null ? '' : `${sign(value)}${mag(value)}`}
      </Text>
    </View>
  );

  return (
    <View style={{ marginTop: 8, padding: 12, backgroundColor: bg, borderRadius: 8, borderWidth: 1, borderColor: border }}>
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text style={{ fontSize: 11, color: sub, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {open ? '▼' : '▶'} Why {bd.total.toFixed(1)}?
        </Text>
        <Text style={{ fontSize: 10, color: sub, fontStyle: 'italic' }}>
          {open ? 'Hide breakdown' : 'Show breakdown'}
        </Text>
      </TouchableOpacity>

      {open ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 10, color: sub, marginBottom: 6 }}>
            All values are per-82 contributions to the raw score, before multipliers.
          </Text>
          {bd.base.map((p, i) => (
            <BreakdownRow
              key={i}
              label={p.label}
              subText={p.raw != null ? `raw: ${p.raw}` : null}
              value={p.value}
            />
          ))}

          <BreakdownRow label="Base per 82" value={bd.rawPer82} bold />

          {bd.isDefenseman ? (
            <>
              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.2)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 4 }}>
                  <Text style={{ flex: 1, fontSize: 12, color: text, fontWeight: '500' }}>{bd.multLabel}</Text>
                  <Text style={{ fontSize: 13, color: text, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
                    ×{bd.multiplier.toFixed(3)}
                  </Text>
                </View>
                <BreakdownRow label="After multiplier" value={bd.afterMultiplier} bold />
              </View>
              {bd.hasTeamContext ? (
                <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.2)' }}>
                  <Text style={{ fontSize: 10, color: sub, marginBottom: 4, fontStyle: 'italic' }}>Team context</Text>
                  <BreakdownRow label="Plus/minus adj" subText="vs team avg, TOI-weighted" value={bd.plusMinusAdj} />
                  <BreakdownRow label="Shot-rate adj" subText="tanh Z-score vs team pos avg" value={bd.shotRateAdj} />
                </View>
              ) : null}
            </>
          ) : (
            <>
              {bd.hasTeamContext ? (
                <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.2)' }}>
                  <Text style={{ fontSize: 10, color: sub, marginBottom: 4, fontStyle: 'italic' }}>Team context</Text>
                  <BreakdownRow label="Plus/minus adj" subText="vs team avg, TOI-weighted" value={bd.plusMinusAdj} />
                  <BreakdownRow label="Shot-rate adj" subText="tanh Z-score vs team pos avg" value={bd.shotRateAdj} />
                  <BreakdownRow label="Subtotal" value={bd.rawPer82 + bd.plusMinusAdj + bd.shotRateAdj} bold />
                </View>
              ) : null}
              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(128,128,128,0.2)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 4 }}>
                  <Text style={{ flex: 1, fontSize: 12, color: text, fontWeight: '500' }}>{bd.multLabel}</Text>
                  <Text style={{ fontSize: 13, color: text, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
                    ×{bd.multiplier.toFixed(3)}
                  </Text>
                </View>
              </View>
            </>
          )}

          <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 2, borderTopColor: 'rgba(21, 101, 192, 0.35)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingVertical: 4 }}>
              <Text style={{ flex: 1, fontSize: 13, color: text, fontWeight: '700' }}>TRUEi</Text>
              <Text style={{ fontSize: 15, color: '#1565c0', fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {bd.total.toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
