// Vercel serverless function — proxies team data from rgmg.ca
// Query params: ?name=Jets&season=2028-29 (season optional, defaults to current)
// Returns: { id, name, gmName, capHit, capSpace, retained, buried, averageAge,
//            forwardCount, defenceCount, goalieCount, contractCount, minorsCount,
//            playerCount, players: [...], draftPicks: [...] }

const NHL_TEAMS = new Set([
  'Ducks', 'Coyotes', 'Bruins', 'Sabres', 'Flames', 'Hurricanes', 'Blackhawks',
  'Avalanche', 'BlueJackets', 'Stars', 'RedWings', 'Oilers', 'Panthers',
  'Kings', 'Wild', 'Canadiens', 'Predators', 'Devils', 'Islanders', 'Rangers',
  'Senators', 'Flyers', 'Penguins', 'Sharks', 'Kraken', 'Blues', 'Lightning',
  'MapleLeafs', 'Canucks', 'GoldenKnights', 'Capitals', 'Jets'
]);

const SEASON_RE = /^\d{4}-\d{2}$/;

const BASE_URL = process.env.UPSTREAM_BASE_URL || 'http://146.235.205.152:5000';

export default async function handler(req, res) {
  const { name, season } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Missing team name' });
  }

  if (!NHL_TEAMS.has(name)) {
    return res.status(400).json({ error: 'Invalid team name' });
  }

  if (season && !SEASON_RE.test(season)) {
    return res.status(400).json({ error: 'Invalid season format' });
  }

  // rgmg.ca expects path-based params: /api/teams/{name}/{season?}
  const encodedName = encodeURIComponent(name);
  const url = season
    ? `${BASE_URL}/api/teams/${encodedName}/${encodeURIComponent(season)}`
    : `${BASE_URL}/api/teams/${encodedName}`;

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
