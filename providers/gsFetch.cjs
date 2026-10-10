// Cloudflare-bypass fetch wrapper using got-scraping.
// Compatible with CommonJS via dynamic import of the ESM-only got-scraping package.
let _gsPromise = null;
async function getGotScraping() {
  if (!_gsPromise) {
    _gsPromise = import('got-scraping').then(m => m.gotScraping);
  }
  return _gsPromise;
}

const CF_DOMAINS = ['flixcloud.cc', 'reanime.to', 'reanime.cz'];

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
      raw: () => headerObj,                  // expose raw header object
      getSetCookie: () => {
        const sc = headerObj['set-cookie'];
        return sc ? [].concat(sc) : [];
      },
    },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

async function gsFetch(url, options = {}) {
  if (!needsCloudflareBypass(url)) {
    return fetch(url, options);
  }
  const gotScraping = await getGotScraping();
  const { method = 'GET', headers = {}, body } = options;
  const cleanHeaders = { ...headers };
  delete cleanHeaders['host'];
  delete cleanHeaders['content-length'];
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
  } catch (e) {
    return fetch(url, options);
  }
}

module.exports = { gsFetch, needsCloudflareBypass };