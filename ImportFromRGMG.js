// ImportFromRGMG.js — one-click roster import from rgmg.ca team API
// Caches per-team responses in localStorage for 1 hour to reduce API load.
// Replaces myRoster (skaters + goalies) with the current signed roster.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_KEY_PREFIX = 'rgmg_team_cache_';

// List must match your CapDashboard NHL_TEAMS (30 RGMG teams, no Vegas/Seattle)
const TEAMS = [
  'Bruins', 'Sabres', 'Red Wings', 'Panthers', 'Canadiens', 'Senators', 'Lightning', 'Maple Leafs',
  'Hurricanes', 'Blue Jackets', 'Devils', 'Islanders', 'Rangers', 'Flyers', 'Penguins', 'Capitals',
  'Blackhawks', 'Avalanche', 'Stars', 'Wild', 'Predators', 'Blues', 'Jets',
  'Ducks', 'Coyotes', 'Flames', 'Oilers', 'Kings', 'Sharks', 'Canucks',
];

function getCached(team) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + team);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null; // expired
    return parsed.data;
  } catch { return null; }
}

function setCached(team, data) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + team, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

async function fetchTeam(team) {
  const cached = getCached(team);
  if (cached) return { data: cached, fromCache: true };
  const res = await fetch(`/api/team?name=${encodeURIComponent(team)}`);
  if (!res.ok) throw new Error(`Failed to load ${team} (${res.status})`);
  const data = await res.json();
  if (!data || !Array.isArray(data.players)) throw new Error(`Invalid response for ${team}`);
  setCached(team, data);
  return { data, fromCache: false };
}

// Filter to active skaters/goalies on signed contracts (NHL or Minors)
function extractRoster(teamData) {
  const players = teamData.players || [];
  const signed = players.filter(p => p.contract_type === 'signed' && (p.status === 'NHL' || p.status === 'Minors'));
  const skaters = signed.filter(p => !/^G/.test(p.pos || '')).map(p => p.name);
  const goalies = signed.filter(p => /^G/.test(p.pos || '')).map(p => p.name);
  return { skaters, goalies };
}

export default function ImportFromRGMG({ theme, currentTeam, onImport, styles: externalStyles }) {
  const [selected, setSelected] = useState(currentTeam || 'Jets');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  const styles = makeStyles(theme);

  const handleImport = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const { data, fromCache } = await fetchTeam(selected);
      const { skaters, goalies } = extractRoster(data);
      if (skaters.length === 0 && goalies.length === 0) {
        setStatus({ type: 'error', msg: `No signed players found for ${selected}` });
        setLoading(false);
        return;
      }
      onImport(skaters, goalies);
      setStatus({
        type: 'ok',
        msg: `Loaded ${skaters.length} skaters + ${goalies.length} goalies${fromCache ? ' (cached)' : ''}`
      });
    } catch (e) {
      setStatus({ type: 'error', msg: String(e.message || e) });
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📥 Import Roster from RGMG</Text>
      <Text style={styles.subtitle}>
        Pulls the current signed roster for the selected team. Data is cached for 1 hour to reduce API load.
      </Text>

      <View style={styles.row}>
        {Platform.OS === 'web' ? (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={loading}
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 14,
              backgroundColor: theme.bgInput || '#fff',
              color: theme.text,
              border: `1px solid ${theme.border || '#ddd'}`,
              borderRadius: 6,
              fontFamily: 'inherit',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        ) : (
          <Text style={styles.teamText}>{selected}</Text>
        )}
        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleImport}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.btnText}>Import</Text>}
        </TouchableOpacity>
      </View>

      {status && (
        <View style={[styles.status, status.type === 'ok' ? styles.statusOk : styles.statusErr]}>
          <Text style={styles.statusText}>
            {status.type === 'ok' ? '✅ ' : '⚠️ '}{status.msg}
          </Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme.bgCard || '#fff',
      padding: 12,
      borderRadius: 8,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.border || '#ddd',
    },
    title: { color: theme.text, fontSize: 14, fontWeight: '700', marginBottom: 4 },
    subtitle: { color: theme.textSecondary || '#666', fontSize: 11, marginBottom: 8 },
    row: { flexDirection: 'row', alignItems: 'center' },
    teamText: { color: theme.text, fontSize: 14, flex: 1 },
    btn: {
      backgroundColor: theme.accent || '#4caf50',
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 6,
      marginLeft: 8,
      minWidth: 80,
      alignItems: 'center',
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
    status: { marginTop: 8, padding: 8, borderRadius: 4 },
    statusOk: { backgroundColor: (theme.accent || '#4caf50') + '22' },
    statusErr: { backgroundColor: (theme.danger || '#f44336') + '22' },
    statusText: { color: theme.text, fontSize: 12 },
  });
}
