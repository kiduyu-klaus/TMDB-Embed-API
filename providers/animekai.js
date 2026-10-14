const axios = require('axios').create({ timeout: 30000 });
const cheerio = require('cheerio');
const crypto = require('crypto');
const tmdb = require('../utils/tmdb');
const { applyAnimeStreamHeaders } = require('../utils/animeStreamHeaders');
const { seasonNumbers: parseSeasonNumbers, selectSeasonPart } = require('../utils/animeSeasonParts');

const ANIKAI_BASE = 'https://animekai.com.ro';
const MEGAPLAY_AES_KEY = 'i?LMTAx0Q6,:}50U';
const MEGAPLAY_AES_IV = "W0;27ToaUpl_P%'c";
const SUBTITLE_LANGUAGES = {
    english: 'en', arabic: 'ar', bengali: 'bn', filipino: 'fil', hindi: 'hi',
    french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', russian: 'ru',
    japanese: 'ja', korean: 'ko', chinese: 'zh', tamil: 'ta', telugu: 'te',
    italian: 'it', turkish: 'tr', ukrainian: 'uk', thai: 'th', vietnamese: 'vi',
    persian: 'fa', indonesian: 'id', dutch: 'nl', polish: 'pl', greek: 'el'
};
const SUBTITLE_MIME_TYPES = {
    vtt: 'text/vtt', srt: 'application/x-subrip', ass: 'text/x-ass', ssa: 'text/x-ssa'
};
const PLAYER_IFRAME_HOSTS = new Set([
    'gogoanime.me.uk',
    'gogoanime.me',
    'megaplay.buzz',
    'megaplay.su'
]);

const ANIKAI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    'Referer': ANIKAI_BASE + '/'
};

// Centralized log helper so every line is consistently tagged and timestamped.
function log(level, msg) {
    const ts = new Date().toISOString();
    const prefix = level === 'error'
        ? `[Anikai][ERROR] ${ts}`
        : level === 'warn'
            ? `[Anikai][WARN]  ${ts}`
            : `[Anikai][INFO]  ${ts}`;
    if (level === 'error') {
        console.error(`${prefix} ${msg}`);
    } else {
        console.log(`${prefix} ${msg}`);
    }
}

function logInfo(msg)  { log('info', msg); }
function logWarn(msg)  { log('warn', msg); }
function logError(msg) { log('error', msg); }

function sanitizeMediaUrl(value) {
    try {
        const url = new URL(value);
        const safePath = url.pathname
            .replace(/(\/uploads\/hls\/)[^/]+/i, '$1[REDACTED]')
            .replace(/(\/anime\/)[^/]+\/[^/]+/i, '$1[REDACTED]/[REDACTED]');
        return `${url.origin}${safePath}${url.search ? '?[query redacted]' : ''}`;
    } catch {
        return '(invalid URL)';
    }
}

// Helper: Resolve title from TMDB
async function getTitleFromTmdb(tmdbId, mediaType) {
    logInfo(`getTitleFromTmdb() called | tmdbId=${tmdbId} mediaType=${mediaType}`);
    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        logInfo(`getTitleFromTmdb() -> fetching TMDB /${type}/${tmdbId}`);
        const data = await tmdb.getDetails(type, tmdbId);
        const resolved = data.name || data.title || null;
        logInfo(`getTitleFromTmdb() <- resolved title="${resolved}" (original_name="${data.original_name || data.original_title || 'n/a'}")`);
        return resolved;
    } catch (e) {
        logError(`getTitleFromTmdb() failed for tmdbId=${tmdbId}: ${e.message}`);
        return null;
    }
}

function decryptMegaPlaySources(encodedPayload) {
    if (typeof encodedPayload !== 'string' || !encodedPayload) return null;

    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const key = Buffer.alloc(32);
    Buffer.from(MEGAPLAY_AES_KEY, 'utf8').copy(key, 0, 0, 32);
    const iv = Buffer.alloc(16);
    Buffer.from(MEGAPLAY_AES_IV, 'utf8').copy(iv, 0, 0, 16);

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(paddedBase64, 'base64')),
        decipher.final()
    ]).toString('utf8');
    return JSON.parse(plaintext);
}

function getPlayableSourceUrl(value, baseUrl) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value.trim(), baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        if (!/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(url.href)) return null;
        return url.href;
    } catch {
        return null;
    }
}

function normalizeMegaPlayTracks(tracks, playerUrl) {
    if (!Array.isArray(tracks)) return [];
    const subtitleHeaders = {
        Referer: `${new URL(playerUrl).origin}/`,
        'User-Agent': ANIKAI_HEADERS['User-Agent']
    };

    return tracks.map((track, index) => {
        if (!track || typeof track !== 'object') return null;
        const kind = String(track.kind || '').toLowerCase();
        if (kind && !/caption|subtitle/.test(kind)) return null;
        const rawUrl = track.file || track.url;
        if (typeof rawUrl !== 'string' || !rawUrl) return null;

        let subtitleUrl;
        let extension = '';
        try {
            const parsedUrl = new URL(rawUrl, playerUrl);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
            subtitleUrl = parsedUrl.href;
            extension = parsedUrl.pathname.split('.').pop().toLowerCase();
        } catch {
            return null;
        }

        const hint = String(track.language || track.lang || track.label || '').trim();
        const lowerHint = hint.toLowerCase();
        const languageMatch = lowerHint.match(/^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i);
        const namedLanguage = Object.entries(SUBTITLE_LANGUAGES)
            .find(([name]) => lowerHint === name || lowerHint.startsWith(`${name} `) || lowerHint.startsWith(`${name} (`));
        const language = languageMatch
            ? lowerHint.replace(/_/g, '-')
            : (namedLanguage ? namedLanguage[1] : 'und');

        return {
            id: `animekai-${index}-${language}`,
            url: subtitleUrl,
            lang: language,
            label: String(track.label || track.language || track.lang || language).trim(),
            mimeType: track.mimeType || SUBTITLE_MIME_TYPES[extension] || 'text/vtt',
            language,
            headers: { ...subtitleHeaders }
        };
    }).filter(Boolean);
}

function buildMegaPlayMetadata(sourceData, sourceUrl, playerUrl) {
    const result = { url: sourceUrl, referer: playerUrl };
    const subtitles = normalizeMegaPlayTracks(sourceData && sourceData.tracks, playerUrl);
    if (subtitles.length) result.subtitles = subtitles;
    if (sourceData && sourceData.intro != null) result.intro = sourceData.intro;
    if (sourceData && sourceData.outro != null) result.outro = sourceData.outro;
    return result;
}

// Resolve direct player URLs, GoGoAnime iframe wrappers, and MegaPlay source payloads.
async function resolveDirectM3u8(playerUrl, depth = 0) {
    if (depth > 3) {
        logWarn('resolveDirectM3u8() stopped following player iframes after maximum depth');
        return null;
    }
    logInfo(`resolveDirectM3u8() called | playerUrl=${sanitizeMediaUrl(playerUrl)}`);
    try {
        const parsedUrl = new URL(playerUrl);
        const host = parsedUrl.host;
        logInfo(`resolveDirectM3u8() parsed host=${host}`);

        logInfo(`resolveDirectM3u8() -> GET ${sanitizeMediaUrl(playerUrl)}`);
        const t0 = Date.now();
        const { data: html, status: status1 } = await axios.get(playerUrl, {
            headers: {
                'User-Agent': ANIKAI_HEADERS['User-Agent'],
                'Referer': parsedUrl.origin + '/'
            },
            timeout: 30000
        });
        logInfo(`resolveDirectM3u8() <- GET ${sanitizeMediaUrl(playerUrl)} | status=${status1} bytes=${html.length} took=${Date.now() - t0}ms`);

        // MegaPlay currently places the actual HLS URL directly in JWPlayer's
        // setup({ file: "..." }). It has no numeric title file-ID or data-id.
        const jwFileMatch = html.match(/\bfile\s*:\s*["']([^"']+)["']/i);
        if (jwFileMatch) {
            const sourceCandidate = jwFileMatch[1]
                .replace(/\\\//g, '/')
                .replace(/\\u0026/gi, '&');
            const directSourceUrl = new URL(sourceCandidate, playerUrl).href;
            if (/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(directSourceUrl)) {
                logInfo(`resolveDirectM3u8() found JWPlayer direct source | ${sanitizeMediaUrl(directSourceUrl)}`);
                return { url: directSourceUrl, referer: playerUrl };
            }
            logWarn(`resolveDirectM3u8() JWPlayer file field was not a supported media URL | ${sanitizeMediaUrl(directSourceUrl)}`);
        } else {
            logInfo('resolveDirectM3u8() no JWPlayer file field found; trying legacy file-ID extraction');
        }

        const iframeSrc = cheerio.load(html)('iframe[src]').first().attr('src');
        if (iframeSrc) {
            const iframeUrl = new URL(iframeSrc, playerUrl);
            const iframeHost = iframeUrl.hostname.toLowerCase();
            if (['http:', 'https:'].includes(iframeUrl.protocol) && PLAYER_IFRAME_HOSTS.has(iframeHost)) {
                logInfo(`resolveDirectM3u8() following trusted player iframe | ${sanitizeMediaUrl(iframeUrl.href)}`);
                return resolveDirectM3u8(iframeUrl.href, depth + 1);
            }
        }

        let fileId = null;
        let fileIdSource = null;
        const titleMatch = html.match(/<title>File ([0-9]+)/i);
        if (titleMatch) {
            fileId = titleMatch[1];
            fileIdSource = '<title>File …';
        } else {
            const dataIdMatch = html.match(/data-id=["']([0-9]+)["']/i);
            if (dataIdMatch) {
                fileId = dataIdMatch[1];
                fileIdSource = 'data-id attr';
            }
        }
        logInfo(`resolveDirectM3u8() extracted fileId=${fileId} source=${fileIdSource || 'NONE'}`);

        if (!fileId) {
            logWarn(`resolveDirectM3u8() aborting: no fileId found in player HTML`);
            return null;
        }

        const getSourcesUrl = `https://${host}/stream/getSources?id=${fileId}`;
        logInfo(`resolveDirectM3u8() -> GET ${getSourcesUrl}`);
        const t1 = Date.now();
        const { data: sourcesJson, status: status2 } = await axios.get(getSourcesUrl, {
            headers: {
                'User-Agent': ANIKAI_HEADERS['User-Agent'],
                'Referer': playerUrl,
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 30000
        });
        logInfo(`resolveDirectM3u8() <- GET getSources | status=${status2} took=${Date.now() - t1}ms`);
        logInfo(`resolveDirectM3u8() sourcesJson keys=${sourcesJson ? Object.keys(sourcesJson).join(',') : 'null'}`);

        if (sourcesJson && sourcesJson.sources && sourcesJson.sources.file) {
            const sourceUrl = getPlayableSourceUrl(sourcesJson.sources.file, playerUrl);
            if (sourceUrl) {
                logInfo(`resolveDirectM3u8() SUCCESS | source=${sanitizeMediaUrl(sourceUrl)}`);
                return buildMegaPlayMetadata(sourcesJson, sourceUrl, playerUrl);
            }
        }

        if (sourcesJson && sourcesJson.enc) {
            try {
                const decrypted = decryptMegaPlaySources(sourcesJson.enc);
                const sourceUrl = getPlayableSourceUrl(decrypted && decrypted.file, playerUrl);
                if (sourceUrl) {
                    logInfo(`resolveDirectM3u8() decrypted MegaPlay source | ${sanitizeMediaUrl(sourceUrl)}`);
                    return buildMegaPlayMetadata({ ...sourcesJson, ...decrypted }, sourceUrl, playerUrl);
                }
                logWarn(`resolveDirectM3u8() decrypted MegaPlay payload had no supported media file`);
            } catch (error) {
                logWarn(`resolveDirectM3u8() could not decrypt MegaPlay enc payload: ${error.message}`);
            }
        } else {
            logWarn(`resolveDirectM3u8() response had neither .sources.file nor an enc payload`);
        }
        return null;
    } catch (e) {
        logError(`resolveDirectM3u8() failed for ${sanitizeMediaUrl(playerUrl)}: ${e.message}`);
        return null;
    }
}

// Helper: Normalize string for comparison
function normalize(str) {
    if (!str) return '';
    const out = str.toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // Verbose: print before/after for short strings to keep output readable
    if (str && str.length <= 80) {
        logInfo(`normalize() in="${str}" out="${out}"`);
    }
    return out;
}

// AnimeKai result cards use <div class="aitem"> with a nested <a class="title">.
// Parse attributes independent of their order instead of assuming legacy markup.
function parseAnimeKaiSearchResults(html) {
    const $ = cheerio.load(html || '');
    const results = [];

    $('.aitem').each((_, card) => {
        const anchor = $(card).find('a.title').first();
        const href = anchor.attr('href');
        const title = anchor.attr('data-en') || anchor.attr('title') || anchor.text().trim();
        if (!href || !title) return;

        try {
            results.push({
                href: new URL(href, ANIKAI_BASE).href,
                title: title.trim(),
                type: $(card).find('.info b').first().text().trim().toLowerCase()
            });
        } catch (error) {
            logWarn(`parseAnimeKaiSearchResults() skipped invalid href: ${error.message}`);
        }
    });

    return results;
}

function buildAnimeSearchQuery(title, seasonNum) {
    return seasonNum > 1 ? `${title} season ${seasonNum}` : title;
}

function matchAnimeSearchResults(results, title, seasonNum = 1, seasonName = null, mediaType = 'tv') {
    const normalizedTitle = normalize(title);
    const normalizedSeasonName = seasonName ? normalize(seasonName) : '';

    return results.filter((result) => {
        const normalizedResult = normalize(result.title);
        if (mediaType === 'movie') {
            const movieTitle = normalizedResult.replace(/\b(?:dub|dubbed|sub|subbed)\b/g, '').replace(/\s+/g, ' ').trim();
            return (!result.type || result.type === 'movie') && movieTitle === normalizedTitle;
        }
        if (!normalizedResult.includes(normalizedTitle)) return false;
        if (result.type && result.type !== 'tv') return false;

        const seasonNumbers = parseSeasonNumbers(normalizedResult);
        if (seasonNumbers.some((number) => number !== Number(seasonNum || 1))) return false;

        if (Number(seasonNum || 1) > 1) {
            const hasRequestedSeason = seasonNumbers.includes(Number(seasonNum)) ||
                (normalizedSeasonName && normalizedResult.includes(normalizedSeasonName));
            if (!hasRequestedSeason) return false;
        }

        return true;
    });
}

function findEpisodeUrl(html, episodeNum, baseUrl) {
    const $ = cheerio.load(html || '');
    const targetEpisode = String(episodeNum || 1);
    const episodeNumber = $('.epl-num').filter((_, element) => $(element).text().trim() === targetEpisode).first();
    const linkedHref = episodeNumber.closest('a').attr('href');
    if (linkedHref) return new URL(linkedHref, baseUrl).href;

    const escapedEpisode = targetEpisode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fallback = html.match(new RegExp(`href=["']([^"']*episode-${escapedEpisode}(?!\\d)[^"']*)["']`, 'i'));
    return fallback ? new URL(fallback[1], baseUrl).href : null;
}

function extractAnimeKaiServerOptions(html) {
    const $ = cheerio.load(html || '');
    const servers = [];
    const parseEmbed = (encoded, name, language = '') => {
        try {
            const decoded = Buffer.from(encoded, 'base64').toString('utf8');
            const $embed = cheerio.load(decoded);
            const iframeUrl = $embed('iframe').first().attr('src');
            if (iframeUrl) servers.push({ name: name.trim() || 'Server', language: language.trim(), url: iframeUrl });
            else logWarn(`extractAnimeKaiServerOptions() decoded server "${name.trim()}" without an iframe src`);
        } catch (error) {
            logWarn(`extractAnimeKaiServerOptions() could not decode server "${name.trim()}": ${error.message}`);
        }
    };

    $('.ak-srv-links .ak-srv-btn[data-value]').each((_, button) => {
        const element = $(button);
        parseEmbed(element.attr('data-value'), element.text(), element.attr('data-lang') || '');
    });

    // Keep support for older AnimeKai episode pages that expose mirrors as <option>s.
    if (servers.length === 0) {
        $('option[value]').each((_, option) => {
            const element = $(option);
            const value = element.attr('value') || '';
            if (/^[A-Za-z0-9+/=]{20,}$/.test(value)) parseEmbed(value, element.text());
        });
    }

    return servers;
}

// Resolve the season name and episode count together from cached TMDB metadata.
async function getSeasonMetadataFromTmdb(tmdbId, seasonNum) {
    logInfo(`getSeasonMetadataFromTmdb() called | tmdbId=${tmdbId} seasonNum=${seasonNum}`);
    try {
        const data = await tmdb.getSeasonDetails(tmdbId, seasonNum);
        if (!data) {
            logWarn(`getSeasonMetadataFromTmdb() returned no TMDB data for tmdbId=${tmdbId} season=${seasonNum}`);
            return null;
        }
        logInfo(`getSeasonMetadataFromTmdb() <- name="${data.name}" episode_count=${data.episodes ? data.episodes.length : 'n/a'}`);
        return data;
    } catch (e) {
        logError(`getSeasonMetadataFromTmdb() failed for tmdbId=${tmdbId} S${seasonNum}: ${e.message}`);
        return null;
    }
}

async function getAnimekaiStreams(tmdbId, mediaType = 'tv', seasonNum = null, episodeNum = null) {
    const requestedSeason = Number(seasonNum || 1);
    const requestedEpisode = Number(episodeNum || 1);
    logInfo(`getAnimekaiStreams() START | tmdbId=${tmdbId} mediaType=${mediaType} season=${requestedSeason} episode=${requestedEpisode}`);
    try {
        const tmdbMediaType = mediaType === 'anime'
            ? (seasonNum == null && episodeNum == null ? 'movie' : 'tv') : mediaType;
        const title = await getTitleFromTmdb(tmdbId, tmdbMediaType);
        if (!title) {
            logWarn('getAnimekaiStreams() aborting: TMDB returned no title');
            return [];
        }

        let seasonDetails = null;
        if (tmdbMediaType === 'tv') {
            seasonDetails = await getSeasonMetadataFromTmdb(tmdbId, requestedSeason);
        }

        const searchTitle = tmdbMediaType === 'movie' ? title : buildAnimeSearchQuery(title, requestedSeason);
        const searchUrl = `${ANIKAI_BASE}/?s=${encodeURIComponent(searchTitle)}`;
        logInfo(`getAnimekaiStreams() searching title="${searchTitle}"`);
        const searchStart = Date.now();
        const { data: searchHtml, status: searchStatus } = await axios.get(searchUrl, { headers: ANIKAI_HEADERS, timeout: 30000 });
        logInfo(`getAnimekaiStreams() search response status=${searchStatus} bytes=${searchHtml.length} took=${Date.now() - searchStart}ms`);

        const results = parseAnimeKaiSearchResults(searchHtml);
        const candidates = matchAnimeSearchResults(results, title, requestedSeason, seasonDetails?.name, tmdbMediaType);
        const selection = tmdbMediaType === 'movie' ? { results: candidates, episode: 1, part: null }
            : selectSeasonPart(candidates, requestedEpisode, seasonDetails?.episodes?.length);
        const matchingResults = selection.results;
        const sourceEpisode = selection.episode;
        logInfo(`S${requestedSeason}E${requestedEpisode} -> part=${selection.part || 'unsplit'} episode=${sourceEpisode}`);
        logInfo(`getAnimekaiStreams() found ${results.length} search cards; ${matchingResults.length} match the requested title/season`);
        matchingResults.forEach((item, index) => logInfo(`  [match ${index + 1}] "${item.title}" (${item.type || 'type unknown'})`));
        if (matchingResults.length === 0) {
            logWarn(`getAnimekaiStreams() no matching AnimeKai results for "${searchTitle}"`);
            return [];
        }

        // Fetch every matching SUB/DUB result concurrently, then resolve all its server buttons concurrently.
        const candidateSettlements = await Promise.allSettled(matchingResults.map(async (item) => {
            try {
                const seriesStart = Date.now();
                const { data: seriesHtml, status: seriesStatus } = await axios.get(item.href, { headers: ANIKAI_HEADERS, timeout: 30000 });
                logInfo(`AnimeKai result "${item.title}" page status=${seriesStatus} bytes=${seriesHtml.length} took=${Date.now() - seriesStart}ms`);

                let episodeUrl = item.href;
                if (tmdbMediaType === 'tv') {
                    episodeUrl = findEpisodeUrl(seriesHtml, sourceEpisode, item.href);
                    if (!episodeUrl) {
                        logWarn(`No episode ${sourceEpisode} link found for "${item.title}"`);
                        return [];
                    }
                }

                const episodeStart = Date.now();
                const { data: episodeHtml, status: episodeStatus } = await axios.get(episodeUrl, { headers: ANIKAI_HEADERS, timeout: 30000 });
                logInfo(`AnimeKai episode page for "${item.title}" status=${episodeStatus} bytes=${episodeHtml.length} took=${Date.now() - episodeStart}ms`);

                const servers = extractAnimeKaiServerOptions(episodeHtml);
                logInfo(`AnimeKai result "${item.title}" has ${servers.length} decoded server button(s)`);
                const serverSettlements = await Promise.allSettled(servers.map(async (server) => {
                    const resolved = await resolveDirectM3u8(server.url);
                    if (!resolved) return null;
                    const origin = new URL(resolved.referer).origin;
                    const language = server.language ? ` - ${server.language}` : '';
                    const stream = {
                        name: `AnimeKai - ${item.title} - ${server.name}${language}`,
                        title: `${item.title} - ${server.name}${language}`,
                        url: resolved.url,
                        quality: 'Auto',
                        type: 'hls',
                        provider: 'animekai',
                        headers: { Referer: `${origin}/`, Origin: origin }
                    };
                    if (resolved.subtitles && resolved.subtitles.length) stream.subtitles = resolved.subtitles;
                    if (resolved.intro != null) stream.intro = resolved.intro;
                    if (resolved.outro != null) stream.outro = resolved.outro;
                    return applyAnimeStreamHeaders(stream);
                }));

                return serverSettlements.flatMap((settlement) => {
                    if (settlement.status === 'rejected') {
                        logWarn(`Server resolution failed for "${item.title}": ${settlement.reason.message}`);
                        return [];
                    }
                    return settlement.value ? [settlement.value] : [];
                });
            } catch (error) {
                logError(`Failed processing AnimeKai result "${item.title}": ${error.message}`);
                return [];
            }
        }));

        const streams = candidateSettlements.flatMap((settlement) => {
            if (settlement.status === 'rejected') {
                logWarn(`AnimeKai result task failed: ${settlement.reason.message}`);
                return [];
            }
            return settlement.value;
        });
        logInfo(`getAnimekaiStreams() END | matchingResults=${matchingResults.length} streams=${streams.length}`);
        return streams;
    } catch (error) {
        logError(`getAnimekaiStreams() unhandled error: ${error.message}`);
        if (error.stack) logError(error.stack);
        return [];
    }
}
module.exports = { getAnimekaiStreams, parseAnimeKaiSearchResults, resolveDirectM3u8, decryptMegaPlaySources, normalizeMegaPlayTracks, buildAnimeSearchQuery, matchAnimeSearchResults, findEpisodeUrl, extractAnimeKaiServerOptions };
