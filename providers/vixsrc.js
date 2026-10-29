
const axios = require('axios');

const BASE_URL = 'https://vixsrc.to';

const VIXSRC_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': BASE_URL,
    'Origin': BASE_URL
};

function createClient() {
    return {
        client: axios.create({
            timeout: 30000,
            maxRedirects: 5,
            validateStatus: status => status >= 200 && status < 400
        }),
        cookies: new Map()
    };
}

function logRequestError(label, error) {
    console.error(
        `[Vixsrc] ${label}:`,
        error.response
            ? `HTTP ${error.response.status}`
            : error.code || error.message
    );
}

function defaultCookiePath(pathname) {
    const lastSlash = pathname.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : pathname.slice(0, lastSlash);
}

function captureResponseCookies(response, requestUrl, cookies) {
    const responseUrl = response.request?.res?.responseUrl || requestUrl;
    const url = new URL(responseUrl);
    const setCookies = response.headers['set-cookie'] || [];

    for (const setCookie of Array.isArray(setCookies) ? setCookies : [setCookies]) {
        const [pair, ...attributes] = String(setCookie).split(';');
        const separator = pair.indexOf('=');
        if (separator <= 0) continue;

        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        const cookie = {
            name,
            value,
            domain: url.hostname.toLowerCase(),
            hostOnly: true,
            path: defaultCookiePath(url.pathname),
            secure: false,
            expires: Infinity
        };
        let validDomain = true;

        for (const attribute of attributes) {
            const [rawName, ...rawValue] = attribute.trim().split('=');
            const key = rawName.toLowerCase();
            const attributeValue = rawValue.join('=').trim();
            if (key === 'domain' && attributeValue) {
                const domain = attributeValue.replace(/^\./, '').toLowerCase();
                const baseHost = new URL(BASE_URL).hostname;
                const belongsToProvider = domain === baseHost || domain.endsWith(`.${baseHost}`);
                if (!belongsToProvider || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))) {
                    validDomain = false;
                    break;
                }
                cookie.domain = domain;
                cookie.hostOnly = false;
            } else if (key === 'path' && attributeValue.startsWith('/')) {
                cookie.path = attributeValue;
            } else if (key === 'secure') {
                cookie.secure = true;
            } else if (key === 'max-age' && /^-?\d+$/.test(attributeValue)) {
                cookie.expires = Date.now() + Number(attributeValue) * 1000;
            } else if (key === 'expires' && Number.isFinite(Date.parse(attributeValue)) && cookie.expires === Infinity) {
                cookie.expires = Date.parse(attributeValue);
            }
        }

        if (!validDomain || !name) continue;
        const key = `${name}\0${cookie.domain}\0${cookie.path}`;
        if (cookie.expires <= Date.now()) cookies.delete(key);
        else cookies.set(key, cookie);
    }
}

function getCookieHeader(requestUrl, cookies) {
    const url = new URL(requestUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname || '/';
    const applicable = [];

    for (const [key, cookie] of cookies) {
        const domainMatches = cookie.hostOnly
            ? hostname === cookie.domain
            : hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
        const pathMatches = pathname === cookie.path ||
            pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`);
        if (cookie.expires <= Date.now()) {
            cookies.delete(key);
            continue;
        }
        if (domainMatches && pathMatches && (!cookie.secure || url.protocol === 'https:')) {
            applicable.push(`${cookie.name}=${cookie.value}`);
        }
    }

    return applicable.join('; ');
}

function logCookies(label, url, cookies) {
    const header = getCookieHeader(url, cookies);
    console.log(`[Vixsrc] ${label}:`, header ? header.split('; ').map(cookie => cookie.split('=', 1)[0]) : '(no applicable cookies)');
}

function logSetCookieNames(label, response) {
    const setCookies = response.headers['set-cookie'] || [];
    const names = (Array.isArray(setCookies) ? setCookies : [setCookies])
        .map(cookie => String(cookie).split(';', 1)[0].split('=', 1)[0].trim())
        .filter(Boolean);
    console.log(`[Vixsrc] ${label}:`, names.length ? names : '(none)');
}

// Step 1: Request the API.
async function fetchApi(url, client, cookies) {
    try {
        const response = await client.get(url, {
            headers: VIXSRC_HEADERS
        });
        captureResponseCookies(response, url, cookies);

        console.log('[Vixsrc] API status:', response.status);
        logSetCookieNames('API Set-Cookie names', response);

        logCookies('Cookies available for API', url, cookies);

        if (response.status !== 200 || !response.data) {
            return null;
        }

        return response.data;
    } catch (error) {
        logRequestError('API request failed', error);
        return null;
    }
}

// Step 2: Request the embed page.
// Attach cookies collected from prior responses when they match this URL.
async function fetchEmbedPage(suburl, client, cookies) {
    let url;

    try {
        url = new URL(suburl, BASE_URL).href;

        // Prevent an unexpected API response from directing requests
        // to an unrelated host.
        if (new URL(url).origin !== new URL(BASE_URL).origin) {
            console.error('[Vixsrc] Rejected unexpected embed origin');
            return null;
        }

        const cookie = getCookieHeader(url, cookies);
        logCookies('Cookies available for embed', url, cookies);

        const response = await client.get(url, {
            headers: {
                ...VIXSRC_HEADERS,
                Accept: 'text/html,application/xhtml+xml,*/*',
                ...(cookie ? { Cookie: cookie } : {})
            },
            responseType: 'text'
        });
        captureResponseCookies(response, url, cookies);

        console.log('[Vixsrc] Embed status:', response.status);
        logSetCookieNames('Embed Set-Cookie names', response);

        return response.status === 200 ? response.data : null;
    } catch (error) {
        logRequestError('Embed request failed', error);
        return null;
    }
}

// Step 3: Extract token, expiry and playlist URL.
function extractTokenData(html) {
    if (typeof html !== 'string') return null;

    const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1];
    const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1];
    const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1];

    if (!token || !expires || !playlist) {
        return null;
    }

    const expirySeconds = Number(expires);

    if (!Number.isFinite(expirySeconds)) {
        console.error('[Vixsrc] Invalid token expiry');
        return null;
    }

    if (expirySeconds * 1000 - 60000 < Date.now()) {
        console.error('[Vixsrc] Token is expired or about to expire');
        return null;
    }

    let playlistUrl;

    try {
        playlistUrl = new URL(playlist, BASE_URL);

        // Only allow HTTPS playlist URLs.
        if (playlistUrl.protocol !== 'https:') {
            console.error('[Vixsrc] Rejected non-HTTPS playlist URL');
            return null;
        }
    } catch {
        console.error('[Vixsrc] Invalid playlist URL');
        return null;
    }

    return {
        token,
        expires: String(expires),
        playlist: playlistUrl.href
    };
}

// Step 4: Build the master playlist URL.
function buildMasterUrl(tokenData) {
    const url = new URL(tokenData.playlist);

    url.searchParams.set('token', tokenData.token);
    url.searchParams.set('expires', tokenData.expires);
    url.searchParams.set('h', '1');

    return url.href;
}

// Step 5: Fetch the HLS master playlist.
// Send only cookies scoped to the playlist URL's host and path.
async function fetchPlaylist(masterUrl, pageApiUrl, client, cookies) {
    try {
        const playlistUrl = new URL(masterUrl);

        if (playlistUrl.protocol !== 'https:') {
            console.error('[Vixsrc] Rejected non-HTTPS playlist request');
            return null;
        }

        const cookie = getCookieHeader(masterUrl, cookies);
        logCookies('Cookies available for playlist', masterUrl, cookies);

        const response = await client.get(masterUrl, {
            headers: {
                ...VIXSRC_HEADERS,
                Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*',
                Referer: pageApiUrl,
                ...(cookie ? { Cookie: cookie } : {})
            },
            responseType: 'text'
        });
        captureResponseCookies(response, masterUrl, cookies);

        console.log('[Vixsrc] Playlist status:', response.status);
        logSetCookieNames('Playlist Set-Cookie names', response);

        return response.status === 200 ? response.data : null;
    } catch (error) {
        logRequestError('Playlist request failed', error);
        return null;
    }
}

// Step 6: Parse HLS quality variants, audio tracks and subtitles.
function parsePlaylist(content, masterUrl, pageApiUrl, cookieHeader) {
    const sources = [];
    const subtitles = [];
    const audioTracks = [];

    if (typeof content !== 'string') {
        return { sources, subtitles, audioTracks };
    }

    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        if (!line.startsWith('#EXT-X-MEDIA:')) continue;

        const type = line.match(/TYPE=([^,]+)/)?.[1];

        if (type === 'AUDIO') {
            audioTracks.push({
                language: line.match(/LANGUAGE="([^"]+)"/)?.[1] || 'unknown',
                label: line.match(/NAME="([^"]+)"/)?.[1] || 'Audio'
            });
        }

        if (type === 'SUBTITLES') {
            const uri = line.match(/URI="([^"]+)"/)?.[1];

            if (!uri) continue;

            try {
                subtitles.push({
                    url: new URL(uri, masterUrl).href,
                    label: line.match(/NAME="([^"]+)"/)?.[1] || 'unknown',
                    lang: line.match(/LANGUAGE="([^"]+)"/)?.[1]
                });
            } catch {
                console.warn('[Vixsrc] Ignored invalid subtitle URL');
            }
        }
    }

    let bestResolution = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

        const height = Number(
            line.match(/RESOLUTION=\d+x(\d+)/)?.[1] || 0
        );

        if (height > bestResolution) {
            bestResolution = height;
        }
    }

    if (bestResolution === 0) {
        // A media playlist may contain segments directly rather than
        // a master playlist with quality variants.
        return { sources, subtitles, audioTracks };
    }

    sources.push({
        name: `Vixsrc - ${bestResolution}p`,
        title: `Vixsrc - ${bestResolution}p`,
        url: masterUrl,
        quality: `${bestResolution}p`,
        provider: 'Vixsrc',
        headers: {
            Referer: pageApiUrl,
            'User-Agent': VIXSRC_HEADERS['User-Agent'],
            ...(cookieHeader ? { Cookie: cookieHeader } : {})
        }
    });

    return { sources, subtitles, audioTracks };
}

// Main exported function.
async function getVixsrcStreams(
    tmdbId,
    mediaType = 'movie',
    seasonNum = null,
    episodeNum = null
) {
    console.log(
        `[Vixsrc] Fetching TMDB ID: ${tmdbId}, Type: ${mediaType}`
    );

    if (tmdbId === undefined || tmdbId === null || String(tmdbId).trim() === '') {
        console.error('[Vixsrc] Missing TMDB ID');
        return [];
    }

    let apiUrl;

    if (mediaType === 'movie') {
        apiUrl = `${BASE_URL}/api/movie/${encodeURIComponent(tmdbId)}`;
    } else if (
        mediaType === 'tv' &&
        seasonNum !== null &&
        episodeNum !== null
    ) {
        apiUrl =
            `${BASE_URL}/api/tv/${encodeURIComponent(tmdbId)}/` +
            `${encodeURIComponent(seasonNum)}/${encodeURIComponent(episodeNum)}`;
    } else {
        console.error('[Vixsrc] Invalid media type or episode details');
        return [];
    }

    const { client, cookies } = createClient();

    console.log('[Vixsrc] Step 1: Fetch API');

    const apiData = await fetchApi(apiUrl, client, cookies);

    if (!apiData || !apiData.src) {
        console.error('[Vixsrc] API returned no src');
        return [];
    }

    console.log('[Vixsrc] Step 2: Fetch embed');

    const html = await fetchEmbedPage(
        apiData.src,
        client,
        cookies
    );

    if (!html) {
        console.error('[Vixsrc] Failed to fetch embed page');
        return [];
    }

    console.log('[Vixsrc] Embed HTML length:', html.length);

    const tokenData = extractTokenData(html);

    if (!tokenData) {
        console.error('[Vixsrc] Failed to extract valid token data');
        return [];
    }

    const masterUrl = buildMasterUrl(tokenData);

    console.log('[Vixsrc] Step 3: Fetch playlist');

    const playlistContent = await fetchPlaylist(
        masterUrl,
        apiUrl,
        client,
        cookies
    );

    if (!playlistContent) {
        console.error('[Vixsrc] Failed to fetch playlist');
        return [];
    }

    const streamCookies = getCookieHeader(masterUrl, cookies);
    const { sources, subtitles } = parsePlaylist(
        playlistContent,
        masterUrl,
        apiUrl,
        streamCookies
    );

    if (sources.length === 0) {
        console.error(
            '[Vixsrc] No quality variants found; playlist may be a media playlist'
        );
        return [];
    }

    console.log(
        `[Vixsrc] Extracted ${sources.length} source(s), ` +
        `${subtitles.length} subtitle(s)`
    );

    return sources.map(source => ({
        ...source,
        subtitles
    }));
}

module.exports = { getVixsrcStreams };
