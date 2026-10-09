const axios = require('axios');

const VIDLINK_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Referer': 'https://vidlink.pro',
    'X-Playback-Environment': 'standard',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
};

function normalizeCaptions(captions) {
    const seen = new Set();
    return (Array.isArray(captions) ? captions : []).flatMap(caption => {
        if (!caption || !isHttpUrl(caption.url) || seen.has(caption.url)) return [];
        seen.add(caption.url);
        const language = caption.language || caption.label || 'und';
        const format = String(caption.type || caption.format || '').toLowerCase();
        return [{ url: caption.url, language, label: language, name: language,
            mimeType: format === 'srt' || /\.srt(?:[?#]|$)/i.test(caption.url)
                ? 'application/x-subrip' : 'text/vtt',
            headers: normalizeHeaders(caption.headers) }];
    });
}

const DEFAULT_STREAM_TTL_SECONDS = 3600;

function qualityToNumber(quality) {
    if (quality === '4k') return 2160;
    if (quality === 'Auto' || quality === 'unknown') return 0;
    const parsed = parseInt(quality, 10);
    return isNaN(parsed) ? 0 : parsed;
}

function qualityLabel(quality) {
    if (quality === '4k') return '4K';
    if (quality === 'Auto' || quality === 'unknown') return 'Auto';
    return `${quality}p`;
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

function getSignedTimestamp(url) {
    try {
        const value = Number(new URL(url).searchParams.get('t'));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch (_error) {
        return null;
    }
}

async function isStreamReachable(url) {
    try {
        const response = await axios.head(url, {
            // Vidlink's CDN rejects its API Referer/User-Agent even though the
            // same signed URL is playable without those request headers.
            headers: {},
            timeout: 6000,
            maxRedirects: 3,
            validateStatus: status => status >= 200 && status < 400
        });
        return response.status >= 200 && response.status < 400;
    } catch (_error) {
        return false;
    }
}

async function getVidlinkStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidlink] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        // Step 1: Encrypt the TMDB ID via enc-dec.app
        const encRes = await axios.get(
            `https://enc-dec.app/api/enc-vidlink?text=${encodeURIComponent(String(tmdbId))}`,
            { timeout: 8000 }
        );
        const encodedTmdb = encRes.data && encRes.data.result;
        if (!encodedTmdb) {
            console.log('[Vidlink] Encryption step returned no result.');
            return [];
        }

        // Step 2: Fetch file-quality streams from Vidlink API
        const apiUrl = (mediaType === 'tv' || mediaType === 'series')
            ? `https://vidlink.pro/api/b/tv/${encodedTmdb}/${seasonNum}/${episodeNum}?multiLang=0`
            : `https://vidlink.pro/api/b/movie/${encodedTmdb}?multiLang=0`;

        const apiRes = await axios.get(apiUrl, {
            headers: VIDLINK_HEADERS,
            params: { _: Date.now() },
            timeout: 8000
        });

        const streamData = apiRes.data && apiRes.data.stream;
        if (!streamData || (!streamData.qualities && !isHttpUrl(streamData.playlist))) {
            console.log('[Vidlink] No quality streams in response.');
            return [];
        }

        const ttlSeconds = Number(streamData.TTL) || DEFAULT_STREAM_TTL_SECONDS;
        const nowSeconds = Math.floor(Date.now() / 1000);
        const subtitles = normalizeCaptions(streamData.captions);
        const sources = { ...(streamData.qualities || {}) };
        if (isHttpUrl(streamData.playlist)) sources.Auto = { url: streamData.playlist, type: 'hls', headers: streamData.headers };
        const candidates = Object.entries(sources)
            .filter(([, entry]) => entry && isHttpUrl(entry.url))
            .sort((a, b) => qualityToNumber(b[0]) - qualityToNumber(a[0]))
            .map(([qualityKey, entry]) => ({
                name: 'Vidlink',
                title: `Vidlink - ${qualityLabel(qualityKey)}`,
                url: entry.url,
                quality: qualityLabel(qualityKey),
                provider: 'Vidlink',
                type: entry.type || 'mp4',
                format: entry.type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(entry.url) ? 'hls' : entry.type === 'dash' ? 'dash' : 'direct',
                mimeType: entry.type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(entry.url) ? 'application/vnd.apple.mpegurl' : entry.type === 'dash' ? 'application/dash+xml' : 'video/mp4',
                requiresProxy: entry.requiresProxy === true,
                subtitles: subtitles.map(sub => ({ ...sub, headers: { ...sub.headers } })),
                headers: normalizeHeaders(entry.headers),
                signedTimestamp: getSignedTimestamp(entry.url)
            }));

        const staleCandidates = candidates.filter(stream =>
            stream.signedTimestamp && nowSeconds - stream.signedTimestamp > ttlSeconds
        );
        const staleReachability = new Map();

        if (staleCandidates.length > 0) {
            const checks = await Promise.all(
                staleCandidates.map(async stream => [stream.url, await isStreamReachable(stream.url)])
            );
            checks.forEach(([url, reachable]) => staleReachability.set(url, reachable));
        }

        const streams = candidates
            .filter(stream => !stream.signedTimestamp ||
                nowSeconds - stream.signedTimestamp <= ttlSeconds ||
                staleReachability.get(stream.url) === true)
            .map(({ signedTimestamp: _signedTimestamp, ...stream }) => stream);

        if (streams.length === 0) {
            console.log('[Vidlink] No usable stream URLs in response.');
            return [];
        }

        console.log(
            `[Vidlink] Detected ${candidates.length} quality stream(s); ` +
            `${staleCandidates.length} exceeded the advertised TTL and ` +
            `${streams.length} stream(s) passed validation.`
        );
        return streams;
    } catch (err) {
        console.error(`[Vidlink] Error: ${err.message}`);
        return [];
    }
}

module.exports = { getVidlinkStreams, normalizeCaptions };
