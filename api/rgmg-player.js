// Vercel serverless function — proxies rgmg.ca's player API.
//
// Endpoint: /api/rgmg-player?name=Pavel+Zacha
//
// Why proxy instead of direct fetch?
//   The upstream API runs on plain HTTP (no TLS), but truei.vercel.app is
//   served over HTTPS. Browsers block HTTP fetches from HTTPS pages as
//   "mixed content," so the call has to happen server-side. Vercel functions
//   can hit HTTP just fine and return the result over HTTPS.
//
// What we return:
//   The full upstream JSON body. The PlayerModal slices out the `trades`
//   array (and could use `awards`, `comparables`, etc. later).
//
// Caching:
//   2 hours fresh, 24 hours stale. Trade history doesn't change after the
//   fact, so we can cache aggressively. (New trades are appended only.)

const NAME_RE = /^[\p{L}\p{M}\s'.-]{1,80}$/u;
const UPSTREAM = 'http://146.235.205.152:5000/api/players';

export default async function handler(req, res) {
  const name = (req.query.name || '').trim();

  if (!name || !NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid or missing name parameter' });
  }

  try {
    const url = `${UPSTREAM}/${encodeURIComponent(name)}`;
    const upstream = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'RGMG-Analytics/1.0',
      },
    });

    if (upstream.status === 404) {
      // Cache "no such player" briefly so the modal doesn't refetch on every open
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ found: false });
    }

    if (!upstream.ok) {
      return res.status(502).json({
        error: `Upstream returned ${upstream.status}`,
      });
    }

    let data;
    try {
      data = await upstream.json();
    } catch (e) {
      return res.status(502).json({ error: 'Upstream returned non-JSON' });
    }

    res.setHeader('Cache-Control', 's-maxage=7200, stale-while-revalidate=86400');
    return res.status(200).json({ found: true, player: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
