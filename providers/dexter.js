'use strict';

const { fetch } = require('../utils/providerFetch');

const PROVIDER = 'Dexter';
const BASE_URL = 'https://dexter.pw';
const LOG_LEVEL = Number.parseInt(process.env.DEXTER_LOG_LEVEL || '1', 10);
const HEADERS = {
    Referer: `${BASE_URL}/`,
    Origin: BASE_URL,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
};

function describeUrl(value) {
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    } catch {
        return '[invalid-url]';
    }
}

function dexterLog(level, event, details = {}) {
    const levels = { error: 0, warn: 1, info: 1, debug: 2 };
    if (LOG_LEVEL < (levels[level] ?? 1)) return;
    const safeDetails = { ...details };
    for (const key of ['url', 'playlistUrl']) {
        if (safeDetails[key]) safeDetails[key] = describeUrl(safeDetails[key]);
    }
    console.log(`[${PROVIDER}][${level.toUpperCase()}] ${event}`, safeDetails);
}

function getSortTag(rank) {
    let binary = Math.max(0, 5 - rank).toString(2);
    while (binary.length < 20) binary = `0${binary}`;
    return binary.split('').map(bit => bit === '1' ? '\uFEFF' : '\u200B').join('');
}

function toQuality(width, height) {
    if (width >= 3840 || height >= 2160) return { label: '2160p', rank: 5 };
    if (width >= 1920 || height >= 1080) return { label: '1080p', rank: 4 };
    return null;
}

function resolveUrl(path, baseUrl) {
    try {
        if (path.startsWith('http://') || path.startsWith('https://')) return path;
        const base = new URL(baseUrl.startsWith('http') ? baseUrl : BASE_URL);
        return new URL(path, base.origin).href;
    } catch {
        return null;
    }
}

function parseMasterPlaylist(text, baseUrl) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const streams = [];

    for (let index = 0; index < lines.length - 1; index += 1) {
        const info = lines[index];
        if (!info.startsWith('#EXT-X-STREAM-INF')) continue;
        const next = lines[index + 1];
        if (next.startsWith('#')) continue;

        const resolution = info.match(/RESOLUTION=(\d+)x(\d+)/);
        if (!resolution) continue;
        const quality = toQuality(Number.parseInt(resolution[1], 10), Number.parseInt(resolution[2], 10));
        if (!quality) continue;

        const url = resolveUrl(next, baseUrl);
        if (url) streams.push({ url, quality: quality.label, rank: quality.rank });
    }

    dexterLog('debug', 'playlist.parsed', { playlistUrl: baseUrl, candidates: streams.length });
    return streams;
}

async function fetchFromServer(serverId, tmdbId, mediaType, season, episode) {
    let url = `${BASE_URL}/api/s/${serverId}/${mediaType}/${encodeURIComponent(tmdbId)}`;
    if (mediaType === 'tv') url += `/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`;
    url += '?v=3';
    dexterLog('debug', 'server.request', { serverId, url, mediaType, tmdbId, season, episode });

    try {
        const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
        dexterLog('debug', 'server.response', { serverId, url, status: response.status });
        if (!response.ok) return [];

        const text = await response.text();
        if (!text || !text.includes('#EXTM3U')) {
            dexterLog('debug', 'server.not-playlist', { serverId, bytes: text.length });
            return [];
        }

        const effectiveBase = response.url && response.url.startsWith('http') ? response.url : url;
        const streams = parseMasterPlaylist(text, effectiveBase);
        dexterLog('info', 'server.streams', { serverId, streams: streams.length });
        return streams;
    } catch (error) {
        dexterLog('warn', 'server.failed', { serverId, url, error: error.message });
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const started = Date.now();
    dexterLog('info', 'provider.start', { tmdbId, mediaType, season, episode });
    try {
        if (mediaType !== 'movie' && mediaType !== 'tv') {
            dexterLog('warn', 'provider.invalid-type', { mediaType });
            return [];
        }
        if (mediaType === 'tv' && (season == null || episode == null)) {
            dexterLog('warn', 'provider.invalid-tv-request', { tmdbId, season, episode });
            return [];
        }

        const serverIds = [21, 1, 2, 3, 4, 5];
        let found = [];
        for (const serverId of serverIds) {
            found = await fetchFromServer(serverId, tmdbId, mediaType, season, episode);
            if (found.length > 0) break;
        }

        const seen = new Set();
        const streams = found
            .filter(stream => !seen.has(stream.url) && seen.add(stream.url))
            .sort((a, b) => b.rank - a.rank)
            .map(stream => {
                const tag = getSortTag(stream.rank);
                const label = `${PROVIDER} • ${stream.quality} • HLS`;
                return {
                    url: stream.url,
                    name: tag + label,
                    title: tag + label,
                    quality: stream.quality,
                    format: 'hls',
                    mimeType: 'application/vnd.apple.mpegurl',
                    provider: PROVIDER.toLowerCase(),
                    headers: HEADERS,
                    subtitles: [],
                };
            });

        dexterLog('info', 'provider.done', { tmdbId, mediaType, season, episode, streams: streams.length, elapsedMs: Date.now() - started });
        return streams;
    } catch (error) {
        dexterLog('error', 'provider.failed', { tmdbId, mediaType, season, episode, elapsedMs: Date.now() - started, error: error.message });
        return [];
    }
}

module.exports = {
    getStreams,
    parseMasterPlaylist,
    fetchFromServer,
};
