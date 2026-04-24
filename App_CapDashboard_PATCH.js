// ============================================================================
// WIRING INSTRUCTIONS — 3 small edits to App.js
// ============================================================================

// ----------------------------------------------------------------------------
// EDIT 1 — Add the import (near the top of App.js, around line 18-20)
//
// After this existing line:
//   import DRAFT_DATA from './assets/data/draftData.json';
//
// Add:
// ----------------------------------------------------------------------------

import CapDashboard from './CapDashboard';


// ----------------------------------------------------------------------------
// EDIT 2 — Add a new tab button (around line 4706, right after the 'teams' tab)
//
// Find this block (around line 4706):
//
//   <TouchableOpacity
//     style={[styles.tab, activeTab === 'teams' && styles.activeTab]}
//     onPress={() => setActiveTab('teams')}
//   >
//     <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'teams' && styles.activeTabText]}>
//       Teams
//     </Text>
//   </TouchableOpacity>
//
// Immediately AFTER the closing </TouchableOpacity>, paste this new tab:
// ----------------------------------------------------------------------------

        <TouchableOpacity
          style={[styles.tab, activeTab === 'cap' && styles.activeTab]}
          onPress={() => setActiveTab('cap')}
        >
          <Text style={[styles.tabText, { color: theme.textSecondary }, activeTab === 'cap' && styles.activeTabText]}>
            Cap
          </Text>
        </TouchableOpacity>


// ----------------------------------------------------------------------------
// EDIT 3 — Render the dashboard when tab is active (around line 4744)
//
// Find this line:
//   {activeTab === 'teams' && renderTeamStatsTab()}
//
// Immediately AFTER it, add:
// ----------------------------------------------------------------------------

        {activeTab === 'cap' && (
          <CapDashboard
            theme={theme}
            seasons={[...new Set(playerDatabase.map(p => p.season))].sort()}
            playerDatabase={playerDatabase}
            defaultTeam="Jets"
          />
        )}


// ============================================================================
// That's it. Save App.js, then deploy:
//   vercel --prod
// ============================================================================

// NOTE: The dashboard looks up TRUEi values from your playerDatabase by matching
// player name + season + seasonType='regular'. If you see "—" in the TRUEi
// column, that player either has no regular-season data for the selected season
// or has a name mismatch. Minor issue only — cap data still displays correctly.
