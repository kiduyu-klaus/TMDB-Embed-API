const axios = require('axios');
const { getTmdbApiKey } = require('../utils/tmdbKey');

const VIDEASY_API = 'https://api.wecollege.net';
const ENC_DEC_API = 'https://enc-dec.app/api';
const REQUEST_TIMEOUT_MS = 8000;

const VIDEASY_HEADERS = {
    'Accept': '*/*',
    'Origin': 'https://player.videasy.to',
    'Referer': 'https://player.videasy.to/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
};

// Server behavior and optional filtering are based on the sample's server list.
const SERVERS = [
    { id: 'miami', label: 'Miami', language: 'Original' },
    { id: 'boise', label: 'Boise', language: 'Original' },
    { id: 'vegas', label: 'Vegas', language: 'Original' },
    { id: 'reno', label: 'Reno', language: 'Original' },
    { id: 'oakland', label: 'Oakland', language: 'Original' },
    { id: 'seattle', label: 'Seattle', language: 'Original' },
    { id: 'phoenix', label: 'Phoenix', language: 'Original' },
    { id: 'atlanta', label: 'Atlanta', language: 'Original' },
    { id: 'portland', label: 'Portland', language: 'Original' },
    { id: 'austin', label: 'Austin', language: 'Original', quality: 'English' },
    { id: 'dallas', label: 'Dallas', language: 'Original' },
    { id: 'tampa', label: 'Tampa', language: 'Original' },
    { id: 'orlando', label: 'Orlando', language: 'Original' },
    { id: 'munich', label: 'Munich', language: 'German', queryLanguage: 'german' },
    { id: 'berlin', label: 'Berlin', language: 'German' },
    { id: 'paris', label: 'Paris', language: 'French' },
    { id: 'delhi', label: 'Delhi', language: 'Hindi', quality: 'Hindi' },
    { id: 'cancun', label: 'Cancun', language: 'Spanish' }
];

function encodeRfc3986(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, character =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function doubleEncode(value) {
    return encodeRfc3986(encodeRfc3986(value));
}

function getSources(payload) {
    let parsed = payload;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return [];
        }
    }
    if (Array.isArray(parsed)) return parsed;
    return parsed && Array.isArray(parsed.sources) ? parsed.sources : [];
}

function validateDecryptResponse(data) {
    if (!data || data.status !== 200 || data.result === undefined || data.result === null) {
        const status = data && data.status !== undefined ? data.status : 'unknown';
        const error = data && data.error ? String(data.error) : 'unknown';
        throw new Error(`Videasy decryption failed (status=${status}, error=${error})`);
    }
    return data.result;
}

function buildSourceUrl(server, details, tmdbId, seasonNum, episodeNum, seed) {
    const mediaType = details.type;
    const params = [
        `title=${doubleEncode(details.title)}`,
        `mediaType=${mediaType}`,
        `year=${encodeURIComponent(details.year)}`
    ];
    if (mediaType === 'tv') {
        params.push(`episodeId=${encodeURIComponent(episodeNum)}`);
        params.push(`seasonId=${encodeURIComponent(seasonNum)}`);
    }
    params.push(
        `tmdbId=${encodeURIComponent(tmdbId)}`,
        `imdbId=${encodeURIComponent(details.imdbId || '')}`,
        'enc=2',
        `seed=${encodeURIComponent(seed)}`
    );
    if (server.queryLanguage) params.push(`language=${encodeURIComponent(server.queryLanguage)}`);
    return `${VIDEASY_API}/${server.id}/sources?${params.join('&')}`;
}

async function fetchServerStreams(server, details, tmdbId, seasonNum, episodeNum, seed) {
    const url = buildSourceUrl(server, details, tmdbId, seasonNum, episodeNum, seed);
    const response = await axios.get(url, {
        headers: VIDEASY_HEADERS,
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text'
    });
    const encryptedText = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
    if (!encryptedText || encryptedText.length < 20 || encryptedText.startsWith('<')) return [];

    const decryptResponse = await axios.post(
        `${ENC_DEC_API}/dec-videasy`,
        { text: encryptedText, id: String(tmdbId), seed },
        { headers: { 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS }
    );
    const payload = validateDecryptResponse(decryptResponse.data);
    const sources = getSources(payload);
    return sources
        .filter(source => source && source.url && (!server.quality || source.quality === server.quality))
        .map(source => ({
            name: `Videasy ${server.label}`,
            title: `Videasy ${server.label} - ${source.quality || 'Auto'}`,
            url: source.url,
            quality: source.quality || 'Auto',
            language: server.language,
            provider: 'Videasy',
            headers: {
                Referer: VIDEASY_HEADERS.Referer,
                Origin: VIDEASY_HEADERS.Origin
            }
        }));
}

async function getVideasyStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    if (isSeries && (!Number.isInteger(Number(seasonNum)) || Number(seasonNum) < 1 ||
        !Number.isInteger(Number(episodeNum)) || Number(episodeNum) < 1)) {
        console.warn('[Videasy] Series request is missing season or episode');
        return [];
    }

    const tmdbKey = getTmdbApiKey();
    if (!tmdbKey) {
        console.error('[Videasy] No TMDB API key configured.');
        return [];
    }

    let details;
    try {
        const type = isSeries ? 'tv' : 'movie';
        const { data } = await axios.get(
            `https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(tmdbKey)}&append_to_response=external_ids`,
            { timeout: REQUEST_TIMEOUT_MS }
        );
        details = {
            title: data.title || data.name || '',
            year: (data.release_date || data.first_air_date || '').split('-')[0],
            imdbId: data.external_ids && data.external_ids.imdb_id || '',
            type
        };
    } catch (error) {
        console.error(`[Videasy] TMDB lookup failed: ${error.message}`);
        return [];
    }
    if (!details.title) {
        console.error('[Videasy] No title returned from TMDB.');
        return [];
    }

    let seed;
    try {
        const { data } = await axios.get(
            `${VIDEASY_API}/seed?mediaId=${encodeURIComponent(tmdbId)}`,
            { headers: VIDEASY_HEADERS, timeout: REQUEST_TIMEOUT_MS }
        );
        seed = data && data.seed;
    } catch (error) {
        console.error(`[Videasy] Seed fetch failed: ${error.message}`);
        return [];
    }
    if (!seed) {
        console.error('[Videasy] No seed returned.');
        return [];
    }

    const servers = await Promise.allSettled(SERVERS.map(server =>
        fetchServerStreams(server, details, tmdbId, seasonNum, episodeNum, seed)
    ));
    const streams = [];
    const seen = new Set();
    servers.forEach((result, index) => {
        if (result.status === 'rejected') {
            console.warn(`[Videasy] Server ${SERVERS[index].id} failed: ${result.reason.message || result.reason}`);
            return;
        }
        result.value.forEach(stream => {
            if (seen.has(stream.url)) return;
            seen.add(stream.url);
            streams.push(stream);
        });
    });

    console.log(`[Videasy] Total streams: ${streams.length}`);
    return streams;
}

module.exports = { getVideasyStreams, buildSourceUrl };
