'use strict';

const { resolveImdbId } = require('../utils/tmdb');
const API_BASE = 'https://enc-dec.app/api';
const SOURCE_BASE = 'https://0123movie.space';
const SOURCE_REFERER = 'https://1hd.one/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT_MS = 20000;
const POW_MAX_COUNTER = 10000000;
const BLOCKS = 512;
const MASK = BLOCKS - 1;
const ROUNDS = 2;
const MUL_A = 2654435761;
const MUL_B = 2246822519;

function rot(value, shift) {
    return (value << shift | value >>> (32 - shift)) >>> 0;
}

function mul(value, factor) {
    return Math.imul(value, factor) >>> 0;
}

function mix(state) {
    state[0] = (state[0] + state[1]) >>> 0;
    state[3] = rot(state[3] ^ state[0], 16);
    state[2] = (state[2] + state[3]) >>> 0;
    state[1] = rot(state[1] ^ state[2], 12);
    state[0] = (state[0] + state[1]) >>> 0;
    state[3] = rot(state[3] ^ state[0], 8);
    state[2] = (state[2] + state[3]) >>> 0;
    state[1] = rot(state[1] ^ state[2], 7);
}

function hash(bytes) {
    const state = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
    for (let i = 0; i < bytes.length; i++) {
        state[0] = (state[0] + bytes[i]) >>> 0;
        state[0] = rot(state[0], 7);
        mix(state);
    }
    for (let i = 0; i < 8; i++) mix(state);

    const table = new Uint32Array(BLOCKS);
    for (let i = 0; i < BLOCKS; i++) {
        mix(state);
        table[i] = (state[0] ^ state[2]) >>> 0;
    }

    for (let round = 0; round < ROUNDS; round++) {
        for (let index = 0; index < BLOCKS; index++) {
            const tableIndex = table[index] & MASK;
            let value = (table[index] + table[tableIndex]) >>> 0;
            value = rot(value, 13);
            value = (value ^ mul(table[(index + 1) & MASK], MUL_A)) >>> 0;
            table[index] = value;
            state[0] = (state[0] ^ value) >>> 0;
            mix(state);
        }
    }

    const output = new Uint32Array(8);
    const width = BLOCKS / 8;
    for (let i = 0; i < 8; i++) {
        mix(state);
        let value = state[0];
        const offset = i * width;
        for (let index = 0; index < width; index++) {
            const tableValue = table[offset + index];
            value = (value + tableValue) >>> 0;
            value = rot(value, 5);
            value = (value ^ mul(tableValue, MUL_B)) >>> 0;
        }
        output[i] = (value ^ state[2]) >>> 0;
    }
    return output;
}

function latin1Bytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 255;
    return bytes;
}

function leadingZeros(words) {
    let total = 0;
    for (const word of words) {
        if (word === 0) {
            total += 32;
            continue;
        }
        return total + Math.clz32(word);
    }
    return total;
}

async function solvePow(data) {
    const nonce = String(data?.pow_nonce || '');
    const difficulty = Number(data?.pow_difficulty);
    if (!nonce || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 256) {
        throw new Error('Byse challenge has invalid proof-of-work parameters');
    }
    const prefix = `${nonce}:`;
    for (let counter = 0; counter < POW_MAX_COUNTER; counter++) {
        if (leadingZeros(hash(latin1Bytes(prefix + counter))) >= difficulty) return String(counter);
        if ((counter & 127) === 127) await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error('Byse proof-of-work exceeded the counter limit');
}

function parseEmbedUrl(embedUrl) {
    let parsed;
    try {
        parsed = new URL(String(embedUrl || ''));
    } catch {
        throw new Error('Byse requires a valid embed URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Byse embed URL must use HTTP or HTTPS');
    const match = parsed.pathname.match(/^\/[a-z]+\/([^/]+)\/?$/i);
    if (!match) throw new Error('Byse embed URL must use a player path such as /e/{code} or /d/{code}');
    return { embedUrl: parsed.href, embedOrigin: parsed.origin, code: decodeURIComponent(match[1]) };
}

async function requestJson(fetchImpl, url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, { ...options, signal: controller.signal });
        let body;
        try {
            body = await response.json();
        } catch {
            throw new Error(`Byse returned non-JSON data from ${new URL(url).hostname}`);
        }
        if (!response.ok) throw new Error(`Byse request failed (${response.status}) at ${new URL(url).hostname}`);
        return body;
    } finally {
        clearTimeout(timeout);
    }
}

function jsonRequest(method, headers, data) {
    return {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) })
    };
}

function validateServiceResponse(data, endpoint) {
    if (!data || Number(data.status) !== 200 || !Object.prototype.hasOwnProperty.call(data, 'result')) {
        throw new Error(`Byse encryption service rejected ${endpoint}: ${data?.error || 'invalid response'}`);
    }
    return data.result;
}

function getFrameOrigin(value) {
    let frame;
    try {
        frame = new URL(value);
    } catch {
        throw new Error('Byse details response is missing a valid embed_frame_url');
    }
    if (!['http:', 'https:'].includes(frame.protocol)) throw new Error('Byse frame URL must use HTTP or HTTPS');
    return { frameUrl: frame.href, frameOrigin: frame.origin };
}

async function getEmbedDetails(fetchImpl, embedOrigin, code, headers) {
    const modernUrl = `${embedOrigin}/api/videos/${encodeURIComponent(code)}/embed/details`;
    try {
        return await requestJson(fetchImpl, modernUrl, { headers });
    } catch (error) {
        if (!/request failed \(404\)/i.test(error.message)) throw error;
        const legacyUrl = `${embedOrigin}/api/videos/${encodeURIComponent(code)}/details`;
        return requestJson(fetchImpl, legacyUrl, { headers });
    }
}

function findSourceList(payload) {
    if (Array.isArray(payload)) return payload;
    const candidates = [
        payload?.sources,
        payload?.streams,
        payload?.data?.sources,
        payload?.data?.streams,
        payload?.result?.sources,
        payload?.result?.streams,
        payload?.playback?.sources,
        payload?.playback?.streams,
    ];
    const list = candidates.find(Array.isArray);
    if (list) return list;
    if (payload && typeof payload === 'object' && ['url', 'file', 'src', 'source', 'playback_url'].some(key => payload[key])) return [payload];
    if (typeof payload === 'string' && /^https?:\/\//i.test(payload)) return [payload];
    return [];
}

function sourceUrl(source) {
    if (typeof source === 'string') return source;
    if (!source || typeof source !== 'object') return '';
    for (const key of ['url', 'file', 'src', 'source', 'playback_url', 'hls', 'dash']) {
        const value = source[key];
        if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
        if (value && typeof value === 'object') {
            const nested = sourceUrl(value);
            if (nested) return nested;
        }
    }
    return '';
}

function inferQuality(source, url) {
    const hint = typeof source === 'object'
        ? `${source.quality || ''} ${source.label || ''} ${source.name || ''} ${source.resolution || ''}`
        : '';
    const match = `${hint} ${url}`.match(/\b(2160|1440|1080|720|540|480|360)p?\b/i);
    return match ? `${match[1]}p` : 'Auto';
}

function normalizeSources(payload, headers, embedUrl) {
    const candidates = findSourceList(payload);
    const streams = [];
    const seen = new Set();
    for (const source of candidates) {
        const url = sourceUrl(source);
        if (!url || seen.has(url)) continue;
        let parsed;
        try {
            parsed = new URL(url);
        } catch {
            continue;
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        seen.add(url);
        const sourceHeaders = source && typeof source === 'object' && source.headers && typeof source.headers === 'object'
            ? source.headers
            : {};
        const pathname = parsed.pathname.toLowerCase();
        const format = pathname.endsWith('.m3u8') ? 'hls'
            : pathname.endsWith('.mpd') ? 'dash'
                : pathname.endsWith('.mkv') ? 'mkv'
                    : pathname.endsWith('.webm') ? 'webm' : 'mp4';
        const language = typeof source === 'object'
            ? String(source.language || source.lang || source.audio || 'Original')
            : 'Original';
        const quality = inferQuality(source, url);
        streams.push({
            name: `Byse ${quality}`,
            title: `Byse - ${quality} - ${language}`,
            url,
            quality,
            language,
            provider: 'byse',
            type: format === 'hls' || format === 'dash' ? format : 'direct',
            format,
            mimeType: format === 'hls' ? 'application/vnd.apple.mpegurl'
                : format === 'dash' ? 'application/dash+xml'
                    : format === 'mkv' ? 'video/x-matroska'
                        : format === 'webm' ? 'video/webm' : 'video/mp4',
            subtitles: [],
            headers: { ...headers, ...sourceHeaders },
            embedUrl,
        });
    }
    return streams;
}

async function resolveEmbed(embedUrl, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available in this runtime');
    const embed = parseEmbedUrl(embedUrl);
    const baseHeaders = {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        Referer: embed.embedUrl,
        Origin: embed.embedOrigin,
    };

    const details = await getEmbedDetails(fetchImpl, embed.embedOrigin, embed.code, baseHeaders);
    const { frameUrl, frameOrigin } = getFrameOrigin(details?.embed_frame_url || embed.embedUrl);
    const frameHeaders = { ...baseHeaders, Referer: frameUrl, Origin: frameOrigin };

    const challenge = await requestJson(fetchImpl, `${frameOrigin}/api/videos/access/challenge`, jsonRequest('POST', frameHeaders));
    const encryptedChallenge = await requestJson(fetchImpl, `${API_BASE}/enc-byse`, jsonRequest('POST', {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
    }, { data: challenge }));
    const challengeResponse = validateServiceResponse(encryptedChallenge, 'enc-byse');

    const attest = await requestJson(fetchImpl, `${frameOrigin}/api/videos/access/attest`, jsonRequest('POST', frameHeaders, challengeResponse));
    for (const key of ['token', 'viewer_id', 'device_id', 'confidence']) {
        if (attest?.[key] == null) throw new Error(`Byse attestation is missing ${key}`);
    }
    const fingerprint = {
        fingerprint: {
            token: attest.token,
            viewer_id: attest.viewer_id,
            device_id: attest.device_id,
            confidence: attest.confidence,
        },
    };
    const sessionHeaders = {
        ...frameHeaders,
        'X-Embed-Parent': embed.embedUrl,
        Cookie: `byse_viewer_id=${attest.viewer_id}; byse_device_id=${attest.device_id}`,
    };

    const captcha = await requestJson(fetchImpl, `${frameOrigin}/api/videos/${encodeURIComponent(embed.code)}/embed/captcha`, jsonRequest('POST', sessionHeaders, fingerprint));
    const solution = await solvePow(captcha);
    const verified = await requestJson(fetchImpl, `${frameOrigin}/api/videos/${encodeURIComponent(embed.code)}/embed/captcha/verify`, jsonRequest('POST', sessionHeaders, {
        pow_token: captcha.pow_token,
        solution,
        ...fingerprint,
    }));
    if (!verified?.token) throw new Error('Byse captcha verification did not return a token');

    const playbackHeaders = { ...sessionHeaders, 'X-Captcha-Token': verified.token };
    const playback = await requestJson(fetchImpl, `${frameOrigin}/api/videos/${encodeURIComponent(embed.code)}/embed/playback`, jsonRequest('POST', playbackHeaders, fingerprint));
    const encryptedPlayback = await requestJson(fetchImpl, `${API_BASE}/dec-byse`, jsonRequest('POST', {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
    }, { data: playback }));
    const decrypted = validateServiceResponse(encryptedPlayback, 'dec-byse');

    const playbackRequestHeaders = {
        'User-Agent': USER_AGENT,
        Referer: frameOrigin,
        Origin: frameOrigin,
    };
    return normalizeSources(decrypted, playbackRequestHeaders, embed.embedUrl);
}

async function getEmbedUrl(tmdbId, mediaType = 'movie', season = null, episode = null, options = {}) {
    const id = String(tmdbId || '').trim();
    if (!id) throw new Error('Byse requires a TMDB ID');
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('Fetch is not available in this runtime');

    const inferredMediaType = season != null && episode != null ? 'tv' : 'movie';
    const normalizedMediaType = String(mediaType || '').toLowerCase() === inferredMediaType
        ? mediaType
        : inferredMediaType;
    const isSeries = normalizedMediaType === 'tv';
    let route;
    if (isSeries) {
        const seasonNumber = Number(season);
        const episodeNumber = Number(episode);
        if (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
            throw new Error('Byse series lookup requires positive season and episode numbers');
        }
        route = `/pl/${encodeURIComponent(id)}/${seasonNumber}/${episodeNumber}`;
    } else {
        const resolveId = options.resolveImdbIdFn || resolveImdbId;
        const imdbId = await resolveId('movie', id);
        if (!imdbId) throw new Error(`TMDB ${id} has no IMDb ID for the 0123movie movie route`);
        route = `/mv/${encodeURIComponent(imdbId)}/${encodeURIComponent(id)}/`;
    }

    let routeUrl = new URL(route, SOURCE_BASE).href;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const visited = new Set();
        for (let redirect = 0; redirect < 5; redirect++) {
            if (visited.has(routeUrl)) throw new Error('0123movie returned a redirect loop');
            visited.add(routeUrl);
            const response = await fetchImpl(routeUrl, {
                method: 'GET',
                redirect: 'manual',
                headers: { 'User-Agent': USER_AGENT, Referer: SOURCE_REFERER },
                signal: controller.signal,
            });
            const location = response.headers?.get?.('location') || response.headers?.location;
            if (!location) throw new Error(`0123movie did not return an embed Location header (HTTP ${response.status})`);
            const embedUrl = new URL(location, routeUrl).href;
            try {
                parseEmbedUrl(embedUrl);
                return embedUrl;
            } catch {
                if (new URL(embedUrl).origin !== SOURCE_BASE) {
                    const player = new URL(embedUrl);
                    throw new Error(`0123movie redirected to a non-Byse player (${player.origin}${player.pathname})`);
                }
                routeUrl = embedUrl;
            }
        }
        throw new Error('0123movie exceeded the redirect limit before returning a Byse embed');
    } finally {
        clearTimeout(timeout);
    }
}

async function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    try {
        const resolvedMediaType = season != null && episode != null ? 'tv' : 'movie';
        const embedUrl = await getEmbedUrl(tmdbId, resolvedMediaType, season, episode);
        const streams = await resolveEmbed(embedUrl);
        console.log(`[Byse] Resolved ${streams.length} stream(s) for TMDB ${tmdbId}`);
        return streams;
    } catch (error) {
        console.warn(`[Byse] Could not resolve embed: ${error.message}`);
        return [];
    }
}

module.exports = {
    getStreams,
    _test: { parseEmbedUrl, solvePow, hash, leadingZeros, findSourceList, sourceUrl, normalizeSources, getEmbedUrl, getEmbedDetails, resolveEmbed },
};
