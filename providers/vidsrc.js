'use strict';

const { createHash } = require('node:crypto');

const VIDSRC_BASE = 'https://vidsrc.sh';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 25000;
const TOKEN_BACKOFF_MS = [0, 2000, 4000, 8000, 16000, 30000];
const MASTER_RETRIES = 2;
const MASTER_RETRY_DELAY_MS = 1500;
const wasmModuleCache = new Map();

class VidsrcError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VidsrcError';
  }
}

function describeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'remote endpoint';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(url, { referer, accept = '*/*', timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: accept,
  };
  if (referer) headers.Referer = referer;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      text: body.toString('utf8'),
      body,
    };
  } catch (error) {
    const reason = error && error.name === 'AbortError' ? 'request timed out' : 'request failed';
    throw new VidsrcError(`${reason}: ${describeUrl(url)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function requestText(url, options = {}) {
  const response = await request(url, options);
  if (response.status !== 200) {
    throw new VidsrcError(`${describeUrl(url)} returned HTTP ${response.status}`);
  }
  return response.text;
}

async function requestJson(url, options = {}) {
  const response = await request(url, { ...options, accept: 'application/json' });
  if (response.status !== 200) {
    throw new VidsrcError(`${describeUrl(url)} returned HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.text);
  } catch {
    throw new VidsrcError(`${describeUrl(url)} returned invalid JSON`);
  }
}

function extractJsonObject(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) throw new VidsrcError(`${marker} was not present in the player response`);
  const start = text.indexOf('{', markerIndex + marker.length);
  if (start < 0) throw new VidsrcError(`${marker} was not followed by a JSON object`);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          throw new VidsrcError(`${marker} JSON could not be parsed`);
        }
      }
    }
  }
  throw new VidsrcError(`${marker} JSON was incomplete`);
}

function buildEmbedUrl(tmdbId, mediaType, season, episode) {
  const path = mediaType === 'tv' && season != null && episode != null
    ? `/embed/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`
    : `/embed/${mediaType}/${encodeURIComponent(tmdbId)}`;
  return new URL(path, VIDSRC_BASE).href;
}

async function resolvePlayer(embedUrl) {
  const embedHtml = await requestText(embedUrl, { accept: 'text/html' });
  const apiMatch = embedHtml.match(/data-api="([^"]+)"/i);
  if (!apiMatch) throw new VidsrcError('Vidsrc embed did not provide a player endpoint');

  const gateUrl = new URL(apiMatch[1].replace(/&amp;/g, '&'), VIDSRC_BASE).href;
  const gate = await requestJson(gateUrl, { referer: embedUrl });
  if (!gate || typeof gate.src !== 'string' || !gate.src) {
    throw new VidsrcError('Vidsrc player endpoint did not return an embed URL');
  }

  const innerUrl = new URL(gate.src, embedUrl).href;
  const innerHtml = await requestText(innerUrl, { referer: embedUrl, accept: 'text/html' });
  const playerConfig = extractJsonObject(innerHtml, 'window.CFG');
  if (!playerConfig.playerUrl) throw new VidsrcError('Vidsrc embed configuration has no player URL');

  const playerUrl = new URL(playerConfig.playerUrl, innerUrl).href;
  const playerHtml = await requestText(playerUrl, { referer: innerUrl, accept: 'text/html' });
  const config = extractJsonObject(playerHtml, 'window.CONFIG');
  return { playerUrl, config };
}

function buildStreamApiUrl(config, mediaType, season, episode) {
  if (mediaType === 'tv') {
    if (!config.streamBase) throw new VidsrcError('Vidsrc player configuration has no TV stream endpoint');
    return `${config.streamBase}${config.streamBase.includes('?') ? '&' : '?'}season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}&stream_urls`;
  }
  if (!config.api) throw new VidsrcError('Vidsrc player configuration has no movie stream endpoint');
  return config.api;
}

async function resolveFirstEpisode(playerUrl, config) {
  if (!config.streamBase) throw new VidsrcError('Vidsrc player configuration has no TV stream endpoint');
  const response = await requestJson(config.streamBase, { referer: playerUrl });
  const episodes = response && response.data && response.data.eps;
  const seasons = Object.keys(episodes || {}).filter(value => /^\d+$/.test(value)).map(Number).sort((a, b) => a - b);
  if (!seasons.length) throw new VidsrcError('Vidsrc did not list any TV episodes');
  const season = seasons[0];
  const available = Array.isArray(episodes[String(season)]) ? episodes[String(season)] : [];
  const episode = available.filter(value => /^\d+$/.test(String(value))).map(Number).sort((a, b) => a - b)[0] || 1;
  return { season, episode };
}

async function fetchStreamPayload(playerUrl, apiUrl, apiToken) {
  const url = new URL(apiUrl);
  if (apiToken) url.searchParams.set('api_token', apiToken);
  const payload = await requestJson(url.href, { referer: playerUrl });
  const status = payload && (payload.status_code || payload.status);
  if (status != null && String(status) !== '200') {
    throw new VidsrcError(`Vidsrc stream API reported status ${String(status)}`);
  }
  return payload;
}

async function decryptStreamUrls(wasmBytes, encryptedBytes) {
  const digest = createHash('sha256').update(wasmBytes).digest('hex');
  let module = wasmModuleCache.get(digest);
  if (!module) {
    module = await WebAssembly.compile(wasmBytes);
    wasmModuleCache.set(digest, module);
    if (wasmModuleCache.size > 8) wasmModuleCache.delete(wasmModuleCache.keys().next().value);
  }

  const instance = await WebAssembly.instantiate(module, {});
  const { memory, alloc, decrypt } = instance.exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof alloc !== 'function' || typeof decrypt !== 'function') {
    throw new VidsrcError('Vidsrc decryptor did not expose the expected WebAssembly exports');
  }

  const pointer = alloc(encryptedBytes.length);
  if (!Number.isInteger(pointer) || pointer < 0 || pointer + encryptedBytes.length > memory.buffer.byteLength) {
    throw new VidsrcError('Vidsrc decryptor returned an invalid buffer pointer');
  }
  new Uint8Array(memory.buffer, pointer, encryptedBytes.length).set(encryptedBytes);
  const outputLength = decrypt(pointer, encryptedBytes.length);
  if (!Number.isInteger(outputLength) || outputLength < 0 || pointer + 12 + outputLength > memory.buffer.byteLength) {
    throw new VidsrcError('Vidsrc decryptor returned an invalid payload length');
  }
  return Buffer.from(memory.buffer, pointer + 12, outputLength).toString('utf8');
}

async function decodeStreamUrls(payload, referer) {
  const raw = payload && payload.data && payload.data.stream_urls;
  if (Array.isArray(raw)) return raw.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
  if (typeof raw !== 'string' || !raw.trim()) throw new VidsrcError('Vidsrc response did not contain stream URLs');

  const vs = payload.vs || {};
  let wasmBytes;
  if (vs.wasm_url) {
    const response = await request(vs.wasm_url, { referer, accept: '*/*' });
    if (response.status !== 200) throw new VidsrcError(`${describeUrl(vs.wasm_url)} returned HTTP ${response.status}`);
    wasmBytes = response.body;
  } else if (typeof vs.wasm === 'string') {
    wasmBytes = Buffer.from(vs.wasm, 'base64');
  } else {
    throw new VidsrcError('Vidsrc encrypted stream response did not include a decryptor');
  }

  const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const encrypted = Buffer.from(base64, 'base64');
  if (encrypted.length < 12) throw new VidsrcError('Vidsrc encrypted stream response was incomplete');
  const plaintext = await decryptStreamUrls(wasmBytes, encrypted);
  return plaintext.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}

function originOf(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function applyStreamToken(url, token) {
  if (!token) return url;
  if (url.includes('__TOKEN__')) return url.replaceAll('__TOKEN__', encodeURIComponent(token));
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('token')) return parsed.href;
    parsed.searchParams.set('token', token);
    return parsed.href;
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  }
}

async function mintToken(origin, referer) {
  let lastFailure = 'no token returned';
  for (const delay of TOKEN_BACKOFF_MS) {
    if (delay) await sleep(delay);
    const response = await request(`${origin}/generate.php`, { referer, accept: '*/*' });
    let token = '';
    if (response.status === 200) {
      const body = response.text.trim();
      if (body.startsWith('eyJ')) token = body;
      else if (body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.token === 'string') token = parsed.token;
        } catch {
          // Continue with a new attempt when the endpoint returns malformed JSON.
        }
      }
      if (token) return token;
      lastFailure = 'response did not contain a token';
    } else {
      lastFailure = `HTTP ${response.status}`;
    }
  }
  throw new VidsrcError(`could not obtain a playback token from ${origin}/generate.php (${lastFailure})`);
}

function parseMasterPlaylist(content, masterUrl) {
  const variants = [];
  let streamInfo = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      streamInfo = line;
      continue;
    }
    if (line.startsWith('#')) continue;

    const resolution = streamInfo && streamInfo.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidth = streamInfo && streamInfo.match(/BANDWIDTH=(\d+)/i);
    variants.push({
      url: new URL(line, masterUrl).href,
      width: resolution ? Number(resolution[1]) : null,
      height: resolution ? Number(resolution[2]) : null,
      bandwidth: bandwidth ? Number(bandwidth[1]) : null,
    });
    streamInfo = null;
  }
  variants.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0)
    || ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
  return variants;
}

function makeStreamName(origin) {
  try {
    return `Vidsrc ${new URL(origin).hostname}`;
  } catch {
    return 'Vidsrc';
  }
}

async function resolveStreams(tmdbId, mediaType, season, episode) {
  const embedUrl = buildEmbedUrl(tmdbId, mediaType, season, episode);
  const { playerUrl, config } = await resolvePlayer(embedUrl);
  let resolvedSeason = season;
  let resolvedEpisode = episode;

  if (mediaType === 'tv' && (resolvedSeason == null || resolvedEpisode == null)) {
    const first = await resolveFirstEpisode(playerUrl, config);
    resolvedSeason = first.season;
    resolvedEpisode = first.episode;
  }

  const apiUrl = buildStreamApiUrl(config, mediaType, resolvedSeason, resolvedEpisode);
  const payload = await fetchStreamPayload(playerUrl, apiUrl, String(config.apiToken || ''));
  const masters = await decodeStreamUrls(payload, playerUrl);
  if (!masters.length) throw new VidsrcError('Vidsrc did not return any playable sources');

  const playbackOrigin = originOf(playerUrl);
  const playbackReferer = playbackOrigin ? `${playbackOrigin}/` : playerUrl;
  const tokensByHost = new Map();
  const streams = [];

  for (const master of masters) {
    const origin = originOf(master);
    if (!origin) continue;
    try {
      if (!tokensByHost.has(origin)) tokensByHost.set(origin, await mintToken(origin, playbackReferer));
      const token = tokensByHost.get(origin);
      const masterUrl = applyStreamToken(master, token);
      let variants = [];
      for (let attempt = 0; attempt < MASTER_RETRIES; attempt += 1) {
        try {
          const response = await request(masterUrl, { referer: playbackReferer, accept: '*/*' });
          if (response.status === 200) {
            variants = parseMasterPlaylist(response.text, masterUrl).map(variant => ({
              ...variant,
              url: applyStreamToken(variant.url, token),
            }));
            break;
          }
        } catch {
          // Try the master once more; a mirror can be briefly unavailable.
        }
        if (attempt + 1 < MASTER_RETRIES) await sleep(MASTER_RETRY_DELAY_MS);
      }

      const best = variants[0];
      const url = best ? best.url : masterUrl;
      const quality = best && best.height ? `${best.height}p` : 'Auto';
      const name = makeStreamName(origin);
      streams.push({
        name,
        title: `${name} - ${quality}`,
        url,
        quality,
        provider: 'Vidsrc',
        headers: {
          Referer: playbackReferer,
          Origin: playbackOrigin || origin,
          'User-Agent': USER_AGENT,
        },
        format: 'hls',
        mimeType: 'application/vnd.apple.mpegurl',
        subtitles: [],
      });
    } catch (error) {
      // A failing mirror should not hide working alternatives. Do not log source URLs or tokens.
      console.warn(`[Vidsrc] Skipping an unavailable mirror (${origin}): ${error.message}`);
    }
  }

  if (!streams.length) throw new VidsrcError('Vidsrc sources were found, but no mirror could be prepared for playback');
  return streams;
}

async function getVidsrcStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  const id = String(tmdbId == null ? '' : tmdbId).trim();
  if (!/^\d+$/.test(id) || Number(id) <= 0) throw new TypeError('tmdbId must be a positive numeric TMDB ID');

  let media = String(mediaType || 'movie').trim().toLowerCase();
  if (!['movie', 'tv'].includes(media)) throw new TypeError("mediaType must be 'movie' or 'tv'");
  if ((season == null) !== (episode == null)) throw new TypeError('season and episode must be provided together');
  if (season != null && episode != null) media = 'tv';
  if (media === 'tv' && season != null && (!/^\d+$/.test(String(season)) || Number(season) < 0)) {
    throw new TypeError('season must be a non-negative integer');
  }
  if (media === 'tv' && episode != null && (!/^\d+$/.test(String(episode)) || Number(episode) <= 0)) {
    throw new TypeError('episode must be a positive integer');
  }
  return resolveStreams(id, media, season, episode);
}

module.exports = { getVidsrcStreams };
