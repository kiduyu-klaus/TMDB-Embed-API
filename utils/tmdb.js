const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const { getTmdbApiKey } = require('./tmdbKey');

const cache = {
  imdbByTmdb: new Map(),
  details: new Map(),
  seasons: new Map(),
};
const TTL_MS = 6 * 60 * 60 * 1000;
function isFresh(entry) { return entry && (Date.now() - entry.ts) < TTL_MS; }

async function tmdbFetchJson(url, fetcher = fetch) {
  const apiKey = getTmdbApiKey();
  if (!apiKey) throw new Error('TMDB_API_KEY missing');
  const sep = url.includes('?') ? '&' : '?';
  const full = `${url}${sep}api_key=${apiKey}`;
  const res = await fetcher(full, { timeout: 30000 });
  if (!res.ok) throw new Error(`TMDB request failed ${res.status}`);
  return res.json();
}
async function getExternalIds(type, tmdbId, fetcher) {
  const key = `${type}:${tmdbId}`;
  const cached = cache.imdbByTmdb.get(key);
  if (isFresh(cached)) return cached.data;
  const json = await tmdbFetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids`, fetcher);
  cache.imdbByTmdb.set(key, { data: json, ts: Date.now() });
  return json;
}
async function getDetails(type, tmdbId, fetcher) {
  const key = `${type}:${tmdbId}:details`;
  const cached = cache.details.get(key);
  if (isFresh(cached)) return cached.data;
  const json = await tmdbFetchJson(`https://api.themoviedb.org/3/${type}/${tmdbId}`, fetcher);
  cache.details.set(key, { data: json, ts: Date.now() });
  return json;
}
async function getSeasonDetails(tmdbId, seasonNumber, fetcher) {
  const key = `tv:${tmdbId}:season:${seasonNumber}`;
  const cached = cache.seasons.get(key);
  if (isFresh(cached)) return cached.data;

  try {
    const json = await tmdbFetchJson(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}`, fetcher);
    cache.seasons.set(key, { data: json, ts: Date.now() });
    return json;
  } catch {
    return null;
  }
}
async function resolveImdbId(type, tmdbId, fetcher) {
  try { const ext = await getExternalIds(type, tmdbId, fetcher); return ext.imdb_id || null; } catch { return null; }
}
module.exports = { getExternalIds, getDetails, getSeasonDetails, resolveImdbId };
