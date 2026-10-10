// OpenSubtitles.com fallback for streams that arrive without subtitles.
//
// Runs only after Wyzie returns nothing. Ranking happens on the search response;
// each /download call costs one unit of the daily API quota and returns a
// short-lived link, so resolved links are cached separately for LINK_TTL_MS and
// at most MAX_TRACKS downloads are performed per title.
//
// NOTE: the /download endpoint requires BOTH an Api-Key and an Authorization
// bearer token obtained by logging in at opensubtitles.com. With only an API key
// the gateway answers 403 {"error":"Blocked (kong-user-agent-block)"}, so search
// works without a token but resolving a playable link does not.

const axios = require('axios');

const SEARCH_URL = 'https://api.opensubtitles.com/api/v1/subtitles';
const DOWNLOAD_URL = 'https://api.opensubtitles.com/api/v1/download';

// OpenSubtitles rejects blank/generic User-Agents, so use a descriptive one.
const DEFAULT_USER_AGENT = 'TMDBEmbedApi:v1.0.0 (https://github.com/Inside4ndroid)';

const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 5 * 60 * 60 * 1000;
// A failed resolution is retried sooner than a successful one, so a
// temporary outage (or a missing token) does not disable the source for a day.
const FAILURE_TTL_MS = 15 * 60 * 1000;
const MAX_TRACKS = 1;
const TIMEOUT_MS = 10_000;
const MAX_CACHE_ENTRIES = 500;

let warnedAboutMissingToken = false;

function isTv(context) {
  return context.type === 'series' || context.type === 'tv';
}

function cacheKey(context) {
  const id = String(context.tmdbId == null ? '' : context.tmdbId).trim();
  if (!/^\d+$/.test(id)) return null;
  if (!isTv(context)) return `${id}:movie`;
  const season = Number(context.season);
  const episode = Number(context.episode);
  if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) return null;
  return `${id}:tv:${season}:${episode}`;
}

function buildHeaders(apiKey, { withAuth = false } = {}) {
  const headers = {
    'User-Agent': process.env.OPEN_SUBTITLES_USER_AGENT || DEFAULT_USER_AGENT,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Api-Key': apiKey
  };
  if (withAuth) {
    const token = process.env.OPEN_SUBTITLES_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function toTrack(entry) {
  const attributes = (entry && entry.attributes) || {};
  // /download expects a file id; subtitle_id is only a last resort.
  const fileId = attributes.files?.[0]?.file_id ?? attributes.file_id ?? attributes.subtitle_id;
  if (fileId == null) return null;
  const language = String(attributes.language || 'und').toLowerCase();
  const release = String(attributes.release || '').trim();
  return {
    fileId: Number(fileId),
    language,
    label: [language.toUpperCase(), attributes.hearing_impaired ? 'SDH' : '', release]
      .filter(Boolean).join(' - '),
    // Ranking inputs
    ai: attributes.ai_translated === true || attributes.machine_translated === true,
    hearingImpaired: attributes.hearing_impaired === true,
    downloads: Number(attributes.download_count) || 0
  };
}

// Human-authored, non-SDH English tracks first; then most downloaded.
function compareTracks(a, b) {
  if (a.ai !== b.ai) return a.ai ? 1 : -1;
  const aEnglish = a.language === 'en' ? 0 : 1;
  const bEnglish = b.language === 'en' ? 0 : 1;
  if (aEnglish !== bEnglish) return aEnglish - bEnglish;
  if (a.hearingImpaired !== b.hearingImpaired) return a.hearingImpaired ? 1 : -1;
  return b.downloads - a.downloads;
}

function createOpenSubtitles({
  request = axios,
  getKey = () => process.env.OPEN_SUBTITLES_API_KEY,
  maxTracks = MAX_TRACKS
} = {}) {
  const searchCache = new Map(); // key -> { expires, promise }
  const linkCache = new Map();   // fileId -> { expires, promise }

  async function search(context, apiKey) {
    const params = { tmdb_id: String(context.tmdbId) };
    if (isTv(context)) {
      params.season_number = Number(context.season);
      params.episode_number = Number(context.episode);
    }
    const response = await request.get(SEARCH_URL, { params, headers: buildHeaders(apiKey), timeout: TIMEOUT_MS });
    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    return rows.map(toTrack).filter(Boolean).sort(compareTracks);
  }

  async function resolveLink(track, apiKey) {
    const cached = linkCache.get(track.fileId);
    if (cached) {
      if (cached.expires > Date.now()) return cached.promise;
      linkCache.delete(track.fileId);
    }
    const promise = (async () => {
      try {
        const response = await request.post(DOWNLOAD_URL, {
          headers: buildHeaders(apiKey, { withAuth: true }),
          data: { file_id: track.fileId },
          timeout: TIMEOUT_MS
        });
        const link = response.data?.link;
        if (typeof link !== 'string' || !/^https?:\/\//i.test(link)) return null;
        const fileName = String(response.data?.file_name || '').toLowerCase();
        return {
          url: link,
          mimeType: fileName.endsWith('.vtt') ? 'text/vtt' : 'application/x-subrip',
          language: track.language,
          label: track.label,
          name: track.label,
          headers: {}
        };
      } catch (error) {
        // Error messages/urls can carry the credential, so never echo them.
        console.warn(`[subtitles] OpenSubtitles download failed (HTTP ${error.response?.status || 'unavailable'})`);
        return null;
      }
    })();
    linkCache.set(track.fileId, { expires: Date.now() + LINK_TTL_MS, promise });
    return promise;
  }

  async function lookup(context) {
    const apiKey = getKey();
    if (!apiKey) return [];
    const key = cacheKey(context);
    if (!key) return [];

    const cached = searchCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.promise;
    if (cached) searchCache.delete(key);

    const cachedEntry = { expires: Date.now() + FAILURE_TTL_MS, promise: null };
    const promise = (async () => {
      let tracks;
      try {
        tracks = await search(context, apiKey);
      } catch (error) {
        console.warn(`[subtitles] OpenSubtitles search failed (HTTP ${error.response?.status || 'unavailable'})`);
        return [];
      }
      const resolved = [];
      for (const track of tracks.slice(0, Math.max(1, maxTracks))) {
        const subtitle = await resolveLink(track, apiKey);
        if (subtitle) resolved.push(subtitle);
      }
      if (!resolved.length && !process.env.OPEN_SUBTITLES_TOKEN && !warnedAboutMissingToken) {
        warnedAboutMissingToken = true;
        console.warn('[subtitles] OpenSubtitles found candidates but /download needs OPEN_SUBTITLES_TOKEN (a login token from opensubtitles.com). Skipping.');
      }
      return resolved;
    })();

    cachedEntry.promise = promise;
    // Resolve the TTL after the work so failures expire quickly.
    promise.then(subtitles => {
      cachedEntry.expires = Date.now() + (subtitles.length ? SEARCH_TTL_MS : FAILURE_TTL_MS);
    }).catch(() => {
      cachedEntry.expires = Date.now() + FAILURE_TTL_MS;
    });
    searchCache.set(key, cachedEntry);
    while (searchCache.size > MAX_CACHE_ENTRIES) searchCache.delete(searchCache.keys().next().value);
    return promise;
  }

  return async function addOpenSubtitlesFallback(streams, context) {
    const needsSubs = Array.isArray(streams) && streams.some(
      stream => stream && (!Array.isArray(stream.subtitles) || stream.subtitles.length === 0)
    );
    if (!needsSubs) return streams;
    const subtitles = await lookup(context);
    if (!subtitles.length) return streams;
    return streams.map(stream => {
      if (!stream || (Array.isArray(stream.subtitles) && stream.subtitles.length)) return stream;
      return { ...stream, subtitles: subtitles.map(subtitle => ({ ...subtitle })) };
    });
  };
}

module.exports = {
  createOpenSubtitles,
  addOpenSubtitlesFallback: createOpenSubtitles(),
  SEARCH_URL,
  DOWNLOAD_URL,
  compareTracks
};