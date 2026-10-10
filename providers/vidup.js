const axios = require('axios');

const BASE_URL = 'https://vidup.to';
const ENCRYPT_URL = 'https://enc-dec.app/api/enc-vidup';
const DECRYPT_URL = 'https://enc-dec.app/api/dec-vidup';
const REQUEST_TIMEOUT_MS = 12000;


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
    try {
        const response = await axios.get(stream.url, {
            headers: { ...stream.headers, Range: 'bytes=0-1023' },
            timeout: 4500,
            maxRedirects: 5,
            responseType: 'arraybuffer',
            maxContentLength: 2 * 1024 * 1024,
            validateStatus: () => true
        });
        if (response.status < 200 || response.status >= 400) return false;
        const prefix = Buffer.from(response.data).subarray(0, 64).toString('utf8').trimStart();
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (stream.type === 'hls') return contentType.includes('mpegurl') || prefix.startsWith('#EXTM3U');
        if (stream.type === 'dash') return contentType.includes('dash+xml') || prefix.startsWith('<MPD');
        return true;
    } catch {
        return false;
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
    try {
        const encryptedResponse = await axios.post(`${streamBase}/${server.data}`, null, {
            headers,
            timeout: REQUEST_TIMEOUT_MS
        });
        const encrypted = typeof encryptedResponse.data === 'string'
            ? encryptedResponse.data
            : JSON.stringify(encryptedResponse.data);
        const decryptedResponse = await axios.post(DECRYPT_URL, { text: encrypted }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: REQUEST_TIMEOUT_MS
        });
        return normalizeServerStreams(validateBridge(decryptedResponse.data, `${serverName} decryption`), server);
    } catch (error) {
        console.warn(`[Vidup] ${serverName} failed: ${error.message}`);
        return [];
    }
}

async function getVidupStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const isSeries = mediaType === 'tv' || mediaType === 'series';
    if (isSeries && (!seasonNum || !episodeNum)) {
        console.warn('[Vidup] Series request is missing season or episode');
        return [];
    }
    try {
        const pageUrl = isSeries
            ? `${BASE_URL}/tv/${tmdbId}/${seasonNum}/${episodeNum}`
            : `${BASE_URL}/movie/${tmdbId}`;
        const pageResponse = await axios.get(pageUrl, { headers: PAGE_HEADERS, timeout: REQUEST_TIMEOUT_MS });
        const pageText = extractPageText(typeof pageResponse.data === 'string' ? pageResponse.data : '');
        if (!pageText) throw new Error('Could not extract page token');

        const encryptedParts = await axios.get(ENCRYPT_URL, {
            params: { text: pageText, stage: 1 },
            timeout: REQUEST_TIMEOUT_MS
        });
        const stage1 = validateBridge(encryptedParts.data, 'Vidup stage 1 encryption');
        if (!stage1.stage1) throw new Error('Stage 1 response is missing URL');
        const handshake = await axios.post(stage1.stage1, null, {
            headers: { ...API_HEADERS, 'X-CSRF-Token': stage1.token || '' },
            timeout: REQUEST_TIMEOUT_MS
        });
        const stage2 = await axios.get(ENCRYPT_URL, {
            params: { text: typeof handshake.data === 'string' ? handshake.data : JSON.stringify(handshake.data), stage: 2 },
            timeout: REQUEST_TIMEOUT_MS
        });
        const { servers: serversUrl, stream: streamBase, token = '' } = validateBridge(
            stage2.data,
            'Vidup stage 2 encryption'
        );
        if (!serversUrl || !streamBase) throw new Error('Encryption response is missing server URLs');

        const headers = { ...API_HEADERS, 'X-CSRF-Token': token || '' };
        const encryptedServersResponse = await axios.post(serversUrl, null, {
            headers,
            timeout: REQUEST_TIMEOUT_MS
        });
        const encryptedServers = typeof encryptedServersResponse.data === 'string'
            ? encryptedServersResponse.data
            : JSON.stringify(encryptedServersResponse.data);
        const decryptedServersResponse = await axios.post(DECRYPT_URL, { text: encryptedServers }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: REQUEST_TIMEOUT_MS
        });
        const servers = validateBridge(decryptedServersResponse.data, 'Server list decryption');
        if (!Array.isArray(servers) || servers.length === 0) return [];

        console.log(`[Vidup] Fetching ${servers.length} server(s)`);
        const results = await Promise.all(servers.filter(server => server && server.data).map(server => fetchServer(server, streamBase, headers)));
        const unique = [...new Map(results.flat().map(stream => [stream.url, stream])).values()];
        const checks = await Promise.all(unique.map(isPlayableStream));
        const playable = unique.filter((stream, index) => checks[index]);
        console.log(`[Vidup] Emitted ${playable.length}/${unique.length} playable unique stream(s)`);
        return playable;
    } catch (error) {
        console.error(`[Vidup] Error: ${error.message}`);
        return [];
    }
}

module.exports = { getVidupStreams, extractPageText, normalizeServerStreams, isPlayableStream };
