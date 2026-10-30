const { fetch: providerFetch } = require('../utils/providerFetch');
const { config } = require('../utils/config');
const { decryptVidzeePayload } = require('../utils/vidzee-decrypt');
const cinesrcProxy = require('../utils/providerProxy').createProviderProxy({
    provider: 'CineSrc',
    config,
    settingKey: 'cinesrcProxyEnabled',
    tracedFetch: providerFetch,
    bypassOrigins: ['https://api.themoviedb.org']
});
const { fetch } = cinesrcProxy;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

const FLAXMOVIES_BASE = 'https://flaxmovies.lol';
const SOURCE_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': `${FLAXMOVIES_BASE}/`,
    'Origin': FLAXMOVIES_BASE,
    'Accept': '*/*'
};
const VIDROCK_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': 'https://vidrock.net/',
    'Origin': 'https://vidrock.net',
    'Accept': 'application/json'
};
const VIDLOVE_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': 'https://player.vidlove.cc/',
    'Origin': 'https://player.vidlove.cc',
    'Accept': 'application/json'
};
const CLD_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': 'https://player-4aq.pages.dev/',
    'Origin': 'https://player-4aq.pages.dev',
    'Accept': 'application/json, text/plain, */*'
};

// Prefer the environment variable in production; the bundled key keeps this
// standalone module usable when no environment has been configured.
const TMDB_API_KEY = process.env.TMDB_API_KEY || '9de3de623b579f6e127c6ec603b9f74d';

// TMDB cache + eviction timers (prevents repeated API calls + timer leaks)
const tmdbInfoCache = new Map();
const tmdbInfoTimers = new Map();

async function fetchJson(url, opts = {}) {
    const res = await fetch(url, {
        ...opts,
        headers: { 'Accept': 'application/json', ...(opts.headers || {}) },
        signal: opts.signal || AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function getTmdbInfo(tmdbId, mediaType, season) {
    const key = `${tmdbId}-${mediaType}-${season || ''}`;
    if (tmdbInfoCache.has(key)) return tmdbInfoCache.get(key);
    const k = TMDB_API_KEY;
    if (!k) return { isAnime: false, titles: [], year: null, imdbId: null, mediaType: null };
    try {
        const requestMain = type => fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${k}&append_to_response=external_ids`, { signal: AbortSignal.timeout(30000) });
        let resolvedType = mediaType;
        let mainRes = await requestMain(mediaType);
        if (!mainRes.ok) {
            mainRes.body?.cancel();
            const alternateType = mediaType === 'tv' ? 'movie' : 'tv';
            const alternateRes = await requestMain(alternateType);
            if (alternateRes.ok) {
                mainRes = alternateRes;
                resolvedType = alternateType;
            } else {
                alternateRes.body?.cancel();
                mainRes = null;
            }
        }
        let mainData = null;
        let seasonData = null;
        if (mainRes?.ok) mainData = await mainRes.json();
        if (season && resolvedType === 'tv') {
            const seasonRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${k}`, { signal: AbortSignal.timeout(30000) });
            if (seasonRes.ok) seasonData = await seasonRes.json(); else seasonRes.body?.cancel();
        }

        const genres = mainData?.genres || [];
        const originCountry = mainData?.origin_country || [];
        const originalLanguage = mainData?.original_language || '';
        const isAnime = genres.some(g => g.id === 16) && (originCountry.includes('JP') || originalLanguage === 'ja');
        const titles = [];
        if (seasonData?.name) titles.push(seasonData.name);
        const title = mainData?.title || mainData?.name || '';
        const originalTitle = mainData?.original_title || mainData?.original_name || '';
        if (title) titles.push(title);
        if (originalTitle && originalTitle !== title) titles.push(originalTitle);

        let year = null;
        const dateStr = seasonData?.air_date || mainData?.release_date || mainData?.first_air_date || '';
        if (dateStr) year = parseInt(dateStr.slice(0, 4), 10);

        const result = {
            isAnime,
            titles: [...new Set(titles.filter(Boolean))],
            year,
            imdbId: mainData?.imdb_id || mainData?.external_ids?.imdb_id || null,
            mediaType: mainData ? resolvedType : null
        };
        tmdbInfoCache.set(key, result);
        if (tmdbInfoTimers.has(key)) clearTimeout(tmdbInfoTimers.get(key));
        const timer = setTimeout(() => { tmdbInfoCache.delete(key); tmdbInfoTimers.delete(key); }, 600000);
        timer.unref?.();
        tmdbInfoTimers.set(key, timer);
        return result;
    } catch {
        return { isAnime: false, titles: [], year: null, imdbId: null, mediaType: null };
    }
}

// ---------------------------------------------------------------------------
// Stream + subtitle extraction (recursive over arbitrary response shapes)
// ---------------------------------------------------------------------------
function resolveSourceUrl(url, baseUrl) {
    if (typeof url !== 'string' || !url.trim()) return '';
    try { return new URL(url.trim(), baseUrl || undefined).toString(); }
    catch { return url.trim(); }
}

function parseHlsVariants(manifest, baseUrl) {
    if (typeof manifest !== 'string') return [];
    const variants = [];
    const lines = manifest.split(/\r?\n/);
    let pendingQuality = '';
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            pendingQuality = line.match(/RESOLUTION=\d+x(\d+)/i)?.[1] || 'Auto';
            continue;
        }
        if (!line || line.startsWith('#') || !pendingQuality) continue;
        const url = resolveSourceUrl(line, baseUrl);
        if (/^https?:\/\//i.test(url)) variants.push({ url, quality: pendingQuality });
        pendingQuality = '';
    }
    return variants;
}

function extractPlaybackHeaders(source, fallback = {}) {
    const candidates = [
        source && source.headers,
        source && source.requestHeaders,
        source && source.httpHeaders,
        source && source.behaviorHints && source.behaviorHints.proxyHeaders && source.behaviorHints.proxyHeaders.request,
    ];
    const headers = { ...fallback };
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        for (const [name, value] of Object.entries(candidate)) {
            if (typeof value === 'string' && value.trim() && !/[\r\n]/.test(name + value)) headers[name] = value;
        }
    }
    return headers;
}

function extractStreamData(obj, results = [], baseUrl = '') {
    if (!obj) return results;
    if (Array.isArray(obj)) { for (const item of obj) extractStreamData(item, results, baseUrl); }
    else if (typeof obj === 'object') {
        const rawUrls = [obj.url, obj.file, obj.link, obj.src, obj.rawUrl, obj.raw_url, obj.proxiedUrl, obj.proxied_url, obj.stream_url, obj.manifest];
        const urls = [...new Set(rawUrls.filter(value => typeof value === 'string').map(value => resolveSourceUrl(value, baseUrl)).filter(Boolean))];
        const usableUrls = [];
        for (const url of urls) {
            const isHttpUrl = /^https?:\/\//i.test(url);
            const lowerUrl = url.toLowerCase();
            const recognizedTypes = ['hls', 'dash', 'mp4', 'mkv', 'embed'];
            const typeCandidates = [obj.type, obj.format].filter(value => typeof value === 'string').map(value => value.toLowerCase());
            const declaredType = typeCandidates.find(value => recognizedTypes.includes(value)) || typeCandidates[0] || '';
            if (!isHttpUrl || !(lowerUrl.includes('.m3u8') || lowerUrl.includes('.mp4') || lowerUrl.includes('.mkv') || lowerUrl.includes('.mpd') || lowerUrl.includes('/proxy') || ['hls', 'dash', 'mp4', 'mkv', 'embed'].includes(declaredType))) continue;
            usableUrls.push(url);
            results.push({
                url, quality: obj.quality || obj.label || obj.resolution || 'Auto', type: declaredType,
                headers: extractPlaybackHeaders(obj)
            });
        }
        const childBase = usableUrls[0] || baseUrl;
        for (const val of Object.values(obj)) { if (typeof val === 'object' && val !== null) extractStreamData(val, results, childBase); }
    }
    return results;
}

function extractSubtitles(obj, subs = []) {
    if (!obj) return subs;
    if (Array.isArray(obj)) { for (const item of obj) extractSubtitles(item, subs); }
    else if (typeof obj === 'object') {
        const url = obj.url || obj.file || obj.src;
        // Accept both 'captions' and 'subtitle(s)' kinds (HLS spec uses 'subtitles')
        const isSubtitleKind = obj.kind === 'captions' || obj.kind === 'caption' || obj.kind === 'subtitle' || obj.kind === 'subtitles';
        if (typeof url === 'string' && (url.includes('.vtt') || url.includes('.srt') || isSubtitleKind || obj.type === 'subtitle' || obj.type === 'captions')) {
            subs.push({ url, lang: obj.label || obj.language || obj.name || obj.lang || 'Unknown' });
        }
        for (const val of Object.values(obj)) { if (typeof val === 'object' && val !== null) extractSubtitles(val, subs); }
    }
    return subs;
}

// ---------------------------------------------------------------------------
// VidBolt extractors
// ---------------------------------------------------------------------------
async function scrapeFlax(info, id, s, e) {
    const isTv = s != null && e != null;

    // FlaxMovies delegates playback to Videasy. Probe the backend routes used
    // by its current player and return only direct HLS/DASH sources.
    const params = new URLSearchParams({
        title: info?.titles?.[0] || '',
        mediaType: isTv ? 'TV Series' : 'Movie',
        year: String(info?.year || ''),
        tmdbId: String(id),
        imdbId: info?.imdbId || ''
    });
    if (isTv) {
        params.set('seasonId', String(s));
        params.set('episodeId', String(e));
    }
    const direct = [];
    // The active player bundle uses /vsrc/sources-with-title; it may require
    // the client's seed/encrypted `enc` payload, so keep the plain fallbacks.
    for (const route of ['/vsrc/sources-with-title', '/hdmovie/sources-with-title', '/cdn/sources-with-title', '/m4uhd/sources-with-title']) {
        try {
            const res = await fetch(`https://api.speedracelight.com${route}?${params}`, {
                headers: { ...SOURCE_HEADERS, Accept: 'application/json' },
                signal: AbortSignal.timeout(30000)
            });
            if (!res.ok) continue;
            const payload = await res.json();
            const candidates = Array.isArray(payload) ? payload : (payload.sources || payload.data || []);
            for (const source of candidates) {
                const url = typeof source === 'string' ? source : source?.url || source?.file || source?.src;
                if (typeof url === 'string' && /\.(m3u8|mpd)(?:[?#]|$)/i.test(url)) {
                    direct.push({
                        url,
                        quality: source.quality || source.label || 'FlaxMovies HLS',
                        type: /\.mpd/i.test(url) ? 'dash' : 'hls',
                        headers: extractPlaybackHeaders(source, SOURCE_HEADERS)
                    });
                }
            }
        } catch (err) {
            console.warn(`[CineSrc] FlaxMovies HLS route ${route} failed: ${err.message}`);
        }
    }
    return direct;
}

function buildServerUrl(server, id, s, e) {
    const tv = s != null && e != null;
    switch (server) {
        case 'tet': return tv
            ? `https://player.videasy.net/tv/${id}/${s}/${e}?color=B20710&colour=B20710&autoPlay=true&primarycolor=B20710&autoNext=true&nextButton=true&poster=true&autoplayNextEpisode=true&nextEpisode=true&adFree=true`
            : `https://player.videasy.net/movie/${id}?color=B20710&colour=B20710&autoPlay=true&primarycolor=B20710&poster=true&adFree=true`;
        case 'cld': return tv ? `https://player-4aq.pages.dev/embed/tv/${id}/${s}/${e}` : `https://player-4aq.pages.dev/embed/movie/${id}`;
        case 'prime': return tv ? `https://embedmaster.link/d680vgv7dhiapy8k/tv/${id}/${s}/${e}` : `https://embedmaster.link/d680vgv7dhiapy8k/movie/${id}`;
        case 'spe':
        case 'SPE': return tv ? `https://player.vidlove.cc/embed/tv/${id}/${s}/${e}` : `https://player.vidlove.cc/embed/movie/${id}`;
        case 'vidsrc':
        case 'Mega': return tv ? `https://vidsrc-embed.su/embed/tv?tmdb=${id}&season=${s}&episode=${e}` : `https://vidsrc-embed.su/embed/movie?tmdb=${id}`;
        case 'vipplay': return tv ? `https://cinemaos.tech/player/${id}/${s}/${e}` : `https://cinemaos.tech/player/${id}`;
        case 'movip':
        case 'Movip': return tv ? `https://moviesapi.to/tv/${id}/${s}/${e}` : `https://moviesapi.to/movie/${id}`;
        case 'viz':
        case 'Viz': return tv ? `https://player.vidzee.wtf/embed/tv/${id}/${s}/${e}` : `https://player.vidzee.wtf/embed/movie/${id}`;
        default: return null;
    }
}

function makeServerExtractor(server) {
    return async function scrapeServer(info, id, s, e) {
        const pageUrl = buildServerUrl(server, id, s, e);
        if (!pageUrl) return [];
        const res = await fetch(pageUrl, {
            headers: SOURCE_HEADERS,
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) return [];
        const html = (await res.text())
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&')
            .replace(/\\u0026/g, '&');
        const found = new Set();
        const directPattern = /https?:[^"'\\\s<>]+\.(?:m3u8|mpd)(?:\?[^"'\\\s<>]*)?/gi;
        for (const match of html.matchAll(directPattern)) found.add(match[0]);
        return [...found].map(url => ({
            url,
            quality: `${server} HLS`,
            type: /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : 'hls',
            headers: { ...SOURCE_HEADERS }
        }));
    };
}

const CLD_RAW_HOSTS_REQUIRING_PROXY = new Set(['tik.1x2.space', 'vip.1x2.space']);

function preferCldProxyForBlockedRawHost(value, baseUrl = '') {
    if (Array.isArray(value)) {
        for (const item of value) preferCldProxyForBlockedRawHost(item, baseUrl);
        return value;
    }
    if (!value || typeof value !== 'object') return value;

    const rawKey = typeof value.raw_url === 'string' ? 'raw_url' : typeof value.rawUrl === 'string' ? 'rawUrl' : null;
    const proxyUrl = value.url || value.proxied_url || value.proxiedUrl;
    if (rawKey && typeof proxyUrl === 'string') {
        try {
            const rawHost = new URL(resolveSourceUrl(value[rawKey], baseUrl)).hostname.toLowerCase();
            const proxyHost = new URL(resolveSourceUrl(proxyUrl, baseUrl)).hostname.toLowerCase();
            if (CLD_RAW_HOSTS_REQUIRING_PROXY.has(rawHost) && proxyHost === 'freakyniki.elaxo.lol') delete value[rawKey];
        } catch { /* Leave unparseable source fields untouched. */ }
    }
    for (const child of Object.values(value)) {
        if (child && typeof child === 'object') preferCldProxyForBlockedRawHost(child, baseUrl);
    }
    return value;
}

async function scrapeCld(info, id, s, e) {
    const tv = s != null && e != null;
    const suffix = tv ? `tv/${id}?season=${encodeURIComponent(s)}&episode=${encodeURIComponent(e)}` : `movie/${id}`;
    const resolverParams = new URLSearchParams({ tmdb_id: String(id) });
    if (tv) {
        resolverParams.set('season', String(s));
        resolverParams.set('episode', String(e));
    }
    const liveResolverUrl = `https://freakyniki.elaxo.lol/?${resolverParams}`;
    try {
        const res = await fetch(liveResolverUrl, { headers: CLD_HEADERS, signal: AbortSignal.timeout(30000) });
        if (res.ok) {
            const payload = preferCldProxyForBlockedRawHost(await res.json(), liveResolverUrl);
            const streams = extractStreamData(payload, [], liveResolverUrl);
            if (streams.length) return streams;
        }
    } catch (err) {
        console.warn(`[CineSrc] CLD live resolver failed: ${err.message}`);
    }

    const urls = [
        `https://alexamuf.xyz/msapi/get/${suffix}`,
        `https://alexamuf.xyz/vl/get/${suffix}`,
        `https://alexamuf.xyz/cj/get/${suffix}`,
        `https://alexamuf.xyz/nh/get/${suffix}`,
        `https://alexamuf.xyz/vs/get/${suffix}`,
        `https://alexamuf.xyz/fs/get/${suffix}`,
        `https://opui.raphsm4.dev/resolve?id=${encodeURIComponent(id)}&type=${tv ? 'tv' : 'movie'}${tv ? `&season=${encodeURIComponent(s)}&episode=${encodeURIComponent(e)}` : ''}`
    ];
    const output = [];
    await Promise.all(urls.map(async url => {
        try {
            const res = await fetch(url, { headers: CLD_HEADERS, signal: AbortSignal.timeout(30000) });
            if (!res.ok) return;
            const payload = preferCldProxyForBlockedRawHost(await res.json(), url);
            output.push(...extractStreamData(payload, [], url));
        } catch (err) {
            console.warn(`[CineSrc] CLD provider failed: ${err.message}`);
        }
    }));
    return output;
}

function getSetCookieHeader(res) {
    const value = res.headers.get('set-cookie') || '';
    return value
        .split(/, (?=[^;]+=)/)
        .map(cookie => cookie.split(';', 1)[0])
        .filter(Boolean)
        .join('; ');
}

async function scrapePrime(info, id, s, e) {
    const pageUrl = buildServerUrl('prime', id, s, e);
    if (!pageUrl) return [];
    const headers = { ...SOURCE_HEADERS, Accept: 'text/html,application/xhtml+xml' };
    try {
        // EmbedMaster redirects to a signed player page with a short-lived
        // session cookie and a hidden attestation form.
        const gateRes = await fetch(pageUrl, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(30000)
        });
        if (!gateRes.ok) return [];
        const gateHtml = await gateRes.text();
        const gateUrl = gateRes.url || pageUrl;
        const action = gateHtml.match(/<form[^>]+id=["']welcome-play-form["'][^>]+action=["']([^"']+)/i)?.[1];
        if (!action) return [];
        const fields = [...gateHtml.matchAll(/<input[^>]+type=["']hidden["'][^>]+name=["']([^"']+)["'][^>]+value=["']([^"']*)["']/gi)]
            .map(match => [match[1], match[2]]);
        const gateCookies = getSetCookieHeader(gateRes);
        const postRes = await fetch(new URL(action, gateUrl), {
            method: 'POST',
            headers: {
                ...headers,
                Referer: gateUrl,
                Origin: new URL(gateUrl).origin,
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(gateCookies ? { Cookie: gateCookies } : {})
            },
            body: new URLSearchParams(fields),
            signal: AbortSignal.timeout(30000)
        });
        if (!postRes.ok) return [];
        const watchingHtml = await postRes.text();
        const cookies = [gateCookies, getSetCookieHeader(postRes)].filter(Boolean).join('; ');
        const token = watchingHtml.match(/var\s+token\s*=\s*['"]([^'"]+)['"]/i)?.[1];
        if (!token) return [];

        const sourceBases = [
            'https://embdmstr.scrapemaster.net/api/sources/',
            'https://embdmstrplayer.com/sources/'
        ];
        let sourceText = '';
        for (const base of sourceBases) {
            try {
                const sourceRes = await fetch(`${base}${encodeURIComponent(token)}`, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        Referer: postRes.url || gateUrl,
                        Accept: 'application/x-ndjson,text/plain;q=0.9,*/*;q=0.8',
                        'X-Requested-With': 'XMLHttpRequest',
                        ...(cookies ? { Cookie: cookies } : {})
                    },
                    signal: AbortSignal.timeout(30000)
                });
                if (sourceRes.ok) {
                    sourceText = await sourceRes.text();
                    if (sourceText.includes('"type":"server"')) break;
                }
            } catch (_) { /* try the backup endpoint */ }
        }
        const output = [];
        for (const line of sourceText.split(/\r?\n/)) {
            try {
                const source = JSON.parse(line);
                if (source.type !== 'server' || typeof source.source_url !== 'string') continue;
                output.push({
                    // Prime exposes a signed playable page token, not a raw
                    // manifest. Keep it explicit so callers can load the embed.
                    url: `https://embdmstrplayer.com/play/${encodeURIComponent(source.source_url)}`,
                    quality: source.source_quality || source.source_name || 'Prime',
                    type: 'embed',
                    ...(source.source_subtitle ? { subtitles: true } : {})
                });
            } catch (_) { /* ignore non-JSON keep-alive/whitespace lines */ }
        }
        return output;
    } catch (err) {
        console.warn(`[CineSrc] Prime EmbedMaster failed: ${err.message}`);
        return [];
    }
}
const vidsrcWasmModules = new Map();

async function decryptVidSrcStreamUrls(payload) {
    const encrypted = payload?.data?.stream_urls;
    if (Array.isArray(encrypted)) return encrypted;
    if (typeof encrypted !== 'string' || !payload?.vs) return [];

    const wasmUrl = payload.vs.wasm_url;
    let modulePromise;
    if (wasmUrl) {
        const key = String(payload.vs.w || wasmUrl);
        modulePromise = vidsrcWasmModules.get(key);
        if (!modulePromise) {
            modulePromise = fetch(wasmUrl, { signal: AbortSignal.timeout(30000) })
                .then(res => { if (!res.ok) throw new Error(`WASM HTTP ${res.status}`); return res.arrayBuffer(); })
                .then(bytes => WebAssembly.compile(bytes));
            vidsrcWasmModules.set(key, modulePromise);
        }
    } else if (typeof payload.vs.wasm === 'string') {
        modulePromise = WebAssembly.compile(Buffer.from(payload.vs.wasm, 'base64'));
    } else {
        return [];
    }

    const instance = await WebAssembly.instantiate(await modulePromise, {});
    const exports = instance.exports;
    const encryptedBytes = Buffer.from(encrypted, 'base64');
    const ptr = exports.alloc(encryptedBytes.length);
    new Uint8Array(exports.memory.buffer, ptr, encryptedBytes.length).set(encryptedBytes);
    const outputLength = exports.decrypt(ptr, encryptedBytes.length);
    const decoded = Buffer.from(new Uint8Array(exports.memory.buffer, ptr + 12, outputLength)).toString('utf8');
    return decoded.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
}

async function scrapeMega(info, id, s, e) {
    const tv = s != null && e != null;
    const query = new URLSearchParams({ type: tv ? 'tv' : 'movie', id: String(id) });
    if (tv) { query.set('season', String(s)); query.set('episode', String(e)); }
    const found = new Set();
    let mediaHeaders = { ...SOURCE_HEADERS, Referer: 'https://vidsrc.sh/', Origin: 'https://vidsrc.sh' };
    try {
        const route = await fetchJson(`https://vidsrc.sh/vs_src.php?${query}`, {
            headers: { ...SOURCE_HEADERS, Referer: 'https://vidsrc.sh/' },
            signal: AbortSignal.timeout(30000)
        });
        if (typeof route?.src !== 'string') return [];
        const outer = await fetch(route.src, {
            headers: { ...SOURCE_HEADERS, Referer: 'https://vidsrc.sh/' },
            signal: AbortSignal.timeout(30000)
        });
        if (!outer.ok) return [];
        let html = (await outer.text()).replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        const cfg = html.match(/window\.CFG\s*=\s*(\{.*?\});/s);
        if (cfg) {
            try {
                const player = JSON.parse(cfg[1]).playerUrl;
                if (player) {
                    const playerUrl = new URL(player, outer.url).toString();
                    const playerOrigin = new URL(playerUrl).origin;
                    mediaHeaders = { ...SOURCE_HEADERS, Referer: `${playerOrigin}/`, Origin: playerOrigin };
                    const playerRes = await fetch(playerUrl, {
                        headers: { ...SOURCE_HEADERS, Referer: outer.url },
                        signal: AbortSignal.timeout(30000)
                    });
                    if (playerRes.ok) {
                        const playerHtml = (await playerRes.text()).replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                        const config = playerHtml.match(/window\.CONFIG\s*=\s*(\{.*?\});/s);
                        if (config) {
                            const playerConfig = JSON.parse(config[1]);
                            // Current VidSrc players expose streamBase and append
                            // the episode parameters plus stream_urls themselves.
                            // Older players exposed the complete endpoint as api.
                            let streamApi = typeof playerConfig.api === 'string' ? playerConfig.api : null;
                            if (!streamApi && typeof playerConfig.streamBase === 'string') {
                                streamApi = playerConfig.streamBase;
                                if (playerConfig.mediaType === 'tv' || tv) {
                                    const apiUrl = new URL(streamApi, playerUrl);
                                    if (!apiUrl.searchParams.has('season')) apiUrl.searchParams.set('season', String(s));
                                    if (!apiUrl.searchParams.has('episode')) apiUrl.searchParams.set('episode', String(e));
                                    streamApi = apiUrl.toString();
                                }
                                streamApi += streamApi.includes('?') ? '&stream_urls' : '?stream_urls';
                            }
                            if (streamApi) {
                                const streamPayload = await fetchJson(streamApi, {
                                    headers: { Accept: 'application/json' },
                                    signal: AbortSignal.timeout(30000)
                                });
                                for (const url of await decryptVidSrcStreamUrls(streamPayload)) {
                                    if (/^https?:/i.test(url) && /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url)) found.add(url);
                                }
                            }
                        }
                        html += `\n${playerHtml}`;
                    }
                }
            } catch (_) { /* malformed/expired nested player token */ }
        }
        const directPattern = /https?:[^"'\\\s<>]+\.(?:m3u8|mpd)(?:\?[^"'\\\s<>]*)?/gi;
        for (const match of html.matchAll(directPattern)) found.add(match[0]);
    } catch (err) {
        console.warn(`[CineSrc] Mega VidSrc API failed: ${err.message}`);
    }
    // Like the nested player, obtain a fresh IP-bound token per media host.
    const tokens = new Map();
    const streams = await Promise.all([...found].map(async rawUrl => {
        const url = new URL(rawUrl);
        if (!tokens.has(url.origin)) {
            tokens.set(url.origin, (async () => {
                const response = await fetch(`${url.origin}/generate.php`, {
                    headers: mediaHeaders, signal: AbortSignal.timeout(30000)
                });
                if (!response.ok) return '';
                const text = (await response.text()).trim();
                if (!text || text.startsWith('<')) return '';
                try {
                    const value = JSON.parse(text);
                    return typeof value === 'string' ? value : value?.token || value?.data || value?.string || value?.result || '';
                } catch { return text; }
            })().catch(() => ''));
        }
        const token = await tokens.get(url.origin);
        if (typeof token !== 'string' || !token) return null;
        let signedUrl;
        if (rawUrl.includes('__TOKEN__')) signedUrl = rawUrl.replace(/__TOKEN__/g, () => encodeURIComponent(token));
        else { url.searchParams.set('token', token); signedUrl = url.href; }
        return {
            url: signedUrl, quality: 'Mega HLS',
            type: /\.mpd(?:[?#]|$)/i.test(rawUrl) ? 'dash' : 'hls',
            headers: mediaHeaders
        };
    }));
    return streams.filter(Boolean);
}
async function scrapeSpe(info, id, s, e) {
    const tv = s != null && e != null;
    const endpoint = tv ? 'tv' : 'movie';
    const sourceModes = ['megaknight', 'moviebox2', 'warden', 'cinefreak', 'vidapi', 'ipcloud', 'tcloud'];
    const output = [];
    await Promise.all(sourceModes.map(async sourceMode => {
        const params = new URLSearchParams({ id: String(id), mode: 'json', sources: sourceMode });
        if (tv) { params.set('season', String(s)); params.set('episode', String(e)); }
        try {
            const payload = await fetchJson(`https://api.vidlove.cc/${endpoint}?${params}`, {
                headers: VIDLOVE_HEADERS,
                signal: AbortSignal.timeout(30000)
            });
            const source = payload?.source;
            if (!source) return;
            const headers = { ...VIDLOVE_HEADERS, Accept: '*/*', ...(source.headers || payload.headers || {}) };
            const apiUrl = `https://api.vidlove.cc/${endpoint}?${params}`;
            const masterUrl = resolveSourceUrl(source.url, apiUrl);
            const candidates = new Map();
            const addSource = (rawUrl, quality, explicitType) => {
                const url = resolveSourceUrl(rawUrl, masterUrl || apiUrl);
                if (!/^https?:\/\//i.test(url)) return;
                const type = explicitType || (/\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : /\.mkv(?:[?#]|$)/i.test(url) ? 'mkv' : 'hls');
                candidates.set(url, { url, quality: quality || source.label || source.source || sourceMode, type, headers });
            };
            if (masterUrl) addSource(masterUrl, source.label || source.source || `${sourceMode} Auto`, source.type);
            for (const entry of Array.isArray(source.qualities) ? source.qualities : []) {
                if (entry?.url) addSource(entry.url, entry.quality || entry.label || entry.resolution, entry.type);
            }
            const variants = parseHlsVariants(source.manifest, masterUrl || apiUrl);
            if (!String(source.manifest || '').includes('#EXT-X-MEDIA:TYPE=AUDIO')) {
                for (const variant of variants) addSource(variant.url, variant.quality, 'hls');
            }
            output.push(...candidates.values());
        } catch (err) {
            console.warn(`[CineSrc] SPE ${sourceMode} failed: ${err.message}`);
        }
    }));
    return output;
}

// CinemaOS is a Next.js app. Its player configuration and RSC payload can
// contain escaped/HTML-encoded manifest URLs, so the generic page extractor
// must normalize those forms before looking for HLS/DASH sources.
async function scrapeVipplay(info, id, s, e) {
    const pageUrl = buildServerUrl('vipplay', id, s, e);
    if (!pageUrl) return [];
    try {
        const res = await fetch(pageUrl, {
            headers: { ...SOURCE_HEADERS, Referer: 'https://flaxmovies.lol/' },
            signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) return [];
        let body = await res.text();
        body = body
            .replace(/\\u0026/g, '&')
            .replace(/\\u003d/g, '=')
            .replace(/\\\//g, '/')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"');

        const found = new Set();
        const subtitles = [];
        const trackPattern = /<track\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
        for (const match of body.matchAll(trackPattern)) {
            let url = match[1].trim();
            try { url = decodeURIComponent(url); } catch (_) { /* signed URL */ }
            if (!/^https?:/i.test(url) || !/\.(?:vtt|srt)(?:[?#]|$)/i.test(url)) continue;
            const tag = match[0];
            const label = tag.match(/\blabel=["']([^"']+)["']/i)?.[1] || 'Unknown';
            subtitles.push({ url, lang: label });
        }
        // The browser-rendered CinemaOS DOM exposes the selected media as a
        // <source src="..."> element, which may be DASH with a query string.
        const sourcePattern = /<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
        for (const match of body.matchAll(sourcePattern)) {
            let url = match[1].trim();
            try { url = decodeURIComponent(url); } catch (_) { /* signed URL */ }
            if (/^https?:/i.test(url) && /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(url)) found.add(url);
        }
        const patterns = [
            /https?:[^"'\\\s<>]+\.(?:m3u8|mpd)(?:\?[^"'\\\s<>]*)?/gi,
            /https?:[^"'\\\s<>]*(?:\/proxy\/|\/stream\/|\/manifest\/)[^"'\\\s<>]+/gi
        ];
        for (const pattern of patterns) {
            for (const match of body.matchAll(pattern)) {
                let url = match[0].replace(/[),;]+$/, '');
                try { url = decodeURIComponent(url); } catch (_) { /* retain signed URL */ }
                if (/^https?:/i.test(url)) found.add(url);
            }
        }
        return [...found].map(url => {
            const type = /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : 'hls';
            return {
                url,
                quality: `vipplay ${type.toUpperCase()}`,
                type,
                ...(subtitles.length ? { subtitles } : {})
            };
        });
    } catch (err) {
        console.warn(`[CineSrc] Vipplay CinemaOS failed: ${err.message}`);
        return [];
    }
}
const scrapeMovip = makeServerExtractor('Movip');
async function scrapeViz(info, id, s, e) {
    const tv = s != null && e != null;
    const servers = [
        ['dcloud', 'Dcloud'],
        ['apre', 'Apre'],
        ['acme', 'Acme'],
        ['tcloud', 'TCloud'],
        ['ipcloud', 'IPcloud'],
        ['hindi_v3', 'Hindi v3']
    ];
    const output = [];
    await Promise.all(servers.map(async ([serverId, serverName]) => {
        const endpoint = tv
            ? `https://core.vidzee.wtf/streams/tv/${id}/${s}/${e}?s=${serverId}&e=1`
            : `https://core.vidzee.wtf/streams/movie/${id}?s=${serverId}&e=1`;
        try {
            const res = await fetch(endpoint, {
                headers: { ...SOURCE_HEADERS, Referer: 'https://player.vidzee.wtf/', Origin: 'https://player.vidzee.wtf' },
                signal: AbortSignal.timeout(30000)
            });
            if (!res.ok) return;
            const payload = await decryptVidzeePayload(await res.json());
            if (!payload) return;
            for (const stream of extractStreamData(payload, [], endpoint)) {
                // Vidzee currently advertises this CDN1 manifest route, but
                // the origin responds with a Fastify 404 for tested titles.
                // Keep other Viz mirrors (including cdn2.fastcloud.live).
                try {
                    const streamUrl = new URL(stream.url);
                    if (streamUrl.hostname.toLowerCase() === 'cdn1.fastcloud.live'
                        && /^\/e\/[^/]+\/master\.m3u8$/i.test(streamUrl.pathname)) {
                        continue;
                    }
                } catch { /* Keep opaque URLs for the common extractor. */ }
                stream.quality = stream.quality && stream.quality !== 'Auto'
                    ? `${serverName} - ${stream.quality}`
                    : serverName;
                output.push(stream);
            }
        } catch (err) {
            console.warn(`[CineSrc] Viz ${serverName} failed: ${err.message}`);
        }
    }));
    return output;
}

async function scrapeVidrock(info, id, s, e) {
    const path = s != null && e != null ? `/api/tv/${id}/${s}/${e}` : `/api/movie/${id}`;
    const data = await fetchJson(`https://vidrock.net${path}`, { headers: VIDROCK_HEADERS, signal: AbortSignal.timeout(30000) });
    const crypto = require('crypto');
    const key = Buffer.from('7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f', 'hex');
    const decrypt = (value) => {
        const raw = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        if (raw.length < 28) throw new Error('VidRock encrypted URL is too short');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
    };
    const sources = [];
    for (const [name, source] of Object.entries(data || {})) {
        if (!source || typeof source !== 'object' || !source.url) continue;
        try { sources.push({ url: decrypt(source.url), quality: source.language || name, type: source.type || 'unknown' }); }
        catch (err) { console.warn(`[CineSrc] VidRock ${name} URL decrypt failed: ${err.message}`); }
    }
    return sources;
}

// ---------------------------------------------------------------------------
// Server registry
// ---------------------------------------------------------------------------
// Mirrors the live FlaxMovies APP.EMBED_SERVERS ids/names. Every configured
// embed source is queried; VidRock remains an additional non-embed source.
const EMBED_SERVERS = [
    { id: 'tet',     name: 'Tet',     getUrl: (id, s, e) => buildServerUrl('tet', id, s, e),     fn: scrapeFlax },
    { id: 'cld',     name: 'cld',     getUrl: (id, s, e) => buildServerUrl('cld', id, s, e),     fn: scrapeCld },
    { id: 'prime',   name: 'prime',   getUrl: (id, s, e) => buildServerUrl('prime', id, s, e),   fn: scrapePrime },
    { id: 'spe',     name: 'SPE',     getUrl: (id, s, e) => buildServerUrl('spe', id, s, e),     fn: scrapeSpe },
    { id: 'vidsrc',  name: 'Mega',    getUrl: (id, s, e) => buildServerUrl('vidsrc', id, s, e), fn: scrapeMega },
    { id: 'vipplay', name: 'vipplay', getUrl: (id, s, e) => buildServerUrl('vipplay', id, s, e), fn: scrapeVipplay },
    { id: 'movip',   name: 'Movip',   getUrl: (id, s, e) => buildServerUrl('movip', id, s, e),   fn: scrapeMovip },
    { id: 'viz',     name: 'Viz',     getUrl: (id, s, e) => buildServerUrl('viz', id, s, e),     fn: scrapeViz }
];
const AUXILIARY_SERVERS = [
    { id: 'vidrock-extra', name: 'VidRock', fn: scrapeVidrock }
];
const SERVERS = [...EMBED_SERVERS, ...AUXILIARY_SERVERS];

// ---------------------------------------------------------------------------
// Main entry — kept the original export name `getCinesrcStreams`.
// Signature: (tmdbId, mediaType, seasonNum, episodeNum)
// Returns: array of normalized stream objects (matches videasy.js shape)
// ---------------------------------------------------------------------------
async function getCinesrcStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[CineSrc] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    const tmdbKey = TMDB_API_KEY;
    if (!tmdbKey) {
        console.error('[CineSrc] No TMDB API key configured.');
        return [];
    }

    const requestedType = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
    const info = await getTmdbInfo(tmdbId, requestedType, requestedType === 'tv' ? seasonNum : undefined);
    const resolvedType = info?.mediaType || requestedType;
    const isTv = resolvedType === 'tv';
    const resolvedSeason = isTv ? seasonNum : null;
    const resolvedEpisode = isTv ? episodeNum : null;
    if (resolvedType !== requestedType) {
        console.warn(`[CineSrc] TMDB ID ${tmdbId} is ${resolvedType}, not ${requestedType}; routing with TMDB's confirmed type.`);
    }
    // All configured FlaxMovies embed servers accept the TMDB id directly.
    // IMDb metadata is an optional hint for the Tet/Videasy resolver only.

    const allStreams = [];
    const seen = new Set();

    await Promise.all(SERVERS.map(async (server) => {
        let data;
        try {
            // scrapeFlax needs full info; scrapeVidrock needs only id+s+e
            data = await server.fn(info, tmdbId, resolvedSeason, resolvedEpisode);
        } catch (err) {
            console.warn(`[CineSrc] ${server.name} failed: ${err.message}`);
            return;
        }
        if (!data) return;

        // Browser-only HTML embeds are not playable direct media for mpv/Media3.
        const extracted = extractStreamData(data, [], server.getUrl?.(tmdbId, resolvedSeason, resolvedEpisode) || '').filter(stream => stream.type !== 'embed');
        const subtitles = extractSubtitles(data);
        let added = 0;
        for (const stream of extracted) {
            if (seen.has(stream.url)) continue;
            seen.add(stream.url);

            const quality = stream.quality || 'Auto';
            let reqHeaders;
            if (server.name === 'VidRock') {
                reqHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://vidrock.net/', 'Origin': 'https://vidrock.net', 'Accept': '*/*' };
            } else if (server.name === 'Mega') {
                reqHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://vidsrc.sh/', 'Origin': 'https://vidsrc.sh', 'Accept': '*/*' };
            } else if (server.name === 'cld') {
                reqHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://player-4aq.pages.dev/', 'Origin': 'https://player-4aq.pages.dev', 'Accept': '*/*' };
            } else if (server.name === 'SPE') {
                reqHeaders = { ...VIDLOVE_HEADERS, Accept: '*/*' };
            } else if (server.name === 'Viz') {
                reqHeaders = { ...SOURCE_HEADERS, Referer: 'https://player.vidzee.wtf/', Origin: 'https://player.vidzee.wtf' };
            } else if (server.name === 'Tet') {
                reqHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://player.videasy.net/', 'Origin': 'https://player.videasy.net', 'Accept': '*/*' };
            } else if (server.name === 'prime') {
                reqHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://embedmaster.link/', 'Origin': 'https://embedmaster.link', 'Accept': '*/*' };
            } else if (server.name === 'vipplay') {
                reqHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://cinemaos.tech/', 'Origin': 'https://cinemaos.tech', 'Accept': '*/*' };
            } else if (server.name === 'Movip') {
                reqHeaders = { 'User-Agent': USER_AGENT, 'Referer': 'https://moviesapi.to/', 'Origin': 'https://moviesapi.to', 'Accept': '*/*' };
            } else {
                reqHeaders = { ...SOURCE_HEADERS };
            }
            // Preserve extractor-supplied playback headers through normalization.
            for (const [name, value] of Object.entries(stream.headers || {})) {
                if (typeof value !== 'string' || /[\r\n]/.test(name + value)) continue;
                const key = Object.keys(reqHeaders).find(k => k.toLowerCase() === name.toLowerCase()) || name;
                reqHeaders[key] = value;
            }

            const isDash = stream.type === 'dash' || /\.mpd(?:[?#]|$)/i.test(stream.url);
            const isMp4 = stream.type === 'mp4' || /\.mp4(?:[?#]|$)/i.test(stream.url);
            const streamObj = {
                name: `CineSrc ${server.name}`,
                title: `CineSrc - ${server.name} - ${quality}`,
                url: stream.url,
                quality,
                provider: 'CineSrc',
                headers: reqHeaders,
                type: isDash ? 'dash' : isMp4 ? 'mp4' : 'hls',
                format: isDash ? 'dash' : isMp4 ? 'mp4' : 'hls',
                mimeType: isDash ? 'application/dash+xml' : isMp4 ? 'video/mp4' : 'application/vnd.apple.mpegurl'
            };
            if (subtitles.length) streamObj.subtitles = subtitles;

            allStreams.push(streamObj);
            added++;
        }
        console.log(`[CineSrc] ${server.name}: ${added} new source(s)`);
    }));

    console.log(`[CineSrc] Total streams: ${allStreams.length}`);
    return allStreams;
}

module.exports = {
    getCinesrcStreams,
    getCinesrcProxyStatus: cinesrcProxy.getStatus,
    EMBED_SERVERS,
    resolveSourceUrl,
    parseHlsVariants,
    extractPlaybackHeaders,
    extractStreamData
};
