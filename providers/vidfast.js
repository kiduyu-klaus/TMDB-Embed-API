'use strict';
const { fetch } = require('../utils/providerFetch');


const BASE_URL = 'https://streamvaultsrc.click';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REQUEST_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': `${BASE_URL}/`,
    'Origin': BASE_URL
};

function normalizeHttpUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
    } catch (_) {
        return null;
    }
}

function extractPageText(html) {
    if (!html || typeof html !== 'string') return null;
    const patterns = [
        /\\"(?:en|token)\\":\\"(.*?)\\"/,
        /"(?:en|token)":"(.*?)"/,
        /'en':'(.*?)'/,
        /data\s*=\s*"(.*?)"/
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function getStreamFormat(url, suppliedType) {
    const type = String(suppliedType || '').toLowerCase();
    const pathname = new URL(url).pathname.toLowerCase();
    if (type === 'hls' || pathname.endsWith('.m3u8')) {
        return { type: 'hls', mimeType: 'application/vnd.apple.mpegurl' };
    }
    if (type === 'dash' || pathname.endsWith('.mpd')) {
        return { type: 'dash', mimeType: 'application/dash+xml' };
    }
    return { type: 'mp4', mimeType: 'video/mp4' };
}

function normalizeQuality(value) {
    const quality = String(value || 'Auto').trim();
    if (/^(auto|adaptive)$/i.test(quality)) return 'Auto';
    return /^\d{3,4}$/.test(quality) ? `${quality}p` : quality || 'Auto';
}

function normalizeSubtitles(value) {
    const items = Array.isArray(value) ? value : value ? [value] : [];
    const seen = new Set();
    return items.flatMap(item => {
        const subtitle = typeof item === 'string'
            ? { file: item }
            : item && typeof item === 'object' ? item : null;
        if (!subtitle) return [];
        const url = normalizeHttpUrl(subtitle.file || subtitle.url || subtitle.src || subtitle.source);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        const pathname = new URL(url).pathname.toLowerCase();
        const mimeType = subtitle.mimeType || (
            pathname.endsWith('.vtt') ? 'text/vtt' :
            pathname.endsWith('.srt') ? 'application/x-subrip' :
            'text/vtt'
        );
        const label = subtitle.label || subtitle.language || subtitle.lang || subtitle.name || 'Subtitles';
        const language = subtitle.language || subtitle.lang || (/^[a-z]{2,3}$/i.test(label) ? label.toLowerCase() : '');
        const lang = subtitle.lang || language;
        return [{
            ...subtitle,
            url,
            mimeType,
            language,
            label,
            headers: subtitle.headers && typeof subtitle.headers === 'object' ? subtitle.headers : {},
            lang,
            id: subtitle.id || `streamvault-${seen.size}`
        }];
    });
}

function normalizeServerStreams(payload, server = {}) {
    const streamList = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.streams) ? payload.streams : [payload];
    const serverName = String(server.name || server.label || server.server || 'Server').trim();
    const seen = new Set();
    return streamList.flatMap(stream => {
        if (!stream || typeof stream !== 'object') return [];
        const url = normalizeHttpUrl(stream.url || stream.file || stream.src || stream.link);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        const quality = normalizeQuality(stream.quality || stream.label || stream.resolution);
        const format = getStreamFormat(url, stream.type || stream.format);
        const subtitleValue = stream.subtitles || stream.subtitle || stream.tracks || stream.captions || stream.textTracks;
        return [{
            name: `Vidfast ${stream.name || serverName}`,
            title: `Vidfast - ${stream.name || serverName} - ${quality}`,
            url,
            quality,
            provider: 'Vidfast',
            ...format,
            headers: {
                ...REQUEST_HEADERS,
                ...(stream.headers && typeof stream.headers === 'object' ? stream.headers : {})
            },
            subtitles: normalizeSubtitles(subtitleValue)
        }];
    });
}

async function getVidfastStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidfast] Fetching StreamVault streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
    try {
        const type = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
        if (type === 'tv' && (!seasonNum || !episodeNum)) {
            console.warn('[Vidfast] Series request is missing season or episode');
            return [];
        }
        const endpoint = type === 'tv'
            ? `${BASE_URL}/api/embed-streams/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(seasonNum)}/${encodeURIComponent(episodeNum)}`
            : `${BASE_URL}/api/embed-streams/movie/${encodeURIComponent(tmdbId)}`;
        const response = await fetch(endpoint, {
            headers: REQUEST_HEADERS,
            signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) {
            console.warn(`[Vidfast] StreamVault request failed: HTTP ${response.status}`);
            return [];
        }
        const payload = await response.json();
        if (!Array.isArray(payload?.streams) || payload.streams.length === 0) {
            console.warn('[Vidfast] StreamVault returned no streams');
            return [];
        }
        const streams = normalizeServerStreams(payload.streams);
        console.log(`[Vidfast] Total streams: ${streams.length}`);
        return streams;
    } catch (err) {
        console.error(`[Vidfast] Error: ${err.message}`);
        return [];
    }
}

module.exports = {
    getVidfastStreams,
    extractPageText,
    normalizeServerStreams
};
