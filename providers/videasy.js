const { getTmdbApiKey } = require('../utils/tmdbKey');
const { config } = require('../utils/config');

// Detailed request logging with complete, unredacted URLs (local debugging).
// Set PROVIDER_LOG_REDACT=1 to force redaction back on.
const diagnostics = require('../utils/providerTrace').createProviderTrace('Videasy', { redact: false });
const tracedFetch = diagnostics.fetch;
const proxy = require('../utils/providerProxy').createProviderProxy({
    provider: 'Videasy',
    config,
    settingKey: 'videasyProxyEnabled',
    tracedFetch,
    log: diagnostics.log,
    bypassOrigins: ['https://api.themoviedb.org']
});
const providerFetch = proxy.fetch;

const VIDEASY_API = 'https://api.wecollege.net';
const ENC_DEC_API = 'https://enc-dec.app/api';

// Budgets. 15 of the 18 upstream servers answer in <=1.1s, so a short
// per-server hard timeout is more than enough. Dead hosts (oakland /
// munich / berlin in the log) previously caused a 15s stall because the
// old code awaited every server to its full REQUEST_TIMEOUT_MS.
const TMDB_TIMEOUT_MS = 5000;
const SEED_TIMEOUT_MS = 5000;
const SERVER_TIMEOUT_MS = 3000;
const DECRYPT_TIMEOUT_MS = 3000;

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
// `quality` / `language` are informational only and MUST NOT be used for filtering
// (they describe the server, not the actual decoded source.quality which can be
// "Auto", "1080p", etc.).
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
    { id: 'austin', label: 'Austin', language: 'Original' },
    { id: 'dallas', label: 'Dallas', language: 'Original' },
    { id: 'tampa', label: 'Tampa', language: 'Original' },
    { id: 'orlando', label: 'Orlando', language: 'Original' },
    { id: 'munich', label: 'Munich', language: 'German', queryLanguage: 'german' },
    { id: 'berlin', label: 'Berlin', language: 'German', useGermanTitle: true },
    { id: 'paris', label: 'Paris', language: 'French' },
    { id: 'delhi', label: 'Delhi', language: 'Hindi' },
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

// Hard deadline that also covers bodies, because AbortSignal.timeout() alone
// does not reliably cancel a fetch whose headers arrived but whose body is
// still streaming.
function withTimeout(factory, ms, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        try { controller.abort(new Error(`${label} hard timeout ${ms}ms`)); } catch { /* noop */ }
    }, ms);
    return Promise.resolve()
        .then(() => factory(controller.signal))
        .finally(() => clearTimeout(timer));
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
    const titleOverride = server.useGermanTitle ? details.germanTitle : null;
    const url = buildSourceUrl(server, details, tmdbId, seasonNum, episodeNum, seed, titleOverride);
    diagnostics.log('server.request', { server: server.id, label: server.label, url });

    // ---- Step 1: fetch the encrypted source payload ----
    let encryptedText;
    try {
        const response = await withTimeout(
            signal => providerFetch(url, { headers: VIDEASY_HEADERS, signal }),
            SERVER_TIMEOUT_MS,
            `server ${server.id} fetch`
        );
        if (!response.ok) {
            diagnostics.log('server.http_error', { server: server.id, status: response.status });
            return [];
        }
        encryptedText = await response.text();
    } catch (error) {
        diagnostics.log('server.fetch_failed', {
            server: server.id,
            errorType: error && error.name,
            error: error && error.message
        });
        return [];
    }

    if (!encryptedText || encryptedText.length < 20 || encryptedText.startsWith('<')) {
        diagnostics.log('server.empty_response', {
            server: server.id,
            length: encryptedText ? encryptedText.length : 0
        });
        return [];
    }

    // ---- Step 2: decrypt ----
    let payload;
    try {
        const { body, response } = await withTimeout(async signal => {
            const decryptResponse = await providerFetch(`${ENC_DEC_API}/dec-videasy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: encryptedText, id: String(tmdbId), seed }),
                signal
            });
            const text = await decryptResponse.text();
            return { response: decryptResponse, body: text };
        }, DECRYPT_TIMEOUT_MS, `server ${server.id} decrypt`);

        if (!response.ok) {
            diagnostics.log('server.decrypt_http_error', { server: server.id, status: response.status });
            return [];
        }
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch (parseError) {
            diagnostics.log('server.decrypt_bad_json', {
                server: server.id,
                error: parseError.message,
                preview: body.slice(0, 120)
            });
            return [];
        }
        payload = validateDecryptResponse(parsed);
    } catch (error) {
        diagnostics.log('server.decrypt_failed', {
            server: server.id,
            errorType: error && error.name,
            error: error && error.message
        });
        return [];
    }

    // ---- Step 3: shape into streams ----
    const sources = getSources(payload);
    const subtitles = getSubtitles(payload);

    // Keep every source with a url. The old filter compared
    // `source.quality === server.quality` which dropped valid streams
    // (e.g. the "austin" server returned 1 source with quality "Auto"
    // and was silently thrown away because server.quality was "English").
    const kept = sources.filter(source => source && source.url);
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
            subtitles: Array.isArray(subtitles) ? subtitles : [],
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

    // ---- TMDB metadata ----
    let details;
    try {
        const type = isSeries ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}` +
            `?api_key=${encodeURIComponent(tmdbKey)}` +
            `&append_to_response=external_ids,alternative_titles`;
        const data = await withTimeout(async signal => {
            const response = await providerFetch(url, { signal });
            if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
            return response.json();
        }, TMDB_TIMEOUT_MS, 'tmdb');

        if (!data || data.status_code) {
            diagnostics.log('abort.tmdb_error', { tmdbId, status: data && data.status_code });
            return [];
        }
        const alternate = data.alternative_titles || {};
        const alternateEntries = alternate.results || alternate.titles || [];
        const germanEntry = alternateEntries.find(entry =>
            String((entry && entry.iso_3166_1) || '').toUpperCase() === 'DE'
        );
        details = {
            title: data.title || data.name || '',
            year: (data.release_date || data.first_air_date || '').split('-')[0],
            imdbId: (data.external_ids && data.external_ids.imdb_id) || '',
            germanTitle: germanEntry && germanEntry.title ? germanEntry.title : '',
            type
        };
    } catch (error) {
        diagnostics.log('abort.tmdb_failed', {
            tmdbId,
            errorType: error && error.name,
            error: error && error.message
        });
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

    // ---- Seed ----
    let seed;
    try {
        seed = await withTimeout(async signal => {
            const response = await providerFetch(
                `${VIDEASY_API}/seed?mediaId=${encodeURIComponent(tmdbId)}`,
                { headers: VIDEASY_HEADERS, signal }
            );
            if (!response.ok) throw new Error(`seed HTTP ${response.status}`);
            const data = await response.json();
            return data && data.seed;
        }, SEED_TIMEOUT_MS, 'seed');
    } catch (error) {
        diagnostics.log('abort.seed_failed', {
            tmdbId,
            errorType: error && error.name,
            error: error && error.message
        });
        return [];
    }
    if (!seed) {
        diagnostics.log('abort.no_seed', { tmdbId });
        return [];
    }
    diagnostics.log('seed.resolved', { tmdbId, seed });

    // ---- Query every server; each one has its own hard budget ----
    const started = Date.now();
    const settled = await Promise.allSettled(SERVERS.map(server =>
        withTimeout(
            signal => fetchServerStreamsInner(server, details, tmdbId, seasonNum, episodeNum, seed, signal),
            SERVER_TIMEOUT_MS * 2, // fetch + decrypt share the budget, so allow 2x total
            `server ${server.id} outer`
        )
    ));

    const streams = [];
    const seen = new Set();
    const failed = [];
    settled.forEach((result, index) => {
        const server = SERVERS[index];
        if (result.status === 'rejected') {
            const reason = result.reason;
            const message = reason && reason.message ? reason.message : String(reason);
            const cause = reason && reason.cause
                ? (reason.cause.message || reason.cause.code || String(reason.cause))
                : '';
            failed.push({ server: server.id, error: message, cause });
            diagnostics.log('server.failed', { server: server.id, error: message, cause });
            return;
        }
        const value = Array.isArray(result.value) ? result.value : [];
        value.forEach(stream => {
            if (!stream || !stream.url) return;
            if (seen.has(stream.url)) return;
            seen.add(stream.url);
            streams.push(stream);
        });
    });

    diagnostics.log('streams.resolved', {
        tmdbId, mediaType, seasonNum, episodeNum,
        servers: SERVERS.length,
        failedServers: failed,
        elapsedMs: Date.now() - started,
        count: streams.length,
        streams: streams.map(stream => ({
            name: stream.name,
            quality: stream.quality,
            url: stream.url
        }))
    });
    return streams;
}

// Wrapper that accepts the outer abort signal. Split out so the outer
// withTimeout above can be used to guarantee the whole server (fetch +
// decrypt + parse) cannot outlive its budget.
async function fetchServerStreamsInner(server, details, tmdbId, seasonNum, episodeNum, seed, outerSignal) {
    const titleOverride = server.useGermanTitle ? details.germanTitle : null;
    const url = buildSourceUrl(server, details, tmdbId, seasonNum, episodeNum, seed, titleOverride);
    diagnostics.log('server.request', { server: server.id, label: server.label, url });

    // ---- Step 1: fetch the encrypted source payload ----
    let encryptedText;
    {
        const response = await providerFetch(url, {
            headers: VIDEASY_HEADERS,
            signal: outerSignal
        });
        if (!response.ok) {
            diagnostics.log('server.http_error', { server: server.id, status: response.status });
            return [];
        }
        encryptedText = await response.text();
    }

    if (!encryptedText || encryptedText.length < 20 || encryptedText.startsWith('<')) {
        diagnostics.log('server.empty_response', {
            server: server.id,
            length: encryptedText ? encryptedText.length : 0
        });
        return [];
    }

    // ---- Step 2: decrypt ----
    const decryptResponse = await providerFetch(`${ENC_DEC_API}/dec-videasy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: encryptedText, id: String(tmdbId), seed }),
        signal: outerSignal
    });
    if (!decryptResponse.ok) {
        diagnostics.log('server.decrypt_http_error', { server: server.id, status: decryptResponse.status });
        return [];
    }
    const decryptText = await decryptResponse.text();
    let parsed;
    try {
        parsed = JSON.parse(decryptText);
    } catch (parseError) {
        diagnostics.log('server.decrypt_bad_json', {
            server: server.id,
            error: parseError.message,
            preview: decryptText.slice(0, 120)
        });
        return [];
    }
    const payload = validateDecryptResponse(parsed);

    // ---- Step 3: shape into streams ----
    const sources = getSources(payload);
    const subtitles = getSubtitles(payload);

    // Keep every source with a url. Language filtering is done on
    // `server.language`, never on `server.quality` (a server's declared
    // quality is informational only).
    const kept = sources.filter(source => source && source.url);
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
            subtitles: Array.isArray(subtitles) ? subtitles : [],
            headers: {
                Referer: VIDEASY_HEADERS.Referer,
                Origin: VIDEASY_HEADERS.Origin
            }
        };
    });
}

module.exports = {
    getVideasyStreams,
    getStreams: getVideasyStreams,
    buildSourceUrl,
    SERVERS,
    getVideasyProxyStatus: proxy.getStatus
};