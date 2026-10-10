const crypto = require('crypto');
const axios = require('axios');

const API_BASE = 'https://vidrock.ru/api';
const LEGACY_API_BASE = 'https://vidrock.net/api';
const LEGACY_KEY = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';
const LEGACY_IV = LEGACY_KEY.substring(0, 16);
const URL_KEY = Buffer.from(
    '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f',
    'hex'
);
const REQUEST_TIMEOUT_MS = 12000;
const PLAYBACK_PROBE_TIMEOUT_MS = 4500;
const KNOWN_RESOLUTIONS = new Set([240, 360, 480, 540, 720, 1080, 1440, 2160, 4320]);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const VIDROCK_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': USER_AGENT,
    Origin: 'https://vidrock.ru',
    Referer: 'https://vidrock.ru/'
};
const PLAYBACK_HEADERS = {
    'User-Agent': USER_AGENT,
    Origin: 'https://vidrock.ru',
    Referer: 'https://vidrock.ru/'
};

function normalizeHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
        return null;
    }
}

function decodeBase64Url(value) {
    if (typeof value !== 'string' || !value) throw new Error('Encrypted URL is missing');
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
}

function decryptStreamUrl(value) {
    const payload = decodeBase64Url(value);
    if (payload.length < 28) throw new Error('Encrypted URL is too short');

    const iv = payload.subarray(0, 12);
    const ciphertext = payload.subarray(12, -16);
    const authTag = payload.subarray(-16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', URL_KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function encodeLegacyId(id, type, season, episode) {
    const isSeries = type === 'tv' || type === 'series';
    const raw = isSeries ? `${id}_${season || 1}_${episode || 1}` : String(id);
    const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        Buffer.from(LEGACY_KEY),
        Buffer.from(LEGACY_IV)
    );
    return `${cipher.update(raw, 'utf8', 'base64')}${cipher.final('base64')}`
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function getFormat(url, rawType) {
    const type = String(rawType || '').toLowerCase();
    if (type === 'hls' || /\.m3u8(?:$|[?#])/i.test(url)) {
        return { type: 'hls', mimeType: 'application/vnd.apple.mpegurl' };
    }
    if (type === 'dash' || /\.mpd(?:$|[?#])/i.test(url)) {
        return { type: 'dash', mimeType: 'application/dash+xml' };
    }
    const mimeType = /\.mp4(?:$|[?#])/i.test(url) ? 'video/mp4' : undefined;
    return { type: 'direct', ...(mimeType ? { mimeType } : {}) };
}

function normalizeQuality(value, url) {
    const raw = String(value || '').trim();
    if (/^\d{3,4}$/.test(raw)) return `${raw}p`;
    if (/^\d{3,4}p$/i.test(raw)) return raw.toLowerCase();
    const match = String(url || '').match(/(?:^|[^\d])(\d{3,4})p?(?:[^\d]|$)/i);
    if (match) {
        const height = Number(match[1]);
        if (KNOWN_RESOLUTIONS.has(height)) return `${height}p`;
    }
    return raw || 'Auto';
}

function qualityValue(quality) {
    const match = String(quality || '').match(/\d{3,4}/);
    return match ? Number(match[0]) : 0;
}

function createStream(serverName, source, url, quality) {
    const normalizedUrl = normalizeHttpUrl(url);
    if (!normalizedUrl) return null;
    const normalizedQuality = normalizeQuality(quality || source.quality, normalizedUrl);
    const language = source.language ? String(source.language).trim() : '';
    const languageLabel = language ? ` (${language})` : '';
    const stream = {
        name: `Vidrock ${serverName}${languageLabel}`,
        title: `Vidrock ${serverName}${languageLabel} - ${normalizedQuality}`,
        url: normalizedUrl,
        quality: normalizedQuality,
        provider: 'Vidrock',
        ...getFormat(normalizedUrl, source.type),
        headers: {
            ...(source.headers && typeof source.headers === 'object' ? source.headers : {}),
            ...PLAYBACK_HEADERS
        }
    };
    if (Array.isArray(source.captions)) stream.captions = source.captions;
    if (Array.isArray(source.subtitles)) stream.subtitles = source.subtitles;
    return stream;
}

async function expandJsonPlaylist(url, serverName, source) {
    try {
        const response = await axios.get(url, {
            headers: PLAYBACK_HEADERS,
            timeout: REQUEST_TIMEOUT_MS,
            validateStatus: status => status >= 200 && status < 300
        });
        if (!Array.isArray(response.data)) return [];
        return response.data.flatMap(item => {
            if (!item || typeof item !== 'object') return [];
            const stream = createStream(serverName, { ...source, ...item, type: item.type || 'direct' }, item.url || item.file, item.resolution || item.quality);
            return stream ? [stream] : [];
        });
    } catch (error) {
        console.warn(`[Vidrock] ${serverName} playlist expansion failed: ${error.message}`);
        return [];
    }
}

async function normalizeServer(serverName, source) {
    if (!source || typeof source !== 'object') return [];
    const encryptedOrPlain = source.url || source.file;
    if (typeof encryptedOrPlain !== 'string' || !encryptedOrPlain.trim()) return [];

    let streamUrl = normalizeHttpUrl(encryptedOrPlain);
    if (!streamUrl) {
        try {
            streamUrl = normalizeHttpUrl(decryptStreamUrl(encryptedOrPlain));
        } catch (error) {
            console.warn(`[Vidrock] ${serverName} URL decryption failed: ${error.message}`);
            return [];
        }
    }
    if (!streamUrl) return [];

    if (/\/playlist(?:\/|\?|$)/i.test(streamUrl)) {
        return expandJsonPlaylist(streamUrl, serverName, source);
    }

    const stream = createStream(serverName, source, streamUrl, source.quality);
    return stream ? [stream] : [];
}

async function isPlayableStream(stream) {
    try {
        const response = await axios.get(stream.url, {
            headers: { ...stream.headers, Range: 'bytes=0-1023' },
            timeout: PLAYBACK_PROBE_TIMEOUT_MS,
            maxRedirects: 5,
            responseType: 'arraybuffer',
            maxContentLength: 2 * 1024 * 1024,
            validateStatus: () => true
        });
        if (response.status < 200 || response.status >= 400) return false;
        const prefix = Buffer.from(response.data).subarray(0, 64).toString('utf8').trimStart();
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (stream.type === 'hls') {
            return contentType.includes('mpegurl') || prefix.startsWith('#EXTM3U');
        }
        if (stream.type === 'dash') {
            return contentType.includes('dash+xml') || prefix.startsWith('<MPD');
        }
        return true;
    } catch {
        return false;
    }
}

async function filterPlayableStreams(streams) {
    const checks = await Promise.all(streams.map(isPlayableStream));
    return streams.filter((stream, index) => checks[index]);
}

async function fetchCurrentResponse(tmdbId, mediaType, seasonNum, episodeNum) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    const path = isSeries
        ? `tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(seasonNum)}/${encodeURIComponent(episodeNum)}`
        : `movie/${encodeURIComponent(tmdbId)}`;
    const response = await axios.get(`${API_BASE}/${path}`, {
        headers: VIDROCK_HEADERS,
        timeout: REQUEST_TIMEOUT_MS
    });
    return response.data;
}

async function fetchLegacyResponse(tmdbId, mediaType, seasonNum, episodeNum) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    const endpoint = isSeries ? 'tv' : 'movie';
    const encryptedId = encodeLegacyId(tmdbId, mediaType, seasonNum, episodeNum);
    const response = await axios.get(`${LEGACY_API_BASE}/${endpoint}/${encodeURIComponent(encryptedId)}`, {
        headers: VIDROCK_HEADERS,
        timeout: REQUEST_TIMEOUT_MS
    });
    return response.data;
}

async function getVidRockRawResponse(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    if (isSeries) {
        const season = Number(seasonNum);
        const episode = Number(episodeNum);
        if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) {
            return { error: 'Series request is missing season or episode' };
        }
    }

    try {
        return await fetchCurrentResponse(tmdbId, mediaType, seasonNum, episodeNum);
    } catch (currentError) {
        try {
            console.warn(`[Vidrock] Current API failed (${currentError.response?.status || currentError.message}); trying legacy API`);
            return await fetchLegacyResponse(tmdbId, mediaType, seasonNum, episodeNum);
        } catch (legacyError) {
            console.error(`[Vidrock] Fetch failed: current=${currentError.response?.status || currentError.message}, legacy=${legacyError.response?.status || legacyError.message}`);
            return { error: legacyError.message, status: legacyError.response?.status };
        }
    }
}

async function getVidrockStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidrock] Fetching TMDB ${tmdbId} (${mediaType})`);
    try {
        const data = await getVidRockRawResponse(tmdbId, mediaType, seasonNum, episodeNum);
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) return [];

        const entries = Object.entries(data);
        console.log(`[Vidrock] Processing ${entries.length} server(s)`);
        const results = await Promise.allSettled(entries.map(([name, source]) => normalizeServer(name, source)));
        const streams = [];
        const seen = new Set();
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.warn(`[Vidrock] ${entries[index][0]} failed: ${result.reason?.message || 'unknown error'}`);
                return;
            }
            result.value.forEach(stream => {
                if (seen.has(stream.url)) return;
                seen.add(stream.url);
                streams.push(stream);
            });
        });
        streams.sort((a, b) => qualityValue(b.quality) - qualityValue(a.quality));
        const playable = await filterPlayableStreams(streams);
        console.log(`[Vidrock] Emitted ${playable.length}/${streams.length} playable unique stream(s)`);
        return playable;
    } catch (error) {
        console.error(`[Vidrock] Error: ${error.message}`);
        return [];
    }
}

module.exports = {
    getVidrockStreams,
    getVidRockStreams: getVidrockStreams,
    getVidRockRawResponse,
    decryptStreamUrl,
    normalizeServer,
    isPlayableStream
};
