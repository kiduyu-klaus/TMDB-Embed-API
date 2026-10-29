// Cloudflare-bypass fetch wrapper using got-scraping.
// CommonJS-compatible: dynamically imports the ESM-only got-scraping package.
let _gsPromise = null;
async function getGotScraping() {
  if (!_gsPromise) {
    _gsPromise = import('got-scraping').then(m => m.gotScraping);
  }
  return _gsPromise;
}

const CF_DOMAINS = ['vidrock.net', 'vidrock.to'];

function needsCloudflareBypass(url) {
  try {
    const u = new URL(url);
    return CF_DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
  } catch { return false; }
}

// Build a Fetch API-compatible Response, preserving raw headers as a plain object.
function makeResponse(statusCode, statusMessage, headers, body) {
  const headerMap = new Map();
  const headerObj = {};
  Object.entries(headers || {}).forEach(([k, v]) => {
    if (k.startsWith(':')) return; // skip HTTP/2 pseudo-headers
    headerMap.set(k.toLowerCase(), v);
    headerObj[k.toLowerCase()] = v;
  });
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    statusText: statusMessage || '',
    headers: {
      get: (k) => headerMap.get((k || '').toLowerCase()) ?? null,
      has: (k) => headerMap.has((k || '').toLowerCase()),
      raw: () => headerObj,
      getSetCookie: () => {
        const sc = headerObj['set-cookie'];
        return sc ? [].concat(sc) : [];
      },
    },
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => {
      const buf = Buffer.from(body);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

async function gsFetch(url, options = {}) {
  const { method = 'GET', headers = {}, body } = options;
  const cleanHeaders = { ...headers };
  delete cleanHeaders['host'];
  delete cleanHeaders['content-length'];

  // Non-protected hosts: try native fetch first, but fall back on bot-block statuses.
  if (!needsCloudflareBypass(url)) {
    try {
      const res = await fetch(url, options);
      if (res.status !== 403 && res.status !== 503 && res.status !== 522) return res;
    } catch { /* fall through to got-scraping */ }
  }

  const gotScraping = await getGotScraping();
  try {
    const res = await gotScraping({
      url,
      method,
      headers: cleanHeaders,
      body,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        locales: ['en-US'],
      },
      timeout: { request: 60000 },
      throwHttpErrors: false,
      retry: { limit: 1 },
    });
    return makeResponse(res.statusCode, res.statusMessage, res.headers, res.body);
  } catch {
    try {
      return await fetch(url, options);
    } catch {
      return makeResponse(0, 'Network Error', {}, '');
    }
  }
}

module.exports = { gsFetch, needsCloudflareBypass };
