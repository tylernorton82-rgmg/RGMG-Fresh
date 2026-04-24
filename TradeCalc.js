import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

const MOBILE_BREAKPOINT = 768;

const CAP_MAX_DEFAULT = 75;
const CONTRACT_LIMIT = 50;

function formatMoney(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  return `$${Number(n).toFixed(2)}M`;
}

function signedMoney(n) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const num = Number(n);
  const sign = num > 0 ? '+' : '';
  return `${sign}$${num.toFixed(2)}M`;
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

// RGMG retention rules:
//   - 1-year deal: max 50%
//   - 2-year deal: max 25%
//   - 3+ year deal: max 15%
//   - retention_count === 2 means contract was already retained twice, cannot retain further
// Returns the max retention % allowed for this player/contract.
function getMaxRetention(player) {
  if (!player) return 0;
  if ((player.retention_count || 0) >= 2) return 0; // slots maxed
  const yrs = player.contract_duration || 0;
  if (yrs <= 0) return 0; // no contract, can't retain
  if (yrs === 1) return 50;
  if (yrs === 2) return 25;
  return 15;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TradeCalc({ theme, seasons, playerDatabase, calculateTRUEi }) {
  const [teamAName, setTeamAName] = useState('Jets');
  const [teamBName, setTeamBName] = useState('Maple Leafs');
  const [teamAData, setTeamAData] = useState(null);
  const [teamBData, setTeamBData] = useState(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [showPickerA, setShowPickerA] = useState(false);
  const [showPickerB, setShowPickerB] = useState(false);

  // Trade state: arrays of player/pick IDs being moved
  const [outgoingA, setOutgoingA] = useState([]); // [{kind:'player'|'pick', id}]
  const [outgoingB, setOutgoingB] = useState([]);
  const [retention, setRetention] = useState({}); // { [playerId]: 0 | 25 | 50 }

  // Drag-drop tracking
  const [draggedItem, setDraggedItem] = useState(null); // { kind, id, fromTeam }
  const [dropZoneActive, setDropZoneActive] = useState(null); // 'A' | 'B' | null

  const latestSeason = seasons && seasons.length ? seasons[seasons.length - 1] : null;
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const styles = makeStyles(theme, isMobile);

  // Direct add — used on mobile where drag-and-drop doesn't work
  const addToBasket = (kind, id, fromTeam) => {
    const setter = fromTeam === 'A' ? setOutgoingA : setOutgoingB;
    setter(prev => {
      if (prev.some(x => x.kind === kind && x.id === id)) return prev;
      return [...prev, { kind, id }];
    });
  };

  // Fetch team A
  useEffect(() => {
    if (!teamAName) return;
    let cancelled = false;
    (async () => {
      setLoadingA(true);
      try {
        const res = await fetch(`/api/team?name=${encodeURIComponent(teamAName)}`);
        const data = await res.json();
        if (!cancelled) setTeamAData(data);
      } catch (e) {
        console.error('Team A load error', e);
      } finally {
        if (!cancelled) setLoadingA(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamAName]);

  // Fetch team B
  useEffect(() => {
    if (!teamBName) return;
    let cancelled = false;
    (async () => {
      setLoadingB(true);
      try {
        const res = await fetch(`/api/team?name=${encodeURIComponent(teamBName)}`);
        const data = await res.json();
        if (!cancelled) setTeamBData(data);
      } catch (e) {
        console.error('Team B load error', e);
      } finally {
        if (!cancelled) setLoadingB(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamBName]);

  // Reset trade when either team changes
  useEffect(() => {
    setOutgoingA([]);
    setOutgoingB([]);
    setRetention({});
  }, [teamAName, teamBName]);

  // ----- Cap math -----
  const capMath = useMemo(() => {
    if (!teamAData || !teamBData) return null;

    const playerFromId = (data, id) => data.players.find(p => p.id === id);
    const pickFromId = (data, id) => data.draftPicks?.find(pk => pk.id === id);

    // Get the retention % for this player, but clamped to what's actually legal
    const legalRetention = (player, id) => {
      const max = getMaxRetention(player);
      const requested = retention[id] || 0;
      return Math.max(0, Math.min(max, requested));
    };

    // What each team is sending away (negative cap impact)
    const aOutAAV = outgoingA
      .filter(it => it.kind === 'player')
      .reduce((sum, it) => {
        const p = playerFromId(teamAData, it.id);
        if (!p) return sum;
        const ret = legalRetention(p, it.id);
        const retainedPortion = p.salary * (ret / 100);
        return sum + (p.salary - retainedPortion);
      }, 0);

    const aRetainedFromTrade = outgoingA
      .filter(it => it.kind === 'player')
      .reduce((sum, it) => {
        const p = playerFromId(teamAData, it.id);
        if (!p) return sum;
        const ret = legalRetention(p, it.id);
        return sum + p.salary * (ret / 100);
      }, 0);

    const bOutAAV = outgoingB
      .filter(it => it.kind === 'player')
      .reduce((sum, it) => {
        const p = playerFromId(teamBData, it.id);
        if (!p) return sum;
        const ret = legalRetention(p, it.id);
        const retainedPortion = p.salary * (ret / 100);
        return sum + (p.salary - retainedPortion);
      }, 0);

    const bRetainedFromTrade = outgoingB
      .filter(it => it.kind === 'player')
      .reduce((sum, it) => {
        const p = playerFromId(teamBData, it.id);
        if (!p) return sum;
        const ret = legalRetention(p, it.id);
        return sum + p.salary * (ret / 100);
      }, 0);

    const aIncomingAAV = bOutAAV;
    const bIncomingAAV = aOutAAV;

    const aNet = aIncomingAAV - aOutAAV;
    const bNet = bIncomingAAV - bOutAAV;

    const aCapMax = teamAData.capHit + teamAData.capSpace;
    const bCapMax = teamBData.capHit + teamBData.capSpace;

    const aProjCap = teamAData.capHit + aNet;
    const bProjCap = teamBData.capHit + bNet;

    const aProjSpace = aCapMax - aProjCap;
    const bProjSpace = bCapMax - bProjCap;

    // Contract count changes
    const aOutgoingPlayerCount = outgoingA.filter(it => it.kind === 'player').length;
    const bOutgoingPlayerCount = outgoingB.filter(it => it.kind === 'player').length;
    const aNewContractCount = teamAData.contractCount - aOutgoingPlayerCount + bOutgoingPlayerCount;
    const bNewContractCount = teamBData.contractCount - bOutgoingPlayerCount + aOutgoingPlayerCount;

    // TRUEi deltas (season match to latest)
    const sumTruei = (items, teamData) =>
      items.filter(it => it.kind === 'player').reduce((sum, it) => {
        const p = playerFromId(teamData, it.id);
        if (!p) return sum;
        const truei = findPlayerTRUEi(p.name, latestSeason, playerDatabase, calculateTRUEi);
        return sum + (truei || 0);
      }, 0);

    const aOutgoingTruei = sumTruei(outgoingA, teamAData);
    const bOutgoingTruei = sumTruei(outgoingB, teamBData);
    const aTrueiDelta = bOutgoingTruei - aOutgoingTruei;
    const bTrueiDelta = aOutgoingTruei - bOutgoingTruei;

    return {
      aNet, bNet,
      aCapMax, bCapMax,
      aProjCap, bProjCap,
      aProjSpace, bProjSpace,
      aNewContractCount, bNewContractCount,
      aFits: aProjCap <= aCapMax && aNewContractCount <= CONTRACT_LIMIT,
      bFits: bProjCap <= bCapMax && bNewContractCount <= CONTRACT_LIMIT,
      aTrueiDelta, bTrueiDelta,
      aOutgoingTruei, bOutgoingTruei,
    };
  }, [teamAData, teamBData, outgoingA, outgoingB, retention, playerDatabase, calculateTRUEi, latestSeason]);

  // ----- Drag handlers -----
  const handleDragStart = (kind, id, fromTeam) => (e) => {
    setDraggedItem({ kind, id, fromTeam });
    if (e.nativeEvent?.dataTransfer) {
      e.nativeEvent.dataTransfer.effectAllowed = 'move';
    } else if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDropZoneActive(null);
  };

  const handleDragOver = (zone) => (e) => {
    e.preventDefault?.();
    if (e.nativeEvent?.preventDefault) e.nativeEvent.preventDefault();
    setDropZoneActive(zone);
  };

  const handleDragLeave = () => setDropZoneActive(null);

  const handleDrop = (targetZone) => (e) => {
    e.preventDefault?.();
    if (!draggedItem) return;
    // Only accept drops from the OPPOSITE team's roster
    // (dragging Jets player onto Jets basket doesn't make sense)
    // Actually: dragging a Jets player means "Jets send this", so drop it in A's basket if from A
    if (draggedItem.fromTeam === targetZone) {
      const adder = targetZone === 'A' ? setOutgoingA : setOutgoingB;
      adder(prev => {
        if (prev.some(x => x.kind === draggedItem.kind && x.id === draggedItem.id)) return prev;
        return [...prev, { kind: draggedItem.kind, id: draggedItem.id }];
      });
    }
    setDraggedItem(null);
    setDropZoneActive(null);
  };

  // ----- Remove from basket -----
  const removeFromBasket = (team, kind, id) => {
    const setter = team === 'A' ? setOutgoingA : setOutgoingB;
    setter(prev => prev.filter(x => !(x.kind === kind && x.id === id)));
    // Clear retention if player
    if (kind === 'player') {
      setRetention(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
    }
  };

  const setPlayerRetention = (id, pct, player) => {
    // Clamp to contract's allowed max
    const max = getMaxRetention(player);
    const clamped = Math.max(0, Math.min(max, Number(pct) || 0));
    setRetention(prev => ({ ...prev, [id]: clamped }));
  };

  // ----- Clear all -----
  const clearTrade = () => {
    setOutgoingA([]);
    setOutgoingB([]);
    setRetention({});
  };

  return (
    <ScrollView style={styles.container}>
      {/* Team selectors */}
      <View style={styles.selectorRow}>
        <View style={styles.selectorCol}>
          <Text style={styles.selectorLabel}>Team A</Text>
          <TouchableOpacity
            style={styles.selector}
            onPress={() => { setShowPickerA(!showPickerA); setShowPickerB(false); }}
          >
            <Text style={styles.selectorText}>{teamAName} ▼</Text>
          </TouchableOpacity>
          {showPickerA && (
            <View style={styles.dropdownAbsolute}>
              <ScrollView style={{ maxHeight: 280 }}>
                {NHL_TEAMS.filter(t => t !== teamBName).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.dropdownItem, t === teamAName && styles.dropdownItemActive]}
                    onPress={() => { setTeamAName(t); setShowPickerA(false); }}
                  >
                    <Text style={styles.dropdownText}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>

        <View style={styles.vsBox}>
          <Text style={styles.vsText}>VS</Text>
        </View>

        <View style={styles.selectorCol}>
          <Text style={styles.selectorLabel}>Team B</Text>
          <TouchableOpacity
            style={styles.selector}
            onPress={() => { setShowPickerB(!showPickerB); setShowPickerA(false); }}
          >
            <Text style={styles.selectorText}>{teamBName} ▼</Text>
          </TouchableOpacity>
          {showPickerB && (
            <View style={styles.dropdownAbsolute}>
              <ScrollView style={{ maxHeight: 280 }}>
                {NHL_TEAMS.filter(t => t !== teamAName).map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.dropdownItem, t === teamBName && styles.dropdownItemActive]}
                    onPress={() => { setTeamBName(t); setShowPickerB(false); }}
                  >
                    <Text style={styles.dropdownText}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </View>

      {/* Cap math summary */}
      {capMath && (
        <View style={styles.mathCard}>
          <View style={styles.mathRow}>
            <View style={styles.mathCol}>
              <Text style={styles.mathTeam}>{teamAName}</Text>
              <Text style={styles.mathLabel}>Current Cap</Text>
              <Text style={styles.mathValue}>{formatMoney(teamAData.capHit)} / {formatMoney(capMath.aCapMax)}</Text>
              <Text style={styles.mathLabel}>After Trade</Text>
              <Text style={[styles.mathValue, { color: capMath.aFits ? theme.accent : theme.danger }]}>
                {formatMoney(capMath.aProjCap)} ({capMath.aFits ? '✓' : '✗'} fits)
              </Text>
              <Text style={styles.mathLabel}>Cap Change</Text>
              <Text style={[styles.mathValue, { color: capMath.aNet > 0 ? theme.danger : theme.accent }]}>
                {signedMoney(capMath.aNet)}
              </Text>
              <Text style={styles.mathLabel}>Contracts</Text>
              <Text style={[styles.mathValue, { color: capMath.aNewContractCount > CONTRACT_LIMIT ? theme.danger : theme.text }]}>
                {teamAData.contractCount} → {capMath.aNewContractCount} / {CONTRACT_LIMIT}
              </Text>
              <Text style={styles.mathLabel}>TRUEi Gained</Text>
              <Text style={[styles.mathValue, { color: capMath.aTrueiDelta >= 0 ? theme.accent : theme.danger }]}>
                {capMath.aTrueiDelta >= 0 ? '+' : ''}{capMath.aTrueiDelta.toFixed(1)}
              </Text>
            </View>

            <View style={styles.mathCol}>
              <Text style={styles.mathTeam}>{teamBName}</Text>
              <Text style={styles.mathLabel}>Current Cap</Text>
              <Text style={styles.mathValue}>{formatMoney(teamBData.capHit)} / {formatMoney(capMath.bCapMax)}</Text>
              <Text style={styles.mathLabel}>After Trade</Text>
              <Text style={[styles.mathValue, { color: capMath.bFits ? theme.accent : theme.danger }]}>
                {formatMoney(capMath.bProjCap)} ({capMath.bFits ? '✓' : '✗'} fits)
              </Text>
              <Text style={styles.mathLabel}>Cap Change</Text>
              <Text style={[styles.mathValue, { color: capMath.bNet > 0 ? theme.danger : theme.accent }]}>
                {signedMoney(capMath.bNet)}
              </Text>
              <Text style={styles.mathLabel}>Contracts</Text>
              <Text style={[styles.mathValue, { color: capMath.bNewContractCount > CONTRACT_LIMIT ? theme.danger : theme.text }]}>
                {teamBData.contractCount} → {capMath.bNewContractCount} / {CONTRACT_LIMIT}
              </Text>
              <Text style={styles.mathLabel}>TRUEi Gained</Text>
              <Text style={[styles.mathValue, { color: capMath.bTrueiDelta >= 0 ? theme.accent : theme.danger }]}>
                {capMath.bTrueiDelta >= 0 ? '+' : ''}{capMath.bTrueiDelta.toFixed(1)}
              </Text>
            </View>
          </View>

          {(outgoingA.length > 0 || outgoingB.length > 0) && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearTrade}>
              <Text style={styles.clearBtnText}>Clear Trade</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Trade baskets */}
      <View style={[styles.basketsRow, isMobile && styles.stackedColumn]}>
        <TradeBasket
          team="A"
          teamName={teamAName}
          items={outgoingA}
          teamData={teamAData}
          retention={retention}
          onRemove={(kind, id) => removeFromBasket('A', kind, id)}
          onRetention={setPlayerRetention}
          onDrop={handleDrop('A')}
          onDragOver={handleDragOver('A')}
          onDragLeave={handleDragLeave}
          active={dropZoneActive === 'A'}
          theme={theme}
          label="Sends"
          isMobile={isMobile}
        />
        <TradeBasket
          team="B"
          teamName={teamBName}
          items={outgoingB}
          teamData={teamBData}
          retention={retention}
          onRemove={(kind, id) => removeFromBasket('B', kind, id)}
          onRetention={setPlayerRetention}
          onDrop={handleDrop('B')}
          onDragOver={handleDragOver('B')}
          onDragLeave={handleDragLeave}
          active={dropZoneActive === 'B'}
          theme={theme}
          label="Sends"
          isMobile={isMobile}
        />
      </View>

      {/* Rosters side by side (stacked on mobile) */}
      <View style={[styles.rosterRow, isMobile && styles.stackedColumn]}>
        <RosterColumn
          teamData={teamAData}
          loading={loadingA}
          outgoingIds={outgoingA}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onTap={addToBasket}
          team="A"
          theme={theme}
          season={latestSeason}
          playerDatabase={playerDatabase}
          calculateTRUEi={calculateTRUEi}
          isMobile={isMobile}
        />
        <RosterColumn
          teamData={teamBData}
          loading={loadingB}
          outgoingIds={outgoingB}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onTap={addToBasket}
          team="B"
          theme={theme}
          season={latestSeason}
          playerDatabase={playerDatabase}
          calculateTRUEi={calculateTRUEi}
          isMobile={isMobile}
        />
      </View>

      {/* Help text */}
      <View style={styles.helpCard}>
        <Text style={styles.helpText}>
          {isMobile
            ? '💡 Tap any player or draft pick in a roster to add it to that team\'s "Sends" basket above. Use the retention controls in the basket to adjust salary retention. Cap math updates live.'
            : '💡 Drag any player or draft pick from the roster up to that team\'s "Sends" basket above. Once in the basket, adjust retention with the 0 / 15 / 25 / 50 buttons or type a custom %. The cap math updates live as you build the trade.'}
        </Text>
      </View>
    </ScrollView>
  );
}

// ============================================================================
// TRADE BASKET (drop zone + outgoing list)
// ============================================================================

function TradeBasket({ team, teamName, items, teamData, retention, onRemove, onRetention, onDrop, onDragOver, onDragLeave, active, theme, label, isMobile }) {
  const styles = makeStyles(theme, isMobile);

  // On mobile, skip the HTML div drop-zone wrapper entirely
  if (isMobile) {
    return (
      <View style={[styles.basket, styles.basketMobile, items.length === 0 && styles.basketEmpty]}>
        <Text style={styles.basketTitle}>
          {teamName} {label} ({items.length})
        </Text>
        {items.length === 0 ? (
          <Text style={styles.basketHint}>Tap players below to add</Text>
        ) : (
          items.map(item => (
            <BasketItem
              key={`${item.kind}-${item.id}`}
              item={item}
              teamData={teamData}
              retention={retention}
              onRemove={onRemove}
              onRetention={onRetention}
              theme={theme}
              isMobile={isMobile}
            />
          ))
        )}
      </View>
    );
  }

  // Desktop: HTML drop zone
  const DropWrapper = Platform.OS === 'web' ? 'div' : View;
  const wrapperProps = Platform.OS === 'web'
    ? {
        onDragOver,
        onDrop,
        onDragLeave,
        style: {
          flex: 1,
          marginHorizontal: 4,
          minHeight: 120,
        },
      }
    : { style: { flex: 1, marginHorizontal: 4, minHeight: 120 } };

  return (
    <DropWrapper {...wrapperProps}>
      <View style={[styles.basket, active && styles.basketActive, items.length === 0 && styles.basketEmpty]}>
        <Text style={styles.basketTitle}>
          {teamName} {label} ({items.length})
        </Text>
        {items.length === 0 ? (
          <Text style={styles.basketHint}>Drag players/picks here</Text>
        ) : (
          items.map(item => (
            <BasketItem
              key={`${item.kind}-${item.id}`}
              item={item}
              teamData={teamData}
              retention={retention}
              onRemove={onRemove}
              onRetention={onRetention}
              theme={theme}
              isMobile={isMobile}
            />
          ))
        )}
      </View>
    </DropWrapper>
  );
}

function BasketItem({ item, teamData, retention, onRemove, onRetention, theme, isMobile }) {
  const styles = makeStyles(theme, isMobile);

  if (item.kind === 'player') {
    const p = teamData?.players.find(x => x.id === item.id);
    if (!p) return null;

    const ret = retention[item.id] || 0;
    const effectiveAAV = p.salary * (1 - ret / 100);
    const maxRet = getMaxRetention(p);
    const retCount = p.retention_count || 0;
    const slotsLeft = Math.max(0, 2 - retCount);
    const alreadyMaxed = retCount >= 2;

    // Preset buttons filtered to only show options within max
    const allPresets = [0, 15, 25, 50];
    const validPresets = allPresets.filter(v => v <= maxRet);

    // Rule text based on contract
    let ruleText;
    if (alreadyMaxed) {
      ruleText = '🚫 CANNOT RETAIN (2/2 slots used)';
    } else if (p.contract_duration === 1) {
      ruleText = `1yr deal · max 50% · ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} left`;
    } else if (p.contract_duration === 2) {
      ruleText = `2yr deal · max 25% · ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} left`;
    } else if (p.contract_duration >= 3) {
      ruleText = `${p.contract_duration}yr deal · max 15% · ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} left`;
    } else {
      ruleText = 'No active contract';
    }

    return (
      <View style={[styles.basketItem, alreadyMaxed && styles.basketItemBlocked]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.basketItemName}>
            {p.name} {retCount === 1 && <Text style={{ color: theme.warning, fontSize: 11 }}>· (1 retention already)</Text>}
          </Text>
          <Text style={styles.basketItemMeta}>
            {p.position} · Age {p.age} · {formatMoney(p.salary)} · {p.contract_duration}yr · {p.expiry_type}
          </Text>

          {!alreadyMaxed && (
            <>
              <Text style={[styles.ruleText, retCount === 1 && { color: theme.warning }]}>
                {ruleText}
              </Text>

              {ret > 0 && (
                <Text style={styles.retentionNote}>
                  Retain {ret}% · effective {formatMoney(effectiveAAV)} to acquiring team · {formatMoney(p.salary - effectiveAAV)} stays on sending team's cap
                </Text>
              )}

              <View style={styles.retentionRow}>
                <Text style={styles.retentionLabel}>Retain:</Text>
                {validPresets.map(pct => (
                  <TouchableOpacity
                    key={pct}
                    style={[styles.retentionBtn, ret === pct && styles.retentionBtnActive]}
                    onPress={() => onRetention(item.id, pct, p)}
                  >
                    <Text style={[styles.retentionBtnText, ret === pct && styles.retentionBtnTextActive]}>
                      {pct}%
                    </Text>
                  </TouchableOpacity>
                ))}
                <CustomRetentionInput
                  currentValue={ret}
                  max={maxRet}
                  onChange={(v) => onRetention(item.id, v, p)}
                  theme={theme}
                />
              </View>
            </>
          )}

          {alreadyMaxed && (
            <Text style={[styles.ruleText, { color: theme.danger, fontWeight: 'bold' }]}>
              {ruleText}
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={() => onRemove('player', item.id)} style={styles.removeBtn}>
          <Text style={styles.removeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Pick
  const pick = teamData?.draftPicks?.find(x => x.id === item.id);
  if (!pick) return null;
  return (
    <View style={styles.basketItem}>
      <View style={{ flex: 1 }}>
        <Text style={styles.basketItemName}>
          {pick.season} · Round {pick.round}
        </Text>
        <Text style={styles.basketItemMeta}>Original: {pick.original_team_name}</Text>
      </View>
      <TouchableOpacity onPress={() => onRemove('pick', item.id)} style={styles.removeBtn}>
        <Text style={styles.removeBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// Custom percentage input — auto-clamps to max, allows any whole number in range
function CustomRetentionInput({ currentValue, max, onChange, theme }) {
  const styles = makeStyles(theme);
  const [localValue, setLocalValue] = useState(String(currentValue));
  const [focused, setFocused] = useState(false);

  // Keep local in sync with external value when not editing
  useEffect(() => {
    if (!focused) setLocalValue(String(currentValue));
  }, [currentValue, focused]);

  const commit = () => {
    const n = parseInt(localValue, 10);
    if (isNaN(n)) {
      setLocalValue('0');
      onChange(0);
      return;
    }
    const clamped = Math.max(0, Math.min(max, n));
    setLocalValue(String(clamped));
    onChange(clamped);
  };

  // On web, use native <input type="number"> for best UX
  if (Platform.OS === 'web') {
    return (
      <View style={styles.customInputWrap}>
        <Text style={styles.customInputLabel}>Custom:</Text>
        <input
          type="number"
          min="0"
          max={max}
          step="1"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(); }}
          style={{
            width: 50,
            padding: '3px 6px',
            fontSize: 11,
            background: theme.bgInput,
            color: theme.text,
            border: `1px solid ${theme.border}`,
            borderRadius: 4,
            fontFamily: 'inherit',
          }}
        />
        <Text style={styles.customInputSuffix}>% (max {max}%)</Text>
      </View>
    );
  }

  // Mobile: simple no-input version
  return null;
}

// ============================================================================
// ROSTER COLUMN (draggable players + picks)
// ============================================================================

function RosterColumn({ teamData, loading, outgoingIds, onDragStart, onDragEnd, onTap, team, theme, season, playerDatabase, calculateTRUEi, isMobile }) {
  const styles = makeStyles(theme, isMobile);

  if (loading || !teamData) {
    return (
      <View style={styles.rosterCol}>
        <View style={styles.center}>
          <ActivityIndicator size="small" color={theme.accent} />
        </View>
      </View>
    );
  }

  const outgoingPlayerIds = new Set(outgoingIds.filter(x => x.kind === 'player').map(x => x.id));
  const outgoingPickIds = new Set(outgoingIds.filter(x => x.kind === 'pick').map(x => x.id));

  const isSignedNHL = x => x.status === 'NHL' && x.contract_type === 'signed';
  const forwards = teamData.players.filter(p => isSignedNHL(p) && /^(C|LW|RW)/.test(p.position))
    .sort((a, b) => b.salary - a.salary);
  const defense = teamData.players.filter(p => isSignedNHL(p) && /^(LD|RD)/.test(p.position))
    .sort((a, b) => b.salary - a.salary);
  const goalies = teamData.players.filter(p => isSignedNHL(p) && /^G/.test(p.position))
    .sort((a, b) => b.salary - a.salary);
  const prospects = teamData.players.filter(p => p.status === 'Minors' && p.contract_type === 'signed');

  return (
    <View style={styles.rosterCol}>
      <Text style={styles.rosterTeamName}>{teamData.name}</Text>
      <Text style={styles.rosterCapLine}>
        {formatMoney(teamData.capHit)} used · {formatMoney(teamData.capSpace)} space
      </Text>

      <RosterGroup title="Forwards" players={forwards} outgoingSet={outgoingPlayerIds}
        onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} team={team}
        theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} />
      <RosterGroup title="Defense" players={defense} outgoingSet={outgoingPlayerIds}
        onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} team={team}
        theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} />
      <RosterGroup title="Goalies" players={goalies} outgoingSet={outgoingPlayerIds}
        onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} team={team}
        theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} />
      {prospects.length > 0 && (
        <RosterGroup title={`Prospects (${prospects.length})`} players={prospects}
          outgoingSet={outgoingPlayerIds}
          onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} team={team}
          theme={theme} season={season} playerDatabase={playerDatabase} calculateTRUEi={calculateTRUEi} isMobile={isMobile} collapsed />
      )}
      {teamData.draftPicks && teamData.draftPicks.length > 0 && (
        <PickGroup picks={teamData.draftPicks} outgoingSet={outgoingPickIds}
          onDragStart={onDragStart} onDragEnd={onDragEnd} onTap={onTap} team={team} theme={theme} isMobile={isMobile} />
      )}
    </View>
  );
}

function RosterGroup({ title, players, outgoingSet, onDragStart, onDragEnd, onTap, team, theme, season, playerDatabase, calculateTRUEi, isMobile, collapsed = false }) {
  const [open, setOpen] = useState(!collapsed);
  const styles = makeStyles(theme, isMobile);

  if (!players.length) return null;

  return (
    <View style={styles.groupCard}>
      <TouchableOpacity onPress={() => setOpen(!open)}>
        <Text style={styles.groupTitle}>{open ? '▼' : '▶'} {title}</Text>
      </TouchableOpacity>
      {open && players.map(p => (
        <DraggablePlayerRow
          key={p.id}
          player={p}
          isOutgoing={outgoingSet.has(p.id)}
          onDragStart={onDragStart('player', p.id, team)}
          onDragEnd={onDragEnd}
          onTap={() => onTap && onTap('player', p.id, team)}
          theme={theme}
          truei={findPlayerTRUEi(p.name, season, playerDatabase, calculateTRUEi)}
          isMobile={isMobile}
        />
      ))}
    </View>
  );
}

function PickGroup({ picks, outgoingSet, onDragStart, onDragEnd, onTap, team, theme, isMobile }) {
  const [open, setOpen] = useState(true);
  const styles = makeStyles(theme, isMobile);

  return (
    <View style={styles.groupCard}>
      <TouchableOpacity onPress={() => setOpen(!open)}>
        <Text style={styles.groupTitle}>{open ? '▼' : '▶'} Draft Picks ({picks.length})</Text>
      </TouchableOpacity>
      {open && picks.map(pk => (
        <DraggablePickRow
          key={pk.id}
          pick={pk}
          isOutgoing={outgoingSet.has(pk.id)}
          onDragStart={onDragStart('pick', pk.id, team)}
          onDragEnd={onDragEnd}
          onTap={() => onTap && onTap('pick', pk.id, team)}
          theme={theme}
          isMobile={isMobile}
        />
      ))}
    </View>
  );
}

function DraggablePlayerRow({ player, isOutgoing, onDragStart, onDragEnd, onTap, theme, truei, isMobile }) {
  const styles = makeStyles(theme, isMobile);

  // Mobile: tap-to-add, no drag
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
        <Text style={[styles.rowMeta, { flex: 0.5, color: player.expiry_type === 'UFA' ? theme.warning : theme.textSecondary }]}>
          {player.expiry_type}
        </Text>
        <Text style={[styles.rowMeta, { flex: 0.6 }]}>
          {truei !== null ? truei.toFixed(1) : '—'}
        </Text>
      </TouchableOpacity>
    );
  }

  // Desktop web: drag-and-drop
  if (Platform.OS === 'web') {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={{
          cursor: 'grab',
          opacity: isOutgoing ? 0.35 : 1,
          padding: 6,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderLight,
          borderBottomStyle: 'solid',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Text style={[styles.rowName, { flex: 2 }]} numberOfLines={1}>
          {isOutgoing && '→ '}{player.name}
        </Text>
        <Text style={[styles.rowMeta, { flex: 0.6 }]}>{player.position}</Text>
        <Text style={[styles.rowMeta, { flex: 0.4 }]}>{player.age}</Text>
        <Text style={[styles.rowMeta, { flex: 0.9 }]}>{formatMoney(player.salary)}</Text>
        <Text style={[styles.rowMeta, { flex: 0.5, color: player.expiry_type === 'UFA' ? theme.warning : theme.textSecondary }]}>
          {player.expiry_type}
        </Text>
        <Text style={[styles.rowMeta, { flex: 0.6 }]}>
          {truei !== null ? truei.toFixed(1) : '—'}
        </Text>
      </div>
    );
  }

  // Native mobile fallback (not expected on web)
  return (
    <TouchableOpacity style={[styles.row, isOutgoing && { opacity: 0.35 }]} onPress={onTap}>
      <Text style={[styles.rowName, { flex: 2 }]} numberOfLines={1}>{player.name}</Text>
      <Text style={[styles.rowMeta, { flex: 0.6 }]}>{player.position}</Text>
      <Text style={[styles.rowMeta, { flex: 0.4 }]}>{player.age}</Text>
      <Text style={[styles.rowMeta, { flex: 0.9 }]}>{formatMoney(player.salary)}</Text>
      <Text style={[styles.rowMeta, { flex: 0.6 }]}>{truei !== null ? truei.toFixed(1) : '—'}</Text>
    </TouchableOpacity>
  );
}

function DraggablePickRow({ pick, isOutgoing, onDragStart, onDragEnd, onTap, theme, isMobile }) {
  const styles = makeStyles(theme, isMobile);

  if (isMobile) {
    return (
      <TouchableOpacity
        style={[styles.row, styles.rowMobile, isOutgoing && { opacity: 0.35 }]}
        onPress={onTap}
        disabled={isOutgoing}
      >
        <Text style={styles.rowName}>
          {isOutgoing ? '✓ ' : '+ '}{pick.season} · R{pick.round} · {pick.original_team_name}
        </Text>
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
          cursor: 'grab',
          opacity: isOutgoing ? 0.35 : 1,
          padding: 6,
          borderBottomWidth: 1,
          borderBottomColor: theme.borderLight,
          borderBottomStyle: 'solid',
        }}
      >
        <Text style={styles.rowName}>
          {isOutgoing && '→ '}{pick.season} · Round {pick.round} · {pick.original_team_name}
        </Text>
      </div>
    );
  }

  return (
    <TouchableOpacity style={[styles.row, isOutgoing && { opacity: 0.35 }]} onPress={onTap}>
      <Text style={styles.rowName}>{pick.season} · R{pick.round} · {pick.original_team_name}</Text>
    </TouchableOpacity>
  );
}

// ============================================================================
// STYLES
// ============================================================================

function makeStyles(theme, isMobile = false) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg, padding: 8 },

    stackedColumn: { flexDirection: 'column' },

    selectorRow: { flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-end', marginBottom: 10, zIndex: 100 },
    selectorCol: { flex: 1, position: 'relative', marginBottom: isMobile ? 8 : 0 },
    selectorLabel: { color: theme.textSecondary, fontSize: 11, marginBottom: 4, textTransform: 'uppercase' },
    selector: {
      padding: 10,
      backgroundColor: theme.bgInput,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.border,
    },
    selectorText: { color: theme.text, fontWeight: '600' },
    dropdownAbsolute: {
      position: 'absolute',
      top: 60,
      left: 0,
      right: 0,
      backgroundColor: theme.bgCard,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.border,
      zIndex: 1000,
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 5,
    },
    dropdownItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: theme.borderLight },
    dropdownItemActive: { backgroundColor: theme.bgSelected },
    dropdownText: { color: theme.text },
    vsBox: { paddingHorizontal: 12, paddingBottom: 10, alignItems: 'center', justifyContent: 'center', display: isMobile ? 'none' : 'flex' },
    vsText: { color: theme.textMuted, fontSize: 18, fontWeight: 'bold' },

    mathCard: {
      backgroundColor: theme.bgCard,
      borderRadius: 8,
      padding: 12,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: theme.border,
    },
    mathRow: { flexDirection: isMobile ? 'column' : 'row' },
    mathCol: { flex: 1, paddingHorizontal: 8, marginBottom: isMobile ? 12 : 0 },
    mathTeam: { color: theme.text, fontSize: 16, fontWeight: 'bold', marginBottom: 6 },
    mathLabel: { color: theme.textMuted, fontSize: 10, textTransform: 'uppercase', marginTop: 4 },
    mathValue: { color: theme.text, fontSize: 14, fontWeight: '600' },
    clearBtn: { marginTop: 12, padding: 8, backgroundColor: theme.danger, borderRadius: 6, alignItems: 'center' },
    clearBtnText: { color: '#fff', fontWeight: '600' },

    basketsRow: { flexDirection: 'row', marginBottom: 10 },
    basket: {
      flex: 1,
      minHeight: 120,
      padding: 10,
      backgroundColor: theme.bgCard,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: theme.border,
      borderStyle: 'dashed',
    },
    basketMobile: {
      marginBottom: 8,
      borderStyle: 'solid',
      borderColor: theme.accent,
    },
    basketActive: { borderColor: theme.accent, backgroundColor: theme.accentLight },
    basketEmpty: { justifyContent: 'center' },
    basketTitle: { color: theme.text, fontWeight: 'bold', marginBottom: 8, fontSize: 14 },
    basketHint: { color: theme.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
    basketItem: {
      flexDirection: 'row',
      padding: 8,
      backgroundColor: theme.bgAlt,
      borderRadius: 6,
      marginBottom: 6,
      alignItems: 'flex-start',
    },
    basketItemBlocked: {
      backgroundColor: theme.danger + '22',
      borderLeftWidth: 3,
      borderLeftColor: theme.danger,
    },
    basketItemName: { color: theme.text, fontWeight: '600' },
    basketItemMeta: { color: theme.textSecondary, fontSize: 11, marginTop: 2 },
    ruleText: { color: theme.textSecondary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
    retentionNote: { color: theme.accent, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
    retentionRow: { flexDirection: 'row', marginTop: 6, alignItems: 'center', flexWrap: 'wrap' },
    retentionLabel: { color: theme.textMuted, fontSize: 11, marginRight: 6 },
    retentionBtn: {
      paddingHorizontal: 10,
      paddingVertical: isMobile ? 6 : 3,
      backgroundColor: theme.bg,
      borderRadius: 4,
      marginRight: 4,
      marginBottom: 2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    retentionBtnActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    retentionBtnText: { color: theme.text, fontSize: 11, fontWeight: '600' },
    retentionBtnTextActive: { color: '#fff' },
    customInputWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: 4, marginBottom: 2 },
    customInputLabel: { color: theme.textMuted, fontSize: 11, marginRight: 4 },
    customInputSuffix: { color: theme.textMuted, fontSize: 10, marginLeft: 4 },
    removeBtn: { padding: 6, marginLeft: 8 },
    removeBtnText: { color: theme.danger, fontSize: 18, fontWeight: 'bold' },

    rosterRow: { flexDirection: 'row' },
    rosterCol: { flex: 1, marginHorizontal: 4, marginBottom: isMobile ? 12 : 0 },
    rosterTeamName: { color: theme.text, fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
    rosterCapLine: { color: theme.textSecondary, fontSize: 11, marginBottom: 8 },

    groupCard: {
      backgroundColor: theme.bgCard,
      borderRadius: 6,
      padding: 8,
      marginBottom: 6,
      borderWidth: 1,
      borderColor: theme.border,
    },
    groupTitle: { color: theme.text, fontWeight: 'bold', marginBottom: 6, fontSize: 13 },
    row: { flexDirection: 'row', padding: 6, alignItems: 'center' },
    rowMobile: {
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderLight,
    },
    rowName: { color: theme.text, fontSize: 12 },
    rowMeta: { color: theme.textSecondary, fontSize: 11 },

    center: { padding: 20, alignItems: 'center' },

    helpCard: {
      backgroundColor: theme.bgAlt,
      padding: 10,
      borderRadius: 6,
      marginTop: 10,
      marginBottom: 20,
    },
    helpText: { color: theme.textSecondary, fontSize: 12, lineHeight: 18 },
  });
}
