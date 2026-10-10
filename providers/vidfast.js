const axios = require('axios');
const { extractSubtitles: extractSharedSubtitles, resolveLanguage } = require('../utils/vidProviderSubtitles');
const { getVidServerParts } = require('../utils/vidHandshake');

const extractSubtitles = (payload, streamUrl) => extractSharedSubtitles(payload, streamUrl, { Referer: 'https://vidfast.vc/', 'User-Agent': PAGE_HEADERS['User-Agent'] });

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

        const { servers: serversUrl, stream: streamBase, token } = await getVidServerParts(
            ENCRYPT_URL, pageText, BASE_HEADERS, 15000
        );
        const csrfHeaders = { ...BASE_HEADERS, 'X-CSRF-Token': token || '' };
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