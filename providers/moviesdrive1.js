'use strict';

const cheerio = require('cheerio');
const { fetch } = require('../utils/providerFetch');
const { getDetails, resolveImdbId } = require('../utils/tmdb');

const PROVIDER = 'MoviesDrive';
const BASE_URL = 'https://new1.moviesdrive.beer';
const QUALITY_FILTER = new Set(['1080p', '2160p']);
const QUALITY_RANK_MAX = 2;
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

const MOVIESDRIVE_LOG_LEVEL = Number.parseInt(process.env.MOVIESDRIVE_LOG_LEVEL || '1', 10);

function describeUrl(value) {
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    } catch {
        return '[invalid-url]';
    }
}

function mdLog(level, event, details = {}) {
    const levels = { error: 0, warn: 1, info: 1, debug: 2 };
    if (MOVIESDRIVE_LOG_LEVEL < (levels[level] ?? 1)) return;
    const safeDetails = { ...details };
    for (const key of ['url', 'referer', 'postUrl', 'pageUrl', 'episodePageUrl']) {
        if (safeDetails[key]) safeDetails[key] = describeUrl(safeDetails[key]);
    }
    console.log(`[${PROVIDER}][${level.toUpperCase()}] ${event}`, safeDetails);
}

function resolveQuality(raw) {
    if (!raw) return null;
    const match = String(raw).match(/(\d{3,4})[pP]/);
    if (match) return `${match[1]}p`;
    const upper = String(raw).toUpperCase();
    if (upper.includes('4K') || upper.includes('2160') || upper.includes('UHD')) return '2160p';
    return null;
}

function toGB(sizeStr) {
    const match = String(sizeStr || '').match(/([\d.]+)\s*(GB|MB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    return match[2].toUpperCase() === 'GB' ? value : value / 1024;
}

function qualityRank(quality) {
    const q = String(quality || '').toUpperCase();
    if (q === '4K' || q === '2160P') return 2;
    if (q === '1080P') return 1;
    return 0;
}

function providerRank(name) {
    const value = String(name || '').toLowerCase();
    if (value.includes('fsl')) return 2;
    if (value.includes('pixeldrain')) return 1;
    return 0;
}

function getSortTag(rank) {
    const inverse = Math.max(0, QUALITY_RANK_MAX - rank);
    let binary = inverse.toString(2);
    while (binary.length < 20) binary = `0${binary}`;
    return binary.split('').map(bit => bit === '1' ? '\uFEFF' : '\u200B').join('');
}

function absoluteUrl(value, baseUrl = BASE_URL) {
    if (!value || typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim(), baseUrl);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function dedupe(streams) {
    const seen = new Set();
    return streams.filter(stream => stream.url && !seen.has(stream.url) && seen.add(stream.url));
}

function rankAndTrim(streams) {
    streams.sort((a, b) => {
        const byQuality = qualityRank(b.quality) - qualityRank(a.quality);
        if (byQuality !== 0) return byQuality;
        const byProvider = providerRank(b.name) - providerRank(a.name);
        if (byProvider !== 0) return byProvider;
        return toGB(b.size) - toGB(a.size);
    });

    const tally = {};
    return streams
        .filter(stream => {
            const bucket = `${stream.name}|${stream.quality}`;
            tally[bucket] = (tally[bucket] || 0) + 1;
            return tally[bucket] <= 3;
        })
        .map(stream => {
            const tag = getSortTag(qualityRank(stream.quality));
            return {
                name: tag + stream.name,
                title: tag + stream.name,
                url: stream.url,
                quality: stream.quality,
                size: stream.size,
                headers: stream.headers || {},
            };
        });
}

async function request(url, options = {}, responseType = 'text') {
    const started = Date.now();
    mdLog('debug', 'request.start', { url, responseType });
    try {
        const response = await fetch(url, {
            ...options,
            signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        mdLog('debug', 'request.response', { url, status: response.status, elapsedMs: Date.now() - started });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return responseType === 'json' ? response.json() : response.text();
    } catch (error) {
        mdLog('warn', 'request.failed', { url, elapsedMs: Date.now() - started, error: error.message });
        throw error;
    }
}

async function resolveHubCloudLinks(pageUrl, referer) {
    mdLog('info', 'hubcloud.resolve.start', { pageUrl, referer });
    try {
        let resolvedUrl = pageUrl;
        let html = await request(resolvedUrl, {
            headers: { ...DEFAULT_HEADERS, Referer: referer },
        });

        if (!resolvedUrl.includes('hubcloud.php')) {
            const $landing = cheerio.load(html);
            let target = $landing('a[href*="hubcloud.php"]').attr('href')
                || $landing('#download').attr('href')
                || html.match(/var url = ["']([^"']+)["']/)?.[1]
                || '';

            if (target) {
                target = absoluteUrl(target, resolvedUrl);
                if (target) {
                    resolvedUrl = target;
                    html = await request(resolvedUrl, {
                        headers: { ...DEFAULT_HEADERS, Referer: pageUrl },
                    });
                }
            }
        }

        const $ = cheerio.load(html);
        const size = $('i#size').text().trim();
        const quality = resolveQuality($('div.card-header').text().trim());
        if (!QUALITY_FILTER.has(quality) || toGB(size) < 1) {
            mdLog('debug', 'hubcloud.resolve.filtered', { pageUrl: resolvedUrl, quality, size });
            return [];
        }

        const pxlVar = html.match(/var\s+pxl\s*=\s*["']([^"']+)["']/);
        const blocked = ['tinyurl', 'telegram', 'hubcloud.cx/tg', 'hubcloud.foo/tg'];
        const playbackHeaders = { Referer: resolvedUrl };
        const results = [];

        $('a[href]').each((_, element) => {
            let href = absoluteUrl($(element).attr('href'), resolvedUrl);
            const text = $(element).text().toLowerCase().trim();
            if (!href || blocked.some(value => href.includes(value))) return;
            if (href.includes('negn6f') && pxlVar) href = absoluteUrl(pxlVar[1], resolvedUrl);
            if (!href) return;

            if (text.includes('fslv2') || text.includes('fsl v2')) {
                results.push({ name: `${PROVIDER} • FSLv2`, title: `${PROVIDER} • FSLv2`, quality, size, url: href, headers: playbackHeaders });
            } else if (text.includes('fsl server') || (text.includes('fsl') && !text.includes('v2'))) {
                results.push({ name: `${PROVIDER} • FSL`, title: `${PROVIDER} • FSL`, quality, size, url: href, headers: playbackHeaders });
            } else if (text.includes('pixeldra') || text.includes('pixelserver') || text.includes('pixeldrain') || href.includes('pixeldrain')) {
                let directUrl = href;
                if (directUrl.includes('/u/')) {
                    const fileId = directUrl.split('/u/')[1].split('?')[0].replace('/', '');
                    directUrl = `https://pixeldrain.dev/api/file/${fileId}?download`;
                }
                results.push({ name: `${PROVIDER} • Pixeldrain`, title: `${PROVIDER} • Pixeldrain`, quality, size, url: directUrl, headers: playbackHeaders });
            }
        });

        mdLog('info', 'hubcloud.resolve.done', { pageUrl: resolvedUrl, quality, size, streams: results.length });
        return results;
    } catch (error) {
        mdLog('warn', 'hubcloud.resolve.failed', { pageUrl, error: error.message });
        return [];
    }
}

async function extractFromMdrive(url) {
    if (!url) return [];
    mdLog('debug', 'link.extract.start', { url });
    const hostPattern = /hubcloud|gdflix|gdlink/i;
    if (hostPattern.test(url) && !url.includes('search-recover.php') && (url.includes('/drive/') || url.includes('/file/'))) {
        mdLog('debug', 'link.extract.final-drive', { url });
        return [url];
    }

    try {
        const html = await request(url, { headers: DEFAULT_HEADERS });
        if (url.includes('search-recover.php')) {
            const parsed = new URL(url);
            const qParam = html.match(/const\s+Q_INITIAL\s*=\s*["']([^"']+)["']/)?.[1] || parsed.searchParams.get('q') || '';
            const tokenParam = html.match(/const\s+FROM_AC_TOKEN\s*=\s*["']([^"']+)["']/)?.[1] || parsed.searchParams.get('from_ac') || '';
            if (qParam && tokenParam) {
                const apiBase = new URL(url).origin;
                const params = new URLSearchParams({ api: 'search', q: qParam, page: '1', from_ac: tokenParam });
                const payload = await request(`${apiBase}/drive/search-recover.php?${params}`, {
                    headers: { ...DEFAULT_HEADERS, Accept: 'application/json', Referer: url },
                }, 'json');
                if (payload && Array.isArray(payload.hits)) {
                    const links = payload.hits.map(hit => hit.url).filter(Boolean);
                    mdLog('debug', 'link.extract.recovery-results', { url, count: links.length });
                    return links;
                }
            }
        }

        const $ = cheerio.load(html);
        const links = $('a[href]').map((_, element) => $(element).attr('href')).get()
            .map(href => absoluteUrl(href, url))
            .filter(href => href && hostPattern.test(href));
        mdLog('debug', 'link.extract.done', { url, count: links.length });
        return links;
    } catch {
        mdLog('warn', 'link.extract.failed', { url });
        return [];
    }
}

async function resolveStreams(links, referer) {
    mdLog('debug', 'streams.resolve.start', { links: links.length, referer });
    const candidates = await Promise.all(links.map(link => extractFromMdrive(link)));
    const unique = [...new Set(candidates.flat().map(link => absoluteUrl(link)).filter(Boolean))];
    const settled = await Promise.all(unique.map(async url => {
        try {
            return new URL(url).hostname.includes('hubcloud')
                ? resolveHubCloudLinks(url, referer)
                : [];
        } catch {
            return [];
        }
    }));
    const streams = settled.flat();
    mdLog('info', 'streams.resolve.done', { links: links.length, uniqueLinks: unique.length, streams: streams.length });
    return streams;
}

async function findPost(imdbId, title, mediaType, season) {
    mdLog('info', 'search.start', { imdbId: imdbId || null, title, mediaType, season: season ?? null });
    const seasonSlug = season != null ? String(season).padStart(2, '0') : null;
    const seasonPatterns = mediaType === 'tv' && season != null ? [
        new RegExp(`\\bseason\\s*0?${season}\\b`, 'i'),
        new RegExp(`\\bs0?${season}\\b`, 'i'),
        new RegExp(`\\bseason\\s*${seasonSlug}\\b`, 'i'),
    ] : null;

    const matchesSeason = document => {
        if (!seasonPatterns) return true;
        const postTitle = String(document.post_title || '').toLowerCase();
        const permalink = String(document.permalink || '').toLowerCase();
        return seasonPatterns.some(pattern => pattern.test(postTitle) || pattern.test(permalink));
    };

    const titleMatches = document => {
        const postTitle = String(document.post_title || '').toLowerCase();
        const permalink = String(document.permalink || '').toLowerCase();
        const normalizedPost = postTitle.replace(/[^a-z0-9]/g, '');
        const normalizedQuery = String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalizedPost.includes(normalizedQuery)
            || postTitle.includes(String(title || '').toLowerCase())
            || permalink.includes(String(title || '').toLowerCase().replace(/ /g, '-'));
    };

    const search = async query => {
        mdLog('debug', 'search.request', { query: String(query).slice(0, 120) });
        const payload = await request(`${BASE_URL}/search.php?q=${encodeURIComponent(query)}&page=1`, {
            headers: { ...DEFAULT_HEADERS, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        }, 'json');
        const documents = (payload?.hits || []).map(hit => hit.document).filter(Boolean);
        mdLog('debug', 'search.response', { query: String(query).slice(0, 120), hits: documents.length });
        return documents;
    };

    if (imdbId) {
        try {
            const docs = await search(imdbId);
            const hit = mediaType === 'tv'
                ? docs.find(document => document.imdb_id === imdbId && matchesSeason(document))
                : docs.find(document => document.imdb_id === imdbId);
            if (hit) {
                mdLog('info', 'search.imdb-match', { postTitle: hit.post_title, permalink: hit.permalink });
                return hit;
            }
        } catch {
            // Fall back to title search below.
        }
    }

    try {
        const docs = await search(title);
        const match = mediaType === 'tv' && season != null
            ? docs.find(document => titleMatches(document) && matchesSeason(document))
            : docs.find(titleMatches) || docs[0];
        mdLog(match ? 'info' : 'warn', match ? 'search.title-match' : 'search.no-match', {
            postTitle: match?.post_title || null,
            permalink: match?.permalink || null,
        });
        return match || null;
    } catch {
        mdLog('warn', 'search.title-failed', { title });
        return null;
    }
}

async function getMoviesDriveStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const started = Date.now();
    mdLog('info', 'provider.start', { tmdbId, mediaType, season, episode });
    try {
        if (mediaType === 'tv' && (season == null || episode == null)) {
            mdLog('warn', 'provider.invalid-tv-request', { tmdbId, season, episode });
            return [];
        }

        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const tmdb = await getDetails(type, tmdbId);
        if (!tmdb) {
            mdLog('warn', 'tmdb.no-details', { tmdbId, type });
            return [];
        }

        const imdbId = await resolveImdbId(type, tmdbId);
        const title = tmdb.title || tmdb.name || '';
        if (!title) {
            mdLog('warn', 'tmdb.no-title', { tmdbId, type });
            return [];
        }
        mdLog('info', 'tmdb.resolved', { tmdbId, type, title, imdbId: imdbId || null });

        const post = await findPost(imdbId, title, type, season);
        if (!post || !post.permalink) {
            mdLog('warn', 'provider.no-post', { tmdbId, title, type, season });
            return [];
        }

        const postUrl = absoluteUrl(post.permalink, BASE_URL);
        if (!postUrl) {
            mdLog('warn', 'provider.invalid-post-url', { permalink: post.permalink });
            return [];
        }
        mdLog('info', 'provider.post-selected', { postUrl, title, type, season, episode });
        const pageHtml = await request(postUrl, { headers: DEFAULT_HEADERS });
        const $ = cheerio.load(pageHtml);

        if (type === 'movie') {
            const links = [...new Set($('h5 a').map((_, element) => absoluteUrl($(element).attr('href'), postUrl)).get().filter(Boolean))];
            const streams = rankAndTrim(dedupe(await resolveStreams(links, postUrl)));
            mdLog('info', 'provider.done', { tmdbId, type, links: links.length, streams: streams.length, elapsedMs: Date.now() - started });
            return streams;
        }

        const seasonPadded = String(season).padStart(2, '0');
        const seasonRegex = new RegExp(`Season ${season}|S${seasonPadded}`, 'i');
        const episodeRegex = new RegExp(`\\b(?:ep|episode|e)\\s*0?${episode}\\b|s0?${season}\\s*e0?${episode}\\b`, 'i');
        const sectionRegex = /^\s*(EP\d+|Episode\s*\d+|S\d+E\d+)/i;
        const collected = [];

        const seasonBlocks = $('h4, h5').filter((_, element) => seasonRegex.test($(element).text())).get();
        for (const block of seasonBlocks) {
            const episodePageUrl = absoluteUrl($(block).next().find('a').attr('href') || $(block).find('a').attr('href'), postUrl);
            if (!episodePageUrl) continue;

            try {
                const episodeHtml = await request(episodePageUrl, { headers: DEFAULT_HEADERS });
                const $episode = cheerio.load(episodeHtml);
                const episodeRows = $episode('h5').filter((_, element) => episodeRegex.test($episode(element).text())).get();

                for (const row of episodeRows) {
                    const episodeLinks = [];
                    let sibling = $episode(row).next();
                    while (sibling.length && !sectionRegex.test(sibling.text().trim())) {
                        sibling.find('a[href]').each((_, element) => {
                            const href = absoluteUrl($episode(element).attr('href'), episodePageUrl);
                            if (href) episodeLinks.push(href);
                        });
                        sibling = sibling.next();
                    }
                    if (episodeLinks.length === 0) {
                        const first = absoluteUrl($episode(row).next().find('a').attr('href'), episodePageUrl);
                        const second = absoluteUrl($episode(row).next().next().find('a').attr('href'), episodePageUrl);
                        [first, second].forEach(link => link && episodeLinks.push(link));
                    }
                    collected.push(...await resolveStreams([...new Set(episodeLinks)], episodePageUrl));
                }
            } catch {
                // Continue with other season/episode blocks.
            }
        }

        const streams = rankAndTrim(dedupe(collected));
        mdLog('info', 'provider.done', { tmdbId, type, season, episode, streams: streams.length, elapsedMs: Date.now() - started });
        return streams;
    } catch (error) {
        mdLog('error', 'provider.failed', { tmdbId, mediaType, season, episode, elapsedMs: Date.now() - started, error: error.message });
        return [];
    }
}

module.exports = {
    getMoviesDriveStreams,
    resolveQuality,
    parseSizeGb: toGB,
    findPost,
    resolveStreams,
};
