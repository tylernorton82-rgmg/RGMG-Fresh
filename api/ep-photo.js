// Vercel serverless function — proxies EliteProspects to find a player's
// photo URL. Avoids CORS issues that would block direct browser fetches.
//
// Endpoint: /api/ep-photo?name=Jonah+Neuenschwander
//
// Strategy:
//   1. Fetch EP's public search page HTML for the name
//   2. Parse HTML to extract the FIRST player profile link
//      (pattern: /player/<id>/<slug>)
//   3. Build the photo URL from the player ID
//   4. Validate the photo exists (HEAD request)
//   5. Return { url, source: 'ep', playerId, matchedName }
//
// Why HTML scrape instead of typeahead JSON?
//   EP's typeahead endpoint either doesn't exist publicly or requires
//   browser cookies. The /search?q=... HTML page works without auth and
//   has a stable layout — player profile links match a clear regex.
//
// Caching: 1 day fresh, 7 days stale. Negative results cached 1 hour.

const NAME_RE = /^[\p{L}\p{M}\s'.-]{1,80}$/u;

// Match a player profile link in EP's search page HTML.
// Example: /player/709625/jonah-neuenschwander
const PLAYER_LINK_RE = /\/player\/(\d+)\/([a-z0-9-]+)/gi;

export default async function handler(req, res) {
  const name = (req.query.name || '').trim();

  if (!name || !NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid or missing name parameter' });
  }

  try {
    const searchUrl = `https://www.eliteprospects.com/search?q=${encodeURIComponent(name)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        // Pretend to be a normal browser — EP serves the same HTML to
        // anyone but some CDNs reject obvious bot user agents.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      // Follow redirects (EP sometimes 302s search hits straight to a profile)
      redirect: 'follow',
    });

    if (!searchRes.ok) {
      return res.status(502).json({
        error: `EP search returned ${searchRes.status}`,
        finalUrl: searchRes.url,
      });
    }

    const html = await searchRes.text();
    const finalUrl = searchRes.url || searchUrl;

    // Two paths: search redirected straight to a profile (single match),
    // or search returned a results page with multiple links.
    let playerId = null;
    let slug = null;

    // Path 1: redirect to /player/<id>/<slug>
    const directMatch = finalUrl.match(/\/player\/(\d+)\/([a-z0-9-]+)/i);
    if (directMatch) {
      playerId = directMatch[1];
      slug = directMatch[2];
    } else {
      // Path 2: scan HTML for the FIRST player profile link
      // Reset regex state since /g is sticky
      PLAYER_LINK_RE.lastIndex = 0;
      const m = PLAYER_LINK_RE.exec(html);
      if (m) {
        playerId = m[1];
        slug = m[2];
      }
    }

    if (!playerId) {
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ url: null, reason: 'no-player-link-found' });
    }

    // Build photo URL. EP serves player photos at this CDN path:
    //   https://files.eliteprospects.com/layout/players/<id>.jpg
    const photoUrl = `https://files.eliteprospects.com/layout/players/${playerId}.jpg`;

    // HEAD-check before returning so we don't render a broken image
    try {
      const headRes = await fetch(photoUrl, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RGMG-Analytics/1.0)' },
      });
      if (!headRes.ok) {
        res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json({ url: null, playerId, reason: 'no-photo' });
      }
    } catch (e) {
      // Network blip — return URL anyway
    }

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      url: photoUrl,
      source: 'ep',
      playerId,
      slug,
      matchedName: name,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
