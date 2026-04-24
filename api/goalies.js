// Vercel serverless function — proxies rgmg.ca goalie stats
// Query params: ?season=13&type=regular (or type=playoffs)

export default async function handler(req, res) {
  const season = req.query.season;
  const type = req.query.type === 'playoffs' ? 'playoff' : 'normal';

  const url = season
    ? `http://146.235.205.152:5000/api/seasons/${season}/stats/type/${type}/goalies`
    : `http://146.235.205.152:5000/api/seasons/stats/type/${type}/goalies`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ${response.status}` });
    }

    const data = await response.json();

    // Normalize: rename team_name → team, sv → svPct
    const normalized = data.map(g => ({
      ...g,
      team: g.team_name,
      svPct: parseFloat(g.sv) || 0,
    }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(normalized);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
