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

import { gotScraping } from 'got-scraping';

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
async function http(url, { method = 'GET', headers = {}, body, json, asXhr = false } = {}) {
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
        // Browser-impersonating TLS + header generator.
        headerGeneratorOptions: {
            browsers: ['chrome'],
            operatingSystems: ['windows'],
            locales: ['en-US'],
        },
        http2: true,                         // vidup front-door expects h2
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

    const res = await gotScraping(opts);

    if (res.statusCode === 403 || res.statusCode === 503) {
        const e = new Error(`Request blocked (${res.statusCode}) at ${url}`);
        e.statusCode = res.statusCode;
        e.body = String(res.body).slice(0, 500);
        throw e;
    }
    if (res.statusCode >= 400) {
        const e = new Error(`HTTP ${res.statusCode} at ${url}`);
        e.statusCode = res.statusCode;
        e.body = String(res.body).slice(0, 500);
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
export async function getVidupStreams(
    tmdbId,
    mediaType = 'movie',
    seasonNum = null,
    episodeNum = null,
    options = {}
) {
    const { onlyServerIndex = null, concurrency = 5, silent = false } = options;

    // ---- Input validation ----
    if (tmdbId === null || tmdbId === undefined || tmdbId === '') {
        throw new Error('getVidupStreams: tmdbId is required');
    }
    if (mediaType !== 'movie' && mediaType !== 'tv') {
        throw new Error(`getVidupStreams: mediaType must be 'movie' or 'tv' (got ${JSON.stringify(mediaType)})`);
    }
    if (mediaType === 'tv') {
        if (seasonNum === null || episodeNum === null) {
            throw new Error('getVidupStreams: seasonNum and episodeNum are required when mediaType is "tv"');
        }
    }

    const headers = { ...BASE_HEADERS };

    // ---- Step 1: Fetch page and pull out the embedded `en`/`token` field.
    const pageUrl = buildPageUrl(mediaType, tmdbId, seasonNum, episodeNum);
    const pageRes = await http(pageUrl);
    const html = pageRes.body;

    const tokenMatch = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!tokenMatch) {
        throw new Error('Could not find embedded en/token in vidup page');
    }
    const enToken = tokenMatch[1];

    // ---- Step 2: Stage 1 - ask enc-dec to interpret the token. Returns an
    // encrypted URL (`stage1`) and a CSRF token.
    const stage1Url = `${API}/enc-vidup?text=${encodeURIComponent(enToken)}&stage=1`;
    const stage1Res = await http(stage1Url);
    const parts1 = validate(JSON.parse(stage1Res.body), stage1Url);
    const stage1Encrypted = parts1.stage1;

    // ---- Step 3: POST to that encrypted URL with the CSRF token to get
    // more encrypted text to feed into stage 2.
    headers['X-CSRF-Token'] = parts1.token;
    const stage1Post = await http(stage1Encrypted, {
        method: 'POST',
        headers,
        asXhr: true,
    });
    const text = stage1Post.body;

    // ---- Step 4: Stage 2 - get the servers list, stream base URL, and a
    // new CSRF token.
    const stage2Url = `${API}/enc-vidup?text=${encodeURIComponent(text)}&stage=2`;
    const stage2Res = await http(stage2Url);
    const parts2 = validate(JSON.parse(stage2Res.body), stage2Url);
    const { servers: serversEndpoint, stream: streamEndpoint, token: csrfToken } = parts2;

    headers['X-CSRF-Token'] = csrfToken;

    // ---- Step 5: Fetch the encrypted servers payload and decrypt it.
    const serversEncRes = await http(serversEndpoint, {
        method: 'POST',
        headers,
        asXhr: true,
    });
    const serversEncrypted = serversEncRes.body;

    const decUrl = `${API}/dec-vidup`;
    const serversDecRes = await http(decUrl, {
        method: 'POST',
        json: { text: serversEncrypted },
        asXhr: true,
    });
    const serversDecrypted = validate(JSON.parse(serversDecRes.body), decUrl);

    // ---- Step 6: Build the list of server indices to fetch.
    const indices = onlyServerIndex !== null
        ? [onlyServerIndex]
        : serversDecrypted.map((_, i) => i);

    if (onlyServerIndex !== null && (onlyServerIndex < 0 || onlyServerIndex >= serversDecrypted.length)) {
        throw new Error(`onlyServerIndex ${onlyServerIndex} out of range (have ${serversDecrypted.length} servers)`);
    }

    // ---- Step 7: Fetch each server's stream in parallel (bounded).
    const fetchOne = async (idx) => {
        const server = serversDecrypted[idx];
        const streamUrl = `${streamEndpoint}/${server.data}`;

        const streamEncRes = await http(streamUrl, {
            method: 'POST',
            headers,
            asXhr: true,
        });
        const streamEncrypted = streamEncRes.body;

        const finalDecRes = await http(decUrl, {
            method: 'POST',
            json: { text: streamEncrypted },
            asXhr: true,
        });
        const streamData = validate(JSON.parse(finalDecRes.body), decUrl);

        return formatStreamObject(server, streamData);
    };

    // Simple bounded concurrency (Promise.all in chunks).
    const results = new Array(indices.length);
    let cursor = 0;
    async function worker() {
        while (cursor < indices.length) {
            const idx = indices[cursor++];
            const serverName = serversDecrypted[idx]?.name ?? `server[${idx}]`;
            try {
                results[idx] = { ok: true, value: await fetchOne(idx) };
            } catch (err) {
                if (!silent) console.warn(`[vidup] ${serverName} (idx ${idx}) failed: ${err.message}`);
                results[idx] = { ok: false, idx, error: err.message, serverName };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, indices.length) }, worker));

    // Build the final array in the original server order, dropping failures.
    const streams = [];
    for (const idx of indices) {
        const r = results[idx];
        if (r?.ok) streams.push(r.value);
    }
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

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    (async () => {
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
            console.error('\nFATAL:', err.message);
            if (err.body) console.error('Response body:', err.body);
            process.exit(1);
        }
    })();
}