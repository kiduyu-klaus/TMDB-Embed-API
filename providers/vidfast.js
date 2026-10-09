const axios = require('axios');
const { inferSubtitleMimeType } = require('../utils/subtitles');

const BASE_URL = 'https://vidfast.vc';
const NAME = 'vidfast';
const ENCRYPT_URL = `https://enc-dec.app/api/enc-${NAME}`;
const DECRYPT_URL = `https://enc-dec.app/api/dec-${NAME}`;

const PAGE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Google Chrome";v="137", "Chromium";v="137", "Not=A?Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

const BASE_HEADERS = {
    'User-Agent': PAGE_HEADERS['User-Agent'],
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/`,
    'X-Requested-With': 'XMLHttpRequest',
    'Sec-Ch-Ua': '"Google Chrome";v="137", "Chromium";v="137", "Not=A?Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
};

const API_HEADERS = {
    'User-Agent': PAGE_HEADERS['User-Agent'],
    'Accept': 'application/json',
    'Content-Type': 'application/json'
};

function extractPageText(html) {
    if (!html || typeof html !== 'string') return null;
    const m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    return m ? m[1] : null;
}

function extractStreamCandidates(data, inherited = {}, output = [], seen = new Set()) {
    if (!data) return output;
    if (typeof data === 'string') {
        const url = normalizeHttpUrl(data);
        if (url) output.push({ ...inherited, url });
        return output;
    }
    if (typeof data !== 'object' || seen.has(data)) return output;
    seen.add(data);

    if (Array.isArray(data)) {
        data.forEach(item => extractStreamCandidates(item, inherited, output, seen));
        return output;
    }

    const metadata = {
        quality: data.quality || data.label || data.resolution || inherited.quality,
        headers: data.headers && typeof data.headers === 'object' ? data.headers : inherited.headers,
        type: data.type || data.format || inherited.type
    };
    const directFields = ['url', 'stream_url', 'playlist', 'file'];
    directFields.forEach(field => {
        const url = normalizeHttpUrl(data[field]);
        if (url) output.push({ ...metadata, url });
    });
    if (typeof data.stream === 'string') {
        const url = normalizeHttpUrl(data.stream);
        if (url) output.push({ ...metadata, url });
    }

    ['stream', 'streams', 'sources'].forEach(field => {
        if (data[field] && typeof data[field] === 'object') {
            extractStreamCandidates(data[field], metadata, output, seen);
        }
    });
    if (data.qualities && typeof data.qualities === 'object') {
        Object.entries(data.qualities).forEach(([quality, value]) => {
            extractStreamCandidates(value, { ...metadata, quality }, output, seen);
        });
    }
    return output;
}

function normalizeHttpUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch (_) {
        return null;
    }
}

function getStreamFormat(url) {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith('.m3u8')) {
        return { format: 'hls', mimeType: 'application/vnd.apple.mpegurl' };
    }
    if (pathname.endsWith('.mpd')) {
        return { format: 'dash', mimeType: 'application/dash+xml' };
    }
    return { format: 'direct' };
}

function normalizeQuality(value) {
    const quality = String(value || 'Auto').trim();
    return /^\d{3,4}$/.test(quality) ? `${quality}p` : quality || 'Auto';
}

// Vidfast labels subtitle tracks with human-readable names ("English", "Hindi",
// "Spanish - Latin America", ...). Media3/Android expects a short ISO 639-1
// code, so map the common ones explicitly instead of guessing from length.
const LANGUAGE_MAP = {
    english: 'en', eng: 'en', en: 'en',
    hindi: 'hi', hin: 'hi', hi: 'hi',
    spanish: 'es', spa: 'es', es: 'es', castellano: 'es',
    latin: 'es', 'latin america': 'es', 'latam': 'es', 'español': 'es', espanol: 'es',
    french: 'fr', fre: 'fr', fra: 'fr', fr: 'fr', francais: 'fr',
    german: 'de', ger: 'de', deu: 'de', de: 'de', deutsch: 'de',
    portuguese: 'pt', por: 'pt', pt: 'pt', portugues: 'pt', brazilian: 'pt',
    russian: 'ru', rus: 'ru', ru: 'ru',
    japanese: 'ja', jpn: 'ja', ja: 'ja',
    korean: 'ko', kor: 'ko', ko: 'ko',
    chinese: 'zh', chi: 'zh', zho: 'zh', zh: 'zh', mandarin: 'zh', cantonese: 'zh',
    arabic: 'ar', ara: 'ar', ar: 'ar',
    turkish: 'tr', tur: 'tr', tr: 'tr',
    italian: 'it', ita: 'it', it: 'it',
    dutch: 'nl', dut: 'nl', nld: 'nl', nl: 'nl',
    polish: 'pl', pol: 'pl', pl: 'pl',
    swedish: 'sv', swe: 'sv', sv: 'sv',
    norwegian: 'no', nor: 'no', nb: 'no', nn: 'no',
    danish: 'da', dan: 'da', da: 'da',
    finnish: 'fi', fin: 'fi', fi: 'fi',
    czech: 'cs', ces: 'cs', cze: 'cs', cs: 'cs',
    hungarian: 'hu', hun: 'hu', hu: 'hu',
    romanian: 'ro', ron: 'ro', rum: 'ro', ro: 'ro',
    greek: 'el', gre: 'el', ell: 'el', el: 'el',
    thai: 'th', tha: 'th', th: 'th',
    indonesian: 'id', ind: 'id', id: 'id',
    malay: 'ms', may: 'ms', ms: 'ms',
    vietnamese: 'vi', vie: 'vi', vi: 'vi',
    ukrainian: 'uk', ukr: 'uk', uk: 'uk'
};

// Pull a 2-3 letter ISO code out of a filename segment such as "eng.vtt",
// "hindi.srt" or "/subs/en.m3u8". Falls back to null.
function languageFromFilename(url) {
    const pathname = String(url || '').split('?')[0];
    const segments = pathname.split('/');
    const last = segments[segments.length - 1] || '';
    const stem = last.replace(/\.[a-z0-9]+$/i, '');
    const direct = stem.match(/^([a-z]{2,3})$/i);
    if (direct) {
        const key = direct[1].toLowerCase();
        if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
    }
    // e.g. "en-US", "en_US", "pt-BR"
    const regional = stem.match(/^([a-z]{2,3})[-_][a-z]{2}$/i);
    if (regional) {
        const key = regional[1].toLowerCase();
        if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
    }
    return null;
}

// Resolve a display label into a Media3-friendly ISO 639-1 code.
function resolveLanguage(track, label, url) {
    const explicit = String((track && (track.language || track.lang || track.srclang)) || '').trim().toLowerCase();
    if (explicit) {
        if (LANGUAGE_MAP[explicit]) return LANGUAGE_MAP[explicit];
        if (/^[a-z]{2,3}(?:[-_][a-z]{2,4})?$/.test(explicit)) return explicit;
    }
    // Labels can be decorated ("English [Default]", "Hindi - Dubbed"), so match
    // the longest known key as a whole word rather than requiring equality.
    const normalized = String(label || '').toLowerCase().replace(/[()[\]]/g, ' ');
    const keys = Object.keys(LANGUAGE_MAP).sort((a, b) => b.length - a.length);
    for (const key of keys) {
        if (new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, 'i').test(normalized)) {
            return LANGUAGE_MAP[key];
        }
    }
    return languageFromFilename(url);
}

// Normalize the decrypted stream payload's subtitle list. Vidfast uses
// `tracks: [{ file, label }]`, but tolerate the other shapes upstream has used
// (`subtitles`, `captions`, object maps) so this does not silently regress.
function extractSubtitles(payload, streamUrl) {
    const containers = [payload && payload.tracks, payload && payload.subtitles, payload && payload.captions];
    const entries = [];
    for (const container of containers) {
        if (Array.isArray(container)) {
            container.forEach(item => {
                if (typeof item === 'string') entries.push({ url: item });
                else if (item && typeof item === 'object') entries.push(item);
            });
        } else if (container && typeof container === 'object') {
            // Object map: { eng: "https://.../eng.vtt", spa: {...} }
            Object.entries(container).forEach(([key, value]) => {
                if (typeof value === 'string') entries.push({ url: value, label: key });
                else if (value && typeof value === 'object') entries.push({ ...value, label: value.label || key });
            });
        }
    }
    if (entries.length === 0) return [];

    const streamHeaders = {
        'Referer': `${BASE_URL}/`,
        'User-Agent': BASE_HEADERS['User-Agent']
    };
    const seen = new Set();
    const subs = [];
    for (const track of entries) {
        // Track URLs are absolute today, but resolve relative paths defensively.
        const rawUrl = track.file || track.url || track.src || track.path || track.srcUrl || '';
        let url = normalizeHttpUrl(rawUrl);
        if (!url && rawUrl && streamUrl) {
            try {
                url = normalizeHttpUrl(new URL(String(rawUrl), streamUrl).href);
            } catch (_) {
                url = null;
            }
        }
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const rawLabel = String(track.label || track.name || track.title || track.language || track.lang || 'Subtitle').trim();
        subs.push({
            url,
            mimeType: inferSubtitleMimeType({ ...track, url, label: rawLabel }),
            language: resolveLanguage(track, rawLabel, url),
            label: rawLabel,
            headers: { ...streamHeaders, ...(track.headers && typeof track.headers === 'object' ? track.headers : {}) }
        });
    }
    return subs;
}

function normalizeServerStreams(payload, server) {
    const serverName = String(server.name || server.label || server.server || server.data || 'Server').trim();
    const candidates = extractStreamCandidates(payload);
    // The subtitle list is a property of the title, not of an individual server:
    // Vidfast returns it on some servers and omits it on others. Resolve the URLs
    // first so relative subtitle paths have a base to resolve against.
    const primary = candidates[0];
    const subtitles = extractSubtitles(payload, primary && primary.url);
    const seen = new Set();
    return candidates.flatMap(candidate => {
        if (!candidate.url || seen.has(candidate.url)) return [];
        seen.add(candidate.url);
        const quality = normalizeQuality(candidate.quality || server.quality);
        const inferredFormat = getStreamFormat(candidate.url);
        const suppliedType = String(candidate.type || '').toLowerCase();
        const format = suppliedType === 'hls'
            ? { format: 'hls', mimeType: 'application/vnd.apple.mpegurl' }
            : suppliedType === 'dash'
                ? { format: 'dash', mimeType: 'application/dash+xml' }
                : inferredFormat;
        return [{
            name: `Vidfast ${serverName}`,
            title: `Vidfast - ${serverName} - ${quality}`,
            url: candidate.url,
            quality,
            provider: 'Vidfast',
            ...format,
            subtitles,
            headers: {
                'Referer': `${BASE_URL}/`,
                'User-Agent': BASE_HEADERS['User-Agent'],
                ...(candidate.headers || {})
            }
        }];
    });
}

async function getVidfastStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidfast] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        const type = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
        if (type === 'tv' && (!seasonNum || !episodeNum)) {
            console.warn('[Vidfast] Series request is missing season or episode');
            return [];
        }
        const pageUrl = type === 'tv'
            ? `${BASE_URL}/tv/${tmdbId}/${seasonNum}/${episodeNum}`
            : `${BASE_URL}/movie/${tmdbId}`;

        let pageRes;
        try {
            pageRes = await axios.get(pageUrl, { headers: PAGE_HEADERS, timeout: 12000 });
        } catch (err) {
            console.error(`[Vidfast] Page GET failed (${pageUrl}): ${err.response ? err.response.status : err.message}`);
            return [];
        }

        const pageHtml = typeof pageRes.data === 'string' ? pageRes.data : '';
        const pageText = extractPageText(pageHtml);
        if (!pageText) {
            console.warn('[Vidfast] Could not extract page token (page structure changed?)');
            return [];
        }

        let encRes;
        try {
            encRes = await axios.get(`${ENCRYPT_URL}?text=${encodeURIComponent(pageText)}`, {
                headers: { 'User-Agent': PAGE_HEADERS['User-Agent'], 'Accept': 'application/json' },
                timeout: 8000
            });
        } catch (err) {
            console.error(`[Vidfast] Enc GET failed: ${err.response ? err.response.status : err.message}`);
            return [];
        }

        if (!encRes.data || encRes.data.status !== 200) {
            console.error(`[Vidfast] Enc API returned non-200: status=${encRes.data && encRes.data.status} error=${encRes.data && encRes.data.error}`);
            return [];
        }

        const { servers: serversUrl, stream: streamBase, token } = encRes.data.result || {};
        if (!serversUrl || !streamBase) {
            console.error('[Vidfast] Enc response missing servers/stream:', encRes.data.result);
            return [];
        }
        const csrfToken = token || '';

        const csrfHeaders = { ...BASE_HEADERS, 'X-CSRF-Token': csrfToken };
        let serversEncRes;
        try {
            serversEncRes = await axios.post(serversUrl, null, { headers: csrfHeaders, timeout: 12000 });
        } catch (err) {
            console.error(`[Vidfast] Servers POST failed (${serversUrl}): ${err.response ? err.response.status : err.message}`);
            return [];
        }

        const serversEncrypted = typeof serversEncRes.data === 'string'
            ? serversEncRes.data
            : JSON.stringify(serversEncRes.data);

        let decServersRes;
        try {
            decServersRes = await axios.post(DECRYPT_URL, { text: serversEncrypted }, {
                headers: API_HEADERS,
                timeout: 12000
            });
        } catch (err) {
            console.error(`[Vidfast] Decrypt servers POST failed: ${err.response ? err.response.status : err.message}`);
            return [];
        }

        if (!decServersRes.data || decServersRes.data.status !== 200) {
            console.error(`[Vidfast] Server list decrypt failed: status=${decServersRes.data && decServersRes.data.status} error=${decServersRes.data && decServersRes.data.error}`);
            return [];
        }
        const serversList = decServersRes.data.result;
        if (!Array.isArray(serversList) || serversList.length === 0) {
            console.warn('[Vidfast] No servers in decrypted list');
            return [];
        }

        const serverResults = await Promise.all(serversList.map(async (server) => {
            if (!server || !server.data) return [];
            const serverName = server.name || server.data;
            try {
                const streamUrl = `${streamBase}/${server.data}`;
                const streamEncRes = await axios.post(streamUrl, null, { headers: csrfHeaders, timeout: 15000 });
                const streamEncrypted = typeof streamEncRes.data === 'string'
                    ? streamEncRes.data
                    : JSON.stringify(streamEncRes.data);

                const decStreamRes = await axios.post(DECRYPT_URL, { text: streamEncrypted }, {
                    headers: API_HEADERS,
                    timeout: 12000
                });
                if (!decStreamRes.data || decStreamRes.data.status !== 200) {
                    console.warn(`[Vidfast] ${serverName} stream decrypt failed: ${decStreamRes.data && decStreamRes.data.error}`);
                    return [];
                }

                const streams = normalizeServerStreams(decStreamRes.data.result, server);
                if (streams.length === 0) {
                    const keys = decStreamRes.data.result && typeof decStreamRes.data.result === 'object'
                        ? Object.keys(decStreamRes.data.result).join(',')
                        : 'n/a';
                    console.warn(`[Vidfast] ${serverName} no URL in decrypted payload. Keys: ${keys}`);
                    return [];
                }
                const subCount = streams[0] && streams[0].subtitles ? streams[0].subtitles.length : 0;
                if (subCount === 0) {
                    console.log(`[Vidfast] ${serverName} => ${streams.length} stream(s), no tracks on this server (merged later if siblings expose them)`);
                } else {
                    console.log(`[Vidfast] ${serverName} => ${streams.length} stream(s), ${subCount} subtitle(s)`);
                }
                return streams;
            } catch (err) {
                console.warn(`[Vidfast] ${serverName} failed: ${err.response ? err.response.status : err.message}`);
                return [];
            }
        }));

        const allStreams = serverResults.flat();
        // Vidfast exposes the subtitle list on only some of its servers even
        // though the tracks belong to the title. Collect every distinct track
        // seen across servers and attach the full set to every stream, so a
        // player is never offered a subtitle-less server just because that
        // server happened to omit `tracks`.
        const mergedSubs = [];
        const seenSubs = new Set();
        for (const stream of allStreams) {
            for (const sub of (stream.subtitles || [])) {
                if (seenSubs.has(sub.url)) continue;
                seenSubs.add(sub.url);
                mergedSubs.push(sub);
            }
        }
        if (mergedSubs.length) {
            for (const stream of allStreams) {
                stream.subtitles = mergedSubs;
            }
        }

        const uniqueStreams = [...new Map(allStreams.map(stream => [stream.url, stream])).values()];
        const withSubs = uniqueStreams.filter(s => s.subtitles && s.subtitles.length).length;
        console.log(`[Vidfast] Total streams: ${uniqueStreams.length} (${withSubs} with ${mergedSubs.length} subtitle(s))`);
        return uniqueStreams;
    } catch (err) {
        console.error(`[Vidfast] Unexpected error: ${err.message}`);
        return [];
    }
}

module.exports = {
    getVidfastStreams,
    extractPageText,
    extractSubtitles,
    resolveLanguage,
    normalizeServerStreams
};