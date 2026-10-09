const axios = require('axios');
const { getTmdbApiKey } = require('../utils/tmdbKey');
const { getDetails, getSeasonDetails } = require('../utils/tmdb');

const ANIKAI_BASE = 'https://anikai.watch';

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

// Helper: Resolve title from TMDB
async function getTitleFromTmdb(tmdbId, mediaType) {
    logInfo(`getTitleFromTmdb() called | tmdbId=${tmdbId} mediaType=${mediaType}`);
    try {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        logInfo(`getTitleFromTmdb() -> fetching TMDB /${type}/${tmdbId}`);
        const data = await getDetails(type, tmdbId);
        const resolved = data.name || data.title || null;
        logInfo(`getTitleFromTmdb() <- resolved title="${resolved}" (original_name="${data.original_name || data.original_title || 'n/a'}")`);
        return resolved;
    } catch (e) {
        logError(`getTitleFromTmdb() failed for tmdbId=${tmdbId}: ${e.message}`);
        return null;
    }
}

// Helper: Extract direct m3u8 link from megaplay/vidtube players
async function resolveDirectM3u8(playerUrl) {
    logInfo(`resolveDirectM3u8() called | playerUrl=${playerUrl}`);
    try {
        const parsedUrl = new URL(playerUrl);
        const host = parsedUrl.host;
        logInfo(`resolveDirectM3u8() parsed host=${host}`);

        logInfo(`resolveDirectM3u8() -> GET ${playerUrl}`);
        const t0 = Date.now();
        const { data: html, status: status1 } = await axios.get(playerUrl, {
            headers: {
                'User-Agent': ANIKAI_HEADERS['User-Agent'],
                'Referer': parsedUrl.origin + '/'
            },
            timeout: 8000
        });
        logInfo(`resolveDirectM3u8() <- GET ${playerUrl} | status=${status1} bytes=${html.length} took=${Date.now() - t0}ms`);

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
            timeout: 8000
        });
        logInfo(`resolveDirectM3u8() <- GET getSources | status=${status2} took=${Date.now() - t1}ms`);
        logInfo(`resolveDirectM3u8() sourcesJson keys=${sourcesJson ? Object.keys(sourcesJson).join(',') : 'null'}`);

        if (sourcesJson && sourcesJson.sources && sourcesJson.sources.file) {
            logInfo(`resolveDirectM3u8() SUCCESS | m3u8=${sourcesJson.sources.file}`);
            return {
                url: sourcesJson.sources.file,
                referer: playerUrl
            };
        }
        logWarn(`resolveDirectM3u8() no .sources.file in response`);
        return null;
    } catch (e) {
        logError(`resolveDirectM3u8() failed for ${playerUrl}: ${e.message}`);
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

// Helper: Resolve season name from TMDB
async function getSeasonNameFromTmdb(tmdbId, seasonNum) {
    logInfo(`getSeasonNameFromTmdb() called | tmdbId=${tmdbId} seasonNum=${seasonNum}`);
    try {
        const data = await getSeasonDetails(tmdbId, seasonNum);
        logInfo(`getSeasonNameFromTmdb() <- name="${data.name}" episode_count=${data.episodes ? data.episodes.length : 'n/a'}`);
        return data.name || null;
    } catch (e) {
        logError(`getSeasonNameFromTmdb() failed for tmdbId=${tmdbId} S${seasonNum}: ${e.message}`);
        return null;
    }
}

async function getAnimekaiStreams(tmdbId, mediaType = 'tv', seasonNum = null, episodeNum = null) {
    logInfo(`================================================================`);
    logInfo(`getAnimekaiStreams() START | tmdbId=${tmdbId} mediaType=${mediaType} seasonNum=${seasonNum} episodeNum=${episodeNum}`);
    logInfo(`getAnimekaiStreams() using TMDB_API_KEY=${getTmdbApiKey() ? getTmdbApiKey().slice(0, 6) + '…' : 'MISSING'}`);
    logInfo(`================================================================`);
    try {
        const title = await getTitleFromTmdb(tmdbId, mediaType);
        if (!title) {
            logWarn('getAnimekaiStreams() aborting: TMDB returned no title');
            return [];
        }
        logInfo(`getAnimekaiStreams() -> resolved title="${title}"`);

        // Search Animekai using WordPress search query
        const searchUrl = `${ANIKAI_BASE}/?s=${encodeURIComponent(title)}`;
        logInfo(`getAnimekaiStreams() -> GET search ${searchUrl}`);
        const searchStart = Date.now();
        const { data: searchHtml, status: searchStatus } = await axios.get(searchUrl, { headers: ANIKAI_HEADERS, timeout: 8000 });
        logInfo(`getAnimekaiStreams() <- GET search | status=${searchStatus} bytes=${searchHtml.length} took=${Date.now() - searchStart}ms`);

        // Find series or episode watch url matching title
        const searchRegex = /<article[^>]*>[\s\S]*?<a\s+href="([^"]+)"\s+itemprop="url"\s+title="([^"]+)"/gi;
        const results = [];
        let match;
        while ((match = searchRegex.exec(searchHtml)) !== null) {
            results.push({
                href: match[1],
                title: match[2].trim()
            });
        }
        logInfo(`getAnimekaiStreams() parsed ${results.length} candidate(s) from search results`);
        if (results.length > 0) {
            results.forEach((r, i) => logInfo(`  [search #${i + 1}] "${r.title}" -> ${r.href}`));
        }

        let bestMatchUrl = null;
        let bestScore = -1;
        let bestTitle = null;
        if (results.length > 0) {
            // Fetch season name from TMDB if TV series
            let seasonName = null;
            if (mediaType === 'tv' && seasonNum) {
                seasonName = await getSeasonNameFromTmdb(tmdbId, seasonNum);
                logInfo(`getAnimekaiStreams() resolved TMDB Season ${seasonNum} name="${seasonName}"`);
            }

            const targetTitle = title;
            const normTarget = normalize(targetTitle);
            const normSeasonName = seasonName ? normalize(seasonName) : '';
            logInfo(`getAnimekaiStreams() scoring | normTarget="${normTarget}" normSeasonName="${normSeasonName}"`);

            for (const item of results) {
                const normItem = normalize(item.title);
                let score = 0;
                const scoreBreakdown = [];

                // 1. Contains main title
                if (normItem.includes(normTarget)) {
                    score += 10;
                    scoreBreakdown.push('+10 contains main title');
                }

                // 2. Exact match on main title (highly relevant for Season 1/no-season anime)
                if (normItem === normTarget) {
                    score += 30;
                    scoreBreakdown.push('+30 exact title match');
                }

                // 3. Season matching
                if (mediaType === 'tv' && seasonNum) {
                    // Check TMDB season name
                    if (normSeasonName && normItem.includes(normSeasonName)) {
                        score += 100;
                        scoreBreakdown.push(`+100 season name match ("${normSeasonName}")`);
                    }

                    // Check season number indicators (e.g. "season 2", "2nd season", "s2")
                    const seasonIndicators = [
                        `season ${seasonNum}`,
                        `season${seasonNum}`,
                        `${seasonNum}nd season`,
                        `${seasonNum}rd season`,
                        `${seasonNum}th season`,
                        `${seasonNum}st season`
                    ];

                    if (seasonIndicators.some(ind => normItem.includes(ind))) {
                        score += 50;
                        scoreBreakdown.push(`+50 season number indicator`);
                    }

                    // S2 word boundaries check
                    const sRegex = new RegExp(`\\bs${seasonNum}\\b`, 'i');
                    if (sRegex.test(item.title)) {
                        score += 50;
                        scoreBreakdown.push(`+50 \\bs${seasonNum}\\b match`);
                    }

                    // Penalty for incorrect seasons
                    for (let s = 1; s <= 10; s++) {
                        if (s !== seasonNum) {
                            const otherIndicators = [
                                `season ${s}`,
                                `season${s}`,
                                `${s}nd season`,
                                `${s}rd season`,
                                `${s}th season`,
                                `${s}st season`
                            ];
                            if (otherIndicators.some(ind => normItem.includes(ind))) {
                                score -= 80;
                                scoreBreakdown.push(`-80 wrong season ${s} indicator`);
                            }
                            const otherSRegex = new RegExp(`\\bs${s}\\b`, 'i');
                            if (otherSRegex.test(item.title)) {
                                score -= 80;
                                scoreBreakdown.push(`-80 wrong \\bs${s}\\b`);
                            }
                        }
                    }
                }

                logInfo(`  [score] candidate="${item.title}" url=${item.href} total=${score} breakdown=[${scoreBreakdown.join(', ')}]`);

                if (score > bestScore) {
                    bestScore = score;
                    bestMatchUrl = item.href;
                    bestTitle = item.title;
                }
            }
            logInfo(`getAnimekaiStreams() best match: score=${bestScore} title="${bestTitle}" url=${bestMatchUrl}`);
        }

        if (!bestMatchUrl) {
            logWarn('getAnimekaiStreams() no scored match — attempting fallback first-article regex');
            // Fallback: use first article link found
            const fallbackMatch = searchHtml.match(/<article[^>]*>[\s\S]*?<a\s+href="([^"]+)"/i);
            if (fallbackMatch) {
                bestMatchUrl = fallbackMatch[1];
                logInfo(`getAnimekaiStreams() fallback matched: ${bestMatchUrl}`);
            } else {
                logWarn('getAnimekaiStreams() fallback regex also failed');
            }
        }

        if (!bestMatchUrl) {
            logWarn('getAnimekaiStreams() aborting: no search results found on site');
            return [];
        }

        logInfo(`getAnimekaiStreams() -> using series page: ${bestMatchUrl}`);

        // Fetch the series page to get the list of episodes
        logInfo(`getAnimekaiStreams() -> GET series page ${bestMatchUrl}`);
        const seriesStart = Date.now();
        const { data: seriesHtml, status: seriesStatus } = await axios.get(bestMatchUrl, { headers: ANIKAI_HEADERS, timeout: 8000 });
        logInfo(`getAnimekaiStreams() <- GET series page | status=${seriesStatus} bytes=${seriesHtml.length} took=${Date.now() - seriesStart}ms`);

        // For TV/Series, look for the matching episode number
        let episodeUrl = bestMatchUrl;
        let episodeSource = 'series page (no TV, using as-is)';
        if (mediaType === 'tv') {
            const targetEpNum = episodeNum || 1;
            logInfo(`getAnimekaiStreams() searching series page for episode ${targetEpNum}`);
            const epRegex = new RegExp(`<a\\s+href="([^"]+)"[^>]*>\\s*<div\\s+class="epl-num"[^>]*>\\s*${targetEpNum}\\s*<\\/div>`, 'i');
            const epMatch = seriesHtml.match(epRegex);
            if (epMatch) {
                episodeUrl = epMatch[1];
                episodeSource = 'epl-num regex';
            } else {
                logWarn(`getAnimekaiStreams() epl-num regex failed for ep ${targetEpNum}, trying general ep-N regex`);
                // Fallback: look for general ep number in links
                const generalEpRegex = new RegExp(`href="([^"]+episode-${targetEpNum}[^"]+)"`, 'i');
                const genMatch = seriesHtml.match(generalEpRegex);
                if (genMatch) {
                    episodeUrl = genMatch[1];
                    episodeSource = 'general ep-N regex';
                } else {
                    logError(`getAnimekaiStreams() Episode ${targetEpNum} not found on series page — aborting`);
                    return [];
                }
            }
        }
        logInfo(`getAnimekaiStreams() -> episode page: ${episodeUrl} (source: ${episodeSource})`);

        // Fetch episode page HTML
        logInfo(`getAnimekaiStreams() -> GET episode page ${episodeUrl}`);
        const epStart = Date.now();
        const { data: epHtml, status: epStatus } = await axios.get(episodeUrl, { headers: ANIKAI_HEADERS, timeout: 8000 });
        logInfo(`getAnimekaiStreams() <- GET episode page | status=${epStatus} bytes=${epHtml.length} took=${Date.now() - epStart}ms`);

        // Extract and decode base64 mirror options
        const optionRegex = /<option[^>]*value="([A-Za-z0-9+/=]{20,})"[^>]*>([^<]+)<\/option>/g;
        let optMatch;
        const streams = [];
        let optionCount = 0;
        let decodedCount = 0;
        let resolvedCount = 0;
        let skippedNoIframe = 0;

        while ((optMatch = optionRegex.exec(epHtml)) !== null) {
            optionCount += 1;
            const base64Val = optMatch[1];
            const serverName = optMatch[2].trim();
            logInfo(`[option #${optionCount}] server="${serverName}" base64.len=${base64Val.length}`);
            try {
                const decoded = Buffer.from(base64Val, 'base64').toString();
                decodedCount += 1;
                if (decodedCount <= 3) {
                    logInfo(`  [option #${optionCount}] decoded (first 120 chars): ${decoded.slice(0, 120)}`);
                }
                const srcMatch = decoded.match(/src="([^"]+)"/);
                const iframeUrl = srcMatch ? srcMatch[1] : null;

                if (iframeUrl) {
                    logInfo(`  [option #${optionCount}] iframeUrl=${iframeUrl}`);
                    const resolved = await resolveDirectM3u8(iframeUrl);
                    if (resolved) {
                        resolvedCount += 1;
                        streams.push({
                            name: `Anikai - ${serverName}`,
                            title: `Anikai - ${serverName}`,
                            url: resolved.url,
                            quality: 'Auto',
                            type: 'hls',
                            provider: 'anikai',
                            headers: {
                                'Referer': new URL(resolved.referer).origin + '/',
                                'Origin': new URL(resolved.referer).origin
                            }
                        });
                        logInfo(`  [option #${optionCount}] ADDED stream #${streams.length}`);
                    } else {
                        logWarn(`  [option #${optionCount}] resolveDirectM3u8 returned null — skipped`);
                    }
                } else {
                    skippedNoIframe += 1;
                    logWarn(`  [option #${optionCount}] no src= in decoded value — skipped`);
                }
            } catch (err) {
                logWarn(`  [option #${optionCount}] decode/parse error: ${err.message}`);
                // Skip individual server parse failures
            }
        }

        logInfo(`getAnimekaiStreams() option summary | total=${optionCount} decoded=${decodedCount} resolved=${resolvedCount} skippedNoIframe=${skippedNoIframe}`);
        logInfo(`getAnimekaiStreams() END | streams=${streams.length}`);
        return streams;

    } catch (err) {
        logError(`getAnimekaiStreams() unhandled error: ${err.message}`);
        if (err.stack) logError(err.stack);
        return [];
    }
}


module.exports = { getAnimekaiStreams };
