// Dynamic import keeps this provider compatible with CommonJS callers.
let dnsModule;
function loadDns() {
    return dnsModule ??= import('../utils/dns-fix.mjs');
}

async function dnsRequest(method, url, data, config = {}) {
    const started = Date.now();
    const { dnsFetch } = await loadDns();
    const target = new URL(url);
    for (const [key, value] of Object.entries(config.params || {})) {
        target.searchParams.set(key, String(value));
    }
    const headers = new Headers(config.headers);
    if (data != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
    console.log(`[Vidup HTTP] ${method} ${target.origin}; timeout=${config.timeout || REQUEST_TIMEOUT_MS}ms`);
    const response = await dnsFetch(target, {
        method,
        headers,
        body: data == null ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(config.timeout || REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${target.origin}${target.pathname}`);
    const text = await response.text();
    console.log(`[Vidup HTTP] HTTP ${response.status}; ${Buffer.byteLength(text)} bytes; ${Date.now() - started}ms`);
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* Page HTML and encrypted text are not JSON. */ }
    return { data: parsed };
}

const dnsClient = {
    get: (url, config) => dnsRequest('GET', url, null, config),
    post: (url, data, config) => dnsRequest('POST', url, data, config)
};

const BASE_URL = 'https://vidup.to';
const ENCRYPT_URL = 'https://enc-dec.app/api/enc-vidup';
const DECRYPT_URL = 'https://enc-dec.app/api/dec-vidup';
const REQUEST_TIMEOUT_MS = 30000;


const PAGE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Cookie': '_ga=GA1.1.2053678155.1790958039; perf_dv6Tr4n=1; _ga_JMWN78FZNK=GS2.1.s1791656965$o4$g0$t1791656999$j26$l0$h0'
};



const API_HEADERS = {
    ...PAGE_HEADERS,
    'Referer': `${BASE_URL}/`,
    'X-Requested-With': 'XMLHttpRequest'
};

function extractPageText(html) {
    if (typeof html !== 'string') return null;
    const match = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    return match ? match[1] : null;
}

function normalizeHttpUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch {
        return null;
    }
}

function collectCandidates(data, inherited = {}, output = [], seen = new Set()) {
    if (!data) return output;
    if (typeof data === 'string') {
        const url = normalizeHttpUrl(data);
        if (url) output.push({ ...inherited, url });
        return output;
    }
    if (typeof data !== 'object' || seen.has(data)) return output;
    seen.add(data);
    if (Array.isArray(data)) {
        data.forEach(item => collectCandidates(item, inherited, output, seen));
        return output;
    }
    const metadata = {
        quality: data.quality || data.label || data.resolution || inherited.quality,
        type: data.type || data.format || inherited.type,
        headers: data.headers && typeof data.headers === 'object' ? data.headers : inherited.headers
    };
    ['url', 'stream_url', 'playlist', 'file'].forEach(field => {
        const url = normalizeHttpUrl(data[field]);
        if (url) output.push({ ...metadata, url });
    });
    if (typeof data.stream === 'string') {
        const url = normalizeHttpUrl(data.stream);
        if (url) output.push({ ...metadata, url });
    }
    ['stream', 'streams', 'sources'].forEach(field => {
        if (data[field] && typeof data[field] === 'object') {
            collectCandidates(data[field], metadata, output, seen);
        }
    });
    if (data.qualities && typeof data.qualities === 'object') {
        Object.entries(data.qualities).forEach(([quality, value]) => {
            collectCandidates(value, { ...metadata, quality }, output, seen);
        });
    }
    return output;
}

function getFormat(url, rawType) {
    const type = String(rawType || '').toLowerCase();
    if (type === 'hls' || /\.m3u8(?:$|[?#])/i.test(url)) {
        return { type: 'hls', mimeType: 'application/vnd.apple.mpegurl' };
    }
    if (type === 'dash' || /\.mpd(?:$|[?#])/i.test(url)) {
        return { type: 'dash', mimeType: 'application/dash+xml' };
    }
    return { type: 'direct' };
}

function normalizeQuality(value) {
    const quality = String(value || 'Auto').trim();
    return /^\d{3,4}$/.test(quality) ? `${quality}p` : quality || 'Auto';
}

function normalizeServerStreams(payload, server) {
    const serverName = String(server.name || server.label || server.server || server.data || 'Server').trim();
    const seen = new Set();
    return collectCandidates(payload).flatMap(candidate => {
        if (!candidate.url || seen.has(candidate.url)) return [];
        seen.add(candidate.url);
        const quality = normalizeQuality(candidate.quality || server.quality);
        return [{
            name: `Vidup ${serverName}`,
            title: `Vidup - ${serverName} - ${quality}`,
            url: candidate.url,
            quality,
            provider: 'Vidup',
            ...getFormat(candidate.url, candidate.type),
            subtitles: [],
            headers: {
                ...(candidate.headers || {}),
                'User-Agent': PAGE_HEADERS['User-Agent'],
                'Origin': BASE_URL,
                'Referer': `${BASE_URL}/`
            }
        }];
    });
}

async function isPlayableStream(stream) {
    let response;
    const started = Date.now();
    try {
        console.log(`[Vidup] Checking ${stream.type || 'direct'} stream at ${new URL(stream.url).origin}`);
        const { dnsFetchStream } = await loadDns();
        response = await dnsFetchStream(stream.url, {
            headers: { ...stream.headers, Range: 'bytes=0-1023' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (response.statusCode < 200 || response.statusCode >= 400) {
            console.warn(`[Vidup] Playback check rejected: HTTP ${response.statusCode}`);
            return false;
        }
        // Stop after the prefix even if the CDN ignores Range and sends a full video.
        const chunks = [];
        let length = 0;
        for await (const chunk of response.stream) {
            const part = chunk.subarray(0, 64 - length);
            chunks.push(part);
            length += part.length;
            if (length >= 64) break;
        }
        const prefix = Buffer.concat(chunks).toString('utf8').trimStart();
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        const playable = stream.type === 'hls' ? contentType.includes('mpegurl') || prefix.startsWith('#EXTM3U')
            : stream.type === 'dash' ? contentType.includes('dash+xml') || prefix.startsWith('<MPD') : true;
        console.log(`[Vidup] Playback check ${playable ? 'passed' : 'rejected (format mismatch)'}; ${Date.now() - started}ms`);
        return playable;
    } catch (error) {
        console.warn(`[Vidup] Playback check failed: ${error.code || error.name}; ${Date.now() - started}ms`);
        return false;
    } finally {
        response?.stream.destroy();
    }
}

function validateBridge(data, operation) {
    if (!data || data.status !== 200 || data.result === undefined || data.result === null) {
        const status = data && data.status !== undefined ? data.status : 'unknown';
        const error = data && data.error ? data.error : 'unknown';
        throw new Error(`${operation} failed (status=${status}, error=${error})`);
    }
    return data.result;
}

async function fetchServer(server, streamBase, headers) {
    const serverName = server.name || server.data;
    const started = Date.now();
    console.log('[Vidup] Fetching and decrypting server stream');
    try {
        const encryptedResponse = await dnsClient.post(`${streamBase}/${server.data}`, null, {
            headers,
            timeout: REQUEST_TIMEOUT_MS
        });
        const encrypted = typeof encryptedResponse.data === 'string'
            ? encryptedResponse.data
            : JSON.stringify(encryptedResponse.data);
        const decryptedResponse = await dnsClient.post(DECRYPT_URL, { text: encrypted }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: REQUEST_TIMEOUT_MS
        });
        const streams = normalizeServerStreams(validateBridge(decryptedResponse.data, `${serverName} decryption`), server);
        console.log(`[Vidup] Server produced ${streams.length} stream candidate(s); ${Date.now() - started}ms`);
        return streams;
    } catch (error) {
        console.warn(`[Vidup] ${serverName} failed: ${error.message}`);
        return [];
    }
}

async function getVidupStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const started = Date.now();
    console.log(`[Vidup] Starting TMDB ${tmdbId}; type=${mediaType}; season=${seasonNum ?? '-'}; episode=${episodeNum ?? '-'}`);
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    if (isSeries && (!seasonNum || !episodeNum)) {
        console.warn('[Vidup] Series request is missing season or episode');
        return [];
    }
    try {
        const pageUrl = isSeries
            ? `${BASE_URL}/tv/${tmdbId}/${seasonNum}/${episodeNum}`
            : `${BASE_URL}/movie/${tmdbId}`;
        console.log('[Vidup] Loading embed page');
        const pageResponse = await dnsClient.get(pageUrl, { headers: PAGE_HEADERS, timeout: REQUEST_TIMEOUT_MS });
        const pageText = extractPageText(typeof pageResponse.data === 'string' ? pageResponse.data : '');
        if (!pageText) throw new Error('Could not extract page token');
        console.log('[Vidup] Page token extracted; requesting stage 1 encryption');

        const encryptedParts = await dnsClient.get(ENCRYPT_URL, {
            params: { text: pageText, stage: 1 },
            timeout: REQUEST_TIMEOUT_MS
        });
        const stage1 = validateBridge(encryptedParts.data, 'Vidup stage 1 encryption');
        if (!stage1.stage1) throw new Error('Stage 1 response is missing URL');
        console.log('[Vidup] Stage 1 ready; sending handshake');
        const handshake = await dnsClient.post(stage1.stage1, null, {
            headers: { ...API_HEADERS, 'X-CSRF-Token': stage1.token || '' },
            timeout: REQUEST_TIMEOUT_MS
        });
        console.log('[Vidup] Handshake complete; requesting stage 2 encryption');
        const stage2 = await dnsClient.get(ENCRYPT_URL, {
            params: { text: typeof handshake.data === 'string' ? handshake.data : JSON.stringify(handshake.data), stage: 2 },
            timeout: REQUEST_TIMEOUT_MS
        });
        const { servers: serversUrl, stream: streamBase, token = '' } = validateBridge(
            stage2.data,
            'Vidup stage 2 encryption'
        );
        if (!serversUrl || !streamBase) throw new Error('Encryption response is missing server URLs');
        console.log('[Vidup] Stage 2 ready; fetching and decrypting server list');

        const headers = { ...API_HEADERS, 'X-CSRF-Token': token || '' };
        const encryptedServersResponse = await dnsClient.post(serversUrl, null, {
            headers,
            timeout: REQUEST_TIMEOUT_MS
        });
        const encryptedServers = typeof encryptedServersResponse.data === 'string'
            ? encryptedServersResponse.data
            : JSON.stringify(encryptedServersResponse.data);
        const decryptedServersResponse = await dnsClient.post(DECRYPT_URL, { text: encryptedServers }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: REQUEST_TIMEOUT_MS
        });
        const servers = validateBridge(decryptedServersResponse.data, 'Server list decryption');
        if (!Array.isArray(servers) || servers.length === 0) {
            console.warn('[Vidup] No servers returned by decoding service');
            return [];
        }

        console.log(`[Vidup] Fetching ${servers.length} server(s)`);
        const results = await Promise.all(servers.filter(server => server && server.data).map(server => fetchServer(server, streamBase, headers)));
        const unique = [...new Map(results.flat().map(stream => [stream.url, stream])).values()];
        console.log(`[Vidup] Checking ${unique.length} unique stream candidate(s)`);
        const checks = await Promise.all(unique.map(isPlayableStream));
        const playable = unique.filter((stream, index) => checks[index]);
        console.log(`[Vidup] Emitted ${playable.length}/${unique.length} playable unique stream(s); total=${Date.now() - started}ms`);
        return playable;
    } catch (error) {
        console.error(`[Vidup] Error: ${error.message}`);
        return [];
    }
}

module.exports = { getVidupStreams, extractPageText, normalizeServerStreams, isPlayableStream };
