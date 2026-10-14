const axios = require('axios');

const TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
const ENC_DEC_API = 'https://enc-dec.app/api';
const VIDLINK_API = 'https://vidlink.pro/api/b';
const VIDLINK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Connection': 'keep-alive',
    'Referer': 'https://vidlink.pro/',
    'Origin': 'https://vidlink.pro',
    'X-Playback-Environment': 'webkit',
    'Accept': 'application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.5'
};

const VIDLINK_MEDIA_PROXY = 'https://flood.sourcerrr.online';

const QUALITY_ORDER = {
    '4K': 5,
    '1440p': 4,
    '1080p': 3,
    '720p': 2,
    '480p': 1,
    '360p': 0,
    '240p': -1,
    'Auto': -2,
    'Unknown': -3
};

function normalizeCaptions(captions) {
    const seen = new Set();
    return (Array.isArray(captions) ? captions : []).flatMap(caption => {
        if (!caption || !caption.url || !isHttpUrl(caption.url) || seen.has(caption.url)) return [];
        seen.add(caption.url);
        const language = caption.language || caption.label || 'und';
        const format = String(caption.type || caption.format || '').toLowerCase();
        return [{
            url: caption.url,
            language,
            label: language,
            name: language,
            mimeType: format === 'srt' || /\.srt(?:[?#]|$)/i.test(caption.url)
                ? 'application/x-subrip' : 'text/vtt',
            headers: normalizeHeaders(caption.headers)
        }];
    });
}

function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_error) {
        return false;
    }
}

function normalizeHeaders(headers) {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name, value]) => typeof name === 'string' && typeof value === 'string'
        )
    );
}

async function makeRequest(url, options = {}) {
    const defaultHeaders = {
        'User-Agent': VIDLINK_HEADERS['User-Agent'],
        'Accept': 'application/json,*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'keep-alive',
        ...(options.headers || {})
    };

    if (globalThis.fetch) {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: defaultHeaders,
            ...(options.body ? { body: options.body } : {}),
            ...(options.params ? { cache: 'no-store' } : {})
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    }

    const { params, timeout = 15000, responseType = 'json', body } = options;
    const response = await axios({
        method: options.method || 'GET',
        url,
        headers: defaultHeaders,
        params,
        data: body,
        timeout,
        responseType,
        validateStatus: status => status >= 200 && status < 300
    });

    return {
        ok: true,
        status: response.status,
        statusText: response.statusText || 'OK',
        headers: response.headers || {},
        async json() { return response.data; },
        async text() { return typeof response.data === 'string' ? response.data : JSON.stringify(response.data); }
    };
}

async function getTmdbInfo(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const response = await makeRequest(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`);
    const data = await response.json();
    const title = mediaType === 'tv' ? data.name : data.title;
    const year = (mediaType === 'tv' ? data.first_air_date : data.release_date)?.substring(0, 4);
    if (!title) throw new Error('Could not extract title from TMDB response');
    return { title, year };
}

async function encryptTmdbId(tmdbId) {
    const response = await makeRequest(`${ENC_DEC_API}/enc-vidlink?text=${tmdbId}`);
    const data = await response.json();
    if (data && data.result) return data.result;
    throw new Error('Invalid encryption response from enc-dec.app');
}

function resolveUrl(url, baseUrl) {
    if (url.startsWith('http')) return url;
    try { return new URL(url, baseUrl).toString(); } catch { return url; }
}

function getQualityFromResolution(resolution) {
    if (!resolution) return 'Auto';
    const [, height] = resolution.split('x').map(Number);
    if (height >= 2160) return '4K';
    if (height >= 1440) return '1440p';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    return '240p';
}

function extractQuality(streamData) {
    if (!streamData) return 'Unknown';
    for (const field of ['quality', 'resolution', 'label', 'name']) {
        if (!streamData[field]) continue;
        const value = streamData[field].toString().toLowerCase();
        if (value.includes('2160') || value.includes('4k')) return '4K';
        if (value.includes('1440') || value.includes('2k')) return '1440p';
        if (value.includes('1080') || value.includes('fhd')) return '1080p';
        if (value.includes('720') || value.includes('hd')) return '720p';
        if (value.includes('480') || value.includes('sd')) return '480p';
        if (value.includes('360')) return '360p';
        if (value.includes('240')) return '240p';
        const match = value.match(/(\d{3,4})[pP]?/);
        if (match) {
            const parsed = parseInt(match[1], 10);
            if (parsed >= 2160) return '4K';
            if (parsed >= 1440) return '1440p';
            if (parsed >= 1080) return '1080p';
            if (parsed >= 720) return '720p';
            if (parsed >= 480) return '480p';
            if (parsed >= 360) return '360p';
            return '240p';
        }
    }
    return 'Unknown';
}

function base64UrlEncode(value) {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function rewriteVidlinkPlaylist(data) {
    const stream = data && data.stream;
    if (!stream || !stream.playlist || stream.requiresProxy !== true) return stream && stream.playlist ? stream.playlist : null;

    let source;
    try {
        source = new URL(stream.playlist);
    } catch {
        return null;
    }

    const cookie = stream.playlistHeaders && (stream.playlistHeaders.Cookie || stream.playlistHeaders.cookie);
    if (!cookie) return null;

    const params = new URLSearchParams(source.search);
    params.set('host', source.origin);
    params.set('sc', base64UrlEncode(cookie));
    return `${VIDLINK_MEDIA_PROXY}/sacdn${source.pathname}?${params.toString()}`;
}

function parseM3U8(content, baseUrl) {
    const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
    const streams = [];
    let current = null;

    for (const line of lines) {
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            current = { bandwidth: null, resolution: null, url: null };
            const bandwidth = line.match(/BANDWIDTH=(\d+)/);
            if (bandwidth) current.bandwidth = parseInt(bandwidth[1], 10);
            const resolution = line.match(/RESOLUTION=(\d+x\d+)/);
            if (resolution) current.resolution = resolution[1];
        } else if (current && !line.startsWith('#')) {
            current.url = resolveUrl(line, baseUrl);
            streams.push(current);
            current = null;
        }
    }

    return streams;
}

function collapsePlaylistVariants(parsed, masterUrl) {
    const distinct = new Set(
        parsed.map(item => item.quality).filter(item => item && item !== 'Auto' && item !== 'Unknown')
    );
    if (distinct.size <= 1) {
        return [{ name: 'Vidlink - Auto', title: parsed[0] && parsed[0].title, url: masterUrl, quality: 'Auto' }];
    }
    return parsed;
}

async function fetchAndParseM3U8(playlistUrl, title) {
    try {
        const response = await makeRequest(playlistUrl, { headers: VIDLINK_HEADERS });
        const content = await response.text();
        const parsed = parseM3U8(content, playlistUrl);
        if (parsed.length === 0) {
            return [{ name: 'Vidlink - Auto', title, url: playlistUrl, quality: 'Auto' }];
        }
        return parsed.map(stream => ({
            name: `Vidlink - ${getQualityFromResolution(stream.resolution)}`,
            title,
            url: stream.url,
            quality: getQualityFromResolution(stream.resolution)
        }));
    } catch (_error) {
        return [{ name: 'Vidlink - Auto', title, url: playlistUrl, quality: 'Auto' }];
    }
}

function processVidlinkResponse(data, title) {
    const streams = [];
    try {
        if (data && data.stream && data.stream.qualities) {
            Object.entries(data.stream.qualities).forEach(([qualityKey, qualityData]) => {
                if (qualityData && qualityData.url) {
                    streams.push({
                        name: `Vidlink - ${extractQuality({ quality: qualityKey })}`,
                        title,
                        url: qualityData.url,
                        quality: extractQuality({ quality: qualityKey })
                    });
                }
            });
            if (data.stream.playlist) streams.push({ _isPlaylist: true, url: data.stream.playlist });
        } else if (data && data.stream && data.stream.playlist) {
            streams.push({ _isPlaylist: true, url: data.stream.playlist });
        } else if (data && data.url) {
            streams.push({ name: `Vidlink - ${extractQuality(data)}`, title, url: data.url, quality: extractQuality(data) });
        } else if (typeof data === 'object') {
            const findUrls = (obj) => {
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === 'string' && (value.startsWith('http') || value.includes('.m3u8'))) {
                        if (['.srt', '.vtt', 'subtitle', 'caption'].some(token => value.includes(token) || key.toLowerCase().includes(token.replace('.', '')))) continue;
                        streams.push({
                            name: `Vidlink ${key} - ${extractQuality({ [key]: value })}`,
                            title,
                            url: value,
                            quality: extractQuality({ [key]: value })
                        });
                    } else if (value && typeof value === 'object' && !key.toLowerCase().includes('caption') && !key.toLowerCase().includes('subtitle')) {
                        findUrls(value);
                    }
                }
            };
            findUrls(data);
        }
    } catch (error) {
        console.error(`[Vidlink] Error processing response: ${error.message}`);
    }
    return streams;
}

class VidlinkScraper {
    async getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
        console.log(`[Vidlink] Fetching streams for TMDB:${tmdbId}, Type:${mediaType}`);
        try {
            const { title, year } = await getTmdbInfo(tmdbId, mediaType);
            const encryptedId = await encryptTmdbId(tmdbId);

            const streamTitle = mediaType === 'tv' && season && episode
                ? `${title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
                : year ? `${title} (${year})` : title;

            const vidlinkUrl = mediaType === 'tv' && season && episode
                ? `${VIDLINK_API}/tv/${encryptedId}/${season}/${episode}?multiLang=0`
                : `${VIDLINK_API}/movie/${encryptedId}?multiLang=0`;

            console.log(`[Vidlink] Requesting: ${vidlinkUrl}`);
            const response = await makeRequest(vidlinkUrl, { headers: VIDLINK_HEADERS });
            const data = await response.json();

            const rewrittenPlaylist = rewriteVidlinkPlaylist(data);
            if (rewrittenPlaylist) {
                console.log('[Vidlink] Returning WebKit DASH through Vidlink media relay');
                return [{
                    name: 'Vidlink - Auto',
                    title: streamTitle,
                    url: rewrittenPlaylist,
                    quality: 'Auto',
                    size: 'Stream',
                    type: 'dash',
                    provider: 'vidlink',
                    headers: VIDLINK_HEADERS
                }];
            }

            const rawStreams = processVidlinkResponse(data, streamTitle);
            if (rawStreams.length === 0) return [];

            const playlistStreams = rawStreams.filter(stream => stream._isPlaylist);
            const directStreams = rawStreams.filter(stream => !stream._isPlaylist);

            if (playlistStreams.length > 0) {
                const parsedArrays = await Promise.all(
                    playlistStreams.map(stream => fetchAndParseM3U8(stream.url, streamTitle))
                );
                const collapsed = playlistStreams.map((stream, index) =>
                    collapsePlaylistVariants(parsedArrays[index] || [], stream.url)
                );
                const seen = new Set();
                const all = [...directStreams, ...collapsed.flat()].filter(item => {
                    if (seen.has(item.url)) return false;
                    seen.add(item.url);
                    return true;
                });
                all.sort((a, b) => (QUALITY_ORDER[b.quality] || -3) - (QUALITY_ORDER[a.quality] || -3));
                console.log(`[Vidlink] Returning ${all.length} streams`);
                return all;
            }

            directStreams.sort((a, b) => (QUALITY_ORDER[b.quality] || -3) - (QUALITY_ORDER[a.quality] || -3));
            console.log(`[Vidlink] Returning ${directStreams.length} streams`);
            return directStreams;
        } catch (error) {
            console.error(`[Vidlink] getStreams error: ${error.message}`);
            return [];
        }
    }
}

async function getVidlinkStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const scraper = new VidlinkScraper();
    return scraper.getStreams(tmdbId, mediaType, seasonNum, episodeNum);
}

module.exports = {
    getVidlinkStreams,
    normalizeCaptions,
    rewriteVidlinkPlaylist,
    VidlinkScraper
};
