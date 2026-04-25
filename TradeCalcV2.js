import React, { useState, useEffect, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { NHL_TEAMS } from './CapDashboard';
import PeteyRejection from './PeteyRejection';

const MOBILE_BREAKPOINT = 768;
const MAX_TEAMS = 4;
const MIN_TEAMS = 2;
const CONTRACT_LIMIT = 40;

// ===== Helpers =====

function formatMoney(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return `$${Number(n).toFixed(2)}M`;
}

function signedMoney(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const num = Number(n);
  return `${num > 0 ? '+' : ''}$${num.toFixed(2)}M`;
}

function findPlayerTRUEi(name, season, playerDatabase, calculateTRUEi) {
  if (!playerDatabase || !playerDatabase.length || !calculateTRUEi) return null;
  const match = playerDatabase.find(
    p => p.name === name && p.season === season && p.seasonType === 'regular'
  );
  if (!match) return null;
  const val = parseFloat(calculateTRUEi(match, playerDatabase));
  return isNaN(val) ? null : val;
}

// Returns the max % a SINGLE team can retain on this contract in one transaction.
function maxRetentionPerTx(player) {
  if (!player) return 0;
  const yrs = player.contract_duration || 0;
  if (yrs <= 0) return 0;
  if (yrs === 1) return 50;
  if (yrs === 2) return 25;
  return 15;
}

// How many retention slots are still available for a contract.
// Contract can have up to 2 retentions total. retention_count tracks pre-existing.
function retentionSlotsLeft(player) {
  if (!player) return 0;
  return Math.max(0, 2 - (player.retention_count || 0));
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TradeCalcV2({ theme, seasons, playerDatabase, calculateTRUEi }) {
  // Teams: array of { slot: 'A'|'B'|'C'|'D', name: string, data: object|null, loading: bool }
  const [teams, setTeams] = useState([
    { slot: 'A', name: 'Jets', data: null, loading: false },
    { slot: 'B', name: 'Maple Leafs', data: null, loading: false },
  ]);
  const [showPickerFor, setShowPickerFor] = useState(null); // slot letter or null
  const [activeMobileTeam, setActiveMobileTeam] = useState('A'); // which team's roster is visible on mobile

  // Transactions: [{ id, kind: 'player'|'pick', assetId, fromSlot, toSlot, brokerSlot|null, retentionPct, brokerRetentionPct }]
  const [transactions, setTransactions] = useState([]);

  // Drag-drop state
  const [draggedItem, setDraggedItem] = useState(null);
  const [dropZoneActive, setDropZoneActive] = useState(null);

  // Feedback message for clipboard ops
  const [copiedMsg, setCopiedMsg] = useState(null);
  useEffect(() => {
    if (!copiedMsg) return;
    const t = setTimeout(() => setCopiedMsg(null), 3000);
    return () => clearTimeout(t);
  }, [copiedMsg]);

  // Petey rejection overlay — shown when user tries to submit an illegal
  // trade. `rejectReason` is a human-readable summary of which team
  // violated which constraint.
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const latestSeason = seasons && seasons.length ? seasons[seasons.length - 1] : null;
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const styles = makeStyles(theme, isMobile);

  // ---------- Fetch team data when name changes ----------
  useEffect(() => {
    teams.forEach((t, idx) => {
      if (!t.name || t.data?.name === t.name) return;
      if (t.loading) return;

      const cancelRef = { cancelled: false };
      setTeams(prev => prev.map((pt, i) => i === idx ? { ...pt, loading: true } : pt));

      (async () => {
        try {
          const res = await fetch(`/api/team?name=${encodeURIComponent(t.name)}`);
          const data = await res.json();
          if (cancelRef.cancelled) return;
          // Only accept valid team responses (must have players array)
          if (!data || !Array.isArray(data.players)) {
            console.warn(`Team "${t.name}" returned invalid data`, data);
            setTeams(prev => prev.map((pt, i) =>
              (i === idx && pt.name === t.name) ? { ...pt, data: null, loading: false } : pt
            ));
            return;
          }
          setTeams(prev => prev.map((pt, i) =>
            (i === idx && pt.name === t.name) ? { ...pt, data, loading: false } : pt
          ));
        } catch (e) {
          console.error('Team load error', t.name, e);
          setTeams(prev => prev.map((pt, i) => i === idx ? { ...pt, loading: false } : pt));
        }
      })();

      return () => { cancelRef.cancelled = true; };
    });
  }, [teams.map(t => t.name).join(',')]); // eslint-disable-line

  // Clear transactions if team roster changes
  useEffect(() => {
    setTransactions([]);
  }, [teams.map(t => t.name).join(',')]);

  // ---------- Team management ----------
  const addTeam = () => {
    if (teams.length >= MAX_TEAMS) return;
    const used = new Set(teams.map(t => t.slot));
    const nextSlot = ['A', 'B', 'C', 'D'].find(s => !used.has(s));
    const usedNames = new Set(teams.map(t => t.name));
    const nextName = NHL_TEAMS.find(n => !usedNames.has(n));
    setTeams(prev => [...prev, { slot: nextSlot, name: nextName, data: null, loading: false }]);
  };

  const removeTeam = (slot) => {
    if (teams.length <= MIN_TEAMS) return;
    // Remove any transactions involving this team
    setTransactions(prev => prev.filter(tx =>
      tx.fromSlot !== slot && tx.toSlot !== slot && tx.brokerSlot !== slot
    ));
    setTeams(prev => prev.filter(t => t.slot !== slot));
    if (activeMobileTeam === slot) setActiveMobileTeam(teams.find(t => t.slot !== slot)?.slot || 'A');
  };

  const changeTeamName = (slot, newName) => {
    setTeams(prev => prev.map(t =>
      t.slot === slot ? { ...t, name: newName, data: null } : t
    ));
    setShowPickerFor(null);
  };

  // ---------- Transaction management ----------
  // Add a new transaction from a drag or tap
  const addTransaction = (kind, assetId, fromSlot) => {
    // Default destination: first other team in the trade
    const otherTeams = teams.filter(t => t.slot !== fromSlot);
    if (otherTeams.length === 0) return;
    const defaultTo = otherTeams[0].slot;

    // Prevent duplicate: same asset already in transactions from this team
    const existing = transactions.find(tx =>
      tx.kind === kind && tx.assetId === assetId && tx.fromSlot === fromSlot
    );
    if (existing) return;

    // ─── 0x0 pending-contract check ──────────────────────────────────────
    // Warn the user up front (before the transaction is added) that they're
    // moving an unsigned player. These can't legitimately be traded until
    // the contract is finalized on rgmg.ca.
    if (kind === 'player') {
      const asset = findAsset('player', assetId, fromSlot);
      if (asset) {
        const yrs = Number(asset.contract_duration) || 0;
        const sal = Number(asset.salary) || 0;
        if (yrs === 0 && sal === 0) {
          const msg = `⚠️  ${asset.name} has a pending 0×0 contract.\n\nUnsigned players can't be traded until negotiation is finalized on rgmg.ca.\n\nAdd to trade anyway?`;
          if (typeof window !== 'undefined' && window.confirm) {
            if (!window.confirm(msg)) return;
          }
        }
      }
    }

    const newTx = {
      id: `tx-${Date.now()}-${Math.random()}`,
      kind,
      assetId,
      fromSlot,
      toSlot: defaultTo,
      brokerSlot: null,
      retentionPct: 0,
      brokerRetentionPct: 0,
    };
    setTransactions(prev => [...prev, newTx]);
  };

  const removeTransaction = (txId) => {
    setTransactions(prev => prev.filter(tx => tx.id !== txId));
  };

  const updateTransaction = (txId, updates) => {
    setTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, ...updates } : tx));
  };

  const clearAll = () => setTransactions([]);

  // Build the "submit trade" clipboard text and copy it
  const submitTrade = () => {
    if (transactions.length === 0) return;

    // Validate first — if any team doesn't fit, pop the rejection overlay
    // instead of copying. Build a short human-readable reason so the user
    // knows WHICH team / WHICH rule broke.
    // Note: capMath is an OBJECT keyed by team slot ("A","B"...), not an
    // array — use Object.values() to iterate.
    const capMathRows = capMath ? Object.values(capMath) : [];
    if (capMathRows.length > 0) {
      const failures = [];
      capMathRows.forEach(r => {
        if (r.fits) return;
        const teamName = r.name || '?';
        const problems = [];
        if (r.projCap > r.capMax) {
          const over = r.projCap - r.capMax;
          problems.push(`$${over.toFixed(2)}M over cap`);
        }
        if (r.newContractCount > CONTRACT_LIMIT) {
          problems.push(`${r.newContractCount}/${CONTRACT_LIMIT} contracts`);
        }
        if (!r.retentionFits) {
          problems.push(`${r.newRetainedCount}/3 retentions`);
        }
        if (problems.length > 0) {
          failures.push(`${teamName}: ${problems.join(', ')}`);
        }
      });
      if (failures.length > 0) {
        setRejectReason(failures.join(' · '));
        setShowReject(true);
        return;
      }
    }

    const fmtMoney = (n) => {
      if (n == null || isNaN(n)) return '$0.00M';
      return `$${Number(n).toFixed(2)}M`;
    };

    const lines = [];
    lines.push('=== RGMG TRADE SUBMISSION ===');
    lines.push('');

    // Teams involved
    lines.push('TEAMS INVOLVED:');
    teams.forEach(t => {
      const gm = t.data?.gmName || '?';
      lines.push(`  ${t.slot}: ${t.name} (${gm})`);
    });
    lines.push('');

    // Transactions
    lines.push('───────────────────────────────────────');
    lines.push('TRANSACTIONS:');
    lines.push('');

    transactions.forEach((tx, i) => {
      const asset = findAsset(tx.kind, tx.assetId, tx.fromSlot);
      if (!asset) return;
      const fromTeam = teams.find(t => t.slot === tx.fromSlot);
      const toTeam = teams.find(t => t.slot === tx.toSlot);
      const brokerTeam = tx.brokerSlot ? teams.find(t => t.slot === tx.brokerSlot) : null;

      lines.push(`${i + 1}. ${asset.name || `${asset.season} R${asset.round} Pick (${asset.original_team_name})`}`);
      lines.push(`   ${fromTeam?.name} → ${toTeam?.name}`);

      if (tx.kind === 'player') {
        lines.push(`   Contract: ${fmtMoney(asset.salary)} × ${asset.contract_duration}yr, ${asset.expiry_type}`);

        const maxPerTx = (() => {
          const yrs = asset.contract_duration || 0;
          if (yrs <= 1) return 50;
          if (yrs === 2) return 25;
          return 15;
        })();

        let fromRet = Math.max(0, Math.min(maxPerTx, tx.retentionPct || 0));
        let brokerRet = tx.brokerSlot ? Math.max(0, Math.min(maxPerTx, tx.brokerRetentionPct || 0)) : 0;
        if (fromRet + brokerRet > maxPerTx) brokerRet = Math.max(0, maxPerTx - fromRet);

        if (fromRet > 0) {
          lines.push(`   ${fromTeam?.name} retains ${fromRet}% (${fmtMoney(asset.salary * fromRet / 100)})`);
        }
        if (brokerTeam && brokerRet > 0) {
          lines.push(`   ${brokerTeam.name} retains ${brokerRet}% (${fmtMoney(asset.salary * brokerRet / 100)})`);
        }
        if (fromRet > 0 || brokerRet > 0) {
          const remaining = asset.salary * (1 - (fromRet + brokerRet) / 100);
          lines.push(`   ${toTeam?.name} receives at ${fmtMoney(remaining)} AAV`);
        }
      } else if (tx.kind === 'pick') {
        lines.push(`   ${asset.season} Round ${asset.round} (original: ${asset.original_team_name})`);
      }
      lines.push('');
    });

    // Cap impact
    if (capMath) {
      lines.push('───────────────────────────────────────');
      lines.push('CAP IMPACT:');
      lines.push('');
      teams.forEach(t => {
        const r = capMath[t.slot];
        if (!r) return;
        lines.push(`${r.name}:`);
        lines.push(`  Before: ${fmtMoney(r.capHit)} / ${fmtMoney(r.capMax)}`);
        lines.push(`  After:  ${fmtMoney(r.projCap)} / ${fmtMoney(r.capMax)} ${r.fits ? '✓' : '✗'}`);
        lines.push(`  Change: ${r.netCap >= 0 ? '+' : ''}${fmtMoney(r.netCap)}`);
        lines.push(`  Contracts: ${r.contractCount} → ${r.newContractCount}`);
        if (r.newRetainedCount !== r.retainedCount) {
          lines.push(`  Retentions: ${r.retainedCount} → ${r.newRetainedCount} / 3`);
        }
        lines.push('');
      });
    }

    // Warnings (if any)
    if (warnings.length > 0) {
      lines.push('───────────────────────────────────────');
      lines.push('⚠ WARNINGS:');
      warnings.forEach(w => lines.push(`  - ${w}`));
      lines.push('');
    }

    lines.push('═══════════════════════════════════════');
    lines.push('Generated by RGMG Analytics');

    const text = lines.join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => setCopiedMsg('✅ Trade copied to clipboard!'),
        () => setCopiedMsg('❌ Copy failed — check browser permissions')
      );
    }
  };

  // Helper: find asset by id across all teams' rosters
  const findAsset = (kind, assetId, slot) => {
    const team = teams.find(t => t.slot === slot);
    if (!team?.data) return null;
    if (kind === 'player') return team.data.players.find(p => p.id === assetId);
    if (kind === 'pick') return team.data.draftPicks?.find(pk => pk.id === assetId);
    return null;
  };

  // ---------- Cap math per team ----------
  const capMath = useMemo(() => {
    if (teams.some(t => !t.data || !Array.isArray(t.data.players))) return null;

    const result = {};
    teams.forEach(team => {
      result[team.slot] = {
        name: team.name,
        capHit: team.data.capHit,
        // Note: do NOT Math.max-floor capMax here. For trade validation,
        // a team's true cap ceiling is capHit + capSpace. If they're over
        // (capSpace negative), the ceiling is BELOW their current hit and
        // any incoming salary correctly fails r.fits. The Math.max guard
        // belongs in display code (CapDashboard) where it prevents
        // negative ratios from breaking visual bars.
        capMax: team.data.capHit + team.data.capSpace,
        contractCount: team.data.contractCount,
        retainedCount: team.data.retainedCount || 0,
        outgoingAAV: 0, // net leaving cap
        incomingAAV: 0,
        retainedOnBooks: 0, // new retentions this trade adds
        playersOut: 0,
        playersIn: 0,
        newRetentions: 0, // # of retention slots this trade adds
      };
    });

    transactions.forEach(tx => {
      if (tx.kind === 'player') {
        const player = findAsset('player', tx.assetId, tx.fromSlot);
        if (!player) return;

        const maxPerTx = maxRetentionPerTx(player);
        let fromRet = Math.max(0, Math.min(maxPerTx, tx.retentionPct || 0));
        let brokerRet = tx.brokerSlot
          ? Math.max(0, Math.min(maxPerTx, tx.brokerRetentionPct || 0))
          : 0;
        // Enforce total cap: if somehow exceeds max, scale broker down
        if (fromRet + brokerRet > maxPerTx) {
          brokerRet = Math.max(0, maxPerTx - fromRet);
        }

        const fromRetained = player.salary * (fromRet / 100);
        const brokerRetained = player.salary * (brokerRet / 100);
        const toTeamReceivesAAV = player.salary - fromRetained - brokerRetained;

        // From team
        if (result[tx.fromSlot]) {
          result[tx.fromSlot].outgoingAAV += (player.salary - fromRetained);
          result[tx.fromSlot].retainedOnBooks += fromRetained;
          result[tx.fromSlot].playersOut += 1;
          if (fromRet > 0) result[tx.fromSlot].newRetentions += 1;
        }

        // Broker team (if any)
        if (tx.brokerSlot && result[tx.brokerSlot]) {
          result[tx.brokerSlot].retainedOnBooks += brokerRetained;
          if (brokerRet > 0) result[tx.brokerSlot].newRetentions += 1;
        }

        // Destination
        if (result[tx.toSlot]) {
          result[tx.toSlot].incomingAAV += toTeamReceivesAAV;
          result[tx.toSlot].playersIn += 1;
        }
      }
    });

    // Finalize per-team projection
    teams.forEach(team => {
      const r = result[team.slot];
      r.netCap = r.incomingAAV - r.outgoingAAV + r.retainedOnBooks;
      r.projCap = r.capHit + r.netCap;
      r.projSpace = r.capMax - r.projCap;
      r.newContractCount = r.contractCount - r.playersOut + r.playersIn;
      r.newRetainedCount = r.retainedCount + r.newRetentions;
      r.retentionFits = r.newRetainedCount <= 3;
      r.fits = r.projCap <= r.capMax && r.newContractCount <= CONTRACT_LIMIT && r.retentionFits;
    });

    return result;
  }, [teams, transactions]);

  // ---------- Validation warnings ----------
  const warnings = useMemo(() => {
    const out = [];
    // ─── 0x0 / pending contracts ─────────────────────────────────────────
    // A "0x0" contract is a placeholder with 0 years × $0 salary — typically
    // a pending RFA/UFA negotiation that hasn't been signed yet. These
    // shouldn't be tradeable until they're finalized on rgmg.ca.
    transactions.forEach(tx => {
      if (tx.kind !== 'player') return;
      const asset = findAsset('player', tx.assetId, tx.fromSlot);
      if (!asset) return;
      const yrs = Number(asset.contract_duration) || 0;
      const sal = Number(asset.salary) || 0;
      if (yrs === 0 && sal === 0) {
        out.push(`⚠️ ${asset.name} is on a 0×0 pending contract — unsigned players cannot be traded until negotiation finalizes on rgmg.ca.`);
      }
    });

    // Check retention_count + new retentions per contract
    const retByAsset = {};
    transactions.forEach(tx => {
      if (tx.kind !== 'player') return;
      const asset = findAsset('player', tx.assetId, tx.fromSlot);
      if (!asset) return;
      const key = asset.id;
      if (!retByAsset[key]) retByAsset[key] = { player: asset, newRetentions: 0, settingRetention: false };
      if (tx.retentionPct > 0) { retByAsset[key].newRetentions += 1; retByAsset[key].settingRetention = true; }
      if (tx.brokerSlot && tx.brokerRetentionPct > 0) { retByAsset[key].newRetentions += 1; retByAsset[key].settingRetention = true; }
    });
    Object.values(retByAsset).forEach(({ player, newRetentions, settingRetention }) => {
      const existing = player.retention_count || 0;
      if (existing + newRetentions > 2) {
        out.push(`${player.name}: ${existing} retention${existing !== 1 ? 's' : ''} already used; this trade adds ${newRetentions} more (max 2 total per contract)`);
      }
      // IMPORTANT: RGMG API doesn't expose EXISTING retention %, only the count.
      // When adding retention to an already-retained contract, warn the user to
      // verify on rgmg.ca so they don't exceed the total retention cap.
      const maxPerTx = (() => {
        const yrs = player.contract_duration || 0;
        if (yrs === 1) return 50;
        if (yrs === 2) return 25;
        return 15;
      })();
      if (settingRetention && existing > 0) {
        out.push(`⚠️ ${player.name}: This contract already has ${existing} prior retention${existing !== 1 ? 's' : ''}. Total retention cannot exceed ${maxPerTx}% across all parties. Verify existing retention on rgmg.ca before submitting.`);
      }
    });
    // Check team retention slot cap (max 3 per team)
    if (capMath) {
      teams.forEach(team => {
        const r = capMath[team.slot];
        if (r && r.newRetainedCount > 3) {
          out.push(`${team.slot}: ${team.name} would have ${r.newRetainedCount} retentions on the books (max 3 allowed)`);
        }
      });
    }
    return out;
  }, [transactions, teams, capMath]);

  // ---------- Drag handlers (desktop) ----------
  const handleDragStart = (kind, id, fromSlot) => (e) => {
    setDraggedItem({ kind, id, fromSlot });
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragEnd = () => { setDraggedItem(null); setDropZoneActive(null); };
  const handleDragOver = (slot) => (e) => { e.preventDefault?.(); setDropZoneActive(slot); };
  const handleDragLeave = () => setDropZoneActive(null);
  const handleDrop = (targetSlot) => (e) => {
    e.preventDefault?.();
    if (!draggedItem) return;
    if (draggedItem.fromSlot === targetSlot) {
      addTransaction(draggedItem.kind, draggedItem.id, draggedItem.fromSlot);
    }
    setDraggedItem(null);
    setDropZoneActive(null);
  };

  // ---------- Render ----------
  return (
    <>
    <ScrollView style={styles.container}>
      {/* Team selector bar */}
      <View style={styles.teamBar}>
        <Text style={styles.teamBarLabel}>Teams in trade:</Text>
        <View style={styles.teamBarRow}>
          {teams.map(t => (
            <View key={t.slot} style={styles.teamSelectorWrap}>
              <TouchableOpacity
                style={styles.teamSelectorBtn}
                onPress={() => setShowPickerFor(showPickerFor === t.slot ? null : t.slot)}
              >
                <Text style={styles.teamSelectorText}>
                  {t.slot}: {t.name} ▼
                </Text>
              </TouchableOpacity>
              {teams.length > MIN_TEAMS && (
                <TouchableOpacity style={styles.removeTeamBtn} onPress={() => removeTeam(t.slot)}>
                  <Text style={styles.removeTeamText}>✕</Text>
                </TouchableOpacity>
              )}
              {showPickerFor === t.slot && (
                <View style={styles.teamPickerDropdown}>
                  <ScrollView style={{ maxHeight: 280 }}>
                    {NHL_TEAMS
                      .filter(n => !teams.some(x => x.slot !== t.slot && x.name === n))
                      .map(n => (
                        <TouchableOpacity
                          key={n}
                          style={[styles.dropdownItem, n === t.name && styles.dropdownItemActive]}
                          onPress={() => changeTeamName(t.slot, n)}
                        >
                          <Text style={styles.dropdownText}>{n}</Text>
                        </TouchableOpacity>
                      ))}
                  </ScrollView>
                </View>
              )}
            </View>
          ))}
          {teams.length < MAX_TEAMS && (
            <TouchableOpacity style={styles.addTeamBtn} onPress={addTeam}>
              <Text style={styles.addTeamText}>+ Add Team</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Cap math summary */}
      {capMath && (
        <View style={styles.mathCard}>
          <View style={[styles.mathRow, isMobile && styles.stackedColumn]}>
            {teams.map(t => {
              const r = capMath[t.slot];
              if (!r) return null;
              return (
                <View key={t.slot} style={styles.mathCol}>
                  <Text style={styles.mathTeam}>{t.slot}: {r.name}</Text>
                  <Text style={styles.mathLabel}>Current</Text>
                  <Text style={styles.mathValue}>{formatMoney(r.capHit)} / {formatMoney(r.capMax)}</Text>
                  <Text style={styles.mathLabel}>After Trade</Text>
                  <Text style={[styles.mathValue, { color: r.fits ? theme.accent : theme.danger }]}>
                    {formatMoney(r.projCap)} ({r.fits ? '✓' : '✗'})
                  </Text>
                  <Text style={styles.mathLabel}>Change</Text>
                  <Text style={[styles.mathValue, { color: r.netCap > 0 ? theme.danger : theme.accent }]}>
                    {signedMoney(r.netCap)}
                  </Text>
                  <Text style={styles.mathLabel}>Contracts</Text>
                  <Text style={[styles.mathValue, { color: r.newContractCount > CONTRACT_LIMIT ? theme.danger : theme.text }]}>
                    {r.contractCount} → {r.newContractCount}
                  </Text>
                  <Text style={styles.mathLabel}>Retentions</Text>
                  <Text style={[styles.mathValue, { color: !r.retentionFits ? theme.danger : (r.newRetainedCount >= 3 ? theme.warning : theme.text) }]}>
                    {r.retainedCount} → {r.newRetainedCount} / 3
                  </Text>
                </View>
              );
            })}
          </View>
          {transactions.length > 0 && (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.submitBtn} onPress={submitTrade}>
                <Text style={styles.submitBtnText}>📋 Submit Trade (Copy to Clipboard)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
                <Text style={styles.clearBtnText}>🗑 Clear</Text>
              </TouchableOpacity>
            </View>
          )}
          {copiedMsg && (
            <View style={styles.copiedBanner}>
              <Text style={styles.copiedText}>{copiedMsg}</Text>
            </View>
          )}
        </View>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <View style={styles.warningCard}>
          {warnings.map((w, i) => (
            <Text key={i} style={styles.warningText}>⚠️ {w}</Text>
          ))}
        </View>
      )}

      {/* Transactions list */}
      {transactions.length > 0 && (
        <View style={styles.txListCard}>
          <Text style={styles.sectionTitle}>Transactions ({transactions.length})</Text>
          {transactions.map(tx => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              teams={teams}
              findAsset={findAsset}
              onUpdate={(updates) => updateTransaction(tx.id, updates)}
              onRemove={() => removeTransaction(tx.id)}
              theme={theme}
              isMobile={isMobile}
            />
          ))}
        </View>
      )}

      {/* Mobile team tabs */}
      {isMobile && (
        <View style={styles.mobileTabs}>
          {teams.map(t => (
            <TouchableOpacity
              key={t.slot}
              style={[styles.mobileTab, activeMobileTeam === t.slot && styles.mobileTabActive]}
              onPress={() => setActiveMobileTeam(t.slot)}
            >
              <Text style={[styles.mobileTabText, activeMobileTeam === t.slot && styles.mobileTabTextActive]}>
                {t.slot}: {t.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Rosters */}
      <View style={[styles.rosterRow, isMobile && styles.stackedColumn]}>
        {teams.map(t => {
          // On mobile, only render the active team's roster
          if (isMobile && t.slot !== activeMobileTeam) return null;
          return (
            <RosterColumn
              key={t.slot}
              team={t}
              transactions={transactions}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver(t.slot)}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop(t.slot)}
              onTap={addTransaction}
              dropActive={dropZoneActive === t.slot}
              theme={theme}
              isMobile={isMobile}
              season={latestSeason}
              playerDatabase={playerDatabase}
              calculateTRUEi={calculateTRUEi}
            />
          );
        })}
      </View>

      {/* Help */}
      <View style={styles.helpCard}>
        <Text style={styles.helpText}>
          {isMobile
            ? '💡 Tap players/picks to add them to the trade. Use team tabs above to switch rosters. Each transaction below lets you set destination team, retention %, and optionally a broker team that retains additional salary before passing to the final destination.'
            : '💡 Drag players/picks onto that team\'s roster header to add a transaction. Each transaction shows up below — set destination team, retention, and optional broker (Team C retains 15% then sends to final destination B).'}
        </Text>
      </View>
    </ScrollView>
    <PeteyRejection
      visible={showReject}
      reason={rejectReason}
      onClose={() => setShowReject(false)}
    />
    </>
  );
}

// ============================================================================
// TRANSACTION ROW — the detail card for each traded asset
// ============================================================================

function TransactionRow({ tx, teams, findAsset, onUpdate, onRemove, theme, isMobile }) {
  const styles = makeStyles(theme, isMobile);
  const asset = findAsset(tx.kind, tx.assetId, tx.fromSlot);
  if (!asset) return null;

  const fromTeam = teams.find(t => t.slot === tx.fromSlot);
  const fromLabel = fromTeam ? `${tx.fromSlot}: ${fromTeam.name}` : tx.fromSlot;
  const otherTeams = teams.filter(t => t.slot !== tx.fromSlot);
  const brokerOptions = teams.filter(t => t.slot !== tx.fromSlot && t.slot !== tx.toSlot);

  // Native select style (web only)
  const nativeSelectStyle = {
    padding: isMobile ? '10px 8px' : '6px 8px',
    fontSize: isMobile ? 14 : 13,
    backgroundColor: theme.bgInput,
    color: theme.text,
    border: `1px solid ${theme.border}`,
    borderRadius: 4,
    fontFamily: 'inherit',
    cursor: 'pointer',
    minWidth: 160,
  };

  if (tx.kind === 'pick') {
    return (
      <View style={styles.txCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.txAssetName}>
            🎯 {asset.season} R{asset.round} ({asset.original_team_name})
          </Text>
          <View style={styles.txControls}>
            <Text style={styles.txLabel}>From {fromLabel} →</Text>
            {Platform.OS === 'web' ? (
              <select
                value={tx.toSlot}
                onChange={(e) => onUpdate({ toSlot: e.target.value })}
                style={nativeSelectStyle}
              >
                {otherTeams.map(t => (
                  <option key={t.slot} value={t.slot}>{t.slot}: {t.name}</option>
                ))}
              </select>
            ) : (
              <Text style={styles.txDestText}>{tx.toSlot}: {teams.find(t => t.slot === tx.toSlot)?.name}</Text>
            )}
          </View>
        </View>
        <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
          <Text style={styles.removeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Player transaction — full detail including broker support
  const p = asset;
  const maxPerTx = maxRetentionPerTx(p);
  const slotsLeft = retentionSlotsLeft(p);
  const retCount = p.retention_count || 0;
  const alreadyMaxed = retCount >= 2;

  const fromRet = Math.max(0, Math.min(maxPerTx, tx.retentionPct || 0));
  const brokerRet = tx.brokerSlot ? Math.max(0, Math.min(maxPerTx, tx.brokerRetentionPct || 0)) : 0;
  const retainedTotal = p.salary * ((fromRet + brokerRet) / 100);
  const destReceivesAAV = p.salary - retainedTotal;

  // Effective max for each side given the other side's current value
  // Total retention (from + broker) cannot exceed maxPerTx
  const effectiveMaxFrom = Math.max(0, maxPerTx - brokerRet);
  const effectiveMaxBroker = Math.max(0, maxPerTx - fromRet);

  const fromPresets = [0, 15, 25, 50].filter(v => v <= effectiveMaxFrom);
  const brokerPresets = [0, 15, 25, 50].filter(v => v <= effectiveMaxBroker);

  let ruleText;
  if (alreadyMaxed) ruleText = '🚫 Contract already retained 2× — cannot retain further';
  else if (retCount === 1) ruleText = `${p.contract_duration}yr deal · max ${maxPerTx}% total retention · ⚠️ 1 retention already used`;
  else ruleText = `${p.contract_duration}yr deal · max ${maxPerTx}% total retention`;

  return (
    <View style={[styles.txCard, alreadyMaxed && styles.txCardBlocked]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.txAssetName}>
          {p.name} {retCount === 1 && <Text style={{ color: theme.warning, fontSize: 11 }}>· (1 retention used)</Text>}
        </Text>
        <Text style={styles.txAssetMeta}>
          {p.position} · Age {p.age} · {formatMoney(p.salary)} · {p.contract_duration}yr · {p.expiry_type}
        </Text>
        <Text style={[styles.ruleText, retCount === 1 && { color: theme.warning }]}>{ruleText}</Text>

        {/* From → To */}
        <View style={styles.txControls}>
          <Text style={styles.txLabel}>From {fromLabel} →</Text>
          {Platform.OS === 'web' ? (
            <select
              value={tx.toSlot}
              onChange={(e) => {
                const newTo = e.target.value;
                // If broker matches new destination, clear broker
                onUpdate({ toSlot: newTo, ...(tx.brokerSlot === newTo ? { brokerSlot: null, brokerRetentionPct: 0 } : {}) });
              }}
              style={nativeSelectStyle}
            >
              {otherTeams.map(t => (
                <option key={t.slot} value={t.slot}>{t.slot}: {t.name}</option>
              ))}
            </select>
          ) : (
            <Text style={styles.txDestText}>{tx.toSlot}: {teams.find(t => t.slot === tx.toSlot)?.name}</Text>
          )}
        </View>

        {!alreadyMaxed && (
          <>
            {/* From team retention */}
            <View style={styles.retRow}>
              <Text style={styles.retLabel}>{fromLabel} retains:</Text>
              {fromPresets.map(pct => (
                <TouchableOpacity
                  key={pct}
                  style={[styles.retBtn, fromRet === pct && styles.retBtnActive]}
                  onPress={() => onUpdate({ retentionPct: pct })}
                >
                  <Text style={[styles.retBtnText, fromRet === pct && styles.retBtnTextActive]}>
                    {pct}%
                  </Text>
                </TouchableOpacity>
              ))}
              <CustomRetInput value={fromRet} max={effectiveMaxFrom} onChange={(v) => onUpdate({ retentionPct: v })} theme={theme} />
            </View>

            {/* Retention toggle (secondary retaining team, acts as broker) */}
            {brokerOptions.length > 0 && (
              <View style={styles.txControls}>
                <Text style={styles.txLabel}>Retention:</Text>
                {Platform.OS === 'web' ? (
                  <select
                    value={tx.brokerSlot || ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) onUpdate({ brokerSlot: null, brokerRetentionPct: 0 });
                      else onUpdate({ brokerSlot: v });
                    }}
                    style={{ ...nativeSelectStyle, fontStyle: tx.brokerSlot ? 'normal' : 'italic', color: tx.brokerSlot ? theme.text : theme.textMuted }}
                  >
                    <option value="">— no broker —</option>
                    {brokerOptions.map(t => (
                      <option key={t.slot} value={t.slot}>{t.slot}: {t.name}</option>
                    ))}
                  </select>
                ) : (
                  <Text style={styles.txDestText}>{tx.brokerSlot ? `${tx.brokerSlot}: ${teams.find(t => t.slot === tx.brokerSlot)?.name}` : '— no broker —'}</Text>
                )}
              </View>
            )}

            {/* Broker retention */}
            {tx.brokerSlot && (
              <View style={styles.retRow}>
                <Text style={styles.retLabel}>
                  {tx.brokerSlot}: {teams.find(t => t.slot === tx.brokerSlot)?.name} retains:
                </Text>
                {brokerPresets.map(pct => (
                  <TouchableOpacity
                    key={pct}
                    style={[styles.retBtn, brokerRet === pct && styles.retBtnActive]}
                    onPress={() => onUpdate({ brokerRetentionPct: pct })}
                  >
                    <Text style={[styles.retBtnText, brokerRet === pct && styles.retBtnTextActive]}>
                      {pct}%
                    </Text>
                  </TouchableOpacity>
                ))}
                <CustomRetInput value={brokerRet} max={effectiveMaxBroker} onChange={(v) => onUpdate({ brokerRetentionPct: v })} theme={theme} />
              </View>
            )}

            {/* Effect summary */}
            {(fromRet > 0 || brokerRet > 0) && (
              <Text style={styles.retentionNote}>
                Total retained: {formatMoney(retainedTotal)} ({(fromRet + brokerRet).toFixed(0)}%) · {tx.toSlot}: {teams.find(t => t.slot === tx.toSlot)?.name} receives {formatMoney(destReceivesAAV)}
              </Text>
            )}
          </>
        )}
      </View>
      <TouchableOpacity onPress={onRemove} style={styles.removeBtn}>
        <Text style={styles.removeBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

function CustomRetInput({ value, max, onChange, theme }) {
  const styles = makeStyles(theme);
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setLocal(String(value)); }, [value, focused]);
  const commit = () => {
    const n = parseInt(local, 10);
    const clamped = isNaN(n) ? 0 : Math.max(0, Math.min(max, n));
    setLocal(String(clamped));
    onChange(clamped);
  };
  if (Platform.OS === 'web') {
    return (
      <View style={styles.customInputWrap}>
        <Text style={styles.customInputLabel}>Custom:</Text>
        <input
          type="number" min="0" max={max} step="1"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(); }}
          style={{
            width: 50, padding: '3px 6px', fontSize: 11,
            background: theme.bgInput, color: theme.text,
            border: `1px solid ${theme.border}`, borderRadius: 4, fontFamily: 'inherit',
          }}
        />
        <Text style={styles.customInputSuffix}>% (max {max}%)</Text>
      </View>
    );
  }
  return null;
}

// ============================================================================
// ROSTER COLUMN
// ============================================================================

function RosterColumn({ team, transactions, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onTap, dropActive, theme, isMobile, season, playerDatabase, calculateTRUEi }) {
  const styles = makeStyles(theme, isMobile);

  if (team.loading || !team.data) {
    return (
      <View style={styles.rosterCol}>
        <Text style={styles.rosterTeamName}>{team.slot}: {team.name}</Text>
        <View style={styles.center}><ActivityIndicator size="small" color={theme.accent} /></View>
      </View>
    );
  }

  const outgoingIds = new Set(
    transactions
      .filter(tx => tx.fromSlot === team.slot && tx.kind === 'player')
      .map(tx => tx.assetId)
  );
  const outgoingPickIds = new Set(
    transactions
      .filter(tx => tx.fromSlot === team.slot && tx.kind === 'pick')
      .map(tx => tx.assetId)
  );

  const d = team.data;
  // Hide players who've expired AND are UFA (they walk, rights aren't tradeable).
  // Keep RFA expirees — their negotiating rights transfer with the player.
  // Also keep anyone with remaining contract term.
  const canBeTraded = x => {
    if ((x.contract_duration || 0) > 0) return true;            // Still under contract
    if (x.expiry_type === 'RFA') return true;                   // Rights tradeable
    return false;                                               // UFA expired = walks free
  };
  const isSignedNHL = x => x.status === 'NHL' && x.contract_type === 'signed' && canBeTraded(x);
  const forwards = d.players.filter(p => isSignedNHL(p) && /^(C|LW|RW)/.test(p.position)).sort((a, b) => b.salary - a.salary);
  const defense = d.players.filter(p => isSignedNHL(p) && /^(LD|RD)/.test(p.position)).sort((a, b) => b.salary - a.salary);
  const goalies = d.players.filter(p => isSignedNHL(p) && /^G/.test(p.position)).sort((a, b) => b.salary - a.salary);
  // Prospects: same rule — signed with term OR RFA rights
  const prospects = d.players.filter(p => p.status === 'Minors' && p.contract_type === 'signed' && canBeTraded(p));

  // Web desktop drop wrapper
  const HeaderWrap = (Platform.OS === 'web' && !isMobile) ? 'div' : View;
  const headerProps = (Platform.OS === 'web' && !isMobile)
    ? { onDragOver, onDragLeave, onDrop, style: { padding: 8, borderRadius: 6, border: dropActive ? `2px dashed ${theme.accent}` : `2px dashed transparent`, marginBottom: 8 } }
    : { style: { padding: 8, marginBottom: 8 } };

  return (
    <View style={styles.rosterCol}>
      <HeaderWrap {...headerProps}>
        <Text style={styles.rosterTeamName}>{team.slot}: {d.name}</Text>
        <Text style={styles.rosterCapLine}>
          {formatMoney(d.capHit)} used · {formatMoney(d.capSpace)} space
        </Text>
        {!isMobile && <Text style={styles.dropHint}>Drop players/picks here</Text>}
      </HeaderWrap>

      <RosterGroup title="Forwards" players={forwards} outgoingSet={outgoingIds}
        onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} slot={team.slot}
        theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} />
      <RosterGroup title="Defense" players={defense} outgoingSet={outgoingIds}
        onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} slot={team.slot}
        theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} />
      <RosterGroup title="Goalies" players={goalies} outgoingSet={outgoingIds}
        onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} slot={team.slot}
        theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} />
      {prospects.length > 0 && (
        <RosterGroup title={`Prospects (${prospects.length})`} players={prospects} outgoingSet={outgoingIds}
          onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} slot={team.slot}
          theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} collapsed />
      )}
      {d.draftPicks && d.draftPicks.length > 0 && (
        <PickGroup picks={d.draftPicks} outgoingSet={outgoingPickIds}
          onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} slot={team.slot}
          theme={theme} isMobile={isMobile} />
      )}
    </View>
  );
}

function RosterGroup({ title, players, outgoingSet, onDragStart, onDragEnd, onTap, slot, theme, season, playerDatabase, calculateTRUEi, isMobile, collapsed = false }) {
  const [open, setOpen] = useState(!collapsed);
  const styles = makeStyles(theme, isMobile);
  if (!players.length) return null;
  return (
    <View style={styles.groupCard}>
      <TouchableOpacity onPress={() => setOpen(!open)}>
        <Text style={styles.groupTitle}>{open ? '▼' : '▶'} {title}</Text>
      </TouchableOpacity>
      {open && players.map(p => (
        <PlayerRow
          key={p.id}
          player={p}
          isOutgoing={outgoingSet.has(p.id)}
          onDragStart={onDragStart('player', p.id, slot)}
          onDragEnd={onDragEnd}
          onTap={() => onTap('player', p.id, slot)}
          theme={theme}
          truei={findPlayerTRUEi(p.name, season, playerDatabase, calculateTRUEi)}
          isMobile={isMobile}
        />
      ))}
    </View>
  );
}

function PickGroup({ picks, outgoingSet, onDragStart, onDragEnd, onTap, slot, theme, isMobile }) {
  const [open, setOpen] = useState(true);
  const styles = makeStyles(theme, isMobile);
  return (
    <View style={styles.groupCard}>
      <TouchableOpacity onPress={() => setOpen(!open)}>
        <Text style={styles.groupTitle}>{open ? '▼' : '▶'} Draft Picks ({picks.length})</Text>
      </TouchableOpacity>
      {open && picks.map(pk => (
        <PickRow
          key={pk.id}
          pick={pk}
          isOutgoing={outgoingSet.has(pk.id)}
          onDragStart={onDragStart('pick', pk.id, slot)}
          onDragEnd={onDragEnd}
          onTap={() => onTap('pick', pk.id, slot)}
          theme={theme}
          isMobile={isMobile}
        />
      ))}
    </View>
  );
}

function PlayerRow({ player, isOutgoing, onDragStart, onDragEnd, onTap, theme, truei, isMobile }) {
  const styles = makeStyles(theme, isMobile);
  if (isMobile) {
    return (
      <TouchableOpacity
        style={[styles.row, styles.rowMobile, isOutgoing && { opacity: 0.35 }]}
        onPress={onTap}
        disabled={isOutgoing}
      >
        <Text style={[styles.rowName, { flex: 2 }]} numberOfLines={1}>
          {isOutgoing ? '✓ ' : '+ '}{player.name}
        </Text>
        <Text style={[styles.rowMeta, { flex: 0.6 }]}>{player.position}</Text>
        <Text style={[styles.rowMeta, { flex: 0.4 }]}>{player.age}</Text>
        <Text style={[styles.rowMeta, { flex: 0.9 }]}>{formatMoney(player.salary)}</Text>
        <Text style={[styles.rowMeta, { flex: 0.5, color: player.expiry_type === 'UFA' ? theme.warning : theme.textSecondary }]}>{player.expiry_type}</Text>
        <Text style={[styles.rowMeta, { flex: 0.6 }]}>{truei !== null ? truei.toFixed(1) : '—'}</Text>
      </TouchableOpacity>
    );
  }
  if (Platform.OS === 'web') {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={{
          cursor: 'grab', opacity: isOutgoing ? 0.35 : 1, padding: 6,
          borderBottomWidth: 1, borderBottomColor: theme.borderLight, borderBottomStyle: 'solid',
          display: 'flex', flexDirection: 'row', alignItems: 'center',
        }}
      >
        <Text style={[styles.rowName, { flex: 2 }]} numberOfLines={1}>{isOutgoing && '→ '}{player.name}</Text>
        <Text style={[styles.rowMeta, { flex: 0.6 }]}>{player.position}</Text>
        <Text style={[styles.rowMeta, { flex: 0.4 }]}>{player.age}</Text>
        <Text style={[styles.rowMeta, { flex: 0.9 }]}>{formatMoney(player.salary)}</Text>
        <Text style={[styles.rowMeta, { flex: 0.5, color: player.expiry_type === 'UFA' ? theme.warning : theme.textSecondary }]}>{player.expiry_type}</Text>
        <Text style={[styles.rowMeta, { flex: 0.6 }]}>{truei !== null ? truei.toFixed(1) : '—'}</Text>
      </div>
    );
  }
  return null;
}

function PickRow({ pick, isOutgoing, onDragStart, onDragEnd, onTap, theme, isMobile }) {
  const styles = makeStyles(theme, isMobile);
  if (isMobile) {
    return (
      <TouchableOpacity
        style={[styles.row, styles.rowMobile, isOutgoing && { opacity: 0.35 }]}
        onPress={onTap}
        disabled={isOutgoing}
      >
        <Text style={styles.rowName}>{isOutgoing ? '✓ ' : '+ '}{pick.season} R{pick.round} · {pick.original_team_name}</Text>
      </TouchableOpacity>
    );
  }
  if (Platform.OS === 'web') {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={{
          cursor: 'grab', opacity: isOutgoing ? 0.35 : 1, padding: 6,
          borderBottomWidth: 1, borderBottomColor: theme.borderLight, borderBottomStyle: 'solid',
        }}
      >
        <Text style={styles.rowName}>{isOutgoing && '→ '}{pick.season} · R{pick.round} · {pick.original_team_name}</Text>
      </div>
    );
  }
  return null;
}

// ============================================================================
// STYLES
// ============================================================================

function makeStyles(theme, isMobile = false) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg, padding: 8 },
    stackedColumn: { flexDirection: 'column' },

    teamBar: { marginBottom: 10, zIndex: 200, position: 'relative' },
    teamBarLabel: { color: theme.textSecondary, fontSize: 11, textTransform: 'uppercase', marginBottom: 6 },
    teamBarRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
    teamSelectorWrap: { position: 'relative', marginRight: 6, marginBottom: 6 },
    teamSelectorBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.bgInput, borderRadius: 6, borderWidth: 1, borderColor: theme.border },
    teamSelectorText: { color: theme.text, fontWeight: '600', fontSize: 13 },
    removeTeamBtn: { position: 'absolute', right: -6, top: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' },
    removeTeamText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
    teamPickerDropdown: { position: 'absolute', top: 42, left: 0, minWidth: 180, backgroundColor: theme.bgCard, borderRadius: 6, borderWidth: 1, borderColor: theme.border, zIndex: 1000, shadowColor: theme.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
    dropdownItem: { padding: isMobile ? 14 : 10, borderBottomWidth: 1, borderBottomColor: theme.borderLight },
    dropdownItemActive: { backgroundColor: theme.bgSelected },
    dropdownText: { color: theme.text },
    addTeamBtn: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.accent, borderRadius: 6, marginBottom: 6 },
    addTeamText: { color: '#fff', fontWeight: '600', fontSize: 13 },

    mathCard: { backgroundColor: theme.bgCard, borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border },
    mathRow: { flexDirection: 'row' },
    mathCol: { flex: 1, paddingHorizontal: 8, marginBottom: isMobile ? 12 : 0, minWidth: isMobile ? '100%' : 140 },
    mathTeam: { color: theme.text, fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
    mathLabel: { color: theme.textMuted, fontSize: 10, textTransform: 'uppercase', marginTop: 4 },
    mathValue: { color: theme.text, fontSize: 13, fontWeight: '600' },
    clearBtn: { marginTop: 0, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: theme.danger, borderRadius: 6, alignItems: 'center' },
    clearBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

    actionRow: { flexDirection: 'row', marginTop: 12, alignItems: 'center' },
    submitBtn: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 16,
      backgroundColor: theme.accent || '#4caf50',
      borderRadius: 6,
      alignItems: 'center',
      marginRight: 8,
    },
    submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    copiedBanner: {
      marginTop: 8,
      padding: 10,
      backgroundColor: (theme.accent || '#4caf50') + '22',
      borderLeftWidth: 4,
      borderLeftColor: theme.accent || '#4caf50',
      borderRadius: 4,
    },
    copiedText: { color: theme.text, fontSize: 13, fontWeight: '600', textAlign: 'center' },

    warningCard: { backgroundColor: theme.warning + '22', borderLeftWidth: 4, borderLeftColor: theme.warning, padding: 10, borderRadius: 6, marginBottom: 10 },
    warningText: { color: theme.text, fontSize: 12 },

    txListCard: { backgroundColor: theme.bgCard, borderRadius: 8, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: theme.border, position: 'relative', zIndex: 100 },
    sectionTitle: { color: theme.text, fontSize: 15, fontWeight: 'bold', marginBottom: 8 },
    txCard: { flexDirection: 'row', padding: 10, backgroundColor: theme.bgAlt, borderRadius: 6, marginBottom: 8, alignItems: 'flex-start', position: 'relative', zIndex: 1 },
    txCardBlocked: { backgroundColor: theme.danger + '22', borderLeftWidth: 3, borderLeftColor: theme.danger },
    txAssetName: { color: theme.text, fontWeight: '600', fontSize: 13 },
    txAssetMeta: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
    ruleText: { color: theme.textSecondary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
    txControls: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap', position: 'relative', zIndex: 50 },
    txLabel: { color: theme.textMuted, fontSize: 11, marginRight: 6 },
    txDestBtn: { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: theme.bg, borderRadius: 4, borderWidth: 1, borderColor: theme.border },
    txDestText: { color: theme.text, fontSize: 12 },
    txDestDropdown: {
      position: 'absolute',
      top: 34,
      left: 0,
      right: isMobile ? 0 : undefined,
      minWidth: 220,
      backgroundColor: theme.bgCard,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.border,
      zIndex: 10000,
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 10,
    },

    retRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' },
    retLabel: { color: theme.textMuted, fontSize: 11, marginRight: 6 },
    retBtn: { paddingHorizontal: 10, paddingVertical: isMobile ? 6 : 3, backgroundColor: theme.bg, borderRadius: 4, marginRight: 4, marginBottom: 2, borderWidth: 1, borderColor: theme.border },
    retBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    retBtnText: { color: theme.text, fontSize: 11, fontWeight: '600' },
    retBtnTextActive: { color: '#fff' },
    retentionNote: { color: theme.accent, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
    customInputWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: 4, marginBottom: 2 },
    customInputLabel: { color: theme.textMuted, fontSize: 11, marginRight: 4 },
    customInputSuffix: { color: theme.textMuted, fontSize: 10, marginLeft: 4 },
    removeBtn: { padding: 6, marginLeft: 8 },
    removeBtnText: { color: theme.danger, fontSize: 18, fontWeight: 'bold' },

    mobileTabs: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
    mobileTab: { paddingVertical: 8, paddingHorizontal: 12, backgroundColor: theme.bgCard, borderRadius: 6, marginRight: 4, marginBottom: 4, borderWidth: 1, borderColor: theme.border },
    mobileTabActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    mobileTabText: { color: theme.text, fontSize: 12, fontWeight: '600' },
    mobileTabTextActive: { color: '#fff' },

    rosterRow: { flexDirection: 'row', flexWrap: 'wrap' },
    rosterCol: { flex: 1, minWidth: isMobile ? '100%' : 220, marginHorizontal: 4, marginBottom: isMobile ? 12 : 0 },
    rosterTeamName: { color: theme.text, fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
    rosterCapLine: { color: theme.textSecondary, fontSize: 11, marginBottom: 4 },
    dropHint: { color: theme.textMuted, fontSize: 10, fontStyle: 'italic' },

    groupCard: { backgroundColor: theme.bgCard, borderRadius: 6, padding: 8, marginBottom: 6, borderWidth: 1, borderColor: theme.border },
    groupTitle: { color: theme.text, fontWeight: 'bold', marginBottom: 6, fontSize: 13 },
    row: { flexDirection: 'row', padding: 6, alignItems: 'center' },
    rowMobile: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.borderLight },
    rowName: { color: theme.text, fontSize: 12 },
    rowMeta: { color: theme.textSecondary, fontSize: 11 },

    center: { padding: 20, alignItems: 'center' },
    helpCard: { backgroundColor: theme.bgAlt, padding: 10, borderRadius: 6, marginTop: 10, marginBottom: 20 },
    helpText: { color: theme.textSecondary, fontSize: 12, lineHeight: 18 },
  });
}
