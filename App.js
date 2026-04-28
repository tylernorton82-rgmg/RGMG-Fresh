import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
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
import CapDashboard from './CapDashboard';
import LinesBuilder from './LinesBuilder';
import RosterCapSummary from './RosterCapSummary';
import PlayerPhoto from './PlayerPhoto';
import PlayerModal from './PlayerModal';
// Lazy-loaded: these components only matter when their tab is opened.
// Code-splitting them shaves JS off the initial bundle and defers their
// component evaluation until needed. Saves ~60-80KB on first paint.
const TradeCalc = React.lazy(() => import('./TradeCalcV2'));
const Remix = React.lazy(() => import('./Remix'));

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

// ─────────────────────────────────────────────────────────────────────────
// PlayerRosterRow — a single row on the My Team page. Shows a 32px
// photo, the player's name, stats, salary, and a delete button. The
// photo component reports back its source (wikipedia/nhl/override/flag)
// via onResolved, which we render as a tiny colored dot so the user can
// visually scan for players needing manual photo overrides.
// ─────────────────────────────────────────────────────────────────────────
function PlayerRosterRow({
  player,
  isGoalie,
  salary,
  borderColor,
  theme,
  draftLookup,
  hasStatsInGame,
  onOpenModal,
  onRemove,
}) {
  const [photoSource, setPhotoSource] = React.useState('loading');
  const onResolved = React.useCallback(({ source }) => {
    setPhotoSource(source || 'flag'); // 'wikipedia' | 'nhl' | 'override' | 'flag'
  }, []);
  // Dot color:
  //   wikipedia → green
  //   nhl       → green (real photo, different source)
  //   override  → blue
  //   flag      → red (needs a manual override to get a photo)
  //   loading   → gray
  const dotColor =
    photoSource === 'wikipedia' ? '#4caf50' :
    photoSource === 'nhl'       ? '#4caf50' :
    photoSource === 'override'  ? '#2196f3' :
    photoSource === 'flag'      ? '#f44336' :
                                  '#bdbdbd';

  const statsLine = isGoalie
    ? `G · GSAA ${player.gsaa.toFixed(1)} · SV% ${(player.svPct * 100).toFixed(1)}`
    : `${player.pos} · TRUEi ${player.truei.toFixed(0)} · ${player.replacementLevel || ''}`;

  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: theme.borderLight,
      borderLeftWidth: 3,
      borderLeftColor: borderColor,
    }}>
      {/* 32px photo + status dot */}
      <View style={{ marginRight: 8, position: 'relative' }}>
        <PlayerPhoto
          name={player.name}
          draftLookup={draftLookup}
          country={player.country}
          hasStatsInGame={hasStatsInGame}
          size={32}
          showBorder={false}
          onResolved={onResolved}
        />
        {/* Status dot, bottom-right overlay */}
        <View style={{
          position: 'absolute',
          bottom: -1,
          right: -1,
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: dotColor,
          borderWidth: 1.5,
          borderColor: theme.bgCard,
        }} />
      </View>
      <TouchableOpacity onPress={() => onOpenModal(player.name)} style={{ flex: 1.4 }}>
        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' }} numberOfLines={1}>
          {player.name}
        </Text>
      </TouchableOpacity>
      <Text style={{ color: theme.textSecondary, fontSize: 11, flex: 2, marginRight: 6 }} numberOfLines={1}>
        {statsLine}
      </Text>
      <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600', minWidth: 60, textAlign: 'right', marginRight: 8 }}>
        {salary != null ? `$${salary.toFixed(2)}M` : '—'}
      </Text>
      <TouchableOpacity
        style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.danger, alignItems: 'center', justifyContent: 'center' }}
        onPress={() => onRemove(player.name)}
      >
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

function MainApp() {
  const [activeTab, setActiveTab] = useState('stats');
  const [playerDatabase, setPlayerDatabase] = useState([]);
  const [goalieDatabase, setGoalieDatabase] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [importText, setImportText] = useState('');
  
  // Theme state (dark/light mode)
  const [darkMode, setDarkMode] = useState(false);
  
  // Collapsible sections state
  const [collapsedSections, setCollapsedSections] = useState({});
  const toggleSection = (section) => setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  
  // Scroll tracking for "Back to Top" button
  const mainScrollViewRef = useRef(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const handleScroll = (event) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    setShowBackToTop(offsetY > 300);
  };
  const scrollToTop = () => {
    mainScrollViewRef.current?.scrollTo({ y: 0, animated: true });
  };
  
  // Column tooltip state
  const [activeTooltip, setActiveTooltip] = useState(null);
  const columnTooltips = {
    truei: 'TRUEi = Total Real Utility Index. Higher = better overall impact.',
    gsaa: 'GSAA = Goals Saved Above Average. Positive = better than league avg.',
    pdo: 'PDO = Shooting% + Save%. 100 is average, tends to regress.',
    atoi: 'ATOI = Average Time On Ice per game.',
    appt: 'APPT = Average Power Play Time per game.',
    apkt: 'APKT = Average Penalty Kill Time per game.',
    sPct: 'S% = Shooting Percentage. Goals / Shots on Goal.',
    foPct: 'FO% = Faceoff Win Percentage.',
  };
  
  // Theme colors - adjusted for better contrast
  const theme = {
    // Backgrounds — slate palette in dark mode, gives actual elevation/depth
    // Page is the darkest, cards sit above with visible borders.
    bg: darkMode ? '#0f172a' : '#f0f0f0',               // slate-900
    bgCard: darkMode ? '#1e293b' : '#fff',              // slate-800 — cards have lift
    bgHeader: darkMode ? '#020617' : '#1a1a2e',         // slate-950 — deep nav bar
    bgInput: darkMode ? '#1e293b' : '#fff',             // slate-800
    bgHover: darkMode ? '#334155' : '#f0f7ff',          // slate-700
    bgSelected: darkMode ? '#1e40af' : '#e3f2fd',       // blue-800 — saturated select
    bgAlt: darkMode ? '#0a1120' : '#f8f8f8',            // just below page bg
    // Text — slate-100 primary, slate-400 secondary, more readable than pure white
    text: darkMode ? '#f1f5f9' : '#333',                // slate-100
    textSecondary: darkMode ? '#94a3b8' : '#666',       // slate-400
    textMuted: darkMode ? '#64748b' : '#999',           // slate-500
    textInverse: darkMode ? '#0f172a' : '#fff',
    // Borders — visible in dark mode (slate-700), subtle in light
    border: darkMode ? '#334155' : '#e0e0e0',           // slate-700
    borderLight: darkMode ? '#1e293b' : '#f0f0f0',      // slate-800
    // Accents — unchanged; these pop on both light and dark
    primary: '#1a1a2e',
    accent: '#22c55e',                                   // green-500 — brighter than #4caf50
    accentBlue: '#3b82f6',                               // blue-500 — brighter for dark
    accentLight: darkMode ? '#166534' : '#e8f5e9',       // green-800 dim for dark
    danger: '#ef4444',                                   // red-500
    warning: '#f59e0b',                                  // amber-500
    // Table — zebra stripes that actually show up against slate-800 cards
    tableHeader: darkMode ? '#020617' : '#1a1a2e',       // slate-950 matches header
    tableRowAlt: darkMode ? '#162032' : '#f5f5f5',       // between 800 and 900
    tableRowHover: darkMode ? '#334155' : '#e8f4fc',     // slate-700
    tableRowExpanded: darkMode ? '#1e3a5f' : '#e8f4fc',  // blueish lift
    tableTotals: darkMode ? '#14532d' : '#d4edda',       // green-900 dim
    // Shadows — heavier in dark to create depth; light mode uses subtle
    shadow: darkMode ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.1)',
  };
  
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
  
  // Player modal — when set, PlayerModal renders showing that player's dossier
  const [modalPlayerName, setModalPlayerName] = useState(null);
  
  // Cross-tab team nav — set this to auto-switch to My Team and load that team at that season
  const [pendingTeamLoad, setPendingTeamLoad] = useState(null); // { team: 'Panthers', season: '2024-25' }

  // Track the currently loaded team name for display in Cap Summary
  const [currentTeamName, setCurrentTeamName] = useState('');

  // Collapse state for Add Players search (hidden by default to keep page clean)
  const [addPlayersCollapsed, setAddPlayersCollapsed] = useState(true);

  // Auto-load a team's roster from the RGMG API (1-hour cached). Hoisted to
  // component scope so it can be called from Teams tab, PlayerModal, etc.
  const loadTeamRoster = useCallback(async (teamName) => {
    const CACHE_KEY = `rgmg_team_cache_${teamName}`;
    const CACHE_TTL_MS = 60 * 60 * 1000;

    let teamData = null;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.ts && Date.now() - parsed.ts < CACHE_TTL_MS) {
          teamData = parsed.data;
        }
      }
    } catch {}

    if (!teamData) {
      try {
        const res = await fetch(`/api/team?name=${encodeURIComponent(teamName)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        teamData = await res.json();
        if (!teamData || !Array.isArray(teamData.players)) {
          throw new Error('Invalid team data');
        }
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: teamData })); } catch {}
      } catch (e) {
        console.error('Team load failed', teamName, e);
        if (Platform.OS === 'web') {
          window.alert(`Failed to load ${teamName}: ${e.message}`);
        }
        return;
      }
    }

    const nhlRoster = teamData.players.filter(p =>
      p.contract_type === 'signed' &&
      p.status === 'NHL' &&
      p.expiry_type !== 'COLLEGE' &&
      p.expiry_type !== 'EUROPE'
    );
    const skaters = nhlRoster.filter(p => !/^G/.test(p.position || '')).map(p => p.name);
    const goalies = nhlRoster.filter(p => /^G/.test(p.position || '')).map(p => p.name);

    const contractMap = {};
    teamData.players.forEach(p => {
      if (p.contract_type !== 'signed') return;
      contractMap[p.name] = {
        salary: parseFloat(p.salary) || 0,
        age: parseInt(p.age) || 0,
        retention_count: parseInt(p.retention_count) || 0,
        contract_duration: parseInt(p.contract_duration) || 0,
        expiry_type: p.expiry_type || '',
        status: p.status || '',
        pos: p.position || '',
        handedness: p.handedness || '',
        type: p.type || '',
        country: p.country || '',
      };
    });
    setRosterContracts(contractMap);
    try { await storageSetItem('rosterContracts', JSON.stringify(contractMap)); } catch {}

    setCurrentTeamName(teamName);
    try { localStorage.setItem('currentTeamName', teamName); } catch {}
    // Update URL hash for shareable team link (current roster, no season suffix)
    if (typeof window !== 'undefined') {
      const desired = `#team/${encodeURIComponent(teamName)}`;
      if (window.location.hash !== desired) {
        window.history.replaceState(null, '', desired);
      }
    }

    saveRoster({ skaters, goalies });
  }, []);

  // Navigate to a team's My Team view at a specific season — skips the confirm prompt.
  const navigateToTeam = useCallback((teamName, season) => {
    if (season) setRosterSeason(season);
    setPendingTeamLoad({ team: teamName, season });
    setActiveTab('roster');
    setModalPlayerName(null); // close any open modal
  }, []);

  // When pendingTeamLoad is set, actually load that team's roster (once activeTab is on roster).
  // Build a roster from the stats database for a historical (team, season) pair.
  // No contracts available since RGMG API only serves current rosters — salary
  // data won't show, but players + historical stats populate correctly.
  const loadHistoricalTeamRoster = useCallback((teamName, season) => {
    if (!teamName || !season) return;

    // Normalize target season ("2020-2021" and "2020-21" both → "2020-21").
    // Must use the same normalization as the rest of the app.
    const normSeason = (s) => {
      if (!s) return s;
      const cleaned = String(s).trim().replace(/[–—]/g, '-');
      const m = cleaned.match(/^(\d{4})[/-](\d{2}|\d{4})$/);
      if (!m) return cleaned;
      const endYear = m[2].length === 4 ? m[2].slice(-2) : m[2];
      return `${m[1]}-${endYear}`;
    };
    const targetSeason = normSeason(season);

    // Collect unique skater names for this team-season combo from playerDatabase.
    // Match team via AHL-aware comparison so affiliates roll up to parent.
    const skaterSet = new Set();
    playerDatabase.forEach(p => {
      if (normSeason(p.season) !== targetSeason) return;
      const pTeam = convertAhlToNhl(p.team || '');
      if (pTeam !== teamName) return;
      if (p.name) skaterSet.add(p.name);
    });

    const goalieSet = new Set();
    goalieDatabase.forEach(g => {
      if (normSeason(g.season) !== targetSeason) return;
      const gTeam = convertAhlToNhl(g.team || '');
      if (gTeam !== teamName) return;
      if (g.name) goalieSet.add(g.name);
    });

    const skaters = [...skaterSet];
    const goalies = [...goalieSet];

    // Wipe contracts (no historical contract data available)
    setRosterContracts({});
    try { storageSetItem('rosterContracts', JSON.stringify({})); } catch {}

    // Set the roster season so per-row stats filter to this year
    setRosterSeason(targetSeason);

    setCurrentTeamName(teamName);
    try { localStorage.setItem('currentTeamName', teamName); } catch {}
    // Update URL hash — include season for historical links
    if (typeof window !== 'undefined') {
      const desired = `#team/${encodeURIComponent(teamName)}/${encodeURIComponent(targetSeason)}`;
      if (window.location.hash !== desired) {
        window.history.replaceState(null, '', desired);
      }
    }

    saveRoster({ skaters, goalies });
  }, [playerDatabase, goalieDatabase]);

  useEffect(() => {
    if (!pendingTeamLoad) return;
    if (activeTab !== 'roster') return;

    // If a season was explicitly passed, ALWAYS use the stats-based historical
    // loader — the user wants the roster for THAT year, not whatever is
    // currently in RGMG's API (which only knows the present day).
    // Only fall through to the API fetch when no season was specified.
    const requestedSeason = pendingTeamLoad.season;

    if (requestedSeason) {
      loadHistoricalTeamRoster(pendingTeamLoad.team, requestedSeason);
    } else {
      loadTeamRoster(pendingTeamLoad.team);
    }
    setPendingTeamLoad(null);
  }, [pendingTeamLoad, activeTab, loadTeamRoster, loadHistoricalTeamRoster]);
  
  // My Team state
  const [myRoster, setMyRoster] = useState([]);
  const [rosterContracts, setRosterContracts] = useState({}); // { playerName: {salary, age, retention_count, ...} }
  // League-wide contract map populated via manual "Load League" in the
  // Contract Value scatter. Keyed by playerName. Persists to localStorage.
  const [leagueContracts, setLeagueContracts] = useState(() => {
    try {
      const saved = typeof window !== 'undefined' && window.localStorage.getItem('leagueContracts');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
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
  const [statsPerPage, setStatsPerPage] = useState(30); // 30, 60, 90, or 120
  const [statsCurrentPage, setStatsCurrentPage] = useState(0); // 0-indexed page
  // Column visibility for the stats table. Hidden = not rendered. Persists
  // to storage so choice is sticky across reloads. Always-visible columns
  // (Player/Team/Pos/Season/GP/TRUEi/Role/TRUEi-Z) are not togglable.
  const [hiddenStatsColumns, setHiddenStatsColumns] = useState(() => {
    try {
      const saved = typeof window !== 'undefined' && window.localStorage.getItem('hiddenStatsColumns');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const toggleStatsColumn = (col) => {
    setHiddenStatsColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      try { window.localStorage.setItem('hiddenStatsColumns', JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const isColHidden = (col) => hiddenStatsColumns.has(col);
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
    try {
      const saved = localStorage.getItem('currentTeamName');
      if (saved) setCurrentTeamName(saved);
    } catch {}
  }, []);

  // ========================================================================
  // URL HASH ROUTING — shareable/bookmarkable links
  // ========================================================================
  // Supported URLs:
  //   #player/Vincent%20Lecavalier   → opens Player Modal for that name
  //   #team/Panthers                 → switches to My Team tab + loads team
  //   #team/Panthers/2024-25         → team + explicit season (defaults to current)
  //
  // On mount and hashchange we parse the URL. When the modal opens/closes or
  // the tab changes, we write back the hash so the URL always reflects state.
  const parseAndApplyHash = useCallback(() => {
    if (typeof window === 'undefined') return;
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return;

    const parts = raw.split('/').map(decodeURIComponent);
    const kind = parts[0];

    if (kind === 'player' && parts[1]) {
      setModalPlayerName(parts[1]);
    } else if (kind === 'team' && parts[1]) {
      const teamName = parts[1];
      const season = parts[2] || null;
      if (season) setRosterSeason(season);
      setPendingTeamLoad({ team: teamName, season });
      setActiveTab('roster');
    }
  }, []);

  // Apply hash on initial mount
  useEffect(() => {
    parseAndApplyHash();
    if (typeof window === 'undefined') return;
    const onHashChange = () => parseAndApplyHash();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [parseAndApplyHash]);

  // When player modal opens/closes, sync the URL hash (without triggering hashchange loop)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (modalPlayerName) {
      const desired = `#player/${encodeURIComponent(modalPlayerName)}`;
      if (window.location.hash !== desired) {
        // Use replaceState to avoid polluting history with every modal nav step
        window.history.replaceState(null, '', desired);
      }
    } else {
      // Modal closed — only clear hash if it was a player hash (don't clobber team hash)
      const current = (window.location.hash || '').replace(/^#/, '');
      if (current.startsWith('player/')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }, [modalPlayerName]);

  const loadPlayers = async () => {
    try {
      // Try migration but don't fail if it doesn't work
      try {
        await migrateStorageToIndexedDb(['playerDatabase', 'goalieDatabase', 'seasonImages', 'myRoster']);
      } catch (migrationError) {
        console.log('Migration skipped:', migrationError);
      }

      // ─── CACHE FRESHNESS CHECK ───────────────────────────────────────────
      // The /api/players and /api/goalies endpoints are hit once per
      // (season × regular/playoffs) combo — that's 50+ requests per page
      // load if we don't cache. Check if we have fresh cached data first and
      // skip the full API sweep if so. TTL is 1 hour — RGMG stats don't
      // change that often between sims.
      const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
      const lastFetchedRaw = await storageGetItem('playerDataLastFetched');
      const lastFetched = lastFetchedRaw ? parseInt(lastFetchedRaw, 10) : 0;
      const cacheAgeMs = Date.now() - lastFetched;

      if (lastFetched && cacheAgeMs < CACHE_TTL_MS) {
        const cachedPlayers = await storageGetItem('playerDatabase');
        const cachedGoalies = await storageGetItem('goalieDatabase');
        if (cachedPlayers && cachedGoalies) {
          try {
            const parsedPlayers = JSON.parse(cachedPlayers);
            const parsedGoalies = JSON.parse(cachedGoalies);
            if (Array.isArray(parsedPlayers) && Array.isArray(parsedGoalies) &&
                parsedPlayers.length > 0 && parsedGoalies.length > 0) {
              console.log(`Using cached data (${Math.round(cacheAgeMs / 1000)}s old): ${parsedPlayers.length} players, ${parsedGoalies.length} goalies`);
              // Re-normalize team names against the current ahlToNhlMap +
              // junior-fallback logic. Guards against stale cached rows
              // that were ingested before a mapping existed.
              const remappedPlayers = parsedPlayers.map(p =>
                p && p.team ? { ...p, team: resolveTeam(p.team, p.name) } : p
              );
              const remappedGoalies = parsedGoalies.map(g =>
                g && g.team ? { ...g, team: resolveTeam(g.team, g.name) } : g
              );
              setPlayerDatabase(remappedPlayers);
              setGoalieDatabase(remappedGoalies);

              // Still load the roster/contracts/my team bits
              try {
                const savedRoster = await storageGetItem('myRoster');
                if (savedRoster) setMyRoster(JSON.parse(savedRoster));
                const savedContracts = await storageGetItem('rosterContracts');
                if (savedContracts) setRosterContracts(JSON.parse(savedContracts));
              } catch {}
              return; // Skip the full API sweep
            }
          } catch {
            // Parse failed, fall through to full fetch
          }
        }
      }

      // Helper: parse "MM:SS" time strings into decimal minutes
      const parseTime = (timeStr) => {
        if (!timeStr) return 0;
        const str = String(timeStr).replace(/"/g, '').trim();
        if (str.includes(':')) {
          const [mins, secs] = str.split(':').map(Number);
          return mins + (secs / 60);
        }
        return parseFloat(str) || 0;
      };

      // Helper: normalize a skater from API format to app format
      const normalizePlayer = (p, season, seasonType) => {
        const rawTeam = p.team_name || p.Team || p.team || '';
        const pname = p.name || p.Name || '';
        return {
          ...p,
          season,
          seasonType,
          name: pname,
          team: resolveTeam(rawTeam, pname),
          pos: p.pos || p.Pos || '',
          gp: parseInt(p.gp || p.GP || 0),
          g: parseInt(p.g || p.G || 0),
          a: parseInt(p.a || p.A || 0),
          p: parseInt(p.p || p.P || 0),
          plusMinus: parseInt(p['+/-'] || p.plusMinus || 0),
          pim: parseInt(p.pim || p.PIM || 0),
          ppp: parseInt(p.ppp || p.PPP || 0),
          shp: parseInt(p.shp || p.SHp || 0),
          ht: parseInt(p.ht || p.Ht || 0),
          ga: parseInt(p.ga || p.GA || 0),
          ta: parseInt(p.ta || p.TA || 0),
          sog: parseInt(p.sog || p.SOG || 0),
          sPct: parseFloat(p.shot_percent || p['S%'] || p.sPct || 0),
          sb: parseInt(p.sb || p.SB || 0),
          atoi: parseTime(p.atoi || p.ATOI || '0:00'),
          appt: parseTime(p.appt || p.APPT || '0:00'),
          apkt: parseTime(p.apkt || p.APKT || '0:00'),
          foPct: parseFloat(p.faceoff_percent || p['FO%'] || p.foPct || 0),
        };
      };

      // Helper: normalize goalie from API format
      const normalizeGoalie = (g, season, seasonType) => {
        const gname = g.name || g.Name || g.Player || g.player;
        return {
        ...g,
        season,
        seasonType,
        name: gname,
        team: resolveTeam(g.team_name || g.Team || g.team, gname),
        gp: parseInt(g.gp || g.GP || 0),
        w: parseInt(g.w || g.W || g.wins || 0),
        l: parseInt(g.l || g.L || g.losses || 0),
        t: parseInt(g.t || g.T || g.ties || g.OTL || g.otl || 0),
        wins: parseInt(g.w || g.W || g.wins || 0),
        losses: parseInt(g.l || g.L || g.losses || 0),
        otl: parseInt(g.otl || g.OTL || 0),
        gaa: parseFloat(g.gaa || g.GAA || 0),
        svPct: parseFloat(g.sv || g['SV%'] || g.svPct || 0),
        ga: parseInt(g.ga || g.GA || g['Goals Against'] || 0),
        pim: parseInt(g.pim || g.PIM || g.PIMs || 0),
        sha: parseInt(g.sha || g.SHA || g.SA || g.sa || 0),
        so: parseInt(g.so || g.SO || g.Shutouts || 0),
        g: parseInt(g.g || g.G || g.Goals || 0),
        a: parseInt(g.a || g.A || g.Assists || 0),
        toi: parseInt(g.toi || g.TOI || 0),
        };
      };

      console.log('Fetching seasons from API...');
      const seasonsRes = await fetch('/api/seasons');
      if (!seasonsRes.ok) throw new Error(`Seasons fetch failed: ${seasonsRes.status}`);
      const seasonsList = await seasonsRes.json();
      console.log(`Loaded ${seasonsList.length} seasons`);

      // Build array of fetch jobs: one per (season, type) pair for players AND goalies
      const fetchJobs = [];
      seasonsList.forEach(s => {
        ['regular', 'playoffs'].forEach(type => {
          fetchJobs.push({
            kind: 'players',
            season: s.season,
            seasonId: s.id,
            type,
            url: `/api/players?season=${s.id}&type=${type}`,
          });
          fetchJobs.push({
            kind: 'goalies',
            season: s.season,
            seasonId: s.id,
            type,
            url: `/api/goalies?season=${s.id}&type=${type}`,
          });
        });
      });

      console.log(`Firing ${fetchJobs.length} parallel API requests...`);

      const results = await Promise.all(
        fetchJobs.map(job =>
          fetch(job.url)
            .then(r => r.ok ? r.json() : [])
            .then(data => ({ ...job, data }))
            .catch(err => {
              console.warn(`Failed: ${job.url}`, err);
              return { ...job, data: [] };
            })
        )
      );

      const allPlayers = [];
      const allGoalies = [];

      results.forEach(result => {
        if (result.kind === 'players') {
          result.data.forEach(p => {
            allPlayers.push(normalizePlayer(p, result.season, result.type));
          });
        } else {
          result.data.forEach(g => {
            allGoalies.push(normalizeGoalie(g, result.season, result.type));
          });
        }
      });

      console.log('Loaded players:', allPlayers.length);
      console.log('Loaded goalies:', allGoalies.length);

      setPlayerDatabase(allPlayers);
      setGoalieDatabase(allGoalies);

      // Persist to storage + update cache timestamp so next page load
      // can skip the full API sweep if within TTL.
      try {
        await storageSetItem('playerDatabase', JSON.stringify(allPlayers));
        await storageSetItem('goalieDatabase', JSON.stringify(allGoalies));
        await storageSetItem('playerDataLastFetched', String(Date.now()));
      } catch (e) {
        console.log('Cache write failed:', e);
      }

      // Load user's saved roster from browser storage
      try {
        const savedRoster = await storageGetItem('myRoster');
        if (savedRoster) {
          setMyRoster(JSON.parse(savedRoster));
        }
        const savedContracts = await storageGetItem('rosterContracts');
        if (savedContracts) {
          setRosterContracts(JSON.parse(savedContracts));
        }
      } catch (rosterError) {
        console.log('Could not load roster:', rosterError);
      }
    } catch (error) {
      console.error('Error loading players:', error);
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

  // Team-name → ESPN abbreviation map, used for logo rendering.
  // ESPN's public CDN: https://a.espncdn.com/i/teamlogos/nhl/500/{abbr}.png
  const TEAM_LOGOS = {
    'Ducks': 'ana', 'Coyotes': 'ari', 'Bruins': 'bos', 'Sabres': 'buf',
    'Flames': 'cgy', 'Hurricanes': 'car', 'Blackhawks': 'chi', 'Avalanche': 'col',
    'Blue Jackets': 'cbj', 'Stars': 'dal', 'Red Wings': 'det', 'Oilers': 'edm',
    'Panthers': 'fla', 'Kings': 'la', 'Wild': 'min', 'Canadiens': 'mtl',
    'Predators': 'nsh', 'Devils': 'nj', 'Islanders': 'nyi', 'Rangers': 'nyr',
    'Senators': 'ott', 'Flyers': 'phi', 'Penguins': 'pit', 'Sharks': 'sj',
    'Kraken': 'sea', 'Blues': 'stl', 'Lightning': 'tb', 'Maple Leafs': 'tor',
    'Canucks': 'van', 'Golden Knights': 'vgk', 'Capitals': 'wsh', 'Jets': 'wpg',
  };

  const getTeamLogoUrl = (teamName) => {
    const abbr = TEAM_LOGOS[teamName];
    return abbr ? `https://a.espncdn.com/i/teamlogos/nhl/500/${abbr}.png` : null;
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

    // City-only short forms — RGMG API frequently emits just the city
    // ("Hartford", "Utica") instead of the full team name. Keep these
    // distinct from NHL nicknames to avoid collisions; NHL teams are
    // identified by nickname ("Blackhawks", "Sharks") so bare cities
    // are unambiguously AHL in this dataset.
    'Hartford': 'Rangers',
    'Hershey': 'Capitals',
    'Providence': 'Bruins',
    'Bridgeport': 'Islanders',
    'Lehigh Valley': 'Flyers',
    'Wilkes-Barre/Scranton': 'Penguins',
    'Wilkes-Barre': 'Penguins',
    'Albany': 'Devils',
    'Springfield': 'Panthers',
    'Laval': 'Canadiens',
    'Belleville': 'Senators',
    'Binghamton': 'Senators',
    'Rochester': 'Sabres',
    'Syracuse': 'Lightning',
    'Toronto': 'Maple Leafs',
    'Utica': 'Canucks',
    'Chicago': 'Blues',
    'Cleveland': 'Blue Jackets',
    'Lake Erie': 'Blue Jackets',
    'Grand Rapids': 'Red Wings',
    'Iowa': 'Wild',
    'Manitoba': 'Jets',
    'Milwaukee': 'Predators',
    'Rockford': 'Blackhawks',
    'Bakersfield': 'Oilers',
    'Oklahoma City': 'Oilers',
    'Colorado': 'Avalanche',
    'San Antonio': 'Avalanche',
    'Henderson': 'Golden Knights',
    'Ontario': 'Kings',
    'San Diego': 'Ducks',
    'San Jose': 'Sharks',
    'Stockton': 'Flames',
    'Tucson': 'Coyotes',
    'Texas': 'Stars',
    'Charlotte': 'Hurricanes',
    'Abbotsford': 'Canucks',
    'Coachella Valley': 'Kraken',
    'Calgary': 'Flames',
    // Historic city-only forms
    'Norfolk': 'Ducks',
    'Portland': 'Coyotes',
    'Hamilton': 'Canadiens',
    'Adirondack': 'Flames',
    'Lowell': 'Devils',
    'Houston': 'Wild',
    'Peoria': 'Blues',
    'Worcester': 'Sharks',
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
            pregen: d.pregen,
            team: d.team || null,
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

  // NHL nickname set — used to detect when a raw team name is already
  // an NHL club (so we skip the junior-fallback path).
  const NHL_NICKNAMES = new Set([
    'Avalanche','Blackhawks','Blue Jackets','Blues','Bruins','Canadiens',
    'Canucks','Capitals','Coyotes','Devils','Ducks','Flames','Flyers',
    'Hurricanes','Islanders','Jets','Kings','Lightning','Maple Leafs',
    'Oilers','Panthers','Penguins','Predators','Rangers','Red Wings',
    'Sabres','Senators','Sharks','Stars','Wild','Kraken','Golden Knights'
  ]);

  // Resolve a raw team name to its NHL parent club. Tries convertAhlToNhl
  // first (NHL passthrough + AHL affiliate map). If the result is still
  // unrecognized (junior/NCAA/Euro team — no club-level NHL parent),
  // falls back to the player's drafted team from DRAFT_DATA.
  //
  // Trade caveat per Tyler: a player traded after the draft will show
  // their original draft team, not their current team. Acceptable for
  // simulation-era data where pre-first-NHL-game trades are rare.
  const resolveTeam = (rawTeam, playerName) => {
    const mapped = convertAhlToNhl(rawTeam);
    if (!mapped || typeof mapped !== 'string') return mapped;
    // Already an NHL team — we're done.
    if (NHL_NICKNAMES.has(mapped.trim())) return mapped;
    // Unmapped — likely junior/NCAA/Euro. Use drafted team if we have it.
    if (playerName) {
      const draft = getDraftInfo(playerName);
      if (draft && draft.team) return draft.team;
    }
    return mapped;
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
      const pname = getFieldValue(headerMap, fields, ['name'], 0).replace(/"/g, '').trim();
      const player = {
        name: pname,
        team: resolveTeam(rawTeam, pname),
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
      const gname = getFieldValue(headerMap, fields, ['name'], 0).replace(/"/g, '').trim();
      const goalie = {
        name: gname,
        team: resolveTeam(rawTeam, gname),
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
  // Memoized team stats index. Built once per playerDatabase update.
  // Without this, getTeamStats below was O(n) per call — and calculateTRUEi
  // calls it once per player, tierBaselines calls calculateTRUEi for every
  // rostered player, so the old path was O(n²) on a 12k-row database (~50M
  // operations on every render). Indexed once here, lookups become O(1).
  const teamStatsIndex = useMemo(() => {
    if (!playerDatabase || playerDatabase.length === 0) return new Map();
    const buckets = new Map(); // key = `${team}|${normSeason}` → [players]
    for (const p of playerDatabase) {
      if (!p.team || !p.gp || p.gp <= 0) continue;
      const key = `${p.team}|${normalizeSeasonValue(p.season || '2024-25')}`;
      let bucket = buckets.get(key);
      if (!bucket) { bucket = []; buckets.set(key, bucket); }
      bucket.push(p);
    }
    const out = new Map();
    for (const [key, teammates] of buckets) {
      if (teammates.length < 3) continue;
      const forwards = [];
      const defensemen = [];
      for (const p of teammates) {
        if (isDefensemanPos(p.pos)) defensemen.push(p);
        else forwards.push(p);
      }
      let pmSum = 0;
      for (const p of teammates) pmSum += (p.plusMinus || 0);
      const teamAvgPlusMinus = pmSum / teammates.length;
      const mapSPG = arr => arr.map(p => p.sog / p.gp);
      const mapEvToi = arr => arr.map(p => p.atoi - p.appt - p.apkt);
      const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const stdev = arr => {
        if (arr.length < 2) return 0.1;
        const m = avg(arr);
        let s = 0;
        for (const x of arr) s += (x - m) * (x - m);
        return Math.sqrt(s / (arr.length - 1)) || 0.1;
      };
      const fwdSPG = mapSPG(forwards);
      const defSPG = mapSPG(defensemen);
      const fwdEvToi = mapEvToi(forwards);
      const defEvToi = mapEvToi(defensemen);
      out.set(key, {
        teamAvgPlusMinus,
        fwdAvgShots: avg(fwdSPG),
        fwdStdevShots: stdev(fwdSPG),
        defAvgShots: avg(defSPG),
        defStdevShots: stdev(defSPG),
        fwdAvgEvToi: avg(fwdEvToi),
        defAvgEvToi: avg(defEvToi),
      });
    }
    return out;
  }, [playerDatabase]);

  const getTeamStats = (team, season, players) => {
    // Fast path — memoized lookup, O(1). The `players` arg is kept for
    // backwards-compatibility but ignored; we always pull from the index
    // built from playerDatabase.
    const key = `${team}|${normalizeSeasonValue(season || '2024-25')}`;
    return teamStatsIndex.get(key) || null;
  };


  const calculateTRUEi = (player, allPlayers = playerDatabase) => {
    // Defensive: rows with missing/falsy pos (can happen for goalies that
    // came through the skater code path) would crash on .toUpperCase().
    // Treat as non-center non-D forward fallback.
    const pos = player && player.pos ? player.pos : '';
    const isDefenseman = isDefensemanPos(pos);
    const isCenter = pos.toUpperCase().startsWith('C');
    
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

    // TRUEi Faceoff value for centers (unchanged from 6.0) — clipped 30-70% to filter small-sample noise
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

    // Team Adjustments
    const teamStats = getTeamStats(player.team, player.season || '2024-25', allPlayers);
    
    if (teamStats) {
      // 1. Plus/Minus Adjustment
      const playerPlusMinus = player.plusMinus || 0;
      const plusMinusDiff = playerPlusMinus - teamStats.teamAvgPlusMinus;
      
      const playerEvToi = player.atoi - player.appt - player.apkt;
      const avgEvToi = isDefenseman ? teamStats.defAvgEvToi : teamStats.fwdAvgEvToi;
      const evToiRatio = avgEvToi > 0 ? (playerEvToi / avgEvToi) - 1 : 0;
      const clampedRatio = Math.max(-0.2, Math.min(0.2, evToiRatio));
      
      // TRUEi 7.0 CHANGE: Asymmetric TOI modifier on plus/minus.
      // When high-TOI player has BAD plus/minus ("not sameDirection"):
      //   → bigger relief (0.9 coefficient vs 6.0's 0.6). Tough minutes against top lines
      //     shouldn't be double-penalized.
      // When high-TOI player has GOOD plus/minus ("sameDirection"):
      //   → same 0.6 bonus as 6.0. Big minutes earning good +/- gets the same credit.
      const sign = plusMinusDiff >= 0 ? 1 : -1;
      const sameDirection = (plusMinusDiff >= 0) === (evToiRatio >= 0);
      const toiModifier = sameDirection 
        ? 1 + 0.6 * Math.sqrt(Math.abs(clampedRatio))
        : 1 - 0.9 * Math.sqrt(Math.abs(clampedRatio));  // TRUEi 7.0: was 0.6
      
      const bbValue = sign * Math.sqrt(Math.abs(plusMinusDiff)) * toiModifier;
      
      const ba1 = 1.41;
      trueiValue += ba1 * bbValue;
      
      // 2. Shot Rate Z-Score (unchanged)
      const playerShotsPerGame = player.sog / player.gp;
      const avgShots = isDefenseman ? teamStats.defAvgShots : teamStats.fwdAvgShots;
      const stdevShots = isDefenseman ? teamStats.defStdevShots : teamStats.fwdStdevShots;
      
      const zScore = (playerShotsPerGame - avgShots) / Math.max(0.1, stdevShots);
      const shotAdjustment = Math.max(-3.5, Math.min(3.5, Math.tanh(zScore) * 3.5));
      trueiValue += shotAdjustment;
    }

    // TRUEi 7.0 NEW: Role factor based on ATOI.
    // Centered at 14.5 minutes (league-avg forward TOI). 1.5% per minute deviation.
    // A 1st-line player at 18:00 gets ~5% boost; a 4th-liner at 12:00 gets ~4% dock.
    // Smooth curve replaces implicit tier cliffs — rewards role size directly.
    // Not applied to defensemen — they already have a TOI multiplier in the base calc.
    if (!isDefenseman) {
      const roleFactor = 1 + (player.atoi - 14.5) * 0.015;
      trueiValue *= roleFactor;
    }

    return trueiValue.toFixed(2);
  };

  // Decompose calculateTRUEi into labeled contributions. Same math as above,
  // just instrumented — keep the two in sync when TRUEi changes.
  // Returns null when gp<=0 (no useful breakdown). Contributions are given in
  // post-scale units (per-82 basis) so values are directly additive toward the
  // final TRUEi number.
  const calculateTRUEiBreakdown = (player, allPlayers = playerDatabase) => {
    if (!player || !player.gp || player.gp <= 0) return null;
    const pos = player.pos || '';
    if (!pos) return null;
    const isDefenseman = isDefensemanPos(pos);
    const isCenter = pos.toUpperCase().startsWith('C');

    const expectedSPct = isDefenseman ? 0.0222 : 0.1325;
    const shootingFloor = isDefenseman ? -0.0084 : -0.05;
    const shootingDiff = Math.max((player.sPct / 100) - expectedSPct, shootingFloor);
    const shootingValueRaw = player.sog * shootingDiff;

    // Per-82 unscaled base contributions (before position/role multipliers)
    const scale82 = 82 / player.gp;
    const parts = [
      { label: 'Goals', raw: player.g, value: player.g * scale82 },
      { label: 'Assists (×0.7)', raw: player.a, value: player.a * 0.7 * scale82 },
      { label: 'Takeaways (×0.15)', raw: player.ta, value: player.ta * 0.15 * scale82 },
      { label: 'Giveaways (×−0.075)', raw: player.ga, value: -player.ga * 0.075 * scale82 },
      { label: 'Hits (×0.025)', raw: player.ht, value: player.ht * 0.025 * scale82 },
      { label: 'Shooting vs expected', raw: `${player.sPct?.toFixed(1) ?? 0}%`, value: shootingValueRaw * scale82 },
      { label: 'Penalties (×−0.12)', raw: player.pim, value: -player.pim * 0.12 * scale82 },
      { label: 'PPP clip (×−0.25)', raw: player.ppp, value: -player.ppp * 0.25 * scale82 },
    ];

    let faceoffContribution = 0;
    if (isCenter && player.foPct > 30 && player.foPct < 70) {
      const evToi = player.atoi - player.appt - player.apkt;
      const estimatedFaceoffs = ((evToi * 0.819) + ((player.apkt + player.appt) * 1.229)) * player.gp;
      const faceoffValue = estimatedFaceoffs * (player.foPct - 50) / 50;
      faceoffContribution = faceoffValue * 0.05 * scale82;
      parts.push({ label: `Faceoffs (${player.foPct.toFixed(0)}%)`, raw: `${player.foPct.toFixed(1)}%`, value: faceoffContribution });
    }

    const rawPer82 = parts.reduce((s, p) => s + p.value, 0);

    // Position / role multiplier — applied at different points depending on
    // whether this is a defenseman or forward. Mirrors calculateTRUEi exactly:
    //   Defenseman: per-game value is multiplied BEFORE team context, so the
    //     D multiplier scales the per-82 base only.
    //   Forward: role factor is applied AT THE END, scaling the entire value
    //     (base + team adjustments together). So for forwards, afterMultiplier
    //     should equal rawPer82 (no scaling yet) and the multiplier is reported
    //     for display but applied after team-context adjustments below.
    let multiplier = 1;
    let multLabel = null;
    let preTeamValue; // the value into which team adjustments get added
    if (isDefenseman) {
      multiplier = Math.max(1.18, Math.min(1.51, 1.18 + ((player.atoi - 13) / 15) * 0.33));
      multLabel = `D multiplier (${player.atoi.toFixed(1)} ATOI)`;
      preTeamValue = rawPer82 * multiplier;
    } else {
      multiplier = 1 + (player.atoi - 14.5) * 0.015;
      multLabel = `Role factor (${player.atoi.toFixed(1)} ATOI)`;
      // Forwards: multiplier NOT yet applied. Applied at the very end.
      preTeamValue = rawPer82;
    }
    const afterMultiplier = preTeamValue;

    // Team adjustments
    const teamStats = getTeamStats(player.team, player.season || '2024-25', allPlayers);
    let plusMinusAdj = 0;
    let shotRateAdj = 0;
    if (teamStats) {
      const playerPlusMinus = player.plusMinus || 0;
      const plusMinusDiff = playerPlusMinus - teamStats.teamAvgPlusMinus;
      const playerEvToi = player.atoi - player.appt - player.apkt;
      const avgEvToi = isDefenseman ? teamStats.defAvgEvToi : teamStats.fwdAvgEvToi;
      const evToiRatio = avgEvToi > 0 ? (playerEvToi / avgEvToi) - 1 : 0;
      const clampedRatio = Math.max(-0.2, Math.min(0.2, evToiRatio));
      const sign = plusMinusDiff >= 0 ? 1 : -1;
      const sameDirection = (plusMinusDiff >= 0) === (evToiRatio >= 0);
      const toiModifier = sameDirection
        ? 1 + 0.6 * Math.sqrt(Math.abs(clampedRatio))
        : 1 - 0.9 * Math.sqrt(Math.abs(clampedRatio));
      const bbValue = sign * Math.sqrt(Math.abs(plusMinusDiff)) * toiModifier;
      plusMinusAdj = 1.41 * bbValue;

      const playerShotsPerGame = player.sog / player.gp;
      const avgShots = isDefenseman ? teamStats.defAvgShots : teamStats.fwdAvgShots;
      const stdevShots = isDefenseman ? teamStats.defStdevShots : teamStats.fwdStdevShots;
      const zScore = (playerShotsPerGame - avgShots) / Math.max(0.1, stdevShots);
      shotRateAdj = Math.max(-3.5, Math.min(3.5, Math.tanh(zScore) * 3.5));
    }

    // Final assembly — for forwards, role factor is applied AT THE END to the
    // full value (base + team adjustments). For defensemen, the multiplier was
    // already applied to the base; team adj added on top un-scaled.
    let total;
    if (isDefenseman) {
      total = afterMultiplier + plusMinusAdj + shotRateAdj;
    } else {
      total = (afterMultiplier + plusMinusAdj + shotRateAdj) * multiplier;
    }

    return {
      total,
      base: parts,                         // per-82 raw contributions
      rawPer82,                            // sum of parts (pre-multiplier)
      multiplier,                          // D or role factor
      multLabel,
      afterMultiplier,                     // rawPer82 for F, rawPer82*multiplier for D
      plusMinusAdj,                        // team +/- adj
      shotRateAdj,                         // shot-rate adj
      hasTeamContext: !!teamStats,
      isDefenseman,                        // for UI: tells panel where multiplier lands
    };
  };

  // ═══════════════════════════════════════════════════════════════
  // ROLE TIERS — per-team rank by weighted role score
  // ═══════════════════════════════════════════════════════════════
  //
  // A 4th-liner posting TRUEi 25 is doing something impressive in limited
  // minutes; a 1st-liner posting TRUEi 25 is a disappointment. Raw TRUEi
  // treats them as equals. We fix that by grouping players into role tiers
  // and computing a Z-score within tier.
  //
  // Why weighted score instead of raw ATOI:
  //   - EV TOI is ~flat across a roster (L1 and L4 both ~11-14 min in EHM).
  //     Ranking by EV alone is noisy.
  //   - PP deployment is the real coach-trust signal. Only top 5-6 F get PP1.
  //   - PK is trust too (defensive reliability) but less selective than PP.
  //   - Formula: score = EV × 1 + PP × 3 + PK × 1.5
  //
  // Tier assignment: pure per-team rank by role score. Top-3 forwards on a
  // team are L1 by definition — the roster is the complete context. A
  // weak-team L1 posting low raw production shows up as a low RATING (good
  // tier, bad performance for tier) rather than being demoted to L3.
  //
  // Forward tiers (top-down by role score):
  //   L1: ranks 1-3   (top line — play every situation)
  //   L2: ranks 4-6   (second line — PP2 or PK1)
  //   L3: ranks 7-9   (third line — middle six, specialists)
  //   L4: ranks 10+   (fourth line / depth — minimal ST trust)
  //
  // Defense tiers:
  //   D1: ranks 1-2   (top pair — PP + PK)
  //   D2: ranks 3-4   (second pair)
  //   D3: ranks 5+    (third pair / depth)
  //
  // Goalies: GP-based, not team-rank (easier to interpret):
  //   G1: ≥35 GP      (starter)
  //   G2: <35 GP      (backup)
  //
  // Sample size guard: tier-baseline stats only include players with gp >= 20
  // so small-sample hot-stretch outliers don't poison the mean/stdev.
  const ROLE_TIERS = {
    L1: 'Top-6 F · L1', L2: 'Top-6 F · L2', L3: 'Bot-6 F · L3', L4: 'Depth F · L4',
    D1: 'Top-2 D', D2: 'Top-4 D', D3: 'Bot-4 D',
    G1: 'Starter', G2: 'Backup',
  };

  // Single source of truth for converting the tier code into the human-
  // readable "1st Line / 2nd Line / 1st Pair / Starter" labels used
  // throughout the app. Used by My Team roster rows and Analysis tab so
  // everything stays consistent with the role-score-based tier system.
  const tierToLineLabel = (tier) => {
    switch (tier) {
      case 'L1': return '1st Line';
      case 'L2': return '2nd Line';
      case 'L3': return '3rd Line';
      case 'L4': return '4th Line';
      case 'D1': return '1st Pair';
      case 'D2': return '2nd Pair';
      case 'D3': return '3rd Pair';
      case 'G1': return 'Starter';
      case 'G2': return 'Backup';
      default:   return '—';
    }
  };

  const assignRoleTier = (player, rosterPlayers) => {
    if (!player) return null;
    const isG = player.pos && player.pos.toUpperCase().startsWith('G');
    if (isG) {
      return (player.gp || 0) >= 35 ? 'G1' : 'G2';
    }
    const isD = isDefensemanPos(player.pos);
    // GP threshold of 20: tier ranking needs a real sample. Call-ups (5-15 GP)
    // would otherwise sink real roster players down the rank, pushing
    // legit top-9 guys into L4. Matches the MIN_GP used in tierBaselines.
    // We always include the player themselves in the peer set so partial-
    // season rows (e.g. traded mid-season) still get ranked instead of
    // falling to the EV-TOI floor fallback.
    const peers = rosterPlayers.filter(p => {
      if (p.team !== player.team) return false;
      if (normalizeSeasonValue(p.season || '2024-25') !== normalizeSeasonValue(player.season || '2024-25')) return false;
      if (isDefensemanPos(p.pos) !== isD) return false;
      if ((p.pos || '').toUpperCase().startsWith('G')) return false;
      // Always include the target player, even if under GP threshold.
      if (p.name === player.name) return true;
      return (p.gp || 0) >= 20;
    });
    // Role score: EV TOI × 1 + PP TOI × 3 + PK TOI × 1.5.
    // Why weighted: EV is ~flat across a roster (±2-3 min between L1 and L4),
    // so special-teams deployment is the real coach-trust signal. PP is the
    // most exclusive role (only top 5-6 F get it) → weight 3. PK is trust-
    // worthy defensive signal but less selective (8+ F rotate) → weight 1.5.
    const roleScore = (p) => {
      const ev = (p.atoi || 0) - (p.appt || 0) - (p.apkt || 0);
      return ev + 3 * (p.appt || 0) + 1.5 * (p.apkt || 0);
    };
    const sorted = [...peers].sort((a, b) => roleScore(b) - roleScore(a));
    const idx = sorted.findIndex(p => p.name === player.name && p.season === player.season);
    if (idx < 0) {
      // Player not in the indexed peer set (edge case: <5 GP). Fall back to
      // EV-TOI-only floor so we still return something sane.
      const ev = (player.atoi || 0) - (player.appt || 0) - (player.apkt || 0);
      if (isD) return ev >= 17 ? 'D1' : ev >= 14 ? 'D2' : 'D3';
      return ev >= 14 ? 'L1' : ev >= 11.5 ? 'L2' : ev >= 9 ? 'L3' : 'L4';
    }
    const rank = idx + 1;
    // Pure rank — roster size IS the context. Top 3 F = L1, next 3 = L2, etc.
    if (isD) {
      if (rank <= 2) return 'D1';
      if (rank <= 4) return 'D2';
      return 'D3';
    }
    if (rank <= 3) return 'L1';
    if (rank <= 6) return 'L2';
    if (rank <= 9) return 'L3';
    return 'L4';
  };

  // Full-league SvPct — small helper used by tier baselines for goalies.
  const leagueAvgSvPctFull = useMemo(() => {
    const saves = goalieDatabase.reduce((s, g) => s + ((g.sha || 0) - (g.ga || 0)), 0);
    const shots = goalieDatabase.reduce((s, g) => s + (g.sha || 0), 0);
    return shots > 0 ? saves / shots : 0.905;
  }, [goalieDatabase]);

  // Tier baselines (mean + stdev of raw TRUEi across the full dataset,
  // per tier). Pre-indexes peers by team+season+isD so assignRoleTier
  // becomes O(1) instead of O(n) per player. Critical on mobile where the
  // old O(n²) sweep hit 10s. Also computes TRUEi + tier in the same pass
  // and caches them onto row objects for reuse in buildSkaterRows.
  const tierBaselines = useMemo(() => {
    if (!playerDatabase || playerDatabase.length === 0) return null;
    const MIN_GP = 20;

    // Build peer index: key = `${team}|${normSeason}|${isD}`, value = sorted peers by ATOI desc
    // Only includes regular-season entries with meaningful ice time — otherwise
    // playoff rosters and AHL call-ups muddy the ranking (e.g. a full-time
    // D1 getting pushed to D3 because 6 other partial-season entries exist
    // for the same team). MIN_GP = 20 matches the baseline threshold.
    const peerIndex = new Map();
    const keyOf = (p) => `${p.team}|${normalizeSeasonValue(p.season || '2024-25')}|${isDefensemanPos(p.pos) ? 'D' : 'F'}`;
    playerDatabase.forEach(p => {
      if (!p || !p.pos) return;
      if (p.pos.toUpperCase().startsWith('G')) return;
      if ((p.gp || 0) < MIN_GP) return;
      if (getSeasonType(p) !== 'regular') return;
      const k = keyOf(p);
      if (!peerIndex.has(k)) peerIndex.set(k, []);
      peerIndex.get(k).push(p);
    });
    // Sort each bucket once, cache role tier per player by name+season.
    // Role score: EV×1 + PP×3 + PK×1.5. Pure rank — roster IS the context.
    // Top-3 F on a team are L1 by definition, regardless of absolute TOI.
    const tierByPlayer = new Map(); // key: `${name}|${season}` → tier
    const tierKeyOf = (p) => `${p.name}|${normalizeSeasonValue(p.season || '2024-25')}`;
    const roleScore = (p) => {
      const ev = (p.atoi || 0) - (p.appt || 0) - (p.apkt || 0);
      return ev + 3 * (p.appt || 0) + 1.5 * (p.apkt || 0);
    };
    peerIndex.forEach((arr, k) => {
      arr.sort((a, b) => roleScore(b) - roleScore(a));
      const isD = k.endsWith('|D');
      arr.forEach((p, idx) => {
        const rank = idx + 1;
        const tier = isD
          ? (rank <= 2 ? 'D1' : rank <= 4 ? 'D2' : 'D3')
          : (rank <= 3 ? 'L1' : rank <= 6 ? 'L2' : rank <= 9 ? 'L3' : 'L4');
        tierByPlayer.set(tierKeyOf(p), tier);
      });
    });

    const buckets = { L1: [], L2: [], L3: [], L4: [], D1: [], D2: [], D3: [], G1: [], G2: [] };
    playerDatabase.forEach(p => {
      if ((p.gp || 0) < MIN_GP) return;
      if (getSeasonType(p) !== 'regular') return;
      if (!p.pos || p.pos.toUpperCase().startsWith('G')) return;
      const tier = tierByPlayer.get(tierKeyOf(p));
      if (!tier) return;
      const t = parseFloat(calculateTRUEi(p, playerDatabase)) || 0;
      if (Number.isFinite(t)) buckets[tier].push(t);
    });
    goalieDatabase.forEach(g => {
      if ((g.gp || 0) < 10) return;
      if (getSeasonType(g) !== 'regular') return;
      const tier = (g.gp || 0) >= 35 ? 'G1' : 'G2';
      const gsaa = calculateGSAA(g, leagueAvgSvPctFull);
      if (Number.isFinite(gsaa)) buckets[tier].push(gsaa);
    });
    const out = {};
    const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const sd = arr => {
      if (arr.length < 2) return 1;
      const m = mean(arr);
      return Math.sqrt(arr.map(x => (x - m) ** 2).reduce((a, b) => a + b, 0) / (arr.length - 1)) || 1;
    };
    Object.keys(buckets).forEach(k => {
      out[k] = { mean: mean(buckets[k]), stdev: sd(buckets[k]), n: buckets[k].length };
    });
    // Attach the tier index so calculateTRUEiZ can reuse it without another sweep
    out.__tierByPlayer = tierByPlayer;
    out.__tierKeyOf = tierKeyOf;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerDatabase, goalieDatabase, leagueAvgSvPctFull]);

  // Tier-relative Z-score.
  // z=0 = average for role · +1 ≈ 84th pctile · +2 ≈ elite · −1 = below avg
  const calculateTRUEiZ = (player) => {
    if (!player || !tierBaselines) return null;
    const isGoalie = (player.pos && player.pos.toUpperCase().startsWith('G'))
      || player.sha != null;
    let tier;
    if (isGoalie) {
      tier = (player.gp || 0) >= 35 ? 'G1' : 'G2';
    } else {
      // Fast path: reuse the tier map built inside tierBaselines
      const map = tierBaselines.__tierByPlayer;
      const keyFn = tierBaselines.__tierKeyOf;
      if (map && keyFn) {
        tier = map.get(keyFn(player));
      }
      // Fallback: role-score thresholds (only hit for rows not in the peer
      // index, e.g. <20 GP or playoff rows). Same formula as main path —
      // EV×1 + PP×3 + PK×1.5 — but applied against absolute thresholds
      // instead of per-team rank.
      if (!tier) {
        const ev = (player.atoi || 0) - (player.appt || 0) - (player.apkt || 0);
        const score = ev + 3 * (player.appt || 0) + 1.5 * (player.apkt || 0);
        const isD = isDefensemanPos(player.pos);
        if (isD) tier = score >= 22 ? 'D1' : score >= 17 ? 'D2' : 'D3';
        else tier = score >= 22 ? 'L1' : score >= 17 ? 'L2' : score >= 13 ? 'L3' : 'L4';
      }
    }
    if (!tier) return null;
    const baseline = tierBaselines[tier];
    if (!baseline || baseline.n < 10) return { z: null, tier, tierLabel: ROLE_TIERS[tier], insufficientData: true };
    const rawValue = tier.startsWith('G')
      ? calculateGSAA(player, leagueAvgSvPctFull)
      : parseFloat(calculateTRUEi(player, playerDatabase)) || 0;
    const z = (rawValue - baseline.mean) / (baseline.stdev || 1);
    return { z, tier, tierLabel: ROLE_TIERS[tier], baseline, rawValue };
  };

  // Map a z-score to a "Role Rating" centered on 50, where +3σ = 100 and
  // -3σ = 0. Uncapped on both ends — a player at z = +4 shows ~117,
  // meaning "off the charts for this role." Lets genuine outliers stand out
  // instead of clumping at 100. Bottom is floored at 0 (no negative ratings).
  const zToRating = (z) => {
    if (z == null || !Number.isFinite(z)) return null;
    const rating = 50 + (z / 3) * 50;
    return Math.max(0, rating);
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
        const avgAtoi = p.gp > 0 ? p.atoi / p.gp : 0;
        const aggregatedTruei = p.gp > 0 ? p.trueiTotal / p.gp : 0;
        // For Sum Results, synthesize a player shape so assignRoleTier +
        // Z baselines can work. Per-team rank breaks down across multiple
        // seasons, so we fall back to fixed ATOI thresholds (same logic
        // used inside assignRoleTier when rank isn't resolvable).
        const syn = { pos: p.pos, atoi: avgAtoi, gp: p.gp, team: p.team, season: null, name: p.name };
        const tier = calculateTRUEiZ ? (calculateTRUEiZ(syn)?.tier || null) : null;
        // Compute Z against the aggregated TRUEi vs. that tier's baseline.
        let zValue = null;
        if (tier && tierBaselines && tierBaselines[tier] && tierBaselines[tier].n >= 10 && !tier.startsWith('G')) {
          zValue = (aggregatedTruei - tierBaselines[tier].mean) / (tierBaselines[tier].stdev || 1);
        }
        return {
          ...p,
          sPct: p.sog > 0 ? (p.g / p.sog) * 100 : 0,
          foPct: p.foPctCount > 0 ? p.totalFoPct / p.foPctCount : 0,
          avgAtoi,
          avgAppt: p.gp > 0 ? p.appt / p.gp : 0,
          avgApkt: p.gp > 0 ? p.apkt / p.gp : 0,
          truei: aggregatedTruei,
          draftYear: draftInfo?.draftYear || 0,
          draftRound: draftInfo?.round || 999,
          draftPick: draftInfo?.overall || 999,
          pregen: draftInfo?.pregen || '',
          roleTier: tier,
          trueiZ: zValue,
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
        const aggGsaa = calculateGSAA({ sha: g.sha, ga: g.ga }, leagueAvgSvPct);
        const tier = (g.gp || 0) >= 35 ? 'G1' : 'G2';
        let zValue = null;
        if (tierBaselines && tierBaselines[tier] && tierBaselines[tier].n >= 10) {
          zValue = (aggGsaa - tierBaselines[tier].mean) / (tierBaselines[tier].stdev || 1);
        }
        return {
          ...g,
          svPct: g.sha > 0 ? (g.sha - g.ga) / g.sha : 0,
          gaa: g.gp > 0 ? g.gaaWeighted / g.gp : 0,
          gsaa: aggGsaa,
          toi: g.toi,
          roleTier: tier,
          trueiZ: zValue,
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
          // Precompute role + TRUEi-Z so the columns are sortable.
          // `calculateTRUEiZ` reads `tierBaselines` (memoized across the full DB)
          // and runs `assignRoleTier` (per-team ATOI rank). Cheap per-row.
          const zInfo = calculateTRUEiZ ? calculateTRUEiZ(p) : null;
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
            roleTier: zInfo?.tier || null,
            trueiZ: zInfo?.z ?? null,
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
          const zInfo = calculateTRUEiZ ? calculateTRUEiZ(g) : null;
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
            roleTier: zInfo?.tier || null,
            trueiZ: zInfo?.z ?? null,
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
      // Null/undefined always sort to the bottom regardless of direction —
      // avoids nulls clumping at the top on DESC sort for sparse columns
      // like trueiZ (missing when a tier baseline has <10 samples).
      const aMissing = valA == null;
      const bMissing = valB == null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return statsSortAsc ? -1 : 1;
      if (valA > valB) return statsSortAsc ? 1 : -1;
      return 0;
    });

    const sortedGoalies = [...filteredGoalies].sort((a, b) => {
      let valA = a[statsSortColumn];
      let valB = b[statsSortColumn];
      const aMissing = valA == null;
      const bMissing = valB == null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
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


  const StatsDropdown = ({ label, value, options, onChange }) => {
    const [open, setOpen] = useState(false);
    const displayValue = formatSeasonLabel(value);

    return (
      <View style={styles.dropdownWrapper}>
        {label ? <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>{label}</Text> : null}
        <TouchableOpacity
          style={[styles.dropdownButton, { backgroundColor: theme.bgInput, borderColor: theme.border }]}
          onPress={() => setOpen(true)}
        >
          <Text style={[styles.dropdownButtonText, { color: theme.text }]}>{displayValue}</Text>
        </TouchableOpacity>
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
            <View style={[styles.dropdownModal, { backgroundColor: theme.bgCard, borderColor: theme.border }]} onStartShouldSetResponder={() => true}>
              <ScrollView>
                {options.map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.dropdownItem, { borderBottomColor: theme.borderLight }]}
                    onPress={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownItemText, { color: theme.text }]}>{formatSeasonLabel(opt)}</Text>
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
    
    const SortHeader = ({ column, label }) => {
      const hasTooltip = columnTooltips[column];
      return (
        <TouchableOpacity 
          onPress={() => handleSort(column)}
          onLongPress={() => hasTooltip && setActiveTooltip(activeTooltip === column ? null : column)}
          delayLongPress={300}
        >
          <Text style={[styles.statsHeaderCell, statsSortColumn === column && styles.statsHeaderActive]}>
            {label} {statsSortColumn === column ? (statsSortAsc ? '↑' : '↓') : ''}
            {hasTooltip && ' ⓘ'}
          </Text>
          {activeTooltip === column && hasTooltip && (
            <View style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              backgroundColor: darkMode ? '#333' : '#fff',
              padding: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: theme.border,
              width: 180,
              zIndex: 9999,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.2,
              shadowRadius: 4,
              elevation: 5,
            }}>
              <Text style={{ fontSize: 11, color: theme.text, lineHeight: 15 }}>
                {columnTooltips[column]}
              </Text>
              <TouchableOpacity 
                onPress={() => setActiveTooltip(null)}
                style={{ position: 'absolute', top: 2, right: 4 }}
              >
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      );
    };

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

    // Check if any filters are active
    const hasActiveFilters = statsTeamFilter !== 'All' || 
      statsPositionFilter !== 'All' || 
      statsDraftYearFilter !== 'All' || 
      statsDraftRoundFilter !== 'All' || 
      statsDraftPickFilter !== 'All' ||
      statsSearchQuery.trim() !== '';
    
    const clearAllFilters = () => {
      setStatsTeamFilter('All');
      setStatsPositionFilter('All');
      setStatsDraftYearFilter('All');
      setStatsDraftRoundFilter('All');
      setStatsDraftPickFilter('All');
      setStatsSearchQuery('');
      setStatsCurrentPage(0);
    };

    return (
      <View style={[styles.tabContent, { backgroundColor: theme.bg }]}>
        <Text style={[styles.title, { color: theme.text, marginBottom: 8 }]}>Stats Leaders</Text>

        {/* View Toggle - more "tabby" look */}
        <View style={[styles.statsToggleRow, { 
          backgroundColor: theme.bgCard, 
          borderRadius: 8, 
          borderWidth: 1, 
          borderColor: theme.border,
          padding: 4,
          marginBottom: 12,
        }]}>
          <TouchableOpacity
            style={[
              styles.statsToggleBtn, 
              { borderRadius: 6 },
              statsView === 'skaters' && { backgroundColor: theme.accentBlue }
            ]}
            onPress={() => { setStatsView('skaters'); setStatsSortColumn('truei'); }}
          >
            <Text style={[
              styles.statsToggleText, 
              { color: statsView === 'skaters' ? '#fff' : theme.textSecondary }
            ]}>Skaters</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.statsToggleBtn, 
              { borderRadius: 6 },
              statsView === 'goalies' && { backgroundColor: theme.accentBlue }
            ]}
            onPress={() => { setStatsView('goalies'); setStatsSortColumn('gsaa'); }}
          >
            <Text style={[
              styles.statsToggleText, 
              { color: statsView === 'goalies' ? '#fff' : theme.textSecondary }
            ]}>Goalies</Text>
          </TouchableOpacity>
        </View>

        {/* Filters */}
        <View style={[styles.statsFiltersRow, { 
          backgroundColor: theme.bgCard, 
          padding: 12, 
          borderRadius: 8, 
          marginBottom: 8,
          borderWidth: 1,
          borderColor: theme.border,
        }]}>
          <StatsDropdown
            label="Season Type"
            value={statsSeasonType === 'playoffs' ? 'Playoffs' : 'Regular Season'}
            options={['Regular Season', 'Playoffs']}
            onChange={(opt) => {
              const newType = opt === 'Playoffs' ? 'playoffs' : 'regular';
              setStatsSeasonType(newType);
              // Reset season selection when changing type to ensure valid data
              setStatsSeasonStart(null);
              setStatsSeasonEnd(null);
              setStatsCurrentPage(0);
            }}
          />
          <StatsDropdown
            label="Start Season"
            value={statsSeasonStart || defaultSeason}
            options={dataSeasons.length > 0 ? dataSeasons : [defaultSeason]}
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
            options={dataSeasons.length > 0 
              ? dataSeasons.filter(s => s >= (statsSeasonStart || defaultSeason))
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
            <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>Search</Text>
            <TextInput
              style={{
                backgroundColor: theme.bgInput,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 10,
                paddingVertical: 10,
                paddingHorizontal: 14,
                fontSize: 13,
                color: theme.text,
              }}
              placeholder="Player name..."
              placeholderTextColor={theme.textMuted}
              value={statsSearchQuery}
              onChangeText={setStatsSearchQuery}
            />
          </View>
          {/* Per page selector — moved up from under-table pagination so it sits
              alongside Search and frees vertical space below. */}
          <View style={{ alignSelf: 'flex-end' }}>
            <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>Per page</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {[30, 60, 90, 120].map(num => (
                <TouchableOpacity
                  key={num}
                  onPress={() => { setStatsPerPage(num); setStatsCurrentPage(0); }}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: statsPerPage === num ? (theme.accentBlue || '#3b82f6') : theme.bgInput,
                    borderWidth: 1,
                    borderColor: statsPerPage === num ? (theme.accentBlue || '#3b82f6') : theme.border,
                  }}
                >
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '600',
                    color: statsPerPage === num ? '#fff' : theme.text,
                  }}>{num}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {/* Columns picker — toggle visibility of hideable columns */}
          <View style={{ alignSelf: 'flex-end', position: 'relative' }}>
            <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>Columns</Text>
            <TouchableOpacity
              onPress={() => setColumnPickerOpen(v => !v)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 8,
                backgroundColor: hiddenStatsColumns.size > 0 ? (theme.accentBlue || '#3b82f6') : theme.bgInput,
                borderWidth: 1,
                borderColor: hiddenStatsColumns.size > 0 ? (theme.accentBlue || '#3b82f6') : theme.border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: hiddenStatsColumns.size > 0 ? '#fff' : theme.text }}>
                {hiddenStatsColumns.size > 0 ? `${hiddenStatsColumns.size} hidden` : 'All visible'}
              </Text>
              <Text style={{ fontSize: 10, color: hiddenStatsColumns.size > 0 ? '#fff' : theme.textSecondary }}>▼</Text>
            </TouchableOpacity>
            {columnPickerOpen && (
              <View style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                backgroundColor: theme.bgCard,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 8,
                padding: 8,
                minWidth: 260,
                zIndex: 1000,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 8,
                elevation: 8,
              }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 6, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: theme.text }}>Toggle Columns</Text>
                  <TouchableOpacity onPress={() => {
                    setHiddenStatsColumns(new Set());
                    try { window.localStorage.setItem('hiddenStatsColumns', '[]'); } catch {}
                  }}>
                    <Text style={{ fontSize: 11, color: theme.accentBlue || '#3b82f6', fontWeight: '600' }}>Show all</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 10, color: theme.textSecondary, paddingHorizontal: 6, marginBottom: 4, fontStyle: 'italic' }}>
                  Player, Team, Pos, Season, GP, TRUEi, Rating always visible
                </Text>
                <ScrollView style={{ maxHeight: 300 }}>
                  {(statsView === 'skaters' ? [
                    ['g', 'G'], ['a', 'A'], ['p', 'P'], ['plusMinus', '+/-'],
                    ['pim', 'PIM'], ['ppp', 'PPP'], ['shp', 'SHP'],
                    ['ht', 'HIT'], ['ga', 'GA'], ['ta', 'TA'],
                    ['sog', 'SOG'], ['sPct', 'S%'], ['sb', 'SB'],
                    ['avgAtoi', 'ATOI'], ['avgAppt', 'APPT'], ['avgApkt', 'APKT'], ['foPct', 'FO%'],
                    ['draftYear', 'Yr'], ['draftRound', 'Rd'], ['draftPick', 'Pick'], ['pregen', 'Pregen'],
                  ] : [
                    ['w', 'W'], ['l', 'L'], ['t', 'T'], ['sha', 'SA'],
                    ['ga', 'GA'], ['svPct', 'SV%'], ['gaa', 'GAA'], ['so', 'SO'],
                    ['gsaa', 'GSAA'], ['toi', 'TOI'],
                    ['g', 'G'], ['a', 'A'], ['p', 'P'], ['pim', 'PIM'],
                  ]).map(([key, label]) => {
                    const hidden = hiddenStatsColumns.has(key);
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => toggleStatsColumn(key)}
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          borderRadius: 4,
                        }}
                      >
                        <View style={{
                          width: 16, height: 16, borderRadius: 3,
                          borderWidth: 1, borderColor: theme.border,
                          backgroundColor: hidden ? theme.bgInput : (theme.accentBlue || '#3b82f6'),
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {!hidden && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>✓</Text>}
                        </View>
                        <Text style={{ fontSize: 13, color: theme.text }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>
          {/* Inline pagination — Back | info | Next, sits beside Per page
              so the bottom-of-table pagination bar can go away entirely. */}
          {(() => {
            const activeData = statsView === 'skaters' ? sortedSkaters : sortedGoalies;
            const totalPages = Math.max(1, Math.ceil(activeData.length / statsPerPage));
            const startIdx = statsCurrentPage * statsPerPage;
            const endIdx = Math.min(startIdx + statsPerPage, activeData.length);
            const atStart = statsCurrentPage === 0;
            const atEnd = statsCurrentPage >= totalPages - 1;
            return (
              <View style={{ alignSelf: 'flex-end' }}>
                <Text style={[styles.filterLabel, { color: theme.textSecondary }]}>Page</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TouchableOpacity
                    onPress={() => setStatsCurrentPage(Math.max(0, statsCurrentPage - 1))}
                    disabled={atStart}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      backgroundColor: atStart ? theme.bgAlt : theme.bgInput,
                      borderWidth: 1,
                      borderColor: theme.border,
                      opacity: atStart ? 0.45 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text }}>◀ Back</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 12, color: theme.textSecondary, minWidth: 90, textAlign: 'center' }}>
                    {activeData.length === 0 ? '0 of 0' : `${startIdx + 1}-${endIdx} of ${activeData.length}`}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setStatsCurrentPage(Math.min(totalPages - 1, statsCurrentPage + 1))}
                    disabled={atEnd}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      backgroundColor: atEnd ? theme.bgAlt : theme.bgInput,
                      borderWidth: 1,
                      borderColor: theme.border,
                      opacity: atEnd ? 0.45 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text }}>Next ▶</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })()}
        </View>

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <View style={{ 
            flexDirection: 'row', 
            flexWrap: 'wrap', 
            gap: 8, 
            marginBottom: 8,
            alignItems: 'center',
          }}>
            {statsTeamFilter !== 'All' && (
              <TouchableOpacity 
                onPress={() => { setStatsTeamFilter('All'); setStatsCurrentPage(0); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.accentBlue,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, marginRight: 4 }}>Team: {statsTeamFilter}</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>×</Text>
              </TouchableOpacity>
            )}
            {statsPositionFilter !== 'All' && statsView === 'skaters' && (
              <TouchableOpacity 
                onPress={() => { setStatsPositionFilter('All'); setStatsCurrentPage(0); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.accentBlue,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, marginRight: 4 }}>Pos: {statsPositionFilter}</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>×</Text>
              </TouchableOpacity>
            )}
            {statsDraftYearFilter !== 'All' && (
              <TouchableOpacity 
                onPress={() => { setStatsDraftYearFilter('All'); setStatsCurrentPage(0); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.accent,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, marginRight: 4 }}>Draft: {statsDraftYearFilter}</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>×</Text>
              </TouchableOpacity>
            )}
            {statsDraftRoundFilter !== 'All' && (
              <TouchableOpacity 
                onPress={() => { setStatsDraftRoundFilter('All'); setStatsCurrentPage(0); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.accent,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, marginRight: 4 }}>Rd: {statsDraftRoundFilter}</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>×</Text>
              </TouchableOpacity>
            )}
            {statsDraftPickFilter !== 'All' && (
              <TouchableOpacity 
                onPress={() => { setStatsDraftPickFilter('All'); setStatsCurrentPage(0); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.accent,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, marginRight: 4 }}>Pick: {statsDraftPickFilter}</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>×</Text>
              </TouchableOpacity>
            )}
            {statsSearchQuery.trim() !== '' && (
              <TouchableOpacity 
                onPress={() => { setStatsSearchQuery(''); setStatsCurrentPage(0); }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: theme.accentBlue,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 16,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 12, marginRight: 4 }}>"{statsSearchQuery}"</Text>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>×</Text>
              </TouchableOpacity>
            )}
            {/* Clear All with details */}
            <TouchableOpacity 
              onPress={clearAllFilters}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                marginLeft: 'auto',
              }}
            >
              <Text style={{ color: theme.danger, fontSize: 12, fontWeight: '600' }}>
                Clear All ({[
                  statsTeamFilter !== 'All' && 'Team',
                  statsPositionFilter !== 'All' && statsView === 'skaters' && 'Pos',
                  statsDraftYearFilter !== 'All' && 'Draft',
                  statsDraftRoundFilter !== 'All' && 'Round',
                  statsDraftPickFilter !== 'All' && 'Pick',
                  statsSearchQuery.trim() !== '' && 'Search',
                ].filter(Boolean).join(', ')})
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* NHL.com style "Sum Results" toggle (OFF by default) */}
        <View style={[styles.sumResultsRow, { marginBottom: 8 }]}>
          <TouchableOpacity
            style={styles.sumResultsToggle}
            onPress={() => setStatsSumResults(!statsSumResults)}
          >
            <View style={[styles.checkboxBox, { borderColor: theme.border }, statsSumResults && styles.checkboxBoxChecked]}>
              {statsSumResults ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={[styles.sumResultsLabel, { color: theme.text }]}>Sum Results</Text>
          </TouchableOpacity>
        </View>

        {/* No data warning */}
        {dataSeasons.length === 0 && (
          <View style={{ 
            backgroundColor: darkMode ? '#4a3000' : '#fff3cd', 
            padding: 12, 
            borderRadius: 8, 
            marginBottom: 12,
            borderWidth: 1,
            borderColor: darkMode ? '#856404' : '#ffc107',
          }}>
            <Text style={{ color: darkMode ? '#ffc107' : '#856404', fontWeight: '600' }}>
              ⚠️ No {statsSeasonType === 'playoffs' ? 'playoff' : 'regular season'} data available
            </Text>
            <Text style={{ color: darkMode ? '#ffc107' : '#856404', fontSize: 12, marginTop: 4 }}>
              Try switching to {statsSeasonType === 'playoffs' ? 'Regular Season' : 'Playoffs'} or import data for this season type.
            </Text>
          </View>
        )}
        
        {/* Skaters Table */}
        {statsView === 'skaters' && (() => {
          const totalPages = Math.ceil(sortedSkaters.length / statsPerPage);
          const startIdx = statsCurrentPage * statsPerPage;
          const endIdx = startIdx + statsPerPage;
          const pageSkaters = sortedSkaters.slice(startIdx, endIdx);
          
          return (
          <>
            <ScrollView horizontal>
              <View style={{
                backgroundColor: theme.bgCard,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.border,
                shadowColor: theme.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 1,
                shadowRadius: 4,
                elevation: 3,
              }}>
                <View style={styles.statsHeaderRow}>
                  <Text style={[styles.statsHeaderCell, styles.statsNameCell, { backgroundColor: '#1a1a2e' }]}>Player</Text>
                  <Text style={[styles.statsHeaderCell, styles.statsTeamCell]}>Team</Text>
                  <Text style={[styles.statsHeaderCell, styles.statsPosCell]}>Pos</Text>
                  {!statsSumResults && <SortHeader column="season" label="Season" />}
                  <SortHeader column="gp" label="GP" />
                  <SortHeader column="truei" label="TRUEi" />
                  {!isColHidden('g') && <SortHeader column="g" label="G" />}
                  {!isColHidden('a') && <SortHeader column="a" label="A" />}
                  {!isColHidden('p') && <SortHeader column="p" label="P" />}
                  {!isColHidden('plusMinus') && <SortHeader column="plusMinus" label="+/-" />}
                  {!isColHidden('pim') && <SortHeader column="pim" label="PIM" />}
                  {!isColHidden('ppp') && <SortHeader column="ppp" label="PPP" />}
                  {!isColHidden('shp') && <SortHeader column="shp" label="SHP" />}
                  {!isColHidden('ht') && <SortHeader column="ht" label="HIT" />}
                  {!isColHidden('ga') && <SortHeader column="ga" label="GA" />}
                  {!isColHidden('ta') && <SortHeader column="ta" label="TA" />}
                  {!isColHidden('sog') && <SortHeader column="sog" label="SOG" />}
                  {!isColHidden('sPct') && <SortHeader column="sPct" label="S%" />}
                  {!isColHidden('sb') && <SortHeader column="sb" label="SB" />}
                  {!isColHidden('avgAtoi') && <SortHeader column="avgAtoi" label="ATOI" />}
                  {!isColHidden('avgAppt') && <SortHeader column="avgAppt" label="APPT" />}
                  {!isColHidden('avgApkt') && <SortHeader column="avgApkt" label="APKT" />}
                  {!isColHidden('foPct') && <SortHeader column="foPct" label="FO%" />}
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
                  <Text style={[styles.statsHeaderCell, { minWidth: 52 }]}>Pregen</Text>
                  <TouchableOpacity onPress={() => handleSort('trueiZ')} style={{ minWidth: 95 }}>
                    <Text style={[styles.statsHeaderCell, statsSortColumn === 'trueiZ' && styles.statsHeaderActive, { minWidth: 95 }]}>
                      Rating {statsSortColumn === 'trueiZ' ? (statsSortAsc ? '↑' : '↓') : ''}
                    </Text>
                  </TouchableOpacity>
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
                        style={[
                          styles.statsDataRow, 
                          { backgroundColor: idx % 2 === 0 ? theme.bgAlt : theme.bgCard }
                        ]}
                      >
                        <Text style={[styles.statsCell, styles.statsNameCell, { fontWeight: '500', color: theme.text, backgroundColor: idx % 2 === 0 ? theme.bgAlt : theme.bgCard }]} numberOfLines={1}>
                          {isExpanded ? '▼ ' : '▶ '}{p.name}
                        </Text>
                        <TouchableOpacity
                          style={[styles.statsCell, styles.statsTeamCell]}
                          onPress={(e) => { e.stopPropagation && e.stopPropagation(); navigateToTeam(convertAhlToNhl(p.team), p.season); }}
                        >
                          <Text style={{ color: theme.text, textDecorationLine: 'underline' }}>{convertAhlToNhl(p.team)}</Text>
                        </TouchableOpacity>
                        <Text style={[styles.statsCell, styles.statsPosCell, { color: theme.text }]}>{p.pos}</Text>
                        {!statsSumResults && <Text style={[styles.statsCell, { color: theme.text }]}>{p.season}</Text>}
                        <Text style={[styles.statsCell, { color: theme.text }]}>{p.gp}</Text>
                        <Text style={[styles.statsCell, styles.statsBold, p.truei >= 50 ? styles.positiveValue : p.truei < 25 ? styles.negativeValue : { color: theme.text }]}>
                          {p.truei.toFixed(1)}
                        </Text>
                        {!isColHidden('g') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.g}</Text>}
                        {!isColHidden('a') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.a}</Text>}
                        {!isColHidden('p') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{p.p}</Text>}
                        {!isColHidden('plusMinus') && (<Text style={[styles.statsCell, p.plusMinus >= 0 ? styles.positiveValue : styles.negativeValue]}>
                          {p.plusMinus >= 0 ? '+' : ''}{p.plusMinus}
                        </Text>)}
                        {!isColHidden('pim') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.pim}</Text>}
                        {!isColHidden('ppp') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.ppp}</Text>}
                        {!isColHidden('shp') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.shp}</Text>}
                        {!isColHidden('ht') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.ht}</Text>}
                        {!isColHidden('ga') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.ga}</Text>}
                        {!isColHidden('ta') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.ta}</Text>}
                        {!isColHidden('sog') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.sog}</Text>}
                        {!isColHidden('sPct') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.sPct.toFixed(1)}</Text>}
                        {!isColHidden('sb') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.sb}</Text>}
                        {!isColHidden('avgAtoi') && <Text style={[styles.statsCell, { color: theme.text }]}>{formatMinutesToTime(p.avgAtoi)}</Text>}
                        {!isColHidden('avgAppt') && <Text style={[styles.statsCell, { color: theme.text }]}>{formatMinutesToTime(p.avgAppt)}</Text>}
                        {!isColHidden('avgApkt') && <Text style={[styles.statsCell, { color: theme.text }]}>{formatMinutesToTime(p.avgApkt)}</Text>}
                        {!isColHidden('foPct') && <Text style={[styles.statsCell, { color: theme.text }]}>{p.foPct > 0 ? p.foPct.toFixed(1) : '-'}</Text>}
                        {!isColHidden('draftYear') && <Text style={[styles.statsCell, { minWidth: 44, color: theme.text }]}>{p.draftYear > 0 ? p.draftYear : '-'}</Text>}
                        {!isColHidden('draftRound') && <Text style={[styles.statsCell, { minWidth: 44, color: theme.text }]}>{p.draftRound < 999 ? p.draftRound : '-'}</Text>}
                        {!isColHidden('draftPick') && <Text style={[styles.statsCell, { minWidth: 44, color: theme.text }]}>{p.draftPick < 999 ? p.draftPick : '-'}</Text>}
                        {!isColHidden('pregen') && <Text style={[styles.statsCell, { minWidth: 70, color: theme.text }]} numberOfLines={1}>{p.pregen || '-'}</Text>}
                        {(() => {
                          const zNum = p.trueiZ;
                          const rating = zToRating(zNum);
                          const zColor = rating == null ? theme.text
                            : rating >= 80 ? '#2e7d32'
                            : rating <= 35 ? '#c62828'
                            : theme.text;
                          const tier = p.roleTier || '-';
                          const ratingText = rating == null ? '—' : Math.round(rating).toString();
                          const combined = rating == null ? tier : `${tier} · ${ratingText}`;
                          return (
                            <Text style={[styles.statsCell, { minWidth: 95, color: zColor, fontWeight: '700' }]}>{combined}</Text>
                          );
                        })()}
                      </TouchableOpacity>
                      
                      {/* Expanded season rows */}
                      {isExpanded && playerSeasons.map((ps, sIdx) => {
                        const psTruei = parseFloat(calculateTRUEi(ps)) || 0;
                        const psSPct = ps.sog > 0 ? (ps.g / ps.sog) * 100 : 0;
                        return (
                          <View key={sIdx} style={[styles.statsDataRow, { backgroundColor: theme.tableRowExpanded }]}>
                            <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontStyle: 'italic', color: theme.text, backgroundColor: theme.tableRowExpanded }]} numberOfLines={1}>
                              {ps.season || '2024-25'}
                            </Text>
                            <TouchableOpacity
                              style={[styles.statsCell, styles.statsTeamCell]}
                              onPress={() => navigateToTeam(convertAhlToNhl(ps.team), ps.season)}
                            >
                              <Text style={{ color: theme.text, textDecorationLine: 'underline' }}>{convertAhlToNhl(ps.team)}</Text>
                            </TouchableOpacity>
                            <Text style={[styles.statsCell, styles.statsPosCell, { color: theme.text }]}>{ps.pos}</Text>
                            <Text style={[styles.statsCell, { color: theme.text }]}>{ps.gp}</Text>
                            <Text style={[styles.statsCell, psTruei >= 50 ? styles.positiveValue : psTruei < 25 ? styles.negativeValue : { color: theme.text }]}>
                              {psTruei.toFixed(1)}
                            </Text>
                            {!isColHidden('g') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.g}</Text>}
                            {!isColHidden('a') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.a}</Text>}
                            {!isColHidden('p') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.p}</Text>}
                            {!isColHidden('plusMinus') && (<Text style={[styles.statsCell, ps.plusMinus >= 0 ? styles.positiveValue : styles.negativeValue]}>
                              {ps.plusMinus >= 0 ? '+' : ''}{ps.plusMinus}
                            </Text>)}
                            {!isColHidden('pim') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.pim}</Text>}
                            {!isColHidden('ppp') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.ppp}</Text>}
                            {!isColHidden('shp') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.shp}</Text>}
                            {!isColHidden('ht') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.ht}</Text>}
                            {!isColHidden('ga') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.ga}</Text>}
                            {!isColHidden('ta') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.ta}</Text>}
                            {!isColHidden('sog') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.sog}</Text>}
                            {!isColHidden('sPct') && <Text style={[styles.statsCell, { color: theme.text }]}>{psSPct.toFixed(1)}</Text>}
                            {!isColHidden('sb') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.sb}</Text>}
                            {!isColHidden('avgAtoi') && <Text style={[styles.statsCell, { color: theme.text }]}>{formatMinutesToTime(ps.atoi)}</Text>}
                            {!isColHidden('avgAppt') && <Text style={[styles.statsCell, { color: theme.text }]}>{formatMinutesToTime(ps.appt)}</Text>}
                            {!isColHidden('avgApkt') && <Text style={[styles.statsCell, { color: theme.text }]}>{formatMinutesToTime(ps.apkt)}</Text>}
                            {!isColHidden('foPct') && <Text style={[styles.statsCell, { color: theme.text }]}>{ps.foPct > 0 ? ps.foPct.toFixed(1) : '-'}</Text>}
                            <Text style={[styles.statsCell, { minWidth: 44, color: theme.text }]}>-</Text>
                            <Text style={[styles.statsCell, { minWidth: 44, color: theme.text }]}>-</Text>
                            <Text style={[styles.statsCell, { minWidth: 70, color: theme.text }]}>-</Text>
                            <Text style={[styles.statsCell, { minWidth: 55, color: theme.text }]}>-</Text>
                            <Text style={[styles.statsCell, { minWidth: 70, color: theme.text }]}>-</Text>
                          </View>
                        );
                      })}
                      
                      {/* Totals row */}
                      {isExpanded && playerSeasons.length > 1 && (
                        <View style={[styles.statsDataRow, { backgroundColor: theme.tableTotals }]}>
                          <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontWeight: '700', color: theme.text, backgroundColor: theme.tableTotals }]} numberOfLines={1}>
                            TOTAL ({playerSeasons.length} seasons)
                          </Text>
                          <Text style={[styles.statsCell, styles.statsTeamCell, { color: theme.text }]}>-</Text>
                          <Text style={[styles.statsCell, styles.statsPosCell, { color: theme.text }]}>{p.pos}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.gp}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, avgTruei >= 50 ? styles.positiveValue : avgTruei < 25 ? styles.negativeValue : { color: theme.text }]}>
                            {avgTruei.toFixed(1)}
                          </Text>
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.g}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.a}</Text>
                          {!isColHidden('p') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.p}</Text>}
                          {!isColHidden('plusMinus') && (<Text style={[styles.statsCell, styles.statsBold, totals.plusMinus >= 0 ? styles.positiveValue : styles.negativeValue]}>
                            {totals.plusMinus >= 0 ? '+' : ''}{totals.plusMinus}
                          </Text>)}
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.pim}</Text>
                          {!isColHidden('ppp') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.ppp}</Text>}
                          {!isColHidden('shp') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.shp}</Text>}
                          {!isColHidden('ht') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.ht}</Text>}
                          {!isColHidden('ga') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.ga}</Text>}
                          {!isColHidden('ta') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.ta}</Text>}
                          {!isColHidden('sog') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.sog}</Text>}
                          {!isColHidden('sPct') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{avgSPct.toFixed(1)}</Text>}
                          {!isColHidden('sb') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.sb}</Text>}
                          {!isColHidden('avgAtoi') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{formatMinutesToTime(avgAtoi)}</Text>}
                          {!isColHidden('avgAppt') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{formatMinutesToTime(avgAppt)}</Text>}
                          {!isColHidden('avgApkt') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{formatMinutesToTime(avgApkt)}</Text>}
                          {!isColHidden('foPct') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{avgFoPct > 0 ? avgFoPct.toFixed(1) : '-'}</Text>}
                          {!isColHidden('draftYear') && <Text style={[styles.statsCell, styles.statsBold, { minWidth: 44, color: theme.text }]}>{p.draftYear > 0 ? p.draftYear : '-'}</Text>}
                          {!isColHidden('draftRound') && <Text style={[styles.statsCell, styles.statsBold, { minWidth: 44, color: theme.text }]}>{p.draftRound < 999 ? p.draftRound : '-'}</Text>}
                          {!isColHidden('draftPick') && <Text style={[styles.statsCell, styles.statsBold, { minWidth: 44, color: theme.text }]}>{p.draftPick < 999 ? p.draftPick : '-'}</Text>}
                          {!isColHidden('pregen') && <Text style={[styles.statsCell, styles.statsBold, { minWidth: 70, color: theme.text }]} numberOfLines={1}>{p.pregen || '-'}</Text>}
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 55, color: theme.text }]}>-</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 70, color: theme.text }]}>-</Text>
                        </View>
                      )}
                      
                      {/* Link to Player Page (modal) — only shown when expanded */}
                      {isExpanded && (
                        <TouchableOpacity
                          onPress={() => setModalPlayerName(p.name)}
                          style={{ paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginLeft: 24, marginBottom: 4 }}
                        >
                          <Text style={{ fontSize: 12, color: theme.accent || '#1565c0', fontWeight: '600', textDecorationLine: 'underline' }}>
                            View player page →
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
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
            <ScrollView horizontal>
              <View>
                <View style={styles.statsHeaderRow}>
                  <Text style={[styles.statsHeaderCell, styles.statsNameCell, { backgroundColor: '#1a1a2e' }]}>Goalie</Text>
                  <Text style={[styles.statsHeaderCell, styles.statsTeamCell]}>Team</Text>
                  {!statsSumResults && <SortHeader column="season" label="Season" />}
                  <SortHeader column="gp" label="GP" />
                  {!isColHidden('w') && <SortHeader column="w" label="W" />}
                  {!isColHidden('l') && <SortHeader column="l" label="L" />}
                  {!isColHidden('t') && <SortHeader column="t" label="T" />}
                  {!isColHidden('sha') && <SortHeader column="sha" label="SA" />}
                  {!isColHidden('ga') && <SortHeader column="ga" label="GA" />}
                  {!isColHidden('svPct') && <SortHeader column="svPct" label="SV%" />}
                  {!isColHidden('gaa') && <SortHeader column="gaa" label="GAA" />}
                  {!isColHidden('so') && <SortHeader column="so" label="SO" />}
                  {!isColHidden('gsaa') && <SortHeader column="gsaa" label="GSAA" />}
                  {!isColHidden('toi') && <SortHeader column="toi" label="TOI" />}
                  {!isColHidden('g') && <SortHeader column="g" label="G" />}
                  {!isColHidden('a') && <SortHeader column="a" label="A" />}
                  {!isColHidden('p') && <SortHeader column="p" label="P" />}
                  {!isColHidden('pim') && <SortHeader column="pim" label="PIM" />}
                  <TouchableOpacity onPress={() => handleSort('trueiZ')} style={{ minWidth: 95 }}>
                    <Text style={[styles.statsHeaderCell, statsSortColumn === 'trueiZ' && styles.statsHeaderActive, { minWidth: 95 }]}>
                      Rating {statsSortColumn === 'trueiZ' ? (statsSortAsc ? '↑' : '↓') : ''}
                    </Text>
                  </TouchableOpacity>
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
                        style={[
                          styles.statsDataRow, 
                          { backgroundColor: idx % 2 === 0 ? theme.bgAlt : theme.bgCard }
                        ]}
                      >
                        <Text style={[styles.statsCell, styles.statsNameCell, { fontWeight: '500', color: theme.text, backgroundColor: idx % 2 === 0 ? theme.bgAlt : theme.bgCard }]} numberOfLines={1}>
                          {isExpanded ? '▼ ' : '▶ '}{g.name}
                        </Text>
                        <TouchableOpacity
                          style={[styles.statsCell, styles.statsTeamCell]}
                          onPress={(e) => { e.stopPropagation && e.stopPropagation(); navigateToTeam(convertAhlToNhl(g.team), g.season); }}
                        >
                          <Text style={{ color: theme.text, textDecorationLine: 'underline' }}>{convertAhlToNhl(g.team)}</Text>
                        </TouchableOpacity>
                        {!statsSumResults && <Text style={[styles.statsCell, { color: theme.text }]}>{g.season}</Text>}
                        <Text style={[styles.statsCell, { color: theme.text }]}>{g.gp}</Text>
                        {!isColHidden('w') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{g.w}</Text>}
                        {!isColHidden('l') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.l}</Text>}
                        {!isColHidden('t') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.t}</Text>}
                        {!isColHidden('sha') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.sha}</Text>}
                        {!isColHidden('ga') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.ga}</Text>}
                        {!isColHidden('svPct') && <Text style={[styles.statsCell, { color: theme.text }]}>{(g.svPct * 100).toFixed(1)}%</Text>}
                        {!isColHidden('gaa') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.gaa.toFixed(2)}</Text>}
                        {!isColHidden('so') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.so}</Text>}
                        {!isColHidden('gsaa') && (<Text style={[styles.statsCell, g.gsaa >= 0 ? styles.positiveValue : styles.negativeValue]}>
                          {g.gsaa >= 0 ? '+' : ''}{g.gsaa.toFixed(1)}
                        </Text>)}
                        {!isColHidden('toi') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.toi || 0}</Text>}
                        {!isColHidden('g') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.g}</Text>}
                        {!isColHidden('a') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.a}</Text>}
                        {!isColHidden('p') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.p}</Text>}
                        {!isColHidden('pim') && <Text style={[styles.statsCell, { color: theme.text }]}>{g.pim}</Text>}
                        {(() => {
                          const zNum = g.trueiZ;
                          const rating = zToRating(zNum);
                          const zColor = rating == null ? theme.text
                            : rating >= 80 ? '#2e7d32'
                            : rating <= 35 ? '#c62828'
                            : theme.text;
                          const tier = g.roleTier || '-';
                          const ratingText = rating == null ? '—' : Math.round(rating).toString();
                          const combined = rating == null ? tier : `${tier} · ${ratingText}`;
                          return (
                            <Text style={[styles.statsCell, { minWidth: 95, color: zColor, fontWeight: '700' }]}>{combined}</Text>
                          );
                        })()}
                      </TouchableOpacity>
                      
                      {/* Expanded season rows */}
                      {isExpanded && goalieSeasons.map((gs, sIdx) => {
                        const gsSvPct = gs.sha > 0 ? (gs.sha - gs.ga) / gs.sha : 0;
                        const gsGaa = gs.gaa || 0;
                        const gsGsaa = calculateGSAA(gs, leagueAvgSvPct);
                        return (
                          <View key={sIdx} style={[styles.statsDataRow, { backgroundColor: theme.tableRowExpanded }]}>
                            <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontStyle: 'italic', color: theme.text, backgroundColor: theme.tableRowExpanded }]} numberOfLines={1}>
                              {gs.season || '2024-25'}
                            </Text>
                            <TouchableOpacity
                              style={[styles.statsCell, styles.statsTeamCell]}
                              onPress={() => navigateToTeam(convertAhlToNhl(gs.team), gs.season)}
                            >
                              <Text style={{ color: theme.text, textDecorationLine: 'underline' }}>{convertAhlToNhl(gs.team)}</Text>
                            </TouchableOpacity>
                            <Text style={[styles.statsCell, { color: theme.text }]}>{gs.gp}</Text>
                            {!isColHidden('w') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.w}</Text>}
                            {!isColHidden('l') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.l}</Text>}
                            {!isColHidden('t') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.t}</Text>}
                            {!isColHidden('sha') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.sha}</Text>}
                            {!isColHidden('ga') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.ga}</Text>}
                            {!isColHidden('svPct') && <Text style={[styles.statsCell, { color: theme.text }]}>{(gsSvPct * 100).toFixed(1)}%</Text>}
                            {!isColHidden('gaa') && <Text style={[styles.statsCell, { color: theme.text }]}>{gsGaa.toFixed(2)}</Text>}
                            {!isColHidden('so') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.so}</Text>}
                            {!isColHidden('gsaa') && (<Text style={[styles.statsCell, gsGsaa >= 0 ? styles.positiveValue : styles.negativeValue]}>
                              {gsGsaa >= 0 ? '+' : ''}{gsGsaa.toFixed(1)}
                            </Text>)}
                            {!isColHidden('toi') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.toi || 0}</Text>}
                            {!isColHidden('g') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.g}</Text>}
                            {!isColHidden('a') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.a}</Text>}
                            {!isColHidden('p') && <Text style={[styles.statsCell, { color: theme.text }]}>{(gs.g || 0) + (gs.a || 0)}</Text>}
                            {!isColHidden('pim') && <Text style={[styles.statsCell, { color: theme.text }]}>{gs.pim}</Text>}
                            <Text style={[styles.statsCell, { minWidth: 55, color: theme.text }]}>-</Text>
                            <Text style={[styles.statsCell, { minWidth: 70, color: theme.text }]}>-</Text>
                          </View>
                        );
                      })}
                      
                      {/* Totals row */}
                      {isExpanded && goalieSeasons.length > 1 && (
                        <View style={[styles.statsDataRow, { backgroundColor: theme.tableTotals }]}>
                          <Text style={[styles.statsCell, styles.statsNameCell, { paddingLeft: 24, fontWeight: '700', color: theme.text, backgroundColor: theme.tableTotals }]} numberOfLines={1}>
                            TOTAL ({goalieSeasons.length} seasons)
                          </Text>
                          <Text style={[styles.statsCell, styles.statsTeamCell, { color: theme.text }]}>-</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.gp}</Text>
                          {!isColHidden('w') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.w}</Text>}
                          {!isColHidden('l') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.l}</Text>}
                          {!isColHidden('t') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.t}</Text>}
                          {!isColHidden('sha') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.sha}</Text>}
                          {!isColHidden('ga') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.ga}</Text>}
                          {!isColHidden('svPct') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{(totalSvPct * 100).toFixed(1)}%</Text>}
                          {!isColHidden('gaa') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totalGaa.toFixed(2)}</Text>}
                          {!isColHidden('so') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.so}</Text>}
                          {!isColHidden('gsaa') && (<Text style={[styles.statsCell, styles.statsBold, totalGsaa >= 0 ? styles.positiveValue : styles.negativeValue]}>
                            {totalGsaa >= 0 ? '+' : ''}{totalGsaa.toFixed(1)}
                          </Text>)}
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.toi}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.g}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.a}</Text>
                          {!isColHidden('p') && <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.g + totals.a}</Text>}
                          <Text style={[styles.statsCell, styles.statsBold, { color: theme.text }]}>{totals.pim}</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 55, color: theme.text }]}>-</Text>
                          <Text style={[styles.statsCell, styles.statsBold, { minWidth: 70, color: theme.text }]}>-</Text>
                        </View>
                      )}
                      
                      {/* Link to Player Page (modal) — only shown when expanded */}
                      {isExpanded && (
                        <TouchableOpacity
                          onPress={() => setModalPlayerName(g.name)}
                          style={{ paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginLeft: 24, marginBottom: 4 }}
                        >
                          <Text style={{ fontSize: 12, color: theme.accent || '#1565c0', fontWeight: '600', textDecorationLine: 'underline' }}>
                            View player page →
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </>
          );
        })()}

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
    
    
    // Handle both old format (array) and new format (object with skaters/goalies)
    const rosterSkaters = Array.isArray(myRoster) ? myRoster : (myRoster.skaters || []);
    const rosterGoalies = Array.isArray(myRoster) ? [] : (myRoster.goalies || []);
    
    // Get latest season data for roster skaters, plus 3-year weighted TRUEi
    const rosterWithStats = rosterSkaters.map(playerName => {
      const playerGroup = groupedPlayers.find(p =>
        p.name.toLowerCase() === playerName.toLowerCase()
      );

      if (!playerGroup) return null;

      // Get most recent season (primary data source for display + filters)
      const latestSeason = playerGroup.seasons.find(
        s => normalizeSeasonValue(s.season || '2024-25') === normalizeSeasonValue(currentSeason) && getSeasonType(s) === rosterSeasonType
      );
      if (!latestSeason) return null;

      const truei = parseFloat(calculateTRUEi(latestSeason));

      // 3-year weighted TRUEi — smooths single-season variance
      // Weights: current 70%, prior 20%, two-back 10%
      // Heavy recency bias prevents young players (rising curve) from being
      // dragged down by weaker developmental seasons while still smoothing flukes.
      // Only include seasons matching rosterSeasonType (regular vs playoffs)
      const regularSeasons = playerGroup.seasons
        .filter(s => getSeasonType(s) === rosterSeasonType)
        .sort((a, b) => {
          const aVal = normalizeSeasonValue(a.season || '2024-25');
          const bVal = normalizeSeasonValue(b.season || '2024-25');
          return bVal.localeCompare(aVal); // most recent first
        });

      // Find index of currentSeason in the sorted list
      const curIdx = regularSeasons.findIndex(
        s => normalizeSeasonValue(s.season || '2024-25') === normalizeSeasonValue(currentSeason)
      );
      const s0 = curIdx >= 0 ? regularSeasons[curIdx] : null;
      const s1 = curIdx >= 0 ? regularSeasons[curIdx + 1] : null;
      const s2 = curIdx >= 0 ? regularSeasons[curIdx + 2] : null;

      const t0 = s0 ? parseFloat(calculateTRUEi(s0)) : null;
      const t1 = s1 ? parseFloat(calculateTRUEi(s1)) : null;
      const t2 = s2 ? parseFloat(calculateTRUEi(s2)) : null;

      // Weighted average — if a season is missing, redistribute its weight to available seasons
      let truei3yr = truei;
      if (t0 !== null && !isNaN(t0)) {
        const parts = [];
        if (!isNaN(t0)) parts.push({ val: t0, w: 0.7 });
        if (t1 !== null && !isNaN(t1)) parts.push({ val: t1, w: 0.2 });
        if (t2 !== null && !isNaN(t2)) parts.push({ val: t2, w: 0.1 });
        const totalW = parts.reduce((s, p) => s + p.w, 0);
        if (totalW > 0) {
          truei3yr = parts.reduce((s, p) => s + p.val * p.w, 0) / totalW;
        }
      }

      // Replacement level — delegate to the unified tier system (role score
      // = EV×1 + PP×3 + PK×1.5, per-team rank). Single source of truth so
      // the label here matches what the Stats tab shows.
      const tier = assignRoleTier(latestSeason, playerDatabase) || 'L4';
      const replacementLevel = tierToLineLabel(tier);
      // Expected TRUEi per tier — uses league-wide mean from tierBaselines
      // when available, otherwise falls back to reasonable defaults.
      const tierMean = tierBaselines?.[tier]?.mean;
      const fallbackByTier = { L1: 66.6, L2: 45.6, L3: 26.8, L4: 21.8, D1: 65.0, D2: 37.4, D3: 20.1 };
      const expectedTruei = (tierMean != null && Number.isFinite(tierMean)) ? tierMean : (fallbackByTier[tier] ?? 25);

      return {
        ...latestSeason,
        truei,
        truei3yr,
        replacementLevel,
        expectedTruei,
        vsReplacement: truei - expectedTruei,
        roleTier: tier,
        // Enriched from team API contract data (when available)
        handedness: rosterContracts?.[playerName]?.handedness || latestSeason.handedness || '',
        playerType: rosterContracts?.[playerName]?.type || '',
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

    // GD/82 = Expected Goal Differential per 82 games (same as Teams tab)
    const expectedGF = sfPer82 * rosterShotPct;
    const expectedGA = saPer82 * (1 - rosterSvPct);
    const playoffPredictor = expectedGF - expectedGA;
    
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
      <View style={[styles.tabContent, { backgroundColor: theme.bg }]}>
        {/* ───── Team Quick Load (logo grid) — moved to top so switching teams is
            always within thumb reach regardless of scroll position ───── */}
        {allTeams.length > 0 && (
          <View style={[styles.teamDropdownSection, { backgroundColor: theme.bgCard, borderColor: theme.border }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <Text style={[styles.sectionTitle, { fontSize: 13, marginBottom: 0 }]}>Quick Load Team</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {Platform.OS === 'web' && (
                  <select
                    value={currentSeason}
                    onChange={(e) => setRosterSeason(e.target.value)}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: theme.bgCard,
                      color: theme.text,
                      border: `1px solid ${theme.border || '#ddd'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      minWidth: 120,
                    }}
                  >
                    {(() => {
                      const seasons = [...(availableSeasons || [])].sort((a, b) => b.localeCompare(a));
                      return seasons.map(season => (
                        <option key={season} value={season}>{formatSeasonLabel(season)}</option>
                      ));
                    })()}
                  </select>
                )}

                <View style={{ flexDirection: 'row', backgroundColor: theme.bgCard, borderRadius: 6, padding: 2, borderWidth: 1, borderColor: theme.border || '#ddd' }}>
                  <TouchableOpacity
                    style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4, backgroundColor: rosterSeasonType === 'regular' ? (theme.accent || '#1565c0') : 'transparent' }}
                    onPress={() => setRosterSeasonType('regular')}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: rosterSeasonType === 'regular' ? '#fff' : theme.textSecondary }}>Regular</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 4, backgroundColor: rosterSeasonType === 'playoffs' ? (theme.accent || '#1565c0') : 'transparent' }}
                    onPress={() => setRosterSeasonType('playoffs')}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: rosterSeasonType === 'playoffs' ? '#fff' : theme.textSecondary }}>Playoffs</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
              {allTeams.map(team => {
                const logoUrl = getTeamLogoUrl(team);
                return (
                  <TouchableOpacity
                    key={team}
                    style={{
                      width: 72,
                      alignItems: 'center',
                      paddingVertical: 8,
                      paddingHorizontal: 4,
                      borderRadius: 8,
                      backgroundColor: theme.bgCard,
                      borderWidth: 1,
                      borderColor: theme.border || '#ddd',
                    }}
                    onPress={() => {
                      // Decide which loader to use based on selected season:
                      // - Selected year is the latest imported = "now" = API fetch (with contracts)
                      // - Selected year is older = historical stats-derived roster
                      const normSeason = (s) => {
                        if (!s) return s;
                        const cleaned = String(s).trim().replace(/[–—]/g, '-');
                        const m = cleaned.match(/^(\d{4})[/-](\d{2}|\d{4})$/);
                        if (!m) return cleaned;
                        const endYear = m[2].length === 4 ? m[2].slice(-2) : m[2];
                        return `${m[1]}-${endYear}`;
                      };
                      const seasons = [...(availableSeasons || [])].sort((a, b) => b.localeCompare(a));
                      const latestSeason = seasons[0] || null;
                      const selectedIsLatest = latestSeason && normSeason(currentSeason) === normSeason(latestSeason);

                      const seasonLabel = formatSeasonLabel(currentSeason);
                      const prompt = selectedIsLatest
                        ? `Load current ${team} roster from RGMG? This will replace your current roster.`
                        : `Load ${team} roster from ${seasonLabel}? Historical rosters don't include contract data.`;

                      if (Platform.OS === 'web') {
                        if (window.confirm(prompt)) {
                          if (selectedIsLatest) {
                            loadTeamRoster(team);
                          } else {
                            loadHistoricalTeamRoster(team, currentSeason);
                          }
                        }
                      } else {
                        Alert.alert(
                          `Load ${team} (${seasonLabel})`,
                          prompt,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Load', onPress: () => {
                              if (selectedIsLatest) loadTeamRoster(team);
                              else loadHistoricalTeamRoster(team, currentSeason);
                            }}
                          ]
                        );
                      }
                    }}
                  >
                    {logoUrl ? (
                      <Image
                        source={{ uri: logoUrl }}
                        style={{ width: 40, height: 40 }}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#ccc', alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#666' }}>{team.slice(0, 3).toUpperCase()}</Text>
                      </View>
                    )}
                    <Text style={{ fontSize: 10, fontWeight: '600', color: theme.text, marginTop: 4, textAlign: 'center' }} numberOfLines={1}>
                      {team}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Live Cap Summary — moved below Quick Load so the top of the page is
            the team selector. Team name + season live in its header. */}
        <RosterCapSummary
          theme={theme}
          rosterPlayers={rosterWithStats}
          goalies={goaliesWithStats}
          contracts={rosterContracts}
          teamName={currentTeamName ? `${currentTeamName} · ${formatSeasonLabel(currentSeason)}` : ''}
        />
        
        {/* ───── Add Players/Goalies — collapsible ───── */}
        <View style={[styles.rosterAddSection, { marginTop: 12, backgroundColor: theme.bgCard, borderColor: theme.border }]}>
          <TouchableOpacity
            onPress={() => {
              const next = !addPlayersCollapsed;
              setAddPlayersCollapsed(next);
              if (next) setRosterSearchQuery('');
            }}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={[styles.sectionTitle, { fontSize: 13, marginBottom: 0 }]}>
              {addPlayersCollapsed ? '▶' : '▼'} Add Players / Goalies Manually
            </Text>
            <Text style={{ fontSize: 11, color: theme.textSecondary, fontStyle: 'italic' }}>
              {addPlayersCollapsed ? 'tap to expand' : ''}
            </Text>
          </TouchableOpacity>
          {!addPlayersCollapsed && (
            <TextInput
              style={[styles.input, { marginTop: 8, backgroundColor: theme.bgInput, borderColor: theme.border, color: theme.text }]}
              placeholder="Search players or goalies to add..."
              value={rosterSearchQuery}
              onChangeText={setRosterSearchQuery}
            />
          )}
          
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
                    style={[styles.searchResultItem, { backgroundColor: theme.bgCard, borderColor: theme.border }]}
                    onPress={() => {
                      updateRoster([...rosterSkaters, pg.name], rosterGoalies);
                      setRosterSearchQuery('');
                    }}
                  >
                    <Text style={[styles.searchResultName, { color: theme.text }]}>{pg.name}</Text>
                    <Text style={[styles.searchResultDetails, { color: theme.textSecondary }]}>
                      {convertAhlToNhl(seasonInfo.team)} - {seasonInfo.pos} (Skater)
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {/* Goalies */}
              {availableGoalies.slice(0, 4).map((g, idx) => (
                <TouchableOpacity
                  key={`goalie-${idx}`}
                  style={[styles.searchResultItem, { backgroundColor: darkMode ? '#1a3a5c' : '#e3f2fd', borderColor: theme.border }]}
                  onPress={() => {
                    updateRoster(rosterSkaters, [...rosterGoalies, g.name]);
                    setRosterSearchQuery('');
                  }}
                >
                  <Text style={[styles.searchResultName, { color: theme.text }]}>{g.name}</Text>
                  <Text style={[styles.searchResultDetails, { color: theme.textSecondary }]}>
                    {convertAhlToNhl(g.team)} - G (Goalie) - {g.gp}GP
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {(rosterSkaters.length === 0 && rosterGoalies.length === 0) ? (
          <View style={[styles.emptyState, { backgroundColor: theme.bgCard }]}>
            <Text style={[styles.emptyText, { color: theme.text }]}>No players on roster</Text>
            <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>Select a team above or search to add players</Text>
          </View>
        ) : (
          <ScrollView nestedScrollEnabled>
            {/* Forwards - Collapsible */}
            <View style={[styles.positionGroup, { backgroundColor: theme.bgCard, borderColor: theme.border }]}>
              <TouchableOpacity 
                onPress={() => toggleSection('forwards')}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap' }}
              >
                <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>
                  {collapsedSections.forwards ? '▶' : '▼'} Forwards ({forwards.length})
                </Text>
                {/* Mini summary when collapsed */}
                {collapsedSections.forwards && forwards.length > 0 && (
                  <Text style={{ color: theme.textSecondary, fontSize: 11, marginLeft: 8 }}>
                    Avg TRUEi {(forwards.reduce((s, p) => s + p.truei, 0) / forwards.length).toFixed(1)} | 
                    {forwards.reduce((s, p) => s + p.g, 0)}G {forwards.reduce((s, p) => s + p.a, 0)}A
                  </Text>
                )}
              </TouchableOpacity>
              {!collapsedSections.forwards && forwards.sort((a, b) => b.truei - a.truei).map((player, idx) => {
                const sal = rosterContracts?.[player.name]?.salary;
                return (
                  <PlayerRosterRow
                    key={idx}
                    player={player}
                    isGoalie={false}
                    salary={sal}
                    borderColor="#4caf50"
                    theme={theme}
                    draftLookup={draftLookup}
                    hasStatsInGame={true}
                    onOpenModal={setModalPlayerName}
                    onRemove={(name) => updateRoster(rosterSkaters.filter(n => n !== name), rosterGoalies)}
                  />
                );
              })}
            </View>

            {/* Defensemen - Collapsible */}
            <View style={[styles.positionGroup, { backgroundColor: theme.bgCard, borderColor: theme.border }]}>
              <TouchableOpacity 
                onPress={() => toggleSection('defense')}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap' }}
              >
                <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>
                  {collapsedSections.defense ? '▶' : '▼'} Defense ({defensemen.length})
                </Text>
                {/* Mini summary when collapsed */}
                {collapsedSections.defense && defensemen.length > 0 && (
                  <Text style={{ color: theme.textSecondary, fontSize: 11, marginLeft: 8 }}>
                    Avg TRUEi {(defensemen.reduce((s, p) => s + p.truei, 0) / defensemen.length).toFixed(1)} | 
                    {defensemen.reduce((s, p) => s + p.g, 0)}G {defensemen.reduce((s, p) => s + p.a, 0)}A
                  </Text>
                )}
              </TouchableOpacity>
              {!collapsedSections.defense && defensemen.sort((a, b) => b.truei - a.truei).map((player, idx) => {
                const sal = rosterContracts?.[player.name]?.salary;
                return (
                  <PlayerRosterRow
                    key={idx}
                    player={player}
                    isGoalie={false}
                    salary={sal}
                    borderColor="#f44336"
                    theme={theme}
                    draftLookup={draftLookup}
                    hasStatsInGame={true}
                    onOpenModal={setModalPlayerName}
                    onRemove={(name) => updateRoster(rosterSkaters.filter(n => n !== name), rosterGoalies)}
                  />
                );
              })}
            </View>

            {/* Goalies Section - Collapsible (below Defense per layout pref) */}
            {goaliesWithStats.length > 0 && (
              <View style={[styles.positionGroup, { backgroundColor: theme.bgCard, borderColor: theme.border }]}>
                <TouchableOpacity 
                  onPress={() => toggleSection('goalies')}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}
                >
                  <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>
                    {collapsedSections.goalies ? '▶' : '▼'} Goalies ({goaliesWithStats.length})
                  </Text>
                  {/* Mini summary when collapsed */}
                  {collapsedSections.goalies && goaliesWithStats.length > 0 && (
                    <Text style={{ color: theme.textSecondary, fontSize: 11, marginLeft: 8 }}>
                      Avg SV% {(goaliesWithStats.reduce((s, g) => s + g.svPct, 0) / goaliesWithStats.length * 100).toFixed(1)}% | 
                      GSAA {goaliesWithStats.reduce((s, g) => s + g.gsaa, 0).toFixed(1)}
                    </Text>
                  )}
                </TouchableOpacity>
                {!collapsedSections.goalies && goaliesWithStats.sort((a, b) => b.gsaa - a.gsaa).map((goalie, idx) => {
                  const sal = rosterContracts?.[goalie.name]?.salary;
                  return (
                    <PlayerRosterRow
                      key={idx}
                      player={goalie}
                      isGoalie={true}
                      salary={sal}
                      borderColor="#2196f3"
                      theme={theme}
                      draftLookup={draftLookup}
                      hasStatsInGame={true}
                      onOpenModal={setModalPlayerName}
                      onRemove={(name) => updateRoster(rosterSkaters, rosterGoalies.filter(n => n !== name))}
                    />
                  );
                })}
              </View>
            )}

            {/* Prospects / Buried / Retained — pulled from rosterContracts (team API) */}
            {(() => {
              const contractEntries = Object.entries(rosterContracts || {});
              // Prospects = COLLEGE, EUROPE, or Minors-status contracts under $1M.
              // Anything Minors over $1M goes to Buried instead.
              const prospects = contractEntries.filter(([name, c]) => {
                if (c.expiry_type === 'COLLEGE' || c.expiry_type === 'EUROPE') return true;
                if (c.status === 'Minors' && (c.salary || 0) <= 1.0) return true;
                return false;
              });
              const buried = contractEntries.filter(([name, c]) => 
                c.status === 'Minors' && c.salary > 1.0 &&
                c.expiry_type !== 'COLLEGE' && c.expiry_type !== 'EUROPE'
              );
              // Only show players this team is actively paying retention on
              // (status === 'Retained'). retention_count would also catch
              // players acquired with retention from a previous team, where
              // the retention slot belongs to that previous team, not us.
              const retained = contractEntries.filter(([name, c]) =>
                c.status === 'Retained'
              );

              // Small photo-bearing row for contract sections (Prospects,
              // Buried, Retained). Uses the same status-dot convention as
              // PlayerRosterRow so the "needs photo?" signal is consistent
              // across every row on this page.
              const ContractPhotoRow = ({ name, c }) => {
                const [src, setSrc] = React.useState('loading');
                const handleResolved = React.useCallback(({ source }) => {
                  setSrc(source || 'flag');
                }, []);
                const dot =
                  src === 'wikipedia' || src === 'nhl' ? '#4caf50' :
                  src === 'override' ? '#2196f3' :
                  src === 'flag' ? '#f44336' : '#bdbdbd';
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.borderLight }}>
                    <View style={{ marginRight: 8, position: 'relative' }}>
                      <PlayerPhoto
                        name={name}
                        draftLookup={draftLookup}
                        country={c?.country}
                        hasStatsInGame={true}
                        size={32}
                        showBorder={false}
                        onResolved={handleResolved}
                      />
                      <View style={{
                        position: 'absolute', bottom: -1, right: -1,
                        width: 10, height: 10, borderRadius: 5,
                        backgroundColor: dot,
                        borderWidth: 1.5, borderColor: theme.bgCard,
                      }} />
                    </View>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => setModalPlayerName(name)}>
                      <Text style={{ color: theme.text, fontSize: 12, textDecorationLine: 'underline' }} numberOfLines={1}>
                        {name}
                      </Text>
                    </TouchableOpacity>
                    <Text style={{ color: theme.textSecondary, fontSize: 11, marginRight: 8 }}>
                      {c.pos} · Age {c.age} · {c.contract_duration}yr {c.expiry_type}
                    </Text>
                    <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600', minWidth: 60, textAlign: 'right' }}>
                      ${(c.salary || 0).toFixed(2)}M
                    </Text>
                  </View>
                );
              };

              const ContractSection = ({ title, rows, color, showBuriedMath }) => {
                if (rows.length === 0) return null;
                const totalSalary = rows.reduce((s, [_, c]) => s + (c.salary || 0), 0);
                const buriedCap = showBuriedMath 
                  ? rows.reduce((s, [_, c]) => s + Math.max(0, (c.salary || 0) - 1.0), 0)
                  : null;
                return (
                  <View style={[styles.positionGroup, { marginTop: 4, backgroundColor: theme.bgCard, borderColor: theme.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, borderLeftWidth: 3, borderLeftColor: color, paddingLeft: 8 }}>
                      <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0, fontSize: 14 }]}>
                        {title} ({rows.length})
                      </Text>
                      <Text style={{ color: theme.textSecondary, fontSize: 11 }}>
                        {showBuriedMath 
                          ? `$${buriedCap.toFixed(2)}M cap / $${totalSalary.toFixed(2)}M paid`
                          : `$${totalSalary.toFixed(2)}M`}
                      </Text>
                    </View>
                    {rows.map(([name, c]) => (
                      <ContractPhotoRow key={name} name={name} c={c} />
                    ))}
                  </View>
                );
              };

              return (
                <>
                  <ContractSection title="🎓 Prospects" rows={prospects} color="#795548" />
                  <ContractSection title="⚰️ Buried (Minors over $1M)" rows={buried} color="#ff9800" showBuriedMath />
                  <ContractSection title="🤝 Retained" rows={retained} color="#9c27b0" />
                </>
              );
            })()}

           <LinesBuilder
              theme={theme}
              rosterWithStats={rosterWithStats}
              goaliesWithStats={goaliesWithStats}
              lineAssignments={lineAssignments}
              setLineAssignments={setLineAssignments}
              onPlayerClick={setModalPlayerName}
            />

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
        
        // GD/82 = Expected Goal Differential per 82 games
        const expectedGF = sfPer82 * teamShootingPct;
        const expectedGA = goalieSAPer82 * (1 - goalieSvPct);
        const predictedSuccess = expectedGF - expectedGA;
        
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
    
    const teamStatsWithPrediction = teamStats.map(team => {
      // GD/82 = Expected Goal Differential per 82 games
      const expectedGF = team.sfPer82 * team.teamShootingPct;
      const expectedGA = team.goalieSAPer82 * (1 - team.goalieSvPct);
      const predictedSuccess = expectedGF - expectedGA;
      
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
      <View style={[styles.tabContent, { backgroundColor: theme.bg }]}>
        <Text style={[styles.title, { color: theme.text }]}>Team Stats</Text>

        {/* Compact control bar — season dropdown + toggles on one row */}
        <View style={{ paddingHorizontal: 16, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {!teamStatsAllSeasons && Platform.OS === 'web' && (
              <select
                value={currentSeason}
                onChange={(e) => setTeamStatsSeason(e.target.value)}
                style={{
                  padding: '8px 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  backgroundColor: theme.bgCard,
                  color: theme.text,
                  border: `1px solid ${theme.border || '#ddd'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  minWidth: 140,
                }}
              >
                {(() => {
                  // Only show seasons that actually have data. Sorted newest first.
                  const seasons = [...(availableSeasons || [])].sort((a, b) => b.localeCompare(a));
                  return seasons.map(season => (
                    <option key={season} value={season}>
                      {formatSeasonLabel(season)}
                    </option>
                  ));
                })()}
              </select>
            )}

            {/* Single / All Seasons segmented control */}
            <View style={{ flexDirection: 'row', backgroundColor: theme.bgCard, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: theme.border || '#ddd' }}>
              <TouchableOpacity
                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: !teamStatsAllSeasons ? (theme.accent || '#1565c0') : 'transparent' }}
                onPress={() => setTeamStatsAllSeasons(false)}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: !teamStatsAllSeasons ? '#fff' : theme.textSecondary }}>Single</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: teamStatsAllSeasons ? (theme.accent || '#1565c0') : 'transparent' }}
                onPress={() => setTeamStatsAllSeasons(true)}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: teamStatsAllSeasons ? '#fff' : theme.textSecondary }}>All Seasons</Text>
              </TouchableOpacity>
            </View>

            {/* Regular / Playoffs segmented control */}
            <View style={{ flexDirection: 'row', backgroundColor: theme.bgCard, borderRadius: 8, padding: 3, borderWidth: 1, borderColor: theme.border || '#ddd' }}>
              <TouchableOpacity
                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: teamStatsSeasonType === 'regular' ? (theme.accent || '#1565c0') : 'transparent' }}
                onPress={() => setTeamStatsSeasonType('regular')}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: teamStatsSeasonType === 'regular' ? '#fff' : theme.textSecondary }}>Regular</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: teamStatsSeasonType === 'playoffs' ? (theme.accent || '#1565c0') : 'transparent' }}
                onPress={() => setTeamStatsSeasonType('playoffs')}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: teamStatsSeasonType === 'playoffs' ? '#fff' : theme.textSecondary }}>Playoffs</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* League summary strip — at-a-glance context before the table */}
        {teamStatsWithPrediction.length > 0 && (() => {
          const avgGd82 = teamStatsWithPrediction.reduce((s, t) => s + (t.predictedSuccess || 0), 0) / teamStatsWithPrediction.length;
          const topGd82 = [...teamStatsWithPrediction].sort((a, b) => b.predictedSuccess - a.predictedSuccess)[0];
          const topGSAA = [...teamStatsWithPrediction].sort((a, b) => b.bestGSAA - a.bestGSAA)[0];
          const topPDO = [...teamStatsWithPrediction].sort((a, b) => b.pdo - a.pdo)[0];
          const Tile = ({ label, value, team }) => (
            <View style={{
              flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8,
              backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border,
            }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: theme.text, marginTop: 2 }}>{value}</Text>
              {team ? <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 1 }} numberOfLines={1}>{team}</Text> : null}
            </View>
          );
          return (
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 }}>
              <Tile label="League Avg GD/82" value={avgGd82.toFixed(1)} />
              <Tile label="Top GD/82" value={topGd82.predictedSuccess.toFixed(1)} team={topGd82.team} />
              <Tile label="Top GSAA" value={topGSAA.bestGSAA.toFixed(1)} team={topGSAA.team} />
              <Tile label="Top PDO" value={topPDO.pdo.toFixed(1)} team={topPDO.team} />
            </View>
          );
        })()}

        {/* Rankings Table — clean redesign */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          {seasonPlayers.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No player data for this season</Text>
            </View>
          ) : (() => {
            const sortLabel = (label, column) => {
              if (teamStatsSortColumn !== column) return label;
              return `${label} ${teamStatsSortAsc ? '↑' : '↓'}`;
            };
            const toggleSort = (column, defaultAsc) => {
              if (teamStatsSortColumn === column) {
                setTeamStatsSortAsc(!teamStatsSortAsc);
              } else {
                setTeamStatsSortColumn(column);
                setTeamStatsSortAsc(defaultAsc);
              }
            };

            // Column definitions — each controls flex and alignment
            const columns = [
              { key: 'rank', label: '#', flex: 0.5, align: 'center', sortable: false },
              ...(teamStatsAllSeasons ? [{ key: 'season', label: 'Season', flex: 1.1, align: 'left', sortCol: 'season' }] : []),
              { key: 'team', label: 'Team', flex: 1.4, align: 'left', sortCol: 'team' },
              { key: 'bestGSAA', label: 'GSAA', flex: 0.8, align: 'right', sortCol: 'bestGSAA', defaultAsc: false },
              { key: 'goalieName', label: 'Goalie', flex: 1.5, align: 'left', sortCol: 'goalieName' },
              { key: 'sa82', label: 'SA/82', flex: 0.8, align: 'right', sortCol: 'goalieSAPer82', defaultAsc: true },
              { key: 'sf82', label: 'SF/82', flex: 0.8, align: 'right', sortCol: 'sfPer82', defaultAsc: false },
              { key: 's', label: 'S%', flex: 0.7, align: 'right', sortCol: 'teamShootingPct', defaultAsc: false },
              { key: 'sv', label: 'SV%', flex: 0.7, align: 'right', sortCol: 'goalieSvPct', defaultAsc: false },
              { key: 'pdo', label: 'PDO', flex: 0.8, align: 'right', sortCol: 'pdo', defaultAsc: false },
              { key: 'gd82', label: 'GD/82', flex: 0.9, align: 'right', sortCol: 'predictedSuccess', defaultAsc: false },
            ];

            const headerStyle = { fontSize: 11, fontWeight: '700', color: theme.text, textTransform: 'uppercase', letterSpacing: 0.3 };
            const cellStyle = { fontSize: 12, color: theme.text };

            return (
              <View style={{ backgroundColor: theme.bgCard, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: theme.border || '#ddd' }}>
                {/* Header row */}
                <View style={{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 8, backgroundColor: darkMode ? '#1a1a2e' : '#0f1e3d', alignItems: 'center' }}>
                  {columns.map(col => {
                    const content = col.sortCol ? sortLabel(col.label, col.sortCol) : col.label;
                    const textAlign = col.align || 'left';
                    return col.sortCol ? (
                      <TouchableOpacity
                        key={col.key}
                        style={{ flex: col.flex, paddingHorizontal: 4 }}
                        onPress={() => toggleSort(col.sortCol, col.defaultAsc !== undefined ? col.defaultAsc : true)}
                      >
                        <Text style={[headerStyle, { color: '#fff', textAlign }]} numberOfLines={1}>{content}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View key={col.key} style={{ flex: col.flex, paddingHorizontal: 4 }}>
                        <Text style={[headerStyle, { color: '#fff', textAlign }]} numberOfLines={1}>{content}</Text>
                      </View>
                    );
                  })}
                </View>

                {/* Data rows */}
                {sortedTeamStats.map((team, idx) => {
                  const rowBg = idx % 2 === 0 ? (theme.bgCard || '#fff') : (darkMode ? '#242433' : '#f7f9fc');
                  const gdColor = team.predictedSuccess > 0 ? '#2e7d32' : team.predictedSuccess < 0 ? '#c62828' : theme.text;
                  const gsaaColor = team.bestGSAA > 0 ? '#2e7d32' : team.bestGSAA < 0 ? '#c62828' : theme.text;
                  const pdoColor = team.pdo > 101 ? '#2e7d32' : team.pdo < 99 ? '#c62828' : theme.text;

                  return (
                    <View
                      key={`${team.team}-${team.season || 'current'}`}
                      style={{
                        flexDirection: 'row',
                        paddingVertical: 8,
                        paddingHorizontal: 8,
                        backgroundColor: rowBg,
                        borderBottomWidth: idx === sortedTeamStats.length - 1 ? 0 : 1,
                        borderBottomColor: theme.borderLight || '#eef',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={[cellStyle, { flex: 0.5, textAlign: 'center', fontWeight: '700', color: theme.textSecondary }]}>{idx + 1}</Text>
                      {teamStatsAllSeasons && (
                        <Text style={[cellStyle, { flex: 1.1, paddingHorizontal: 4 }]} numberOfLines={1}>{formatSeasonLabel(team.season)}</Text>
                      )}
                      <TouchableOpacity
                        style={{ flex: 1.4, paddingHorizontal: 4 }}
                        onPress={() => navigateToTeam(team.team, team.season || currentSeason)}
                      >
                        <Text style={[cellStyle, { fontWeight: '600', textDecorationLine: 'underline' }]} numberOfLines={1}>{team.team}</Text>
                      </TouchableOpacity>
                      <Text style={[cellStyle, { flex: 0.8, paddingHorizontal: 4, textAlign: 'right', color: gsaaColor, fontWeight: '600' }]}>{team.bestGSAA.toFixed(1)}</Text>
                      <Text style={[cellStyle, { flex: 1.5, paddingHorizontal: 4, color: theme.textSecondary }]} numberOfLines={1}>{team.goalieName}</Text>
                      <Text style={[cellStyle, { flex: 0.8, paddingHorizontal: 4, textAlign: 'right' }]}>{team.goalieSAPer82.toFixed(0)}</Text>
                      <Text style={[cellStyle, { flex: 0.8, paddingHorizontal: 4, textAlign: 'right' }]}>{team.sfPer82.toFixed(0)}</Text>
                      <Text style={[cellStyle, { flex: 0.7, paddingHorizontal: 4, textAlign: 'right' }]}>{(team.teamShootingPct * 100).toFixed(1)}</Text>
                      <Text style={[cellStyle, { flex: 0.7, paddingHorizontal: 4, textAlign: 'right' }]}>{(team.goalieSvPct * 100).toFixed(1)}</Text>
                      <Text style={[cellStyle, { flex: 0.8, paddingHorizontal: 4, textAlign: 'right', color: pdoColor, fontWeight: '500' }]}>{team.pdo.toFixed(1)}</Text>
                      <Text style={[cellStyle, { flex: 0.9, paddingHorizontal: 4, textAlign: 'right', color: gdColor, fontWeight: '700' }]}>{team.predictedSuccess.toFixed(1)}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })()}

          <View style={{ marginTop: 8, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 11, color: theme.textSecondary, lineHeight: 16 }}>
              GSAA = Goals Saved Above Average · PDO = S% + SV% · GD/82 = Expected Goal Differential per 82 games · League Avg SV%: {(leagueAvgSvPct * 100).toFixed(1)}%
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderAnalysisTab = () => {
    // Get most recent season
    const mostRecentSeason = availableSeasons.length > 0 ? availableSeasons[0] : '2024-25';

    // Delegate to the unified tier system (role score + per-team rank).
    // No more separate ATOI thresholds — single source of truth with the
    // Stats tab and My Team roster.
    const fallbackTierTruei = { L1: 66.6, L2: 45.6, L3: 26.8, L4: 21.8, D1: 65.0, D2: 37.4, D3: 20.1 };
    const getReplacementLevel = (player) => {
      const tier = assignRoleTier(player, playerDatabase) || 'L4';
      const mean = tierBaselines?.[tier]?.mean;
      const expectedTruei = (mean != null && Number.isFinite(mean)) ? mean : (fallbackTierTruei[tier] ?? 25);
      return { level: tierToLineLabel(tier), truei: expectedTruei };
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
      
      const replacement = getReplacementLevel(current);
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
      <View style={[styles.tabContent, { backgroundColor: theme.bg }]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 }}>
          <Text style={[styles.title, { color: theme.text, marginBottom: 0 }]}>Player Analysis</Text>
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
            {mostRecentSeason} · active players only
          </Text>
        </View>
        
        {playerDatabase.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: theme.bgCard }]}>
            <Text style={[styles.emptyText, { color: theme.text }]}>No data available</Text>
            <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>Import players first</Text>
          </View>
        ) : (() => {
          // Compact 1-line player row renderer
          const PlayerRow = ({ player, deltaLabel, deltaValue, deltaPositive }) => {
            const deltaColor = deltaPositive ? '#2e7d32' : '#c62828';
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.borderLight }}>
                <TouchableOpacity style={{ flex: 1.8 }} onPress={() => setModalPlayerName(player.name)}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: theme.text, textDecorationLine: 'underline' }} numberOfLines={1}>{player.name}</Text>
                </TouchableOpacity>
                <Text style={{ flex: 0.6, fontSize: 11, color: theme.textSecondary, textAlign: 'center' }}>{convertAhlToNhl(player.team)}</Text>
                <Text style={{ flex: 0.6, fontSize: 11, color: theme.textSecondary, textAlign: 'center' }}>{player.pos}</Text>
                <Text style={{ flex: 0.8, fontSize: 11, color: theme.textSecondary, textAlign: 'right' }}>{player.toi.toFixed(1)} TOI</Text>
                <Text style={{ flex: 0.8, fontSize: 12, color: theme.text, textAlign: 'right', fontWeight: '600' }}>{player.truei.toFixed(1)}</Text>
                <Text style={{ flex: 0.8, fontSize: 12, color: deltaColor, textAlign: 'right', fontWeight: '700' }}>{deltaLabel}{deltaValue}</Text>
              </View>
            );
          };

          // Section renderer — compact card with tight header + 1-line rows
          const Section = ({ emoji, title, subtitle, data, deltaType }) => (
            <View style={{ backgroundColor: theme.bgCard, borderRadius: 10, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: theme.border || '#e0e0e0' }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: darkMode ? '#1e2236' : '#f0f3f8' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>{emoji} {title}</Text>
                <Text style={{ fontSize: 10, color: theme.textSecondary }}>{subtitle}</Text>
              </View>
              {data.length > 0 ? data.map((player, idx) => (
                <PlayerRow
                  key={idx}
                  player={player}
                  deltaLabel={deltaType === 'delta' ? (player.delta > 0 ? '↑ +' : '↓ ') : (player.vsReplacement > 0 ? '+' : '')}
                  deltaValue={deltaType === 'delta' ? player.delta.toFixed(1) : player.vsReplacement.toFixed(1)}
                  deltaPositive={deltaType === 'delta' ? player.delta > 0 : player.vsReplacement > 0}
                />
              )) : (
                <Text style={{ padding: 12, fontSize: 11, color: theme.textMuted, textAlign: 'center' }}>
                  {deltaType === 'delta' ? 'Need multiple seasons to compare' : 'No players qualify'}
                </Text>
              )}
            </View>
          );

          return (
            <ScrollView>
              <Section emoji="🟢" title="Top Risers" subtitle="Biggest YoY gains" data={risers} deltaType="delta" />
              <Section emoji="🔴" title="Top Fallers" subtitle="Biggest YoY drops" data={fallers} deltaType="delta" />
              <Section emoji="⭐" title="Overperformers" subtitle="Exceeding TOI expectation" data={overperformers} deltaType="vsRep" />
              <Section emoji="⚠️" title="Underperformers" subtitle="Below TOI expectation" data={underperformers} deltaType="vsRep" />
              <ContractValueScatter />
            </ScrollView>
          );
        })()}
      </View>
    );
  };

  // ═══════════════════════════════════════════════════════════════
  // CONTRACT VALUE SCATTER — cap hit vs Rating, per position.
  // Above regression line = surplus value (bargain). Below = overpay.
  // Data source: leagueContracts (user must click "Load League" first).
  // ═══════════════════════════════════════════════════════════════
  const ContractValueScatter = () => {
    const [posFilter, setPosFilter] = useState('C');
    const [teamFilter, setTeamFilter] = useState('All');
    const [yAxis, setYAxis] = useState('rating'); // 'rating' or 'truei'
    const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
    const [hoveredIdx, setHoveredIdx] = useState(null);
    const [loadingLeague, setLoadingLeague] = useState(false);
    const [loadProgress, setLoadProgress] = useState({ done: 0, total: 0 });

    const loadLeagueContracts = async () => {
      const teamNames = Object.keys(TEAM_LOGOS);
      setLoadingLeague(true);
      setLoadProgress({ done: 0, total: teamNames.length });
      const combined = {};
      // Fetch in small parallel batches to speed things up without hammering.
      const BATCH_SIZE = 4;
      for (let i = 0; i < teamNames.length; i += BATCH_SIZE) {
        const batch = teamNames.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (teamName) => {
          try {
            const CACHE_KEY = `rgmg_team_cache_${teamName}`;
            let teamData;
            try {
              const cached = await storageGetItem(CACHE_KEY);
              if (cached) teamData = JSON.parse(cached);
            } catch {}
            if (!teamData) {
              const res = await fetch(`/api/team?name=${encodeURIComponent(teamName)}`);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              teamData = await res.json();
              try { await storageSetItem(CACHE_KEY, JSON.stringify(teamData)); } catch {}
            }
            (teamData.players || []).forEach(p => {
              if (p.contract_type !== 'signed') return;
              combined[p.name] = {
                salary: parseFloat(p.salary) || 0,
                age: parseInt(p.age) || 0,
                retention_count: parseInt(p.retention_count) || 0,
                contract_duration: parseInt(p.contract_duration) || 0,
                expiry_type: p.expiry_type || '',
                status: p.status || '',
                pos: p.position || '',
                team: teamName,
              };
            });
          } catch (e) {
            console.error(`Load failed for ${teamName}:`, e);
          }
        }));
        setLoadProgress({ done: Math.min(i + BATCH_SIZE, teamNames.length), total: teamNames.length });
      }
      setLeagueContracts(combined);
      try { window.localStorage.setItem('leagueContracts', JSON.stringify(combined)); } catch {}
      setLoadingLeague(false);
    };

    const leagueLoaded = Object.keys(leagueContracts).length > 0;
    // Fall back to rosterContracts (your team only) if league not yet loaded
    const activeContracts = leagueLoaded ? leagueContracts : rosterContracts;

    // Position predicate. Uses primary pos letter after any slash-split.
    const matchesPos = (p, filter) => {
      if (!p.pos) return false;
      const positions = p.pos.toUpperCase().split(/[\/,\s]+/);
      if (filter === 'G') return positions.some(x => x.startsWith('G'));
      if (filter === 'D') return positions.some(x => x === 'D' || x === 'LD' || x === 'RD');
      return positions.includes(filter); // C, LW, RW
    };

    const mostRecentSeason = availableSeasons.length > 0 ? availableSeasons[0] : '2024-25';
    const points = useMemo(() => {
      const db = posFilter === 'G' ? goalieDatabase : playerDatabase;
      const list = [];
      db.forEach(p => {
        if (normalizeSeasonValue(p.season || '2024-25') !== normalizeSeasonValue(mostRecentSeason)) return;
        if (getSeasonType(p) !== 'regular') return;
        if ((p.gp || 0) < 20) return;
        if (posFilter !== 'G' && !matchesPos(p, posFilter)) return;
        const contract = activeContracts?.[p.name];
        const cap = contract?.salary;
        if (cap == null || cap <= 0) return;
        if (teamFilter !== 'All') {
          const contractTeam = contract?.team;
          if (contractTeam !== teamFilter) return;
        }
        const zInfo = calculateTRUEiZ ? calculateTRUEiZ(p) : null;
        if (!zInfo) return;
        const rating = zToRating(zInfo.z);
        if (rating == null) return;
        // Raw TRUEi (for goalies we use GSAA, since that's their TRUEi equiv)
        const truei = posFilter === 'G'
          ? (calculateGSAA ? calculateGSAA(p, leagueAvgSvPctFull) : 0)
          : parseFloat(calculateTRUEi(p, playerDatabase)) || 0;
        list.push({
          name: p.name,
          team: contract?.team || convertAhlToNhl(p.team),
          pos: p.pos,
          tier: zInfo.tier,
          cap,
          rating,
          truei,
          yValue: yAxis === 'rating' ? rating : truei,
        });
      });
      return list;
    }, [posFilter, teamFilter, yAxis, mostRecentSeason, activeContracts, playerDatabase, goalieDatabase]);

    // Linear regression: rating = m * cap + b.
    // Always computed across the WHOLE league for the position (team filter
    // doesn't affect the market line — otherwise filtering to one team would
    // give a meaningless line based on 4-5 points).
    const regression = useMemo(() => {
      const db = posFilter === 'G' ? goalieDatabase : playerDatabase;
      const all = [];
      db.forEach(p => {
        if (normalizeSeasonValue(p.season || '2024-25') !== normalizeSeasonValue(mostRecentSeason)) return;
        if (getSeasonType(p) !== 'regular') return;
        if ((p.gp || 0) < 20) return;
        if (posFilter !== 'G' && !matchesPos(p, posFilter)) return;
        const contract = activeContracts?.[p.name];
        const cap = contract?.salary;
        if (cap == null || cap <= 0) return;
        const zInfo = calculateTRUEiZ ? calculateTRUEiZ(p) : null;
        if (!zInfo) return;
        const rating = zToRating(zInfo.z);
        if (rating == null) return;
        const truei = posFilter === 'G'
          ? (calculateGSAA ? calculateGSAA(p, leagueAvgSvPctFull) : 0)
          : parseFloat(calculateTRUEi(p, playerDatabase)) || 0;
        const y = yAxis === 'rating' ? rating : truei;
        all.push({ cap, y });
      });
      if (all.length < 3) return null;
      const n = all.length;
      const sumX = all.reduce((s, p) => s + p.cap, 0);
      const sumY = all.reduce((s, p) => s + p.y, 0);
      const sumXY = all.reduce((s, p) => s + p.cap * p.y, 0);
      const sumXX = all.reduce((s, p) => s + p.cap * p.cap, 0);
      const denom = n * sumXX - sumX * sumX;
      if (denom === 0) return null;
      const m = (n * sumXY - sumX * sumY) / denom;
      const b = (sumY - m * sumX) / n;
      return { m, b };
    }, [posFilter, yAxis, mostRecentSeason, activeContracts, playerDatabase, goalieDatabase]);

    // Axis bounds — based on WHOLE league for the position so axes don't
    // jitter around when you change the team filter.
    const xMax = useMemo(() => {
      if (!regression) return points.length ? Math.max(...points.map(p => p.cap)) * 1.08 : 10;
      const db = posFilter === 'G' ? goalieDatabase : playerDatabase;
      let max = 0;
      db.forEach(p => {
        if (normalizeSeasonValue(p.season || '2024-25') !== normalizeSeasonValue(mostRecentSeason)) return;
        if (getSeasonType(p) !== 'regular') return;
        if ((p.gp || 0) < 20) return;
        if (posFilter !== 'G' && !matchesPos(p, posFilter)) return;
        const cap = activeContracts?.[p.name]?.salary;
        if (cap > max) max = cap;
      });
      return max * 1.08 || 10;
    }, [posFilter, mostRecentSeason, activeContracts, playerDatabase, goalieDatabase, regression, points]);
    const xMin = 0;
    // Y bounds depend on metric. Rating: fixed 0-110. TRUEi: data-driven with
    // a small pad so dots don't clip the edges.
    let yMin, yMax, yTicks;
    if (yAxis === 'rating') {
      yMin = 0;
      yMax = 110;
      yTicks = [0, 20, 40, 60, 80, 100];
    } else {
      const ys = points.map(p => p.truei);
      const dataMax = ys.length ? Math.max(...ys) : 100;
      const dataMin = ys.length ? Math.min(...ys) : 0;
      yMax = Math.ceil((dataMax + 10) / 20) * 20;
      yMin = Math.floor((Math.min(0, dataMin) - 5) / 20) * 20;
      yTicks = [];
      const step = (yMax - yMin) > 120 ? 40 : 20;
      for (let v = yMin; v <= yMax; v += step) yTicks.push(v);
    }

    const W = 720;
    const H = 380;
    const PAD_L = 48;
    const PAD_R = 12;
    const PAD_T = 12;
    const PAD_B = 36;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const xToPx = (x) => PAD_L + (plotW * (x - xMin)) / (xMax - xMin || 1);
    const yToPx = (y) => PAD_T + plotH - (plotH * (y - yMin)) / (yMax - yMin || 1);

    const colorForPoint = (p) => {
      if (!regression) return theme.accentBlue || '#3b82f6';
      const expected = regression.m * p.cap + regression.b;
      const surplus = p.yValue - expected;
      // Thresholds scale with metric — Rating is ~0-110, TRUEi can be -10 to 130+,
      // so use proportional bands (±10% and ±25% of typical spread).
      const bigBand = yAxis === 'rating' ? 12 : 18;
      const smallBand = yAxis === 'rating' ? 4 : 6;
      if (surplus >= bigBand) return '#16a34a';
      if (surplus >= smallBand) return '#4ade80';
      if (surplus <= -bigBand) return '#dc2626';
      if (surplus <= -smallBand) return '#f87171';
      return theme.textSecondary || '#888';
    };

    const xTicks = [];
    const xStep = xMax > 12 ? 2 : xMax > 6 ? 1 : 0.5;
    for (let v = 0; v <= xMax; v += xStep) xTicks.push(v);

    const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'];
    const teamOptions = ['All', ...Object.keys(TEAM_LOGOS).sort()];

    return (
      <View style={{ backgroundColor: theme.bgCard, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: theme.border || '#e0e0e0' }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: darkMode ? '#1e2236' : '#f0f3f8', borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>💰 Contract Value</Text>
              <Text style={{ fontSize: 10, color: theme.textSecondary }}>
                {leagueLoaded
                  ? `Cap hit vs Rating — ${Object.keys(leagueContracts).length} league contracts loaded. Season: ${mostRecentSeason}.`
                  : `Only your team's contracts shown. Click "Load League" for the full picture.`}
              </Text>
            </View>
            {!leagueLoaded && (
              <TouchableOpacity
                onPress={loadLeagueContracts}
                disabled={loadingLeague}
                style={{
                  paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6,
                  backgroundColor: loadingLeague ? theme.bgInput : (theme.accentBlue || '#3b82f6'),
                  borderWidth: 1,
                  borderColor: loadingLeague ? theme.border : (theme.accentBlue || '#3b82f6'),
                  opacity: loadingLeague ? 0.7 : 1,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: loadingLeague ? theme.text : '#fff' }}>
                  {loadingLeague
                    ? `Loading ${loadProgress.done}/${loadProgress.total}…`
                    : 'Load League'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Filters row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 10, color: theme.textSecondary, fontWeight: '600' }}>Y-axis:</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {[
                ['rating', 'Rating'],
                ['truei', 'TRUEi'],
              ].map(([val, label]) => (
                <TouchableOpacity
                  key={val}
                  onPress={() => setYAxis(val)}
                  style={{
                    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6,
                    backgroundColor: yAxis === val ? (theme.accentBlue || '#3b82f6') : theme.bgInput,
                    borderWidth: 1,
                    borderColor: yAxis === val ? (theme.accentBlue || '#3b82f6') : theme.border,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: yAxis === val ? '#fff' : theme.text }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 10, color: theme.textSecondary, fontWeight: '600', marginLeft: 8 }}>Position:</Text>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {POSITIONS.map(pos => (
                <TouchableOpacity
                  key={pos}
                  onPress={() => setPosFilter(pos)}
                  style={{
                    paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6,
                    backgroundColor: posFilter === pos ? (theme.accentBlue || '#3b82f6') : theme.bgInput,
                    borderWidth: 1,
                    borderColor: posFilter === pos ? (theme.accentBlue || '#3b82f6') : theme.border,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: posFilter === pos ? '#fff' : theme.text }}>{pos}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* Team dropdown */}
            <Text style={{ fontSize: 10, color: theme.textSecondary, fontWeight: '600', marginLeft: 8 }}>Team:</Text>
            <View style={{ position: 'relative', zIndex: 20 }}>
              <TouchableOpacity
                onPress={() => setTeamDropdownOpen(v => !v)}
                disabled={!leagueLoaded}
                style={{
                  paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6,
                  backgroundColor: teamFilter !== 'All' ? (theme.accentBlue || '#3b82f6') : theme.bgInput,
                  borderWidth: 1,
                  borderColor: teamFilter !== 'All' ? (theme.accentBlue || '#3b82f6') : theme.border,
                  opacity: leagueLoaded ? 1 : 0.5,
                  flexDirection: 'row', alignItems: 'center', gap: 4,
                  minWidth: 110,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: teamFilter !== 'All' ? '#fff' : theme.text, flex: 1 }}>
                  {teamFilter}
                </Text>
                <Text style={{ fontSize: 9, color: teamFilter !== 'All' ? '#fff' : theme.textSecondary }}>▼</Text>
              </TouchableOpacity>
              {teamDropdownOpen && leagueLoaded && (
                <View style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border,
                  borderRadius: 6, width: 180, maxHeight: 280, zIndex: 100,
                  shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8,
                }}>
                  <ScrollView style={{ maxHeight: 280 }}>
                    {teamOptions.map(t => (
                      <TouchableOpacity
                        key={t}
                        onPress={() => { setTeamFilter(t); setTeamDropdownOpen(false); }}
                        style={{
                          paddingVertical: 6, paddingHorizontal: 10,
                          backgroundColor: t === teamFilter ? (darkMode ? '#1e2236' : '#eef2f8') : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 12, color: theme.text, fontWeight: t === teamFilter ? '700' : '400' }}>
                          {t}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Plot */}
        {points.length < 1 ? (
          <Text style={{ padding: 16, fontSize: 11, color: theme.textMuted || theme.textSecondary, textAlign: 'center' }}>
            No {posFilter} players with cap + rating{teamFilter !== 'All' ? ` on ${teamFilter}` : ''}.
          </Text>
        ) : (
          <View style={{ padding: 12 }}>
            <View style={{
              width: W, height: H, maxWidth: '100%',
              position: 'relative',
              backgroundColor: darkMode ? '#0e1120' : '#fff',
              borderRadius: 6,
              overflow: 'hidden',
            }}>
              {yTicks.map(y => (
                <View key={`y${y}`} style={{ position: 'absolute', left: PAD_L, right: PAD_R, top: yToPx(y), height: 1, backgroundColor: darkMode ? '#222' : '#eef0f4' }} />
              ))}
              {yTicks.map(y => (
                <Text key={`yl${y}`} style={{
                  position: 'absolute', left: 0, width: PAD_L - 4, top: yToPx(y) - 6,
                  fontSize: 9, color: theme.textSecondary, textAlign: 'right',
                }}>{y}</Text>
              ))}
              {xTicks.map(x => (
                <View key={`x${x}`} style={{ position: 'absolute', left: xToPx(x), top: PAD_T + plotH, height: 4, width: 1, backgroundColor: darkMode ? '#444' : '#bbb' }} />
              ))}
              {xTicks.map(x => (
                <Text key={`xl${x}`} style={{
                  position: 'absolute', top: PAD_T + plotH + 6, left: xToPx(x) - 14, width: 28,
                  fontSize: 9, color: theme.textSecondary, textAlign: 'center',
                }}>${x.toFixed(x < 1 ? 1 : 0)}M</Text>
              ))}
              {regression && (() => {
                const x1 = xMin, x2 = xMax;
                const y1 = regression.m * x1 + regression.b;
                const y2 = regression.m * x2 + regression.b;
                const px1 = xToPx(x1), py1 = yToPx(y1);
                const px2 = xToPx(x2), py2 = yToPx(y2);
                const dx = px2 - px1;
                const dy = py2 - py1;
                const len = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                return (
                  <View style={{
                    position: 'absolute',
                    left: px1, top: py1,
                    width: len, height: 2,
                    backgroundColor: darkMode ? '#555' : '#c5cbd6',
                    transformOrigin: '0 50%',
                    transform: [{ rotate: `${angle}deg` }],
                  }} />
                );
              })()}
              {points.map((p, i) => {
                const color = colorForPoint(p);
                const hovered = hoveredIdx === i;
                return (
                  <TouchableOpacity
                    key={`${p.name}-${i}`}
                    onPress={() => setModalPlayerName(p.name)}
                    onPressIn={() => setHoveredIdx(i)}
                    onPressOut={() => setHoveredIdx(null)}
                    {...(Platform.OS === 'web' ? {
                      onMouseEnter: () => setHoveredIdx(i),
                      onMouseLeave: () => setHoveredIdx(null),
                    } : {})}
                    style={{
                      position: 'absolute',
                      left: xToPx(p.cap) - 5, top: yToPx(p.yValue) - 5,
                      width: 10, height: 10, borderRadius: 5,
                      backgroundColor: color,
                      borderWidth: hovered ? 2 : 1,
                      borderColor: hovered ? '#fff' : (darkMode ? '#000' : '#fff'),
                      zIndex: hovered ? 5 : 2,
                    }}
                  />
                );
              })}
              {hoveredIdx != null && points[hoveredIdx] && (() => {
                const p = points[hoveredIdx];
                const tx = xToPx(p.cap);
                const ty = yToPx(p.rating);
                const leftSide = tx > W / 2;
                return (
                  <View style={{
                    position: 'absolute',
                    left: leftSide ? tx - 170 : tx + 10,
                    top: Math.max(4, ty - 40),
                    width: 160,
                    padding: 6,
                    backgroundColor: darkMode ? '#1a1d2e' : '#fff',
                    borderWidth: 1, borderColor: theme.border || '#ccc',
                    borderRadius: 6,
                    zIndex: 10,
                    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: theme.text }} numberOfLines={1}>{p.name}</Text>
                    <Text style={{ fontSize: 10, color: theme.textSecondary }}>{p.team} · {p.pos} · {p.tier}</Text>
                    <Text style={{ fontSize: 10, color: theme.text, marginTop: 2 }}>
                      ${p.cap.toFixed(2)}M · TRUEi {p.truei.toFixed(1)} · Rating {Math.round(p.rating)}
                    </Text>
                  </View>
                );
              })()}
            </View>
            <Text style={{ fontSize: 10, color: theme.textSecondary, textAlign: 'center', marginTop: 8, fontStyle: 'italic' }}>
              X: cap ($M) · Y: {yAxis === 'rating' ? 'Rating (role-adjusted)' : 'TRUEi (raw production)'} · Tap a dot · {points.length} shown
              {teamFilter !== 'All' && regression ? ` · line = league ${posFilter} market` : ''}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const renderPlayoffTab = () => (
    <View style={styles.tabContent}>
      <Text style={styles.title}>Playoff Success Predictor</Text>
      <Text style={styles.subtitle}>Team-based playoff performance estimator</Text>

      <TextInput
        style={[styles.input, { backgroundColor: theme.bgInput, borderColor: theme.border, color: theme.text }]}
        placeholder="Shots For per 82 GP"
        keyboardType="numeric"
        value={playoffStats.shotsFor82}
        onChangeText={(text) => setPlayoffStats({...playoffStats, shotsFor82: text})}
      />
      <TextInput
        style={[styles.input, { backgroundColor: theme.bgInput, borderColor: theme.border, color: theme.text }]}
        placeholder="Team Shooting % (e.g., 9.5)"
        keyboardType="numeric"
        value={playoffStats.shootingPct}
        onChangeText={(text) => setPlayoffStats({...playoffStats, shootingPct: text})}
      />
      <TextInput
        style={[styles.input, { backgroundColor: theme.bgInput, borderColor: theme.border, color: theme.text }]}
        placeholder="Shots Against per 82 GP"
        keyboardType="numeric"
        value={playoffStats.shotsAgainst82}
        onChangeText={(text) => setPlayoffStats({...playoffStats, shotsAgainst82: text})}
      />
      <TextInput
        style={[styles.input, { backgroundColor: theme.bgInput, borderColor: theme.border, color: theme.text }]}
        placeholder="Starting Goalie SV% (e.g., 91.5)"
        keyboardType="numeric"
        value={playoffStats.goalieSvPct}
        onChangeText={(text) => setPlayoffStats({...playoffStats, goalieSvPct: text})}
      />
      <TextInput
        style={[styles.input, { backgroundColor: theme.bgInput, borderColor: theme.border, color: theme.text }]}
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
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.tabBar, { backgroundColor: theme.bgHeader, borderBottomColor: theme.border, paddingLeft: 16 }]}>
        {/* Logo doubles as dark-mode toggle (clickable icon beside RGMG label) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 12, borderRightWidth: 1, borderRightColor: theme.border, marginRight: 8 }}>
          <TouchableOpacity
            onPress={() => setDarkMode(!darkMode)}
            activeOpacity={0.6}
            accessibilityLabel="Toggle dark mode"
            style={{ cursor: 'pointer' }}
          >
            <Image
              source={require('./assets/icon.png')}
              style={{ width: 24, height: 24, borderRadius: 4 }}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff', marginLeft: 8 }}>RGMG</Text>
        </View>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'stats' && styles.activeTab]}
          onPress={() => setActiveTab('stats')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'stats' && styles.activeTabText]}>
            Stats
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'roster' && styles.activeTab]}
          onPress={() => setActiveTab('roster')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'roster' && styles.activeTabText]}>
            My Team
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'rankings' && styles.activeTab]}
          onPress={() => setActiveTab('rankings')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'rankings' && styles.activeTabText]}>
            Rankings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'teams' && styles.activeTab]}
          onPress={() => setActiveTab('teams')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'teams' && styles.activeTabText]}>
            Teams
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'Trade Calc' && styles.activeTab]}
          onPress={() => setActiveTab('calc')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'calc' && styles.activeTabText]}>
            Trade Calc
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'analysis' && styles.activeTab]}
          onPress={() => setActiveTab('analysis')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'analysis' && styles.activeTabText]}>
            Analysis
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'remix' && styles.activeTab]}
          onPress={() => setActiveTab('remix')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'remix' && styles.activeTabText]}>
            Remix
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        ref={mainScrollViewRef}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        style={[styles.scrollView, { backgroundColor: theme.bg }]}
      >
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
            darkMode={darkMode}
            theme={theme}
            onPlayerClick={setModalPlayerName}
          />
        )}
{activeTab === 'calc' && (
          <Suspense fallback={<View style={{ padding: 24 }}><Text style={{ color: theme.textSecondary }}>Loading Trade Calc…</Text></View>}>
            <TradeCalc
              theme={theme}
              seasons={[...new Set(playerDatabase.map(p => p.season))].sort()}
              playerDatabase={playerDatabase}
              calculateTRUEi={calculateTRUEi}
              onPlayerClick={setModalPlayerName}
            />
          </Suspense>
        )}
        {activeTab === 'teams' && renderTeamStatsTab()}
        {activeTab === 'analysis' && renderAnalysisTab()}
        {activeTab === 'remix' && (
          <Suspense fallback={<View style={{ padding: 24 }}><Text style={{ color: theme.textSecondary }}>Loading Remix…</Text></View>}>
            <Remix
              theme={theme}
              playerDatabase={playerDatabase}
              goalieDatabase={goalieDatabase}
              draftLookup={draftLookup}
              calculateTRUEi={calculateTRUEi}
              assignRoleTier={assignRoleTier}
              tierToLineLabel={tierToLineLabel}
            />
          </Suspense>
        )}
      </ScrollView>

      {/* Back to Top Button */}
      {showBackToTop && (
        <TouchableOpacity
          onPress={scrollToTop}
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            backgroundColor: theme.accentBlue,
            width: 44,
            height: 44,
            borderRadius: 22,
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
            elevation: 5,
            zIndex: 1000,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold' }}>↑</Text>
        </TouchableOpacity>
      )}

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

      {/* Player Dossier Modal — opens when a player name is clicked anywhere */}
      <PlayerModal
        playerName={modalPlayerName}
        onClose={() => setModalPlayerName(null)}
        draftLookup={draftLookup}
        groupedPlayers={groupedPlayers}
        goalieDatabase={goalieDatabase}
        rosterContracts={rosterContracts}
        calculateTRUEi={calculateTRUEi}
        calculateTRUEiBreakdown={calculateTRUEiBreakdown}
        calculateTRUEiZ={calculateTRUEiZ}
        calculateGSAA={calculateGSAA}
        onNavigateToTeam={navigateToTeam}
        convertAhlToNhl={convertAhlToNhl}
        leagueAvgSvPct={(() => {
          const totalSaves = goalieDatabase.reduce((s, g) => s + ((g.sha || 0) - (g.ga || 0)), 0);
          const totalShots = goalieDatabase.reduce((s, g) => s + (g.sha || 0), 0);
          return totalShots > 0 ? totalSaves / totalShots : 0.905;
        })()}
        theme={theme}
        darkMode={darkMode}
      />
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
    borderBottomColor: '#fff',
  },
  tabText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
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
    width: 38,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  statsHeaderActive: {
    color: '#4caf50',
  },
  statsNameCell: {
    width: 115,
    textAlign: 'left',
    paddingLeft: 8,
    position: 'sticky',
    left: 0,
    zIndex: 2,
  },
  statsTeamCell: {
    width: 62,
  },
  statsPosCell: {
    width: 52,
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
    width: 38,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 2,
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