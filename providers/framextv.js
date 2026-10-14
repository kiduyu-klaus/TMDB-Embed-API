// src/nuvio/framextv.cjs
// FrameX TV — movies, TV series, anime (sub+dub) with HLS streams up to 4K
//
// Uses the FrameX API at https://api.framextv.tech/api/stream
//
// Flow:
//   1. Resolve TMDB ID → name/year (done by source wrapper)
//   2. Call API: GET /api/stream?id={tmdbId}&type={movie|tv}&season={s}&episode={e}
//      → Returns { provider, sources: [{url, quality, type, server, headers}] }
//   3. Sources include 480p, 720p, 1080p, 2160p HLS streams
//   4. Anime: GET /api/stream?id={anilistId}&type=anime&season={s}&episode={e}
//      (Anime uses AniList IDs — resolved via AniList GraphQL API)
//
// All streams are HLS (m3u8). Some require Referer header.
// The source wrapper handles metadata enrichment + Referer routing.

'use strict';
const { fetch } = require('../utils/providerFetch');
const { normalizeStreams } = require('../utils/streamResponse');

const API_BASE = 'https://api.framextv.tech';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PROVIDERS = ['barbarian', 'goblin', 'wizard', 'archer', 'pekka', 'witch', 'giant', 'lavahound', 'electro_wizard', 'hog_rider', 'headhunter', 'valkyrie'];

function playbackSource(src, sharedHeaders = {}) {
  let url = new URL(src.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid media URL');
  const headers = { 'User-Agent': UA };
  function merge(values) {
    for (const [name, value] of Object.entries(values || {})) {
      if (typeof value !== 'string' || /[\r\n]/.test(name + value)) continue;
      const existing = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
      if (existing) delete headers[existing];
      headers[name] = value;
    }
  }
  // FrameX embeds the upstream playback headers in its proxy query, even
  // when sources[].headers is absent. Native players can use the CDN directly.
  if (url.origin === API_BASE && url.pathname === '/api/proxy') {
    const upstream = new URL(url.searchParams.get('url'));
    if (!['http:', 'https:'].includes(upstream.protocol)) throw new Error('Invalid upstream URL');
    merge({ Referer: url.searchParams.get('referer'), Origin: url.searchParams.get('origin') });
    url = upstream;
  }
  merge(sharedHeaders);
  merge(src.headers);
  return { url: url.href, headers };
}

// got-scraping loader
let _gs = null;
async function getGs() {
  if (_gs !== null) return _gs;
  try { _gs = (await import('got-scraping')).gotScraping; }
  catch (e) { _gs = false; }
  return _gs;
}

async function fetchJson(url, timeout = 30000) {
  const gs = await getGs();
  if (gs) {
    const res = await gs.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      timeout: { request: timeout },
      throwHttpErrors: false,
      http2: false,
    });
    if (res.statusCode !== 200) return null;
    try { return JSON.parse(res.body); } catch { return null; }
  }
  // Fallback: plain fetch
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Look up AniList ID via GraphQL (for anime)
async function getAniListId(title) {
  const query = 'query($search: String) { Media(search: $search, type: ANIME, sort: SEARCH_MATCH) { id title { romaji english } } }';
  const gs = await getGs();
  if (!gs) return null;
  try {
    const res = await gs.post('https://graphql.anilist.co', {
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query, variables: { search: title } }),
      timeout: { request: 30000 },
      throwHttpErrors: false,
      http2: false,
    });
    if (res.statusCode !== 200) return null;
    const data = JSON.parse(res.body);
    const media = data?.data?.Media;
    if (!media?.id) return null;
    return { id: media.id, romaji: media.title?.romaji || '', english: media.title?.english || '' };
  } catch { return null; }
}

// Check which providers are available for a given content
async function checkProviders(id, type, season, episode) {
  const available = [];
  const results = await Promise.allSettled(PROVIDERS.map(async provider => {
    const params = new URLSearchParams({ id: String(id), type, provider });
    if (season) { params.set('season', String(season)); params.set('episode', String(episode || 1)); }
    const data = await fetchJson(`${API_BASE}/api/stream/check?${params}`, 30000);
    return data && data.available ? provider : null;
  }));
  results.forEach(result => {
    if (result.status === 'fulfilled' && result.value) available.push(result.value);
  });
  return available;
}

async function getStreams(tmdbId, type, season, episode) {
  // FrameX API only supports 'movie' and 'tv' types.
  // Anime is handled as type=tv (anime IS TV on TMDB).
  // The API resolves anime by TMDB TV ID directly — no AniList mapping needed.
  const isTV = type === 'tv' || type === 'series' || type === 'anime';
  const apiType = isTV ? 'tv' : 'movie';

  console.log(`[FrameX] Request: tmdb=${tmdbId} type=${apiType} S${season || '?'}E${episode || '?'}`);

  // Build API URL
  const params = new URLSearchParams({ id: String(tmdbId), type: apiType });
  if (isTV && season) {
    params.set('season', String(season));
    params.set('episode', String(episode || 1));
  }

  // Fetch streams from API
  const apiUrl = `${API_BASE}/api/stream?${params}`;
  console.log(`[FrameX] Fetching: ${apiUrl}`);

  const [defaultData, availableProviders] = await Promise.all([
    fetchJson(apiUrl, 30000),
    checkProviders(tmdbId, apiType, isTV ? season : null, isTV ? episode : null),
  ]);
  const providerResults = await Promise.allSettled(availableProviders.map(async provider => {
    const providerParams = new URLSearchParams(params);
    providerParams.set('provider', provider);
    return { provider, data: await fetchJson(`${API_BASE}/api/stream?${providerParams}`, 30000) };
  }));
  const payloads = [];
  if (defaultData && defaultData.success && Array.isArray(defaultData.sources)) payloads.push(defaultData);
  providerResults.forEach(result => {
    if (result.status === 'fulfilled' && result.value.data && result.value.data.success && Array.isArray(result.value.data.sources)) {
      payloads.push(result.value.data);
    } else if (result.status === 'fulfilled') {
      const reason = result.value.data && result.value.data.error || 'no playable sources returned';
      console.warn(`[FrameX] Provider ${result.value.provider} returned no streams: ${reason}`);
    } else {
      console.warn(`[FrameX] Provider request failed: ${result.reason && result.reason.message || result.reason}`);
    }
  });
  console.log(`[FrameX] Available providers: ${availableProviders.join(', ') || 'none'}; payloads: ${payloads.length}`);
  if (!payloads.length) {
    console.log('[FrameX] No streams from default or available providers');
    return [];
  }

  // Convert API response to Nuvio stream format
  const streams = [];
  const seenUrls = new Set();

  for (const data of payloads) {
    console.log(`[FrameX] Provider: ${data.provider || 'unknown'} | Sources: ${data.sources.length}`);
    for (const src of data.sources) {
      let playback;
      try { playback = playbackSource(src, data.headers); }
      catch { console.warn('[FrameX] Skipping invalid source URL'); continue; }
      if (seenUrls.has(playback.url)) continue;
      seenUrls.add(playback.url);

      const quality = src.quality || 'Unknown';
      const server = src.server || data.provider || 'FrameX';
      const streamType = src.type || 'hls';
      const headers = playback.headers;
      console.log('[FrameX] Playback source', { host: new URL(playback.url).hostname,
        unwrapped: playback.url !== src.url, headerNames: Object.keys(headers) });
      const category = src.category || '';

      let titleLine = `TMDB ${tmdbId}`;
      if (isTV) {
        titleLine += ` S${String(season || 1).padStart(2, '0')}E${String(episode || 1).padStart(2, '0')}`;
      }
      titleLine += ` ${quality} ${server}`;
      if (category) titleLine += ` [${category}]`;

      streams.push({
        name: `FrameX - ${quality} ${server}${category ? ' ' + category : ''}`,
        title: titleLine,
        url: playback.url,
        quality: quality,
        type: streamType,
        provider: 'framextv',
        headers: headers,
        subtitles: src.subtitles || data.subtitles || [],
        audioTracks: src.audioTracks || [],
        behaviorHints: {
          bingeGroup: `framextv-${quality}`,
        },
      });
    }
  }

  console.log(`[FrameX] Returning ${streams.length} stream(s)`);
  return normalizeStreams(streams, 'framextv');
}

module.exports = { getStreams, playbackSource };
