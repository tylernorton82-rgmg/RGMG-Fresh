// LinesBuilder.js — drop-in replacement for the inline Lines Builder in App.js
// Desktop: drag-and-drop OR dropdowns. Mobile: native dropdowns.
// Auto-optimize lines, PP, and PK separately with smart position + TOI weighting.

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
} from 'react-native';

const MOBILE_BREAKPOINT = 768;

// ============================================================================
// POSITION HELPERS
// ============================================================================

const isDmanPos = (pos) => {
  const p = String(pos || '').toUpperCase();
  return p.includes('LD') || p.includes('RD');
};

// Does a player's position string qualify them for a given slot?
// Forwards and defensemen are each fully interchangeable within their group.
// Any F can play any F slot (LW, C, RW, LF, RF).
// Any D can play any D slot (LD, RD).
const matchesPos = (player, slot) => {
  const p = String(player?.pos || '').toUpperCase();
  const s = slot.toUpperCase();
  const isD = p.includes('LD') || p.includes('RD');
  const isF = p.includes('LW') || p.includes('C') || p.includes('RW');
  if (s === 'LD' || s === 'RD') return isD;
  if (s === 'LW' || s === 'C' || s === 'RW' || s === 'LF' || s === 'RF') return isF;
  return true;
};

// Parse position string as ordered list — FIRST position is primary, rest are secondary.
// "C/LW/RW" → primary C, secondaries [LW, RW]  (natural C who can play wing)
// "LW/C"    → primary LW, secondary [C]         (winger who can drop to C)
// "LW/RW"   → primary LW, secondary [RW]        (winger only, can't play C)
const parsePositions = (player) => {
  const raw = String(player?.pos || '').toUpperCase().trim();
  if (!raw) return { primary: null, all: [] };
  const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
  return { primary: parts[0] || null, all: parts };
};

// Position fit score for a specific slot — strict primary-position ranking.
// Returns a multiplier applied on top of effectiveValue.
// Primary match = full 1.0, secondary match = 0.70, eligible but off-position = 0.40
const positionFitScore = (player, slot) => {
  const { primary, all } = parsePositions(player);
  const s = slot.toUpperCase();

  if (primary === s) return 1.00;       // natural at this position
  if (all.includes(s)) return 0.70;     // can play here as secondary
  return 0.40;                          // eligible by F/D group but not listed
};

// Faceoff bonus for C slots — scales by the player's TRUEi level.
// At 4th-line level (TRUEi ~22), FO% is heavily weighted — depth Cs are judged by dots.
// At 1st-line level (TRUEi ~67), raw TRUEi dominates — top scorers carry regardless.
// Linear interpolation between, clamped 0.4 to 1.6.
//
// At 4th-line level, weight = 1.6 means each FO% point = 1.6% score swing.
//   → 56% FO gives +9.6% bonus
//   → 35% FO gives -24% penalty
// At 1st-line level, weight = 0.4 means dots barely matter in the ranking.
const REPLACEMENT_LOW = 22;   // ~4th line TRUEi
const REPLACEMENT_HIGH = 67;  // ~1st line TRUEi
const FO_WEIGHT_MIN = 0.4;    // at 1st-line level
const FO_WEIGHT_MAX = 2.0;    // at 4th-line level

const faceoffBonus = (player) => {
  const fo = parseFloat(player?.faceoff_percent ?? player?.foPct ?? 0);
  if (!fo || isNaN(fo)) return 1.0;

  const truei = (player?.truei3yr != null) ? player.truei3yr : (player?.truei || 0);
  const t = Math.max(0, Math.min(1, (truei - REPLACEMENT_LOW) / (REPLACEMENT_HIGH - REPLACEMENT_LOW)));
  const foWeight = FO_WEIGHT_MAX - (t * (FO_WEIGHT_MAX - FO_WEIGHT_MIN));

  // Base: each percentage point away from 50 shifts by foWeight/100
  let bonus = 1.0 + foWeight * (fo - 50) / 100;

  // HARD PENALTY: sub-39% FO is flat-out bad dots. Extra 35% penalty on top of base.
  // Coaches bench these guys from C slots when better options exist — this algorithm mimics that.
  if (fo < 39) bonus *= 0.65;

  return bonus;
};

// Effective value: TRUEi adjusted by TOI (reward players who were trusted with minutes)
// TOI in minutes (e.g. "18:34" → 18.57)
const parseToi = (toi) => {
  if (!toi) return 0;
  if (typeof toi === 'number') return toi;
  const parts = String(toi).split(':');
  if (parts.length !== 2) return parseFloat(toi) || 0;
  return parseInt(parts[0]) + parseInt(parts[1]) / 60;
};

const effectiveValue = (player) => {
  // Prefer 3-year weighted TRUEi when available (smooths fluke seasons)
  // Falls back to single-season truei if that's all we have
  const truei = (player?.truei3yr != null) ? player.truei3yr : (player?.truei || 0);
  const toi = parseToi(player?.atoi || player?.toi || 18);
  const toiFactor = Math.min(1.0, toi / 18);
  return truei * (0.6 + 0.4 * toiFactor); // 60% pure talent, 40% opportunity-adjusted
};

// ============================================================================
// AUTO-OPTIMIZERS
// ============================================================================

// Handedness bonus — strong-side preference within position eligibility.
// Left-shot at LW slot: natural side, +5%. Left-shot at RW: weak side, -5%.
// Applies to wings and D only; C doesn't care (centers take both sides of faceoffs).
const handednessBonus = (player, slot) => {
  const h = String(player?.handedness || '').toUpperCase().charAt(0); // 'L' or 'R'
  if (!h) return 1.0;
  if (slot === 'lw' || slot === 'ld') return h === 'L' ? 1.05 : 0.95;
  if (slot === 'rw' || slot === 'rd') return h === 'R' ? 1.05 : 0.95;
  return 1.0; // C slot / PK LF/RF / etc — no handedness preference
};

// ============================================================================
// LINE BALANCE — role bucketing based on player.type from EHM API
// ============================================================================
// Forward line balance is about complementary roles: shooters, setup men, and
// two-way/grit players. A line with 3 of the same type lacks complement.

// Forward buckets: FINISH (scoring), SETUP (creator), WORK (two-way/grit)
const forwardBucket = (player) => {
  const t = String(player?.playerType || player?.type || '').toLowerCase();
  if (!t) return 'unknown';
  if (t.includes('sniper') || t.includes('finesse') && !t.includes('playmaker') && !t.includes('defensive') || t.includes('power forward')) return 'FINISH';
  if (t.includes('playmaker')) return 'SETUP';
  // All else for forwards = WORK (All Around, Standard, Grinder, Defensive*, Enforcer)
  return 'WORK';
};

// Defense buckets: O-D (offensive) vs D-D (defensive)
const defenseBucket = (player) => {
  const t = String(player?.playerType || player?.type || '').toLowerCase();
  if (!t) return 'unknown';
  if (t.includes('offensive') || t.includes('pointman')) return 'OD';
  // All else = DD (Defensive*, Enforcer, Rugged)
  return 'DD';
};

// Is this player an Enforcer/Rugged fighter type? (Forwards: Enforcer only. D: Enforcer or Rugged)
const isFighterType = (player) => {
  const t = String(player?.playerType || player?.type || '').toLowerCase();
  return t.includes('enforcer') || t.includes('rugged');
};

// Forward line balance multiplier — applied to individual wing scores during Pass 2.
// Computes balance of the line so far (C + already-placed wings) including this candidate.
// Returns multiplier to apply to the candidate's score.
const forwardLineBalanceMultiplier = (candidate, alreadyOnLine) => {
  const players = [...alreadyOnLine, candidate].filter(Boolean);
  if (players.length < 2) return 1.0; // Not enough context yet

  const buckets = players.map(p => forwardBucket(p)).filter(b => b !== 'unknown');
  if (buckets.length === 0) return 1.0;

  const unique = new Set(buckets);
  const fighterCount = players.filter(isFighterType).length;

  // Enforcer penalty stacks on top of balance penalty
  let fighterPenalty = 1.0;
  if (fighterCount === 1) fighterPenalty = 0.85;
  else if (fighterCount >= 2) fighterPenalty = 0.70;

  // When the line is complete (3 forwards), apply balance rules
  if (players.length === 3) {
    if (unique.size === 3) return 1.00 * fighterPenalty;           // perfect
    if (unique.size === 1) {
      if (buckets[0] === 'WORK') return 0.92 * fighterPenalty;     // 3 work guys = 4th line feel
      return 0.88 * fighterPenalty;                                 // 3 finishers or 3 setups = bad
    }
    // 2+1 split — finer gradation: finish+work+work or setup+work+work = slightly worse
    const counts = {};
    buckets.forEach(b => counts[b] = (counts[b] || 0) + 1);
    if (counts.WORK === 2) return 0.95 * fighterPenalty;           // 1 skill + 2 work
    return 0.97 * fighterPenalty;                                  // other 2+1 splits
  }

  // For partial lines (2 players), apply a softer early-warning penalty only for same-bucket
  if (players.length === 2 && unique.size === 1) {
    if (buckets[0] === 'FINISH') return 0.95 * fighterPenalty;     // 2 shooters, needs variety
    if (buckets[0] === 'SETUP') return 0.95 * fighterPenalty;      // 2 passers, needs variety
  }
  return 1.00 * fighterPenalty;
};

// Defense pair balance multiplier — applied to D partner scores during pair building.
const defensePairBalanceMultiplier = (candidate, partner) => {
  if (!partner) return 1.0;
  const b1 = defenseBucket(candidate);
  const b2 = defenseBucket(partner);
  const fighterCount = [candidate, partner].filter(isFighterType).length;

  let fighterPenalty = 1.0;
  if (fighterCount === 1) fighterPenalty = 0.90;
  else if (fighterCount >= 2) fighterPenalty = 0.80;

  if (b1 === 'unknown' || b2 === 'unknown') return 1.0 * fighterPenalty;
  if (b1 !== b2) return 1.00 * fighterPenalty;                      // perfect O+D or D+O
  if (b1 === 'OD') return 0.92 * fighterPenalty;                    // double offensive
  if (b1 === 'DD') return 0.90 * fighterPenalty;                    // double defensive
  return 1.0 * fighterPenalty;
};

// --- Forward Lines ---
// Two-pass algorithm:
//   Pass 1 — Assign up to 4 natural Cs to C slots in TRUEi × faceoff order.
//            If fewer than 4 natural Cs exist, fall through to secondaries (LW/C etc) for unfilled C slots.
//   Pass 2 — All remaining forwards compete for each wing slot, scored by
//            (effectiveValue × positionFit × handednessBonus × faceoffBonusIfC).
//            Surplus Cs can play wing if they still beat natural wingers (off-position ×0.4 penalty applies).
//            Handedness nudges dual-position wingers to their strong side.
function optimizeLines(forwards) {
  if (!forwards || forwards.length === 0) return {};

  // ---- Pass 1: Natural Cs → C slots, line-by-line ----
  // Line 1: pure TRUEi × TOI (skill dominates, FO doesn't influence)
  // Line 2+: TRUEi × faceoffBonus (FO weight scales by TRUEi tier — see faceoffBonus)
  // This means your elite scoring C goes to 1C even if he's a mediocre dot-man,
  // while your 4th-line C slot favors the grinder with good dots.
  const cSlotKeys = ['line1', 'line2', 'line3', 'line4'];
  const cSlotAssignments = {};
  const used = new Set();

  for (const lineKey of cSlotKeys) {
    const isTopLine = lineKey === 'line1';
    const primaryPool = forwards
      .filter(p => !used.has(p.name) && positionFitScore(p, 'c') === 1.00)
      .map(p => ({
        player: p,
        score: effectiveValue(p) * (isTopLine ? 1.0 : faceoffBonus(p)),
      }))
      .sort((a, b) => b.score - a.score);

    if (primaryPool.length > 0) {
      cSlotAssignments[lineKey] = primaryPool[0].player.name;
      used.add(primaryPool[0].player.name);
      continue;
    }

    // No primary C left — fall to secondaries (LW/C etc.)
    const secondary = forwards
      .filter(p => !used.has(p.name) && positionFitScore(p, 'c') === 0.70)
      .map(p => ({
        player: p,
        score: effectiveValue(p) * (isTopLine ? 1.0 : faceoffBonus(p)),
      }))
      .sort((a, b) => b.score - a.score);
    if (secondary.length > 0) {
      cSlotAssignments[lineKey] = secondary[0].player.name;
      used.add(secondary[0].player.name);
      continue;
    }

    // Last resort: any remaining forward WITH C in their position string.
    // We refuse to put a pure winger (LW only, RW only, RW/LW, LW/RW) at C —
    // that's not a center in any meaningful sense. Leave the slot empty instead
    // so the player can be used at their natural position in Pass 2.
    const any = forwards
      .filter(p => !used.has(p.name) && parsePositions(p).all.includes('C'))
      .map(p => ({ player: p, score: effectiveValue(p) }))
      .sort((a, b) => b.score - a.score);
    if (any.length > 0) {
      cSlotAssignments[lineKey] = any[0].player.name;
      used.add(any[0].player.name);
    }
    // If no C-eligible player exists, slot stays empty (rare — only if roster has < 4 C-capable forwards)
  }

  // ---- Pass 2: wing slots — assign BOTH wings per line in one evaluation ----
  // For each line, score every remaining forward for BOTH lw and rw slots,
  // then pick the optimal pair. This prevents a primary-RW player from being
  // locked into LW just because LW was picked first.
  const findByName = (name) => forwards.find(p => p.name === name);

  const scoreFor = (player, slot, alreadyOnLine) => {
    const fit = positionFitScore(player, slot);
    const hand = handednessBonus(player, slot);
    const balance = forwardLineBalanceMultiplier(player, alreadyOnLine);
    return effectiveValue(player) * fit * hand * balance;
  };

  const pickWingPair = (cPlayer) => {
    const candidates = forwards.filter(p => !used.has(p.name));
    if (candidates.length === 0) return { lw: null, rw: null };
    if (candidates.length === 1) {
      // Only one player left — put them at their best slot
      const p = candidates[0];
      const lwScore = scoreFor(p, 'lw', [cPlayer].filter(Boolean));
      const rwScore = scoreFor(p, 'rw', [cPlayer].filter(Boolean));
      if (lwScore >= rwScore) return { lw: p.name, rw: null };
      return { lw: null, rw: p.name };
    }

    // Try all 2-player combinations where A plays LW and B plays RW
    let bestTotal = -Infinity;
    let bestPair = { lw: null, rw: null };
    for (const a of candidates) {
      for (const b of candidates) {
        if (a.name === b.name) continue;
        const lwScore = scoreFor(a, 'lw', [cPlayer].filter(Boolean));
        const rwScore = scoreFor(b, 'rw', [cPlayer, a].filter(Boolean));
        const total = lwScore + rwScore;
        if (total > bestTotal) {
          bestTotal = total;
          bestPair = { lw: a.name, rw: b.name };
        }
      }
    }
    return bestPair;
  };

  const result = {};
  cSlotKeys.forEach(lineKey => {
    const cName = cSlotAssignments[lineKey] || null;
    const cPlayer = cName ? findByName(cName) : null;
    const { lw, rw } = pickWingPair(cPlayer);
    if (lw) used.add(lw);
    if (rw) used.add(rw);
    result[lineKey] = { c: cName, lw, rw };
  });
  return result;
}

// --- Defense Pairings ---
// Similar tiered logic with handedness + pair balance (O-D / D-D complementary).
function optimizePairs(dmen) {
  if (!dmen || dmen.length === 0) return {};

  const used = new Set();
  const findByName = (name) => dmen.find(p => p.name === name);

  const pickFor = (slot, partner = null) => {
    // Tier 1: primary-position D (e.g. LD for LD slot)
    const primary = dmen
      .filter(p => !used.has(p.name) && positionFitScore(p, slot) === 1.00)
      .map(p => ({
        player: p,
        score: effectiveValue(p) * handednessBonus(p, slot) * defensePairBalanceMultiplier(p, partner),
      }))
      .sort((a, b) => b.score - a.score);
    if (primary.length > 0) { used.add(primary[0].player.name); return primary[0].player.name; }

    // Tier 2: secondary-position (LD/RD swing)
    const secondary = dmen
      .filter(p => !used.has(p.name) && positionFitScore(p, slot) === 0.70)
      .map(p => ({
        player: p,
        score: effectiveValue(p) * handednessBonus(p, slot) * defensePairBalanceMultiplier(p, partner),
      }))
      .sort((a, b) => b.score - a.score);
    if (secondary.length > 0) { used.add(secondary[0].player.name); return secondary[0].player.name; }

    // Tier 3: any remaining D (off-position penalty already baked into positionFit)
    const any = dmen
      .filter(p => !used.has(p.name))
      .map(p => ({
        player: p,
        score: effectiveValue(p) * positionFitScore(p, slot) * handednessBonus(p, slot) * defensePairBalanceMultiplier(p, partner),
      }))
      .sort((a, b) => b.score - a.score);
    if (any.length === 0) return null;
    used.add(any[0].player.name);
    return any[0].player.name;
  };

  const result = {};
  ['pair1', 'pair2', 'pair3'].forEach(pairKey => {
    // Pick LD first (no partner context), then RD (considers LD for balance)
    const ldName = pickFor('ld', null);
    const ldPlayer = ldName ? findByName(ldName) : null;
    const rdName = pickFor('rd', ldPlayer);
    result[pairKey] = { ld: ldName, rd: rdName };
  });
  return result;
}

// --- Power Play ---
// Formations: "3f2d" = 3 forwards + 2 dmen, "4f1d" = 4F + 1D, "5f0d" = all forwards
// Only internal de-dupe (PP1 vs PP2) — ES line players ARE eligible.
// Uses primary-position logic: natural Cs go to C, LDs to LD, etc.
function optimizePP(forwards, dmen, formationPP1, formationPP2) {
  const used = new Set(); // scoped to PP only

  // Rank remaining players for a specific slot, with faceoff bonus on C slots
  const pickForSlot = (pool, slot) => {
    const ranked = pool
      .filter(p => !used.has(p.name))
      .map(p => {
        const fit = positionFitScore(p, slot);
        const fo = slot === 'c' ? faceoffBonus(p) : 1.0;
        return { player: p, score: effectiveValue(p) * fit * fo };
      })
      .sort((a, b) => b.score - a.score);
    if (!ranked.length) return null;
    used.add(ranked[0].player.name);
    return ranked[0].player.name;
  };

  const buildUnit = (formation) => {
    const unit = { ld: null, rd: null, lw: null, c: null, rw: null };

    let fNeeded, dNeeded;
    if (formation === '5f0d') { fNeeded = 5; dNeeded = 0; }
    else if (formation === '4f1d') { fNeeded = 4; dNeeded = 1; }
    else { fNeeded = 3; dNeeded = 2; }

    // Step 1: Fill D slots (RD first, then LD — preserves the top-D-to-RD convention)
    if (dNeeded >= 1) unit.rd = pickForSlot(dmen, 'rd');
    if (dNeeded >= 2) unit.ld = pickForSlot(dmen, 'ld');

    // Step 2: Fill forward slots — C first (scarcest), then LW/RW
    if (fNeeded >= 1) unit.c = pickForSlot(forwards, 'c');
    if (fNeeded >= 2) unit.lw = pickForSlot(forwards, 'lw');
    if (fNeeded >= 3) unit.rw = pickForSlot(forwards, 'rw');

    // Step 3: Extras for 4F-1D or 5F-0D — fourth F fills LD spot (bumper/low)
    if (fNeeded >= 4 && !unit.ld) {
      // Prefer another C or LW to play the low/bumper role
      unit.ld = pickForSlot(forwards, 'c') || pickForSlot(forwards, 'lw');
    }
    if (fNeeded >= 5 && !unit.rd) {
      unit.rd = pickForSlot(forwards, 'rw') || pickForSlot(forwards, 'c');
    }

    return unit;
  };

  return {
    pp1: buildUnit(formationPP1),
    pp2: buildUnit(formationPP2),
  };
}

// --- Penalty Kill ---
// Real defensive value comes from TA (takeaways) and SB (shots blocked) per minute of TOI.
// Higher rate = more impactful per shift. Plus/minus and raw TOI also factor in.
function pkScore(player) {
  const gp = player?.gp || player?.GP || 1;
  const toiPerGame = parseToi(player?.atoi || player?.toi || 15);
  const totalToi = Math.max(1, toiPerGame * gp); // total minutes on ice

  const ta = player?.ta || player?.TA || 0;
  const sb = player?.sb || player?.SB || 0;
  const plusMinus = player?.['+/-'] || player?.plusMinus || 0;

  // Per-60 rates
  const taPer60 = (ta / totalToi) * 60;
  const sbPer60 = (sb / totalToi) * 60;

  // Blend: TA and SB are primary PK indicators, +/- is a tiebreaker, TOI means the coach trusts them
  return (sbPer60 * 2.0) + (taPer60 * 1.5) + (plusMinus * 0.3) + (toiPerGame * 0.8);
}

function optimizePK(forwards, dmen) {
  const used = new Set(); // scoped to PK only

  const buildUnit = () => {
    const unit = { ld: null, rd: null, lf: null, rf: null };

    // D slots — use positionFit (1.0 for primary match) plus pkScore for defensive ability
    const pickD = (slot) => {
      const ranked = dmen
        .filter(p => !used.has(p.name))
        .map(p => ({ player: p, score: pkScore(p) * positionFitScore(p, slot) }))
        .sort((a, b) => b.score - a.score);
      if (!ranked.length) return null;
      used.add(ranked[0].player.name);
      return ranked[0].player.name;
    };

    unit.ld = pickD('ld');
    unit.rd = pickD('rd');

    // LF/RF — any forward, pure PK score (no position penalty)
    const pickF = () => {
      const candidate = forwards
        .filter(p => !used.has(p.name))
        .sort((a, b) => pkScore(b) - pkScore(a))[0];
      if (!candidate) return null;
      used.add(candidate.name);
      return candidate.name;
    };

    unit.lf = pickF();
    unit.rf = pickF();

    return unit;
  };

  return { pk1: buildUnit(), pk2: buildUnit() };
}

// --- Goalies ---
function optimizeGoalies(goalies) {
  if (!goalies || goalies.length === 0) return { goalies: {} };
  // Sort by TRUEi (goalies have their own truei), then gp
  const sorted = [...goalies].sort((a, b) => (b.truei || 0) - (a.truei || 0));
  return {
    goalies: {
      starter: sorted[0]?.name || null,
      backup: sorted[1]?.name || null,
    },
  };
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LinesBuilder({
  theme,
  rosterWithStats = [],
  goaliesWithStats = [],
  lineAssignments = {},
  setLineAssignments,
}) {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const styles = makeStyles(theme, isMobile);

  const [formationPP1, setFormationPP1] = useState('3f2d');
  const [formationPP2, setFormationPP2] = useState('4f1d');

  const forwards = useMemo(() => rosterWithStats.filter(p => !isDmanPos(p.pos)), [rosterWithStats]);
  const dmen = useMemo(() => rosterWithStats.filter(p => isDmanPos(p.pos)), [rosterWithStats]);

  // Dupe detection is scoped by GROUP, not globally.
  // Group 1: even-strength lines + defense pairs (one roster each player can only be in once)
  // Group 2: PP1 + PP2 (a player can be on PP1 OR PP2, not both)
  // Group 3: PK1 + PK2
  // Group 4: Goalies
  // Group 5: Scratches
  // A player CAN appear in multiple groups (your 1st line C can also be your PP1 C)
  const GROUPS = {
    es: new Set(['line1', 'line2', 'line3', 'line4', 'pair1', 'pair2', 'pair3']),
    pp: new Set(['pp1', 'pp2']),
    pk: new Set(['pk1', 'pk2']),
    goalies: new Set(['goalies']),
    scratches: new Set(['scratches']),
  };
  const getGroupOf = (lineKey) => {
    for (const [g, set] of Object.entries(GROUPS)) {
      if (set.has(lineKey)) return g;
    }
    return null;
  };

  // Used names within a specific group (excluding the current slot)
  const getUsedInGroup = (group, excludeLineKey, excludePos) => {
    const set = new Set();
    if (!group || !GROUPS[group]) return set;
    GROUPS[group].forEach(lineKey => {
      const slots = lineAssignments?.[lineKey];
      if (!slots) return;
      Object.entries(slots).forEach(([pos, name]) => {
        if (!name) return;
        if (lineKey === excludeLineKey && pos === excludePos) return;
        set.add(name);
      });
    });
    return set;
  };

  // Legacy global used set (kept for anything that needs it)
  const usedNames = useMemo(() => {
    const set = new Set();
    Object.values(lineAssignments || {}).forEach(slots => {
      if (!slots) return;
      Object.values(slots).forEach(name => { if (name) set.add(name); });
    });
    return set;
  }, [lineAssignments]);

  // Update a single slot
  const setSlot = (lineKey, pos, name) => {
    setLineAssignments(prev => ({
      ...prev,
      [lineKey]: { ...(prev?.[lineKey] || {}), [pos]: name || null },
    }));
  };

  // Assign a player — remove them only from other slots within the SAME group
  const assignPlayer = (lineKey, pos, playerName) => {
    const targetGroup = getGroupOf(lineKey);
    setLineAssignments(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (getGroupOf(k) !== targetGroup) return; // leave other groups alone
        const slots = { ...(next[k] || {}) };
        Object.keys(slots).forEach(p => {
          if (slots[p] === playerName && !(k === lineKey && p === pos)) {
            slots[p] = null;
          }
        });
        next[k] = slots;
      });
      next[lineKey] = { ...(next[lineKey] || {}), [pos]: playerName };
      return next;
    });
  };

  // Clear all
  const clearAll = () => setLineAssignments({});

  // Auto-optimizers
  const runOptimizeLines = () => {
    const lines = optimizeLines(forwards);
    const pairs = optimizePairs(dmen);
    const g = optimizeGoalies(goaliesWithStats);
    setLineAssignments(prev => ({ ...prev, ...lines, ...pairs, ...g }));
  };

  const runOptimizePP = () => {
    const pp = optimizePP(forwards, dmen, formationPP1, formationPP2);
    setLineAssignments(prev => ({ ...prev, ...pp }));
  };

  const runOptimizePK = () => {
    const pk = optimizePK(forwards, dmen);
    setLineAssignments(prev => ({ ...prev, ...pk }));
  };

  // Line combined TRUEi for display (uses 3-year weighted when available)
  const lineTruei = (lineKey, positions) => {
    const slots = lineAssignments?.[lineKey] || {};
    let total = 0;
    positions.forEach(pos => {
      const name = slots[pos];
      if (!name) return;
      const p = rosterWithStats.find(x => x.name === name) || goaliesWithStats.find(x => x.name === name);
      if (p) total += (p.truei3yr != null ? p.truei3yr : (p.truei || 0));
    });
    return total;
  };

  // Copy to clipboard — format matches original league format
  const copyLines = () => {
    const getLastName = (name) => {
      if (!name || name === '???') return '???';
      const parts = name.split(' ');
      return parts[parts.length - 1];
    };
    const formatLine = (lineKey, positions) => {
      const line = lineAssignments?.[lineKey] || {};
      return positions.map(p => getLastName(line[p])).join(' - ');
    };
    const formatScratches = () => {
      const s = lineAssignments?.scratches || {};
      const names = ['s1', 's2', 's3'].map(p => getLastName(s[p])).filter(n => n !== '???');
      return names.length > 0 ? names.join(', ') : 'None';
    };

    const text = `${formatLine('line1', ['lw', 'c', 'rw'])}
${formatLine('line2', ['lw', 'c', 'rw'])}
${formatLine('line3', ['lw', 'c', 'rw'])}
${formatLine('line4', ['lw', 'c', 'rw'])}

${formatLine('pair1', ['ld', 'rd'])}
${formatLine('pair2', ['ld', 'rd'])}
${formatLine('pair3', ['ld', 'rd'])}

${getLastName(lineAssignments?.goalies?.starter)}
${getLastName(lineAssignments?.goalies?.backup)}

PP
${formatLine('pp1', ['ld', 'rd', 'lw', 'c', 'rw'])}
${formatLine('pp2', ['ld', 'rd', 'lw', 'c', 'rw'])}

PK
${formatLine('pk1', ['ld', 'rd', 'lf', 'rf'])}
${formatLine('pk2', ['ld', 'rd', 'lf', 'rf'])}

Scratches
${formatScratches()}`;

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (typeof window !== 'undefined' && window.alert) window.alert('Lines copied to clipboard!');
    }
  };

  // ==========================================================================
  // SLOT RENDERERS
  // ==========================================================================

  // Slot: a clean card with position label + dropdown selector
  const Slot = ({ lineKey, pos, pool, label }) => {
    const currentName = lineAssignments?.[lineKey]?.[pos];
    const currentPlayer = currentName ? pool.find(p => p.name === currentName) : null;

    // Group-scoped de-duping: a player can be on a PP line even if they're on an ES line
    const group = getGroupOf(lineKey);
    const groupUsed = getUsedInGroup(group, lineKey, pos);

    // On PP, anyone can slot anywhere — coaches move players around all the time.
    // On ES/PK, stick with position-based filtering (forwards to F slots, D to D slots).
    const isPP = group === 'pp';

    // Eligible: position matches (unless PP) and not used elsewhere in same group
    const eligible = pool
      .filter(p => (isPP || matchesPos(p, pos)) && (!groupUsed.has(p.name) || p.name === currentName))
      .sort((a, b) => ((b.truei3yr != null ? b.truei3yr : b.truei) || 0) - ((a.truei3yr != null ? a.truei3yr : a.truei) || 0));

    const currentTruei = currentPlayer?.truei3yr != null
      ? currentPlayer.truei3yr
      : (currentPlayer?.truei || null);

    if (Platform.OS === 'web') {
      return (
        <View style={styles.slotCard}>
          <View style={styles.slotHeader}>
            <Text style={styles.slotLabel}>{label || pos.toUpperCase()}</Text>
            {currentTruei != null && (
              <Text style={styles.slotTruei}>{currentTruei.toFixed(0)}</Text>
            )}
          </View>
          <Text style={[styles.slotName, !currentName && styles.slotEmpty]} numberOfLines={1}>
            {currentName || '—'}
          </Text>
          {currentPlayer && (currentPlayer.playerType || currentPlayer.handedness || currentPlayer.pos) ? (
            <Text style={{ fontSize: 10, color: theme.textSecondary, marginTop: 1 }} numberOfLines={1}>
              {[
                currentPlayer.pos || null,
                currentPlayer.handedness ? String(currentPlayer.handedness).charAt(0).toUpperCase() : null,
                currentPlayer.playerType || null,
              ].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <select
            value={currentName || ''}
            onChange={(e) => setSlot(lineKey, pos, e.target.value || null)}
            style={{
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              fontSize: 12,
              backgroundColor: theme.bgInput || '#fff',
              color: theme.textMuted,
              border: `1px solid ${theme.border || '#ddd'}`,
              borderRadius: 4,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <option value="">— empty —</option>
            {eligible.map(p => {
              const t = p.truei3yr != null ? p.truei3yr : (p.truei || 0);
              return <option key={p.name} value={p.name}>{p.name} ({t.toFixed(0)})</option>;
            })}
          </select>
        </View>
      );
    }

    // Native mobile fallback (shouldn't hit this in practice since it's web-only)
    return (
      <View style={styles.slotCard}>
        <Text style={styles.slotLabel}>{label || pos.toUpperCase()}</Text>
        <Text style={styles.slotName}>{currentName || '—'}</Text>
      </View>
    );
  };

  // Line row — groups slots horizontally (desktop) or stacked (mobile)
  const LineRow = ({ label, positions, lineKey, pool, sectionColor }) => (
    <View style={styles.lineRow}>
      <View style={styles.lineHeader}>
        <Text style={[styles.lineLabel, { color: sectionColor || theme.text }]}>{label}</Text>
        <Text style={styles.lineTruei}>Σ {lineTruei(lineKey, positions).toFixed(0)}</Text>
      </View>
      <View style={isMobile ? styles.slotsColumn : styles.slotsRow}>
        {positions.map(pos => {
          const label = pos === 'lf' ? 'LW/C' : pos === 'rf' ? 'RW/C' : pos.toUpperCase();
          return <Slot key={pos} lineKey={lineKey} pos={pos} pool={pool} label={label} />;
        })}
      </View>
    </View>
  );

  // (Available pool removed with drag-drop — dropdowns make it redundant)

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📋 Lines Builder</Text>

      {/* Action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.accent }]} onPress={runOptimizeLines}>
          <Text style={styles.actionBtnText}>🎯 Optimize Lines</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#c62828' }]} onPress={runOptimizePP}>
          <Text style={styles.actionBtnText}>⚡ Optimize PP</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#2e7d32' }]} onPress={runOptimizePK}>
          <Text style={styles.actionBtnText}>🛡️ Optimize PK</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#757575' }]} onPress={clearAll}>
          <Text style={styles.actionBtnText}>🗑️ Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Main layout: single column, full width */}
      <View style={styles.linesColumn}>
          {/* Even Strength */}
          <Text style={[styles.sectionTitle, { color: '#1565c0' }]}>Even Strength</Text>
          <LineRow label="1st Line" positions={['lw', 'c', 'rw']} lineKey="line1" pool={forwards} sectionColor="#1565c0" />
          <LineRow label="2nd Line" positions={['lw', 'c', 'rw']} lineKey="line2" pool={forwards} sectionColor="#1565c0" />
          <LineRow label="3rd Line" positions={['lw', 'c', 'rw']} lineKey="line3" pool={forwards} sectionColor="#1565c0" />
          <LineRow label="4th Line" positions={['lw', 'c', 'rw']} lineKey="line4" pool={forwards} sectionColor="#1565c0" />

          {/* Defense */}
          <Text style={[styles.sectionTitle, { color: '#1565c0', marginTop: 16 }]}>Defense Pairings</Text>
          <LineRow label="1st Pair" positions={['ld', 'rd']} lineKey="pair1" pool={dmen} sectionColor="#1565c0" />
          <LineRow label="2nd Pair" positions={['ld', 'rd']} lineKey="pair2" pool={dmen} sectionColor="#1565c0" />
          <LineRow label="3rd Pair" positions={['ld', 'rd']} lineKey="pair3" pool={dmen} sectionColor="#1565c0" />

          {/* PP */}
          <View style={{ marginTop: 16 }}>
            <Text style={[styles.sectionTitle, { color: '#c62828' }]}>Power Play</Text>
            <View style={styles.formationBar}>
              <Text style={styles.formationLabel}>PP1:</Text>
              <FormationPicker value={formationPP1} onChange={setFormationPP1} theme={theme} />
              <Text style={[styles.formationLabel, { marginLeft: 12 }]}>PP2:</Text>
              <FormationPicker value={formationPP2} onChange={setFormationPP2} theme={theme} />
            </View>
          </View>
          <LineRow label="PP1" positions={['ld', 'rd', 'lw', 'c', 'rw']} lineKey="pp1" pool={[...forwards, ...dmen]} sectionColor="#c62828" />
          <LineRow label="PP2" positions={['ld', 'rd', 'lw', 'c', 'rw']} lineKey="pp2" pool={[...forwards, ...dmen]} sectionColor="#c62828" />

          {/* PK */}
          <Text style={[styles.sectionTitle, { color: '#2e7d32', marginTop: 16 }]}>Penalty Kill</Text>
          <LineRow label="PK1" positions={['ld', 'rd', 'lf', 'rf']} lineKey="pk1" pool={[...forwards, ...dmen]} sectionColor="#2e7d32" />
          <LineRow label="PK2" positions={['ld', 'rd', 'lf', 'rf']} lineKey="pk2" pool={[...forwards, ...dmen]} sectionColor="#2e7d32" />

          {/* Goalies */}
          <Text style={[styles.sectionTitle, { color: '#6a1b9a', marginTop: 16 }]}>Goalies</Text>
          <LineRow label="Goalies" positions={['starter', 'backup']} lineKey="goalies" pool={goaliesWithStats} sectionColor="#6a1b9a" />

          {/* Scratches */}
          <Text style={[styles.sectionTitle, { color: '#795548', marginTop: 16 }]}>Scratches</Text>
          <LineRow label="Scratches" positions={['s1', 's2', 's3']} lineKey="scratches" pool={[...forwards, ...dmen]} sectionColor="#795548" />

          {/* Copy button */}
          <TouchableOpacity style={styles.copyBtn} onPress={copyLines}>
            <Text style={styles.copyBtnText}>📋 Copy Lines to Clipboard</Text>
          </TouchableOpacity>
      </View>
    </View>
  );
}

// --- Formation picker ---
function FormationPicker({ value, onChange, theme }) {
  if (Platform.OS !== 'web') {
    return <Text style={{ color: theme.textMuted }}>{value}</Text>;
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '4px 8px',
        fontSize: 12,
        backgroundColor: theme.bgInput || '#fff',
        color: theme.text,
        border: `1px solid ${theme.border || '#ddd'}`,
        borderRadius: 4,
        fontFamily: 'inherit',
      }}
    >
      <option value="3f2d">3F-2D</option>
      <option value="4f1d">4F-1D</option>
      <option value="5f0d">5F-0D</option>
    </select>
  );
}

// ============================================================================
// STYLES
// ============================================================================

function makeStyles(theme, isMobile = false) {
  return StyleSheet.create({
    container: { marginTop: 20, padding: isMobile ? 10 : 16, backgroundColor: theme.bgCard, borderRadius: 12 },
    title: { fontWeight: '700', fontSize: isMobile ? 16 : 18, marginBottom: 12, textAlign: 'center', color: theme.text },

    actionBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 12 },
    actionBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, marginHorizontal: 4, marginBottom: 4 },
    actionBtnText: { color: '#fff', fontWeight: '600', fontSize: isMobile ? 11 : 13 },

    splitLayout: { flexDirection: 'row' },
    stackLayout: { flexDirection: 'column' },

    poolCard: {
      width: isMobile ? '100%' : 220,
      marginRight: isMobile ? 0 : 12,
      padding: 10,
      backgroundColor: theme.bgAlt || theme.bg,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.border,
      maxHeight: isMobile ? undefined : 800,
      overflow: 'auto',
    },
    poolTitle: { fontWeight: '700', fontSize: 13, marginBottom: 6, color: theme.text },
    poolSubtitle: { fontSize: 11, fontWeight: '600', color: theme.textSecondary, marginTop: 8, marginBottom: 4, textTransform: 'uppercase' },
    poolName: { color: theme.text, fontSize: 12, fontWeight: '600' },
    poolMeta: { color: theme.textSecondary, fontSize: 10 },
    poolEmpty: { color: theme.textMuted, fontSize: 11, fontStyle: 'italic', textAlign: 'center', padding: 8 },

    linesColumn: { flex: 1 },

    sectionTitle: { fontWeight: '700', fontSize: isMobile ? 13 : 14, marginBottom: 8 },

    lineRow: { marginBottom: 10 },
    lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    lineLabel: { fontWeight: '600', fontSize: 12 },
    lineTruei: { color: theme.textSecondary, fontSize: 11, fontWeight: '600' },

    slotsRow: { flexDirection: 'row' },
    slotsColumn: { flexDirection: 'column' },
    mobileSlotWrap: { marginBottom: 6 },

    slotCard: {
      flex: 1,
      marginHorizontal: 3,
      marginBottom: isMobile ? 6 : 0,
      padding: 8,
      backgroundColor: theme.bgInput || '#fff',
      borderWidth: 1,
      borderColor: theme.border || '#ddd',
      borderRadius: 6,
    },
    slotHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    slotLabel: { fontSize: 9, fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase' },
    slotName: { color: theme.text, fontSize: 12, fontWeight: '600', marginTop: 2 },
    slotTruei: { color: theme.accent || '#4ade80', fontSize: 11, fontWeight: '700' },
    slotEmpty: { color: theme.textMuted, fontStyle: 'italic' },

    formationBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' },
    formationLabel: { color: theme.textSecondary, fontSize: 11, marginRight: 4 },

    copyBtn: { backgroundColor: '#1565c0', padding: 14, borderRadius: 8, marginTop: 20, alignItems: 'center' },
    copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });
}
