// ============================================================================
// 3-YEAR WEIGHTED TRUEi — Edit App.js rosterWithStats
// ============================================================================
//
// Open App.js, search for:   const rosterWithStats = rosterSkaters.map
// (Should be around line 3261)
//
// REPLACE the entire rosterWithStats block (lines ~3261-3300) with this:
// ============================================================================

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
      // Weights: current 50%, prior 30%, two-back 20%
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
        if (!isNaN(t0)) parts.push({ val: t0, w: 0.5 });
        if (t1 !== null && !isNaN(t1)) parts.push({ val: t1, w: 0.3 });
        if (t2 !== null && !isNaN(t2)) parts.push({ val: t2, w: 0.2 });
        const totalW = parts.reduce((s, p) => s + p.w, 0);
        if (totalW > 0) {
          truei3yr = parts.reduce((s, p) => s + p.val * p.w, 0) / totalW;
        }
      }

      // Replacement level
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
        truei3yr,
        replacementLevel,
        expectedTruei,
        vsReplacement: truei - expectedTruei,
        type: 'skater'
      };
    }).filter(Boolean);

// ============================================================================
// That's the only App.js edit needed. The new `truei3yr` field is attached to
// every roster skater. LinesBuilder will use it automatically when present.
// If you only have 1 season of data on a player, truei3yr just equals truei.
// ============================================================================
