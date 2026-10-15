// vidup.js - extracts decrypted stream URLs from vidup.to via enc-dec.app
//
// Why this works without 403 errors:
//   1. TLS fingerprint. Plain Node `https` / `fetch` has a distinctive
//      TLS fingerprint (JA3: eb67d79ef3a33513cce1b9a1b1084995) that
//      Cloudflare/anubis-style front-doors reject. `got-scraping` patches
//      the TLS stack to match real Chrome (cipher/extension order, ALPN,
//      GREASE, HTTP/2 SETTINGS) - same job `curl_cffi` does for Python.
//   2. Header order / X-Requested-With on initial GET. Cloudflare's WAF
//      returns 403 when the initial page navigation carries
//      `X-Requested-With: XMLHttpRequest`, because real browsers only
//      send that on XHR/fetch calls. The Python original sets it
//      globally and gets away with it via curl_cffi's deeper TLS
//      impersonation, but in Node we have to behave more strictly:
//      no X-Requested-With on the initial GET; only on POST API calls.
//
// Public API:
//   import { getVidupStreams } from './vidup.js';
//   const streams = await getVidupStreams('1399', 'tv', 1, 1);
//   streams.forEach(s => console.log(s.name, s.url));
//
// CLI:
//   node vidup.js                       (GoT S01E01 default)
//   node vidup.js movie <tmdb|imdb>
//   node vidup.js tv    <tmdb|imdb> <season> <episode>
//
// Logging:
//   - Default:       progress + warnings + errors.
//   - VIDUP_DEBUG=1: full request/response detail + stack traces + timings.
//
// Author: MiniMax Agent

const nodeHttp = require('node:http');
const https = require('node:https');

// The provider registry is CommonJS and cPanel deployments commonly run
// Node versions where eagerly loading this ESM dependency during `require()`
// is unreliable. Load it only when Vidup actually makes its first request.
let gotScrapingPromise;
async function getGotScraping() {
    gotScrapingPromise ||= import('got-scraping').then(module => module.gotScraping);
    return gotScrapingPromise;
}

// Dynamic import keeps this provider compatible with CommonJS callers.
let dnsModule;
function loadDns() {
    return dnsModule ??= import('../utils/dns-fix.mjs');
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const DEBUG = process.env.VIDUP_DEBUG === '1' || process.env.VIDUP_DEBUG === 'true';

function ts() {
    const d = new Date();
    return d.toISOString().split('T')[1].replace('Z', '');
}

function fmtBytes(n) {
    if (n === undefined || n === null) return '?B';
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function log(level, tag, msg, extra) {
    const line = `[${ts()}] [${level}] [vidup:${tag}] ${msg}`;
    if (extra !== undefined) {
        if (level === 'ERROR' || level === 'WARN') {
            console.error(line, extra);
        } else {
            console.log(line, extra);
        }
    } else if (level === 'ERROR' || level === 'WARN') {
        console.error(line);
    } else {
        console.log(line);
    }
}

const dlog = (tag, msg, extra) => DEBUG && log('DEBUG', tag, msg, extra);
const ilog = (tag, msg, extra) => log('INFO', tag, msg, extra);
const wlog = (tag, msg, extra) => log('WARN', tag, msg, extra);
const elog = (tag, msg, extra) => log('ERROR', tag, msg, extra);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Default headers. Note: NO X-Requested-With on this dict - we add it
// per-request only when acting like an XHR/fetch call (see http()).
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Referer': 'https://vidup.to/',
};

const API = 'https://enc-dec.app/api';
const REFERER = BASE_HEADERS.Referer;
const ORIGIN  = REFERER.replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Mirrors the Python `validate()` function from the original sample.
function validate(data, path) {
    if (data?.status !== 200) {
        elog('validate', `enc-dec API returned non-200 status for ${path}`, {
            status: data?.status,
            error: data?.error,
            payload: data,
        });
        const err = new Error(`enc-dec API returned status ${data?.status} for ${path}: ${data?.error ?? 'unknown'}`);
        err.payload = data;
        throw err;
    }
    return data.result;
}

// Centralised request helper - all HTTP goes through here so headers
// and TLS impersonation are applied consistently.
//
//   asXhr=true  -> adds X-Requested-With + JSON-friendly Accept.
//                  Use for POST/fetch calls to enc-dec and vidup.
//
// The initial page GET MUST NOT carry X-Requested-With (Cloudflare
// WAF returns 403). Real browsers don't either, so this matches.
async function http(url, { method = 'GET', headers = {}, body, json, asXhr = false, tag = 'http' } = {}) {
    const finalHeaders = { ...BASE_HEADERS, ...headers };
    if (asXhr) {
        finalHeaders['X-Requested-With'] = 'XMLHttpRequest';
        finalHeaders['Accept'] = finalHeaders['Accept'] || 'application/json, text/plain, */*';
    } else {
        finalHeaders['Accept'] = finalHeaders['Accept']
            || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
        finalHeaders['Accept-Language'] = finalHeaders['Accept-Language'] || 'en-US,en;q=0.9';
    }

    const opts = {
        url,
        method,
        headers: finalHeaders,
        // Keep the transport's TLS impersonation, but do not invoke the
        // optional header-generator preset. On cPanel/Passenger it can
        // collide with the host's stdin/socket wrapper and fail with
        // `open EEXIST` or an undefined browser-version table.
        useHeaderGenerator: false,
        // cPanel/Passenger can reject got-scraping's wrapped HTTP/2 agent
        // with `open EEXIST`; use Node's stable HTTP/1.1 global agents.
        http2: false,
        agent: { http: nodeHttp.globalAgent, https: https.globalAgent },
        retry: { limit: 3, methods: ['GET'] },
        throwHttpErrors: false,
        responseType: 'text',
        timeout: { request: 30000 },
    };

    if (json !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(json);
    } else if (body !== undefined) {
        opts.body = body;
    }

    dlog(tag, `--> ${method} ${url}`, {
        asXhr,
        headerKeys: Object.keys(finalHeaders),
        bodyPreview: json ? JSON.stringify(json).slice(0, 200) : (body ? String(body).slice(0, 200) : undefined),
    });

    const t0 = Date.now();
    let res;
    try {
        const gotScraping = await getGotScraping();
        res = await gotScraping(opts);
    } catch (err) {
        elog(tag, `<-- NETWORK ERROR ${method} ${url} (${Date.now() - t0}ms)`, {
            message: err.message,
            code: err.code,
            stack: DEBUG ? err.stack : undefined,
        });
        throw err;
    }

    const elapsed = Date.now() - t0;
    const bodyStr = res.body === undefined || res.body === null ? '' : String(res.body);
    const bodyLen = bodyStr.length;

    dlog(tag, `<-- ${res.statusCode} ${method} ${url} (${elapsed}ms, ${fmtBytes(bodyLen)})`, {
        status: res.statusCode,
        bodyPreview: bodyStr.slice(0, 300),
    });

    if (res.statusCode === 403 || res.statusCode === 503) {
        const snippet = bodyStr.slice(0, 500);
        elog(tag, `BLOCKED by WAF (${res.statusCode}) ${url}`, {
            status: res.statusCode,
            elapsedMs: elapsed,
            bodySnippet: snippet,
        });
        const e = new Error(`Request blocked (${res.statusCode}) at ${url}`);
        e.statusCode = res.statusCode;
        e.body = snippet;
        throw e;
    }
    if (res.statusCode >= 400) {
        const snippet = bodyStr.slice(0, 500);
        elog(tag, `HTTP ERROR ${res.statusCode} ${url}`, {
            status: res.statusCode,
            elapsedMs: elapsed,
            bodySnippet: snippet,
        });
        const e = new Error(`HTTP ${res.statusCode} at ${url}`);
        e.statusCode = res.statusCode;
        e.body = snippet;
        throw e;
    }
    return res;
}

// Build the vidup.to page URL for the requested media.
//   Movie: https://vidup.to/movie/{TMDB_ID}
//   Tv:    https://vidup.to/tv/{TMDB_ID}/{season}/{episode}
function buildPageUrl(mediaType, tmdbId, seasonNum, episodeNum) {
    if (mediaType === 'movie') return `https://vidup.to/movie/${tmdbId}/`;
    if (mediaType === 'tv')    return `https://vidup.to/tv/${tmdbId}/${seasonNum}/${episodeNum}/`;
    throw new Error(`Unsupported mediaType: ${mediaType} (expected 'movie' or 'tv')`);
}

// ---------------------------------------------------------------------------
// Stream-object formatting
// ---------------------------------------------------------------------------

/**
 * Detect format + mimeType from the URL's file extension / known markers.
 */
function detectFormat(url) {
    const u = (url ?? '').toLowerCase();
    if (u.includes('.m3u8') || u.includes('m3u8')) {
        return { format: 'hls', mimeType: 'application/vnd.apple.mpegurl' };
    }
    if (u.includes('.mpd')) {
        return { format: 'dash', mimeType: 'application/dash+xml' };
    }
    if (u.includes('.mp4')) {
        return { format: 'mp4', mimeType: 'video/mp4' };
    }
    if (u.includes('.mkv')) {
        return { format: 'mkv', mimeType: 'video/x-matroska' };
    }
    if (u.includes('.webm')) {
        return { format: 'webm', mimeType: 'video/webm' };
    }
    return { format: 'hls', mimeType: 'application/vnd.apple.mpegurl' }; // vidup's default
}

/**
 * Detect quality from the URL or from `4kAvailable` flag in the payload.
 * Falls back to "1080p" (vidup's typical default).
 */
function detectQuality(streamData) {
    const url = streamData?.url ?? '';
    // Common patterns:
    //   .../index-s1080p-v1-...m3u8    -> -s1080p-
    //   .../1080p/...                  -> /1080p/
    //   .../_1080p.m3u8                -> _1080p.
    //   .../index-s2160p-v1-a1.m3u8    -> -s2160p-
    //   .../master.m3u8                -> no match
    const m = url.match(/(?:^|[/\-_])s?(\d{3,4})p(?:[/\-_]|\.|$)/i);
    if (m) return `${m[1]}p`;
    if (streamData?.quality) return streamData.quality;
    if (streamData?.['4kAvailable']) return '2160p';
    return '1080p';
}

/**
 * Map a raw `tracks` array from enc-dec into the subtitle shape.
 * Each track becomes:
 *   { url, lang, label }
 */
function buildSubtitles(tracks) {
    if (!Array.isArray(tracks)) return [];
    return tracks.map(t => ({
        url: t.file || t.url || '',
        lang: t.language || t.lang || t.label || 'unknown',
        label: t.label || t.language || t.lang || '',
    })).filter(s => s.url);
}

/**
 * Build the standardised stream object from a server entry + decrypted
 * stream payload. The schema matches the requested format:
 *
 *   {
 *     name, title, url, quality, provider,
 *     headers: { Referer, Origin },
 *     format, mimeType, subtitles
 *   }
 */
function formatStreamObject(server, streamData) {
    const url = streamData?.url ?? '';
    const rawName = (server?.name ?? 'Unknown').trim();
    // Provider = first whitespace-separated word of the server name
    // (e.g. "Videasy Miami" -> "Videasy"; "Euro" -> "Euro").
    const provider = rawName.split(/\s+/)[0] || rawName;
    const { format, mimeType } = detectFormat(url);
    const quality = detectQuality(streamData);
    const subtitles = buildSubtitles(streamData?.tracks);

    return {
        name: rawName,
        title: `${rawName} - ${quality}`,
        url,
        quality,
        provider,
        headers: {
            Referer: REFERER,
            Origin: ORIGIN,
        },
        format,
        mimeType,
        subtitles,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch decrypted stream metadata for a movie or TV episode from vidup.to,
 * returning one stream object per available server.
 *
 * Internally performs the full enc-dec.app handshake (stage1 -> stage2 ->
 * servers -> per-server stream -> decrypt) using TLS-impersonated HTTP/2 so
 * Cloudflare's anti-bot WAF does not return 403.
 *
 * Streams are fetched in parallel (up to `concurrency` at a time).  If a
 * single server fails, that stream is skipped with a console warning and
 * the remaining servers are still returned.
 *
 * @param {string|number} tmdbId           TMDB id (or IMDB id - vidup accepts both).
 * @param {'movie'|'tv'}  [mediaType='movie']  Either 'movie' or 'tv'.
 * @param {number|null}   [seasonNum=null]      Required when mediaType === 'tv'.
 * @param {number|null}   [episodeNum=null]     Required when mediaType === 'tv'.
 * @param {object}        [options]
 * @param {number|null}   [options.onlyServerIndex=null]  If set, only return the
 *                                                         stream for this server
 *                                                         index (0..N-1).  Default
 *                                                         = return all servers.
 * @param {number}        [options.concurrency=5]  Max parallel stream fetches.
 * @param {boolean}       [options.silent=false]   Suppress per-server warnings.
 *
 * @returns {Promise<Array<{
 *   name: string,
 *   title: string,
 *   url: string,
 *   quality: string,
 *   provider: string,
 *   headers: { Referer: string, Origin: string },
 *   format: string,             // 'hls' | 'dash' | 'mp4' | 'mkv' | 'webm'
 *   mimeType: string,
 *   subtitles: Array<{ url: string, lang: string, label: string }>
 * }>>}
 *
 * @throws {Error} If a non-recoverable failure happens (input validation,
 *                 page fetch failure, enc-dec stage1/stage2/dec failure).
 *
 * @example
 *   const streams = await getVidupStreams('1399', 'tv', 1, 1);
 *   streams.forEach(s => console.log(`${s.name}: ${s.url} (${s.quality})`));
 *
 * @example
 *   const [first] = await getVidupStreams('27205', 'movie', null, null);
 *   // Play first.stream.url with Referer set on the <video> tag
 */
async function getVidupStreams(
    tmdbId,
    mediaType = 'movie',
    seasonNum = null,
    episodeNum = null,
    options = {}
) {
    const { onlyServerIndex = null, concurrency = 5, silent = false } = options;

    const totalStart = Date.now();
    ilog('start', `getVidupStreams(tmdbId=${tmdbId}, type=${mediaType}${seasonNum != null ? `, S${seasonNum}E${episodeNum}` : ''})`, {
        onlyServerIndex,
        concurrency,
        debug: DEBUG,
    });

    // ---- Input validation ----
    if (tmdbId === null || tmdbId === undefined || tmdbId === '') {
        elog('input', 'tmdbId is required');
        throw new Error('getVidupStreams: tmdbId is required');
    }
    if (mediaType !== 'movie' && mediaType !== 'tv') {
        elog('input', `invalid mediaType: ${JSON.stringify(mediaType)}`);
        throw new Error(`getVidupStreams: mediaType must be 'movie' or 'tv' (got ${JSON.stringify(mediaType)})`);
    }
    if (mediaType === 'tv') {
        if (seasonNum === null || episodeNum === null) {
            elog('input', 'tv requested but season/episode missing');
            throw new Error('getVidupStreams: seasonNum and episodeNum are required when mediaType is "tv"');
        }
    }
    dlog('input', 'input validation passed');

    const headers = { ...BASE_HEADERS };

    // ---- Step 1: Fetch page and pull out the embedded `en`/`token` field.
    const pageUrl = buildPageUrl(mediaType, tmdbId, seasonNum, episodeNum);
    ilog('step1', `fetching vidup page: ${pageUrl}`);
    const t1 = Date.now();
    let pageRes;
    try {
        pageRes = await http(pageUrl, { tag: 'page' });
    } catch (err) {
        elog('step1', `failed to fetch vidup page (${Date.now() - t1}ms): ${err.message}`, {
            status: err.statusCode,
            body: err.body,
            stack: DEBUG ? err.stack : undefined,
        });
        throw err;
    }
    const html = pageRes.body;
    ilog('step1', `page fetched OK (${Date.now() - t1}ms, ${fmtBytes(html.length)})`);

    const tokenMatch = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!tokenMatch) {
        elog('step1', 'no embedded en/token field found in vidup HTML', {
            htmlLength: html.length,
            htmlPreview: html.slice(0, 500),
        });
        throw new Error('Could not find embedded en/token in vidup page');
    }
    const enToken = tokenMatch[1];
    ilog('step1', `extracted en/token (len=${enToken.length})`);

    // ---- Step 2: Stage 1 - ask enc-dec to interpret the token. Returns an
    // encrypted URL (`stage1`) and a CSRF token.
    ilog('step2', 'enc-dec stage1 GET');
    const stage1Url = `${API}/enc-vidup?text=${encodeURIComponent(enToken)}&stage=1`;
    const t2 = Date.now();
    let stage1Res;
    try {
        stage1Res = await http(stage1Url, { tag: 'stage1' });
    } catch (err) {
        elog('step2', `stage1 GET failed (${Date.now() - t2}ms): ${err.message}`, {
            status: err.statusCode,
            body: err.body,
        });
        throw err;
    }
    let parts1;
    try {
        parts1 = validate(JSON.parse(stage1Res.body), stage1Url);
    } catch (err) {
        elog('step2', `stage1 JSON parse or validation failed`, {
            raw: stage1Res.body?.slice(0, 500),
            error: err.message,
        });
        throw err;
    }
    const stage1Encrypted = parts1.stage1;
    ilog('step2', `stage1 OK (${Date.now() - t2}ms) - got stage1 URL + CSRF token`, {
        stage1Url: stage1Encrypted,
        csrfPrefix: parts1.token?.slice(0, 8) + '...',
    });

    // ---- Step 3: POST to that encrypted URL with the CSRF token to get
    // more encrypted text to feed into stage 2.
    ilog('step3', `POST to stage1 URL with CSRF`);
    headers['X-CSRF-Token'] = parts1.token;
    const t3 = Date.now();
    let stage1Post;
    try {
        stage1Post = await http(stage1Encrypted, {
            method: 'POST',
            headers,
            asXhr: true,
            tag: 'stage1-post',
        });
    } catch (err) {
        elog('step3', `stage1 POST failed (${Date.now() - t3}ms): ${err.message}`, {
            status: err.statusCode,
            body: err.body,
        });
        throw err;
    }
    const text = stage1Post.body;
    ilog('step3', `stage1 POST OK (${Date.now() - t3}ms, ${fmtBytes(text.length)})`);

    // ---- Step 4: Stage 2 - get the servers list, stream base URL, and a
    // new CSRF token.
    ilog('step4', 'enc-dec stage2 GET');
    const stage2Url = `${API}/enc-vidup?text=${encodeURIComponent(text)}&stage=2`;
    const t4 = Date.now();
    let stage2Res;
    try {
        stage2Res = await http(stage2Url, { tag: 'stage2' });
    } catch (err) {
        elog('step4', `stage2 GET failed (${Date.now() - t4}ms): ${err.message}`, {
            status: err.statusCode,
            body: err.body,
        });
        throw err;
    }
    let parts2;
    try {
        parts2 = validate(JSON.parse(stage2Res.body), stage2Url);
    } catch (err) {
        elog('step4', `stage2 JSON parse or validation failed`, {
            raw: stage2Res.body?.slice(0, 500),
            error: err.message,
        });
        throw err;
    }
    const { servers: serversEndpoint, stream: streamEndpoint, token: csrfToken } = parts2;
    ilog('step4', `stage2 OK (${Date.now() - t4}ms)`, {
        serversEndpoint,
        streamEndpoint,
        csrfPrefix: csrfToken?.slice(0, 8) + '...',
    });

    headers['X-CSRF-Token'] = csrfToken;

    // ---- Step 5: Fetch the encrypted servers payload and decrypt it.
    ilog('step5a', 'fetch encrypted servers list');
    const t5a = Date.now();
    let serversEncRes;
    try {
        serversEncRes = await http(serversEndpoint, {
            method: 'POST',
            headers,
            asXhr: true,
            tag: 'servers-fetch',
        });
    } catch (err) {
        elog('step5a', `servers fetch failed (${Date.now() - t5a}ms): ${err.message}`, {
            status: err.statusCode,
            body: err.body,
        });
        throw err;
    }
    const serversEncrypted = serversEncRes.body;
    ilog('step5a', `servers payload fetched (${Date.now() - t5a}ms, ${fmtBytes(serversEncrypted.length)})`);

    ilog('step5b', 'decrypt servers list via enc-dec /dec-vidup');
    const decUrl = `${API}/dec-vidup`;
    const t5b = Date.now();
    let serversDecRes;
    try {
        serversDecRes = await http(decUrl, {
            method: 'POST',
            json: { text: serversEncrypted },
            asXhr: true,
            tag: 'servers-dec',
        });
    } catch (err) {
        elog('step5b', `servers decrypt failed (${Date.now() - t5b}ms): ${err.message}`, {
            status: err.statusCode,
            body: err.body,
        });
        throw err;
    }
    let serversDecrypted;
    try {
        serversDecrypted = validate(JSON.parse(serversDecRes.body), decUrl);
    } catch (err) {
        elog('step5b', `servers decrypt JSON parse or validation failed`, {
            raw: serversDecRes.body?.slice(0, 500),
            error: err.message,
        });
        throw err;
    }
    ilog('step5b', `servers decrypted (${Date.now() - t5b}ms) - found ${serversDecrypted.length} server(s)`, {
        servers: serversDecrypted.map((s, i) => ({
            idx: i,
            name: s?.name,
            dataPrefix: s?.data ? String(s.data).slice(0, 24) + '...' : null,
        })),
    });

    // ---- Step 6: Build the list of server indices to fetch.
    const indices = onlyServerIndex !== null
        ? [onlyServerIndex]
        : serversDecrypted.map((_, i) => i);

    if (onlyServerIndex !== null && (onlyServerIndex < 0 || onlyServerIndex >= serversDecrypted.length)) {
        elog('step6', `onlyServerIndex ${onlyServerIndex} out of range (have ${serversDecrypted.length} servers)`);
        throw new Error(`onlyServerIndex ${onlyServerIndex} out of range (have ${serversDecrypted.length} servers)`);
    }
    ilog('step6', `will fetch ${indices.length} server(s) with concurrency=${concurrency}`);

    // ---- Step 7: Fetch each server's stream in parallel (bounded).
    const fetchOne = async (idx) => {
        const server = serversDecrypted[idx];
        const serverName = server?.name ?? `server[${idx}]`;
        dlog('fetch', `[${idx}] ${serverName}: begin`);
        const ts0 = Date.now();

        const streamUrl = `${streamEndpoint}/${server.data}`;
        dlog('fetch', `[${idx}] POST stream URL: ${streamUrl}`);

        let streamEncRes;
        try {
            streamEncRes = await http(streamUrl, {
                method: 'POST',
                headers,
                asXhr: true,
                tag: `stream-${idx}`,
            });
        } catch (err) {
            dlog('fetch', `[${idx}] stream fetch failed: ${err.message}`);
            throw err;
        }
        const streamEncrypted = streamEncRes.body;

        let finalDecRes;
        try {
            finalDecRes = await http(decUrl, {
                method: 'POST',
                json: { text: streamEncrypted },
                asXhr: true,
                tag: `stream-dec-${idx}`,
            });
        } catch (err) {
            dlog('fetch', `[${idx}] stream decrypt failed: ${err.message}`);
            throw err;
        }

        let streamData;
        try {
            streamData = validate(JSON.parse(finalDecRes.body), decUrl);
        } catch (err) {
            dlog('fetch', `[${idx}] stream validate failed: ${err.message}`);
            throw err;
        }

        const formatted = formatStreamObject(server, streamData);
        ilog('fetch', `[${idx}] ${serverName} OK (${Date.now() - ts0}ms)`, {
            quality: formatted.quality,
            format: formatted.format,
            urlPrefix: formatted.url?.slice(0, 80),
            subs: formatted.subtitles.length,
        });
        return formatted;
    };

    // Simple bounded concurrency (Promise.all in chunks).
    const results = new Array(indices.length);
    let cursor = 0;
    async function worker(workerId) {
        while (cursor < indices.length) {
            const idx = indices[cursor++];
            const serverName = serversDecrypted[idx]?.name ?? `server[${idx}]`;
            dlog('worker', `worker#${workerId} picked [${idx}] ${serverName}`);
            try {
                results[idx] = { ok: true, value: await fetchOne(idx) };
            } catch (err) {
                wlog('worker', `[${idx}] ${serverName} failed: ${err.message}`, DEBUG ? {
                    status: err.statusCode,
                    body: err.body,
                    stack: err.stack,
                } : undefined);
                if (!silent) console.warn(`[vidup] ${serverName} (idx ${idx}) failed: ${err.message}`);
                results[idx] = { ok: false, idx, error: err.message, serverName };
            }
        }
    }
    const workerCount = Math.min(concurrency, indices.length);
    const t7 = Date.now();
    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i)));
    ilog('step7', `all workers done in ${Date.now() - t7}ms`);

    // Build the final array in the original server order, dropping failures.
    const streams = [];
    for (const idx of indices) {
        const r = results[idx];
        if (r?.ok) streams.push(r.value);
        else dlog('step7', `dropping failed server [${idx}] ${r?.serverName}: ${r?.error}`);
    }
    ilog('done', `getVidupStreams complete in ${Date.now() - totalStart}ms`, {
        requested: indices.length,
        succeeded: streams.length,
        failed: indices.length - streams.length,
    });
    return streams;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs() {
    const [, , cmd, ...rest] = process.argv;
    if (cmd === 'movie') {
        const [id] = rest;
        if (!id) throw new Error('Usage: node vidup.js movie <tmdb|imdb>');
        return { tmdbId: id, mediaType: 'movie' };
    }
    if (cmd === 'tv') {
        const [id, s, e] = rest;
        if (!id || !s || !e) throw new Error('Usage: node vidup.js tv <tmdb|imdb> <season> <episode>');
        return { tmdbId: id, mediaType: 'tv', seasonNum: Number(s), episodeNum: Number(e) };
    }
    // Default: Game of Thrones S01E01
    return { tmdbId: '1399', mediaType: 'tv', seasonNum: 1, episodeNum: 1 };
}

const isMain = require.main === module;
if (isMain) {
    (async () => {
        ilog('cli', 'starting CLI', {
            argv: process.argv.slice(2),
            debug: DEBUG,
            pid: process.pid,
            node: process.version,
        });
        try {
            const args = parseArgs();
            const streams = await getVidupStreams(
                args.tmdbId,
                args.mediaType,
                args.seasonNum,
                args.episodeNum,
            );

            console.log(`\n${'-'.repeat(25)} ${streams.length} stream(s) ${'-'.repeat(25)}\n`);
            streams.forEach((s, i) => {
                console.log(`[${i}] ${s.name}  (${s.quality} / ${s.format})`);
                console.log(`    url: ${s.url}`);
                console.log(`    provider: ${s.provider}   subs: ${s.subtitles.length}`);
            });
            console.log(`\n${'-'.repeat(25)} Full JSON ${'-'.repeat(25)}\n`);
            console.log(JSON.stringify(streams, null, 2));
        } catch (err) {
            elog('cli', `FATAL: ${err.message}`, {
                status: err.statusCode,
                body: err.body,
                stack: DEBUG ? err.stack : undefined,
            });
            console.error('\nFATAL:', err.message);
            if (err.body) console.error('Response body:', err.body);
            process.exit(1);
        }
    })();
}

module.exports = { getVidupStreams };
