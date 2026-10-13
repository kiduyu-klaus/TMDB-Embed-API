const axios = require('axios');
const { inferSubtitleMimeType } = require('../utils/subtitles');

const MEOWTV_API = 'https://api.meowtv.ru';
const ENC_DEC_API = 'https://enc-dec.app/api';
// Keep a single provider attempt below the aggregate endpoint's 15-second budget.
const REQUEST_TIMEOUT_MS = 10000;

const MEOWTV_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Origin': 'https://meowtv.ru',
    'Referer': 'https://meowtv.ru/'
};

const SERVERS = [
    { id: 'acme', label: 'Acme' },
    { id: 'dcloud', label: 'Dcloud' },
    { id: 'tik', label: 'TCloud' },
    { id: 'ipcloud', label: 'IPcloud' },
    { id: 'turkce', label: 'Türkçe', movieOnly: true },
    { id: 'hindi', label: 'Hindi' },
    { id: 'english', label: 'English' }
];

function isHttpUrl(value) {
    if (typeof value !== 'string') return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function parsePayload(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function validateBridgeResponse(data) {
    if (!data || data.status !== 200 || data.result === undefined || data.result === null) {
        const status = data && data.status !== undefined ? data.status : 'unknown';
        const error = data && data.error ? String(data.error) : 'unknown';
        throw new Error(`MeowTV decryption failed (status=${status}, error=${error})`);
    }
    return parsePayload(data.result);
}

function inferStreamType(url, rawType) {
    const type = String(rawType || '').toLowerCase();
    if (type.includes('hls') || /\.m3u8(?:$|[?#])/i.test(url)) return 'hls';
    if (type.includes('dash') || /\.mpd(?:$|[?#])/i.test(url)) return 'dash';
    return 'direct';
}

function normalizeQuality(value) {
    const quality = String(value || 'Auto').trim();
    if (/^\d{3,4}$/.test(quality)) return `${quality}p`;
    return quality || 'Auto';
}

function collectStreamCandidates(value, inherited = {}, output = [], seenObjects = new Set()) {
    const parsed = parsePayload(value);
    if (!parsed || typeof parsed !== 'object') return output;
    if (seenObjects.has(parsed)) return output;
    seenObjects.add(parsed);

    if (Array.isArray(parsed)) {
        parsed.forEach(item => collectStreamCandidates(item, inherited, output, seenObjects));
        return output;
    }

    const quality = parsed.quality || parsed.label || parsed.resolution || inherited.quality;
    const language = parsed.language || parsed.lang || inherited.language;
    const url = parsed.url || parsed.file || parsed.src || parsed.playlist || parsed.link;
    if (isHttpUrl(url)) {
        output.push({
            url,
            quality,
            language,
            type: parsed.type || parsed.format || inherited.type,
            headers: parsed.headers && typeof parsed.headers === 'object' ? parsed.headers : null
        });
    }

    Object.entries(parsed).forEach(([key, child]) => {
        if (['url', 'file', 'src', 'playlist', 'link', 'headers'].includes(key)) return;
        const next = { ...inherited };
        if (/^\d{3,4}p?$/i.test(key)) next.quality = key;
        collectStreamCandidates(child, next, output, seenObjects);
    });
    return output;
}

function normalizeSubtitles(payload) {
    const candidates = collectStreamCandidates(payload);
    const seen = new Set();
    return candidates.flatMap(item => {
        if (!isHttpUrl(item.url) || seen.has(item.url)) return [];
        if (!/\.(?:srt|vtt|ass|ssa)(?:$|[?#])/i.test(item.url)) return [];
        seen.add(item.url);
        const language = String(item.language || item.quality || 'Unknown').trim();
        return [{
            url: item.url,
            mimeType: inferSubtitleMimeType(item.url),
            label: language,
            language,
            headers: {}
        }];
    });
}

function normalizeStreams(payload, server, subtitles = []) {
    const candidates = collectStreamCandidates(payload);
    const seen = new Set();
    return candidates.flatMap(item => {
        if (!isHttpUrl(item.url) || seen.has(item.url)) return [];
        if (/\.(?:srt|vtt|ass|ssa)(?:$|[?#])/i.test(item.url)) return [];
        seen.add(item.url);
        const type = inferStreamType(item.url, item.type);
        const quality = normalizeQuality(item.quality);
        const languageValue = String(item.language || '').trim();
        const language = languageValue &&
            languageValue.toLowerCase() !== quality.toLowerCase() &&
            languageValue.toLowerCase() !== 'auto'
            ? ` ${languageValue}`
            : '';
        return [{
            name: `MeowTV ${server.label}`,
            title: `MeowTV - ${server.label}${language} - ${quality}`,
            url: item.url,
            quality,
            provider: 'meowtv',
            type,
            ...(type === 'hls' ? { mimeType: 'application/vnd.apple.mpegurl' } : {}),
            ...(type === 'dash' ? { mimeType: 'application/dash+xml' } : {}),
            headers: item.headers ? { ...MEOWTV_HEADERS, ...item.headers } : { ...MEOWTV_HEADERS },
            subtitles
        }];
    });
}

function buildStreamUrl(tmdbId, mediaType, seasonNum, episodeNum, serverId) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    const path = isSeries
        ? `/streams/tv/${encodeURIComponent(tmdbId)}/${seasonNum}/${episodeNum}`
        : `/streams/movie/${encodeURIComponent(tmdbId)}`;
    return `${MEOWTV_API}${path}?s=${encodeURIComponent(serverId)}`;
}

async function fetchSubtitles(tmdbId, mediaType, seasonNum, episodeNum) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    const suffix = isSeries ? `/${seasonNum}/${episodeNum}` : '';
    try {
        const response = await axios.get(
            `${MEOWTV_API}/subs/${isSeries ? 'tv' : 'movie'}/${encodeURIComponent(tmdbId)}${suffix}`,
            { headers: MEOWTV_HEADERS, timeout: REQUEST_TIMEOUT_MS }
        );
        return normalizeSubtitles(response.data);
    } catch (error) {
        console.warn(`[MeowTV] Subtitle request failed: ${error.message}`);
        return [];
    }
}

async function fetchStreamTicket() {
    try {
        const response = await axios.post(
            `${MEOWTV_API}/streams/ticket`,
            {},
            { headers: { ...MEOWTV_HEADERS, 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS }
        );
        return typeof response.data?.ticket === 'string' ? response.data.ticket : '';
    } catch (error) {
        console.warn(`[MeowTV] Stream ticket request failed: ${error.message}`);
        return '';
    }
}

async function fetchServerStreams(server, tmdbId, mediaType, seasonNum, episodeNum, subtitles, ticket) {
    const sourceUrl = buildStreamUrl(tmdbId, mediaType, seasonNum, episodeNum, server.id);
    const request = streamTicket => axios.get(sourceUrl, {
        headers: streamTicket ? { ...MEOWTV_HEADERS, 'x-stream-ticket': streamTicket } : MEOWTV_HEADERS,
        timeout: REQUEST_TIMEOUT_MS
    });
    let encryptedResponse;
    try {
        encryptedResponse = await request(ticket);
    } catch (error) {
        if (![401, 403].includes(error.response?.status)) throw error;
        const refreshedTicket = await fetchStreamTicket();
        if (!refreshedTicket) throw error;
        encryptedResponse = await request(refreshedTicket);
    }
    const decryptedResponse = await axios.post(
        `${ENC_DEC_API}/dec-meowtv`,
        { data: encryptedResponse.data },
        { headers: { 'Content-Type': 'application/json' }, timeout: REQUEST_TIMEOUT_MS }
    );
    const payload = validateBridgeResponse(decryptedResponse.data);
    return normalizeStreams(payload, server, subtitles);
}

async function getMeowtvStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    const season = Number(seasonNum);
    const episode = Number(episodeNum);
    if (isSeries && (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1)) {
        console.warn('[MeowTV] Series request is missing season or episode');
        return [];
    }

    const servers = SERVERS.filter(server => !isSeries || !server.movieOnly);
    const [subtitles, ticket] = await Promise.all([
        fetchSubtitles(tmdbId, mediaType, seasonNum, episodeNum),
        fetchStreamTicket()
    ]);
    console.log(`[MeowTV] Fetching ${servers.length} server(s); subtitles=${subtitles.length}; ticket=${ticket ? 'yes' : 'no'}`);

    const results = await Promise.allSettled(
        servers.map(server => fetchServerStreams(
            server,
            tmdbId,
            mediaType,
            seasonNum,
            episodeNum,
            subtitles,
            ticket
        ))
    );
    const streams = [];
    const seen = new Set();
    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            const reason = result.reason && result.reason.message ? result.reason.message : 'unknown error';
            console.warn(`[MeowTV] Server ${servers[index].id} failed: ${reason}`);
            return;
        }
        result.value.forEach(stream => {
            if (seen.has(stream.url)) return;
            seen.add(stream.url);
            streams.push(stream);
        });
    });
    console.log(`[MeowTV] Emitted ${streams.length} unique stream(s)`);
    return streams;
}

module.exports = {
    getMeowtvStreams,
    buildStreamUrl,
    fetchStreamTicket,
    normalizeStreams,
    normalizeSubtitles
};
