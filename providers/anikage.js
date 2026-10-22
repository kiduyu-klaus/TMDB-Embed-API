const { getTmdbApiKey } = require('../utils/tmdbKey');

// Detailed request logging with complete, unredacted URLs (local debugging).
// Set PROVIDER_LOG_REDACT=1 to force redaction back on.
const diagnostics = require('../utils/providerTrace').createProviderTrace('AniKage', { redact: false });
const tracedFetch = diagnostics.fetch;
const BASE_URL = "https://anikage.cc";
const API_BASE = "https://anikage.cc/api/media/anime";
const BKY_BASE = "https://og.bakayaro.live";
const TMDB_API = "https://api.themoviedb.org/3";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const SOURCES = ["koto", "kiwi", "wave"];
const LANGS = ["sub", "dub"];

const J_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
    "Referer": BASE_URL + "/",
    "Origin": BASE_URL,
};

const S_HEADERS = {
    "User-Agent": USER_AGENT,
    "Referer": BASE_URL + "/",
    "Origin": BASE_URL,
};

async function getJson(url) {
    try {
        const res = await tracedFetch(url, { headers: J_HEADERS });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function getTmdbDetails(tmdbId, mediaType, season) {
    const endpoint = mediaType === "tv" ? "tv" : "movie";
    const [showData, seasonData] = await Promise.all([
        getJson(`${TMDB_API}/${endpoint}/${tmdbId}?api_key=${getTmdbApiKey()}`),
        mediaType === "tv" && season != null
            ? getJson(`${TMDB_API}/tv/${tmdbId}/season/${season}?api_key=${getTmdbApiKey()}`)
            : Promise.resolve(null),
    ]);
    if (!showData) return null;
    const title = mediaType === "tv" ? (showData.name || "") : (showData.title || "");
    const seasonName = seasonData && seasonData.name
        && seasonData.name.toLowerCase() !== `season ${season}`
        ? seasonData.name.trim()
        : null;
    diagnostics.log('tmdb.resolved', { tmdbId, mediaType, season, title, seasonName });
    return { title, seasonName };
}

function pickTitle(t) {
    t = t || {};
    return (t.english || t.romaji || t.native || "").trim();
}

async function searchSlug(query) {
    const data = await getJson(`${API_BASE}/search?q=${encodeURIComponent(query)}&limit=5`);
    const results = (data && data.data) || [];
    if (!results.length) return null;
    const q = query.toLowerCase();
    for (const r of results) {
        if (pickTitle(r.title).toLowerCase() === q) return r.slug;
    }
    return results[0].slug || null;
}

async function findSlug(title, season, seasonName) {
    const queries = [];
    if (seasonName) queries.push(seasonName);
    if (season != null && season > 1) queries.push(`${title} Season ${season}`);
    queries.push(title);
    for (const q of queries) {
        const slug = await searchSlug(q);
        diagnostics.log('search.slug', { query: q, slug });
        if (slug) return slug;
    }
    return null;
}

async function fetchSources(slug, episode, provider, lang) {
    try {
        const data = await getJson(
            `${API_BASE}/${slug}/episodes/${episode}/sources?lang=${lang}&provider=${provider}`
        );
        if (!data) return [];

        const subtitles = (data.subtitles || [])
            .filter(s => s && s.file)
            .map(s => ({
                url: `${BKY_BASE}/stream/${s.file}`,
                language: s.label || "Subtitle",
                headers: S_HEADERS,
            }));

        const langLabel = lang === "dub" ? "English" : "Japanese";
        const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);

        const sources = (data.sources || [])
            .filter(s => s && s.url)
            .map(s => {
                const isHls = s.isM3U8 !== false;
                return {
                    name: `AniKage \u2022 ${providerLabel} \u2022 ${langLabel}`,
                    title: `AniKage \u2022 ${providerLabel} \u2022 ${langLabel}`,
                    url: `${BKY_BASE}${isHls ? "/m3u8/" : "/stream/"}${s.url}`,
                    quality: "1080p",
                    headers: S_HEADERS,
                    subtitles: subtitles,
                };
            });

        diagnostics.log('sources.fetched', {
            slug, episode, provider, lang, count: sources.length, subtitles: subtitles.length
        });
        return sources;
    } catch (error) {
        diagnostics.log('sources.failed', { slug, episode, provider, lang, error: error.message });
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const args = [tmdbId, mediaType, season, episode];
    return diagnostics.run(() => getStreamsImpl(...args), args);
}

async function getStreamsImpl(tmdbId, mediaType, season, episode) {
    try {
        if (mediaType === "tv" && (season == null || episode == null)) {
            diagnostics.log('request.rejected', { tmdbId, mediaType, season, episode });
            return [];
        }
        const details = await getTmdbDetails(tmdbId, mediaType, season);
        if (!details || !details.title) {
            diagnostics.log('abort.no_tmdb', { tmdbId, mediaType, season });
            return [];
        }
        const slug = await findSlug(details.title, season, details.seasonName);
        if (!slug) {
            diagnostics.log('abort.no_slug', { tmdbId, mediaType, season, title: details.title });
            return [];
        }
        const epNum = mediaType === "movie" ? 1 : episode;
        const results = await Promise.all(
            SOURCES.flatMap(p => LANGS.map(l => fetchSources(slug, epNum, p, l)))
        );
        const seen = new Set();
        const streams = results.flat().filter(s => s.url && !seen.has(s.url) && seen.add(s.url));
        diagnostics.log('streams.resolved', {
            count: streams.length,
            streams: streams.map(s => ({ name: s.name, quality: s.quality, url: s.url }))
        });
        return streams;
    } catch (error) {
        diagnostics.log('extract.error', { tmdbId, mediaType, season, episode, error: error.message });
        return [];
    }
}

module.exports = { getStreams };