  const loadPlayers = async () => {
    try {
      // Try migration but don't fail if it doesn't work
      try {
        await migrateStorageToIndexedDb(['playerDatabase', 'goalieDatabase', 'seasonImages', 'myRoster']);
      } catch (migrationError) {
        console.log('Migration skipped:', migrationError);
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
        return {
          ...p,
          season,
          seasonType,
          name: p.name || p.Name || '',
          team: convertAhlToNhl(rawTeam),
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
      const normalizeGoalie = (g, season, seasonType) => ({
        ...g,
        season,
        seasonType,
        name: g.name || g.Name || g.Player || g.player,
        team: convertAhlToNhl(g.team_name || g.Team || g.team),
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
      });

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

      // Load user's saved roster from browser storage
      try {
        const savedRoster = await storageGetItem('myRoster');
        if (savedRoster) {
          setMyRoster(JSON.parse(savedRoster));
        }
      } catch (rosterError) {
        console.log('Could not load roster:', rosterError);
      }
    } catch (error) {
      console.error('Error loading players:', error);
      Alert.alert('Error', 'Failed to load data: ' + error.message);
    }
  };
