import React, { useState, useEffect, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';

// All 30 RGMG team nicknames (2016-17 NHL lineup — no Vegas, no Seattle)
export const NHL_TEAMS = [
  'Bruins', 'Sabres', 'Red Wings', 'Panthers', 'Canadiens', 'Senators', 'Lightning', 'Maple Leafs',
  'Hurricanes', 'Blue Jackets', 'Devils', 'Islanders', 'Rangers', 'Flyers', 'Penguins', 'Capitals',
  'Blackhawks', 'Avalanche', 'Stars', 'Wild', 'Predators', 'Blues', 'Jets',
  'Ducks', 'Coyotes', 'Flames', 'Oilers', 'Kings', 'Sharks', 'Canucks'
];

// CAP_MAX defaults — actual cap comes from the team API response
const CAP_MAX_DEFAULT = 75;

function formatMoney(n) {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (isNaN(num)) return '—';
  return `$${num.toFixed(2)}M`;
}

function capStatusColor(capHit, capMax, theme) {
  const pct = (capHit / capMax) * 100;
  if (pct >= 98) return theme.danger;
  if (pct >= 90) return theme.warning;
  return theme.accent;
}

// Match team-roster name to playerDatabase entry, then run calculateTRUEi against it.
// Returns null if no match or no TRUEi function available.
function findPlayerTRUEi(name, season, playerDatabase, calculateTRUEi) {
  if (!playerDatabase || !playerDatabase.length || !calculateTRUEi) return null;
  const match = playerDatabase.find(
    p => p.name === name && p.season === season && p.seasonType === 'regular'
  );
  if (!match) return null;
  const val = parseFloat(calculateTRUEi(match, playerDatabase));
  return isNaN(val) ? null : val;
}

export default function CapDashboard({ theme, seasons, playerDatabase, calculateTRUEi, defaultTeam = 'Jets' }) {
  const [selectedTeam, setSelectedTeam] = useState(defaultTeam);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showSeasonPicker, setShowSeasonPicker] = useState(false);

  // Stable primitive so effects don't re-fire on every parent render
  const latestSeason = seasons && seasons.length ? seasons[seasons.length - 1] : null;

  const styles = makeStyles(theme);

  // Default to most recent season once seasons load
  useEffect(() => {
    if (latestSeason && !selectedSeason) {
      setSelectedSeason(latestSeason);
    }
  }, [latestSeason, selectedSeason]);

  // Fetch team data whenever the (team, season) selection changes
  useEffect(() => {
    if (!selectedTeam || !selectedSeason) return;

    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // If viewing current season, omit the season param (rgmg defaults to current)
        const isCurrent = selectedSeason === latestSeason;
        const url = isCurrent
          ? `/api/team?name=${encodeURIComponent(selectedTeam)}`
          : `/api/team?name=${encodeURIComponent(selectedTeam)}&season=${encodeURIComponent(selectedSeason)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setTeamData(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
    // Intentionally depends on stable primitives, not the `seasons` array reference
  }, [selectedTeam, selectedSeason, latestSeason]);

  // Partition players by role
  const rosterGroups = useMemo(() => {
    if (!teamData?.players) return null;
    const p = teamData.players;

    const isSignedNHL = x => x.status === 'NHL' && x.contract_type === 'signed';
    const forwards = p.filter(x => isSignedNHL(x) && /^(C|LW|RW)/.test(x.position))
      .sort((a, b) => b.salary - a.salary);
    const defense = p.filter(x => isSignedNHL(x) && /^(LD|RD)/.test(x.position))
      .sort((a, b) => b.salary - a.salary);
    const goalies = p.filter(x => isSignedNHL(x) && /^G/.test(x.position))
      .sort((a, b) => b.salary - a.salary);

    const retained = p.filter(x => x.status === 'Retained');
    const buyouts = p.filter(x => x.status === 'Buyout');
    const waivers = p.filter(x => x.status === 'Waivers');
    const prospects = p.filter(x => x.status === 'Minors' && x.contract_type === 'signed');

    const buried = p.filter(x => {
      if (x.status !== 'Minors' || x.salary <= 1) return false;
      return /^G/.test(x.position)
        ? (x.totalGP >= 45 || x.age >= 24)
        : (x.totalGP >= 140 || x.age >= 24);
    });

    const expiringThisYear = [...forwards, ...defense, ...goalies]
      .filter(x => x.contract_duration === 1);

    return { forwards, defense, goalies, retained, buyouts, waivers, prospects, buried, expiringThisYear };
  }, [teamData]);

  // Find bargains and overpays using TRUEi per $M
  const valueAnalysis = useMemo(() => {
    if (!teamData?.players || !playerDatabase?.length || !selectedSeason || !calculateTRUEi) return null;

    const withTRUEi = teamData.players
      .filter(p => p.status === 'NHL' && p.contract_type === 'signed' && !/^G/.test(p.position))
      .map(p => {
        const truei = findPlayerTRUEi(p.name, selectedSeason, playerDatabase, calculateTRUEi);
        if (truei === null || truei === 0 || !p.salary) return null;
        const efficiency = truei / p.salary; // TRUEi per $M — higher = better value
        return { ...p, truei, efficiency };
      })
      .filter(Boolean);

    const sorted = [...withTRUEi].sort((a, b) => b.efficiency - a.efficiency);
    return {
      bargains: sorted.slice(0, 3),
      overpays: sorted.slice(-3).reverse(),
    };
  }, [teamData, playerDatabase, selectedSeason, calculateTRUEi]);

  const capMax = teamData ? Math.max(teamData.capHit + teamData.capSpace, teamData.capHit) : CAP_MAX_DEFAULT;
  const capPct = teamData ? (teamData.capHit / capMax) * 100 : 0;

  return (
    <ScrollView style={styles.container}>
      {/* Controls */}
      <View style={styles.controls}>
        <View style={styles.pickerRow}>
          <Text style={styles.label}>Team:</Text>
          <TouchableOpacity
            style={styles.picker}
            onPress={() => { setShowTeamPicker(!showTeamPicker); setShowSeasonPicker(false); }}
          >
            <Text style={styles.pickerText}>{selectedTeam} ▼</Text>
          </TouchableOpacity>
        </View>
        {showTeamPicker && (
          <ScrollView style={styles.pickerDropdown} nestedScrollEnabled={true}>
            {NHL_TEAMS.map(t => (
              <TouchableOpacity
                key={t}
                style={[styles.pickerOption, t === selectedTeam && styles.pickerOptionActive]}
                onPress={() => { setSelectedTeam(t); setShowTeamPicker(false); }}
              >
                <Text style={styles.pickerOptionText}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={styles.pickerRow}>
          <Text style={styles.label}>Season:</Text>
          <TouchableOpacity
            style={styles.picker}
            onPress={() => { setShowSeasonPicker(!showSeasonPicker); setShowTeamPicker(false); }}
          >
            <Text style={styles.pickerText}>{selectedSeason || '—'} ▼</Text>
          </TouchableOpacity>
        </View>
        {showSeasonPicker && (
          <ScrollView style={styles.pickerDropdown} nestedScrollEnabled={true}>
            {(seasons || []).slice().reverse().map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.pickerOption, s === selectedSeason && styles.pickerOptionActive]}
                onPress={() => { setSelectedSeason(s); setShowSeasonPicker(false); }}
              >
                <Text style={styles.pickerOptionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={styles.muted}>Loading {selectedTeam}...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>Failed to load: {error}</Text>
        </View>
      )}

      {!loading && !error && teamData && (
        <>
          {/* Cap Overview Card */}
          <View style={styles.capCard}>
            <View style={styles.capHeader}>
              <Text style={styles.teamName}>{teamData.name}</Text>
              <Text style={styles.gmName}>GM: {teamData.gmName}</Text>
            </View>

            <View style={styles.capBarContainer}>
              <View style={styles.capBarTrack}>
                <View
                  style={[
                    styles.capBarFill,
                    {
                      width: `${Math.min(capPct, 100)}%`,
                      backgroundColor: capStatusColor(teamData.capHit, capMax, theme),
                    },
                  ]}
                />
              </View>
              <Text style={styles.capBarText}>
                {formatMoney(teamData.capHit)} / {formatMoney(capMax)} · {capPct.toFixed(1)}%
              </Text>
            </View>

            <View style={styles.statGrid}>
              <StatBox label="Cap Space" value={formatMoney(teamData.capSpace)} theme={theme} highlight />
              <StatBox label="Retained" value={formatMoney(teamData.retained)} theme={theme} />
              <StatBox label="Buried" value={formatMoney(teamData.buried)} theme={theme} />
              <StatBox label="Buyouts" value={formatMoney(teamData.buyout)} theme={theme} />
              <StatBox label="Avg Age" value={teamData.averageAge} theme={theme} />
              <StatBox label="Contracts" value={`${teamData.contractCount}/50`} theme={theme} />
            </View>

            <View style={styles.countRow}>
              <Text style={styles.countText}>
                F: {teamData.forwardCount}  ·  D: {teamData.defenceCount}  ·  G: {teamData.goalieCount}  ·  Minors: {teamData.minorsCount}
              </Text>
            </View>
          </View>

          {/* Smart Flags */}
          {rosterGroups && rosterGroups.expiringThisYear.length > 0 && (
            <View style={styles.flagCard}>
              <Text style={styles.flagTitle}>
                ⏰ {rosterGroups.expiringThisYear.length} contract{rosterGroups.expiringThisYear.length > 1 ? 's' : ''} expiring after this season
              </Text>
              <Text style={styles.flagDetail}>
                {rosterGroups.expiringThisYear
                  .map(p => `${p.name} (${p.expiry_type})`)
                  .join(', ')}
              </Text>
            </View>
          )}

          {/* Value Analysis */}
          {valueAnalysis && valueAnalysis.bargains.length > 0 && (
            <View style={styles.valueCard}>
              <Text style={styles.sectionTitle}>💰 Top Bargains (TRUEi per $M)</Text>
              {valueAnalysis.bargains.map(p => (
                <View key={p.id} style={styles.valueRow}>
                  <Text style={styles.valueName}>{p.name}</Text>
                  <Text style={styles.valueStat}>
                    TRUEi {p.truei?.toFixed(1) ?? '—'} · {formatMoney(p.salary)} · {p.efficiency.toFixed(2)} per $M
                  </Text>
                </View>
              ))}

              <Text style={[styles.sectionTitle, { marginTop: 12 }]}>⚠️  Potential Overpays</Text>
              {valueAnalysis.overpays.map(p => (
                <View key={p.id} style={styles.valueRow}>
                  <Text style={styles.valueName}>{p.name}</Text>
                  <Text style={styles.valueStat}>
                    TRUEi {p.truei?.toFixed(1) ?? '—'} · {formatMoney(p.salary)} · {p.efficiency.toFixed(2)} per $M
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Roster Sections */}
          {rosterGroups && (
            <>
              <RosterSection title="Forwards" players={rosterGroups.forwards} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} />
              <RosterSection title="Defense" players={rosterGroups.defense} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} />
              <RosterSection title="Goalies" players={rosterGroups.goalies} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isGoalie />
              {rosterGroups.prospects.length > 0 && (
                <RosterSection title={`Prospects (${rosterGroups.prospects.length})`} players={rosterGroups.prospects} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} collapsed />
              )}
              {rosterGroups.retained.length > 0 && (
                <RosterSection title={`Retained (${rosterGroups.retained.length})`} players={rosterGroups.retained} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} collapsed />
              )}
              {rosterGroups.buried.length > 0 && (
                <RosterSection title={`Buried (${rosterGroups.buried.length})`} players={rosterGroups.buried} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} collapsed />
              )}
              {rosterGroups.buyouts.length > 0 && (
                <RosterSection title={`Buyouts (${rosterGroups.buyouts.length})`} players={rosterGroups.buyouts} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} collapsed />
              )}
              {rosterGroups.waivers.length > 0 && (
                <RosterSection title={`Waivers (${rosterGroups.waivers.length})`} players={rosterGroups.waivers} theme={theme} season={selectedSeason} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} collapsed />
              )}
            </>
          )}

          {/* Draft Picks */}
          {teamData.draftPicks && teamData.draftPicks.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>🎯 Draft Picks</Text>
              {teamData.draftPicks.map(pick => (
                <View key={pick.id} style={styles.pickRow}>
                  <Text style={styles.pickText}>
                    {pick.season} · {pick.original_team_name} · Round {pick.round}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ----- Subcomponents -----

function StatBox({ label, value, theme, highlight }) {
  const styles = makeStyles(theme);
  return (
    <View style={[styles.statBox, highlight && styles.statBoxHighlight]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && styles.statValueHighlight]}>{value}</Text>
    </View>
  );
}

function RosterSection({ title, players, theme, season, playerDatabase, calculateTRUEi, collapsed = false, isGoalie = false }) {
  const [open, setOpen] = useState(!collapsed);
  const styles = makeStyles(theme);

  if (players.length === 0) return null;

  const sectionTotal = players.reduce((sum, p) => sum + (p.salary || 0), 0);

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setOpen(!open)} style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{open ? '▼' : '▶'} {title}</Text>
        <Text style={styles.sectionTotal}>{formatMoney(sectionTotal)}</Text>
      </TouchableOpacity>
      {open && (
        <View>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { flex: 2.4 }]}>Name</Text>
            <Text style={[styles.th, { flex: 0.8 }]}>Pos</Text>
            <Text style={[styles.th, { flex: 0.5 }]}>Age</Text>
            <Text style={[styles.th, { flex: 1 }]}>AAV</Text>
            <Text style={[styles.th, { flex: 0.5 }]}>Yrs</Text>
            <Text style={[styles.th, { flex: 0.7 }]}>Exp</Text>
            <Text style={[styles.th, { flex: 0.7 }]}>TRUEi</Text>
            <Text style={[styles.th, { flex: 0.7 }]}>VAL</Text>
          </View>
          {players.map((p, idx) => {
            const truei = findPlayerTRUEi(p.name, season, playerDatabase, calculateTRUEi);
            const val = (truei !== null && p.salary > 0) ? truei / p.salary : null;
            const expiryColor = p.expiry_type === 'UFA' ? theme.warning : theme.textSecondary;
            const ufaSoon = p.contract_duration <= 1;

            // Color the VAL column: green if good value, red if poor
            let valColor = theme.text;
            if (val !== null) {
              if (val >= 8) valColor = theme.accent;
              else if (val < 3) valColor = theme.danger;
            }

            return (
              <View
                key={p.id}
                style={[styles.tr, idx % 2 === 0 && styles.trAlt, ufaSoon && styles.trUfaSoon]}
              >
                <Text style={[styles.td, { flex: 2.4 }]} numberOfLines={1}>{p.name}</Text>
                <Text style={[styles.td, { flex: 0.8 }]}>{p.position}</Text>
                <Text style={[styles.td, { flex: 0.5 }]}>{p.age}</Text>
                <Text style={[styles.td, { flex: 1 }]}>{formatMoney(p.salary)}</Text>
                <Text style={[styles.td, { flex: 0.5 }]}>{p.contract_duration}</Text>
                <Text style={[styles.td, { flex: 0.7, color: expiryColor, fontWeight: '600' }]}>{p.expiry_type}</Text>
                <Text style={[styles.td, { flex: 0.7 }]}>{truei !== null ? truei.toFixed(1) : '—'}</Text>
                <Text style={[styles.td, { flex: 0.7, color: valColor, fontWeight: '600' }]}>
                  {val !== null ? val.toFixed(1) : '—'}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ----- Styles -----

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg, padding: 10 },
    controls: { marginBottom: 10 },
    pickerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    label: { color: theme.text, fontWeight: '600', width: 70 },
    picker: {
      flex: 1,
      padding: 10,
      backgroundColor: theme.bgInput,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.border,
    },
    pickerText: { color: theme.text, fontSize: 14 },
    pickerDropdown: {
      backgroundColor: theme.bgCard,
      borderRadius: 6,
      marginBottom: 8,
      maxHeight: 240,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    pickerOption: {
      padding: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderLight,
    },
    pickerOptionActive: { backgroundColor: theme.bgSelected },
    pickerOptionText: { color: theme.text },

    center: { padding: 40, alignItems: 'center' },
    muted: { color: theme.textMuted, marginTop: 8 },
    errorCard: { padding: 16, backgroundColor: theme.danger, borderRadius: 6, marginBottom: 10 },
    errorText: { color: '#fff', fontWeight: '600' },

    capCard: {
      backgroundColor: theme.bgCard,
      padding: 16,
      borderRadius: 8,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    capHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    teamName: { color: theme.text, fontSize: 22, fontWeight: 'bold' },
    gmName: { color: theme.textSecondary, fontSize: 13 },

    capBarContainer: { marginBottom: 12 },
    capBarTrack: { height: 12, backgroundColor: theme.bgAlt, borderRadius: 6, overflow: 'hidden' },
    capBarFill: { height: '100%', borderRadius: 6 },
    capBarText: { color: theme.text, textAlign: 'center', marginTop: 6, fontSize: 13, fontWeight: '600' },

    statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
    statBox: {
      flexBasis: '33.33%',
      padding: 8,
      alignItems: 'center',
    },
    statBoxHighlight: {},
    statLabel: { color: theme.textSecondary, fontSize: 11, textTransform: 'uppercase' },
    statValue: { color: theme.text, fontSize: 16, fontWeight: 'bold', marginTop: 2 },
    statValueHighlight: { color: theme.accent },

    countRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.borderLight },
    countText: { color: theme.textSecondary, textAlign: 'center', fontSize: 12 },

    flagCard: {
      backgroundColor: theme.warning + '22',
      borderLeftWidth: 4,
      borderLeftColor: theme.warning,
      padding: 12,
      borderRadius: 6,
      marginBottom: 10,
    },
    flagTitle: { color: theme.text, fontWeight: 'bold', marginBottom: 4 },
    flagDetail: { color: theme.textSecondary, fontSize: 12 },

    valueCard: {
      backgroundColor: theme.bgCard,
      padding: 12,
      borderRadius: 8,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    valueRow: { paddingVertical: 4 },
    valueName: { color: theme.text, fontWeight: '600' },
    valueStat: { color: theme.textSecondary, fontSize: 12 },

    card: {
      backgroundColor: theme.bgCard,
      padding: 12,
      borderRadius: 8,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sectionTitle: { color: theme.text, fontSize: 16, fontWeight: 'bold' },
    sectionTotal: { color: theme.accent, fontWeight: '600' },

    tableHeader: {
      flexDirection: 'row',
      backgroundColor: theme.tableHeader,
      paddingVertical: 8,
      paddingHorizontal: 6,
      marginTop: 8,
      borderRadius: 4,
    },
    th: { color: '#fff', fontWeight: 'bold', fontSize: 11, textTransform: 'uppercase' },
    tr: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, alignItems: 'center' },
    trAlt: { backgroundColor: theme.tableRowAlt },
    trUfaSoon: { borderLeftWidth: 3, borderLeftColor: theme.warning },
    td: { color: theme.text, fontSize: 12 },

    pickRow: { paddingVertical: 4 },
    pickText: { color: theme.text, fontSize: 13 },
  });
}
