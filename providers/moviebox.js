const CryptoJS = require('crypto-js');
const { getTmdbApiKey } = require('../utils/tmdbKey');
const { fetch } = require('../utils/providerFetch');

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
        .normalize('NFKC')
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, ' ')
        .toLowerCase()
        .replace(/:/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
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
        .filter(title => title.length >= 2);
    if (!titles.length) return null;
    let best = null;

    for (const subject of Array.isArray(subjects) ? subjects : []) {
        if (Number(subject?.subjectType) !== expectedType) continue;
        const candidate = normalizeTitle(subject.title);
        if (!candidate) continue;

        if (candidate.length < 2) continue;
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
    if (normalizeTitle(title).length < 2) {
        console.warn('[MovieBox] Search title is too short after normalization');
        return [];
    }
    try {
        const response = await movieBoxRequest(
            'POST',
            '/wefeed-mobile-bff/subject-api/search/v2',
            { page: 1, perPage: 20, keyword: title, restrictKid: 1 }
        );
        const results = (response?.data?.results || response?.data?.data?.results || []).flatMap(group =>
            Array.isArray(group?.subjects) ? group.subjects : []
        );
        console.log('[MovieBox] Search returned ' + results.length + ' result(s)');
        return results;
    } catch (error) {
        console.error('[MovieBox] Search error for "' + title + '": ' + error.message);
        throw error;
    }
}

function parseQualities(value) {
    const text = String(value || '');
    const dimensions = Array.from(text.matchAll(/\b\d{3,4}\s*[xX]\s*(\d{3,4})\b/g));
    const values = dimensions.length
        ? dimensions.map(match => Number(match[1]))
        : Array.from(text.matchAll(/(\d{3,4})/g), match => Number(match[1]));
    return [...new Set(values.filter(quality => quality >= 144 && quality <= 4320))]
        .sort((a, b) => b - a);
}

function formatQuality(value) {
    const quality = parseQualities(value)[0];
    return quality ? `${quality}p` : 'Auto';
}

function qualityNumber(value) {
    return Number(String(value || '').match(/(\d{3,4})/)?.[1]) || 0;
}

function getFormat(url, declaredFormat = '') {
    const value = String(url || '').toLowerCase();
    const declared = String(declaredFormat || '').toLowerCase();
    if (/\.mpd(?:$|[?#])/.test(value) || value.includes('playstream.mpd') || declared === 'dash') {
        return { type: 'dash', label: 'DASH', mimeType: DASH_MIME_TYPE };
    }
    if (/\.m3u8(?:$|[?#])/.test(value) || declared === 'hls') {
        return { type: 'hls', label: 'HLS', mimeType: HLS_MIME_TYPE };
    }
    if (declared === 'mp4') return { type: 'direct', label: 'MP4' };
    if (declared === 'mkv') return { type: 'direct', label: 'MKV' };
    return { type: 'direct', label: /\.mkv(?:$|[?#])/.test(value) ? 'MKV' : 'MP4' };
}

function validHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function extractPolicyResource(signCookie) {
    if (!signCookie || typeof signCookie !== 'string') return null;

    const edgeMatch = signCookie.match(/Edge-Cache-Cookie=urlprefix=([^:;\s]+)/);
    if (edgeMatch) {
        try {
            let encoded = edgeMatch[1].replace(/_/g, '/').replace(/-/g, '+');
            while (encoded.length % 4) encoded += '=';
            const resource = Buffer.from(encoded, 'base64').toString('utf8').replace(/\/+$/, '');
            if (validHttpUrl(resource)) return `${resource}/index.mpd`;
        } catch {
            // Try the CloudFront policy or the stream URL below.
        }
    }

    const cloudFrontMatch = signCookie.match(/CloudFront-Policy=([^;]+)/);
    if (cloudFrontMatch) {
        try {
            let encoded = cloudFrontMatch[1].replace(/-/g, '+').replace(/~/g, '/').replace(/_/g, '=');
            while (encoded.length % 4) encoded += '=';
            const policy = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
            const resource = policy?.Statement?.[0]?.Resource;
            if (typeof resource === 'string' && validHttpUrl(resource)) {
                const trimmed = resource.replace(/[*/]+$/, '');
                return trimmed.toLowerCase().endsWith('.mpd') ? trimmed : `${trimmed}/index.mpd`;
            }
        } catch {
            // Fall back to the stream URL.
        }
    }
    return null;
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

function normalizeLanguageCode(value) {
    const language = String(value || '').trim().toLowerCase();
    const aliases = {
        japanese: 'ja', jpn: 'ja', jp: 'ja', korean: 'ko', kor: 'ko',
        chinese: 'zh', chi: 'zh', mandarin: 'zh', english: 'en', eng: 'en',
        french: 'fr', fra: 'fr', fre: 'fr', spanish: 'es', spa: 'es',
        german: 'de', deu: 'de', ger: 'de', italian: 'it', ita: 'it',
        portuguese: 'pt', por: 'pt', hindi: 'hi', hin: 'hi'
    };
    if (aliases[language]) return aliases[language];
    return /^[a-z]{2,3}$/.test(language) ? language.slice(0, 2) : '';
}

async function getSubjectVariants(subjectId, originalLanguage = '') {
    const response = await movieBoxRequest(
        'GET',
        `/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(subjectId)}`
    );
    const dubs = response?.data?.dubs || response?.data?.data?.dubs;
    const variants = [];
    const originalCode = normalizeLanguageCode(originalLanguage);
    if (Array.isArray(dubs)) {
        for (const dub of dubs) {
            if (!dub?.subjectId) continue;
            const dubCode = normalizeLanguageCode(dub.lanCode || dub.language || dub.lanName);
            variants.push({
                id: dub.subjectId,
                language: dub.lanName || 'Original',
                isOriginalAudio: Boolean(originalCode && dubCode === originalCode) || dub.original === true
            });
        }
    }
    if (!variants.some(item => String(item.id) === String(subjectId))) {
        variants.unshift({ id: subjectId, language: 'Original', isOriginalAudio: true });
    }
    return variants.sort((a, b) => Number(b.isOriginalAudio) - Number(a.isOriginalAudio));
}

function collectRawStreams(playData) {
    const result = [];
    const addStream = (stream, formatHint = '') => {
        if (typeof stream === 'string') {
            result.push({ url: stream, format: formatHint });
            return;
        }
        if (!stream || typeof stream !== 'object') return;
        const url = stream.url || stream.playUrl || stream.resourceLink || stream.streamUrl;
        if (url) {
            result.push({
                ...stream,
                url,
                format: stream.format || formatHint,
                quality: stream.resolutions || stream.resolution || stream.quality
            });
            return;
        }
        const policyUrl = extractPolicyResource(stream.signCookie);
        if (policyUrl) {
            result.push({
                ...stream,
                url: policyUrl,
                format: stream.format || formatHint,
                quality: stream.resolutions || stream.resolution || stream.quality
            });
            return;
        }
        for (const [resolution, resource] of Object.entries(stream)) {
            if (typeof resource === 'string' && /^https?:\/\//i.test(resource)) {
                result.push({ url: resource, resolution, format: formatHint });
            } else if (resource && typeof resource === 'object') {
                addStream({ ...resource, resolution: resource.resolution || resolution }, formatHint);
            }
        }
    };

    for (const stream of Array.isArray(playData?.streams) ? playData.streams : []) {
        addStream(stream);
    }
    for (const [key, format] of [['netDash', 'DASH'], ['netHls', 'HLS']]) {
        const value = playData?.[key] ?? playData?.data?.[key];
        for (const item of Array.isArray(value) ? value : value ? [value] : []) {
            addStream(item, format);
        }
    }
    for (const detector of playData?.resourceDetectors || playData?.data?.resourceDetectors || []) {
        for (const video of detector?.resolutionList || []) {
            result.push({
                url: video.resourceLink,
                quality: video.resolution,
                id: video.id || video.resourceId,
                signCookie: video.signCookie,
                format: video.format
            });
        }
    }

    const seen = new Set();
    return result.filter(stream => {
        const url = stream.url || extractPolicyResource(stream.signCookie);
        const quality = stream.resolutions || stream.resolution || stream.quality || '';
        const key = `${url}|${quality}|${stream.format || ''}`;
        if (!url || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function movieBoxEpisodeCandidates(tmdbId, mediaType, season, episode) {
    if (mediaType !== 'tv') return [{ se: 0, ep: 0 }];
    const currentSeason = Number(season) || 1;
    const currentEpisode = Number(episode) || 1;
    const candidates = [{ se: currentSeason, ep: currentEpisode }];

    if (Number(tmdbId) === 1429 && currentSeason === 4) {
        if (currentEpisode >= 17 && currentEpisode <= 28) {
            candidates.unshift({ se: 5, ep: currentEpisode - 16 });
        } else if (currentEpisode >= 29 && currentEpisode <= 30) {
            candidates.unshift({ se: 6, ep: currentEpisode - 28 });
        }
    }

    const seen = new Set();
    return candidates.filter(candidate => {
        const key = `${candidate.se}:${candidate.ep}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function getStreamLinks(subjectId, season, episode, mediaTitle, mediaType = 'movie', tmdbId = null, originalLanguage = '') {
    const variants = await getSubjectVariants(subjectId, originalLanguage);
    const output = [];
    const seen = new Set();
    const episodeCandidates = movieBoxEpisodeCandidates(tmdbId, mediaType, season, episode);

    for (const variant of variants) {
        try {
            let playData = null;
            let usedSeason = season;
            let usedEpisode = episode;

            for (const candidate of episodeCandidates) {
                const params = new URLSearchParams({
                    subjectId: String(variant.id),
                    se: String(candidate.se),
                    ep: String(candidate.ep),
                    streamSignType: '1',
                    'supportCodecs[hevc]': '1',
                    'supportCodecs[h264]': '1'
                });
                const response = await movieBoxRequest(
                    'GET',
                    `/wefeed-mobile-bff/subject-api/play-info?${params}`
                );
                const candidateData = response?.data?.data || response?.data;
                const candidateStreams = collectRawStreams(candidateData);
                const hasPlayableStream = candidateStreams.some(stream => {
                    const url = extractPolicyResource(stream.signCookie) || stream.url;
                    return validHttpUrl(url);
                });

                if (hasPlayableStream) {
                    playData = candidateData;
                    usedSeason = candidate.se;
                    usedEpisode = candidate.ep;
                    if (candidate.se !== season || candidate.ep !== episode) {
                        console.log(`[MovieBox] TMDB S${season}E${episode} mapped to MovieBox S${usedSeason}E${usedEpisode}`);
                    }
                    break;
                }
                if (!playData && candidateData) playData = candidateData;
            }

            if (!playData) continue;
            for (const stream of collectRawStreams(playData)) {
                const url = extractPolicyResource(stream.signCookie) || stream.url;
                if (!validHttpUrl(url)) continue;

                const format = getFormat(url, stream.format);
                const parsedQualities = parseQualities(stream.quality);
                const qualities = parsedQualities.length
                    ? parsedQualities.map(value => `${value}p`)
                    : ['Auto'];
                const streamId = stream.id || `${variant.id}|${usedSeason}|${usedEpisode}`;
                const subtitles = await fetchSubtitles(variant.id, streamId, variant.language);

                for (const quality of qualities) {
                    const uniqueKey = `${url}|${quality}`;
                    if (seen.has(uniqueKey)) continue;
                    seen.add(uniqueKey);
                    output.push({
                        name: 'MovieBox',
                        title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ''} (${variant.language}) - ${format.label} - ${quality}`,
                        url,
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
        
        const tmdbResponse = await fetchWithTimeout(tmdbUrl, {}, 30_000);

        if (!tmdbResponse.ok) {
            throw new Error(`TMDB returned HTTP ${tmdbResponse.status}`);
        }

        const details = await tmdbResponse.json();
        const title = type === 'tv' ? details?.name : details?.title;
        const originalTitle = type === 'tv' ? details?.original_name : details?.original_title;
        const year = String(details?.first_air_date || details?.release_date || '').slice(0, 4);
        const originalLanguage = String(details?.original_language || '').trim().toLowerCase();
        
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
        return await getStreamLinks(match.subjectId, season, episode, title, type, tmdbId, originalLanguage);
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
