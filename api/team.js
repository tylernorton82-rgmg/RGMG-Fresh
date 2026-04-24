// Vercel serverless function — proxies team data from rgmg.ca
// Query params: ?name=Jets&season=2028-29 (season optional, defaults to current)
// Returns: { id, name, gmName, capHit, capSpace, retained, buried, averageAge,
//            forwardCount, defenceCount, goalieCount, contractCount, minorsCount,
//            playerCount, players: [...], draftPicks: [...] }

export default async function handler(req, res) {
  const { name, season } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Missing team name' });
  }

  // rgmg.ca expects path-based params: /api/teams/{name}/{season?}
  const encodedName = encodeURIComponent(name);
  const url = season
    ? `http://146.235.205.152:5000/api/teams/${encodedName}/${encodeURIComponent(season)}`
    : `http://146.235.205.152:5000/api/teams/${encodedName}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upstream ${response.status}` });
    }

    const data = await response.json();

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
