const diagnostics = require('../utils/providerTrace').createProviderTrace('Movix', { redact: false });
const tracedFetch = diagnostics.fetch;

const BASE_URL = 'https://movix.dog';
const API_URL = 'https://api.movix.dog/api';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

function getWatchUrl(tmdbId, mediaType, season, episode) {
    return mediaType === 'tv'
        ? `${BASE_URL}/watch/tv/${tmdbId}/s/${Number(season)}/e/${Number(episode)}`
        : `${BASE_URL}/watch/movie/${tmdbId}`;
}

function getHeaders(referer) {
    return {
        Accept: '*/*',
        Referer: referer,
        Origin: BASE_URL,
        'User-Agent': USER_AGENT
    };
}

function getResolutionLabel(width, height) {
    if (width >= 3200 || height >= 2000) return '2160p';
    if (width >= 1800 || height >= 1000) return '1080p';
    if (width >= 1200 || height >= 700) return '720p';
    if (width >= 800 || height >= 450) return '480p';
    return `${height}p`;
}

function resolvePlaylistUrl(entry, playlistUrl) {
    if (/^https?:\/\//i.test(entry)) return entry;
    return new URL(entry, playlistUrl).toString();
}

function buildStream(url, sourceName, sourceKey, quality, format = 'm3u8') {
    return {
        name: `Movix • ${sourceName}`,
        title: `Movix • ${sourceName}`,
        source: sourceKey,
        url,
        quality,
        format,
        headers: {
            Referer: `${BASE_URL}/`,
            Origin: BASE_URL,
            'User-Agent': USER_AGENT
        }
    };
}

async function parseMasterPlaylist(playlistUrl, sourceName, sourceKey, headers) {
    try {
        const response = await tracedFetch(playlistUrl, { headers });
        if (!response.ok) return [];
        const text = await response.text();
        if (!text.includes('#EXT-X-STREAM-INF')) return [];

        const lines = text.split(/\r?\n/);
        const streams = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
            const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/i);
            const quality = resolution
                ? getResolutionLabel(Number(resolution[1]), Number(resolution[2]))
                : 'Auto';
            const variant = lines.slice(i + 1).find(value => value.trim() && !value.trim().startsWith('#'));
            if (variant) {
                streams.push(buildStream(
                    resolvePlaylistUrl(variant.trim(), playlistUrl),
                    sourceName,
                    sourceKey,
                    quality
                ));
            }
        }
        return streams;
    } catch (error) {
        diagnostics.log('playlist.error', { source: sourceKey, error: error.message });
        return [];
    }
}

function sourceName(source, index) {
    const raw = String(source?.name || '').trim();
    const parts = raw.split('|').map(value => value.trim()).filter(Boolean);
    return parts[0] || `Source ${index + 1}`;
}

function sourceQuality(source) {
    const raw = String(source?.name || '');
    const match = raw.match(/\b(2160p|1440p|1080p|720p|576p|480p|360p)\b/i);
    return match ? match[1].toLowerCase() : 'Auto';
}

async function fetchMovixSources(tmdbId, mediaType, season, episode) {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const query = type === 'tv'
        ? `?season=${encodeURIComponent(Number(season))}&episode=${encodeURIComponent(Number(episode))}`
        : '';
    const endpoint = `${API_URL}/purstream/${type}/${encodeURIComponent(tmdbId)}/stream${query}`;
    const referer = getWatchUrl(tmdbId, type, season, episode);
    const response = await tracedFetch(endpoint, { headers: getHeaders(referer) });
    if (!response.ok) {
        diagnostics.log('source.request_failed', { endpoint, status: response.status });
        return { referer, sources: [] };
    }
    const payload = await response.json();
    return {
        referer,
        sources: Array.isArray(payload?.sources) ? payload.sources : []
    };
}

async function getStreamsImpl(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        if (type === 'tv' && (season == null || episode == null)) return [];

        const { referer, sources } = await fetchMovixSources(tmdbId, type, season, episode);
        const streams = [];

        for (let index = 0; index < sources.length; index++) {
            const source = sources[index];
            if (!source?.url) continue;
            const key = String(source.name || `source-${index + 1}`);
            const name = sourceName(source, index);
            const headers = getHeaders(referer);
            const variants = String(source.format || '').toLowerCase() === 'm3u8'
                ? await parseMasterPlaylist(source.url, name, key, headers)
                : [];

            if (variants.length) {
                streams.push(...variants);
            } else {
                streams.push(buildStream(
                    source.url,
                    name,
                    key,
                    sourceQuality(source),
                    source.format || 'unknown'
                ));
            }
        }

        const seen = new Set();
        const uniqueStreams = streams.filter(stream => {
            if (!stream?.url || seen.has(stream.url)) return false;
            seen.add(stream.url);
            return true;
        });

        diagnostics.log('streams.resolved', {
            tmdbId,
            mediaType: type,
            season,
            episode,
            sourceCount: sources.length,
            streamCount: uniqueStreams.length
        });
        return uniqueStreams;
    } catch (error) {
        diagnostics.log('extract.error', { tmdbId, mediaType, season, episode, error: error.message });
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const args = [tmdbId, mediaType, season, episode];
    return diagnostics.run(() => getStreamsImpl(...args), args);
}

module.exports = { getStreams };
