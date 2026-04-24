// Vercel serverless function — proxies rgmg.ca API
// Query params: ?season=13&type=regular (or type=playoffs)
// Returns normalized player data matching App.js expectations

const SEASON_RE = /^\d{4}-\d{2}$|^\d+$/;
const BASE_URL = process.env.PLAYERS_API_BASE_URL || 'http://146.235.205.152:5000';

export default async function handler(req, res) {
  const season = req.query.season;
  const type = req.query.type === 'playoffs' ? 'playoff' : 'normal';

  if (season !== undefined && !SEASON_RE.test(season)) {
    return res.status(400).json({ error: 'Invalid season parameter' });
  }

  const url = season
    ? `${BASE_URL}/api/seasons/${season}/stats/type/${type}/players`
    : `${BASE_URL}/api/seasons/stats/type/${type}/players`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ${response.status}` });
    }

    const data = await response.json();

    // Normalize to match App.js field expectations
    const normalized = data.map(p => ({
      ...p,
      team: p.team_name,
      sPct: parseFloat(p.shot_percent) || 0,
      foPct: parseFloat(p.faceoff_percent) || 0,
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(normalized);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
