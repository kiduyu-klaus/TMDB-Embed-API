const axios = require('axios');
const { getTmdbApiKey } = require('../utils/tmdbKey');
const { inferSubtitleMimeType } = require('../utils/subtitles');
const diagnostics = require('../utils/providerTrace').createProviderTrace('Kisskh');

const KISSKH_API = (process.env.KISSKH_API_URL || 'https://kisskh.do/api').replace(/\/+$/, '');
const ENC_DEC_API = (process.env.KISSKH_ENC_DEC_API || 'https://enc-dec.app/api').replace(/\/+$/, '');
const TMDB_API = 'https://api.themoviedb.org/3';
const REQUEST_TIMEOUT_MS = Number(process.env.KISSKH_TIMEOUT_MS || 20000);
const USER_AGENT = process.env.KISSKH_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const HEADERS = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': USER_AGENT,
};

function endpointName(url) {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return String(url || '').split('?')[0];
    }
}

async function tracedGet(url, config = {}) {
    const started = Date.now();
    diagnostics.log('request.start', { endpoint: endpointName(url) });
    try {
        const response = await axios.get(url, config);
        diagnostics.log('request.complete', {
            endpoint: endpointName(url),
            status: response.status,
            elapsedMs: Date.now() - started,
            payloadType: Array.isArray(response.data) ? 'array' : typeof response.data,
        });
        return response;
    } catch (error) {
        diagnostics.log('request.failed', {
            endpoint: endpointName(url),
            elapsedMs: Date.now() - started,
            error: error.message,
        });
        throw error;
    }
}

function isAnimeEndpoint(...values) {
    return values.some(value => /\banime\b/i.test(String(value || '')));
}

function requestConfig(extra = {}) {
    return {
        timeout: REQUEST_TIMEOUT_MS,
        ...extra,
        headers: { ...HEADERS, ...(extra.headers || {}) },
    };
}

function extractList(payload, keys = ['episodes', 'Episodes', 'data', 'result', 'results']) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    for (const key of keys) {
        if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
}

function normalizeTitle(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleScore(target, candidate, year, season) {
    const a = normalizeTitle(target);
    const b = normalizeTitle(candidate);
    if (!a || !b) return 0;
    let score = 0;
    if (a === b) score += 1;
    if (b.includes(a)) score += 0.45;
    else if (a.includes(b)) score += 0.25;
    const aWords = new Set(a.split(' '));
    const overlap = b.split(' ').filter(word => aWords.has(word)).length;
    score += overlap / Math.max(a.split(' ').length, 1) * 0.3;
    if (year && String(candidate).includes(String(year))) score += 0.08;
    if (season != null) {
        const match = String(candidate).match(/\bseason\s*(\d+)\b/i);
        if (match) score += Number(match[1]) === Number(season) ? 0.35 : -0.25;
    }
    return score;
}

function bestMatch(items, title, year, season) {
    const candidates = items
        .filter(item => item && item.id != null)
        .map(item => ({
            item,
            score: titleScore(title, item.title || item.name || '', year, season),
        }))
        .sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score < 0.35) {
        throw new Error(`KissKH search returned no close match for ${title}`);
    }
    return candidates[0].item;
}

async function tmdbDetails(tmdbId, mediaType, apiKey) {
    const kind = mediaType === 'movie' ? 'movie' : 'tv';
    const response = await tracedGet(`${TMDB_API}/${kind}/${encodeURIComponent(String(tmdbId))}`, {
        params: { api_key: apiKey },
        timeout: REQUEST_TIMEOUT_MS,
    });
    return response.data;
}

async function findEpisode(tmdbId, mediaType, season, episode) {
    const apiKey = getTmdbApiKey();
    if (!apiKey) throw new Error('TMDB API key is required for KissKH');

    const kind = mediaType === 'movie' ? 'movie' : 'tv';
    const details = await tmdbDetails(tmdbId, kind, apiKey);
    const title = kind === 'movie' ? details.title : details.name;
    const date = kind === 'movie' ? details.release_date : details.first_air_date;
    const year = date ? String(date).slice(0, 4) : null;
    if (!title) throw new Error(`TMDB returned no title for ${kind} ${tmdbId}`);

    const searchResponse = await tracedGet(`${KISSKH_API}/DramaList/Search`, requestConfig({
        params: { q: title, type: 0 },
    }));
    const match = bestMatch(extractList(searchResponse.data), title, year, kind === 'tv' ? season : null);
    diagnostics.log('catalog.match', { title, matchTitle: match.title || match.name || title, matchId: match.id });

    const dramaResponse = await tracedGet(
        `${KISSKH_API}/DramaList/Drama/${encodeURIComponent(String(match.id))}`,
        requestConfig({ params: { isq: 'true' } }),
    );
    const episodes = extractList(dramaResponse.data);
    const targetEpisode = kind === 'movie' ? 1 : Number(episode);
    const selected = episodes.find(item => {
        const value = item && (item.number ?? item.episodeNumber ?? item.Episode);
        const number = value && typeof value === 'object' ? value.number : value;
        return number != null && Number(number) === targetEpisode;
    });
    if (!selected) {
        throw new Error(`KissKH episode ${targetEpisode} was not found for ${match.title || title}`);
    }
    const episodeId = selected.id ?? selected.episodeId;
    if (episodeId == null) throw new Error('KissKH episode has no ID');
    const resolved = { episodeId: String(episodeId), title, matchTitle: match.title || match.name || title };
    diagnostics.log('episode.selected', { episodeId: resolved.episodeId, targetEpisode, matchTitle: resolved.matchTitle });
    return resolved;
}

async function getEncryptedKey(episodeId, type) {
    const response = await tracedGet(`${ENC_DEC_API}/enc-kisskh`, {
        params: { text: episodeId, type },
        timeout: REQUEST_TIMEOUT_MS,
    });
    if (!response.data || response.data.status !== 200) {
        throw new Error(`KissKH ${type} key endpoint failed`);
    }
    return response.data.result;
}

function parseVideoPayload(payload) {
    if (typeof payload === 'string') return { url: payload };
    if (!payload || typeof payload !== 'object') return null;
    const url = payload.url || payload.videoUrl || payload.src || payload.link || payload.Video || payload.VideoUrl || payload.Url;
    if (url) return { ...payload, url: String(url) };
    return null;
}

function normalizeSubtitle(item, index, defaultHeaders) {
    if (!item) return null;
    const rawUrl = typeof item === 'string' ? item : (item.url || item.src || item.file || item.path);
    if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return null;
    const source = typeof item === 'object' ? item : {};
    const language = source.language || source.lang || source.land || source.label || 'Unknown';
    const format = source.format || source.type || source.ext || (/\.srt(?:\.|\?|$)/i.test(String(rawUrl)) ? 'srt' : undefined);
    return {
        ...source,
        id: source.id || `kisskh-${index}-${String(language).toLowerCase()}`,
        url: String(rawUrl),
        language: String(language),
        label: source.label || String(language),
        mimeType: source.mimeType || inferSubtitleMimeType({ url: rawUrl, format }),
        ...(format ? { format } : {}),
        headers: source.headers || defaultHeaders,
    };
}

async function getSubtitles(episodeId, defaultHeaders) {
    try {
        const key = await getEncryptedKey(episodeId, 'sub');
        const response = await tracedGet(`${KISSKH_API}/Sub/${encodeURIComponent(episodeId)}`, requestConfig({
            params: { kkey: key },
        }));
        const entries = Array.isArray(response.data) ? response.data : extractList(response.data, ['subtitles', 'Subtitles', 'data']);
        const output = [];
        for (let index = 0; index < entries.length; index += 1) {
            const item = entries[index];
            const rawUrl = item && (item.src || item.url || item.file);
            if (!rawUrl) continue;
            try {
                const decrypted = await tracedGet(`${ENC_DEC_API}/dec-kisskh`, {
                    params: { url: rawUrl },
                    timeout: REQUEST_TIMEOUT_MS,
                    responseType: 'text',
                });
                const subtitleUrl = typeof decrypted.data === 'string' && /^https?:\/\//i.test(decrypted.data.trim())
                    ? decrypted.data.trim()
                    : `${ENC_DEC_API}/dec-kisskh?url=${encodeURIComponent(rawUrl)}`;
                const subtitle = normalizeSubtitle({ ...item, url: subtitleUrl }, index, defaultHeaders);
                if (subtitle) output.push(subtitle);
            } catch {
                const subtitle = normalizeSubtitle({ ...item, url: rawUrl }, index, defaultHeaders);
                if (subtitle) output.push(subtitle);
            }
        }
        diagnostics.log('subtitles.complete', { episodeId, count: output.length });
        return output;
    } catch (error) {
        console.warn(`[KissKH] Subtitle lookup failed: ${error.message}`);
        return [];
    }
}

async function getKisskhStreams(...args) {
    return diagnostics.run(() => getKisskhStreamsImpl(...args), args);
}

async function getKisskhStreamsImpl(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const started = Date.now();
    diagnostics.log('streams.start', { tmdbId, mediaType, season, episode, endpoint: endpointName(KISSKH_API) });
    try {
        const kind = mediaType === 'movie' ? 'movie' : 'tv';
        if (kind === 'tv' && (season == null || episode == null)) {
            diagnostics.log('streams.rejected', { reason: 'missing-season-or-episode' });
            return [];
        }
        const resolved = await findEpisode(tmdbId, kind, season, episode);
        const episodeId = resolved.episodeId;
        diagnostics.log('episode.resolved', { episodeId, title: resolved.title, matchTitle: resolved.matchTitle });
        const referer = `${KISSKH_API}/`;
        const headers = { Referer: referer, 'User-Agent': USER_AGENT };

        const [videoKey, subtitles] = await Promise.all([
            getEncryptedKey(episodeId, 'vid'),
            getSubtitles(episodeId, headers),
        ]);
        const videoResponse = await tracedGet(
            `${KISSKH_API}/DramaList/Episode/${encodeURIComponent(episodeId)}.png`,
            requestConfig({ params: { err: 'false', ts: '', time: '', kkey: videoKey } }),
        );
        const video = parseVideoPayload(videoResponse.data);
        if (!video || !video.url) {
            diagnostics.log('video.missing', { episodeId });
            return [];
        }

        const url = video.url;
        const streamTitle = `${resolved.title}${kind === 'tv' ? `\nS${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : ''}`;
        const anime = isAnimeEndpoint(mediaType, KISSKH_API, url);
        const language = anime ? 'Original' : 'English';
        const mimeType = video.mimeType || (/\.m3u8(?:\?|$)/i.test(url) ? 'application/vnd.apple.mpegurl' : 'video/mp4');
        const format = video.format || (mimeType.includes('mpegurl') ? 'm3u8' : 'mp4');
        const stream = {
            name: 'KissKH',
            title: streamTitle,
            url,
            format,
            mimeType,
            quality: video.quality || video.resolution || 'Auto',
            language,
            provider: 'KissKH',
            headers,
            subtitles,
        };
        diagnostics.log('streams.complete', {
            tmdbId,
            mediaType,
            anime,
            language,
            format,
            subtitleCount: subtitles.length,
            elapsedMs: Date.now() - started,
        });
        return [stream];
    } catch (error) {
        diagnostics.log('streams.failed', { tmdbId, mediaType, season, episode, elapsedMs: Date.now() - started, error: error.message });
        console.error(`[KissKH] ${error.message}`);
        return [];
    }
}

module.exports = { getKisskhStreams };
