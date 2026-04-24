// Rankings.js
// Component for displaying TRUEi rankings with charts and export functionality

import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';

const { width } = Dimensions.get('window');

// Helper function to check if position is defenseman
const isDefensemanPos = (pos) => {
  const p = pos.toUpperCase();
  return p.includes('LD') || p.includes('RD');
};

// Display season labels as full years (e.g., 2016-17 -> 2016-2017)
const formatSeasonLabel = (season) => {
  if (!season) return season;
  if (/^\d{4}-\d{4}$/.test(season)) return season;
  const match = season.match(/^(\d{4})-(\d{2})$/);
  if (!match) return season;
  const startYear = parseInt(match[1], 10);
  return `${startYear}-${startYear + 1}`;
};

const normalizeSeasonValue = (season) => {
  if (!season) return season;
  const cleaned = String(season).trim().replace(/[–—]/g, '-');
  const match = cleaned.match(/^(\d{4})[/-](\d{2}|\d{4})$/);
  if (!match) return cleaned;
  const startYear = match[1];
  const endRaw = match[2];
  const endYear = endRaw.length === 4 ? endRaw.slice(-2) : endRaw;
  return `${startYear}-${endYear}`;
};

const normalizeSeasonType = (value) => {
  const t = String(value || 'regular').trim().toLowerCase();
  if (t === 'playoffs' || t === 'playoff' || t === 'postseason' || t === 'po') {
    return 'playoffs';
  }
  return 'regular';
};

// Simple bar chart component with title
const BAR_MAX_WIDTH = 280; // Fixed max width for all bars

const BarChart = React.forwardRef(({ data, maxValue, color, title, theme, onItemClick }, ref) => {
  const t = theme || {};
  return (
    <View style={[styles.chartContainer, { backgroundColor: t.bgCard || '#fff' }]} ref={ref} id={title?.replace(/\s/g, '-')}>
      {title && <Text style={[styles.chartTitle, { color: t.text || '#333' }]}>{title}</Text>}
      {data.map((item, index) => {
        const barWidth = Math.max(8, (Math.abs(item.value) / maxValue) * BAR_MAX_WIDTH);
        const isNegative = item.value < 0;
        const displayName = item.name.length > 15 ? item.name.substring(0, 15) + '...' : item.name;

        return (
          <View key={index} style={styles.barRow}>
            {onItemClick ? (
              <TouchableOpacity onPress={() => onItemClick(item.name)} style={{ width: 'auto' }}>
                <Text style={[styles.barLabel, { color: t.text || '#333', textDecorationLine: 'underline' }]} numberOfLines={1}>
                  {displayName}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.barLabel, { color: t.text || '#333' }]} numberOfLines={1}>
                {displayName}
              </Text>
            )}
            <View style={styles.barContainer}>
              <View
                style={[
                  styles.bar,
                  {
                    width: barWidth,
                    backgroundColor: isNegative ? '#ef5350' : color,
                  }
                ]}
              />
              <Text style={[styles.barValue, { color: t.text || '#333' }]}>{item.value.toFixed(1)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
});

export const Rankings = ({
  players,
  goalies = [],
  selectedSeason,
  seasonType = 'regular',
  availableSeasons,
  onSeasonChange,
  onSeasonTypeChange,
  darkMode = false,
  theme = null,
  onPlayerClick,
}) => {
  const [exporting, setExporting] = useState(false);
  const chartsRef = useRef(null);

  // Default theme if not provided
  const t = theme || {
    bg: darkMode ? '#121212' : '#f5f5f5',
    bgCard: darkMode ? '#1e1e1e' : '#fff',
    bgHeader: darkMode ? '#1a1a2e' : '#1a1a2e',
    text: darkMode ? '#e0e0e0' : '#333',
    textSecondary: darkMode ? '#aaa' : '#666',
    textMuted: darkMode ? '#888' : '#999',
    border: darkMode ? '#333' : '#ddd',
    borderLight: darkMode ? '#2a2a2a' : '#f0f0f0',
    accent: '#4caf50',
    danger: '#ef5350',
  };

  // Calculate GSAA for goalies
  const calculateGSAA = (goalie, leagueAvgSvPct) => {
    if (!goalie || !goalie.sha || goalie.sha === 0) return 0;
    const expectedGoals = goalie.sha * (1 - leagueAvgSvPct);
    const actualGoals = goalie.ga;
    return expectedGoals - actualGoals;
  };

  // Filter players by selected season
  const seasonPlayers = useMemo(() => {
    if (!players || players.length === 0) return [];
    
    return players.filter(p => {
      const playerSeason = normalizeSeasonValue(p.season || '2024-25');
      return playerSeason === normalizeSeasonValue(selectedSeason) &&
        normalizeSeasonType(p.seasonType) === normalizeSeasonType(seasonType);
    });
  }, [players, selectedSeason, seasonType]);

  // Filter goalies by selected season
  const seasonGoalies = useMemo(() => {
    if (!goalies || goalies.length === 0) return [];
    
    return goalies.filter(g => {
      const goalieSeason = normalizeSeasonValue(g.season || '2024-25');
      return goalieSeason === normalizeSeasonValue(selectedSeason) &&
        normalizeSeasonType(g.seasonType) === normalizeSeasonType(seasonType);
    });
  }, [goalies, selectedSeason, seasonType]);

  // Calculate league average SV%
  const leagueAvgSvPct = useMemo(() => {
    const totalSaves = seasonGoalies.reduce((sum, g) => sum + (g.sha - g.ga), 0);
    const totalShots = seasonGoalies.reduce((sum, g) => sum + g.sha, 0);
    return totalShots > 0 ? totalSaves / totalShots : 0.905;
  }, [seasonGoalies]);

  // Calculate TRUEi for all players
  const rankedPlayers = useMemo(() => {
    if (seasonPlayers.length === 0) return [];

    return seasonPlayers.map(player => ({
      ...player,
      truei: calculateSimpleTRUEi(player)
    })).sort((a, b) => b.truei - a.truei);
  }, [seasonPlayers]);

  // Get players by position
  const getPlayersByPosition = (position) => {
    if (position === 'All') return rankedPlayers;
    
    return rankedPlayers.filter(p => {
      const pos = p.pos.toUpperCase();
      if (position === 'C') return pos.startsWith('C');
      if (position === 'LW') return pos.startsWith('LW');
      if (position === 'RW') return pos.startsWith('RW');
      if (position === 'D') return isDefensemanPos(pos);
      return true;
    });
  };

  // Generate all charts data
  const allChartsData = useMemo(() => {
    const positions = ['All', 'C', 'LW', 'RW', 'D'];
    const charts = [];
    
    positions.forEach(pos => {
      const posPlayers = getPlayersByPosition(pos);
      if (posPlayers.length > 0) {
        const top10 = posPlayers.slice(0, 10);
        const bottom10 = posPlayers.slice(-10).reverse();
        
        charts.push({
          title: `Top 10 ${pos === 'All' ? 'Overall' : pos}`,
          data: top10.map(p => ({ name: p.name, value: p.truei })),
          color: '#4caf50',
          isTop: true,
        });
        
        charts.push({
          title: `Bottom 10 ${pos === 'All' ? 'Overall' : pos}`,
          data: bottom10.map(p => ({ name: p.name, value: p.truei })),
          color: '#ef5350',
          isTop: false,
        });
      }
    });
    
    return charts;
  }, [rankedPlayers]);

  // Generate goalie charts data
  const goalieChartsData = useMemo(() => {
    if (!seasonGoalies || seasonGoalies.length === 0) return [];
    
    const qualifiedGoalies = seasonGoalies
      .filter(g => g.gp >= 35)
      .map(g => ({ ...g, gsaa: calculateGSAA(g, leagueAvgSvPct) }))
      .sort((a, b) => b.gsaa - a.gsaa);
    
    if (qualifiedGoalies.length === 0) return [];
    
    const top10 = qualifiedGoalies.slice(0, 10);
    const bottom10 = [...qualifiedGoalies].sort((a, b) => a.gsaa - b.gsaa).slice(0, 10);
    
    return [
      {
        title: 'Top 10 Goalies by GSAA',
        data: top10.map(g => ({ name: g.name, value: g.gsaa })),
        color: '#4caf50',
      },
      {
        title: 'Bottom 10 Goalies by GSAA',
        data: bottom10.map(g => ({ name: g.name, value: g.gsaa })),
        color: '#ef5350',
      },
    ];
  }, [seasonGoalies, leagueAvgSvPct]);

  // Generate team charts data (playoff predictor)
  const teamChartsData = useMemo(() => {
    if (!seasonPlayers || seasonPlayers.length === 0) return [];
    
    const nhlTeams = [
      'Avalanche', 'Blackhawks', 'Blue Jackets', 'Blues', 'Bruins', 'Canadiens',
      'Canucks', 'Capitals', 'Coyotes', 'Devils', 'Ducks', 'Flames', 'Flyers',
      'Hurricanes', 'Islanders', 'Jets', 'Kings', 'Lightning', 'Maple Leafs',
      'Oilers', 'Panthers', 'Penguins', 'Predators', 'Rangers', 'Red Wings',
      'Sabres', 'Senators', 'Sharks', 'Stars', 'Wild', 'Kraken', 'Golden Knights'
    ];
    
    const teamStats = nhlTeams.map(team => {
      const teamPlayers = seasonPlayers.filter(p => p.team === team);
      const teamGoalies = seasonGoalies.filter(g => g.team === team);
      if (teamPlayers.length === 0) return null;
      
      // Team TRUEi (average of top 18)
      const top18 = [...teamPlayers].sort((a, b) => b.gp - a.gp).slice(0, 18);
      const teamTruei = top18.reduce((sum, p) => sum + calculateSimpleTRUEi(p), 0) / top18.length;
      
      // Best goalie (35+ GP, or highest GP if none qualify)
      const startingGoalie = teamGoalies.find(g => g.gp >= 35) || teamGoalies.sort((a, b) => b.gp - a.gp)[0];
      const goalieSvPct = startingGoalie && startingGoalie.sha > 0 
        ? (startingGoalie.sha - startingGoalie.ga) / startingGoalie.sha 
        : 0;
      
      // Shots for/against per 82
      const maxGP = Math.max(...teamPlayers.map(p => p.gp), 1);
      const teamSF = teamPlayers.reduce((sum, p) => sum + p.sog, 0);
      const sfPer82 = (teamSF / maxGP) * 82;
      const goalieSAPer82 = startingGoalie && startingGoalie.gp > 0 
        ? (startingGoalie.sha / startingGoalie.gp) * 82 : 0;

      // Team shooting %
      const teamGoals = teamPlayers.reduce((sum, p) => sum + p.g, 0);
      const teamShootingPct = teamSF > 0 ? teamGoals / teamSF : 0;
      
      return {
        team,
        teamTruei,
        sfPer82,
        goalieSAPer82,
        teamShootingPct,
        goalieSvPct,
      };
    }).filter(Boolean);
    
    // Predicted playoff success (same formula as Teams tab)
    const allTrueiValues = teamStats.map(t => t.teamTruei).sort((a, b) => a - b);
    const avgShootingPct = teamStats.length > 0 
      ? teamStats.reduce((sum, t) => sum + t.teamShootingPct, 0) / teamStats.length 
      : 0.10;
    const avgSvPct = teamStats.length > 0 
      ? teamStats.reduce((sum, t) => sum + t.goalieSvPct, 0) / teamStats.length 
      : leagueAvgSvPct;

    const teamStatsWithPrediction = teamStats.map(team => {
      const rank = allTrueiValues.indexOf(team.teamTruei);
      const percentRank = allTrueiValues.length > 1 ? rank / (allTrueiValues.length - 1) : 0.5;
      const predictedSuccess =
        (team.sfPer82 * team.teamShootingPct) - (team.goalieSAPer82 * (1 - team.goalieSvPct)) +
        0.5 * team.sfPer82 * (team.teamShootingPct - avgShootingPct) +
        0.5 * team.goalieSAPer82 * (team.goalieSvPct - avgSvPct) +
        3 * (percentRank - 0.5);

      return { ...team, predictedSuccess };
    });

    const byPrediction = [...teamStatsWithPrediction].sort((a, b) => b.predictedSuccess - a.predictedSuccess);
    const top10Teams = byPrediction.slice(0, 10);
    const bottom10Teams = byPrediction.slice(-10).reverse();
    
    return [
      {
        title: 'Best Teams by Predicted Playoff Success',
        data: top10Teams.map(t => ({ name: t.team, value: t.predictedSuccess })),
        color: '#4caf50',
      },
      {
        title: 'Worst Teams by Predicted Playoff Success',
        data: bottom10Teams.map(t => ({ name: t.team, value: t.predictedSuccess })),
        color: '#ef5350',
      },
    ];
  }, [seasonPlayers, seasonGoalies, leagueAvgSvPct]);

  // Combine all charts
  const allCombinedCharts = useMemo(() => {
    return [...allChartsData, ...goalieChartsData, ...teamChartsData];
  }, [allChartsData, goalieChartsData, teamChartsData]);

  const globalMaxValue = useMemo(() => {
    return Math.max(...allCombinedCharts.flatMap(c => c.data.map(d => Math.abs(d.value))), 1);
  }, [allCombinedCharts]);

  // Export all charts as images in a zip
  const exportAllCharts = async () => {
    if (Platform.OS !== 'web') {
      alert('Export is only available on web');
      return;
    }

    setExporting(true);
    
    try {
      // Dynamically import html2canvas and jszip
      const html2canvas = (await import('html2canvas')).default;
      const JSZip = (await import('jszip')).default;
      
      const zip = new JSZip();
      const chartsContainer = chartsRef.current;
      
      if (!chartsContainer) {
        throw new Error('Charts container not found');
      }

      // Find all chart elements
      const chartElements = chartsContainer.querySelectorAll('[id]');
      
      for (let i = 0; i < chartElements.length; i++) {
        const chartEl = chartElements[i];
        const canvas = await html2canvas(chartEl, {
          backgroundColor: '#ffffff',
          scale: 2,
        });
        
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const fileName = `${chartEl.id || `chart-${i}`}.png`;
        zip.file(fileName, blob);
      }
      
      // Generate and download zip
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `TRUEi-Rankings-${selectedSeason}-${seasonType}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Make sure html2canvas and jszip are installed:\nnpm install html2canvas jszip');
    }
    
    setExporting(false);
  };

  if (!players || players.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: t.bg }]}>
        <Text style={[styles.emptyText, { color: t.textSecondary }]}>
          No player data available.{'\n'}
          Import data from the Import tab first.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: t.bg }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: t.text }]}>TRUEi Rankings</Text>
        <TouchableOpacity 
          style={[styles.exportButton, exporting && styles.exportButtonDisabled]} 
          onPress={exportAllCharts}
          disabled={exporting}
        >
          <Text style={styles.exportButtonText}>
            {exporting ? 'Exporting...' : '📥 Export All Charts'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Compact controls: season dropdown + segmented toggle on one row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {Platform.OS === 'web' && (
          <select
            value={selectedSeason}
            onChange={(e) => onSeasonChange && onSeasonChange(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: t.bgCard,
              color: t.text,
              border: `1px solid ${t.border || '#ddd'}`,
              borderRadius: 8,
              cursor: 'pointer',
              minWidth: 140,
            }}
          >
            {(() => {
              // Only show seasons that actually have imported data. Sort newest first.
              const seasons = [...(availableSeasons || [])].sort((a, b) => b.localeCompare(a));
              return seasons.map(season => (
                <option key={season} value={season}>
                  {formatSeasonLabel(season)}
                </option>
              ));
            })()}
          </select>
        )}

        <View style={{ flexDirection: 'row', backgroundColor: t.bgCard, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: t.border || '#ddd' }}>
          <TouchableOpacity
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: seasonType === 'regular' ? (t.accent || '#1565c0') : 'transparent' }}
            onPress={() => onSeasonTypeChange && onSeasonTypeChange('regular')}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: seasonType === 'regular' ? '#fff' : t.textSecondary }}>Regular</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: seasonType === 'playoffs' ? (t.accent || '#1565c0') : 'transparent' }}
            onPress={() => onSeasonTypeChange && onSeasonTypeChange('playoffs')}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: seasonType === 'playoffs' ? '#fff' : t.textSecondary }}>Playoffs</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Skater Charts */}
      <View ref={chartsRef}>
        <Text style={[styles.sectionHeader, { color: t.text, borderBottomColor: t.border }]}>Skater Rankings by TRUEi</Text>
        {allChartsData.map((chart, index) => (
          <BarChart
            theme={t}
            key={`skater-${index}`}
            title={chart.title}
            data={chart.data}
            maxValue={globalMaxValue}
            color={chart.color}
            onItemClick={onPlayerClick}
          />
        ))}
        
        {/* Goalie Charts */}
        {goalieChartsData.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { color: t.text, borderBottomColor: t.border }]}>Goalie Rankings by GSAA (35+ GP)</Text>
            {goalieChartsData.map((chart, index) => (
              <BarChart
                key={`goalie-${index}`}
                theme={t}
                title={chart.title}
                data={chart.data}
                maxValue={Math.max(...goalieChartsData.flatMap(c => c.data.map(d => Math.abs(d.value))), 1)}
                color={chart.color}
                onItemClick={onPlayerClick}
              />
            ))}
          </>
        )}
        
        {/* Team Charts */}
        {teamChartsData.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { color: t.text, borderBottomColor: t.border }]}>Team Rankings</Text>
            {teamChartsData.map((chart, index) => (
              <BarChart
                key={`team-${index}`}
                theme={t}
                title={chart.title}
                data={chart.data}
                maxValue={Math.max(...teamChartsData.flatMap(c => c.data.map(d => Math.abs(d.value))), 1)}
                color={chart.color}
              />
            ))}
          </>
        )}
      </View>

      {/* Stats Summary */}
      <View style={[styles.summaryContainer, { backgroundColor: t.bgCard }]}>
        <Text style={[styles.summaryTitle, { color: t.text }]}>Summary Stats</Text>
        <Text style={[styles.summaryText, { color: t.textSecondary }]}>
          Total Players: {rankedPlayers.length} | Goalies: {seasonGoalies.length}
        </Text>
        <Text style={[styles.summaryText, { color: t.textSecondary }]}>
          Average TRUEi: {rankedPlayers.length > 0 ? (rankedPlayers.reduce((sum, p) => sum + p.truei, 0) / rankedPlayers.length).toFixed(2) : 0}
        </Text>
        <Text style={[styles.summaryText, { color: t.textSecondary }]}>
          League Avg SV%: {(leagueAvgSvPct * 100).toFixed(1)}%
        </Text>
        <Text style={[styles.summaryText, { color: t.textSecondary }]}>
          Centers: {getPlayersByPosition('C').length} | 
          LW: {getPlayersByPosition('LW').length} | 
          RW: {getPlayersByPosition('RW').length} | 
          D: {getPlayersByPosition('D').length}
        </Text>
      </View>
    </ScrollView>
  );
};

// TRUEi calculation for rankings
const calculateSimpleTRUEi = (player) => {
  const p = player;
  const isDefenseman = isDefensemanPos(p.pos);
  const isCenter = p.pos.toUpperCase().startsWith('C');
  
  // Shooting value with capped downside (scaled by position)
  const expectedSPct = isDefenseman ? 0.0222 : 0.1325;
  const shootingFloor = isDefenseman ? -0.0084 : -0.05;
  const shootingDiff = Math.max((p.sPct / 100) - expectedSPct, shootingFloor);
  const shootingValue = p.sog * shootingDiff;
  
  let baseValue = (
    p.g + 
    (p.a * 0.7) + 
    (p.ta * 0.15) - 
    (p.ga * 0.075) +
    (p.ht * 0.025) +
    shootingValue -
    (p.pim * 0.12) - 
    (p.ppp * 0.25)
  );

  // Faceoff value for centers
  if (isCenter && p.foPct > 30 && p.foPct < 70) {
    const evToi = p.atoi - p.appt - p.apkt;
    const estimatedFaceoffs = ((evToi * 0.819) + ((p.apkt + p.appt) * 1.229)) * p.gp;
    const faceoffValue = estimatedFaceoffs * (p.foPct - 50) / 50;
    baseValue += faceoffValue * 0.05;
  }

  // Pro-rate to 82 games
  const perGame = baseValue / p.gp;
  
  let trueiValue;
  if (isDefenseman && p.atoi) {
    const multiplier = Math.max(1.18, Math.min(1.51, 1.18 + ((p.atoi - 13) / 15) * 0.33));
    trueiValue = perGame * multiplier * 82;
  } else {
    trueiValue = perGame * 82;
  }

  return trueiValue;
};

// ============================================================
// TYPOGRAPHY SCALE (keep consistent with App.js)
// ============================================================
const TYPE = {
  h1: 22,
  h2: 18,
  h3: 16,
  body: 14,
  bodySm: 13,
  small: 12,
  tiny: 11,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  toggleBtn: {
    flex: 1,
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#ebebeb',
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: '#1a1a2e',
  },
  toggleText: {
    color: '#888',
    fontWeight: '500',
    fontSize: TYPE.tiny,
  },
  toggleTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  title: {
    fontSize: TYPE.h1,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  sectionHeader: {
    fontSize: TYPE.h3,
    fontWeight: '600',
    color: '#333',
    marginTop: 24,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  exportButton: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  exportButtonDisabled: {
    backgroundColor: '#888',
  },
  exportButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: TYPE.small,
  },
  emptyText: {
    fontSize: TYPE.body,
    color: '#888',
    textAlign: 'center',
    marginTop: 40,
  },
  seasonContainer: {
    marginBottom: 12,
  },
  filterLabel: {
    fontSize: TYPE.bodySm,
    fontWeight: '600',
    marginBottom: 6,
    color: '#333',
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 10,
    marginBottom: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  filterButtonActive: {
    backgroundColor: '#1a1a2e',
    borderColor: '#1a1a2e',
  },
  filterButtonText: {
    fontSize: TYPE.small,
    color: '#666',
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: '#fff',
  },
  chartContainer: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 14,
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: TYPE.body,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  barLabel: {
    width: 110,
    fontSize: TYPE.tiny,
    color: '#333',
    fontWeight: '500',
  },
  barContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: {
    height: 20,
    borderRadius: 3,
    marginRight: 8,
  },
  barValue: {
    fontSize: TYPE.tiny,
    fontWeight: '600',
    color: '#333',
    minWidth: 45,
  },
  summaryContainer: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 14,
    marginBottom: 16,
  },
  summaryTitle: {
    fontSize: TYPE.body,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  summaryText: {
    fontSize: TYPE.small,
    color: '#666',
    marginBottom: 4,
  },
});


