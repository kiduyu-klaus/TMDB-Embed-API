// Shared client for the two stream backends behind the vidnest.fun embed
// (one of the players hurawatch.cz iframes). vidnest serves a dozen backends
// from https://new.vidnest.fun/<backend>/{movie|tv}/..., and every one of them
// answers {"data": "<blob>", "encrypted": true}. The "encryption" is just
// base64 over a shuffled alphabet, which we reverse here.
//
// Two backends are exposed as providers:
//   - "yflix"      -> providers/catflix.js
//   - "superstream" -> providers/superstream.js
const fetch = globalThis.fetch || require('node-fetch');

const API_BASE = 'https://new.vidnest.fun';
const CIPHER_ALPHABET = 'RB0fpH8ZEyVLkv7c2i6MAJ5u3IKFDxlS1NTsnGaqmXYdUrtzjwObCgQP94hoeW+/=';
const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const CIPHER_TO_STD = new Map([...CIPHER_ALPHABET].map((ch, i) => [ch, STD_ALPHABET[i]]));

const REQUEST_HEADERS = {
  'Referer': 'https://vidnest.fun/',
  'Origin': 'https://vidnest.fun',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

// new.vidnest.fun sits behind a Cloudflare rule that hard-blocks datacenter
// IPs (403 for DigitalOcean and friends) while the stream CDN it points at is
// open. Requests relayed through a Cloudflare Worker egress from Cloudflare's
// network and pass, so a blocked direct call is retried once through the relay.
// Override with CATFLIX_RELAY (a prefix the URL-encoded target is appended to),
// or set it to "off" to disable the fallback entirely.
function relayPrefix() {
  const configured = process.env.CATFLIX_RELAY;
  if (configured === 'off') return '';
  return configured || 'https://fetch.streaming-1.workers.dev/fetch?url=';
}

function decodeVidnestCipher(blob) {
  let std = '';
  for (const ch of blob) std += CIPHER_TO_STD.get(ch) ?? ch;
  while (std.length % 4) std += '=';
  return Buffer.from(std, 'base64').toString('utf8');
}

async function fetchJSON(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`vidnest API returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Manifest URLs handed out here are stable per title, and the API rate-limits
// per source IP, so successful lookups (including "nothing for this title") are
// memoised briefly.
const LOOKUP_TTL_MS = 30 * 60 * 1000;
const lookupCache = new Map();
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of lookupCache) {
    if (now - entry.at >= LOOKUP_TTL_MS) lookupCache.delete(key);
  }
}, 60 * 1000);
if (typeof sweep.unref === 'function') sweep.unref();

function titlePath(backend, type, tmdbId, season, episode) {
  return type === 'tv'
    ? `/${backend}/tv/${tmdbId}/${season}/${episode}`
    : `/${backend}/movie/${tmdbId}`;
}

async function lookupPayload(path, timeoutMs) {
  const apiUrl = `${API_BASE}${path}`;
  let json;
  try {
    json = await fetchJSON(apiUrl, timeoutMs);
  } catch (directErr) {
    const prefix = relayPrefix();
    if (!prefix) throw directErr;
    // A 404 means the title genuinely is not there; anything else (WAF 403,
    // reset, timeout) is worth one retry through the relay.
    if (directErr.status === 404) throw directErr;
    try {
      json = await fetchJSON(`${prefix}${encodeURIComponent(apiUrl)}`, timeoutMs);
    } catch (relayErr) {
      throw new Error(`direct: ${directErr.message}; relay: ${relayErr.message}`);
    }
  }

  let payload = json;
  if (json && json.encrypted) {
    if (typeof json.data !== 'string') throw new Error('vidnest response missing data');
    const decoded = decodeVidnestCipher(json.data);
    try {
      payload = JSON.parse(decoded);
    } catch {
      payload = { url: decoded };
    }
  }

  // Errors arrive inside the same envelope, e.g.
  // {"error":"IP blocked for excessive rate limiting. Try again in 7m49s."}
  // Those are transient, not "no stream for this title", so surface a throw.
  if (payload && typeof payload === 'object' && payload.error) {
    const err = new Error(`vidnest API error: ${payload.error}`);
    err.status = /rate limit/i.test(payload.error) ? 429 : 502;
    throw err;
  }
  return payload;
}

// Decoded payload for one backend/title, memoised. Network/parse errors throw.
async function fetchVidnestPayload(backend, type, tmdbId, season, episode, timeoutMs) {
  const path = titlePath(backend, type, tmdbId, season, episode);
  const cached = lookupCache.get(path);
  if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) return cached.value;
  const value = await lookupPayload(path, timeoutMs);
  lookupCache.set(path, { at: Date.now(), value });
  return value;
}

module.exports = {
  API_BASE,
  REQUEST_HEADERS,
  decodeVidnestCipher,
  fetchVidnestPayload
};
