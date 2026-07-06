// source-prefilter-contract-nat-mv-v3-20260706
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

// batch24-dedupe-cache-nat-mv-v3-20260706
// 40 Transfermarkt URL / Worker request + batchen belüli URL dedupe + Cloudflare cache.
// 40 alatt maradunk, hogy ne legyen subrequest-limit / túl nagy JSON válasz para, de a Worker request count így is sokkal kisebb.
const MAX_BATCH = 40;
const UPSTREAM_CONCURRENCY = 8;
const CACHE_TTL_SECONDS = 8 * 60 * 60;
const MAX_CACHEABLE_BODY_CHARS = 1_400_000;

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (request.method === 'POST') return handleBatch(request, ctx);
      if (request.method === 'GET') return handleSingle(request, ctx);
      return json({ ok: false, error: 'Only GET, POST and OPTIONS are allowed' }, 405);
    } catch (error) {
      return json({ ok: false, error: stringifyError(error) }, 500);
    }
  }
};

async function handleSingle(request, ctx) {
  const reqUrl = new URL(request.url);
  const targetRaw = reqUrl.searchParams.get('url');
  if (!targetRaw) return json({ ok: false, error: 'Missing ?url=' }, 400);

  const target = normalizeAllowedUrl(targetRaw);
  const result = await fetchTargetText(target, request, ctx);
  const headers = responseHeaders(result.contentType || 'text/plain;charset=utf-8');
  headers.set('Cache-Control', result.cached ? 'public, max-age=300' : 'no-store');
  headers.set('X-TM-Scout-Cache', result.cached ? 'HIT' : 'MISS');

  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers
  });
}

async function handleBatch(request, ctx) {
  let payload = null;
  try {
    payload = await request.json();
  } catch (_error) {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const rawItems = Array.isArray(payload && payload.items)
    ? payload.items
    : Array.isArray(payload && payload.urls)
      ? payload.urls.map((url) => ({ url, kind: payload.kind || 'text' }))
      : [];

  const capped = rawItems.slice(0, MAX_BATCH).map((item) => ({
    url: typeof item === 'string' ? item : item && item.url,
    kind: item && item.kind === 'json' ? 'json' : 'text'
  }));

  if (!capped.length) return json({ ok: false, error: 'Missing items[] or urls[]' }, 400);

  const normalizedItems = capped.map((item) => {
    try {
      const target = normalizeAllowedUrl(item.url);
      return {
        ok: true,
        key: `${item.kind}::${target.toString()}`,
        url: target.toString(),
        target,
        kind: item.kind
      };
    } catch (error) {
      return {
        ok: false,
        key: `error::${String(item.url || '')}`,
        url: String(item.url || ''),
        kind: item.kind,
        error: stringifyError(error)
      };
    }
  });

  const uniqueMap = new Map();
  normalizedItems.forEach((item) => {
    if (item.ok && !uniqueMap.has(item.key)) uniqueMap.set(item.key, item);
  });

  const fetchedByKey = new Map();
  await mapLimit(Array.from(uniqueMap.values()), UPSTREAM_CONCURRENCY, async (item) => {
    try {
      const fetched = await fetchTargetText(item.target, request, ctx);
      fetchedByKey.set(item.key, {
        url: item.url,
        kind: item.kind,
        ok: fetched.status >= 200 && fetched.status < 300,
        status: fetched.status,
        statusText: fetched.statusText,
        cached: Boolean(fetched.cached),
        contentType: fetched.contentType || '',
        body: fetched.body
      });
    } catch (error) {
      fetchedByKey.set(item.key, {
        url: item.url,
        kind: item.kind,
        ok: false,
        status: 0,
        cached: false,
        error: stringifyError(error),
        body: ''
      });
    }
  });

  const results = normalizedItems.map((item) => {
    if (!item.ok) {
      return {
        url: item.url,
        kind: item.kind,
        ok: false,
        status: 0,
        cached: false,
        error: item.error,
        body: ''
      };
    }
    return fetchedByKey.get(item.key) || {
      url: item.url,
      kind: item.kind,
      ok: false,
      status: 0,
      cached: false,
      error: 'Missing batch result',
      body: ''
    };
  });

  const cacheHits = results.filter((item) => item && item.cached).length;
  return json({
    ok: true,
    count: results.length,
    uniqueCount: uniqueMap.size,
    cacheHits,
    maxBatch: MAX_BATCH,
    results
  }, 200);
}

function normalizeAllowedUrl(raw) {
  let target;
  try {
    target = new URL(String(raw || ''));
  } catch (_error) {
    throw new Error('Invalid target URL');
  }

  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Invalid protocol');
  if (!ALLOWED_HOSTS.has(target.hostname)) throw new Error(`Host not allowed: ${target.hostname}`);
  target.hash = '';

  // Same Transfermarkt page can arrive with the query params in different order.
  // Canonicalizing here improves Cloudflare cache hits and batch dedupe.
  const entries = [];
  target.searchParams.forEach((value, key) => {
    if (/^(utm_|fbclid$|gclid$|ref$|from$)/i.test(String(key || ''))) return;
    entries.push([String(key), String(value)]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  target.search = '';
  entries.forEach(([key, value]) => target.searchParams.append(key, value));
  return target;
}

async function fetchTargetText(target, request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`https://tm-scout-v2-cache.local/proxy?url=${encodeURIComponent(target.toString())}`, {
    method: 'GET'
  });

  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.text();
    return {
      status: cached.status,
      statusText: cached.statusText,
      contentType: cached.headers.get('Content-Type') || '',
      body,
      cached: true
    };
  }

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: {
      'Accept': request.headers.get('Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.transfermarkt.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; TMScoutV2/1.0)',
      'X-Requested-With': request.headers.get('X-Requested-With') || 'XMLHttpRequest'
    }
  });

  const body = await upstream.text();
  const contentType = upstream.headers.get('Content-Type') || 'text/plain;charset=utf-8';

  if (upstream.status >= 200 && upstream.status < 300 && body.length <= MAX_CACHEABLE_BODY_CHARS) {
    const cachedResponse = new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`
      }
    });
    ctx.waitUntil(cache.put(cacheKey, cachedResponse));
  }

  return {
    status: upstream.status,
    statusText: upstream.statusText,
    contentType,
    body,
    cached: false
  };
}

function responseHeaders(contentType) {
  const headers = new Headers(CORS);
  headers.set('Content-Type', contentType || 'text/plain;charset=utf-8');
  headers.delete('content-security-policy');
  headers.delete('content-security-policy-report-only');
  headers.delete('x-frame-options');
  return headers;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function mapLimit(items, limit, iterator) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await iterator(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function stringifyError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}
