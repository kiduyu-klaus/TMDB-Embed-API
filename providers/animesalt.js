'use strict';

const cheerio = require('cheerio');
const tmdb = require('../utils/tmdb');

const BASE_URL = 'https://animesalt.cx';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15_000;

function cleanTitle(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isAnimeSaltUrl(value) {
    try {
        const url = new URL(value, BASE_URL);
        return url.protocol === 'https:' && url.hostname === 'animesalt.ac';
    } catch {
        return false;
    }
}

function parseSearchResults(html, mediaType = 'anime') {
    const $ = cheerio.load(html || '');
    const container = $('#movies-a').length ? $('#movies-a') : $.root();
    const results = [];
    const seen = new Set();

    container.find('article').each((_, article) => {
        const titleElement = $(article).find('.entry-title').first();
        const anchor = titleElement.is('a') ? titleElement : titleElement.find('a').first();
        const href = anchor.attr('href') || $(article).find('a[href]').filter((__, link) => /\/(?:series|movies)\//.test($(link).attr('href') || '')).first().attr('href');
        const title = (titleElement.text() || anchor.attr('title') || '').trim();
        if (!href || !title) return;

        let url;
        try {
            url = new URL(href, BASE_URL);
        } catch {
            return;
        }
        if (!isAnimeSaltUrl(url.href)) return;
        const type = url.pathname.split('/').filter(Boolean)[0];
        if (!['series', 'movies'].includes(type)) return;
        const requiredType = mediaType === 'movie' ? 'movies' : 'series';
        if (type !== requiredType || seen.has(url.href)) return;
        seen.add(url.href);

        const yearText = $(article).find('.year').first().text();
        const yearMatch = yearText.match(/\b(\d{4})\b/);
        results.push({ url: url.href, type, slug: url.pathname.split('/').filter(Boolean)[1], title, year: yearMatch ? Number(yearMatch[1]) : null });
    });

    return results;
}

function rankSearchResults(results, title, year) {
    let candidates = results;
    if (year) {
        const yearMatches = results.filter(result => result.year && Math.abs(result.year - year) <= 1);
        const withoutYear = results.filter(result => !result.year);
        candidates = yearMatches.length ? yearMatches : (withoutYear.length ? withoutYear : results);
    }

    const expected = cleanTitle(title);
    return candidates.slice().sort((a, b) => {
        const cleanA = cleanTitle(a.title);
        const cleanB = cleanTitle(b.title);
        const exactA = cleanA === expected ? 0 : 1;
        const exactB = cleanB === expected ? 0 : 1;
        if (exactA !== exactB) return exactA - exactB;
        const startsA = cleanA.startsWith(expected) ? 0 : 1;
        const startsB = cleanB.startsWith(expected) ? 0 : 1;
        if (startsA !== startsB) return startsA - startsB;
        return cleanA.length - cleanB.length;
    });
}

function findEpisodeUrlFromHtml(html, season, episode) {
    const $ = cheerio.load(html || '');
    const requestedSeason = Number(season);
    const requestedEpisode = Number(episode);
    const pattern = new RegExp(`(?:^|[^0-9])0*${requestedSeason}x0*${requestedEpisode}(?:[^0-9]|$)`, 'i');
    let result = null;

    $('a[href*="/episode/"]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href || !pattern.test(href) || !isAnimeSaltUrl(href)) return;
        result = new URL(href, BASE_URL).href;
        return false;
    });
    return result;
}

async function request(url, { method = 'GET', headers = {}, body, json = false } = {}) {
    const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : require('node-fetch');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
        const response = await fetchImpl(url, {
            method,
            headers: { 'User-Agent': USER_AGENT, ...headers },
            ...(body !== undefined ? { body } : {}),
            ...(controller ? { signal: controller.signal } : {})
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return json ? response.json() : response.text();
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

async function getEpisodeUrl(seriesUrl, season, episode) {
    const html = await request(seriesUrl, { headers: { Referer: `${BASE_URL}/` } });
    const $ = cheerio.load(html);
    const seasonControls = $('[data-post][data-season]');
    if (!seasonControls.length) return findEpisodeUrlFromHtml(html, season, episode);

    let targetPost = null;
    seasonControls.each((_, element) => {
        if (Number($(element).attr('data-season')) === Number(season)) {
            targetPost = $(element).attr('data-post');
            return false;
        }
        return undefined;
    });
    if (!targetPost) return null;

    const ajaxUrl = new URL('/wp-admin/admin-ajax.php', BASE_URL);
    ajaxUrl.searchParams.set('action', 'action_select_season');
    ajaxUrl.searchParams.set('season', String(season));
    ajaxUrl.searchParams.set('post', targetPost);
    const episodeHtml = await request(ajaxUrl.href, { headers: { Referer: seriesUrl } });
    return findEpisodeUrlFromHtml(episodeHtml, season, episode);
}

function isAnimeSaltCdnHost(hostname) {
    return /^as-cdn\d+\.top$/i.test(hostname);
}

async function getStreamFromPage(pageUrl) {
    const html = await request(pageUrl, { headers: { Referer: `${BASE_URL}/` } });
    const iframeSrc = cheerio.load(html)('iframe[src]').first().attr('src');
    if (!iframeSrc) {
        console.warn(`[AnimeSalt] No player iframe on ${new URL(pageUrl).pathname}`);
        return null;
    }

    const playerUrl = new URL(iframeSrc, pageUrl);
    const hashMatch = playerUrl.pathname.match(/^\/video\/([a-f0-9]+)\/?$/i);
    if (playerUrl.protocol !== 'https:' || !isAnimeSaltCdnHost(playerUrl.hostname) || !hashMatch) {
        console.warn(`[AnimeSalt] Unsupported player host/path: ${playerUrl.hostname}${playerUrl.pathname}`);
        return null;
    }

    const hash = hashMatch[1];
    const apiUrl = new URL('/player/index.php', playerUrl.origin);
    apiUrl.searchParams.set('data', hash);
    apiUrl.searchParams.set('do', 'getVideo');
    const body = new URLSearchParams({ hash, r: `${BASE_URL}/` }).toString();
    const data = await request(apiUrl.href, {
        method: 'POST',
        body,
        json: true,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${BASE_URL}/`,
            Origin: playerUrl.origin,
            'X-Requested-With': 'XMLHttpRequest'
        }
    });

    const sourceValue = data && (data.videoSource || data.securedLink);
    if (typeof sourceValue !== 'string' || !sourceValue) return null;
    const streamUrl = new URL(sourceValue, playerUrl.origin);
    if (!['http:', 'https:'].includes(streamUrl.protocol)) return null;

    const contentHashMatch = streamUrl.pathname.match(/\/hls\/([a-f0-9]+)\//i);
    const contentHash = contentHashMatch ? contentHashMatch[1] : hash;
    const hlsMarker = '/cdn/hls/';
    const markerPosition = streamUrl.href.indexOf(hlsMarker);
    const cdnBase = markerPosition >= 0 ? streamUrl.href.slice(0, markerPosition).replace(/\/$/, '') : streamUrl.origin;
    const cdnOrigin = new URL(cdnBase).origin;
    const subtitleUrl = `${cdnBase}/cdn/down/${contentHash}/Subtitle/subtitle_eng.srt`;

    return {
        url: streamUrl.href,
        quality: '720p',
        headers: { Referer: `${cdnOrigin}/`, Origin: cdnOrigin, 'User-Agent': USER_AGENT },
        subtitles: [{
            id: 'animesalt-en',
            url: subtitleUrl,
            lang: 'en',
            label: 'English',
            language: 'en',
            mimeType: 'application/x-subrip',
            headers: { Referer: `${cdnOrigin}/`, 'User-Agent': USER_AGENT }
        }]
    };
}

async function getStreams(tmdbId, mediaType = 'anime', season = 1, episode = 1) {
    const id = String(tmdbId || '').trim();
    const isMovie = mediaType === 'movie';
    const seasonNumber = Number(season) || 1;
    const episodeNumber = Number(episode) || 1;
    if (!/^\d+$/.test(id) || !Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
        console.warn('[AnimeSalt] Expected a numeric TMDB ID, season, and episode');
        return [];
    }

    try {
        const details = await tmdb.getDetails(isMovie ? 'movie' : 'tv', id);
        const title = details && (isMovie ? details.title || details.name : details.name || details.title);
        if (!title) return [];
        const releaseDate = isMovie ? details.release_date : details.first_air_date;
        const year = releaseDate ? Number.parseInt(releaseDate.slice(0, 4), 10) : null;
        const searchUrl = new URL('/', BASE_URL);
        searchUrl.searchParams.set('s', title);
        console.log(`[AnimeSalt] Searching ${title} (${year || 'year unknown'}) for S${seasonNumber}E${episodeNumber}`);

        const searchHtml = await request(searchUrl.href, { headers: { Referer: `${BASE_URL}/` } });
        const results = parseSearchResults(searchHtml, isMovie ? 'movie' : 'anime');
        const candidates = rankSearchResults(results, title, year);
        if (!candidates.length) {
            console.warn(`[AnimeSalt] No matching ${isMovie ? 'movie' : 'series'} found for ${title}`);
            return [];
        }

        const candidate = candidates[0];
        console.log(`[AnimeSalt] Selected ${candidate.title}${candidate.year ? ` (${candidate.year})` : ''}`);
        let pageUrl;
        if (isMovie) {
            pageUrl = candidate.url;
        } else {
            pageUrl = await getEpisodeUrl(candidate.url, seasonNumber, episodeNumber);
            if (!pageUrl) {
                console.warn(`[AnimeSalt] Episode S${seasonNumber}E${episodeNumber} was not found`);
                return [];
            }
        }

        const stream = await getStreamFromPage(pageUrl);
        if (!stream) return [];
        return [{
            name: 'AnimeSalt',
            title: `${title} - AnimeSalt ${isMovie ? 'Movie' : `S${seasonNumber}E${episodeNumber}`}`,
            ...stream
        }];
    } catch (error) {
        console.error(`[AnimeSalt] Failed for TMDB ${id} S${seasonNumber}E${episodeNumber}: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams, parseSearchResults, rankSearchResults, findEpisodeUrlFromHtml, getEpisodeUrl };
