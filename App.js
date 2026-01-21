import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
  TouchableOpacity,
  Alert,
  FlatList,
  Modal,
  Platform,
} from 'react-native';
import { migrateStorageToIndexedDb, storageGetItem, storageRemoveItem, storageSetItem } from './storage';
import { Rankings } from './Rankings';
import { PLAYER_DATA, GOALIE_DATA, SEASON_IMAGES, SEASONS, SEASON_TO_NUMBER } from './bundledData';
import DRAFT_DATA from './assets/data/draftData.json';

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <Text style={{ color: '#ff6b6b', fontSize: 20, fontWeight: 'bold', marginBottom: 10 }}>Something went wrong</Text>
          <Text style={{ color: '#ffffff', fontSize: 14, textAlign: 'center' }}>{this.state.error?.toString()}</Text>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const [activeTab, setActiveTab] = useState('stats');
  const [playerDatabase, setPlayerDatabase] = useState([]);
  const [goalieDatabase, setGoalieDatabase] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [importText, setImportText] = useState('');
  
  // Season management
  const [selectedSeason, setSelectedSeason] = useState('2024-25');
  const [showSeasonModal, setShowSeasonModal] = useState(false);
  const [pendingImportData, setPendingImportData] = useState(null);
  const [pendingGoalieData, setPendingGoalieData] = useState(null);
  const [importType, setImportType] = useState('players'); // 'players' or 'goalies'
  const [importSeasonType, setImportSeasonType] = useState('regular'); // 'regular' or 'playoffs'
  const [showCustomSeasonInput, setShowCustomSeasonInput] = useState(false);
  const [customSeasonText, setCustomSeasonText] = useState('');
  
  // Season images (3 per season: east/west/playoffs)
  const [seasonImages, setSeasonImages] = useState({});
  const [seasonImageDrafts, setSeasonImageDrafts] = useState({});

  
  // TRUEi result
  const [trueiResult, setTrueiResult] = useState(null);
  
  // My Roster state
  const [myRoster, setMyRoster] = useState([]);
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterSeason, setRosterSeason] = useState(null);
  const [rosterSeasonType, setRosterSeasonType] = useState('regular'); // 'regular' or 'playoffs'
  const [lineAssignments, setLineAssignments] = useState({
    // Even Strength Lines
    line1: { lw: null, c: null, rw: null },
    line2: { lw: null, c: null, rw: null },
    line3: { lw: null, c: null, rw: null },
    line4: { lw: null, c: null, rw: null },
    // Defense Pairings
    pair1: { ld: null, rd: null },
    pair2: { ld: null, rd: null },
    pair3: { ld: null, rd: null },
    // Power Play (LD - RD - LW - C - RW)
    pp1: { ld: null, rd: null, lw: null, c: null, rw: null },
    pp2: { ld: null, rd: null, lw: null, c: null, rw: null },
    // Penalty Kill (LD - RD - LF - RF)
    pk1: { ld: null, rd: null, lf: null, rf: null },
    pk2: { ld: null, rd: null, lf: null, rf: null },
    // Goalies
    goalies: { starter: null, backup: null },
    // Scratches
    scratches: { s1: null, s2: null, s3: null },
  });
  
  // Playoff stats
  const [playoffStats, setPlayoffStats] = useState({
    shotsFor82: '',
    shootingPct: '',
    shotsAgainst82: '',
    goalieSvPct: '',
    teamTRUEi: '',
  });

  // Stats tab state
  const [statsView, setStatsView] = useState('skaters'); // 'skaters' or 'goalies'
  const [statsSeasonType, setStatsSeasonType] = useState('regular'); // 'regular' or 'playoffs'
  const [statsSeasonStart, setStatsSeasonStart] = useState(null);
  const [statsSeasonEnd, setStatsSeasonEnd] = useState(null);
  // Stats tab: NHL.com style "Sum Results" toggle (default OFF)
  const [statsSumResults, setStatsSumResults] = useState(false);
  const [statsTeamFilter, setStatsTeamFilter] = useState('All');
  const [statsPositionFilter, setStatsPositionFilter] = useState('All');
  const [statsSearchQuery, setStatsSearchQuery] = useState('');
  const [statsSortColumn, setStatsSortColumn] = useState('truei');
  const [statsSortAsc, setStatsSortAsc] = useState(false);
  const [statsExpandedPlayer, setStatsExpandedPlayer] = useState(null); // For accordion dropdown
  const [statsPerPage, setStatsPerPage] = useState(25); // 25, 50, or 100
  const [statsCurrentPage, setStatsCurrentPage] = useState(0); // 0-indexed page
  const [rankingsSeasonType, setRankingsSeasonType] = useState('regular'); // 'regular' or 'playoffs'
  
  // Draft filter states
  const [statsDraftYearFilter, setStatsDraftYearFilter] = useState('All');
  const [statsDraftRoundFilter, setStatsDraftRoundFilter] = useState('All');
  const [statsDraftPickFilter, setStatsDraftPickFilter] = useState('All');
  const [showDraftYearDropdown, setShowDraftYearDropdown] = useState(false);
  const [showDraftRoundDropdown, setShowDraftRoundDropdown] = useState(false);
  const [showDraftPickDropdown, setShowDraftPickDropdown] = useState(false);

  // Load saved players on app start
  useEffect(() => {
    loadPlayers();
  }, []);

  const loadPlayers = async () => {
    try {
      // Try migration but don't fail if it doesn't work
      try {
        await migrateStorageToIndexedDb(['playerDatabase', 'goalieDatabase', 'seasonImages', 'myRoster']);
      } catch (migrationError) {
        console.log('Migration skipped:', migrationError);
      }

      // Load bundled data
      const allPlayers = [];
      const allGoalies = [];
      
      // Helper to parse time string "MM:SS" to decimal minutes (inline to avoid hoisting issues)
      const parseTime = (timeStr) => {
        if (!timeStr) return 0;
        const str = String(timeStr).replace(/"/g, '').trim();
        if (str.includes(':')) {
          const [mins, secs] = str.split(':').map(Number);
          return mins + (secs / 60);
        }
        return parseFloat(str) || 0;
      };

      // Helper to normalize player data from JSON (capital keys) to app format (lowercase)
      const normalizePlayer = (p, season, seasonType) => {
        const rawTeam = p.Team || p.team || '';
        return {
          ...p,
          season,
          seasonType,
          name: p.Name || p.name || '',
          team: convertAhlToNhl(rawTeam),
          pos: p.Pos || p.pos || '',
          gp: parseInt(p.GP || p.gp || 0),
          g: parseInt(p.G || p.g || 0),
          a: parseInt(p.A || p.a || 0),
          p: parseInt(p.P || p.p || 0),
          plusMinus: parseInt(p['+/-'] || p.plusMinus || 0),
          pim: parseInt(p.PIM || p.pim || 0),
          ppp: parseInt(p.PPP || p.ppp || 0),
          shp: parseInt(p.SHp || p.shp || 0),
          ht: parseInt(p.Ht || p.ht || 0),
          ga: parseInt(p.GA || p.ga || 0),
          ta: parseInt(p.TA || p.ta || 0),
          sog: parseInt(p.SOG || p.sog || 0),
          sPct: parseFloat(p['S%'] || p.sPct || 0),
          sb: parseInt(p.SB || p.sb || 0),
          atoi: parseTime(p.ATOI || p.atoi || '0:00'),
          appt: parseTime(p.APPT || p.appt || '0:00'),
          apkt: parseTime(p.APKT || p.apkt || '0:00'),
          foPct: parseFloat(p['FO%'] || p.foPct || 0),
        };
      };

      SEASONS.forEach(season => {
        // Regular season players
        const playersRegular = PLAYER_DATA[season]?.regular;
        if (playersRegular && Array.isArray(playersRegular)) {
          playersRegular.forEach(p => {
            allPlayers.push(normalizePlayer(p, season, 'regular'));
          });
        }
        // Playoff players
        const playersPlayoffs = PLAYER_DATA[season]?.playoffs;
        if (playersPlayoffs && Array.isArray(playersPlayoffs)) {
          playersPlayoffs.forEach(p => {
            allPlayers.push(normalizePlayer(p, season, 'playoffs'));
          });
        }
        // Regular season goalies
        const goaliesRegular = GOALIE_DATA[season]?.regular;
        if (goaliesRegular && Array.isArray(goaliesRegular)) {
          goaliesRegular.forEach(g => {
            allGoalies.push({ 
              ...g, 
              season, 
              seasonType: 'regular',
              // Normalize common goalie fields across different exports
              name: g.Name || g.name || g.Player || g.player,
              team: convertAhlToNhl(g.Team || g.team),
              gp: parseInt(g.GP || g.gp || 0),
              // IMPORTANT: the Stats table expects w/l/t (not wins/losses)
              w: parseInt(g.W || g.w || g.wins || 0),
              l: parseInt(g.L || g.l || g.losses || 0),
              t: parseInt(g.T || g.t || g.ties || g.OTL || g.otl || 0),
              // Keep these too (used elsewhere sometimes)
              wins: parseInt(g.W || g.w || g.wins || 0),
              losses: parseInt(g.L || g.l || g.losses || 0),
              otl: parseInt(g.OTL || g.otl || 0),
              gaa: parseFloat(g.GAA || g.gaa || 0),
              svPct: parseFloat(g['SV%'] || g.svPct || g.Svp || g.svp || 0),
              ga: parseInt(g.GA || g.ga || g['Goals Against'] || g.goalsagainst || g.goalsAgainst || g.goals_allowed || 0),
              pim: parseInt(g.PIM || g.PIMs || g.pim || g.pims || g.penaltyminutes || g['Penalty Minutes'] || 0),
              sha: parseInt(g.SHA || g.sha || g.SA || g.sa || g['Shots Against'] || 0),
              so: parseInt(g.SO || g.so || g.Shutouts || g.shutouts || 0),
              g: parseInt(g.G || g.g || g.Goals || g.goals || 0),
              a: parseInt(g.A || g.a || g.Assists || g.assists || 0),
              toi: parseInt(g.TOI || g.toi || 0),
            });
          });
        }
        // Playoff goalies
        const goaliesPlayoffs = GOALIE_DATA[season]?.playoffs;
        if (goaliesPlayoffs && Array.isArray(goaliesPlayoffs)) {
          goaliesPlayoffs.forEach(g => {
            allGoalies.push({ 
              ...g, 
              season, 
              seasonType: 'playoffs',
              // Normalize common goalie fields across different exports
              name: g.Name || g.name || g.Player || g.player,
              team: convertAhlToNhl(g.Team || g.team),
              gp: parseInt(g.GP || g.gp || 0),
              // IMPORTANT: the Stats table expects w/l/t (not wins/losses)
              w: parseInt(g.W || g.w || g.wins || 0),
              l: parseInt(g.L || g.l || g.losses || 0),
              t: parseInt(g.T || g.t || g.ties || g.OTL || g.otl || 0),
              // Keep these too (used elsewhere sometimes)
              wins: parseInt(g.W || g.w || g.wins || 0),
              losses: parseInt(g.L || g.l || g.losses || 0),
              otl: parseInt(g.OTL || g.otl || 0),
              gaa: parseFloat(g.GAA || g.gaa || 0),
              svPct: parseFloat(g['SV%'] || g.svPct || g.Svp || g.svp || 0),
              ga: parseInt(g.GA || g.ga || g['Goals Against'] || g.goalsagainst || g.goalsAgainst || g.goals_allowed || 0),
              pim: parseInt(g.PIM || g.PIMs || g.pim || g.pims || g.penaltyminutes || g['Penalty Minutes'] || 0),
              sha: parseInt(g.SHA || g.sha || g.SA || g.sa || g['Shots Against'] || 0),
              so: parseInt(g.SO || g.so || g.Shutouts || g.shutouts || 0),
              g: parseInt(g.G || g.g || g.Goals || g.goals || 0),
              a: parseInt(g.A || g.a || g.Assists || g.assists || 0),
              toi: parseInt(g.TOI || g.toi || 0),
            });
          });
        }
      });
      
      console.log('Loaded players:', allPlayers.length, 'goalies:', allGoalies.length);
      setPlayerDatabase(allPlayers);
      setGoalieDatabase(allGoalies);
      
      // Set bundled season images
      const bundledImages = {};
      Object.keys(SEASON_TO_NUMBER).forEach(season => {
        const num = SEASON_TO_NUMBER[season];
        if (SEASON_IMAGES[num]) {
          bundledImages[season] = SEASON_IMAGES[num];
        }
      });
      setSeasonImages(bundledImages);
      
      // Load user's roster from storage
      try {
        const savedRoster = await storageGetItem('myRoster');
        if (savedRoster) {
          setMyRoster(JSON.parse(savedRoster));
        }
      } catch (rosterError) {
        console.log('Could not load roster:', rosterError);
      }
    } catch (error) {
      console.log('Error loading players:', error);
      Alert.alert('Error', 'Failed to load data: ' + error.message);
    }
  };

  const saveRoster = async (roster) => {
    try {
      await storageSetItem('myRoster', JSON.stringify(roster));
      setMyRoster(roster);
    } catch (error) {
      console.log('Error saving roster:', error);
      if (Platform.OS === 'web') {
        window.alert('Warning: storage quota exceeded. Some data may not be saved.');
      } else {
        Alert.alert('Warning', 'Storage quota exceeded. Some data may not be saved.');
      }
    }
  };

  const savePlayers = async (players) => {
    try {
      await storageSetItem('playerDatabase', JSON.stringify(players));
      setPlayerDatabase(players);
    } catch (error) {
      console.log('Error saving players:', error);
      if (Platform.OS === 'web') {
        window.alert('Warning: storage quota exceeded. Some data may not be saved.');
      } else {
        Alert.alert('Warning', 'Storage quota exceeded. Some data may not be saved.');
      }
    }
  };

  const saveGoalies = async (goalies) => {
    try {
      await storageSetItem('goalieDatabase', JSON.stringify(goalies));
      setGoalieDatabase(goalies);
    } catch (error) {
      console.log('Error saving goalies:', error);
      if (Platform.OS === 'web') {
        window.alert('Warning: storage quota exceeded. Some data may not be saved.');
      } else {
        Alert.alert('Warning', 'Storage quota exceeded. Some data may not be saved.');
      }
    }
  };

  const saveSeasonImages = async (next) => {
    try {
      await storageSetItem('seasonImages', JSON.stringify(next));
      setSeasonImages(next);
    } catch (error) {
      console.log('Error saving season images:', error);
      if (Platform.OS === 'web') {
        window.alert('Warning: storage quota exceeded. Some data may not be saved.');
      } else {
        Alert.alert('Warning', 'Storage quota exceeded. Some data may not be saved.');
      }
    }
  };

  // Helper to parse time string "MM:SS" to decimal minutes
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const str = String(timeStr).replace(/"/g, '').trim();
    if (str.includes(':')) {
      const [mins, secs] = str.split(':').map(Number);
      return mins + (secs / 60);
    }
    return parseFloat(str) || 0;
  };

  // Helper to format decimal minutes back to "MM:SS"
  const formatMinutesToTime = (decimalMinutes) => {
    if (!decimalMinutes || isNaN(decimalMinutes)) return '0:00';
    const mins = Math.floor(decimalMinutes);
    const secs = Math.round((decimalMinutes - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper to generate all possible seasons (2016-17 to 2068-69)
  const generateAllSeasons = () => {
    const seasons = [];
    for (let year = 2016; year <= 2068; year++) {
      const shortYear = (year + 1).toString().slice(-2);
      seasons.push(`${year}-${shortYear}`);
    }
    return seasons;
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

  // Calculate Goals Saved Above Average
  const calculateGSAA = (goalie, leagueAvgSvPct) => {
    if (!goalie.sha || goalie.sha === 0) return 0;
    const expectedGoals = goalie.sha * (1 - leagueAvgSvPct);
    const gsaa = expectedGoals - goalie.ga;
    return gsaa;
  };

  // AHL to NHL affiliate mapping (2016-17 era affiliations)
  const ahlToNhlMap = {
    // Atlantic Division
    'Bridgeport Sound Tigers': 'Islanders',
    'Sound Tigers': 'Islanders',
    'Hartford Wolf Pack': 'Rangers',
    'Wolf Pack': 'Rangers',
    'Hershey Bears': 'Capitals',
    'Bears': 'Capitals',
    'Lehigh Valley Phantoms': 'Flyers',
    'Phantoms': 'Flyers',
    'Providence Bruins': 'Bruins',
    'P-Bruins': 'Bruins',
    'Springfield Thunderbirds': 'Panthers',
    'Thunderbirds': 'Panthers',
    'Springfield Falcons': 'Blue Jackets',
    'Falcons': 'Blue Jackets',
    'Wilkes-Barre/Scranton Penguins': 'Penguins',
    'WBS Penguins': 'Penguins',
    'Albany Devils': 'Devils',
    
    // North Division
    'Laval Rocket': 'Canadiens',
    'Rocket': 'Canadiens',
    'St. John\'s IceCaps': 'Canadiens',
    'IceCaps': 'Canadiens',
    'Belleville Senators': 'Senators',
    'B-Sens': 'Senators',
    'Binghamton Senators': 'Senators',
    'Rochester Americans': 'Sabres',
    'Amerks': 'Sabres',
    'Americans': 'Sabres',
    'Syracuse Crunch': 'Lightning',
    'Crunch': 'Lightning',
    'Toronto Marlies': 'Maple Leafs',
    'Marlies': 'Maple Leafs',
    'Utica Comets': 'Canucks',
    'Comets': 'Canucks',
    
    // Central Division
    'Chicago Wolves': 'Blues',
    'Wolves': 'Blues',
    'Cleveland Monsters': 'Blue Jackets',
    'Monsters': 'Blue Jackets',
    'Lake Erie Monsters': 'Blue Jackets',
    'Grand Rapids Griffins': 'Red Wings',
    'Griffins': 'Red Wings',
    'Iowa Wild': 'Wild',
    'Manitoba Moose': 'Jets',
    'Moose': 'Jets',
    'Milwaukee Admirals': 'Predators',
    'Admirals': 'Predators',
    'Rockford IceHogs': 'Blackhawks',
    'IceHogs': 'Blackhawks',
    
    // Pacific Division
    'Bakersfield Condors': 'Oilers',
    'Condors': 'Oilers',
    'Oklahoma City Barons': 'Oilers',
    'Barons': 'Oilers',
    'Colorado Eagles': 'Avalanche',
    'Eagles': 'Avalanche',
    'San Antonio Rampage': 'Avalanche',
    'Rampage': 'Avalanche',
    'Henderson Silver Knights': 'Golden Knights',
    'Silver Knights': 'Golden Knights',
    'Ontario Reign': 'Kings',
    'Reign': 'Kings',
    'San Diego Gulls': 'Ducks',
    'Gulls': 'Ducks',
    'San Jose Barracuda': 'Sharks',
    'Barracuda': 'Sharks',
    'Stockton Heat': 'Flames',
    'Heat': 'Flames',
    'Tucson Roadrunners': 'Coyotes',
    'Roadrunners': 'Coyotes',
    'Texas Stars': 'Stars',
    'T-Stars': 'Stars',
    'Charlotte Checkers': 'Hurricanes',
    'Checkers': 'Hurricanes',
    'Abbotsford Canucks': 'Canucks',
    'A-Canucks': 'Canucks',
    'Coachella Valley Firebirds': 'Kraken',
    'Firebirds': 'Kraken',
    'Calgary Wranglers': 'Flames',
    'Wranglers': 'Flames',
    
    // Additional historic affiliates
    'Norfolk Admirals': 'Ducks',
    'Portland Pirates': 'Coyotes',
    'Pirates': 'Coyotes',
    'Hamilton Bulldogs': 'Canadiens',
    'Bulldogs': 'Canadiens',
    'Adirondack Flames': 'Flames',
    'A-Flames': 'Flames',
    'St. John\'s Maple Leafs': 'Maple Leafs',
    'Baby Leafs': 'Maple Leafs',
    'Lowell Devils': 'Devils',
    'L-Devils': 'Devils',
    'Houston Aeros': 'Wild',
    'Aeros': 'Wild',
    'Peoria Rivermen': 'Blues',
    'Rivermen': 'Blues',
    'Worcester Sharks': 'Sharks',
    'W-Sharks': 'Sharks',
  };

  // Convert AHL team name to NHL parent club
  const convertAhlToNhl = (teamName) => {
    if (!teamName) return teamName;
    const trimmed = teamName.trim();
    // Check if it's already an NHL team
    const nhlTeams = [
      'Avalanche', 'Blackhawks', 'Blue Jackets', 'Blues', 'Bruins', 'Canadiens',
      'Canucks', 'Capitals', 'Coyotes', 'Devils', 'Ducks', 'Flames', 'Flyers',
      'Hurricanes', 'Islanders', 'Jets', 'Kings', 'Lightning', 'Maple Leafs',
      'Oilers', 'Panthers', 'Penguins', 'Predators', 'Rangers', 'Red Wings',
      'Sabres', 'Senators', 'Sharks', 'Stars', 'Wild', 'Kraken', 'Golden Knights'
    ];
    if (nhlTeams.includes(trimmed)) return trimmed;
    // Check AHL mapping
    return ahlToNhlMap[trimmed] || trimmed;
  };

  // Create draft lookup map by player name (lowercase for matching)
  const draftLookup = useMemo(() => {
    const lookup = {};
    if (DRAFT_DATA && Array.isArray(DRAFT_DATA)) {
      DRAFT_DATA.forEach(d => {
        const key = d.name.toLowerCase().trim();
        // If multiple drafts for same name, keep the first (earliest)
        if (!lookup[key]) {
          lookup[key] = {
            draftYear: d.draftYear,
            round: d.round,
            overall: d.overall,
            pregen: d.pregen
          };
        }
      });
    }
    return lookup;
  }, []);

  // Get draft info for a player
  const getDraftInfo = (playerName) => {
    if (!playerName) return null;
    const key = playerName.toLowerCase().trim();
    return draftLookup[key] || null;
  };

  // Helper to parse CSV line (handles quoted fields)
  const parseCSVLine = (line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const normalizeHeader = (value) => {
    if (!value) return '';
    const raw = String(value).replace(/"/g, '').trim().toLowerCase();
    if (raw === '+/-' || (raw.includes('plus') && raw.includes('minus'))) return 'plusminus';
    const pctNormalized = raw.replace(/%/g, 'pct');
    return pctNormalized.replace(/[^a-z0-9]+/g, '');
  };

  const getHeaderMap = (fields) => {
    const map = new Map();
    fields.forEach((f, idx) => {
      const key = normalizeHeader(f);
      if (key) map.set(key, idx);
    });
    return map;
  };

  const parseDelimitedLine = (line, delimiter) => {
    if (delimiter === ',') return parseCSVLine(line);
    return line.split(delimiter).map((v) => v.trim());
  };

  const getFieldValue = (headerMap, fields, keys, fallbackIndex) => {
    if (headerMap) {
      for (const key of keys) {
        const idx = headerMap.get(key);
        if (idx !== undefined) return fields[idx];
      }
    }
    if (fallbackIndex !== undefined && fallbackIndex < fields.length) {
      return fields[fallbackIndex];
    }
    return '';
  };

  const parsePlayersFromText = (content) => {
    const lines = content.trim().split('\n').map(l => l.replace(/\r/g, '')).filter(Boolean);
    if (lines.length === 0) return [];
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const headerFields = parseDelimitedLine(firstLine, delimiter);
    const hasHeader = headerFields.some(h => normalizeHeader(h) === 'name') && headerFields.some(h => normalizeHeader(h) === 'team');
    const headerMap = hasHeader ? getHeaderMap(headerFields) : null;
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const newPlayers = [];
    dataLines.forEach((line) => {
      const fields = parseDelimitedLine(line, delimiter);
      const rawTeam = getFieldValue(headerMap, fields, ['team'], 1).replace(/"/g, '').trim();
      const player = {
        name: getFieldValue(headerMap, fields, ['name'], 0).replace(/"/g, '').trim(),
        team: convertAhlToNhl(rawTeam),
        pos: getFieldValue(headerMap, fields, ['pos', 'position'], 2).replace(/"/g, '').trim(),
        gp: parseFloat(getFieldValue(headerMap, fields, ['gp', 'gamesplayed'], 3)) || 0,
        g: parseFloat(getFieldValue(headerMap, fields, ['g', 'goals'], 4)) || 0,
        a: parseFloat(getFieldValue(headerMap, fields, ['a', 'assists'], 5)) || 0,
        p: parseFloat(getFieldValue(headerMap, fields, ['p', 'pts', 'points'], 6)) || 0,
        plusMinus: parseFloat(getFieldValue(headerMap, fields, ['plusminus'], 7)) || 0,
        pim: parseFloat(getFieldValue(headerMap, fields, ['pim','pims','penaltyminutes','penalty minutes'], 8)) || 0,
        ppp: parseFloat(getFieldValue(headerMap, fields, ['ppp'], 9)) || 0,
        shp: parseFloat(getFieldValue(headerMap, fields, ['shp'], 10)) || 0,
        ht: parseFloat(getFieldValue(headerMap, fields, ['hit', 'hits'], 11)) || 0,
        ga: parseFloat(getFieldValue(headerMap, fields, ['ga', 'giveaways'], 12)) || 0,
        ta: parseFloat(getFieldValue(headerMap, fields, ['ta', 'takeaways'], 13)) || 0,
        sog: parseFloat(getFieldValue(headerMap, fields, ['sog', 'shots'], 14)) || 0,
        sPct: parseFloat(String(getFieldValue(headerMap, fields, ['spct', 'shotpct'], 15)).replace(/"/g, '')) || 0,
        sb: parseFloat(getFieldValue(headerMap, fields, ['sb', 'blk', 'blocks'], 16)) || 0,
        atoi: parseTimeToMinutes(getFieldValue(headerMap, fields, ['atoi', 'toi'], 17)),
        appt: parseTimeToMinutes(getFieldValue(headerMap, fields, ['appt'], 18)),
        apkt: parseTimeToMinutes(getFieldValue(headerMap, fields, ['apkt'], 19)),
        foPct: parseFloat(String(getFieldValue(headerMap, fields, ['fopct', 'faceoffpct'], 20)).replace(/"/g, '')) || 0,
      };

      if (player.name) {
        newPlayers.push(player);
      }
    });

    return newPlayers;
  };

  const parseGoaliesFromText = (content) => {
    const lines = content.trim().split('\n').map(l => l.replace(/\r/g, '')).filter(Boolean);
    if (lines.length === 0) return [];
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';
    const headerFields = parseDelimitedLine(firstLine, delimiter);
    const hasHeader = headerFields.some(h => normalizeHeader(h) === 'name') && headerFields.some(h => normalizeHeader(h) === 'team');
    const headerMap = hasHeader ? getHeaderMap(headerFields) : null;
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const newGoalies = [];
    dataLines.forEach((line) => {
      const fields = parseDelimitedLine(line, delimiter);
      const rawTeam = getFieldValue(headerMap, fields, ['team'], 1).replace(/"/g, '').trim();
      const rawSvPct = parseFloat(String(getFieldValue(headerMap, fields, ['svpct', 'sv', 'svpercent'], 9)).replace(/"/g, '')) || 0;
      const goalie = {
        name: getFieldValue(headerMap, fields, ['name'], 0).replace(/"/g, '').trim(),
        team: convertAhlToNhl(rawTeam),
        gp: parseFloat(getFieldValue(headerMap, fields, ['gp', 'gamesplayed'], 2)) || 0,
        w: parseFloat(getFieldValue(headerMap, fields, ['w', 'wins'], 3)) || 0,
        l: parseFloat(getFieldValue(headerMap, fields, ['l', 'losses'], 4)) || 0,
        t: parseFloat(getFieldValue(headerMap, fields, ['t', 'otl', 'ties'], 5)) || 0,
        sha: parseFloat(getFieldValue(headerMap, fields, ['sa', 'sha', 'shotsagainst'], 6)) || 0,
        ga: parseFloat(getFieldValue(headerMap, fields, ['ga','goalsagainst','goals against','goalsallowed','goals allowed','goals_against','goals_allowed'], 7)) || 0,
        gaa: parseFloat(String(getFieldValue(headerMap, fields, ['gaa'], 8)).replace(/"/g, '')) || 0,
        svPct: rawSvPct > 1 ? rawSvPct / 100 : rawSvPct,
        so: parseFloat(getFieldValue(headerMap, fields, ['so', 'shutouts'], 10)) || 0,
        g: parseFloat(getFieldValue(headerMap, fields, ['g', 'goals'], 11)) || 0,
        a: parseFloat(getFieldValue(headerMap, fields, ['a', 'assists'], 12)) || 0,
        pim: parseFloat(getFieldValue(headerMap, fields, ['pim','pims','penaltyminutes','penalty minutes'], 13)) || 0,
      };
      goalie.p = goalie.g + goalie.a;

      if (goalie.name) {
        newGoalies.push(goalie);
      }
    });

    return newGoalies;
  };

  const handleImport = () => {
    if (!importText.trim()) {
      Alert.alert('Error', 'Please paste player data from rgmg.ca/stats or CSV');
      return;
    }

    try {
      const newPlayers = parsePlayersFromText(importText);

      if (newPlayers.length === 0) {
        Alert.alert('Error', 'No valid players found. Make sure you copied the table rows or CSV from rgmg.ca/stats');
        return;
      }

      // Store pending data and show season selector
      setImportType('players');
      setPendingImportData(newPlayers);
      setShowSeasonModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to parse data. Please check the format.');
    }
  };

  const handleCSVUpload = async () => {
    // For web platform, we use a hidden file input
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target.result;
          processCSVContent(content);
        };
        reader.readAsText(file);
      };
      input.click();
    } else {
      Alert.alert('Info', 'CSV upload is only available on web. Please paste the CSV content instead.');
    }
  };

  const handleGoalieCSVUpload = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target.result;
          processGoalieCSVContent(content);
        };
        reader.readAsText(file);
      };
      input.click();
    } else {
      Alert.alert('Info', 'CSV upload is only available on web.');
    }
  };

// Upload a season image (web-only). Stores as base64 data URL.
const uploadSeasonImage = (season, key) => {
  if (Platform.OS !== 'web') {
    Alert.alert('Web only', 'Image upload is web-only for now.');
    return;
  }
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/jpg,image/png';

    input.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const current = seasonImages[season] || { east: null, west: null, playoffs: null };
        const next = {
          ...seasonImages,
          [season]: { ...current, [key]: reader.result },
        };
        saveSeasonImages(next);
      };
      reader.readAsDataURL(file);
    };

    input.click();
  } catch (err) {
    console.log('Image upload failed:', err);
    Alert.alert('Upload failed', 'Could not open file picker. Check browser permissions.');
  }
};

const removeSeasonImage = (season, key) => {
  const current = seasonImages[season] || { east: null, west: null, playoffs: null };
  const next = { ...seasonImages, [season]: { ...current, [key]: null } };
  saveSeasonImages(next);
};

  const processCSVContent = (content) => {
    try {
      const newPlayers = parsePlayersFromText(content);

      if (newPlayers.length === 0) {
        Alert.alert('Error', 'No valid players found in CSV file.');
        return;
      }

      // Store pending data and show season selector
      setImportType('players');
      setPendingImportData(newPlayers);
      setShowSeasonModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to parse CSV: ' + error.message);
    }
  };

  const processGoalieCSVContent = (content) => {
    try {
      const newGoalies = parseGoaliesFromText(content);

      if (newGoalies.length === 0) {
        Alert.alert('Error', 'No valid goalies found in CSV file.');
        return;
      }

      // Calculate league average SV% from imported goalies for GSAA
      const totalSaves = newGoalies.reduce((sum, g) => sum + (g.sha - g.ga), 0);
      const totalShots = newGoalies.reduce((sum, g) => sum + g.sha, 0);
      const importLeagueAvgSvPct = totalShots > 0 ? totalSaves / totalShots : 0.905;
      
      // Add GSAA to each goalie
      newGoalies.forEach(g => {
        const expectedGoals = g.sha * (1 - importLeagueAvgSvPct);
        g.gsaa = expectedGoals - g.ga;
      });

      // Store pending data and show season selector
      setImportType('goalies');
      setPendingGoalieData(newGoalies);
      setShowSeasonModal(true);
    } catch (error) {
      Alert.alert('Error', 'Failed to parse goalie CSV: ' + error.message);
    }
  };

  const clearAllData = async () => {
    try {
      await storageRemoveItem('playerDatabase');
      await storageRemoveItem('goalieDatabase');
      await storageRemoveItem('myRoster');
      await storageRemoveItem('seasonImages');
      setPlayerDatabase([]);
      setGoalieDatabase([]);
      setMyRoster([]);
      setSeasonImages({});
      if (Platform.OS === 'web') {
        window.alert('All data cleared.');
      } else {
        Alert.alert('Success', 'All data cleared.');
      }
    } catch (error) {
      if (Platform.OS === 'web') {
        window.alert('Failed to clear data.');
      } else {
        Alert.alert('Error', 'Failed to clear data.');
      }
    }
  };

  const confirmImport = (season) => {
    const inferSeasonType = (rows) => {
      if (!rows || rows.length === 0) return importSeasonType;
      const maxGp = rows.reduce((max, r) => {
        const gp = Number(r.gp);
        return Math.max(max, Number.isFinite(gp) ? gp : 0);
      }, 0);
      return maxGp >= 50 ? 'regular' : 'playoffs';
    };
    const effectiveSeasonType =
      importType === 'goalies'
        ? inferSeasonType(pendingGoalieData)
        : inferSeasonType(pendingImportData);
    const normalizedSeason = normalizeSeasonValue(season);

    if (importType === 'goalies' && pendingGoalieData) {
      // Handle goalie import
      const goalieMap = new Map();
      
      goalieDatabase.forEach(goalie => {
        const name = goalie.name.toLowerCase().trim();
        if (!goalieMap.has(name)) {
          goalieMap.set(name, { name: goalie.name, seasons: [] });
        }
        goalieMap.get(name).seasons.push({
          ...goalie,
          season: goalie.season || '2024-25',
          seasonType: goalie.seasonType || 'regular',
        });
      });

      pendingGoalieData.forEach(newGoalie => {
        const name = newGoalie.name.toLowerCase().trim();
        if (!goalieMap.has(name)) {
          goalieMap.set(name, {
            name: newGoalie.name,
            seasons: [{ ...newGoalie, season: normalizedSeason, seasonType: effectiveSeasonType }]
          });
        } else {
          const existing = goalieMap.get(name);
          const seasonIndex = existing.seasons.findIndex(
            s => normalizeSeasonValue(s.season) === normalizedSeason && (s.seasonType || 'regular') === effectiveSeasonType
          );
          if (seasonIndex === -1) {
            existing.seasons.push({ ...newGoalie, season: normalizedSeason, seasonType: effectiveSeasonType });
          } else {
            existing.seasons[seasonIndex] = { ...newGoalie, season: normalizedSeason, seasonType: effectiveSeasonType };
          }
        }
      });

      const mergedGoalies = Array.from(goalieMap.values()).flatMap(g => 
        g.seasons.map(s => ({ ...s, name: g.name }))
      );

      saveGoalies(mergedGoalies);
      
      if (Platform.OS === 'web') {
        window.alert(`Imported ${pendingGoalieData.length} goalies for ${season}`);
      } else {
        Alert.alert('Success!', `Imported ${pendingGoalieData.length} goalies for ${season}`);
      }
      
      setPendingGoalieData(null);
      setShowSeasonModal(false);
      setSelectedSeason(normalizedSeason);
      return;
    }

    if (!pendingImportData) return;

    // Create a map of existing players by name
    const playerMap = new Map();
    
    // Add existing players to map
    playerDatabase.forEach(player => {
      const name = player.name.toLowerCase().trim();
      if (!playerMap.has(name)) {
        playerMap.set(name, {
          name: player.name,
          seasons: []
        });
      }
      playerMap.get(name).seasons.push({
        ...player,
        season: player.season || '2024-25',
        seasonType: player.seasonType || 'regular',
      });
    });

    // Add or merge new players
    pendingImportData.forEach(newPlayer => {
      const name = newPlayer.name.toLowerCase().trim();
      
      if (!playerMap.has(name)) {
        // New player - create entry
        playerMap.set(name, {
          name: newPlayer.name,
          seasons: [{
            ...newPlayer,
            season: normalizedSeason,
            seasonType: effectiveSeasonType,
          }]
        });
      } else {
        // Existing player - add this season's data
        const existing = playerMap.get(name);
        // Check if this season already exists for this player
        const seasonExists = existing.seasons.some(
          s => normalizeSeasonValue(s.season) === normalizedSeason && (s.seasonType || 'regular') === effectiveSeasonType
        );
        
        if (!seasonExists) {
          existing.seasons.push({
            ...newPlayer,
            season: normalizedSeason,
            seasonType: effectiveSeasonType,
          });
        } else {
          // Replace existing season data
          const seasonIndex = existing.seasons.findIndex(
            s => normalizeSeasonValue(s.season) === normalizedSeason && (s.seasonType || 'regular') === effectiveSeasonType
          );
          existing.seasons[seasonIndex] = {
            ...newPlayer,
            season: normalizedSeason,
            seasonType: effectiveSeasonType,
          };
        }
      }
    });

    // Convert map back to array format for storage
    const mergedPlayers = Array.from(playerMap.values()).flatMap(player => 
      player.seasons.map(seasonData => ({
        ...seasonData,
        name: player.name
      }))
    );

    savePlayers(mergedPlayers);
    
    const newPlayerCount = pendingImportData.length;
    const uniquePlayerCount = playerMap.size;
    const savedForSeasonType = mergedPlayers.filter(
      p => normalizeSeasonValue(p.season || '2024-25') === normalizedSeason &&
        (p.seasonType || 'regular') === effectiveSeasonType
    ).length;
    
    if (Platform.OS === 'web') {
      window.alert(
        `Imported ${newPlayerCount} player records for ${season} season\n(${uniquePlayerCount} unique players)\nSaved ${savedForSeasonType} as ${effectiveSeasonType}`
      );
    } else {
      Alert.alert(
        'Success!', 
        `Imported ${newPlayerCount} player records for ${season} season\n(${uniquePlayerCount} unique players)\nSaved ${savedForSeasonType} as ${effectiveSeasonType}`
      );
    }
    
    setImportText('');
    setPendingImportData(null);
    setShowSeasonModal(false);
    setShowCustomSeasonInput(false);
    setCustomSeasonText('');
    setSelectedSeason(normalizedSeason);
    setActiveTab('truei');
  };

  // Helper function to check if position is defenseman
  const isDefensemanPos = (pos) => {
    const p = String(pos || '').toUpperCase();
    return p.includes('LD') || p.includes('RD');
  };

  const normalizeSeasonType = (value) => {
    const t = String(value || 'regular').trim().toLowerCase();
    if (t === 'playoffs' || t === 'playoff' || t === 'postseason' || t === 'po') {
      return 'playoffs';
    }
    return 'regular';
  };

  const getSeasonType = (record) => normalizeSeasonType(record?.seasonType);

  const matchesPositionFilter = (pos, filter) => {
    if (!filter || filter === 'All') return true;
    const tokens = String(pos || '')
      .toUpperCase()
      .split('/')
      .map(t => t.trim())
      .filter(Boolean);
    const primary = tokens[0] || '';
    if (filter === 'F') return primary === 'C' || primary === 'LW' || primary === 'RW';
    if (filter === 'C') return primary === 'C';
    if (filter === 'LW') return primary === 'LW';
    if (filter === 'RW') return primary === 'RW';
    if (filter === 'D') return primary === 'D' || primary === 'LD' || primary === 'RD';
    return false;
  };

  // Helper function to get team stats for adjustments
  const getTeamStats = (team, season, players) => {
    const teammates = players.filter(p => 
      p.team === team && 
      normalizeSeasonValue(p.season || '2024-25') === normalizeSeasonValue(season) &&
      p.gp > 0
    );
    
    if (teammates.length < 3) return null;
    
    const forwards = teammates.filter(p => !isDefensemanPos(p.pos));
    const defensemen = teammates.filter(p => isDefensemanPos(p.pos));
    
    // Calculate averages
    const teamAvgPlusMinus = teammates.reduce((sum, p) => sum + (p.plusMinus || 0), 0) / teammates.length;
    
    // Shots per game by position type
    const fwdShotsPerGame = forwards.length > 0 
      ? forwards.map(p => p.sog / p.gp)
      : [];
    const defShotsPerGame = defensemen.length > 0
      ? defensemen.map(p => p.sog / p.gp)
      : [];
    
    // EVTOI by position type  
    const fwdEvToi = forwards.length > 0
      ? forwards.map(p => p.atoi - p.appt - p.apkt)
      : [];
    const defEvToi = defensemen.length > 0
      ? defensemen.map(p => p.atoi - p.appt - p.apkt)
      : [];
    
    const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const stdev = arr => {
      if (arr.length < 2) return 0.1;
      const mean = avg(arr);
      const squareDiffs = arr.map(x => Math.pow(x - mean, 2));
      return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / (arr.length - 1)) || 0.1;
    };
    
    return {
      teamAvgPlusMinus,
      fwdAvgShots: avg(fwdShotsPerGame),
      fwdStdevShots: stdev(fwdShotsPerGame),
      defAvgShots: avg(defShotsPerGame),
      defStdevShots: stdev(defShotsPerGame),
      fwdAvgEvToi: avg(fwdEvToi),
      defAvgEvToi: avg(defEvToi),
    };
  };

  const calculateTRUEi = (player, allPlayers = playerDatabase) => {
    const isDefenseman = isDefensemanPos(player.pos);
    const isCenter = player.pos.toUpperCase().startsWith('C');
    
    // Shooting value with capped downside (scaled by position)
    const expectedSPct = isDefenseman ? 0.0222 : 0.1325;
    const shootingFloor = isDefenseman ? -0.0084 : -0.05;
    const shootingDiff = Math.max((player.sPct / 100) - expectedSPct, shootingFloor);
    const shootingValue = player.sog * shootingDiff;
    
    let baseValue = (
      player.g + 
      (player.a * 0.7) + 
      (player.ta * 0.15) - 
      (player.ga * 0.075) +
      (player.ht * 0.025) +
      shootingValue -
      (player.pim * 0.12) - 
      (player.ppp * 0.25)
    );

    // TRUEi 6.0 Faceoff value for centers - uses estimated faceoffs based on ice time
    if (isCenter && player.foPct > 30 && player.foPct < 70) {
      const evToi = player.atoi - player.appt - player.apkt;
      const estimatedFaceoffs = ((evToi * 0.819) + ((player.apkt + player.appt) * 1.229)) * player.gp;
      const faceoffValue = estimatedFaceoffs * (player.foPct - 50) / 50;
      baseValue += faceoffValue * 0.05;
    }

    // Pro-rate to 82 games
    const perGame = baseValue / player.gp;
    
    let trueiValue;
    if (isDefenseman) {
      const multiplier = Math.max(1.18, Math.min(1.51, 1.18 + ((player.atoi - 13) / 15) * 0.33));
      trueiValue = perGame * multiplier * 82;
    } else {
      trueiValue = perGame * 82;
    }

    // TRUEi 6.0 Team Adjustments
    const teamStats = getTeamStats(player.team, player.season || '2024-25', allPlayers);
    
    if (teamStats) {
      // 1. Plus/Minus Adjustment (BA1 * BB2)
      const playerPlusMinus = player.plusMinus || 0;
      const plusMinusDiff = playerPlusMinus - teamStats.teamAvgPlusMinus;
      
      const playerEvToi = player.atoi - player.appt - player.apkt;
      const avgEvToi = isDefenseman ? teamStats.defAvgEvToi : teamStats.fwdAvgEvToi;
      const evToiRatio = avgEvToi > 0 ? (playerEvToi / avgEvToi) - 1 : 0;
      const clampedRatio = Math.max(-0.2, Math.min(0.2, evToiRatio));
      
      // BB calculation: sign(+/-diff) * sqrt(|+/-diff|) * TOI modifier
      const sign = plusMinusDiff >= 0 ? 1 : -1;
      const sameDirection = (plusMinusDiff >= 0) === (evToiRatio >= 0);
      const toiModifier = sameDirection 
        ? 1 + 0.6 * Math.sqrt(Math.abs(clampedRatio))
        : 1 - 0.6 * Math.sqrt(Math.abs(clampedRatio));
      
      const bbValue = sign * Math.sqrt(Math.abs(plusMinusDiff)) * toiModifier;
      
      // BA1 is approximately 1.4 (scaling coefficient)
      const ba1 = 1.41;
      trueiValue += ba1 * bbValue;
      
      // 2. Shot Rate Z-Score
      const playerShotsPerGame = player.sog / player.gp;
      const avgShots = isDefenseman ? teamStats.defAvgShots : teamStats.fwdAvgShots;
      const stdevShots = isDefenseman ? teamStats.defStdevShots : teamStats.fwdStdevShots;
      
      const zScore = (playerShotsPerGame - avgShots) / Math.max(0.1, stdevShots);
      const shotAdjustment = Math.max(-3.5, Math.min(3.5, Math.tanh(zScore) * 3.5));
      trueiValue += shotAdjustment;
    }

    return trueiValue.toFixed(2);
  };

  const calculatePlayoffSuccess = () => {
    const sf = parseFloat(playoffStats.shotsFor82) || 0;
    const sPct = parseFloat(playoffStats.shootingPct) || 0;
    const sa = parseFloat(playoffStats.shotsAgainst82) || 0;
    const svPct = parseFloat(playoffStats.goalieSvPct) || 0;
    const truei = parseFloat(playoffStats.teamTRUEi) || 0;
    
    const leagueAvgSPct = 9.2;
    const leagueAvgSvPct = 90.8;
    
    const predictor = 
      (sf * sPct / 100) - 
      (sa * (1 - svPct / 100)) +
      0.5 * sf * ((sPct / 100) - (leagueAvgSPct / 100)) +
      0.5 * sa * ((svPct / 100) - (leagueAvgSvPct / 100)) +
      3 * truei;

    return predictor.toFixed(2);
  };

  // Auto-detect available seasons from player AND goalie database (both regular + playoffs)
  const availableSeasons = React.useMemo(() => {
    const seasons = new Set();
    playerDatabase.forEach(player => {
      if (player.season) {
        seasons.add(normalizeSeasonValue(player.season));
      }
    });
    goalieDatabase.forEach(goalie => {
      if (goalie.season) {
        seasons.add(normalizeSeasonValue(goalie.season));
      }
    });
    const seasonArray = Array.from(seasons).sort().reverse();
    // If no data, return empty - dropdowns will use generated list
    return seasonArray;
  }, [playerDatabase, goalieDatabase]);

  // Group players by name and show all their seasons
  const groupedPlayers = React.useMemo(() => {
    const groups = new Map();
    
    playerDatabase.forEach(player => {
      const name = player.name.toLowerCase().trim();
      if (!groups.has(name)) {
        groups.set(name, {
          name: player.name,
          seasons: []
        });
      }
      groups.get(name).seasons.push(player);
    });
    
    // Sort seasons within each player (most recent first)
    groups.forEach(group => {
      group.seasons.sort((a, b) => {
        const seasonA = normalizeSeasonValue(a.season || '2024-25');
        const seasonB = normalizeSeasonValue(b.season || '2024-25');
        return seasonB.localeCompare(seasonA);
      });
    });
    
    return Array.from(groups.values());
  }, [playerDatabase]);

  // Memoized stats data to prevent recalculation on every render
  const statsData = useMemo(() => {
    const dataSeasons = (() => {
      const seasons = new Set();
      playerDatabase.forEach(p => {
        if (getSeasonType(p) === statsSeasonType) {
          seasons.add(normalizeSeasonValue(p.season || '2024-25'));
        }
      });
      goalieDatabase.forEach(g => {
        if (getSeasonType(g) === statsSeasonType) {
          seasons.add(normalizeSeasonValue(g.season || '2024-25'));
        }
      });
      return Array.from(seasons).sort().reverse();
    })();

    const seasonsForType = generateAllSeasons();
    const defaultSeason = dataSeasons[0] || seasonsForType[seasonsForType.length - 1] || '2024-25';
    const startSeason = seasonsForType.includes(statsSeasonStart) ? statsSeasonStart : defaultSeason;
    const endSeason = seasonsForType.includes(statsSeasonEnd) ? statsSeasonEnd : defaultSeason;
    const startIdx = seasonsForType.indexOf(startSeason);
    const endIdx = seasonsForType.indexOf(endSeason);
    const fromIdx = startIdx === -1 ? 0 : Math.min(startIdx, endIdx === -1 ? startIdx : endIdx);
    const toIdx = endIdx === -1 ? fromIdx : Math.max(startIdx, endIdx);
    const seasonsToUse = seasonsForType.length > 0 ? seasonsForType.slice(fromIdx, toIdx + 1) : [defaultSeason];
    
    // Calculate league avg SV% for GSAA
    const allGoaliesForAvg = goalieDatabase.filter(
      g => seasonsToUse.includes(normalizeSeasonValue(g.season || '2024-25')) && getSeasonType(g) === statsSeasonType
    );
    const totalSaves = allGoaliesForAvg.reduce((sum, g) => sum + (g.sha - g.ga), 0);
    const totalShots = allGoaliesForAvg.reduce((sum, g) => sum + g.sha, 0);
    const leagueAvgSvPct = totalShots > 0 ? totalSaves / totalShots : 0.905;
    
    // Aggregate skater stats
    const aggregateSkaterStats = () => {
      const playerMap = new Map();
      
      playerDatabase
        .filter(p =>
          seasonsToUse.includes(normalizeSeasonValue(p.season || '2024-25')) &&
          getSeasonType(p) === statsSeasonType &&
          (statsTeamFilter === 'All' || p.team === statsTeamFilter) &&
          matchesPositionFilter(p.pos, statsPositionFilter)
        )
        .forEach(p => {
          const key = p.name.toLowerCase();
          if (!playerMap.has(key)) {
            playerMap.set(key, {
              name: p.name,
              team: p.team,
              pos: p.pos,
              seasons: 0,
              gp: 0, g: 0, a: 0, p: 0, plusMinus: 0, pim: 0,
              ppp: 0, shp: 0, ht: 0, ga: 0, ta: 0, sog: 0, sb: 0,
              totalSPct: 0, totalFoPct: 0, foPctCount: 0,
              atoi: 0, appt: 0, apkt: 0,
              trueiTotal: 0,
            });
          }
          const agg = playerMap.get(key);
          agg.seasons++;
          agg.gp += p.gp || 0;
          agg.g += p.g || 0;
          agg.a += p.a || 0;
          agg.p += p.p || 0;
          agg.plusMinus += p.plusMinus || 0;
          agg.pim += p.pim || 0;
          agg.ppp += p.ppp || 0;
          agg.shp += p.shp || 0;
          agg.ht += p.ht || 0;
          agg.ga += p.ga || 0;
          agg.ta += p.ta || 0;
          agg.sog += p.sog || 0;
          agg.sb += p.sb || 0;
          agg.totalSPct += (p.sPct || 0) * (p.gp || 0);
          if (p.foPct > 0) {
            agg.totalFoPct += (p.foPct || 0) * (p.gp || 0);
            agg.foPctCount += p.gp || 0;
          }
          agg.atoi += (p.atoi || 0) * (p.gp || 0);
          agg.appt += (p.appt || 0) * (p.gp || 0);
          agg.apkt += (p.apkt || 0) * (p.gp || 0);
          const seasonTruei = parseFloat(calculateTRUEi(p)) || 0;
          agg.trueiTotal += seasonTruei * (p.gp || 0);
          agg.team = p.team;
          agg.pos = p.pos;
        });
      
      return Array.from(playerMap.values()).map(p => {
        const draftInfo = getDraftInfo(p.name);
        return {
          ...p,
          sPct: p.sog > 0 ? (p.g / p.sog) * 100 : 0,
          foPct: p.foPctCount > 0 ? p.totalFoPct / p.foPctCount : 0,
          avgAtoi: p.gp > 0 ? p.atoi / p.gp : 0,
          avgAppt: p.gp > 0 ? p.appt / p.gp : 0,
          avgApkt: p.gp > 0 ? p.apkt / p.gp : 0,
          truei: p.gp > 0 ? p.trueiTotal / p.gp : 0,
          draftYear: draftInfo?.draftYear || 0,
          draftRound: draftInfo?.round || 999,
          draftPick: draftInfo?.overall || 999,
          pregen: draftInfo?.pregen || '',
        };
      });
    };

    const aggregateGoalieStats = () => {
      const goalieMap = new Map();
      
      goalieDatabase
        .filter(g =>
          seasonsToUse.includes(normalizeSeasonValue(g.season || '2024-25')) &&
          getSeasonType(g) === statsSeasonType &&
          (statsTeamFilter === 'All' || g.team === statsTeamFilter)
        )
        .forEach(g => {
          const key = g.name.toLowerCase();
          if (!goalieMap.has(key)) {
            goalieMap.set(key, {
              name: g.name,
              team: g.team,
              seasons: 0,
              gp: 0, w: 0, l: 0, t: 0, sha: 0, ga: 0, so: 0,
              g: 0, a: 0, p: 0, pim: 0, toi: 0, gaaWeighted: 0,
            });
          }
          const agg = goalieMap.get(key);
          agg.seasons++;
          agg.gp += g.gp || 0;
          agg.w += g.w || 0;
          agg.l += g.l || 0;
          agg.t += g.t || 0;
          agg.sha += g.sha || 0;
          agg.ga += g.ga || 0;
          agg.so += g.so || 0;
          agg.g += g.g || 0;
          agg.a += g.a || 0;
          agg.p += (g.g || 0) + (g.a || 0);
          agg.pim += g.pim || 0;
          agg.toi += parseInt(g.toi) || 0;
          // Weight GAA by games played for proper aggregation
          agg.gaaWeighted += (g.gaa || 0) * (g.gp || 0);
          agg.team = g.team;
        });
      
      return Array.from(goalieMap.values()).map(g => {
        return {
          ...g,
          svPct: g.sha > 0 ? (g.sha - g.ga) / g.sha : 0,
          gaa: g.gp > 0 ? g.gaaWeighted / g.gp : 0,
          gsaa: calculateGSAA({ sha: g.sha, ga: g.ga }, leagueAvgSvPct),
          toi: g.toi,
        };
      });
    };

    // Raw (per-season) rows when "Sum Results" is OFF
    const buildSkaterRows = () => {
      return playerDatabase
        .filter(p =>
          seasonsToUse.includes(normalizeSeasonValue(p.season || '2024-25')) &&
          getSeasonType(p) === statsSeasonType &&
          (statsTeamFilter === 'All' || p.team === statsTeamFilter) &&
          matchesPositionFilter(p.pos, statsPositionFilter)
        )
        .map(p => {
          const gp = p.gp || 0;
          const g = p.g || 0;
          const a = p.a || 0;
          const pts = (p.p ?? (g + a)) || 0;
          const sog = p.sog || 0;
          const sPct = sog > 0 ? (g / sog) * 100 : 0;
          const truei = parseFloat(calculateTRUEi(p, playerDatabase)) || 0;
          const draftInfo = getDraftInfo(p.name);
          return {
            name: p.name,
            team: p.team,
            pos: p.pos,
            season: normalizeSeasonValue(p.season || '2024-25'),
            seasons: 1,
            gp,
            g,
            a,
            p: pts,
            plusMinus: p.plusMinus || 0,
            pim: p.pim || 0,
            ppp: p.ppp || 0,
            shp: p.shp || 0,
            ht: p.ht || 0,
            ga: p.ga || 0,
            ta: p.ta || 0,
            sog,
            sb: p.sb || 0,
            sPct,
            foPct: p.foPct || 0,
            avgAtoi: p.atoi || 0,
            avgAppt: p.appt || 0,
            avgApkt: p.apkt || 0,
            truei,
            draftYear: draftInfo?.draftYear || 0,
            draftRound: draftInfo?.round || 999,
            draftPick: draftInfo?.overall || 999,
            pregen: draftInfo?.pregen || '',
          };
        });
    };

    const buildGoalieRows = () => {
      return goalieDatabase
        .filter(g =>
          seasonsToUse.includes(normalizeSeasonValue(g.season || '2024-25')) &&
          getSeasonType(g) === statsSeasonType &&
          (statsTeamFilter === 'All' || g.team === statsTeamFilter)
        )
        .map(g => {
          const sha = g.sha || 0;
          const ga = g.ga || 0;
          const svPct = sha > 0 ? (sha - ga) / sha : 0;
          const gaa = g.gaa || 0;
          return {
            name: g.name,
            team: g.team,
            season: normalizeSeasonValue(g.season || '2024-25'),
            seasons: 1,
            gp: g.gp || 0,
            w: g.w || 0,
            l: g.l || 0,
            t: g.t || 0,
            sha,
            ga,
            svPct,
            gaa,
            so: g.so || 0,
            gsaa: calculateGSAA(g, leagueAvgSvPct),
            g: g.g || 0,
            a: g.a || 0,
            p: (g.g || 0) + (g.a || 0),
            pim: g.pim || 0,
            toi: g.toi || 0,
          };
        });
    };

    const skaterData = statsSumResults ? aggregateSkaterStats() : buildSkaterRows();
    const goalieData = statsSumResults ? aggregateGoalieStats() : buildGoalieRows();

    return {
      dataSeasons,
      seasonsForType,
      seasonsToUse,
      leagueAvgSvPct,
      skaterData,
      goalieData,
    };
  }, [playerDatabase, goalieDatabase, statsSeasonType, statsSeasonStart, statsSeasonEnd, statsSumResults, statsTeamFilter, statsPositionFilter]);

  // Memoized sorted data
  const sortedStatsData = useMemo(() => {
    if (!statsData || !statsData.skaterData || !statsData.goalieData) {
      return { sortedSkaters: [], sortedGoalies: [] };
    }
    const { skaterData, goalieData } = statsData;
    
    // Apply search filter
    const searchLower = statsSearchQuery.toLowerCase();
    let filteredSkaters = statsSearchQuery 
      ? skaterData.filter(p => p.name.toLowerCase().includes(searchLower))
      : skaterData;
    const filteredGoalies = statsSearchQuery
      ? goalieData.filter(g => g.name.toLowerCase().includes(searchLower))
      : goalieData;
    
    // Apply draft filters
    if (statsDraftYearFilter !== 'All') {
      filteredSkaters = filteredSkaters.filter(p => p.draftYear === parseInt(statsDraftYearFilter));
    }
    if (statsDraftRoundFilter !== 'All') {
      filteredSkaters = filteredSkaters.filter(p => p.draftRound === parseInt(statsDraftRoundFilter));
    }
    if (statsDraftPickFilter !== 'All') {
      filteredSkaters = filteredSkaters.filter(p => p.draftPick === parseInt(statsDraftPickFilter));
    }
    
    // Check if any draft filter is active
    const hasDraftFilter = statsDraftYearFilter !== 'All' || statsDraftRoundFilter !== 'All' || statsDraftPickFilter !== 'All';
    
    // Draft columns that trigger compound sort (primary: draft column, secondary: TRUEi desc)
    const draftColumns = ['draftYear', 'draftRound', 'draftPick', 'pregen'];
    const isDraftSort = draftColumns.includes(statsSortColumn);
    
    const sortedSkaters = [...filteredSkaters].sort((a, b) => {
      // If draft filter is active, always sort by TRUEi descending
      if (hasDraftFilter) {
        return (b.truei || 0) - (a.truei || 0);
      }
      
      // For draft columns, do compound sort: primary by draft column, secondary by TRUEi desc
      if (isDraftSort) {
        let valA = a[statsSortColumn];
        let valB = b[statsSortColumn];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        
        // Primary sort
        if (valA < valB) return statsSortAsc ? -1 : 1;
        if (valA > valB) return statsSortAsc ? 1 : -1;
        
        // Secondary sort by TRUEi (descending)
        return (b.truei || 0) - (a.truei || 0);
      }
      
      // Normal single-column sort for non-draft columns
      let valA = a[statsSortColumn];
      let valB = b[statsSortColumn];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return statsSortAsc ? -1 : 1;
      if (valA > valB) return statsSortAsc ? 1 : -1;
      return 0;
    });

    const sortedGoalies = [...filteredGoalies].sort((a, b) => {
      let valA = a[statsSortColumn];
      let valB = b[statsSortColumn];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return statsSortAsc ? -1 : 1;
      if (valA > valB) return statsSortAsc ? 1 : -1;
      return 0;
    });

    return { sortedSkaters, sortedGoalies };
  }, [statsData, statsSortColumn, statsSortAsc, statsSearchQuery, statsDraftYearFilter, statsDraftRoundFilter, statsDraftPickFilter]);

  const filteredPlayerGroups = groupedPlayers.filter(group => 
    group.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    group.seasons.some(s => s.team.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const renderImportTab = () => (
    <View style={styles.tabContent}>
      <Text style={styles.title}>Import Data</Text>

      {/* Season Type */}
      <View style={styles.statsToggleRow}>
        <TouchableOpacity
          style={[styles.statsToggleBtn, importSeasonType === 'regular' && styles.statsToggleBtnActive]}
          onPress={() => setImportSeasonType('regular')}
        >
          <Text style={[styles.statsToggleText, importSeasonType === 'regular' && styles.statsToggleTextActive]}>
            Regular Season
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statsToggleBtn, importSeasonType === 'playoffs' && styles.statsToggleBtnActive]}
          onPress={() => setImportSeasonType('playoffs')}
        >
          <Text style={[styles.statsToggleText, importSeasonType === 'playoffs' && styles.statsToggleTextActive]}>
            Playoffs
          </Text>
        </TouchableOpacity>
      </View>
      
      {/* Player CSV Upload */}
      <View style={styles.uploadSection}>
        <Text style={styles.sectionLabel}>Players CSV (from rgmg.ca/stats)</Text>
        <TouchableOpacity style={styles.uploadButton} onPress={handleCSVUpload}>
          <Text style={styles.buttonText}>Upload Players CSV</Text>
        </TouchableOpacity>
        {playerDatabase.length > 0 && (
          <Text style={styles.uploadHint}>{playerDatabase.length} players loaded</Text>
        )}
      </View>

      {/* Goalie CSV Upload */}
      <View style={styles.uploadSection}>
        <Text style={styles.sectionLabel}>Goalies CSV (from rgmg.ca/stats)</Text>
        <TouchableOpacity style={[styles.uploadButton, {backgroundColor: '#1565c0'}]} onPress={handleGoalieCSVUpload}>
          <Text style={styles.buttonText}>Upload Goalies CSV</Text>
        </TouchableOpacity>
        {goalieDatabase.length > 0 && (
          <Text style={styles.uploadHint}>{goalieDatabase.length} goalies loaded</Text>
        )}
      </View>

      {/* Data Debug */}
      <View style={[styles.uploadSection, { backgroundColor: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e0e0e0' }]}>
        <Text style={styles.sectionLabel}>Data Debug</Text>
        {(() => {
          const summarize = (rows) => {
            const seasonCounts = {};
            const typeCounts = { regular: 0, playoffs: 0 };
            rows.forEach(r => {
              const season = r.season || '2024-25';
              seasonCounts[season] = (seasonCounts[season] || 0) + 1;
              const t = r.seasonType || 'regular';
              if (t === 'playoffs') typeCounts.playoffs += 1;
              else typeCounts.regular += 1;
            });
            const seasons = Object.keys(seasonCounts).sort();
            return { seasons, seasonCounts, typeCounts };
          };

          const skaters = summarize(playerDatabase);
          const goalies = summarize(goalieDatabase);
          const selectedSkatersRegular = playerDatabase.filter(
            p => normalizeSeasonValue(p.season || '2024-25') === normalizeSeasonValue(selectedSeason) && getSeasonType(p) === 'regular'
          ).length;
          const selectedSkatersPlayoffs = playerDatabase.filter(
            p => normalizeSeasonValue(p.season || '2024-25') === normalizeSeasonValue(selectedSeason) && getSeasonType(p) === 'playoffs'
          ).length;
          const selectedGoaliesRegular = goalieDatabase.filter(
            g => normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(selectedSeason) && getSeasonType(g) === 'regular'
          ).length;
          const selectedGoaliesPlayoffs = goalieDatabase.filter(
            g => normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(selectedSeason) && getSeasonType(g) === 'playoffs'
          ).length;

          return (
            <View>
              <Text style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>
                Skaters seasons: {skaters.seasons.length > 0 ? skaters.seasons.join(', ') : 'none'}
              </Text>
              <Text style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>
                Goalies seasons: {goalies.seasons.length > 0 ? goalies.seasons.join(', ') : 'none'}
              </Text>
              <Text style={{ fontSize: 12, color: '#444', marginBottom: 6 }}>
                Selected season ({formatSeasonLabel(selectedSeason)}): skaters regular/playoffs {selectedSkatersRegular}/{selectedSkatersPlayoffs}, goalies regular/playoffs {selectedGoaliesRegular}/{selectedGoaliesPlayoffs}
              </Text>
              <Text style={{ fontSize: 12, color: '#666' }}>
                Skaters (regular/playoffs): {skaters.typeCounts.regular}/{skaters.typeCounts.playoffs} | Goalies (regular/playoffs): {goalies.typeCounts.regular}/{goalies.typeCounts.playoffs}
              </Text>
            </View>
          );
        })()}
      </View>

{/* Season Images (Eastern / Western / Playoffs) */}
<View style={styles.uploadSection}>
  <Text style={styles.sectionLabel}>Season Images (standings + playoffs)</Text>
  <Text style={styles.uploadHint}>Paste image URLs per season (Eastern, Western, Playoffs).</Text>
  <View style={{ marginTop: 10 }}>
    <Text style={styles.filterLabel}>Season:</Text>
    <View style={{ backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#ddd', maxHeight: 150 }}>
      <ScrollView nestedScrollEnabled>
        {(() => {
          const seasons = generateAllSeasons();
          const importedSet = new Set(availableSeasons);
          
          return seasons.map(season => (
            <TouchableOpacity
              key={season}
              style={{
                padding: 10,
                borderBottomWidth: 1,
                borderBottomColor: '#eee',
                backgroundColor: selectedSeason === season ? '#e3f2fd' : importedSet.has(season) ? '#f0f7ff' : '#fff',
              }}
              onPress={() => setSelectedSeason(season)}
            >
              <Text style={{
                fontSize: 14,
                fontWeight: selectedSeason === season ? '700' : importedSet.has(season) ? '600' : '400',
                color: selectedSeason === season ? '#1565c0' : importedSet.has(season) ? '#1976d2' : '#333',
              }}>
                {formatSeasonLabel(season)}{importedSet.has(season) ? ' ✓' : ''}
              </Text>
            </TouchableOpacity>
          ));
        })()}
      </ScrollView>
    </View>
    <Text style={{ marginTop: 8, fontSize: 13, color: '#666' }}>Selected: {formatSeasonLabel(selectedSeason)}</Text>
  </View>

  {/* Use selectedSeason as the season bucket */}
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 10 }}>
    {['east', 'west', 'playoffs'].map((key) => {
      const label = key === 'east' ? 'Eastern Standings' : key === 'west' ? 'Western Standings' : 'Playoffs';
      const hasImg = !!(seasonImages[selectedSeason] && seasonImages[selectedSeason][key]);
      const draftValue =
        (seasonImageDrafts[selectedSeason] && seasonImageDrafts[selectedSeason][key]) ||
        (seasonImages[selectedSeason] && seasonImages[selectedSeason][key]) ||
        '';
      return (
        <View key={key} style={{ width: '100%' }}>
          <Text style={{ fontWeight: '700', marginBottom: 6 }}>{label}</Text>
          <TextInput
            style={[styles.input, { marginBottom: 8 }]}
            placeholder="https://... (image URL)"
            value={draftValue}
            onChangeText={(text) => {
              setSeasonImageDrafts(prev => ({
                ...prev,
                [selectedSeason]: {
                  ...(prev[selectedSeason] || {}),
                  [key]: text,
                },
              }));
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <TouchableOpacity
              style={[styles.uploadButton, { backgroundColor: '#2e7d32' }]}
              onPress={() => {
                const current = seasonImages[selectedSeason] || { east: null, west: null, playoffs: null };
                const next = {
                  ...seasonImages,
                  [selectedSeason]: { ...current, [key]: draftValue.trim() || null },
                };
                saveSeasonImages(next);
              }}
            >
              <Text style={styles.buttonText}>Save URL</Text>
            </TouchableOpacity>

            {hasImg && (
              <TouchableOpacity
                style={[styles.uploadButton, { backgroundColor: '#c62828' }]}
                onPress={() => removeSeasonImage(selectedSeason, key)}
              >
                <Text style={styles.buttonText}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    })}
  </View>
</View>
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR PASTE</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Paste Option */}
      <View style={styles.pasteSection}>
        <Text style={styles.sectionLabel}>Paste Player Data</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Paste player data here..."
          multiline
          value={importText}
          onChangeText={setImportText}
          numberOfLines={6}
        />
        <TouchableOpacity style={styles.button} onPress={handleImport}>
          <Text style={styles.buttonText}>Import Players</Text>
        </TouchableOpacity>
      </View>

      {(playerDatabase.length > 0 || goalieDatabase.length > 0) && (
        <View style={styles.statsBox}>
          <Text style={styles.statsText}>
            {playerDatabase.length} players, {goalieDatabase.length} goalies
          </Text>
          <TouchableOpacity onPress={() => {
            if (Platform.OS === 'web') {
              if (window.confirm('Delete all imported data?')) {
                clearAllData();
              }
            } else {
              Alert.alert(
                'Clear All Data?',
                'This will delete all imported players, goalies, and roster.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: clearAllData }
                ]
              );
            }
          }}>
            <Text style={styles.clearText}>Clear All</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderTRUEiTab = () => {
    // Get league average SV% for GSAA calculation
    const seasonGoaliesForCalc = goalieDatabase.filter(g => 
      normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(selectedSeason)
    );
    const totalSavesCalc = seasonGoaliesForCalc.reduce((sum, g) => sum + (g.sha - g.ga), 0);
    const totalShotsCalc = seasonGoaliesForCalc.reduce((sum, g) => sum + g.sha, 0);
    const leagueAvgSvPctCalc = totalShotsCalc > 0 ? totalSavesCalc / totalShotsCalc : 0.905;
    
    // Filter goalies by search
    const filteredGoalies = goalieDatabase.filter(g => 
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.team?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    // Group goalies by name
    const groupedGoalies = filteredGoalies.reduce((acc, goalie) => {
      const existing = acc.find(g => g.name.toLowerCase() === goalie.name.toLowerCase());
      if (existing) {
        existing.seasons.push(goalie);
      } else {
        acc.push({ name: goalie.name, seasons: [goalie], isGoalie: true });
      }
      return acc;
    }, []);

    // Combine players and goalies for search results
    const combinedResults = [...filteredPlayerGroups, ...groupedGoalies].slice(0, 20);

    return (
    <View style={styles.tabContent}>
      <Text style={styles.title}>TRUEi Calculator</Text>
      
      {playerDatabase.length === 0 && goalieDatabase.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Loading data...</Text>
          <Text style={styles.emptySubtext}>Please wait</Text>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Search player or goalie..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <FlatList
            data={combinedResults}
            keyExtractor={(item, idx) => `${item.name}-${idx}`}
            renderItem={({ item: playerGroup }) => (
              <View style={styles.playerGroupCard}>
                <Text style={styles.playerGroupName}>
                  {playerGroup.name} {playerGroup.isGoalie && '🥅'}
                </Text>
                {playerGroup.seasons.map((player, index) => (
                  playerGroup.isGoalie ? (
                    // Goalie card
                    <View key={`${player.season}-${index}`} style={styles.seasonCard}>
                      <View style={styles.seasonInfo}>
                        <Text style={styles.seasonBadge}>{player.season || '2024-25'}</Text>
                        <Text style={styles.playerDetails}>
                          {player.team} • G • {player.gp}GP
                        </Text>
                        <View style={styles.statsGrid}>
                          <Text style={styles.playerStats}>
                            {player.w}W {player.l}L {player.t}T • {player.so}SO
                          </Text>
                          <Text style={styles.playerStats}>
                            GAA: {player.gaa?.toFixed(2)} • SV%: {(player.svPct * 100).toFixed(1)}%
                          </Text>
                          <Text style={styles.playerStats}>
                            SA: {player.sha} • GA: {player.ga}
                          </Text>
                          {(player.g > 0 || player.a > 0) && (
                            <Text style={styles.playerStats}>
                              {player.g}G {player.a}A {player.p || (player.g + player.a)}P • {player.pim || 0}PIM
                            </Text>
                          )}
                          <Text style={[styles.playerStats, { fontWeight: 'bold', marginTop: 5 }]}>
                            GSAA: {calculateGSAA(player, leagueAvgSvPctCalc).toFixed(1)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    // Player card (original)
                  <TouchableOpacity
                    key={`${player.season}-${index}`}
                    style={styles.seasonCard}
                    onPress={() => {
                      setSelectedPlayer(player);
                      const result = calculateTRUEi(player);
                      setTrueiResult(result);
                    }}
                  >
                    <View style={styles.seasonInfo}>
                      <Text style={styles.seasonBadge}>{player.season || '2024-25'}</Text>
                      <Text style={styles.playerDetails}>
                        {player.team} • {player.pos} • {player.gp}GP
                      </Text>
                      <View style={styles.statsGrid}>
                        <Text style={styles.playerStats}>
                          {player.g}G {player.a}A {player.p}P {player.plusMinus >= 0 ? '+' : ''}{player.plusMinus}
                        </Text>
                        <Text style={styles.playerStats}>>
                          {player.pim}PIM • {player.ppp}PPP • {player.shp}SHP
                        </Text>
                        <Text style={styles.playerStats}>
                          {player.sog}SOG ({player.sPct?.toFixed(1)}%) • {player.ht}Hits
                        </Text>
                        <Text style={styles.playerStats}>
                          {player.ta}TA • {player.ga}GA • {player.sb}SB
                        </Text>
                        <Text style={styles.playerStats}>
                          {formatMinutesToTime(player.atoi)} TOI • {formatMinutesToTime(player.appt)} PPT • {formatMinutesToTime(player.apkt)} PKT
                        </Text>
                        {player.foPct > 0 && (
                          <Text style={styles.playerStats}>
                            FO%: {player.foPct.toFixed(1)}%
                          </Text>
                        )}
                      </View>
                    </View>
                    {selectedPlayer === player && trueiResult && (
                      <View style={styles.trueiResult}>
                        <Text style={styles.trueiText}>TRUEi: {trueiResult}</Text>
                        
                        {/* Inline Analysis */}
                        {(() => {
                          // Calculate analysis for this player
                          const isDefenseman = isDefensemanPos(player.pos);
                          const toi = player.atoi;
                          
                          // Get replacement level
                          let replacementLevel, expectedTruei;
                          if (isDefenseman) {
                            if (toi >= 22) { replacementLevel = '1st Pair'; expectedTruei = 65.0; }
                            else if (toi >= 18) { replacementLevel = '2nd Pair'; expectedTruei = 37.4; }
                            else { replacementLevel = '3rd Pair'; expectedTruei = 20.1; }
                          } else {
                            if (toi >= 17) { replacementLevel = '1st Line'; expectedTruei = 66.6; }
                            else if (toi >= 14) { replacementLevel = '2nd Line'; expectedTruei = 45.6; }
                            else if (toi >= 12) { replacementLevel = '3rd Line'; expectedTruei = 26.8; }
                            else { replacementLevel = '4th Line'; expectedTruei = 21.8; }
                          }
                          
                          const vsReplacement = parseFloat(trueiResult) - expectedTruei;
                          
                          // Get delta if previous season exists
                          const previousSeason = playerGroup.seasons.find(s => s.season !== player.season);
                          let delta = null;
                          if (previousSeason) {
                            const prevTruei = parseFloat(calculateTRUEi(previousSeason));
                            delta = parseFloat(trueiResult) - prevTruei;
                          }
                          
                          return (
                            <View style={styles.inlineAnalysis}>
                              <Text style={styles.analysisTitle}>📊 Analysis:</Text>
                              
                              {delta !== null && (
                                <Text style={styles.analysisLine}>
                                  • Delta: {delta >= 0 ? '↑ +' : '↓ '}{delta.toFixed(1)} 
                                  {Math.abs(delta) > 3 ? (delta > 0 ? ' 🟢 RISER' : ' 🔴 FALLER') : ''}
                                </Text>
                              )}
                              
                              <Text style={styles.analysisLine}>
                                • TOI: {toi.toFixed(1)} min ({replacementLevel} usage)
                              </Text>
                              
                              <Text style={styles.analysisLine}>
                                • vs Expected: {trueiResult} vs {expectedTruei.toFixed(1)} = {vsReplacement >= 0 ? '+' : ''}{vsReplacement.toFixed(1)}
                                {Math.abs(vsReplacement) > 5 ? (vsReplacement > 0 ? ' ⭐' : ' ⚠️') : ''}
                              </Text>
                              
                              {Math.abs(vsReplacement) > 5 && (
                                <Text style={[styles.analysisVerdict, vsReplacement > 0 ? styles.verdictPositive : styles.verdictNegative]}>
                                  {vsReplacement > 0 
                                    ? '✅ Outperforming role - consider promoting'
                                    : '🔴 Not earning ice time - trade candidate'}
                                </Text>
                              )}
                            </View>
                          );
                        })()}
                      </View>
                    )}
                  </TouchableOpacity>
                  )
                ))}
              </View>
            )}
          />
        </>
      )}
    </View>
  );
  };

  const StatsDropdown = ({ label, value, options, onChange }) => {
    const [open, setOpen] = useState(false);
    const displayValue = formatSeasonLabel(value);

    return (
      <View style={styles.dropdownWrapper}>
        {label ? <Text style={styles.filterLabel}>{label}</Text> : null}
        <TouchableOpacity style={styles.dropdownButton} onPress={() => setOpen(true)}>
          <Text style={styles.dropdownButtonText}>{displayValue}</Text>
        </TouchableOpacity>
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
            <View style={styles.dropdownModal} onStartShouldSetResponder={() => true}>
              <ScrollView>
                {options.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={styles.dropdownItem}
                    onPress={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownItemText}>{formatSeasonLabel(opt)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };

  // NHL teams list for filtering
  const nhlTeams = [
    'Avalanche', 'Blackhawks', 'Blue Jackets', 'Blues', 'Bruins', 'Canadiens',
    'Canucks', 'Capitals', 'Coyotes', 'Devils', 'Ducks', 'Flames', 'Flyers',
    'Hurricanes', 'Islanders', 'Jets', 'Kings', 'Lightning', 'Maple Leafs',
    'Oilers', 'Panthers', 'Penguins', 'Predators', 'Rangers', 'Red Wings',
    'Sabres', 'Senators', 'Sharks', 'Stars', 'Wild', 'Kraken', 'Golden Knights'
  ];

  // Stats Tab - comprehensive stats with multi-season support
  const renderStatsTab = () => {
    // Use memoized data with safety defaults
    const { 
      dataSeasons = [], 
      seasonsForType = [], 
      seasonsToUse = [], 
      leagueAvgSvPct = 0.905, 
      skaterData = [], 
      goalieData = [] 
    } = statsData || {};
    const { sortedSkaters = [], sortedGoalies = [] } = sortedStatsData || {};
    
    // Default to most recent season with data, or latest possible season
    const defaultSeason = dataSeasons[0] || seasonsForType[seasonsForType.length - 1] || '2024-25';
    
    const handleSort = (column) => {
      if (statsSortColumn === column) {
        setStatsSortAsc(!statsSortAsc);
      } else {
        setStatsSortColumn(column);
        setStatsSortAsc(false);
      }
    };
    
    const SortHeader = ({ column, label }) => (
      <TouchableOpacity onPress={() => handleSort(column)}>
        <Text style={[styles.statsHeaderCell, statsSortColumn === column && styles.statsHeaderActive]}>
          {label} {statsSortColumn === column ? (statsSortAsc ? '^' : 'v') : ''}
        </Text>
      </TouchableOpacity>
    );

    // Get unique draft values from data for dropdowns
    const draftYears = ['All', ...Array.from(new Set(skaterData.filter(p => p.draftYear > 0).map(p => p.draftYear))).sort((a, b) => b - a)];
    const draftRounds = ['All', ...Array.from(new Set(skaterData.filter(p => p.draftRound < 999).map(p => p.draftRound))).sort((a, b) => a - b)];
    const draftPicks = ['All', ...Array.from(new Set(skaterData.filter(p => p.draftPick < 999).map(p => p.draftPick))).sort((a, b) => a - b)];

    const DraftFilterHeader = ({ type, label, value, options, onSelect, showDropdown, setShowDropdown }) => (
      <View style={{ position: 'relative', zIndex: showDropdown ? 1000 : 1 }}>
        <TouchableOpacity 
          onPress={() => {
            setShowDraftYearDropdown(false);
            setShowDraftRoundDropdown(false);
            setShowDraftPickDropdown(false);
            setShowDropdown(!showDropdown);
          }}
          style={[
            styles.statsHeaderCell,
            { 
              minWidth: 50, 
              backgroundColor: value !== 'All' ? '#4caf50' : 'transparent',
              borderRadius: 4,
              paddingHorizontal: 4,
            }
          ]}
        >
          <Text style={[
            styles.statsHeaderCell, 
            { color: value !== 'All' ? '#fff' : '#fff' }
          ]}>
            {value !== 'All' ? value : label} ▾
          </Text>
        </TouchableOpacity>
        
        {showDropdown && (
          <Modal
            transparent={true}
            visible={showDropdown}
            onRequestClose={() => setShowDropdown(false)}
          >
            <TouchableOpacity 
              style={styles.dropdownOverlay}
              activeOpacity={1}
              onPress={() => setShowDropdown(false)}
            >
              <View style={[styles.dropdownModal, { maxHeight: 350 }]}>
                <Text style={{ fontWeight: '700', fontSize: 14, marginBottom: 10 }}>
                  {label === 'Yr' ? 'Draft Year' : label === 'Rd' ? 'Draft Round' : 'Draft Pick'}
                </Text>
                <ScrollView>
                  {options.map((opt, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.dropdownItem,
                        opt === value && { backgroundColor: '#e3f2fd' }
                      ]}
                      onPress={() => {
                        onSelect(opt);
                        setShowDropdown(false);
                        setStatsCurrentPage(0);
                      }}
                    >
                      <Text style={[
                        styles.dropdownItemText,
                        opt === value && { fontWeight: '700', color: '#1a1a2e' }
                      ]}>
                        {opt === 'All' ? `All ${label === 'Yr' ? 'Years' : label === 'Rd' ? 'Rounds' : 'Picks'}` : opt}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        )}
      </View>
    );

    return (
      <View style={styles.tabContent}>
        <Text style={styles.title}>Stats Leaders</Text>
        
        {/* View Toggle */}
        <View style={styles.statsToggleRow}>
          <TouchableOpacity
            style={[styles.statsToggleBtn, statsView === 'skaters' && styles.statsToggleBtnActive]}
            onPress={() => { setStatsView('skaters'); setStatsSortColumn('truei'); }}
          >
            <Text style={[styles.statsToggleText, statsView === 'skaters' && styles.statsToggleTextActive]}>Skaters</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statsToggleBtn, statsView === 'goalies' && styles.statsToggleBtnActive]}
            onPress={() => { setStatsView('goalies'); setStatsSortColumn('gsaa'); }}
          >
            <Text style={[styles.statsToggleText, statsView === 'goalies' && styles.statsToggleTextActive]}>Goalies</Text>
          </TouchableOpacity>
        </View>

        {/* Filters */}
        <View style={styles.statsFiltersRow}>
          <StatsDropdown
            label="Season Type"
            value={statsSeasonType === 'playoffs' ? 'Playoffs' : 'Regular Season'}
            options={['Regular Season', 'Playoffs']}
            onChange={(opt) => setStatsSeasonType(opt === 'Playoffs' ? 'playoffs' : 'regular')}
          />
          <StatsDropdown
            label="Start Season"
            value={statsSeasonStart || defaultSeason}
            options={seasonsForType.length > 0 ? seasonsForType : [defaultSeason]}
            onChange={(val) => {
              setStatsSeasonStart(val);
              // If end season is now before start, update it
              if (statsSeasonEnd && val > statsSeasonEnd) {
                setStatsSeasonEnd(val);
              }
            }}
          />
          <StatsDropdown
            label="End Season"
            value={statsSeasonEnd || defaultSeason}
            options={seasonsForType.length > 0 
              ? seasonsForType.filter(s => s >= (statsSeasonStart || defaultSeason))
              : [defaultSeason]}
            onChange={setStatsSeasonEnd}
          />
          <StatsDropdown
            label="Franchise"
            value={statsTeamFilter}
            options={['All', ...nhlTeams]}
            onChange={setStatsTeamFilter}
          />
          {statsView === 'skaters' && (
            <StatsDropdown
              label="Position"
              value={statsPositionFilter}
              options={['All', 'F', 'C', 'LW', 'RW', 'D']}
              onChange={setStatsPositionFilter}
            />
          )}
          <View style={{ minWidth: 150 }}>
            <Text style={styles.filterLabel}>Search</Text>
            <TextInput
              style={{
                backgroundColor: '#fff',
                borderWidth: 1,
                borderColor: '#e0e0e0',
                borderRadius: 10,
                paddingVertical: 10,
                paddingHorizontal: 14,
                fontSize: 13,
                color: '#333',
              }}
              placeholder="Player name..."
              placeholderTextColor="#999"
              value={statsSearchQuery}
              onChangeText={setStatsSearchQuery}
            />
          </View>
        </View>

        {/* NHL.com style "Sum Results" toggle (OFF by default) */}
        <View style={styles.sumResultsRow}>
          <TouchableOpacity
            style={styles.sumResultsToggle}
            onPress={() => setStatsSumResults(!statsSumResults)}
          >
            <View style={[styles.checkboxBox, statsSumResults && styles.checkboxBoxChecked]}>
              {statsSumResults ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={styles.sumResultsLabel}>Sum Results</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>
          {statsSeasonType === 'playoffs' ? 'Playoffs' : 'Regular Season'} | {statsSeasonStart || defaultSeason} to {statsSeasonEnd || defaultSeason}
          {seasonsToUse.length > 1 ? (statsSumResults ? ' (Totals combined)' : ' (By season)') : ''}
          {statsTeamFilter !== 'All' ? ` | Team: ${statsTeamFilter}` : ''}
          {statsView === 'skaters' && statsPositionFilter !== 'All' ? ` | Pos: ${statsPositionFilter}` : ''}
        </Text>
        {(() => {
          const otherType = statsSeasonType === 'regular' ? 'playoffs' : 'regular';
          const otherSkaters = playerDatabase.filter(
            p => seasonsToUse.includes(normalizeSeasonValue(p.season || '2024-25')) && getSeasonType(p) === otherType
          ).length;
          const otherGoalies = goalieDatabase.filter(
            g => seasonsToUse.includes(normalizeSeasonValue(g.season || '2024-25')) && getSeasonType(g) === otherType
          ).length;
          return (
            <>
              <Text style={styles.legendText}>
                Filtered skaters: {skaterData.length} | Filtered goalies: {goalieData.length}
              </Text>
              <Text style={styles.legendText}>
                Other season type ({otherType}): {otherSkaters} skaters | {otherGoalies} goalies
              </Text>
            </>
          );
        })()}

        {/* Skaters Table */}
        {statsView === 'skaters' && (() => {
          const totalPages = Math.ceil(sortedSkaters.length / statsPerPage);
          const startIdx = statsCurrentPage * statsPerPage;
          const endIdx = startIdx + statsPerPage;
          const pageSkaters = sortedSkaters.slice(startIdx, endIdx);
          
          return (
          <>
            {/* Pagination Controls */}
            <View style={styles.paginationRow}>
              <View style={styles.paginationLeft}>
                <Text style={styles.paginationLabel}>Per page:</Text>
                {[25, 50, 100].map(num => (
                  <TouchableOpacity
                    key={num}
                    style={[styles.paginationBtn, statsPerPage === num && styles.paginationBtnActive]}
                    onPress={() => { setStatsPerPage(num); setStatsCurrentPage(0); }}
                  >
                    <Text style={[styles.paginationBtnText, statsPerPage === num && styles.paginationBtnTextActive]}>{num}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.paginationRight}>
                <TouchableOpacity
                  style={[styles.paginationNavBtn, statsCurrentPage === 0 && styles.paginationNavBtnDisabled]}
                  onPress={() => setStatsCurrentPage(Math.max(0, statsCurrentPage - 1))}
                  disabled={statsCurrentPage === 0}
                >
                  <Text style={styles.paginationNavText}>◀ Back</Text>
                </TouchableOpacity>
                <Text style={styles.paginationInfo}>
                  {startIdx + 1}-{Math.min(endIdx, sortedSkaters.length)} of {sortedSkaters.length}
                </Text>
                <TouchableOpacity
                  style={[styles.paginationNavBtn, statsCurrentPage >= totalPages - 1 && styles.paginationNavBtnDisabled]}
                  onPress={() => setStatsCurrentPage(Math.min(totalPages - 1, statsCurrentPage + 1))}
                  disabled={statsCurrentPage >= totalPages - 1}
                >
                  <Text style={styles.paginationNavText}>Next ▶</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView horizontal>
              <View>
                <View style={styles.statsHeaderRow}>
                  <Text style={[styles.statsHeaderCell, styles.statsNameCell]}>Player</Text>
                  <Text style={[styles.statsHeaderCell, styles.statsTeamCell]}>Team</Text>
                  <Text style={[styles.statsHeaderCell, styles.statsPosCell]}>Pos</Text>
                  {!statsSumResults && <SortHeader column="season" label="Season" />}
                  <SortHeader column="gp" label="GP" />
                  <SortHeader column="truei" label="TRUEi" />
                  <SortHeader column="g" label="G" />
                  <SortHeader column="a" label="A" />
                  <SortHeader column="p" label="P" />
                  <SortHeader column="plusMinus" label="+/-" />
                  <SortHeader column="pim" label="PIM" />
                  <SortHeader column="ppp" label="PPP" />
                  <SortHeader column="shp" label="SHP" />
                  <SortHeader column="ht" label="HIT" />
                  <SortHeader column="ga" label="GA" />
                  <SortHeader column="ta" label="TA" />
                  <SortHeader column="sog" label="SOG" />
                  <SortHeader column="sPct" label="S%" />
                  <SortHeader column="sb" label="SB" />
                  <SortHeader column="avgAtoi" label="ATOI" />
                  <SortHeader column="avgAppt" label="APPT" />
                  <SortHeader column="avgApkt" label="APKT" />
                  <SortHeader column="foPct" label="FO%" />
                  <DraftFilterHeader 
                    type="year" 
                    label="Yr" 
                    value={statsDraftYearFilter} 
                    options={draftYears} 
                    onSelect={setStatsDraftYearFilter}
                    showDropdown={showDraftYearDropdown}
                    setShowDropdown={setShowDraftYearDropdown}
                  />
                  <DraftFilterHeader 
                    type="round" 
                    label="Rd" 
                    value={statsDraftRoundFilter} 
                    options={draftRounds} 
                    onSelect={setStatsDraftRoundFilter}
                    showDropdown={showDraftRoundDropdown}
                    setShowDropdown={setShowDraftRoundDropdown}
                  />
                  <DraftFilterHeader 
                    type="pick" 
                    label="Pick" 
                    value={statsDraftPickFilter} 
                    options={draftPicks} 
                    onSelect={setStatsDraftPickFilter}
                    showDropdown={showDraftPickDropdown}
                    setShowDropdown={setShowDraftPickDropdown}
                  />
                  <Text style={[styles.statsHeaderCell, { minWidth: 100 }]}>Pregen</Text>
                </View>
                {pageSkaters.map((p, idx) => {
                  const isExpanded = statsExpandedPlayer === p.name.toLowerCase();
                  const playerSeasons = playerDatabase.filter(
                    ps => ps.name.toLowerCase() === p.name.toLowerCase() &&
                      seasonsToUse.includes(normalizeSeasonValue(ps.season || '2024-25')) &&
                      getSeasonType(ps) === statsSeasonType
                  ).sort((a, b) => normalizeSeasonValue(b.season || '2024-25').localeCompare(normalizeSeasonValue(a.season || '2024-25')));
                  
                  // Calculate totals for this player
                  const totals = playerSeasons.reduce((acc, ps) => ({
                    gp: acc.gp + (ps.gp || 0),
                    g: acc.g + (ps.g || 0),
                    a: acc.a + (ps.a || 0),
                    p: acc.p + (ps.p || 0),
                    plusMinus: acc.plusMinus + (ps.plusMinus || 0),
                    pim: acc.pim + (ps.pim || 0),
                    ppp: acc.ppp + (ps.ppp || 0),
                    shp: acc.shp + (ps.shp || 0),
                    ht: acc.ht + (ps.ht || 0),
                    ga: acc.ga + (ps.ga || 0),
                    ta: acc.ta + (ps.ta || 0),
                    sog: acc.sog + (ps.sog || 0),
                    sb: acc.sb + (ps.sb || 0),
                    atoiWeighted: acc.atoiWeighted + ((ps.atoi || 0) * (ps.gp || 0)),
                    apptWeighted: acc.apptWeighted + ((ps.appt || 0) * (ps.gp || 0)),
                    apktWeighted: acc.apktWeighted + ((ps.apkt || 0) * (ps.gp || 0)),
                    foPctWeighted: acc.foPctWeighted + ((ps.foPct || 0) * (ps.gp || 0)),
                    foPctGames: acc.foPctGames + (ps.foPct > 0 ? (ps.gp || 0) : 0),
                    trueiWeighted: acc.trueiWeighted + ((parseFloat(calculateTRUEi(ps)) || 0) * (ps.gp || 0)),
                  }), { gp: 0, g: 0, a: 0, p: 0, plusMinus: 0, pim: 0, ppp: 0, shp: 0, ht: 0, ga: 0, ta: 0, sog: 0, sb: 0, atoiWeighted: 0, apptWeighted: 0, apktWeighted: 0, foPctWeighted: 0, foPctGames: 0, trueiWeighted: 0 });
                  
                  const avgAtoi = totals.gp > 0 ? totals.atoiWeighted / totals.gp : 0;
                  const avgAppt = totals.gp > 0 ? totals.apptWeighted / totals.gp : 0;
                  const avgApkt = totals.gp > 0 ? totals.apktWeighted / totals.gp : 0;
                  const avgFoPct = totals.foPctGames > 0 ? totals.foPctWeighted / totals.foPctGames : 0;
                  const avgTruei = totals.gp > 0 ? totals.trueiWeighted / totals.gp : 0;
                  const avgSPct = totals.sog > 0 ? (totals.g / totals.sog) * 100 : 0;

                  return (
                    <View key={idx}>
                      {/* Main player row - clickable */}
                      <TouchableOpacity 
                        onPress={() => setStatsExpandedPlayer(isExpanded ? null : p.name.toLowerCase())}
                        style={[styles.statsDataRow, idx % 2 === 0 && styles.statsDataRowAlt]}
                      >
                        <Text style={[styles.statsCell, styles.statsNameCell, { fontWeight: '500' }]} numberOfLines={1}>
                          {isExpanded ? '▼ ' : '▶ '}{p.name}
                        </Text>
                        <Text style={[styles.statsCell, styles.statsTeamCell]}>{p.team}</Text>
                        <Text style={[styles.statsCell, styles.statsPosCell]}>{p.pos}</Text>
                        {!statsSumResults && <Text style={styles.statsCell}>{p.season}</Text>}
                        <Text style={styles.statsCell}>{p.gp}</Text>
                        <Text style={[styles.statsCell, styles.statsBold, p.truei >= 50 ? styles.positiveValue : p.truei < 25 ? styles.negativeValue : null]}>
                          {p.truei.toFixed(1)}
                        </Text>
                        <Text style={styles.statsCell}>{p.g}</Text>
                        <Text style={styles.statsCell}>{p.a}</Text>
                        <Text style={[styles.statsCell, styles.statsBold]}>{p.p}</Text>
                        <Text style={[styles.statsCell, p.plusMinus >= 0 ? styles.positiveValue : styles.negativeValue]}>
                          {p.plusMinus >= 0 ? '+' : ''}{p.plusMinus}
                        </Text>
                        <Text style={styles.statsCell}>{p.pim}</Text>
                        <Text style={styles.statsCell}>{p.ppp}</Text>
                        <Text style={styles.statsCell}>{p.shp}</Text>
                        <Text style={styles.statsCell}>{p.ht}</Text>
                        <Text style={styles.statsCell}>{p.ga}</Text>
                        <Text style={styles.statsCell}>{p.ta}</Text>
                        <Text style={styles.statsCell}>{p.sog}</Text>
                        <Text style={styles.statsCell}>{p.sPct.toFixed(1)}</Text>
                        <Text style={styles.statsCell}>{p.sb}</Text>
                        <Text style={styles.statsCell}>{formatMinutesToTime(p.avgAtoi)}</Text>
                        <Text style={styles.statsCell}>{formatMinutesToTime(p.avgAppt)}</Text>
                        <Text style={styles.statsCell}>{formatMinutesToTime(p.avgApkt)}</Text>
                        <Text style={styles.statsCell}>{p.foPct > 0 ? p.foPct.toFixed(1) : '-'}</Text>
                        <Text style={[styles.statsCell, { minWidth: 50 }]}>{p.draftYear > 0 ? p.draftYear : '-'}</Text>
                        <Text style={[styles.statsCell, { minWidth: 50 }]}>{p.draftRound < 999 ? p.draftRound : '-'}</Text>
                        <Text style={[styles.statsCell, { minWidth: 50 }]}>{p.draftPick < 999 ? p.draftPick : '-'}</Text>
                        <Text style={[styles.statsCell, { minWidth: 100 }]} numberOfLines={1}>{p.pregen || '-'}</Text>
                      </TouchableOpacity>
                      
                      {/* Expanded season rows */}
                      {isExpanded && playerSeasons.map((ps, sIdx) => {
                        const psTruei = parseFloat(calculateTRUEi(ps)) || 0;
                        const psSPct = ps.sog > 0 ? (ps.g / ps.sog) * 100 : 0;
                        return (
                          <View key={sIdx} style={[styles.statsDataRow, styles.statsExpandedRow]}>
                            <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontStyle: 'italic' }]} numberOfLines={1}>
                              {ps.season || '2024-25'}
                            </Text>
                            <Text style={[styles.statsCell, styles.statsTeamCell]}>{ps.team}</Text>
                            <Text style={[styles.statsCell, styles.statsPosCell]}>{ps.pos}</Text>
                            <Text style={styles.statsCell}>{ps.gp}</Text>
                            <Text style={[styles.statsCell, psTruei >= 50 ? styles.positiveValue : psTruei < 25 ? styles.negativeValue : null]}>
                              {psTruei.toFixed(1)}
                            </Text>
                            <Text style={styles.statsCell}>{ps.g}</Text>
                            <Text style={styles.statsCell}>{ps.a}</Text>
                            <Text style={styles.statsCell}>{ps.p}</Text>
                            <Text style={[styles.statsCell, ps.plusMinus >= 0 ? styles.positiveValue : styles.negativeValue]}>
                              {ps.plusMinus >= 0 ? '+' : ''}{ps.plusMinus}
                            </Text>
                            <Text style={styles.statsCell}>{ps.pim}</Text>
                            <Text style={styles.statsCell}>{ps.ppp}</Text>
                            <Text style={styles.statsCell}>{ps.shp}</Text>
                            <Text style={styles.statsCell}>{ps.ht}</Text>
                            <Text style={styles.statsCell}>{ps.ga}</Text>
                            <Text style={styles.statsCell}>{ps.ta}</Text>
                            <Text style={styles.statsCell}>{ps.sog}</Text>
                            <Text style={styles.statsCell}>{psSPct.toFixed(1)}</Text>
                            <Text style={styles.statsCell}>{ps.sb}</Text>
                            <Text style={styles.statsCell}>{formatMinutesToTime(ps.atoi)}</Text>
                            <Text style={styles.statsCell}>{formatMinutesToTime(ps.appt)}</Text>
                            <Text style={styles.statsCell}>{formatMinutesToTime(ps.apkt)}</Text>
                            <Text style={styles.statsCell}>{ps.foPct > 0 ? ps.foPct.toFixed(1) : '-'}</Text>
                            <Text style={[styles.statsCell, { minWidth: 50 }]}>-</Text>
                            <Text style={[styles.statsCell, { minWidth: 50 }]}>-</Text>
                            <Text style={[styles.statsCell, { minWidth: 100 }]}>-</Text>
                          </View>
                        );
                      })}
                      
                      {/* Totals row */}
                      {isExpanded && playerSeasons.length > 1 && (
                        <View style={[styles.statsDataRow, styles.statsTotalsRow]}>
                          <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontWeight: '700' }]} numberOfLines={1}>
                            TOTAL ({playerSeasons.length} seasons)
                          </Text>
                          <Text style={[styles.statsCell, styles.statsTeamCell]}>-</Text>
                          <Text style={[styles.statsCell, styles.statsPosCell]}>{p.pos}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.gp}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, avgTruei >= 50 ? styles.positiveValue : avgTruei < 25 ? styles.negativeValue : null]}>
                            {avgTruei.toFixed(1)}
                          </Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.g}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.a}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.p}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, totals.plusMinus >= 0 ? styles.positiveValue : styles.negativeValue]}>
                            {totals.plusMinus >= 0 ? '+' : ''}{totals.plusMinus}
                          </Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.pim}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.ppp}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.shp}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.ht}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.ga}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.ta}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.sog}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{avgSPct.toFixed(1)}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.sb}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{formatMinutesToTime(avgAtoi)}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{formatMinutesToTime(avgAppt)}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{formatMinutesToTime(avgApkt)}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{avgFoPct > 0 ? avgFoPct.toFixed(1) : '-'}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 50 }]}>{p.draftYear > 0 ? p.draftYear : '-'}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 50 }]}>{p.draftRound < 999 ? p.draftRound : '-'}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 50 }]}>{p.draftPick < 999 ? p.draftPick : '-'}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 100 }]} numberOfLines={1}>{p.pregen || '-'}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            
            {/* Bottom pagination */}
            <View style={styles.paginationRow}>
              <TouchableOpacity
                style={[styles.paginationNavBtn, statsCurrentPage === 0 && styles.paginationNavBtnDisabled]}
                onPress={() => setStatsCurrentPage(Math.max(0, statsCurrentPage - 1))}
                disabled={statsCurrentPage === 0}
              >
                <Text style={styles.paginationNavText}>◀ Back</Text>
              </TouchableOpacity>
              <Text style={styles.paginationInfo}>
                Page {statsCurrentPage + 1} of {totalPages}
              </Text>
              <TouchableOpacity
                style={[styles.paginationNavBtn, statsCurrentPage >= totalPages - 1 && styles.paginationNavBtnDisabled]}
                onPress={() => setStatsCurrentPage(Math.min(totalPages - 1, statsCurrentPage + 1))}
                disabled={statsCurrentPage >= totalPages - 1}
              >
                <Text style={styles.paginationNavText}>Next ▶</Text>
              </TouchableOpacity>
            </View>
          </>
          );
        })()}

        {/* Goalies Table */}
        {statsView === 'goalies' && (() => {
          const totalGoaliePages = Math.ceil(sortedGoalies.length / statsPerPage);
          const goalieStartIdx = statsCurrentPage * statsPerPage;
          const goalieEndIdx = goalieStartIdx + statsPerPage;
          const pageGoalies = sortedGoalies.slice(goalieStartIdx, goalieEndIdx);
          
          return (
          <>
            {/* Pagination Controls */}
            <View style={styles.paginationRow}>
              <View style={styles.paginationLeft}>
                <Text style={styles.paginationLabel}>Per page:</Text>
                {[25, 50, 100].map(num => (
                  <TouchableOpacity
                    key={num}
                    style={[styles.paginationBtn, statsPerPage === num && styles.paginationBtnActive]}
                    onPress={() => { setStatsPerPage(num); setStatsCurrentPage(0); }}
                  >
                    <Text style={[styles.paginationBtnText, statsPerPage === num && styles.paginationBtnTextActive]}>{num}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.paginationRight}>
                <TouchableOpacity
                  style={[styles.paginationNavBtn, statsCurrentPage === 0 && styles.paginationNavBtnDisabled]}
                  onPress={() => setStatsCurrentPage(Math.max(0, statsCurrentPage - 1))}
                  disabled={statsCurrentPage === 0}
                >
                  <Text style={styles.paginationNavText}>◀ Back</Text>
                </TouchableOpacity>
                <Text style={styles.paginationInfo}>
                  {goalieStartIdx + 1}-{Math.min(goalieEndIdx, sortedGoalies.length)} of {sortedGoalies.length}
                </Text>
                <TouchableOpacity
                  style={[styles.paginationNavBtn, statsCurrentPage >= totalGoaliePages - 1 && styles.paginationNavBtnDisabled]}
                  onPress={() => setStatsCurrentPage(Math.min(totalGoaliePages - 1, statsCurrentPage + 1))}
                  disabled={statsCurrentPage >= totalGoaliePages - 1}
                >
                  <Text style={styles.paginationNavText}>Next ▶</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView horizontal>
              <View>
                <View style={styles.statsHeaderRow}>
                  <Text style={[styles.statsHeaderCell, styles.statsNameCell]}>Goalie</Text>
                  <Text style={[styles.statsHeaderCell, styles.statsTeamCell]}>Team</Text>
                  {!statsSumResults && <SortHeader column="season" label="Season" />}
                  <SortHeader column="gp" label="GP" />
                  <SortHeader column="w" label="W" />
                  <SortHeader column="l" label="L" />
                  <SortHeader column="t" label="T" />
                  <SortHeader column="sha" label="SA" />
                  <SortHeader column="ga" label="GA" />
                  <SortHeader column="svPct" label="SV%" />
                  <SortHeader column="gaa" label="GAA" />
                  <SortHeader column="so" label="SO" />
                  <SortHeader column="gsaa" label="GSAA" />
                  <SortHeader column="toi" label="TOI" />
                  <SortHeader column="g" label="G" />
                  <SortHeader column="a" label="A" />
                  <SortHeader column="p" label="P" />
                  <SortHeader column="pim" label="PIM" />
                </View>
                {pageGoalies.map((g, idx) => {
                  const isExpanded = statsExpandedPlayer === g.name.toLowerCase();
                  const goalieSeasons = goalieDatabase.filter(
                    gs => gs.name.toLowerCase() === g.name.toLowerCase() &&
                      seasonsToUse.includes(normalizeSeasonValue(gs.season || '2024-25')) &&
                      getSeasonType(gs) === statsSeasonType
                  ).sort((a, b) => normalizeSeasonValue(b.season || '2024-25').localeCompare(normalizeSeasonValue(a.season || '2024-25')));
                  
                  // Calculate totals
                  const totals = goalieSeasons.reduce((acc, gs) => ({
                    gp: acc.gp + (gs.gp || 0),
                    w: acc.w + (gs.w || 0),
                    l: acc.l + (gs.l || 0),
                    t: acc.t + (gs.t || 0),
                    sha: acc.sha + (gs.sha || 0),
                    ga: acc.ga + (gs.ga || 0),
                    so: acc.so + (gs.so || 0),
                    g: acc.g + (gs.g || 0),
                    a: acc.a + (gs.a || 0),
                    pim: acc.pim + (gs.pim || 0),
                    toi: acc.toi + (parseInt(gs.toi) || 0),
                    gaaWeighted: acc.gaaWeighted + ((gs.gaa || 0) * (gs.gp || 0)),
                  }), { gp: 0, w: 0, l: 0, t: 0, sha: 0, ga: 0, so: 0, g: 0, a: 0, pim: 0, toi: 0, gaaWeighted: 0 });
                  
                  const totalSvPct = totals.sha > 0 ? (totals.sha - totals.ga) / totals.sha : 0;
                  const totalGaa = totals.gp > 0 ? totals.gaaWeighted / totals.gp : 0;
                  const totalGsaa = calculateGSAA({ sha: totals.sha, ga: totals.ga }, leagueAvgSvPct);

                  return (
                    <View key={idx}>
                      <TouchableOpacity
                        onPress={() => setStatsExpandedPlayer(isExpanded ? null : g.name.toLowerCase())}
                        style={[styles.statsDataRow, idx % 2 === 0 && styles.statsDataRowAlt]}
                      >
                        <Text style={[styles.statsCell, styles.statsNameCell, { fontWeight: '500' }]} numberOfLines={1}>
                          {isExpanded ? '▼ ' : '▶ '}{g.name}
                        </Text>
                        <Text style={[styles.statsCell, styles.statsTeamCell]}>{g.team}</Text>
                        {!statsSumResults && <Text style={styles.statsCell}>{g.season}</Text>}
                        <Text style={styles.statsCell}>{g.gp}</Text>
                        <Text style={[styles.statsCell, styles.statsBold]}>{g.w}</Text>
                        <Text style={styles.statsCell}>{g.l}</Text>
                        <Text style={styles.statsCell}>{g.t}</Text>
                        <Text style={styles.statsCell}>{g.sha}</Text>
                        <Text style={styles.statsCell}>{g.ga}</Text>
                        <Text style={styles.statsCell}>{(g.svPct * 100).toFixed(1)}%</Text>
                        <Text style={styles.statsCell}>{g.gaa.toFixed(2)}</Text>
                        <Text style={styles.statsCell}>{g.so}</Text>
                        <Text style={[styles.statsCell, g.gsaa >= 0 ? styles.positiveValue : styles.negativeValue]}>
                          {g.gsaa >= 0 ? '+' : ''}{g.gsaa.toFixed(1)}
                        </Text>
                        <Text style={styles.statsCell}>{g.toi || 0}</Text>
                        <Text style={styles.statsCell}>{g.g}</Text>
                        <Text style={styles.statsCell}>{g.a}</Text>
                        <Text style={styles.statsCell}>{g.p}</Text>
                        <Text style={styles.statsCell}>{g.pim}</Text>
                      </TouchableOpacity>
                      
                      {/* Expanded season rows */}
                      {isExpanded && goalieSeasons.map((gs, sIdx) => {
                        const gsSvPct = gs.sha > 0 ? (gs.sha - gs.ga) / gs.sha : 0;
                        const gsGaa = gs.gaa || 0;
                        const gsGsaa = calculateGSAA(gs, leagueAvgSvPct);
                        return (
                          <View key={sIdx} style={[styles.statsDataRow, styles.statsExpandedRow]}>
                            <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontStyle: 'italic' }]} numberOfLines={1}>
                              {gs.season || '2024-25'}
                            </Text>
                            <Text style={[styles.statsCell, styles.statsTeamCell]}>{gs.team}</Text>
                            <Text style={styles.statsCell}>{gs.gp}</Text>
                            <Text style={styles.statsCell}>{gs.w}</Text>
                            <Text style={styles.statsCell}>{gs.l}</Text>
                            <Text style={styles.statsCell}>{gs.t}</Text>
                            <Text style={styles.statsCell}>{gs.sha}</Text>
                            <Text style={styles.statsCell}>{gs.ga}</Text>
                            <Text style={styles.statsCell}>{(gsSvPct * 100).toFixed(1)}%</Text>
                            <Text style={styles.statsCell}>{gsGaa.toFixed(2)}</Text>
                            <Text style={styles.statsCell}>{gs.so}</Text>
                            <Text style={[styles.statsCell, gsGsaa >= 0 ? styles.positiveValue : styles.negativeValue]}>
                              {gsGsaa >= 0 ? '+' : ''}{gsGsaa.toFixed(1)}
                            </Text>
                            <Text style={styles.statsCell}>{gs.toi || 0}</Text>
                            <Text style={styles.statsCell}>{gs.g}</Text>
                            <Text style={styles.statsCell}>{gs.a}</Text>
                            <Text style={styles.statsCell}>{(gs.g || 0) + (gs.a || 0)}</Text>
                            <Text style={styles.statsCell}>{gs.pim}</Text>
                          </View>
                        );
                      })}
                      
                      {/* Totals row */}
                      {isExpanded && goalieSeasons.length > 1 && (
                        <View style={[styles.statsDataRow, styles.statsTotalsRow]}>
                          <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontWeight: '700' }]} numberOfLines={1}>
                            TOTAL ({goalieSeasons.length} seasons)
                          </Text>
                          <Text style={[styles.statsCell, styles.statsTeamCell]}>-</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.gp}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.w}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.l}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.t}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.sha}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.ga}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{(totalSvPct * 100).toFixed(1)}%</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totalGaa.toFixed(2)}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.so}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, totalGsaa >= 0 ? styles.positiveValue : styles.negativeValue]}>
                            {totalGsaa >= 0 ? '+' : ''}{totalGsaa.toFixed(1)}
                          </Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.toi}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.g}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.a}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.g + totals.a}</Text>
                          <Text style={[styles.statsCell, styles.statsBold]}>{totals.pim}</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            
            {/* Bottom pagination */}
            <View style={styles.paginationRow}>
              <TouchableOpacity
                style={[styles.paginationNavBtn, statsCurrentPage === 0 && styles.paginationNavBtnDisabled]}
                onPress={() => setStatsCurrentPage(Math.max(0, statsCurrentPage - 1))}
                disabled={statsCurrentPage === 0}
              >
                <Text style={styles.paginationNavText}>◀ Back</Text>
              </TouchableOpacity>
              <Text style={styles.paginationInfo}>
                Page {statsCurrentPage + 1} of {totalGoaliePages}
              </Text>
              <TouchableOpacity
                style={[styles.paginationNavBtn, statsCurrentPage >= totalGoaliePages - 1 && styles.paginationNavBtnDisabled]}
                onPress={() => setStatsCurrentPage(Math.min(totalGoaliePages - 1, statsCurrentPage + 1))}
                disabled={statsCurrentPage >= totalGoaliePages - 1}
              >
                <Text style={styles.paginationNavText}>Next ▶</Text>
              </TouchableOpacity>
            </View>
          </>
          );
        })()}

        <View style={styles.statsFooter}>
          <Text style={styles.legendText}>
            {statsView === 'skaters' ? `Total: ${skaterData.length} skaters` : `Total: ${goalieData.length} goalies`}
          </Text>
          <Text style={styles.legendText}>Tap column headers to sort • Tap player name to expand seasons • League Avg SV%: {(leagueAvgSvPct * 100).toFixed(1)}%</Text>
        </View>
      </View>
    );
  };

  const allTeams = useMemo(() => {
    const teams = new Set();
    playerDatabase.forEach(p => {
      if (getSeasonType(p) === rosterSeasonType && p.team && p.team.trim() && nhlTeams.includes(p.team.trim())) {
        teams.add(p.team.trim());
      }
    });
    return Array.from(teams).sort();
  }, [playerDatabase, rosterSeasonType]);

  const renderMyRosterTab = () => {
    const currentSeason = rosterSeason || (availableSeasons.length > 0 ? availableSeasons[0] : '2024-25');
    
    // Calculate league avg SV% for GSAA
    const seasonGoaliesForCalc = goalieDatabase.filter(g => 
      normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(currentSeason) && getSeasonType(g) === rosterSeasonType
    );
    const totalSaves = seasonGoaliesForCalc.reduce((sum, g) => sum + (g.sha - g.ga), 0);
    const totalShots = seasonGoaliesForCalc.reduce((sum, g) => sum + g.sha, 0);
    const leagueAvgSvPct = totalShots > 0 ? totalSaves / totalShots : 0.905;
    
    // Auto-load team roster function (now includes goalies)
    const loadTeamRoster = (teamName) => {
      const teamPlayers = playerDatabase.filter(p => 
        p.team === teamName && 
        normalizeSeasonValue(p.season || '2024-25') === normalizeSeasonValue(currentSeason) &&
        getSeasonType(p) === rosterSeasonType
      );
      
      const teamGoalies = goalieDatabase.filter(g =>
        g.team === teamName &&
        normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(currentSeason) &&
        getSeasonType(g) === rosterSeasonType
      );
      
      // Split into forwards and defensemen
      const forwards = teamPlayers
        .filter(p => !isDefensemanPos(p.pos))
        .sort((a, b) => b.gp - a.gp)
        .slice(0, 12);
      
      const defensemen = teamPlayers
        .filter(p => isDefensemanPos(p.pos))
        .sort((a, b) => b.gp - a.gp)
        .slice(0, 6);
      
      // Top 2 goalies by GP
      const topGoalies = teamGoalies
        .sort((a, b) => b.gp - a.gp)
        .slice(0, 2);
      
      const rosterNames = [...forwards, ...defensemen].map(p => p.name);
      const goalieNames = topGoalies.map(g => g.name);
      
      saveRoster({ skaters: rosterNames, goalies: goalieNames });
    };
    
    // Handle both old format (array) and new format (object with skaters/goalies)
    const rosterSkaters = Array.isArray(myRoster) ? myRoster : (myRoster.skaters || []);
    const rosterGoalies = Array.isArray(myRoster) ? [] : (myRoster.goalies || []);
    
    // Get latest season data for roster skaters
    const rosterWithStats = rosterSkaters.map(playerName => {
      const playerGroup = groupedPlayers.find(p => 
        p.name.toLowerCase() === playerName.toLowerCase()
      );
      
      if (!playerGroup) return null;
      
      // Get most recent season
      const latestSeason = playerGroup.seasons.find(
        s => normalizeSeasonValue(s.season || '2024-25') === normalizeSeasonValue(currentSeason) && getSeasonType(s) === rosterSeasonType
      );
      if (!latestSeason) return null;
      
      const truei = parseFloat(calculateTRUEi(latestSeason));
      
      // Get replacement level
      const isDefenseman = isDefensemanPos(latestSeason.pos);
      const toi = latestSeason.atoi;
      let replacementLevel, expectedTruei;
      
      if (isDefenseman) {
        if (toi >= 22) { replacementLevel = '1st Pair'; expectedTruei = 65.0; }
        else if (toi >= 18) { replacementLevel = '2nd Pair'; expectedTruei = 37.4; }
        else { replacementLevel = '3rd Pair'; expectedTruei = 20.1; }
      } else {
        if (toi >= 17) { replacementLevel = '1st Line'; expectedTruei = 66.6; }
        else if (toi >= 14) { replacementLevel = '2nd Line'; expectedTruei = 45.6; }
        else if (toi >= 12) { replacementLevel = '3rd Line'; expectedTruei = 26.8; }
        else { replacementLevel = '4th Line'; expectedTruei = 21.8; }
      }
      
      return {
        ...latestSeason,
        truei,
        replacementLevel,
        expectedTruei,
        vsReplacement: truei - expectedTruei,
        type: 'skater'
      };
    }).filter(Boolean);
    
    // Get goalie stats for roster goalies
    const goaliesWithStats = rosterGoalies.map(goalieName => {
      const goalie = goalieDatabase.find(g =>
        g.name.toLowerCase() === goalieName.toLowerCase() &&
        normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(currentSeason) &&
        getSeasonType(g) === rosterSeasonType
      );
      
      if (!goalie) return null;
      
      const gsaa = calculateGSAA(goalie, leagueAvgSvPct);
      
      // Goalie replacement level based on games played
      let replacementLevel, expectedGSAA;
      if (goalie.gp >= 50) { replacementLevel = 'Starter'; expectedGSAA = 5.0; }
      else if (goalie.gp >= 25) { replacementLevel = '1A/1B'; expectedGSAA = 0.0; }
      else { replacementLevel = 'Backup'; expectedGSAA = -5.0; }
      
      return {
        ...goalie,
        gsaa,
        replacementLevel,
        expectedGSAA,
        vsReplacement: gsaa - expectedGSAA,
        type: 'goalie'
      };
    }).filter(Boolean);
    
    // Group skaters by position
    const forwards = rosterWithStats.filter(p => !isDefensemanPos(p.pos));
    const defensemen = rosterWithStats.filter(p => isDefensemanPos(p.pos));
    
    // Calculate team totals
    const totalTruei = rosterWithStats.reduce((sum, p) => sum + p.truei, 0);
    const avgTruei = rosterWithStats.length > 0 ? totalTruei / rosterWithStats.length : 0;
    const totalGSAA = goaliesWithStats.reduce((sum, g) => sum + g.gsaa, 0);
    
    // Calculate team shooting/shot stats
    const teamShotsFor = rosterWithStats.reduce((sum, p) => sum + (p.sog || 0), 0);
    const teamGames = rosterWithStats.length > 0 ? Math.max(...rosterWithStats.map(p => p.gp)) : 82;
    const sfPer82 = teamGames > 0 ? (teamShotsFor / teamGames) * 82 : 0;
    const teamGoals = rosterWithStats.reduce((sum, p) => sum + (p.g || 0), 0);
    const teamSPct = teamShotsFor > 0 ? (teamGoals / teamShotsFor) * 100 : 0;
    
    // Calculate shots against from goalies
    const totalSA = goaliesWithStats.reduce((sum, g) => sum + (g.sha || 0), 0);
    const totalGA = goaliesWithStats.reduce((sum, g) => sum + (g.ga || 0), 0);
    const goalieGames = goaliesWithStats.length > 0 ? goaliesWithStats.reduce((sum, g) => sum + g.gp, 0) : teamGames;
    const saPer82 = goalieGames > 0 ? (totalSA / goalieGames) * 82 : 0;
    const teamSvPct = totalSA > 0 ? ((totalSA - totalGA) / totalSA) * 100 : 90.0;
    
    // Calculate Playoff Predictor (match Teams tab logic: league-relative avgs + TRUEi percentile bonus)
    const rosterShotPct = teamShotsFor > 0 ? (teamGoals / teamShotsFor) : 0; // fraction
    const rosterSvPct = totalSA > 0 ? ((totalSA - totalGA) / totalSA) : 0.905; // fraction

    // Build league team stats for the same season/type so roster uses the same baseline as Teams tab.
    const leagueSeasonPlayers = playerDatabase.filter(p =>
      normalizeSeasonValue(p.season || '2024-25') === normalizeSeasonValue(currentSeason) &&
      getSeasonType(p) === rosterSeasonType
    );
    const leagueSeasonGoalies = goalieDatabase.filter(g =>
      normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(currentSeason) &&
      getSeasonType(g) === rosterSeasonType
    );

    const leagueTeams = Array.from(new Set(leagueSeasonPlayers.map(p => p.team).filter(Boolean)));
    const leagueTeamStats = leagueTeams.map(team => {
      const teamPlayers = leagueSeasonPlayers.filter(p => p.team === team);
      const teamGoalies = leagueSeasonGoalies.filter(g => g.team === team);
      if (teamPlayers.length === 0) return null;

      // Top-18 by GP for team TRUEi (same idea as Teams tab)
      const top18 = [...teamPlayers].sort((a, b) => (b.gp || 0) - (a.gp || 0)).slice(0, 18);
      // Compute team TRUEi using the same TRUEi function used elsewhere in the app.
      // (There is no calculateSimpleTRUEi in this codebase.)
      const teamTruei = top18.length
        ? top18.reduce((sum, p) => sum + parseFloat(calculateTRUEi(p, leagueSeasonPlayers)), 0) / top18.length
        : 0;

      // Team shooting pct + SF/82
      const teamSF = teamPlayers.reduce((sum, p) => sum + (p.sog || 0), 0);
      const teamG = teamPlayers.reduce((sum, p) => sum + (p.g || 0), 0);
      const maxGP = Math.max(...teamPlayers.map(p => p.gp || 0), 0) || 82;
      const sf82 = maxGP > 0 ? (teamSF / maxGP) * 82 : 0;
      const shotPct = teamSF > 0 ? (teamG / teamSF) : 0;

      // Starting goalie (35+ GP) else highest GP
      const starter = teamGoalies.find(g => (g.gp || 0) >= 35) || [...teamGoalies].sort((a, b) => (b.gp || 0) - (a.gp || 0))[0];
      const svPct = starter && (starter.sha || 0) > 0
        ? ((starter.sha - (starter.ga || 0)) / starter.sha)
        : 0.905;
      const sa82 = starter && (starter.gp || 0) > 0 ? (starter.sha / starter.gp) * 82 : 0;

      return { team, teamTruei, sf82, sa82, shotPct, svPct };
    }).filter(Boolean);

    const leagueAvgShotPct = leagueTeamStats.length
      ? leagueTeamStats.reduce((sum, t) => sum + (t.shotPct || 0), 0) / leagueTeamStats.length
      : 0.092;
    const leagueAvgSvPctFrac = leagueTeamStats.length
      ? leagueTeamStats.reduce((sum, t) => sum + (t.svPct || 0), 0) / leagueTeamStats.length
      : 0.908;

    // TRUEi percentile rank (roster avgTruei vs league team TRUEi)
    const sortedTruei = leagueTeamStats.map(t => t.teamTruei).sort((a, b) => a - b);
    let pr = 0.5;
    if (sortedTruei.length > 1) {
      const idx = sortedTruei.findIndex(v => avgTruei <= v);
      const rank = idx === -1 ? (sortedTruei.length - 1) : idx;
      pr = rank / (sortedTruei.length - 1);
    }

    const playoffPredictor =
      (sfPer82 * rosterShotPct) -
      (saPer82 * (1 - rosterSvPct)) +
      0.5 * sfPer82 * (rosterShotPct - leagueAvgShotPct) +
      0.5 * saPer82 * (rosterSvPct - leagueAvgSvPctFrac) +
      3 * (pr - 0.5);
    
    // Find issues and strengths (including goalies)
    const skaterUnderperformers = rosterWithStats.filter(p => p.vsReplacement < -5);
    const skaterOverperformers = rosterWithStats.filter(p => p.vsReplacement > 5);
    const goalieUnderperformers = goaliesWithStats.filter(g => g.vsReplacement < -5);
    const goalieOverperformers = goaliesWithStats.filter(g => g.vsReplacement > 5);
    
    const allUnderperformers = [...skaterUnderperformers, ...goalieUnderperformers];
    const allOverperformers = [...skaterOverperformers, ...goalieOverperformers];
    
    // Players/goalies available to add
    const availablePlayers = groupedPlayers.filter(pg => {
      if (rosterSkaters.includes(pg.name)) return false;
      if (!pg.name.toLowerCase().includes(rosterSearchQuery.toLowerCase())) return false;
      return pg.seasons.some(
        s => normalizeSeasonValue(s.season || '2024-25') === normalizeSeasonValue(currentSeason) && getSeasonType(s) === rosterSeasonType
      );
    });
    
    const availableGoalies = goalieDatabase.filter(g => {
      if (rosterGoalies.includes(g.name)) return false;
      if (!g.name.toLowerCase().includes(rosterSearchQuery.toLowerCase())) return false;
      return normalizeSeasonValue(g.season || '2024-25') === normalizeSeasonValue(currentSeason) && getSeasonType(g) === rosterSeasonType;
    });
    
    // Helper to save roster
    const updateRoster = (skaters, goalies) => {
      saveRoster({ skaters, goalies });
    };

    return (
      <View style={styles.tabContent}>
        <Text style={styles.title}>My Roster</Text>
        <Text style={styles.subtitle}>Build and analyze your team ({formatSeasonLabel(currentSeason)})</Text>
        <Text style={styles.legendText}>
          Roster check ({rosterSeasonType}): {rosterWithStats.length} skaters, {goaliesWithStats.length} goalies
        </Text>

        <View style={styles.statsToggleRow}>
          <TouchableOpacity
            style={[styles.statsToggleBtn, rosterSeasonType === 'regular' && styles.statsToggleBtnActive]}
            onPress={() => setRosterSeasonType('regular')}
          >
            <Text style={[styles.statsToggleText, rosterSeasonType === 'regular' && styles.statsToggleTextActive]}>
              Regular Season
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statsToggleBtn, rosterSeasonType === 'playoffs' && styles.statsToggleBtnActive]}
            onPress={() => setRosterSeasonType('playoffs')}
          >
            <Text style={[styles.statsToggleText, rosterSeasonType === 'playoffs' && styles.statsToggleTextActive]}>
              Playoffs
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={styles.filterLabel}>Season:</Text>
          <View style={{ backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#ddd', maxHeight: 150 }}>
            <ScrollView nestedScrollEnabled>
              {(() => {
                const seasons = generateAllSeasons();
                const importedSet = new Set(availableSeasons);

                return seasons.map(season => (
                  <TouchableOpacity
                    key={season}
                    style={{
                      padding: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: '#eee',
                      backgroundColor: currentSeason === season ? '#e3f2fd' : importedSet.has(season) ? '#f0f7ff' : '#fff',
                    }}
                    onPress={() => setRosterSeason(season)}
                  >
                    <Text style={{
                      fontSize: 14,
                      fontWeight: currentSeason === season ? '700' : importedSet.has(season) ? '600' : '400',
                      color: currentSeason === season ? '#1565c0' : importedSet.has(season) ? '#1976d2' : '#333',
                    }}>
                      {formatSeasonLabel(season)}{importedSet.has(season) ? ' *' : ''}
                    </Text>
                  </TouchableOpacity>
                ));
              })()}
            </ScrollView>
          </View>
        </View>
        
        {/* Team Dropdown */}
        {allTeams.length > 0 && (
          <View style={styles.teamDropdownSection}>
            <Text style={styles.sectionTitle}>Quick Load Team</Text>
            <View style={styles.teamButtonsWrap}>
              {allTeams.map(team => (
                <TouchableOpacity
                  key={team}
                  style={styles.teamButton}
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      if (window.confirm(`Load ${team} roster? This will replace your current roster with top 12 F + 6 D + 2 G by GP`)) {
                        loadTeamRoster(team);
                      }
                    } else {
                      Alert.alert(
                        `Load ${team} Roster?`,
                        'This will replace your current roster with top 12 F + 6 D + 2 G by GP',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Load', onPress: () => loadTeamRoster(team) }
                        ]
                      );
                    }
                  }}
                >
                  <Text style={styles.teamButtonText}>{team}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        
        {/* Add Players/Goalies Section */}
        <View style={styles.rosterAddSection}>
          <Text style={styles.sectionTitle}>Add Players / Goalies</Text>
          <TextInput
            style={styles.input}
            placeholder="Search players or goalies to add..."
            value={rosterSearchQuery}
            onChangeText={setRosterSearchQuery}
          />
          
          {rosterSearchQuery && (
            <ScrollView style={styles.searchResults} nestedScrollEnabled>
              {/* Skaters */}
              {availablePlayers.slice(0, 8).map((pg, idx) => {
                const seasonInfo = pg.seasons.find(
                  s => normalizeSeasonValue(s.season || '2024-25') === normalizeSeasonValue(currentSeason) && getSeasonType(s) === rosterSeasonType
                );
                if (!seasonInfo) return null;
                return (
                  <TouchableOpacity
                    key={`skater-${idx}`}
                    style={styles.searchResultItem}
                    onPress={() => {
                      updateRoster([...rosterSkaters, pg.name], rosterGoalies);
                      setRosterSearchQuery('');
                    }}
                  >
                    <Text style={styles.searchResultName}>{pg.name}</Text>
                    <Text style={styles.searchResultDetails}>
                      {seasonInfo.team} - {seasonInfo.pos} (Skater)
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {/* Goalies */}
              {availableGoalies.slice(0, 4).map((g, idx) => (
                <TouchableOpacity
                  key={`goalie-${idx}`}
                  style={[styles.searchResultItem, { backgroundColor: '#e3f2fd' }]}
                  onPress={() => {
                    updateRoster(rosterSkaters, [...rosterGoalies, g.name]);
                    setRosterSearchQuery('');
                  }}
                >
                  <Text style={styles.searchResultName}>{g.name}</Text>
                  <Text style={styles.searchResultDetails}>
                    {g.team} - G (Goalie) - {g.gp}GP
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {(rosterSkaters.length === 0 && rosterGoalies.length === 0) ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No players on roster</Text>
            <Text style={styles.emptySubtext}>Select a team above or search to add players</Text>
          </View>
        ) : (
          <ScrollView nestedScrollEnabled>
            {/* Team Overview & Playoff Predictor */}
            <View style={styles.teamOverview}>
              <Text style={styles.sectionTitle}>Team Overview</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <View style={{ flex: 1, minWidth: 150 }}>
                  <Text style={styles.overviewStat}>Skaters: {rosterWithStats.length}</Text>
                  <Text style={styles.overviewStat}>Goalies: {goaliesWithStats.length}</Text>
                  <Text style={styles.overviewStat}>Avg TRUEi: {avgTruei.toFixed(1)}</Text>
                  <Text style={styles.overviewStat}>Total GSAA: {totalGSAA.toFixed(1)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 150 }}>
                  <Text style={styles.overviewStat}>SF/82: {sfPer82.toFixed(0)}</Text>
                  <Text style={styles.overviewStat}>S%: {teamSPct.toFixed(1)}%</Text>
                  <Text style={styles.overviewStat}>SA/82: {saPer82.toFixed(0)}</Text>
                  <Text style={styles.overviewStat}>SV%: {teamSvPct.toFixed(1)}%</Text>
                </View>
              </View>
              
              {/* Playoff Predictor Score */}
              <View style={[styles.playoffPredictorBox, { 
                backgroundColor: playoffPredictor > 150 ? '#c8e6c9' : playoffPredictor > 100 ? '#fff9c4' : '#ffcdd2'
              }]}>
                <Text style={styles.playoffPredictorLabel}>Playoff Predictor Score</Text>
                <Text style={styles.playoffPredictorValue}>{playoffPredictor.toFixed(1)}</Text>
                <Text style={styles.playoffPredictorHint}>
                  {playoffPredictor > 180 ? 'Cup Contender' : 
                   playoffPredictor > 150 ? 'Strong Playoff Team' :
                   playoffPredictor > 120 ? 'Bubble Team' :
                   playoffPredictor > 100 ? 'Fringe Playoff' : 'Rebuild Mode'}
                </Text>
              </View>
            </View>

            {/* Issues and Strengths (including goalies) */}
            {(allUnderperformers.length > 0 || allOverperformers.length > 0) && (
              <View style={styles.teamInsights}>
                {allUnderperformers.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, styles.warningText]}>⚠️ Issues</Text>
                    {allUnderperformers.map((p, idx) => (
                      <Text key={idx} style={styles.insightText}>
                        • {p.name} ({p.type === 'goalie' ? 'G' : p.pos}) underperforming ({p.vsReplacement.toFixed(1)})
                      </Text>
                    ))}
                  </>
                )}
                
                {allOverperformers.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, styles.successText]}>✓ Strengths</Text>
                    {allOverperformers.map((p, idx) => (
                      <Text key={idx} style={styles.insightText}>
                        • {p.name} ({p.type === 'goalie' ? 'G' : p.pos}) overperforming (+{p.vsReplacement.toFixed(1)})
                      </Text>
                    ))}
                  </>
                )}
              </View>
            )}

            {/* Goalies Section */}
            {goaliesWithStats.length > 0 && (
              <View style={styles.positionGroup}>
                <Text style={styles.sectionTitle}>Goalies ({goaliesWithStats.length})</Text>
                {goaliesWithStats.sort((a, b) => b.gsaa - a.gsaa).map((goalie, idx) => (
                  <View key={idx} style={[styles.rosterPlayerCard, { borderLeftColor: '#2196f3', borderLeftWidth: 4 }]}>
                    <View style={styles.rosterPlayerHeader}>
                      <View style={{flex: 1}}>
                        <Text style={styles.rosterPlayerName}>{goalie.name}</Text>
                        <Text style={styles.rosterPlayerDetails}>
                          {goalie.team} - G - {goalie.gp}GP ({goalie.replacementLevel})
                        </Text>
                        <Text style={styles.rosterPlayerStats}>
                          {goalie.w}W {goalie.l}L {goalie.t}T | SV%: {(goalie.svPct * 100).toFixed(1)}% | GAA: {goalie.gaa?.toFixed(2)}
                        </Text>
                        <Text style={[styles.rosterPlayerStats, { fontWeight: 'bold' }]}>
                          GSAA: {goalie.gsaa.toFixed(1)} | vs Replacement: {goalie.vsReplacement >= 0 ? '+' : ''}{goalie.vsReplacement.toFixed(1)}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.removeButton}
                        onPress={() => updateRoster(rosterSkaters, rosterGoalies.filter(n => n !== goalie.name))}
                      >
                        <Text style={styles.removeButtonText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Forwards */}
            <View style={styles.positionGroup}>
              <Text style={styles.sectionTitle}>Forwards ({forwards.length})</Text>
              {forwards.sort((a, b) => b.truei - a.truei).map((player, idx) => (
                <View key={idx} style={styles.rosterPlayerCard}>
                  <View style={styles.rosterPlayerHeader}>
                    <View style={{flex: 1}}>
                      <Text style={styles.rosterPlayerName}>{player.name}</Text>
                      <Text style={styles.rosterPlayerDetails}>
                        {player.team} - {player.pos} - {formatMinutesToTime(player.atoi)} TOI ({player.replacementLevel})
                      </Text>
                      <Text style={styles.rosterPlayerStats}>
                        {player.g}G {player.a}A {player.p}P | TRUEi: {player.truei.toFixed(1)} | vs Rep: {player.vsReplacement >= 0 ? '+' : ''}{player.vsReplacement.toFixed(1)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => updateRoster(rosterSkaters.filter(n => n !== player.name), rosterGoalies)}
                    >
                      <Text style={styles.removeButtonText}>X</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            {/* Defensemen */}
            <View style={styles.positionGroup}>
              <Text style={styles.sectionTitle}>Defense ({defensemen.length})</Text>
              {defensemen.sort((a, b) => b.truei - a.truei).map((player, idx) => (
                <View key={idx} style={styles.rosterPlayerCard}>
                  <View style={styles.rosterPlayerHeader}>
                    <View style={{flex: 1}}>
                      <Text style={styles.rosterPlayerName}>{player.name}</Text>
                      <Text style={styles.rosterPlayerDetails}>
                        {player.team} - {player.pos} - {formatMinutesToTime(player.atoi)} TOI ({player.replacementLevel})
                      </Text>
                      <Text style={styles.rosterPlayerStats}>
                        {player.g}G {player.a}A {player.p}P | TRUEi: {player.truei.toFixed(1)} | vs Rep: {player.vsReplacement >= 0 ? '+' : ''}{player.vsReplacement.toFixed(1)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removeButton}
                      onPress={() => updateRoster(rosterSkaters.filter(n => n !== player.name), rosterGoalies)}
                    >
                      <Text style={styles.removeButtonText}>X</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>

            {/* Lines Builder Section */}
            <View style={{ marginTop: 20, padding: 16, backgroundColor: '#f8f9fa', borderRadius: 12 }}>
              <Text style={{ fontWeight: '700', fontSize: 18, marginBottom: 16, textAlign: 'center' }}>📋 Lines Builder</Text>
              
              {(() => {
                const availableSkaters = rosterWithStats.filter(p => !isDefensemanPos(p.pos));
                const availableDefense = rosterWithStats.filter(p => isDefensemanPos(p.pos));
                const availableGoalies = goaliesWithStats;
                
                const PlayerDropdown = ({ value, onChange, players, placeholder }) => (
                  <View style={{ flex: 1, marginHorizontal: 2 }}>
                    <View style={{ backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: '#ddd', padding: 4 }}>
                      <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
                        <TouchableOpacity
                          style={{ padding: 6, backgroundColor: !value ? '#e3f2fd' : '#fff' }}
                          onPress={() => onChange(null)}
                        >
                          <Text style={{ fontSize: 11, color: '#999' }}>{placeholder}</Text>
                        </TouchableOpacity>
                        {players.map(p => (
                          <TouchableOpacity
                            key={p.name}
                            style={{ padding: 6, backgroundColor: value === p.name ? '#e3f2fd' : '#fff' }}
                            onPress={() => onChange(p.name)}
                          >
                            <Text style={{ fontSize: 11 }} numberOfLines={1}>{p.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                    {value && <Text style={{ fontSize: 10, textAlign: 'center', marginTop: 2, fontWeight: '600' }} numberOfLines={1}>{value.split(' ').pop()}</Text>}
                  </View>
                );
                
                const LineRow = ({ label, positions, lineKey, players }) => (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontWeight: '600', fontSize: 12, marginBottom: 4 }}>{label}</Text>
                    <View style={{ flexDirection: 'row' }}>
                      {positions.map(pos => (
                        <PlayerDropdown
                          key={pos}
                          value={lineAssignments[lineKey]?.[pos]}
                          onChange={(name) => setLineAssignments(prev => ({
                            ...prev,
                            [lineKey]: { ...prev[lineKey], [pos]: name }
                          }))}
                          players={players}
                          placeholder={pos.toUpperCase()}
                        />
                      ))}
                    </View>
                  </View>
                );
                
                return (
                  <View>
                    <Text style={{ fontWeight: '700', fontSize: 14, marginBottom: 8, color: '#1565c0' }}>Even Strength</Text>
                    <LineRow label="1st Line" positions={['lw', 'c', 'rw']} lineKey="line1" players={availableSkaters} />
                    <LineRow label="2nd Line" positions={['lw', 'c', 'rw']} lineKey="line2" players={availableSkaters} />
                    <LineRow label="3rd Line" positions={['lw', 'c', 'rw']} lineKey="line3" players={availableSkaters} />
                    <LineRow label="4th Line" positions={['lw', 'c', 'rw']} lineKey="line4" players={availableSkaters} />
                    
                    <Text style={{ fontWeight: '700', fontSize: 14, marginTop: 16, marginBottom: 8, color: '#1565c0' }}>Defense Pairings</Text>
                    <LineRow label="1st Pair" positions={['ld', 'rd']} lineKey="pair1" players={availableDefense} />
                    <LineRow label="2nd Pair" positions={['ld', 'rd']} lineKey="pair2" players={availableDefense} />
                    <LineRow label="3rd Pair" positions={['ld', 'rd']} lineKey="pair3" players={availableDefense} />
                    
                    <Text style={{ fontWeight: '700', fontSize: 14, marginTop: 16, marginBottom: 8, color: '#c62828' }}>Power Play</Text>
                    <LineRow label="PP1" positions={['ld', 'rd', 'lw', 'c', 'rw']} lineKey="pp1" players={[...availableSkaters, ...availableDefense]} />
                    <LineRow label="PP2" positions={['ld', 'rd', 'lw', 'c', 'rw']} lineKey="pp2" players={[...availableSkaters, ...availableDefense]} />
                    
                    <Text style={{ fontWeight: '700', fontSize: 14, marginTop: 16, marginBottom: 8, color: '#2e7d32' }}>Penalty Kill</Text>
                    <LineRow label="PK1" positions={['ld', 'rd', 'lf', 'rf']} lineKey="pk1" players={[...availableSkaters, ...availableDefense]} />
                    <LineRow label="PK2" positions={['ld', 'rd', 'lf', 'rf']} lineKey="pk2" players={[...availableSkaters, ...availableDefense]} />
                    
                    <Text style={{ fontWeight: '700', fontSize: 14, marginTop: 16, marginBottom: 8, color: '#6a1b9a' }}>Goalies</Text>
                    <LineRow label="Goalies" positions={['starter', 'backup']} lineKey="goalies" players={availableGoalies} />
                    
                    <Text style={{ fontWeight: '700', fontSize: 14, marginTop: 16, marginBottom: 8, color: '#795548' }}>Scratches</Text>
                    <LineRow label="Scratches" positions={['s1', 's2', 's3']} lineKey="scratches" players={[...availableSkaters, ...availableDefense]} />
                    
                    <TouchableOpacity
                      style={{ backgroundColor: '#1565c0', padding: 14, borderRadius: 8, marginTop: 20, alignItems: 'center' }}
                      onPress={() => {
                        const getLastName = (name) => {
                          if (!name || name === '???') return '???';
                          const parts = name.split(' ');
                          return parts[parts.length - 1];
                        };
                        
                        const formatLine = (lineKey, positions) => {
                          const line = lineAssignments[lineKey];
                          return positions.map(p => getLastName(line?.[p])).join(' - ');
                        };
                        
                        const formatScratches = () => {
                          const s = lineAssignments.scratches || {};
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

${getLastName(lineAssignments.goalies?.starter)}
${getLastName(lineAssignments.goalies?.backup)}

PP
${formatLine('pp1', ['ld', 'rd', 'lw', 'c', 'rw'])}
${formatLine('pp2', ['ld', 'rd', 'lw', 'c', 'rw'])}

PK
${formatLine('pk1', ['ld', 'rd', 'lf', 'rf'])}
${formatLine('pk2', ['ld', 'rd', 'lf', 'rf'])}

Scratches
${formatScratches()}`;

                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(text);
                          alert('Lines copied to clipboard!');
                        } else {
                          alert('Clipboard not available');
                        }
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>📋 Copy Lines to Clipboard</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
            </View>

            {/* Clear All Button */}
            <TouchableOpacity
              style={[styles.button, {backgroundColor: '#d32f2f', marginTop: 20}]}
              onPress={() => {
                if (Platform.OS === 'web') {
                  if (window.confirm('Remove all players from your roster?')) {
                    updateRoster([], []);
                  }
                } else {
                  Alert.alert(
                    'Clear Roster?',
                    'Remove all players from your roster?',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Clear', style: 'destructive', onPress: () => updateRoster([], []) }
                    ]
                  );
                }
              }}
            >
              <Text style={styles.buttonText}>Clear Roster</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    );
  };

  // Calculate GSAA (Goals Saved Above Average)
  // State for team stats season selection
  const [teamStatsSeason, setTeamStatsSeason] = useState(null);
  const [teamStatsAllSeasons, setTeamStatsAllSeasons] = useState(false);
  const [teamStatsSeasonType, setTeamStatsSeasonType] = useState('regular'); // 'regular' or 'playoffs'
  const [teamStatsSortColumn, setTeamStatsSortColumn] = useState('predictedSuccess');
  const [teamStatsSortAsc, setTeamStatsSortAsc] = useState(false);

  // Memoized team stats data
  const teamStatsData = useMemo(() => {
    const currentSeason = teamStatsSeason || (availableSeasons.length > 0 ? availableSeasons[0] : '2024-25');
    const seasonsToUse = teamStatsAllSeasons
      ? (availableSeasons.length > 0 ? availableSeasons : generateAllSeasons())
      : [currentSeason];
    
    const seasonPlayersRegular = playerDatabase.filter(
      p => seasonsToUse.includes(normalizeSeasonValue(p.season || '2024-25')) && getSeasonType(p) === 'regular'
    );
    const seasonPlayersPlayoffs = playerDatabase.filter(
      p => seasonsToUse.includes(normalizeSeasonValue(p.season || '2024-25')) && getSeasonType(p) === 'playoffs'
    );
    const seasonGoaliesRegular = goalieDatabase.filter(
      g => seasonsToUse.includes(normalizeSeasonValue(g.season || '2024-25')) && getSeasonType(g) === 'regular'
    );
    const seasonGoaliesPlayoffs = goalieDatabase.filter(
      g => seasonsToUse.includes(normalizeSeasonValue(g.season || '2024-25')) && getSeasonType(g) === 'playoffs'
    );
    
    // Use the selected season type
    const seasonPlayers = teamStatsSeasonType === 'playoffs' ? seasonPlayersPlayoffs : seasonPlayersRegular;
    const seasonGoalies = teamStatsSeasonType === 'playoffs' ? seasonGoaliesPlayoffs : seasonGoaliesRegular;
    
    const totalSaves = seasonGoalies.reduce((sum, g) => sum + (g.sha - g.ga), 0);
    const totalShots = seasonGoalies.reduce((sum, g) => sum + g.sha, 0);
    const leagueAvgSvPct = totalShots > 0 ? totalSaves / totalShots : 0.905;
    
    const seasonsToRender = teamStatsAllSeasons ? seasonsToUse : [currentSeason];
    const teamStats = seasonsToRender.flatMap(season => {
      const seasonKey = normalizeSeasonValue(season);
      return nhlTeams.map(team => {
        const teamPlayers = seasonPlayers.filter(
          p => p.team === team && normalizeSeasonValue(p.season || '2024-25') === seasonKey
        );
        const teamGoalies = seasonGoalies.filter(
          g => g.team === team && normalizeSeasonValue(g.season || '2024-25') === seasonKey
        );
        
        if (teamPlayers.length === 0) return null;
        
        const top18 = [...teamPlayers].sort((a, b) => b.gp - a.gp).slice(0, 18);
        const teamTruei = top18.length > 0 
          ? top18.reduce((sum, p) => sum + parseFloat(calculateTRUEi(p)), 0) / top18.length
          : 0;
        
        const startingGoalie = teamGoalies.find(g => g.gp >= 35) || 
                              teamGoalies.sort((a, b) => b.gp - a.gp)[0];
        const bestGSAA = startingGoalie ? calculateGSAA(startingGoalie, leagueAvgSvPct) : 0;
        const goalieSvPct = startingGoalie && startingGoalie.sha > 0 
          ? (startingGoalie.sha - startingGoalie.ga) / startingGoalie.sha 
          : 0;
        const goalieSAPer82 = startingGoalie && startingGoalie.gp > 0
          ? (startingGoalie.sha / startingGoalie.gp) * 82
          : 0;
        
        const maxGP = Math.max(...teamPlayers.map(p => p.gp), 1);
        const teamSF = teamPlayers.reduce((sum, p) => sum + p.sog, 0);
        const sfPer82 = (teamSF / maxGP) * 82;
        
        const teamGoals = teamPlayers.reduce((sum, p) => sum + p.g, 0);
        const teamShootingPct = teamSF > 0 ? teamGoals / teamSF : 0;
        
        // PDO = Shooting % + Save % (at even strength, but we use overall)
        const pdo = (teamShootingPct * 100) + (goalieSvPct * 100);
        
        const predictedSuccess = (teamTruei * 0.4) + (bestGSAA * 2) + (sfPer82 * 0.1) + (teamShootingPct * 100);
        
        return {
          team,
          season: seasonKey,
          teamTruei,
          bestGSAA,
          goalieName: startingGoalie?.name || 'N/A',
          goalieSAPer82,
          sfPer82,
          teamShootingPct,
          goalieSvPct,
          pdo,
          predictedSuccess,
          playerCount: teamPlayers.length,
        };
      }).filter(Boolean);
    });
    
    return {
      currentSeason,
      seasonsToUse,
      seasonPlayers,
      seasonGoalies,
      seasonPlayersRegular,
      seasonPlayersPlayoffs,
      seasonGoaliesRegular,
      seasonGoaliesPlayoffs,
      leagueAvgSvPct,
      teamStats,
    };
  }, [playerDatabase, goalieDatabase, teamStatsSeason, teamStatsAllSeasons, teamStatsSeasonType, availableSeasons]);

  const renderTeamStatsTab = () => {
    // Use memoized data
    const {
      currentSeason,
      seasonsToUse,
      seasonPlayers,
      seasonGoalies,
      seasonPlayersRegular,
      seasonPlayersPlayoffs,
      seasonGoaliesRegular,
      seasonGoaliesPlayoffs,
      leagueAvgSvPct,
      teamStats,
    } = teamStatsData;
    
    // Calculate predicted success with percentile rank
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

    const sortedTeamStats = [...teamStatsWithPrediction].sort((a, b) => {
      const column = teamStatsSortColumn;
      const asc = teamStatsSortAsc;
      const dir = asc ? 1 : -1;
      const isText = column === 'team' || column === 'goalieName';

      if (isText) {
        const valueA = String(a[column] || '');
        const valueB = String(b[column] || '');
        return valueA.localeCompare(valueB) * dir;
      }

      const valueA = Number(a[column] || 0);
      const valueB = Number(b[column] || 0);
      return (valueA - valueB) * dir;
    });

    const imgs = seasonImages[currentSeason] || { east: null, west: null, playoffs: null };
    console.log('Teams tab - currentSeason:', currentSeason, 'seasonImages keys:', Object.keys(seasonImages), 'imgs:', imgs);

    return (
      <View style={styles.tabContent}>
        <Text style={styles.title}>Team Stats</Text>

        <View style={{ alignItems: 'center', marginBottom: 12, width: '100%', paddingHorizontal: 16 }}>
          <Text style={styles.filterLabel}>Season:</Text>
          {!teamStatsAllSeasons && (
            <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#ddd', maxHeight: 150 }}>
              <ScrollView nestedScrollEnabled>
                {(() => {
                  const seasons = generateAllSeasons();
                  const importedSet = new Set(availableSeasons);

                  return seasons.map(season => (
                    <TouchableOpacity
                      key={season}
                      style={{
                        padding: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: '#eee',
                        backgroundColor: currentSeason === season ? '#e3f2fd' : importedSet.has(season) ? '#f0f7ff' : '#fff',
                      }}
                      onPress={() => setTeamStatsSeason(season)}
                    >
                      <Text style={{
                        fontSize: 14,
                        fontWeight: currentSeason === season ? '700' : importedSet.has(season) ? '600' : '400',
                        color: currentSeason === season ? '#1565c0' : importedSet.has(season) ? '#1976d2' : '#333',
                      }}>
                        {formatSeasonLabel(season)}{importedSet.has(season) ? ' *' : ''}
                      </Text>
                    </TouchableOpacity>
                  ));
                })()}
              </ScrollView>
            </View>
          )}
          <View style={[styles.statsToggleRow, { width: '100%' }]}>
            <TouchableOpacity
              style={[styles.statsToggleBtn, { flex: 1 }, !teamStatsAllSeasons && styles.statsToggleBtnActive]}
              onPress={() => setTeamStatsAllSeasons(false)}
            >
              <Text style={[styles.statsToggleText, !teamStatsAllSeasons && styles.statsToggleTextActive]}>
                Single Season
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statsToggleBtn, { flex: 1 }, teamStatsAllSeasons && styles.statsToggleBtnActive]}
              onPress={() => setTeamStatsAllSeasons(true)}
            >
              <Text style={[styles.statsToggleText, teamStatsAllSeasons && styles.statsToggleTextActive]}>
                All Seasons
              </Text>
            </TouchableOpacity>
          </View>
          
          {/* Regular/Playoffs Toggle */}
          <View style={[styles.statsToggleRow, { width: '100%', marginTop: 8 }]}>
            <TouchableOpacity
              style={[styles.statsToggleBtn, { flex: 1 }, teamStatsSeasonType === 'regular' && styles.statsToggleBtnActive]}
              onPress={() => setTeamStatsSeasonType('regular')}
            >
              <Text style={[styles.statsToggleText, teamStatsSeasonType === 'regular' && styles.statsToggleTextActive]}>
                Regular Season
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statsToggleBtn, { flex: 1 }, teamStatsSeasonType === 'playoffs' && styles.statsToggleBtnActive]}
              onPress={() => setTeamStatsSeasonType('playoffs')}
            >
              <Text style={[styles.statsToggleText, teamStatsSeasonType === 'playoffs' && styles.statsToggleTextActive]}>
                Playoffs
              </Text>
            </TouchableOpacity>
          </View>
          
          <Text style={[styles.subtitle, { marginTop: 8 }]}>
            {teamStatsAllSeasons 
              ? `Showing: All Seasons (${teamStatsSeasonType === 'playoffs' ? 'Playoffs' : 'Regular'})` 
              : `Showing: ${formatSeasonLabel(currentSeason)} (${teamStatsSeasonType === 'playoffs' ? 'Playoffs' : 'Regular'})`}
          </Text>
          {!teamStatsAllSeasons && (
            <>
              <Text style={styles.legendText}>
                Season players: {seasonPlayers.length} | Season goalies: {seasonGoalies.length}
              </Text>
              <Text style={styles.legendText}>
                Regular: {seasonPlayersRegular.length}/{seasonGoaliesRegular.length} | Playoffs: {seasonPlayersPlayoffs.length}/{seasonGoaliesPlayoffs.length}
              </Text>
            </>
          )}
        </View>

        {/* Rankings Table */}
        <View style={{ marginBottom: 20, borderLeftWidth: 6, borderLeftColor: '#1a1a2e', paddingLeft: 14 }}>
          <Text style={{ fontWeight: '700', marginBottom: 10, textAlign: 'center', fontSize: 14 }}>Rankings Table</Text>
          {seasonPlayers.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No player data for this season</Text>
            </View>
          ) : (
            <ScrollView horizontal>
              <View>
                {/* Header */}
                <View style={styles.teamStatsHeader}>
                  {(() => {
                    const sortLabel = (label, column) => {
                      if (teamStatsSortColumn !== column) return label;
                      return `${label} ${teamStatsSortAsc ? '^' : 'v'}`;
                      };
                      const toggleSort = (column, defaultAsc) => {
                        if (teamStatsSortColumn === column) {
                          setTeamStatsSortAsc(!teamStatsSortAsc);
                        } else {
                          setTeamStatsSortColumn(column);
                          setTeamStatsSortAsc(defaultAsc);
                        }
                      };
                      return (
                        <>
                          <Text style={[styles.teamStatsCell, styles.teamNameCell, styles.teamStatsHeaderText]}>Rank</Text>
                          {teamStatsAllSeasons && (
                            <TouchableOpacity
                              style={[styles.teamStatsCell, styles.teamNameCell]}
                              onPress={() => toggleSort('season', true)}
                            >
                              <Text style={styles.teamStatsHeaderText}>
                                {sortLabel('Season', 'season')}
                              </Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={[styles.teamStatsCell, styles.teamNameCell]}
                            onPress={() => toggleSort('team', true)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('Team', 'team')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('teamTruei', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('TRUEi', 'teamTruei')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('bestGSAA', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('GSAA', 'bestGSAA')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.teamStatsCell, styles.wideCell]}
                            onPress={() => toggleSort('goalieName', true)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('Goalie', 'goalieName')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('goalieSAPer82', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('SA/82', 'goalieSAPer82')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('sfPer82', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('SF/82', 'sfPer82')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('teamShootingPct', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('S%', 'teamShootingPct')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('goalieSvPct', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('SV%', 'goalieSvPct')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('pdo', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('PDO', 'pdo')}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.teamStatsCell}
                            onPress={() => toggleSort('predictedSuccess', false)}
                          >
                            <Text style={styles.teamStatsHeaderText}>
                              {sortLabel('Pred.', 'predictedSuccess')}
                            </Text>
                          </TouchableOpacity>
                        </>
                      );
                    })()}
                  </View>
                  
                  {/* Data rows */}
                  {sortedTeamStats.map((team, idx) => (
                    <View key={`${team.team}-${team.season || 'current'}`} style={[styles.teamStatsRow, idx % 2 === 0 && styles.teamStatsRowAlt]}>
                      <Text style={[styles.teamStatsCell, styles.teamNameCell]}>{idx + 1}</Text>
                      {teamStatsAllSeasons && (
                        <Text style={[styles.teamStatsCell, styles.teamNameCell]}>{formatSeasonLabel(team.season)}</Text>
                      )}
                      <Text style={[styles.teamStatsCell, styles.teamNameCell]}>{team.team}</Text>
                      <Text style={styles.teamStatsCell}>{team.teamTruei.toFixed(1)}</Text>
                      <Text style={[styles.teamStatsCell, team.bestGSAA > 0 ? styles.positiveValue : styles.negativeValue]}>
                        {team.bestGSAA.toFixed(1)}
                      </Text>
                      <Text style={[styles.teamStatsCell, styles.wideCell]} numberOfLines={1}>{team.goalieName}</Text>
                      <Text style={styles.teamStatsCell}>{team.goalieSAPer82.toFixed(0)}</Text>
                      <Text style={styles.teamStatsCell}>{team.sfPer82.toFixed(0)}</Text>
                      <Text style={styles.teamStatsCell}>{(team.teamShootingPct * 100).toFixed(1)}%</Text>
                      <Text style={styles.teamStatsCell}>{(team.goalieSvPct * 100).toFixed(1)}%</Text>
                      <Text style={[styles.teamStatsCell, team.pdo >= 100 ? styles.positiveValue : styles.negativeValue]}>
                        {team.pdo.toFixed(1)}
                      </Text>
                      <Text style={[styles.teamStatsCell, team.predictedSuccess > 0 ? styles.positiveValue : styles.negativeValue]}>
                        {team.predictedSuccess.toFixed(1)}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
            
            <View style={styles.teamStatsLegend}>
              <Text style={styles.legendText}>TRUEi = Avg of top 18 skaters | GSAA = Goals Saved Above Average | PDO = S% + SV%</Text>
              <Text style={styles.legendText}>Pred. = Predicted Playoff Success | League Avg SV%: {(leagueAvgSvPct * 100).toFixed(1)}%</Text>
            </View>
          </View>

        {/* Season Images */}
        <View style={{ marginTop: 20 }}>
          <Text style={{ fontWeight: '700', marginBottom: 16, textAlign: 'center', fontSize: 16 }}>Season Standings & Playoffs</Text>
          {[
            { key: 'east', label: 'Eastern Standings' },
            { key: 'west', label: 'Western Standings' },
            { key: 'playoffs', label: 'Playoffs Bracket' },
          ].map(({ key, label }) => {
            const imgSource = imgs[key];
            // Handle different image source formats (web vs native, require vs uri)
            const resolvedSource = imgSource 
              ? (typeof imgSource === 'number' 
                  ? imgSource 
                  : typeof imgSource === 'string' 
                    ? { uri: imgSource }
                    : imgSource.default 
                      ? imgSource.default 
                      : imgSource)
              : null;
            
            return (
              <View key={key} style={{ marginBottom: 20, alignItems: 'center' }}>
                <Text style={{ fontWeight: '700', marginBottom: 8, fontSize: 14, textAlign: 'center' }}>{label}</Text>
                {resolvedSource ? (
                  <Image
                    source={resolvedSource}
                    style={{ width: '100%', height: 280, borderRadius: 10, backgroundColor: '#f5f5f5' }}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={{ width: '100%', height: 280, borderRadius: 10, backgroundColor: '#f5f5f5', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#999', fontSize: 13 }}>No image available</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderAnalysisTab = () => {
    // Get most recent season
    const mostRecentSeason = availableSeasons.length > 0 ? availableSeasons[0] : '2024-25';
    
    // TOI-based replacement benchmarks
    const getReplacementLevel = (toi, position) => {
      const isDefenseman = isDefensemanPos(position);
      
      if (isDefenseman) {
        if (toi >= 22) return { level: '1st Pair', truei: 65.0 };
        if (toi >= 18) return { level: '2nd Pair', truei: 37.4 };
        return { level: '3rd Pair', truei: 20.1 };
      } else {
        if (toi >= 17) return { level: '1st Line', truei: 66.6 };
        if (toi >= 14) return { level: '2nd Line', truei: 45.6 };
        if (toi >= 12) return { level: '3rd Line', truei: 26.8 };
        return { level: '4th Line', truei: 21.8 };
      }
    };

    // Calculate delta and replacement value for each player
    const analysisData = groupedPlayers
      .filter(playerGroup => {
        // Only include players who played in the most recent season (regular season)
        return playerGroup.seasons.some(
          s => normalizeSeasonValue(s.season || '2024-25') === normalizeSeasonValue(mostRecentSeason) && getSeasonType(s) === 'regular'
        );
      })
      .map(playerGroup => {
      const seasons = playerGroup.seasons
        .filter(s => getSeasonType(s) === 'regular')
        .sort((a, b) => normalizeSeasonValue(b.season || '2024-25').localeCompare(normalizeSeasonValue(a.season || '2024-25')));
      
      const current = seasons[0];
      const previous = seasons[1];
      
      const currentTruei = parseFloat(calculateTRUEi(current));
      const previousTruei = previous ? parseFloat(calculateTRUEi(previous)) : null;
      const delta = previousTruei ? currentTruei - previousTruei : null;
      
      const replacement = getReplacementLevel(current.atoi, current.pos);
      const vsReplacement = currentTruei - replacement.truei;
      
      return {
        name: playerGroup.name,
        season: current.season || '2024-25',
        team: current.team,
        pos: current.pos,
        toi: current.atoi,
        truei: currentTruei,
        delta: delta,
        replacementLevel: replacement.level,
        expectedTruei: replacement.truei,
        vsReplacement: vsReplacement,
        gp: current.gp
      };
    });

    // Filter to players with meaningful GP
    const qualifiedPlayers = analysisData.filter(p => p.gp >= 20);

    // Risers and Fallers
    const risers = qualifiedPlayers
      .filter(p => p.delta !== null && p.delta > 3)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 10);

    const fallers = qualifiedPlayers
      .filter(p => p.delta !== null && p.delta < -3)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 10);

    // Overperformers and Underperformers
    const overperformers = qualifiedPlayers
      .filter(p => p.vsReplacement > 5)
      .sort((a, b) => b.vsReplacement - a.vsReplacement)
      .slice(0, 10);

    const underperformers = qualifiedPlayers
      .filter(p => p.vsReplacement < -5)
      .sort((a, b) => a.vsReplacement - b.vsReplacement)
      .slice(0, 10);

    return (
      <View style={styles.tabContent}>
        <Text style={styles.title}>Player Analysis</Text>
        <Text style={styles.subtitle}>
          Analyzing most recent season: <Text style={{ fontWeight: '700', color: '#1565c0' }}>{mostRecentSeason}</Text>
        </Text>
        <Text style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          (Based on latest imported data - active players only)
        </Text>
        
        {playerDatabase.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No data available</Text>
            <Text style={styles.emptySubtext}>Import players first</Text>
          </View>
        ) : (
          <ScrollView>
            {/* Risers Section */}
            <View style={styles.analysisSection}>
              <Text style={styles.sectionTitle}>🟢 Top Risers (Year-over-Year)</Text>
              <Text style={styles.sectionSubtitle}>Players improving the most</Text>
              {risers.length > 0 ? risers.map((player, idx) => (
                <View key={idx} style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <Text style={styles.analysisPlayerName}>{player.name}</Text>
                    <Text style={[styles.deltaText, styles.deltaPositive]}>
                      ↑ +{player.delta.toFixed(1)}
                    </Text>
                  </View>
                  <Text style={styles.analysisDetails}>
                    {player.team} • {player.pos} • {player.toi.toFixed(1)} TOI
                  </Text>
                  <Text style={styles.analysisDetails}>
                    Current TRUEi: {player.truei.toFixed(1)} ({player.season})
                  </Text>
                </View>
              )) : (
                <Text style={styles.emptySubtext}>Need multiple seasons to compare</Text>
              )}
            </View>

            {/* Fallers Section */}
            <View style={styles.analysisSection}>
              <Text style={styles.sectionTitle}>🔴 Top Fallers (Year-over-Year)</Text>
              <Text style={styles.sectionSubtitle}>Players declining the most</Text>
              {fallers.length > 0 ? fallers.map((player, idx) => (
                <View key={idx} style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <Text style={styles.analysisPlayerName}>{player.name}</Text>
                    <Text style={[styles.deltaText, styles.deltaNegative]}>
                      ↓ {player.delta.toFixed(1)}
                    </Text>
                  </View>
                  <Text style={styles.analysisDetails}>
                    {player.team} • {player.pos} • {player.toi.toFixed(1)} TOI
                  </Text>
                  <Text style={styles.analysisDetails}>
                    Current TRUEi: {player.truei.toFixed(1)} ({player.season})
                  </Text>
                </View>
              )) : (
                <Text style={styles.emptySubtext}>Need multiple seasons to compare</Text>
              )}
            </View>

            {/* Overperformers Section */}
            <View style={styles.analysisSection}>
              <Text style={styles.sectionTitle}>⭐ Overperformers (vs TOI)</Text>
              <Text style={styles.sectionSubtitle}>Exceeding expectations for ice time</Text>
              {overperformers.map((player, idx) => (
                <View key={idx} style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <Text style={styles.analysisPlayerName}>{player.name}</Text>
                    <Text style={[styles.deltaText, styles.deltaPositive]}>
                      +{player.vsReplacement.toFixed(1)}
                    </Text>
                  </View>
                  <Text style={styles.analysisDetails}>
                    {player.team} • {player.pos} • {player.toi.toFixed(1)} TOI ({player.replacementLevel})
                  </Text>
                  <Text style={styles.analysisDetails}>
                    TRUEi: {player.truei.toFixed(1)} | Expected: {player.expectedTruei.toFixed(1)}
                  </Text>
                  <Text style={styles.verdictText}>
                    ✅ Outperforming role - consider promoting
                  </Text>
                </View>
              ))}
            </View>

            {/* Underperformers Section */}
            <View style={styles.analysisSection}>
              <Text style={styles.sectionTitle}>⚠️ Underperformers (vs TOI)</Text>
              <Text style={styles.sectionSubtitle}>Not earning their ice time</Text>
              {underperformers.map((player, idx) => (
                <View key={idx} style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <Text style={styles.analysisPlayerName}>{player.name}</Text>
                    <Text style={[styles.deltaText, styles.deltaNegative]}>
                      {player.vsReplacement.toFixed(1)}
                    </Text>
                  </View>
                  <Text style={styles.analysisDetails}>
                    {player.team} • {player.pos} • {player.toi.toFixed(1)} TOI ({player.replacementLevel})
                  </Text>
                  <Text style={styles.analysisDetails}>
                    TRUEi: {player.truei.toFixed(1)} | Expected: {player.expectedTruei.toFixed(1)}
                  </Text>
                  <Text style={[styles.verdictText, styles.verdictNegative]}>
                    🔴 Trade candidate or reduce ice time
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    );
  };

  const renderPlayoffTab = () => (
    <View style={styles.tabContent}>
      <Text style={styles.title}>Playoff Success Predictor</Text>
      <Text style={styles.subtitle}>Team-based playoff performance estimator</Text>

      <TextInput
        style={styles.input}
        placeholder="Shots For per 82 GP"
        keyboardType="numeric"
        value={playoffStats.shotsFor82}
        onChangeText={(text) => setPlayoffStats({...playoffStats, shotsFor82: text})}
      />
      <TextInput
        style={styles.input}
        placeholder="Team Shooting % (e.g., 9.5)"
        keyboardType="numeric"
        value={playoffStats.shootingPct}
        onChangeText={(text) => setPlayoffStats({...playoffStats, shootingPct: text})}
      />
      <TextInput
        style={styles.input}
        placeholder="Shots Against per 82 GP"
        keyboardType="numeric"
        value={playoffStats.shotsAgainst82}
        onChangeText={(text) => setPlayoffStats({...playoffStats, shotsAgainst82: text})}
      />
      <TextInput
        style={styles.input}
        placeholder="Starting Goalie SV% (e.g., 91.5)"
        keyboardType="numeric"
        value={playoffStats.goalieSvPct}
        onChangeText={(text) => setPlayoffStats({...playoffStats, goalieSvPct: text})}
      />
      <TextInput
        style={styles.input}
        placeholder="Team TRUEi Percentile (0-1, e.g., 0.75)"
        keyboardType="numeric"
        value={playoffStats.teamTRUEi}
        onChangeText={(text) => setPlayoffStats({...playoffStats, teamTRUEi: text})}
      />

      <TouchableOpacity 
        style={styles.button}
        onPress={() => {
          const result = calculatePlayoffSuccess();
          Alert.alert(
            'Playoff Success Score',
            `${result}\n\nHigher scores = better playoff prospects`,
            [{ text: 'OK' }]
          );
        }}
      >
        <Text style={styles.buttonText}>Calculate</Text>
      </TouchableOpacity>

      <View style={styles.helpBox}>
        <Text style={styles.helpTitle}>League Averages (built-in):</Text>
        <Text style={styles.helpText}>• Shooting %: 9.2%</Text>
        <Text style={styles.helpText}>• Save %: 90.8%</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>RGMG Analytics</Text>
      </View>
      
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'stats' && styles.activeTab]}
          onPress={() => setActiveTab('stats')}
        >
          <Text style={[styles.tabText, activeTab === 'stats' && styles.activeTabText]}>
            Stats
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'roster' && styles.activeTab]}
          onPress={() => setActiveTab('roster')}
        >
          <Text style={[styles.tabText, activeTab === 'roster' && styles.activeTabText]}>
            My Roster
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'rankings' && styles.activeTab]}
          onPress={() => setActiveTab('rankings')}
        >
          <Text style={[styles.tabText, activeTab === 'rankings' && styles.activeTabText]}>
            Rankings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'teams' && styles.activeTab]}
          onPress={() => setActiveTab('teams')}
        >
          <Text style={[styles.tabText, activeTab === 'teams' && styles.activeTabText]}>
            Teams
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'analysis' && styles.activeTab]}
          onPress={() => setActiveTab('analysis')}
        >
          <Text style={[styles.tabText, activeTab === 'analysis' && styles.activeTabText]}>
            Analysis
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView}>
        {activeTab === 'stats' && renderStatsTab()}
        {activeTab === 'roster' && renderMyRosterTab()}
        {activeTab === 'rankings' && (
          <Rankings 
            players={playerDatabase}
            goalies={goalieDatabase}
            selectedSeason={selectedSeason}
            seasonType={rankingsSeasonType}
            availableSeasons={availableSeasons}
            onSeasonChange={setSelectedSeason}
            onSeasonTypeChange={setRankingsSeasonType}
          />
        )}
        {activeTab === 'teams' && renderTeamStatsTab()}
        {activeTab === 'analysis' && renderAnalysisTab()}
      </ScrollView>

      {/* Season Selection Modal */}
      <Modal
        visible={showSeasonModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSeasonModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Season ({importSeasonType === 'playoffs' ? 'Playoffs' : 'Regular'})</Text>
            <Text style={styles.modalSubtitle}>
              Importing {importType === 'goalies' ? pendingGoalieData?.length : pendingImportData?.length || 0} {importType === 'goalies' ? 'goalies' : 'players'}
            </Text>
            {(() => {
              const rows = importType === 'goalies' ? pendingGoalieData || [] : pendingImportData || [];
              const maxGp = rows.reduce((max, r) => {
                const gp = Number(r.gp);
                return Math.max(max, Number.isFinite(gp) ? gp : 0);
              }, 0);
              const inferredType = maxGp >= 50 ? 'regular' : 'playoffs';
              return (
                <Text style={styles.modalSubtitle}>
                  Auto-detected: {inferredType} (max GP {maxGp || 0})
                </Text>
              );
            })()}

            <ScrollView style={{ maxHeight: 300 }}>
              <View style={styles.seasonButtons}>
                {(() => {
                  const seasons = generateAllSeasons();
                  const importedSet = new Set(availableSeasons);

                  return seasons.map(season => (
                    <TouchableOpacity
                      key={season}
                      style={[
                        styles.seasonButton,
                        importedSet.has(season) && { backgroundColor: '#e3f2fd', borderColor: '#1976d2' }
                      ]}
                      onPress={() => confirmImport(season)}
                    >
                      <Text style={[
                        styles.seasonButtonText,
                        importedSet.has(season) && { color: '#1565c0', fontWeight: '600' }
                      ]}>
                        {formatSeasonLabel(season)}{importedSet.has(season) ? ' *' : ''}
                      </Text>
                    </TouchableOpacity>
                  ));
                })()}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => {
                setPendingImportData(null);
                setPendingGoalieData(null);
                setShowSeasonModal(false);
                setShowCustomSeasonInput(false);
                setCustomSeasonText('');
              }}
            >
              <Text style={styles.modalCancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════════
  // LAYOUT & CONTAINER STYLES
  // ═══════════════════════════════════════════════════════════════
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  headerText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: '#1a1a2e',
  },
  tabText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#1a1a2e',
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  tabContent: {
    padding: 20,
  },

  // ═══════════════════════════════════════════════════════════════
  // TYPOGRAPHY
  // ═══════════════════════════════════════════════════════════════
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
    color: '#1a1a2e',
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    lineHeight: 20,
  },
  instructions: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 22,
  },

  // ═══════════════════════════════════════════════════════════════
  // CARD & SECTION STYLES (Consistent across all tabs)
  // ═══════════════════════════════════════════════════════════════
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  uploadSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  pasteSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 12,
  },
  
  // ═══════════════════════════════════════════════════════════════
  // BUTTONS
  // ═══════════════════════════════════════════════════════════════
  uploadButton: {
    backgroundColor: '#2e7d32',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#2e7d32',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  uploadHint: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 4,
  },
  button: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#1a1a2e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  smallButton: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },

  // ═══════════════════════════════════════════════════════════════
  // DIVIDERS
  // ═══════════════════════════════════════════════════════════════
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#999',
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 1,
  },

  // ═══════════════════════════════════════════════════════════════
  // INPUTS
  // ═══════════════════════════════════════════════════════════════
  textArea: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 14,
    fontSize: 12,
    fontFamily: 'monospace',
    minHeight: 180,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
    fontSize: 15,
  },

  // ═══════════════════════════════════════════════════════════════
  // STATS & INFO BOXES
  // ═══════════════════════════════════════════════════════════════
  statsBox: {
    backgroundColor: '#e8f5e9',
    padding: 16,
    borderRadius: 10,
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c8e6c9',
  },
  statsText: {
    fontSize: 14,
    color: '#2e7d32',
    fontWeight: '700',
  },
  clearText: {
    color: '#d32f2f',
    fontSize: 14,
    fontWeight: '700',
  },

  // ═══════════════════════════════════════════════════════════════
  // EMPTY STATES
  // ═══════════════════════════════════════════════════════════════
  emptyState: {
    alignItems: 'center',
    marginTop: 60,
    marginBottom: 40,
    padding: 30,
  },
  emptyText: {
    fontSize: 18,
    color: '#555',
    fontWeight: '700',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },

  // ═══════════════════════════════════════════════════════════════
  // PLAYER CARDS
  // ═══════════════════════════════════════════════════════════════
  playerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  playerGroupCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#1a1a2e',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  playerGroupName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 12,
  },
  seasonCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#1a1a2e',
  },
  seasonInfo: {
    marginBottom: 6,
  },
  statsGrid: {
    marginTop: 10,
  },
  seasonBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 10,
    overflow: 'hidden',
  },
  playerInfo: {
    marginBottom: 6,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  playerDetails: {
    fontSize: 13,
    color: '#666',
    marginTop: 3,
  },
  playerStats: {
    fontSize: 12,
    color: '#555',
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 18,
  },
  trueiResult: {
    backgroundColor: '#e3f2fd',
    padding: 10,
    borderRadius: 6,
    marginTop: 10,
  },
  trueiText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1565c0',
    marginBottom: 10,
  },
  inlineAnalysis: {
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    paddingTop: 10,
    marginTop: 5,
  },
  analysisTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1a1a2e',
    marginBottom: 5,
  },
  analysisLine: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  analysisVerdict: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 10,
    fontStyle: 'italic',
  },
  verdictPositive: {
    color: '#2e7d32',
  },
  verdictNegative: {
    color: '#d32f2f',
  },

  // ═══════════════════════════════════════════════════════════════
  // HELP & INFO BOXES
  // ═══════════════════════════════════════════════════════════════
  helpBox: {
    backgroundColor: '#fff8e1',
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#ffe082',
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#e65100',
    marginBottom: 6,
  },
  helpText: {
    fontSize: 13,
    color: '#bf360c',
    marginTop: 4,
    lineHeight: 20,
  },

  // ═══════════════════════════════════════════════════════════════
  // MODALS
  // ═══════════════════════════════════════════════════════════════
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  seasonButtons: {
    marginBottom: 16,
  },
  seasonButton: {
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
  },
  seasonButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  customSeasonButton: {
    backgroundColor: '#f8f9fa',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  customSeasonButtonText: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '600',
  },
  modalCancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  modalCancelButtonText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '600',
  },
  customInputContainer: {
    marginBottom: 14,
  },
  customSeasonInput: {
    backgroundColor: '#fafafa',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    marginBottom: 10,
  },
  customButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  customConfirmButton: {
    flex: 1,
    backgroundColor: '#16213e',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  customConfirmButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  customCancelButton: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  customCancelButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },

  // ═══════════════════════════════════════════════════════════════
  // ANALYSIS SECTION
  // ═══════════════════════════════════════════════════════════════
  analysisSection: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  analysisCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#1a1a2e',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  analysisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  analysisPlayerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a2e',
    flex: 1,
  },
  deltaText: {
    fontSize: 18,
    fontWeight: '700',
    minWidth: 80,
    textAlign: 'right',
  },
  deltaPositive: {
    color: '#2e7d32',
  },
  deltaNegative: {
    color: '#d32f2f',
  },
  analysisDetails: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  verdictText: {
    fontSize: 13,
    color: '#2e7d32',
    fontWeight: '600',
    marginTop: 10,
    fontStyle: 'italic',
  },

  // ═══════════════════════════════════════════════════════════════
  // TEAM BUTTONS & DROPDOWN
  // ═══════════════════════════════════════════════════════════════
  teamDropdownSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  teamButtonsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 8,
  },
  teamButton: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  teamButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  // ═══════════════════════════════════════════════════════════════
  // ROSTER & SEARCH
  // ═══════════════════════════════════════════════════════════════
  rosterAddSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  searchResults: {
    maxHeight: 220,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginTop: 8,
  },
  searchResultItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  searchResultName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1a2e',
  },
  searchResultDetails: {
    fontSize: 13,
    color: '#666',
    marginTop: 3,
  },

  // ═══════════════════════════════════════════════════════════════
  // TEAM OVERVIEW & PREDICTOR
  // ═══════════════════════════════════════════════════════════════
  teamOverview: {
    backgroundColor: '#e3f2fd',
    padding: 18,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#bbdefb',
  },
  overviewStat: {
    fontSize: 14,
    color: '#1565c0',
    marginTop: 6,
    fontWeight: '600',
  },
  playoffPredictorBox: {
    marginTop: 16,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  playoffPredictorLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  playoffPredictorValue: {
    fontSize: 42,
    fontWeight: '700',
    color: '#1a1a2e',
    marginVertical: 8,
  },
  playoffPredictorHint: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666',
  },

  // ═══════════════════════════════════════════════════════════════
  // TEAM INSIGHTS
  // ═══════════════════════════════════════════════════════════════
  teamInsights: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#ff9800',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  insightText: {
    fontSize: 13,
    color: '#555',
    marginTop: 6,
    lineHeight: 20,
  },
  warningText: {
    color: '#d32f2f',
  },
  successText: {
    color: '#2e7d32',
  },

  // ═══════════════════════════════════════════════════════════════
  // POSITION GROUPS & ROSTER CARDS
  // ═══════════════════════════════════════════════════════════════
  positionGroup: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  rosterPlayerCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  rosterPlayerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rosterPlayerName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  rosterPlayerDetails: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  rosterPlayerStats: {
    fontSize: 13,
    color: '#1a1a2e',
    fontWeight: '600',
    marginTop: 4,
  },
  removeButton: {
    backgroundColor: '#ef5350',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },

  // ═══════════════════════════════════════════════════════════════
  // TEAM STATS TABLE
  // ═══════════════════════════════════════════════════════════════
  teamStatsHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    paddingVertical: 12,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  teamStatsHeaderText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  teamStatsRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  teamStatsRowAlt: {
    backgroundColor: '#fafafa',
  },
  teamStatsCell: {
    width: 60,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  teamNameCell: {
    width: 85,
    fontWeight: '600',
  },
  wideCell: {
    width: 105,
  },
  positiveValue: {
    color: '#2e7d32',
    fontWeight: '700',
  },
  negativeValue: {
    color: '#d32f2f',
    fontWeight: '700',
  },
  teamStatsLegend: {
    marginTop: 16,
    padding: 14,
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  legendText: {
    fontSize: 11,
    color: '#666',
    marginBottom: 4,
    lineHeight: 16,
  },

  // ═══════════════════════════════════════════════════════════════
  // FILTERS & SELECTORS
  // ═══════════════════════════════════════════════════════════════
  seasonSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginRight: 12,
    marginBottom: 8,
    color: '#444',
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    marginBottom: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  filterButtonActive: {
    backgroundColor: '#1a1a2e',
    borderColor: '#1a1a2e',
  },
  filterButtonText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#fff',
  },

  // ═══════════════════════════════════════════════════════════════
  // STATS TAB TOGGLE
  // ═══════════════════════════════════════════════════════════════
  statsToggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    padding: 4,
  },
  statsFiltersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 10,
  },
  sumResultsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sumResultsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    backgroundColor: '#fff',
  },
  checkboxBoxChecked: {
    backgroundColor: '#1a1a2e',
  },
  checkboxTick: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  sumResultsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  statsToggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  statsToggleBtnActive: {
    backgroundColor: '#1a1a2e',
  },
  statsToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  statsToggleTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  statsModeRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 10,
  },
  statsModeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  statsModeBtnActive: {
    backgroundColor: '#4caf50',
    borderColor: '#4caf50',
  },
  statsModeText: {
    fontSize: 13,
    color: '#666',
  },
  statsModeTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // ═══════════════════════════════════════════════════════════════
  // DROPDOWN STYLES
  // ═══════════════════════════════════════════════════════════════
  dropdownWrapper: {
    minWidth: 180,
  },
  dropdownButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  dropdownButtonText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dropdownModal: {
    width: '100%',
    maxWidth: 380,
    maxHeight: 450,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#333',
  },

  // ═══════════════════════════════════════════════════════════════
  // STATS DATA TABLE
  // ═══════════════════════════════════════════════════════════════
  statsHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    paddingVertical: 12,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  statsHeaderCell: {
    width: 50,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  statsHeaderActive: {
    color: '#4caf50',
  },
  statsNameCell: {
    width: 130,
    textAlign: 'left',
    paddingLeft: 8,
  },
  statsTeamCell: {
    width: 80,
  },
  statsPosCell: {
    width: 40,
  },
  statsDataRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  statsDataRowAlt: {
    backgroundColor: '#fafafa',
  },
  statsCell: {
    width: 50,
    fontSize: 12,
    textAlign: 'center',
  },
  statsBold: {
    fontWeight: '700',
  },
  statsFooter: {
    marginTop: 16,
    padding: 14,
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  // Pagination styles
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    marginVertical: 8,
  },
  paginationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paginationRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paginationLabel: {
    fontSize: 13,
    color: '#666',
    marginRight: 8,
  },
  paginationBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    marginHorizontal: 3,
  },
  paginationBtnActive: {
    backgroundColor: '#1a1a2e',
    borderColor: '#1a1a2e',
  },
  paginationBtnText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
  },
  paginationBtnTextActive: {
    color: '#fff',
  },
  paginationNavBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1a1a2e',
    borderRadius: 6,
    marginHorizontal: 4,
  },
  paginationNavBtnDisabled: {
    backgroundColor: '#ccc',
  },
  paginationNavText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  paginationInfo: {
    fontSize: 13,
    color: '#666',
    marginHorizontal: 12,
  },
  // Accordion/expanded row styles
  statsExpandedRow: {
    backgroundColor: '#e8f4fc',
  },
  statsTotalsRow: {
    backgroundColor: '#d4edda',
    borderTopWidth: 2,
    borderTopColor: '#28a745',
  },
});









export default function RootApp() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}