// Shared API client that mirrors App.js's `fetchProxyOrUpstream` logic but
// is importable from any file (modal, calc tabs, importer, etc.).
//
// Why this exists:
// - On the Vercel-hosted live site, `/api/foo` requests hit serverless
//   functions in `api/*.js` that proxy to the rgmg.ca upstream. Those
//   functions translate the proxy URL shape (e.g. `/api/team?name=X`) into
//   the upstream's actual path shape (e.g. `/api/teams/X`).
// - On local Expo dev there's no serverless layer. A bare relative
//   `/api/...` request hits the dev server's HTML fallback, which then
//   tries to parse `<!doctype html>` as JSON and explodes.
// - This helper tries the proxy URL first (works on prod), then falls
//   back to the upstream URL directly (works on local dev). Each call
//   site can optionally pass a `transformUpstream` to reshape the raw
//   upstream response into whatever shape the caller expects (since the
//   serverless functions sometimes wrap or normalize the body).
//
// Usage:
//   const data = await fetchProxyOrUpstream('/api/team?name=Avalanche', '/api/teams/Avalanche');
//   const wrapped = await fetchProxyOrUpstream(
//     '/api/rgmg-player?name=Lane%20Hutson',
//     '/api/players/Lane%20Hutson',
//     { transformUpstream: (player) => ({ found: true, player }), notFoundValue: { found: false } }
//   );

const UPSTREAM = 'http://146.235.205.152:5000';

export async function fetchProxyOrUpstream(proxyPath, upstreamPath, options = {}) {
  try {
    const r = await fetch(proxyPath);
    if (r.ok) {
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await r.json();
    }
  } catch (_) { /* fall through to upstream */ }

  const r2 = await fetch(`${UPSTREAM}${upstreamPath || proxyPath}`);
  if (r2.status === 404) {
    return options.notFoundValue !== undefined ? options.notFoundValue : null;
  }
  if (!r2.ok) {
    throw new Error(`upstream ${upstreamPath || proxyPath} HTTP ${r2.status}`);
  }
  const data = await r2.json();
  return options.transformUpstream ? options.transformUpstream(data) : data;
}
