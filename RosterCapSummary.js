// RosterCapSummary.js — live cap summary computed from current roster
// Shows cap usage bar, contract count, retention slots, and errors when limits exceeded.
// Cap max is hardcoded to RGMG current cap ($75M default, can be overridden via prop).

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

const DEFAULT_CAP_MAX = 75.0; // $75M — RGMG salary cap
const CONTRACT_LIMIT = 40;     // RGMG contract limit (not 50 like NHL)
const RETENTION_LIMIT = 3;

// Money formatter
const fmt = (n) => {
  if (n == null || isNaN(n)) return '—';
  return `$${Number(n).toFixed(2)}M`;
};

export default function RosterCapSummary({
  theme,
  rosterPlayers = [],  // stats objects (from rosterWithStats)
  goalies = [],        // stats objects (from goaliesWithStats)
  contracts = {},      // { playerName: {salary, age, retention_count, ...} } from team API
  capMax = DEFAULT_CAP_MAX,
  teamName = '',
}) {
  const styles = makeStyles(theme);

  const stats = useMemo(() => {
    const allPlayers = [...rosterPlayers, ...goalies];
    const withContracts = allPlayers.map(p => ({
      ...p,
      contract: contracts[p.name] || null,
    }));

    // All contracts from the API — includes AHL prospects, buried, retained, etc.
    // This is separate from `withContracts` (NHL roster only).
    const allContractsArray = Object.entries(contracts || {}).map(([name, c]) => ({ name, ...c }));

    // --- Cap calculation (across ALL contracts, not just NHL roster) ---
    // NHL contracts: full salary hits cap.
    // Minors contracts: only salary over $1M counts (buried portion).
    // Retained contracts: player plays elsewhere, but we still pay the
    //   retained portion. The API's `salary` field on a Retained row is
    //   already the retained amount (pre-computed), not the full contract.
    //   Verified against Avalanche/Nylander data (retention_count:1, salary:1.305).
    // College/Europe contracts: $0 cap hit.
    let capUsed = 0;
    allContractsArray.forEach(c => {
      const sal = c.salary || 0;
      if (c.expiry_type === 'COLLEGE' || c.expiry_type === 'EUROPE') return;
      if (c.status === 'NHL') {
        capUsed += sal;
      } else if (c.status === 'Minors') {
        if (sal > 1.0) capUsed += (sal - 1.0);
      } else if (c.status === 'Retained') {
        capUsed += sal;
      }
    });
    const capSpace = capMax - capUsed;

    // --- Contract count (across ALL contracts) ---
    // Counts NHL + Minors + Retained, excludes College/Europe.
    // Retained contracts DO count against the 40-contract limit (RGMG rule).
    const contractCount = allContractsArray.filter(c => {
      if (c.expiry_type === 'COLLEGE' || c.expiry_type === 'EUROPE') return false;
      return c.status === 'NHL' || c.status === 'Minors' || c.status === 'Retained';
    }).length;

    // Retention slots from contract data — ALL contracts
    const retainedCount = allContractsArray.reduce((sum, c) => {
      return sum + (c.retention_count || 0);
    }, 0);

    // Age — use contract age; skaters only for avg
    const ages = withContracts
      .filter(p => rosterPlayers.some(rp => rp.name === p.name))
      .map(p => p.contract?.age || parseInt(p.age))
      .filter(a => !isNaN(a) && a > 0);
    const avgAge = ages.length > 0 ? ages.reduce((s, a) => s + a, 0) / ages.length : 0;

    // Manually-added players (no contract data)
    const manualCount = withContracts.filter(p => !p.contract).length;

    // Errors / warnings
    const errors = [];
    const warnings = [];
    if (capUsed > capMax) {
      errors.push(`Over cap by ${fmt(capUsed - capMax)}`);
    } else if (capSpace < 1.0 && capUsed > 0) {
      warnings.push(`Less than ${fmt(1.0)} in cap space`);
    }
    if (contractCount > CONTRACT_LIMIT) {
      errors.push(`Over contract limit: ${contractCount}/${CONTRACT_LIMIT}`);
    } else if (contractCount >= CONTRACT_LIMIT - 2) {
      warnings.push(`Near contract limit: ${contractCount}/${CONTRACT_LIMIT}`);
    }
    if (retainedCount > RETENTION_LIMIT) {
      errors.push(`Over retention limit: ${retainedCount}/${RETENTION_LIMIT}`);
    }
    if (manualCount > 0) {
      warnings.push(`${manualCount} manually-added player${manualCount === 1 ? '' : 's'} (no cap data — import team for full cap tracking)`);
    }

    return {
      capUsed, capSpace, capMax,
      contractCount, retainedCount,
      avgAge, manualCount,
      errors, warnings,
      hasErrors: errors.length > 0,
      hasWarnings: warnings.length > 0,
    };
  }, [rosterPlayers, goalies, contracts, capMax]);

  // Cap bar: green <80%, yellow 80-95%, red >95% or over
  const pctUsed = Math.min(100, (stats.capUsed / capMax) * 100);
  let barColor = theme.accent || '#4caf50';
  if (stats.capUsed > capMax) barColor = theme.danger || '#f44336';
  else if (pctUsed > 95) barColor = theme.danger || '#f44336';
  else if (pctUsed > 80) barColor = theme.warning || '#ff9800';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {teamName ? `${teamName} — ` : ''}Cap Summary
        </Text>
        {stats.hasErrors ? (
          <View style={[styles.badge, styles.badgeError]}>
            <Text style={styles.badgeText}>✗ Invalid</Text>
          </View>
        ) : stats.hasWarnings ? (
          <View style={[styles.badge, styles.badgeWarning]}>
            <Text style={styles.badgeText}>⚠ Tight</Text>
          </View>
        ) : (
          <View style={[styles.badge, styles.badgeOk]}>
            <Text style={styles.badgeText}>✓ Compliant</Text>
          </View>
        )}
      </View>

      {/* Cap bar */}
      <View style={styles.barContainer}>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pctUsed}%`, backgroundColor: barColor }]} />
        </View>
        <Text style={styles.barText}>
          {fmt(stats.capUsed)} / {fmt(capMax)} ({pctUsed.toFixed(1)}%)
        </Text>
      </View>

      {/* Stat grid */}
      <View style={styles.grid}>
        <StatBox label="Cap Space" value={fmt(stats.capSpace)} theme={theme}
          color={stats.capSpace < 0 ? theme.danger : stats.capSpace < 1 ? theme.warning : theme.accent}
          highlight />
        <StatBox label="Contracts" value={`${stats.contractCount} / ${CONTRACT_LIMIT}`} theme={theme}
          color={stats.contractCount > CONTRACT_LIMIT ? theme.danger : stats.contractCount >= CONTRACT_LIMIT - 2 ? theme.warning : theme.text} />
        <StatBox label="Retentions" value={`${stats.retainedCount} / ${RETENTION_LIMIT}`} theme={theme}
          color={stats.retainedCount > RETENTION_LIMIT ? theme.danger : stats.retainedCount >= RETENTION_LIMIT ? theme.warning : theme.text} />
        <StatBox label="Avg Age" value={stats.avgAge > 0 ? stats.avgAge.toFixed(1) : '—'} theme={theme} />
      </View>

      {/* Errors */}
      {stats.hasErrors && (
        <View style={[styles.banner, styles.bannerError]}>
          {stats.errors.map((e, i) => (
            <Text key={i} style={styles.bannerText}>🚫 {e}</Text>
          ))}
        </View>
      )}

      {/* Warnings */}
      {!stats.hasErrors && stats.hasWarnings && (
        <View style={[styles.banner, styles.bannerWarning]}>
          {stats.warnings.map((w, i) => (
            <Text key={i} style={styles.bannerText}>⚠️ {w}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function StatBox({ label, value, theme, color, highlight }) {
  const styles = makeStyles(theme);
  return (
    <View style={[styles.statBox, highlight && styles.statBoxHighlight]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bgCard || '#fff',
      borderRadius: 8,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.border || '#ddd',
    },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    title: { color: theme.text, fontSize: 16, fontWeight: '700' },

    badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12 },
    badgeOk: { backgroundColor: (theme.accent || '#4caf50') + '33' },
    badgeWarning: { backgroundColor: (theme.warning || '#ff9800') + '33' },
    badgeError: { backgroundColor: (theme.danger || '#f44336') + '33' },
    badgeText: { color: theme.text, fontSize: 11, fontWeight: '700' },

    barContainer: { marginBottom: 12 },
    barTrack: {
      height: 14,
      backgroundColor: theme.bgAlt || '#f0f0f0',
      borderRadius: 7,
      overflow: 'hidden',
    },
    barFill: { height: '100%', borderRadius: 7 },
    barText: { color: theme.text, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 6 },

    grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
    statBox: { flexBasis: '25%', padding: 6, alignItems: 'center' },
    statBoxHighlight: {},
    statLabel: { color: theme.textSecondary || '#666', fontSize: 10, textTransform: 'uppercase', marginBottom: 2 },
    statValue: { color: theme.text, fontSize: 15, fontWeight: 'bold' },

    banner: {
      marginTop: 10, padding: 10, borderRadius: 6, borderLeftWidth: 4,
    },
    bannerError: {
      backgroundColor: (theme.danger || '#f44336') + '22',
      borderLeftColor: theme.danger || '#f44336',
    },
    bannerWarning: {
      backgroundColor: (theme.warning || '#ff9800') + '22',
      borderLeftColor: theme.warning || '#ff9800',
    },
    bannerText: { color: theme.text, fontSize: 12, marginBottom: 2 },
  });
}
