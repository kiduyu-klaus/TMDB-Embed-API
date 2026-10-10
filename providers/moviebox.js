const CryptoJS = require('crypto-js');
const { getTmdbApiKey } = require('../utils/tmdbKey');
const fetch = globalThis.fetch || require('node-fetch');

const API_BASE = (process.env.MOVIEBOX_API_URL || 'https://api3.aoneroom.com').replace(/\/+$/, '');
const KEY_B64_DEFAULT = 'NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==';
const KEY_B64_ALT = 'WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==';
const PACKAGE_INFO = {
    package_name: 'com.community.mbox.in',
    version_name: '3.0.03.0529.03',
    version_code: 50020042
};
const BRAND_MODELS = {
    Samsung: ['SM-S918B', 'SM-A528B', 'SM-M336B'],
    Xiaomi: ['2201117TI', 'M2012K11AI', 'Redmi Note 11'],
    OnePlus: ['LE2111', 'CPH2449', 'IN2023'],
    Google: ['Pixel 6', 'Pixel 7', 'Pixel 8'],
    Realme: ['RMX3085', 'RMX3360', 'RMX3551']
};
const PLAYBACK_USER_AGENT =
    'com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; MovieBox; Build/BP22.250325.006; Cronet/133.0.6876.3)';
const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';
const DASH_MIME_TYPE = 'application/dash+xml';
const SUBTITLE_MIME_TYPES = {
    vtt: 'text/vtt', webvtt: 'text/vtt', srt: 'application/x-subrip', subrip: 'application/x-subrip',
    ass: 'text/x-ssa', ssa: 'text/x-ssa', ttml: 'application/ttml+xml', dfxp: 'application/ttml+xml',
    xml: 'application/ttml+xml', sub: 'application/vobsub', idx: 'application/vobsub', sup: 'application/pgs'
};
const REQUEST_TIMEOUT_MS = 30_000;
const PLAYBACK_ORIGIN = API_BASE;
const PLAYBACK_REFERER = `${API_BASE}/`;

const REQUEST_THROTTLE_MS = parseInt(process.env.MOVIEBOX_THROTTLE_MS || '100', 10);
let lastRequestTime = 0;

const SECRET_KEY_DEFAULT = CryptoJS.enc.Base64.parse(
    CryptoJS.enc.Base64.parse(KEY_B64_DEFAULT).toString(CryptoJS.enc.Utf8)
);
const SECRET_KEY_ALT = CryptoJS.enc.Base64.parse(
    CryptoJS.enc.Base64.parse(KEY_B64_ALT).toString(CryptoJS.enc.Utf8)
);

let bearerToken = '';
let tokenExpiresAt = 0;
let tokenPromise = null;
let deviceSession = null;

function randomHex(length) {
    let output = '';
    const alphabet = '0123456789abcdef';
    for (let index = 0; index < length; index += 1) {
        output += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return output;
}

function getDeviceSession() {
    if (deviceSession) return deviceSession;
    const brands = Object.keys(BRAND_MODELS);
    const brand = brands[Math.floor(Math.random() * brands.length)];
    const models = BRAND_MODELS[brand];
    deviceSession = {
        deviceId: randomHex(32),
        brand,
        model: models[Math.floor(Math.random() * models.length)]
    };
    return deviceSession;
}

function decodeJwtExpiry(token) {
    try {
        const payload = String(token).split('.')[1];
        if (!payload) return 0;
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        const json = Buffer.from(padded, 'base64').toString('utf8');
        return Number(JSON.parse(json).exp) || 0;
    } catch {
        return 0;
    }
}

function tokenIsUsable(token) {
    return Boolean(token) && decodeJwtExpiry(token) > (Date.now() / 1000) + 300;
}

function generateXClientToken(timestamp) {
    const value = String(timestamp);
    const reversed = value.split('').reverse().join('');
    return `${value},${CryptoJS.MD5(reversed).toString(CryptoJS.enc.Hex)}`;
}

function canonicalQuery(urlObject) {
    const keys = [...new Set([...urlObject.searchParams.keys()])].sort();
    return keys.flatMap(key =>
        urlObject.searchParams.getAll(key).map(value => `${key}=${value}`)
    ).join('&');
}

function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
    // Ensure relative paths work with URL parser
    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    const parsed = new URL(fullUrl);
    
    const query = canonicalQuery(parsed);
    const canonicalUrl = query ? `${parsed.pathname}?${query}` : parsed.pathname;
    
    // Ensure body is strictly treated as string
    const bodyText = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '');
    const bodyLength = bodyText ? Buffer.byteLength(bodyText, 'utf8').toString() : '';
    const bodyHash = bodyText ? CryptoJS.MD5(bodyText).toString(CryptoJS.enc.Hex) : '';

    return `${method.toUpperCase()}\n${accept}\n${contentType}\n${bodyLength}\n${timestamp}\n${bodyHash}\n${canonicalUrl}`;
}

function generateXTrSignature(method, accept, contentType, url, body, timestamp, useAltKey = false) {
    const canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
    const secret = useAltKey ? SECRET_KEY_ALT : SECRET_KEY_DEFAULT;
    const signature = CryptoJS.HmacMD5(canonical, secret).toString(CryptoJS.enc.Base64);
    return `${timestamp}|2|${signature}`;
}

function captureBearerToken(headers) {
    const xUser = headers.get ? headers.get('x-user') : headers['x-user'];
    if (!xUser) return;
    try {
        const parsed = typeof xUser === 'string' ? JSON.parse(xUser) : xUser;
        if (tokenIsUsable(parsed?.token)) {
            bearerToken = parsed.token;
            tokenExpiresAt = decodeJwtExpiry(parsed.token);
        }
    } catch {
        // Ignored
    }
}

function buildRequestHeaders(method, url, body, customHeaders = {}, token = '') {
    const timestamp = Date.now();
    const accept = customHeaders.Accept || customHeaders.accept || 'application/json';
    const contentType = customHeaders['Content-Type'] || customHeaders['content-type'] ||
        (body ? 'application/json; charset=utf-8' : 'application/json');
    const session = getDeviceSession();
    const clientInfo = JSON.stringify({
        ...PACKAGE_INFO,
        os: 'android',
        os_version: '16',
        device_id: session.deviceId,
        install_store: 'ps',
        gaid: 'd7578036d13336cc',
        brand: session.brand.toLowerCase(),
        model: session.model,
        system_language: 'en',
        net: 'NETWORK_WIFI',
        region: 'IN',
        timezone: 'Asia/Calcutta',
        sp_code: ''
    });
    return {
        Accept: accept,
        'Content-Type': contentType,
        'x-client-token': generateXClientToken(timestamp),
        'x-tr-signature': generateXTrSignature(method, accept, contentType, url, body, timestamp),
        'x-client-info': clientInfo,
        'x-client-status': '0',
        'User-Agent': PLAYBACK_USER_AGENT,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...customHeaders
    };
}

async function fetchWithTimeout(url, options, timeoutMs) {
    if (typeof AbortController === 'function') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timeoutId);
        }
    }
    return fetch(url, { ...options, timeout: timeoutMs });
}

async function fetchAnonymousToken() {
    if (tokenIsUsable(bearerToken) && tokenExpiresAt > (Date.now() / 1000) + 300) {
        return bearerToken;
    }
    if (tokenPromise) return tokenPromise;

    tokenPromise = (async () => {
        const url = `${API_BASE}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`;
        console.log('[MovieBox] Fetching anonymous token from: ' + url);
        try {
            const response = await fetchWithTimeout(url, {
                method: 'GET',
                headers: buildRequestHeaders('GET', url, '', {}, '')
            }, REQUEST_TIMEOUT_MS);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            captureBearerToken(response.headers);
            if (!tokenIsUsable(bearerToken)) {
                throw new Error('MovieBox did not return a usable anonymous token (x-user header missing or invalid)');
            }
            console.log('[MovieBox] Successfully obtained bearer token');
            return bearerToken;
        } catch (error) {
            console.error('[MovieBox] Failed to fetch token: ' + error.message);
            throw error;
        }
    })().finally(() => {
        tokenPromise = null;
    });
    return tokenPromise;
}

async function movieBoxRequest(method, path, bodyObject = null, retry = true, attempt = 1) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    
    // 1. Strictly stringify body ONCE so the exact same string is used for HMAC and Body
    const bodyString = bodyObject !== null ? JSON.stringify(bodyObject) : '';
    
    const token = await fetchAnonymousToken();

    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < REQUEST_THROTTLE_MS) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_THROTTLE_MS - timeSinceLastRequest));
    }
    lastRequestTime = Date.now();

    const t0 = Date.now();
    try {
        // Pass bodyString (not bodyObject) to build exact signature headers
        const headers = buildRequestHeaders(method, url, bodyString, {}, token);
        const response = await fetchWithTimeout(url, {
            method: method.toUpperCase(),
            headers: headers,
            // Only send body string if method is NOT GET/HEAD
            body: (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD' && bodyString) ? bodyString : undefined
        }, REQUEST_TIMEOUT_MS);

        const elapsed = Date.now() - t0;
        captureBearerToken(response.headers);

        if (!response.ok) {
            const status = response.status;
            let errorText = '';
            try { errorText = await response.text(); } catch { errorText = '(failed to read error response)'; }

            console.error(`[MovieBox] ${method} ${path} failed after ${elapsed}ms (status: ${status}): ${errorText}`);
            
            if (retry && (status === 401 || status === 403 || status === 429)) {
                if (status === 401 || status === 403) {
                    bearerToken = '';
                    tokenExpiresAt = 0;
                }
                await new Promise(resolve => setTimeout(resolve, status === 429 ? 2000 : 1000));
                return movieBoxRequest(method, path, bodyObject, false, attempt + 1);
            }
            throw new Error(`HTTP ${status}: ${errorText.substring(0, 200)}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`[MovieBox] ${method} ${path} request error: ${error.message}`);
        throw error;
    }
}
function normalizeTitle(value) {
    return String(value || '')
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, ' ')
        .toLowerCase()
        .replace(/:/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function subjectYear(subject) {
    return String(subject?.year || subject?.releaseDate || '').match(/\d{4}/)?.[0] || '';
}

function findBestMatch(subjects, details, mediaType) {
    const expectedType = mediaType === 'movie' ? 1 : 2;
    const titles = [details.title, details.originalTitle]
        .map(normalizeTitle)
        .filter(Boolean);
    let best = null;

    for (const subject of Array.isArray(subjects) ? subjects : []) {
        if (Number(subject?.subjectType) !== expectedType) continue;
        const candidate = normalizeTitle(subject.title);
        if (!candidate) continue;

        const exactTitle = titles.some(title => title === candidate);
        const partialTitle = titles.some(title =>
            title.includes(candidate) || candidate.includes(title)
        );
        const year = subjectYear(subject);
        const yearMatches = Boolean(details.year && year && String(details.year) === year);
        let score = exactTitle ? 60 : partialTitle ? 20 : 0;
        if (yearMatches) score += 40;
        if (!year && exactTitle) score += 5;
        if (!best || score > best.score) best = { subject, score };
    }

    return best && best.score >= 60 ? best.subject : null;
}

async function searchMovieBox(title) {
    console.log('[MovieBox] Searching for: "' + title + '"');
    try {
        const response = await movieBoxRequest(
            'POST',
            '/wefeed-mobile-bff/subject-api/search/v2',
            { page: 1, perPage: 20, keyword: title }
        );
        const results = (response?.data?.results || []).flatMap(group =>
            Array.isArray(group?.subjects) ? group.subjects : []
        );
        console.log('[MovieBox] Search returned ' + results.length + ' result(s)');
        return results;
    } catch (error) {
        console.error('[MovieBox] Search error for "' + title + '": ' + error.message);
        throw error;
    }
}

function formatQuality(value) {
    const text = String(value || '');
    const dimensions = text.match(/\b\d{3,4}\s*[xX]\s*(\d{3,4})\b/);
    if (dimensions) return `${Number(dimensions[1])}p`;
    const match = text.match(/(\d{3,4})/);
    return match ? `${Number(match[1])}p` : 'Auto';
}

function qualityNumber(value) {
    return Number(String(value || '').match(/(\d{3,4})/)?.[1]) || 0;
}

function getFormat(url) {
    const value = String(url || '').toLowerCase();
    if (/\.mpd(?:$|\?)/.test(value) || value.includes('playstream.mpd')) {
        return { type: 'dash', label: 'DASH', mimeType: DASH_MIME_TYPE };
    }
    if (/\.m3u8(?:$|\?)/.test(value)) {
        return { type: 'hls', label: 'HLS', mimeType: HLS_MIME_TYPE };
    }
    return { type: 'direct', label: /\.mkv(?:$|\?)/.test(value) ? 'MKV' : 'MP4' };
}

function validHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function inferSubtitleMimeType(subtitle) {
    const explicit = String(subtitle?.mimeType || subtitle?.contentType || '').trim().toLowerCase();
    if (explicit.startsWith('text/') || explicit.startsWith('application/')) return explicit;
    const format = String(subtitle?.format || subtitle?.type || subtitle?.ext || '').trim().toLowerCase();
    if (SUBTITLE_MIME_TYPES[format]) return SUBTITLE_MIME_TYPES[format];
    const rawUrl = subtitle?.url || subtitle?.file || subtitle?.src || '';
    try {
        const extension = new URL(rawUrl).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
        if (SUBTITLE_MIME_TYPES[extension]) return SUBTITLE_MIME_TYPES[extension];
    } catch {
        // Fall through to the default text caption format.
    }
    return 'text/vtt';
}

function normalizeSubtitle(caption, languageLabel) {
    const url = caption?.url || caption?.captionUrl;
    if (!validHttpUrl(url)) return null;
    const language = caption.language || caption.lanName || caption.lan || 'und';
    const label = `${caption.lanName || caption.language || caption.lan || 'Subtitle'} (${languageLabel})`;
    return {
        url,
        mimeType: inferSubtitleMimeType({ url, ...caption }),
        language,
        label,
        name: label,
        headers: {
            'User-Agent': PLAYBACK_USER_AGENT,
            Origin: PLAYBACK_ORIGIN,
            Referer: PLAYBACK_REFERER
        }
    };
}

async function fetchSubtitles(subjectId, streamId, languageLabel) {
    const results = [];
    const seen = new Set();
    const endpoints = [
        `/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${encodeURIComponent(subjectId)}&streamId=${encodeURIComponent(streamId)}`,
        `/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${encodeURIComponent(subjectId)}&resourceId=${encodeURIComponent(streamId)}&episode=0`
    ];
    for (const endpoint of endpoints) {
        try {
            const response = await movieBoxRequest('GET', endpoint);
            for (const caption of response?.data?.extCaptions || []) {
                const normalized = normalizeSubtitle(caption, languageLabel);
                if (normalized && !seen.has(normalized.url)) {
                    seen.add(normalized.url);
                    results.push(normalized);
                }
            }
        } catch {
            // Ignored
        }
    }
    return results;
}

async function getSubjectVariants(subjectId) {
    const response = await movieBoxRequest(
        'GET',
        `/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(subjectId)}`
    );
    const dubs = response?.data?.dubs;
    const variants = [];
    if (Array.isArray(dubs)) {
        for (const dub of dubs) {
            if (!dub?.subjectId) continue;
            variants.push({ id: dub.subjectId, language: dub.lanName || 'Original' });
        }
    }
    if (!variants.some(item => String(item.id) === String(subjectId))) {
        variants.unshift({ id: subjectId, language: 'Original' });
    }
    return variants;
}

function collectRawStreams(playData) {
    if (Array.isArray(playData?.streams) && playData.streams.length) {
        return playData.streams.map(stream => ({
            ...stream,
            url: stream.url,
            quality: stream.resolutions || stream.resolution || stream.quality
        }));
    }
    const fallback = [];
    for (const detector of playData?.resourceDetectors || []) {
        for (const video of detector?.resolutionList || []) {
            fallback.push({
                url: video.resourceLink,
                quality: video.resolution,
                id: video.id || video.resourceId
            });
        }
    }
    return fallback;
}

async function getStreamLinks(subjectId, season, episode, mediaTitle) {
    const variants = await getSubjectVariants(subjectId);
    const output = [];
    const seen = new Set();

    for (const variant of variants) {
        try {
            const response = await movieBoxRequest(
                'GET',
                `/wefeed-mobile-bff/subject-api/play-info?subjectId=${encodeURIComponent(variant.id)}&se=${season}&ep=${episode}`
            );
            for (const stream of collectRawStreams(response?.data)) {
                if (!validHttpUrl(stream.url) || seen.has(stream.url)) continue;
                seen.add(stream.url);
                const quality = formatQuality(stream.quality);
                const format = getFormat(stream.url);
                const streamId = stream.id || `${variant.id}|${season}|${episode}`;
                const subtitles = await fetchSubtitles(variant.id, streamId, variant.language);
                output.push({
                    name: 'MovieBox',
                    title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ''} (${variant.language}) - ${format.label} - ${quality}`,
                    url: stream.url,
                    quality,
                    provider: 'MovieBox',
                    type: format.type,
                    ...(format.mimeType ? { mimeType: format.mimeType } : {}),
                    headers: {
                        'User-Agent': PLAYBACK_USER_AGENT,
                        Origin: PLAYBACK_ORIGIN,
                        Referer: PLAYBACK_REFERER,
                        Accept: '*/*',
                        ...(stream.signCookie ? { Cookie: stream.signCookie } : {})
                    },
                    ...(subtitles.length ? { subtitles } : {})
                });
            }
        } catch (error) {
            console.warn(`[MovieBox] Stream lookup failed for a ${variant.language} variant: ${error.message}`);
        }
    }

    const sorted = output.sort((a, b) => qualityNumber(b.quality) - qualityNumber(a.quality));
    console.log(`[MovieBox] Emitting ${sorted.length} extracted stream(s)`);
    return sorted;
}

async function getMovieboxStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const animeSeries = mediaType === 'anime' && (seasonNum != null || episodeNum != null);
    const type = mediaType === 'tv' || mediaType === 'series' || animeSeries ? 'tv' : 'movie';
    console.log('[MovieBox] Fetching ' + type + ' streams for TMDB ID ' + tmdbId);
    try {
        if (type === 'tv' && (!Number.isInteger(Number(seasonNum)) || !Number.isInteger(Number(episodeNum)))) {
            console.warn('[MovieBox] TV request is missing season or episode');
            return [];
        }
        const tmdbApiKey = getTmdbApiKey();
        if (!tmdbApiKey) {
            console.error('[MovieBox] No TMDB API key configured');
            return [];
        }

        console.log('[MovieBox] Fetching details from TMDB...');
        const tmdbUrl = `https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(tmdbApiKey)}`;
        
        const tmdbResponse = await fetchWithTimeout(tmdbUrl, {}, 10_000);

        if (!tmdbResponse.ok) {
            throw new Error(`TMDB returned HTTP ${tmdbResponse.status}`);
        }

        const details = await tmdbResponse.json();
        const title = type === 'tv' ? details?.name : details?.title;
        const originalTitle = type === 'tv' ? details?.original_name : details?.original_title;
        const year = String(details?.first_air_date || details?.release_date || '').slice(0, 4);
        
        if (!title) {
            console.warn('[MovieBox] No title found in TMDB response');
            return [];
        }

        let subjects = await searchMovieBox(title);
        let match = findBestMatch(subjects, { title, originalTitle, year }, type);
        if (!match && originalTitle && normalizeTitle(originalTitle) !== normalizeTitle(title)) {
            subjects = await searchMovieBox(originalTitle);
            match = findBestMatch(subjects, { title, originalTitle, year }, type);
        }
        if (!match) {
            console.log('[MovieBox] No exact title/year/type match for "' + title + '"');
            return [];
        }

        const season = type === 'tv' ? Number(seasonNum) : 0;
        const episode = type === 'tv' ? Number(episodeNum) : 0;
        return await getStreamLinks(match.subjectId, season, episode, title);
    } catch (error) {
        console.error('[MovieBox] Provider error: ' + error.message);
        return [];
    }
}

module.exports = {
    getMovieboxStreams,
    normalizeTitle,
    findBestMatch,
    formatQuality,
    getFormat,
    collectRawStreams,
    buildCanonicalString,
    searchMovieBox
};
