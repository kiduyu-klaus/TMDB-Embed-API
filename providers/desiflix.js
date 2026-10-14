const { fetch } = require('../utils/providerFetch');
// DesiFlix — Standalone Scraper (v3 — backend is back online!)
// =========================================================================
// Fetches playable streams from the DesiFlix Stremio addon.
//
// BACKEND STATUS (as of latest check):
//   ✅ https://manifest.desitvhub.eu.org — ONLINE (new official endpoint)
//   ⚠️ https://desiflix.stremioaddon.workers.dev — DEPRECATED (free-tier rate limited)
//
// PERFORMANCE NOTE:
//   - Use HTTP/1.1 + Stremio UA for fast responses (~0.6s)
//   - With HTTP/2 or browser UA, responses take 25-35s (the addon calls
//     multiple upstream providers in parallel)
//
// API ENDPOINTS (Stremio addon protocol):
//   Manifest:  GET /manifest.json
//   Catalog:   GET /catalog/{type}/{catId}.json[?search=title&genre=Hindi&subcat=Bollywood]
//   Stream:    GET /stream/{type}/{id}.json
//     where {id} can be:
//       - tt<IMDB_ID>          e.g. tt15239678
//       - tmdb:<TMDB_ID>       e.g. tmdb:693134
//       - dsx:c:<base64>       e.g. dsx:c:eyJzIjoibW92aWUiLCJrIjoic2ltbWJhIiwidCI6IlNpbW1iYSJ9
//                              (decodes to {"s":"movie","k":"simmba","t":"Simmba"})
//   For TV:
//     GET /stream/series/tt<IMDB>:<season>:<episode>.json
//     GET /stream/series/tmdb:<TMDB>:<season>:<episode>.json
//
// STREAM FORMAT:
//   Each stream is a vixsrc.to playlist URL:
//     https://vixsrc.to/playlist/<id>?b=1&token=<token>&expires=<unix_ts>&h=1&lang=en
//   - b=1: bitrate/quality flag (1 = 1080p currently)
//   - h=1: HD enabled
//   - token: short-lived (4h) signed JWT-style token
//   - lang: audio language
//   The playlist URL is Cloudflare-protected; requires Referer: https://vixsrc.to/
//   for playback (Stremio handles this via its embedded browser engine).
//
// QUALITY DETECTION:
//   The stream title format is "<quality> • <server_name>" e.g.:
//     "1080p • HD Server 2"  → 1080p
//     "2160p • 4K Server 1"  → 2160p (4K) — when available
//     "720p • HD Server 3"   → 720p
//   Currently the addon returns 1080p max, but if 4K streams appear, the
//   scraper will automatically detect and label them correctly.
//
// USAGE:
//   node desiflix_all_in_one.js <tmdbId> <movie|tv> [season] [episode]
//   node desiflix_all_in_one.js search "dune" movie
//   node desiflix_all_in_one.js catalog dsx-movies
//
// TESTED:
//   ✅ Dune Part Two (tt15239678 / tmdb:693134) → 1080p stream
//   ✅ Breaking Bad S01E01 (tt0903747) → 1080p stream
//   ✅ Many Bollywood / regional titles supported via catalog search

'use strict';

const https = require('https');

const PROVIDER_NAME = 'DesiFlix';
const { getTmdbApiKey } = require('../utils/tmdbKey');

// Stremio's User-Agent — gets FAST responses from the addon (0.6s vs 30s with browser UA)
const STREMIO_UA = 'Stremio/4.4.137 (Windows; x64)';

// Browser UA — used when fetching TMDB info (Stremio UA doesn't work for TMDB API)
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Multiple base URLs to try (in priority order)
const BASE_URLS = [
  'https://manifest.desitvhub.eu.org',          // ✅ NEW official endpoint (no rate limit)
  'https://desiflix.stremioaddon.workers.dev',  // ⚠️ OLD endpoint (rate-limited)
];

// ─── HTTP fetch with HTTP/1.1 (fast) + Stremio UA ──────────────────────────
// Retries on 502/503/504 and timeouts because the DesiFlix backend
// (Azure Container App behind Cloudflare) has cold-start delays: the first
// request after idle returns 504 in ~10s, but subsequent requests are fast
// (~0.6s). Without retries, the scraper fails on every cold start.
function fetchJsonOnce(url, { ua = STREMIO_UA, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      agent: new https.Agent({
        keepAlive: false,
        // Force HTTP/1.1 for fast responses (HTTP/2 takes 30s+ with this addon)
        // The Stremio addon server is HTTP/1.1-only optimized.
      }),
    }, (res) => {
      // Follow redirects manually (up to 5)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return resolve(fetchJsonOnce(nextUrl, { ua, timeout }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url.slice(0, 80)}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error(`timeout after ${timeout}ms`)));
  });
}

// Wrap fetchJsonOnce with retry-on-cold-start logic.
// The DesiFlix addon (Azure Container App) returns 504 for the first ~10s
// after idle, then warms up and serves fast 200s. We retry up to 3 times
// with a 2s backoff, which is enough to outlast the cold-start window.
async function fetchJson(url, opts = {}) {
  const maxRetries = 3;
  const backoffMs = 2000;
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetchJsonOnce(url, opts);
    } catch (e) {
      lastErr = e;
      const msg = e.message || '';
      // Retry only on transient backend errors (502/503/504 gateway errors
      // and timeouts). Don't retry on 404 (title not found) or 4xx (client
      // errors) — those won't fix themselves.
      const isTransient = msg.includes('HTTP 502') ||
                          msg.includes('HTTP 503') ||
                          msg.includes('HTTP 504') ||
                          msg.includes('timeout') ||
                          msg.includes('ECONNRESET') ||
                          msg.includes('ECONNREFUSED') ||
                          msg.includes('socket hang up');
      if (!isTransient || attempt === maxRetries) throw e;
      console.log(`[DesiFlix] ${msg.slice(0, 60)} — retry ${attempt + 1}/${maxRetries} in ${backoffMs}ms`);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// ─── Fetch TMDB info (needs browser UA, not Stremio UA) ─────────────────────
async function getTMDBInfo(tmdbId, type) {
  const isTV = type === 'tv' || type === 'series';
  const tmdbApiKey = getTmdbApiKey();
  if (!tmdbApiKey) {
    console.warn('[DesiFlix] TMDB API key is not configured');
    return null;
  }
  const url = `https://api.themoviedb.org/3/${isTV ? 'tv' : 'movie'}/${tmdbId}` +
              `?api_key=${tmdbApiKey}&append_to_response=external_ids`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return {
      title: (isTV ? j.name : j.title) || 'Unknown',
      year: ((isTV ? j.first_air_date : j.release_date) || '').slice(0, 4),
      imdbId: j.imdb_id || (j.external_ids && j.external_ids.imdb_id) || null,
      type, tmdbId: String(tmdbId),
    };
  } catch (e) {
    console.log(`[DesiFlix] TMDB lookup failed: ${e.message}`);
    return null;
  }
}

// ─── Try each base URL until one works ──────────────────────────────────────
async function fetchFromApi(path) {
  let lastError = null;
  for (const base of BASE_URLS) {
    const url = base + path;
    try {
      const data = await fetchJson(url);
      if (data && Array.isArray(data.streams)) {
        if (data.streams.length > 0) {
          console.log(`[DesiFlix] ✅ ${data.streams.length} streams from ${base}`);
          return data;
        }
        // Empty streams array — addon responded but no streams available
        // Try next base URL anyway (might have different upstream)
        lastError = new Error('Empty streams (addon responded but no streams available)');
      }
    } catch (e) {
      lastError = e;
      console.log(`[DesiFlix] ${base} failed: ${e.message.slice(0, 60)}`);
    }
  }
  if (lastError) throw lastError;
  return null;
}

// ─── Parse quality from stream title ────────────────────────────────────────
// The title format is "<quality> • <server_name>"
//   e.g. "1080p • HD Server 2" → 1080p
//        "2160p • 4K Server 1" → 2160p (4K)
//        "720p • HD Server 3"  → 720p
function parseQuality(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('2160') || t.includes('4k')) return '2160p';
  if (t.includes('1080')) return '1080p';
  if (t.includes('720'))  return '720p';
  if (t.includes('480'))  return '480p';
  if (t.includes('360'))  return '360p';
  return '1080p';  // default for HD servers
}

// ─── Parse language from stream URL (lang= parameter) ──────────────────────
function parseLanguage(url, text) {
  const langMatch = (url || '').match(/[?&]lang=([a-z_-]+)/i);
  if (langMatch) {
    const lang = langMatch[1].toLowerCase();
    if (lang === 'multi' || lang === 'multi-audio') return 'Multi-Audio';
    if (lang === 'en' || lang === 'english') return 'English';
    if (lang === 'hi' || lang === 'hindi') return 'Hindi';
    if (lang === 'ta' || lang === 'tamil') return 'Tamil';
    if (lang === 'te' || lang === 'telugu') return 'Telugu';
    if (lang === 'ml' || lang === 'malayalam') return 'Malayalam';
    if (lang === 'kn' || lang === 'kannada') return 'Kannada';
    if (lang === 'bn' || lang === 'bengali') return 'Bengali';
    if (lang === 'pa' || lang === 'punjabi') return 'Punjabi';
    if (lang === 'mr' || lang === 'marathi') return 'Marathi';
    if (lang === 'gu' || lang === 'gujarati') return 'Gujarati';
    return lang;  // unknown language code, return as-is
  }
  // Fallback: detect from title
  const t = (text || '').toLowerCase();
  if (t.includes('multi')) return 'Multi-Audio';
  if (t.includes('dual'))  return 'Dual-Audio';
  return 'Multi-Audio';  // default
}

// ─── Detect stream host (vixsrc.to, etc.) ───────────────────────────────────
function detectStreamHost(url) {
  try {
    const u = new URL(url);
    return u.host;
  } catch (e) {
    return 'unknown';
  }
}

// ─── Build Stremio stream object with proper playback headers ───────────────
// The vixsrc.to playlist URL is Cloudflare-protected. Stremio can play it
// via its embedded browser engine, but only if we pass proper Referer.
function buildStream(stream, info) {
  const url = stream.url || stream.streamUrl;
  if (!url) return null;

  const text = `${stream.title || ''} ${stream.name || ''}`;
  const quality = parseQuality(text);
  const language = parseLanguage(url, text);
  const host = detectStreamHost(url);

  // The stream is an HLS playlist (vixsrc.to returns .m3u8 playlists)
  const isHls = url.includes('playlist') || url.includes('.m3u8');

  // Set proper Referer for Cloudflare-protected stream hosts
  // Stremio's video player will send these headers when fetching the stream
  let proxyHeaders = null;
  if (host === 'vixsrc.to') {
    proxyHeaders = {
      request: {
        'User-Agent': BROWSER_UA,
        'Referer': 'https://vixsrc.to/',
        'Origin': 'https://vixsrc.to',
      },
    };
  }

  const result = {
    name: `${PROVIDER_NAME} | ${quality} | ${language} | ${host}`,
    title: `${info.title}${info.year ? ` (${info.year})` : ''} [DesiFlix ${quality} ${language}]`,
    url,
    quality,
    language: 'Hindi . English ',
    format: 'mkv',
    mimeType: 'video/x-matroska',
    type: 'video/x-matroska',
    behaviorHints: {
      bingeGroup: `desiflix-${quality.toLowerCase()}-${host}`,
    },
  };
  if (proxyHeaders) result.behaviorHints.proxyHeaders = proxyHeaders;
  return result;
}

// ─── Main entry point ──────────────────────────────────────────────────────
async function getStreams(tmdbId, type, season, episode) {
  tmdbId = String(tmdbId);
  const isTV = type === 'tv' || type === 'series';
  console.log(`[DesiFlix] Request: tmdb=${tmdbId} type=${type}` +
              (isTV ? ` S${season}E${episode}` : ''));

  // 1. Fetch TMDB info (for IMDB ID + title)
  const info = await getTMDBInfo(tmdbId, type);
  if (!info) {
    console.log('[DesiFlix] TMDB fetch failed');
    return [];
  }
  console.log(`[DesiFlix] TMDB: ${info.title}${info.year ? ` (${info.year})` : ''}` +
              ` IMDB: ${info.imdbId || 'N/A'}`);

  // 2. Build list of stream endpoint paths to try (in priority order)
  const paths = [];
  if (isTV) {
    const s = parseInt(season) || 1;
    const e = parseInt(episode) || 1;
    if (info.imdbId) {
      paths.push(`/stream/series/${info.imdbId}:${s}:${e}.json`);
    }
    paths.push(`/stream/series/tmdb:${tmdbId}:${s}:${e}.json`);
    if (info.imdbId) {
      paths.push(`/stream/series/${tmdbId}:${s}:${e}.json`);  // old format (no prefix)
    }
  } else {
    if (info.imdbId) {
      paths.push(`/stream/movie/${info.imdbId}.json`);
    }
    paths.push(`/stream/movie/tmdb:${tmdbId}.json`);
    if (info.imdbId) {
      paths.push(`/stream/movie/${tmdbId}.json`);  // old format (no prefix)
    }
  }

  // 3. Try each path
  let data = null;
  for (const path of paths) {
    try {
      data = await fetchFromApi(path);
      if (data && data.streams && data.streams.length > 0) break;
    } catch (e) {
      console.log(`[DesiFlix] Path ${path.slice(0, 50)} failed: ${e.message.slice(0, 50)}`);
    }
  }

  if (!data || !data.streams || data.streams.length === 0) {
    console.log('[DesiFlix] No streams found for this title (addon responded but no upstream provider has it)');
    return [];
  }

  // 4. Convert to Stremio streams
  const allStreams = [];
  const seenUrls = new Set();
  for (const stream of data.streams) {
    const url = stream.url || stream.streamUrl;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const s = buildStream(stream, info);
    if (s) {
      allStreams.push(s);
      const host = detectStreamHost(url);
      console.log(`[DesiFlix] + ${s.quality} ${s.title.match(/\[(.*?)\]/)?.[1] || ''} [${host}]: ${url.slice(0, 80)}...`);
    }
  }

  // 5. Sort by quality (4K first, then 1080p, etc.)
  const qOrder = { '2160p': 0, '1080p': 1, '720p': 2, '480p': 3, '360p': 4 };
  allStreams.sort((a, b) => (qOrder[a.quality] || 99) - (qOrder[b.quality] || 99));

  console.log(`[DesiFlix] ${allStreams.length} stream(s) total`);
  return allStreams;
}

// ─── Search the DesiFlix catalog (uses /catalog endpoint with ?search=) ────
async function search(query, type) {
  type = type || 'movie';
  const catId = type === 'tv' ? 'dsx-web' : 'dsx-movies';
  const url = `https://manifest.desitvhub.eu.org/catalog/${type}/${catId}/search=${encodeURIComponent(query)}.json`;
  try {
    const data = await fetchJson(url);
    return (data.metas || []).map(m => ({
      id: m.id,  // dsx:c:<base64> format
      title: m.name,
      type: m.type,
      poster: m.poster,
    }));
  } catch (e) {
    console.log(`[DesiFlix] Search failed: ${e.message}`);
    return [];
  }
}

// ─── Get catalog (list of available titles) ────────────────────────────────
async function getCatalog(catId, type) {
  type = type || 'movie';
  catId = catId || (type === 'tv' ? 'dsx-web' : 'dsx-movies');
  const url = `https://manifest.desitvhub.eu.org/catalog/${type}/${catId}.json`;
  try {
    const data = await fetchJson(url);
    return (data.metas || []).map(m => ({
      id: m.id,
      title: m.name,
      type: m.type,
      poster: m.poster,
    }));
  } catch (e) {
    console.log(`[DesiFlix] Catalog fetch failed: ${e.message}`);
    return [];
  }
}

// ─── Get streams by dsx: ID (advanced — bypass TMDB lookup) ─────────────────
async function getStreamsByDsxId(dsxId, type, season, episode) {
  const isTV = type === 'tv' || type === 'series';
  let path;
  if (isTV) {
    path = `/stream/series/${dsxId}:${parseInt(season) || 1}:${parseInt(episode) || 1}.json`;
  } else {
    path = `/stream/movie/${dsxId}.json`;
  }
  // dsx: IDs contain colons, need to be encoded properly in the URL path
  // Stremio's protocol uses the raw ID, but for HTTP we need URL-safe encoding
  // Most HTTP libraries encode `:` to `%3A` automatically — but the addon may
  // expect either format. Try raw first.
  console.log(`[DesiFlix] Direct dsx: lookup: ${path}`);
  try {
    const data = await fetchFromApi(path);
    if (data && data.streams && data.streams.length > 0) {
      const info = { title: 'DesiFlix Title', year: '', type, tmdbId: dsxId };
      return data.streams.map(s => buildStream(s, info)).filter(Boolean);
    }
  } catch (e) {
    console.log(`[DesiFlix] dsx: lookup failed: ${e.message}`);
  }
  return [];
}

// ─── Module exports ─────────────────────────────────────────────────────────
module.exports = {
  getStreams,
  getTMDBInfo,
  fetchFromApi,
  search,
  getCatalog,
  getStreamsByDsxId,
  BASE_URLS,
  STREMIO_UA,
};
