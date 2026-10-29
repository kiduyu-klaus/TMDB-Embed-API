const { getTmdbApiKey } = require('../utils/tmdbKey');

// Detailed request logging with complete, unredacted URLs (local debugging).
// Set PROVIDER_LOG_REDACT=1 to force redaction back on.
const diagnostics = require('../utils/providerTrace').createProviderTrace('Videasy', { redact: false });
const tracedFetch = diagnostics.fetch;

const VIDEASY_API = 'https://api.wecollege.net';
const ENC_DEC_API = 'https://enc-dec.app/api';
const REQUEST_TIMEOUT_MS = 15000;
const DECRYPT_TIMEOUT_MS = 20000;

// The upstream API only answers for the vidy.st origin - any other Referer/Origin pair
// is rejected with HTTP 403 by the edge. These headers must stay in sync with the
// playback headers attached to every stream.
const VIDEASY_HEADERS = {
    'Accept': '*/*',
    'Origin': 'https://vidy.st',
    'Referer': 'https://vidy.st/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
};

// Every server of the upstream table. All of them are queried and every one of them
// contributes its own streams - a dead server only removes its own results.
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
    { id: 'berlin', label: 'Berlin', language: 'German', useGermanTitle: true },
    { id: 'paris', label: 'Paris', language: 'French' },
    { id: 'delhi', label: 'Delhi', language: 'Hindi', quality: 'Hindi' },
    { id: 'cancun', label: 'Cancun', language: 'Spanish' }
];

function encodeRfc3986(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, character =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

// The upstream expects a double encoded title: "Game of Thrones" -> "Game%20of%20Thrones"
// -> "Game%2520of%2520Thrones".
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

function getSubtitles(payload) {
    const subtitles = payload && !Array.isArray(payload) ? payload.subtitles : null;
    if (!Array.isArray(subtitles)) return [];
    return subtitles.filter(entry => entry && typeof entry.url === 'string' && entry.url);
}

function validateDecryptResponse(data) {
    if (!data || data.status !== 200 || data.result === undefined || data.result === null) {
        const status = data && data.status !== undefined ? data.status : 'unknown';
        const error = data && data.error ? String(data.error) : 'unknown';
        throw new Error(`Videasy decryption failed (status=${status}, error=${error})`);
    }
    return data.result;
}

function buildSourceUrl(server, details, tmdbId, seasonNum, episodeNum, seed, titleOverride) {
    const mediaType = details.type;
    const title = titleOverride || details.title;
    const params = [
        `title=${doubleEncode(title)}`,
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
    // Berlin resolves against the German alternate title when the catalogue has one.
    const titleOverride = server.useGermanTitle ? details.germanTitle : null;
    const url = buildSourceUrl(server, details, tmdbId, seasonNum, episodeNum, seed, titleOverride);
    diagnostics.log('server.request', { server: server.id, label: server.label, url });

    const response = await tracedFetch(url, {
        headers: VIDEASY_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
        diagnostics.log('server.http_error', { server: server.id, status: response.status });
        return [];
    }

    const encryptedText = await response.text();
    if (!encryptedText || encryptedText.length < 20 || encryptedText.startsWith('<')) {
        diagnostics.log('server.empty_response', { server: server.id, length: encryptedText ? encryptedText.length : 0 });
        return [];
    }

    const decryptResponse = await tracedFetch(`${ENC_DEC_API}/dec-videasy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: encryptedText, id: String(tmdbId), seed }),
        signal: AbortSignal.timeout(DECRYPT_TIMEOUT_MS)
    });
    const decryptBody = await decryptResponse.json();
    const payload = validateDecryptResponse(decryptBody);

    const sources = getSources(payload);
    const subtitles = getSubtitles(payload);
    const kept = sources.filter(source => source && source.url && (!server.quality || source.quality === server.quality));
    diagnostics.log('server.result', {
        server: server.id,
        label: server.label,
        total: sources.length,
        kept: kept.length,
        dropped: sources.length - kept.length,
        qualities: kept.map(source => source.quality || 'Auto')
    });

    return kept.map(source => {
        const quality = source.quality || 'Auto';
        const name = `Videasy ${server.label} ${quality}`;
        return {
            name,
            title: `${name} - ${server.language}`,
            url: source.url,
            quality,
            language: server.language,
            provider: 'Videasy',
            subtitles,
            headers: {
                Referer: VIDEASY_HEADERS.Referer,
                Origin: VIDEASY_HEADERS.Origin
            }
        };
    });
}

async function getVideasyStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const args = [tmdbId, mediaType, seasonNum, episodeNum];
    return diagnostics.run(() => getVideasyStreamsImpl(...args), args);
}

async function getVideasyStreamsImpl(tmdbId, mediaType, seasonNum, episodeNum) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    if (isSeries && (!Number.isInteger(Number(seasonNum)) || Number(seasonNum) < 1 ||
        !Number.isInteger(Number(episodeNum)) || Number(episodeNum) < 1)) {
        diagnostics.log('abort.missing_episode', { tmdbId, mediaType, seasonNum, episodeNum });
        return [];
    }

    const tmdbKey = getTmdbApiKey();
    if (!tmdbKey) {
        diagnostics.log('abort.no_tmdb_key', { tmdbId, mediaType });
        return [];
    }

    let details;
    try {
        const type = isSeries ? 'tv' : 'movie';
        const response = await tracedFetch(
            `https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(tmdbKey)}&append_to_response=external_ids,alternative_titles`,
            { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
        );
        const data = await response.json();
        if (!data || data.status_code) {
            diagnostics.log('abort.tmdb_error', { tmdbId, status: data && data.status_code });
            return [];
        }
        const alternate = data.alternative_titles || {};
        const alternateEntries = alternate.results || alternate.titles || [];
        const germanEntry = alternateEntries.find(entry =>
            String(entry && entry.iso_3166_1 || '').toUpperCase() === 'DE'
        );
        details = {
            title: data.title || data.name || '',
            year: (data.release_date || data.first_air_date || '').split('-')[0],
            imdbId: (data.external_ids && data.external_ids.imdb_id) || '',
            germanTitle: germanEntry && germanEntry.title ? germanEntry.title : '',
            type
        };
    } catch (error) {
        diagnostics.log('abort.tmdb_failed', { tmdbId, errorType: error.name, error: error.message });
        return [];
    }
    if (!details.title) {
        diagnostics.log('abort.no_title', { tmdbId, mediaType });
        return [];
    }
    diagnostics.log('tmdb.resolved', {
        tmdbId, mediaType, title: details.title, year: details.year,
        imdbId: details.imdbId, germanTitle: details.germanTitle
    });

    let seed;
    try {
        const response = await tracedFetch(
            `${VIDEASY_API}/seed?mediaId=${encodeURIComponent(tmdbId)}`,
            { headers: VIDEASY_HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
        );
        const data = await response.json();
        seed = data && data.seed;
    } catch (error) {
        diagnostics.log('abort.seed_failed', { tmdbId, errorType: error.name, error: error.message });
        return [];
    }
    if (!seed) {
        diagnostics.log('abort.no_seed', { tmdbId });
        return [];
    }
    diagnostics.log('seed.resolved', { tmdbId, seed });

    // Every server is queried; a failing server only drops its own results.
    const settled = await Promise.allSettled(SERVERS.map(server =>
        fetchServerStreams(server, details, tmdbId, seasonNum, episodeNum, seed)
    ));

    const streams = [];
    const seen = new Set();
    const failed = [];
    settled.forEach((result, index) => {
        const server = SERVERS[index];
        if (result.status === 'rejected') {
            const reason = result.reason;
            const message = reason && reason.message ? reason.message : String(reason);
            const cause = reason && reason.cause ? (reason.cause.message || reason.cause.code || String(reason.cause)) : '';
            failed.push({ server: server.id, error: message, cause });
            diagnostics.log('server.failed', { server: server.id, error: message, cause });
            return;
        }
        result.value.forEach(stream => {
            if (seen.has(stream.url)) return;
            seen.add(stream.url);
            streams.push(stream);
        });
    });

    diagnostics.log('streams.resolved', {
        tmdbId, mediaType, seasonNum, episodeNum,
        servers: SERVERS.length,
        failedServers: failed,
        count: streams.length,
        streams: streams.map(stream => ({ name: stream.name, quality: stream.quality, url: stream.url }))
    });
    return streams;
}

module.exports = { getVideasyStreams, getStreams: getVideasyStreams, buildSourceUrl, SERVERS };
