const ALLOWED_HOSTS = new Set([
  'www.transfermarkt.com',
  'transfermarkt.com',
  'www.transfermarkt.de',
  'transfermarkt.de',
  'www.transfermarkt.us',
  'transfermarkt.us',
  'www.transfermarkt.co.uk',
  'transfermarkt.co.uk',
  'www.transfermarkt.at',
  'transfermarkt.at',
  'www.transfermarkt.world',
  'transfermarkt.world',
  'tmapi.transfermarkt.technology'
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'GET') return json({ error: 'Only GET is allowed' }, 405);

    const reqUrl = new URL(request.url);
    const targetRaw = reqUrl.searchParams.get('url');
    if (!targetRaw) return json({ error: 'Missing ?url=' }, 400);

    let target;
    try {
      target = new URL(targetRaw);
    } catch (_error) {
      return json({ error: 'Invalid target URL' }, 400);
    }

    if (!['http:', 'https:'].includes(target.protocol)) return json({ error: 'Invalid protocol' }, 400);
    if (!ALLOWED_HOSTS.has(target.hostname)) return json({ error: `Host not allowed: ${target.hostname}` }, 403);

    const upstream = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        'Accept': request.headers.get('Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.transfermarkt.com/',
        'X-Requested-With': request.headers.get('X-Requested-With') || 'XMLHttpRequest'
      }
    });

    const headers = new Headers(upstream.headers);
    Object.entries(CORS).forEach(([key, value]) => headers.set(key, value));
    headers.set('Cache-Control', 'no-store');
    headers.delete('content-security-policy');
    headers.delete('content-security-policy-report-only');
    headers.delete('x-frame-options');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }
};

function json(payload, status) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json;charset=utf-8' }
  });
}
