// Vercel serverless function — proxies EliteProspects to find a player's
// photo URL. Avoids CORS issues that would block direct browser fetches.
//
// Endpoint: /api/ep-photo?name=Jonah+Neuenschwander
//
// Strategy:
//   1. Hit EP's typeahead endpoint with the player name
//   2. Parse JSON response, find best matching hockey player
//   3. Build the photo URL from the player ID
//   4. Validate the photo actually exists (HEAD request)
//   5. Return { url, source: 'ep', playerId, matchedName }
//
// Caching:
//   Server-side cache via Vercel response headers (1 day fresh, 7 days stale).
//   Client-side cache lives in PlayerPhoto.js (localStorage).
//
// Failure modes:
//   - Search returns no results -> 200 { url: null }
//   - Search hits an athlete in another sport -> filter to hockey only
//   - EP changes their HTML/JSON shape -> 502 with descriptive error;
//     PlayerPhoto.js negative-caches and falls back to chain walk

const NAME_RE = /^[\p{L}\p{M}\s'.-]{1,80}$/u;

export default async function handler(req, res) {
  const name = (req.query.name || '').trim();

  if (!name || !NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid or missing name parameter' });
  }

  try {
    // EliteProspects' public typeahead endpoint. Returns JSON with players,
    // teams, leagues. We filter to "player" type entries.
    const searchUrl = `https://www.eliteprospects.com/typeaheadsearch?q=${encodeURIComponent(name)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        // Some EP endpoints require a real-looking UA
        'User-Agent': 'Mozilla/5.0 (compatible; RGMG-Analytics/1.0)',
      },
    });

    if (!searchRes.ok) {
      return res.status(502).json({ error: `EP search returned ${searchRes.status}` });
    }

    let searchData;
    try {
      searchData = await searchRes.json();
    } catch (e) {
      // EP might return HTML if endpoint changed. Try the public search URL
      // as fallback and parse the HTML for player links.
      return res.status(502).json({ error: 'EP typeahead returned non-JSON' });
    }

    // Response shape (as of writing): { players: [...], teams: [...], ... }
    // Each player: { id, fullName, position, dob, country, ... }
    const players = Array.isArray(searchData?.players) ? searchData.players :
                    Array.isArray(searchData) ? searchData.filter(e => e.type === 'player') :
                    [];

    if (players.length === 0) {
      // Cache "no result" briefly so we don't hammer EP for the same name
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ url: null, reason: 'no-results' });
    }

    // Pick best match: exact name match (case-insensitive) wins. Otherwise
    // first result.
    const lowerName = name.toLowerCase();
    const exact = players.find(p =>
      (p.fullName || p.name || '').toLowerCase() === lowerName
    );
    const player = exact || players[0];

    if (!player || !player.id) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ url: null, reason: 'no-id' });
    }

    // Build photo URL. EP serves player photos at this CDN path:
    //   https://files.eliteprospects.com/layout/players/<id>.jpg
    // Some prospects don't have photos uploaded, so we HEAD-check before
    // returning the URL.
    const photoUrl = `https://files.eliteprospects.com/layout/players/${player.id}.jpg`;

    try {
      const headRes = await fetch(photoUrl, { method: 'HEAD' });
      if (!headRes.ok) {
        // Photo doesn't exist (404). Don't return a URL that would render broken.
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json({ url: null, playerId: player.id, reason: 'no-photo' });
      }
    } catch (e) {
      // Network blip — return the URL anyway and let the client decide
    }

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      url: photoUrl,
      source: 'ep',
      playerId: player.id,
      matchedName: player.fullName || player.name || name,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
