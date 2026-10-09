'use strict';

const cheerio = require('cheerio');
const tmdb = require('../utils/tmdb');

const BASE_URL = 'https://animesalt.cx';
const ANIMESALT_HOSTS = new Set(['animesalt.ac', 'animesalt.cx']);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 15_000;

function cleanTitle(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isAnimeSaltUrl(value) {
    try {
        const url = new URL(value, BASE_URL);
        return url.protocol === 'https:' && ANIMESALT_HOSTS.has(url.hostname.toLowerCase());
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

function isTrustedPlayerUrl(url) {
    if (!url || url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'ravok.buzz' || /^as-cdn\d+\.top$/.test(host)) {
        return /^\/video\/[a-f0-9]+\/?$/i.test(url.pathname);
    }
    if (host === 'animesalt.cx') {
        return url.pathname === '/wp-content/themes/torofilm/public/plyr/player.php';
    }
    if (host === 'cybervynx.com') return /^\/e\/[a-z0-9]+\/?$/i.test(url.pathname);
    return false;
}

function parsePlayerServers(html, pageUrl) {
    const $ = cheerio.load(html || '');
    const containers = $('.video.aa-tb');
    const buttons = $('.server-grid .server-btn');
    const elements = containers.length ? containers : $('iframe[src], iframe[data-src]');
    const servers = [];

    elements.each((index, element) => {
        const container = $(element);
        const iframe = containers.length ? container.find('iframe').first() : container;
        const source = iframe.attr('data-src') || iframe.attr('src');
        if (!source) return;

        try {
            const url = new URL(source, pageUrl);
            if (!isTrustedPlayerUrl(url)) {
                console.warn(`[AnimeSalt] Ignoring unsupported server URL ${url.hostname}${url.pathname}`);
                return;
            }
            const button = buttons.eq(index);
            const labelParts = [button.find('.server-name').first().text().trim(), button.find('.server-info').first().text().trim()].filter(Boolean);
            const label = labelParts.join(' ') || button.text().replace(/\s+/g, ' ').trim() || `Server ${index + 1}`;
            servers.push({ label, url: url.href });
        } catch {
            console.warn(`[AnimeSalt] Ignoring invalid server URL in ${new URL(pageUrl).pathname}`);
        }
    });

    return servers;
}

function getPlayableSourceUrl(value, baseUrl) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value.trim().replace(/\\\//g, '/').replace(/\\u0026/gi, '&'), baseUrl);
        if (url.protocol !== 'https:' || !/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(url.href)) return null;
        return url.href;
    } catch {
        return null;
    }
}

function extractPlayableSources(html, baseUrl) {
    const $ = cheerio.load(html || '');
    const candidates = [];
    const add = value => {
        const url = getPlayableSourceUrl(value, baseUrl);
        if (url && !candidates.includes(url)) candidates.push(url);
    };

    $('video[src], source[src]').each((_, element) => add($(element).attr('src')));
    const text = String(html || '').replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/gi, '&');
    const patterns = [
        /\b(?:file|src)\s*:\s*["'`]([^"'`]+)["'`]/gi,
        /["'](?:file|src)["']\s*:\s*["']([^"']+)["']/gi,
        /(?:https?:)?\/\/[^\s"'<>\\]+\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\]*)?/gi
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text))) add(match[1] || match[0]);
    }
    return candidates;
}

function buildRavokStream(sourceUrl, playerUrl, pageUrl, label, sourceData) {
    const streamUrl = getPlayableSourceUrl(sourceUrl, playerUrl);
    if (!streamUrl) return null;
    const cdnOrigin = new URL(streamUrl).origin;
    const stream = {
        url: streamUrl,
        quality: '720p',
        server: label,
        headers: { Referer: `${cdnOrigin}/`, Origin: cdnOrigin, 'User-Agent': USER_AGENT },
        subtitles: []
    };

    if (Array.isArray(sourceData && sourceData.tracks) && sourceData.tracks.length) {
        stream.subtitles = sourceData.tracks.filter(track => track && (track.file || track.url)).map((track, index) => ({
            id: `animesalt-${index}-en`,
            url: track.file || track.url,
            lang: track.language || track.label || 'en',
            label: track.label || track.language || 'English',
            language: track.language || track.label || 'en',
            mimeType: /\.srt(?:$|\?)/i.test(track.file || track.url) ? 'application/x-subrip' : 'text/vtt',
            headers: { Referer: pageUrl, 'User-Agent': USER_AGENT }
        }));
    }
    return stream;
}

async function resolveRavokPlayer(playerUrl, pageUrl, label) {
    const parsedUrl = new URL(playerUrl);
    const hashMatch = parsedUrl.pathname.match(/^\/video\/([a-f0-9]+)\/?$/i);
    if (!hashMatch) return [];
    const hash = hashMatch[1];
    const apiUrl = new URL('/player/index.php', parsedUrl.origin);
    apiUrl.searchParams.set('data', hash);
    apiUrl.searchParams.set('do', 'getVideo');
    const data = await request(apiUrl.href, {
        method: 'POST', body: new URLSearchParams({ hash, r: pageUrl }).toString(), json: true,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded', Referer: playerUrl,
            Origin: parsedUrl.origin, 'X-Requested-With': 'XMLHttpRequest'
        }
    });
    const values = [data && data.videoSource, data && data.securedLink];
    if (Array.isArray(data && data.videoSources)) {
        values.push(...data.videoSources.map(source => typeof source === 'string' ? source : source && (source.file || source.src)));
    }
    const streams = [];
    for (const value of values) {
        const stream = buildRavokStream(value, playerUrl, pageUrl, label, data);
        if (stream && !streams.some(existing => existing.url === stream.url)) streams.push(stream);
    }
    if (!streams.length) console.warn(`[AnimeSalt] ${label} returned no playable source`);
    return streams;
}

async function resolveAbyssPlayer(playerUrl, pageUrl, label) {
    const html = await request(playerUrl, { headers: { Referer: pageUrl } });
    let sources = extractPlayableSources(html, playerUrl);
    let sourcePageUrl = playerUrl;
    if (!sources.length) {
        const $ = cheerio.load(html || '');
        const iframeSrc = $('iframe[src], iframe[data-src]').first().attr('data-src') || $('iframe[src], iframe[data-src]').first().attr('src');
        if (iframeSrc) {
            const nestedUrl = new URL(iframeSrc, playerUrl);
            if (nestedUrl.protocol === 'https:' && nestedUrl.hostname.toLowerCase() === 'player.abyssplayer.com') {
                sourcePageUrl = nestedUrl.href;
                const nestedHtml = await request(sourcePageUrl, { headers: { Referer: playerUrl } });
                sources = extractPlayableSources(nestedHtml, sourcePageUrl);
            }
        }
    }
    return sources.map(url => {
        const qualityMatch = url.match(/\b(\d{3,4})p\b/i);
        return {
            url, quality: qualityMatch ? `${qualityMatch[1]}p` : 'Auto', server: label,
            headers: { Referer: sourcePageUrl, Origin: new URL(sourcePageUrl).origin, 'User-Agent': USER_AGENT },
            subtitles: []
        };
    });
}

async function resolveServer(player, pageUrl) {
    const playerUrl = new URL(player.url);
    const host = playerUrl.hostname.toLowerCase();
    if (host === 'ravok.buzz' || /^as-cdn\d+\.top$/.test(host)) {
        return resolveRavokPlayer(player.url, pageUrl, player.label);
    }
    if (host === 'animesalt.cx') return resolveAbyssPlayer(player.url, pageUrl, player.label);
    if (host === 'cybervynx.com') {
        const html = await request(player.url, { headers: { Referer: pageUrl } });
        const sources = extractPlayableSources(html, player.url);
        if (!sources.length) {
            console.warn(`[AnimeSalt] ${player.label} has no source in its HTML; its packed client script is not executed`);
        }
        return sources.map(url => ({
            url, quality: 'Auto', server: player.label,
            headers: { Referer: player.url, Origin: playerUrl.origin, 'User-Agent': USER_AGENT },
            subtitles: []
        }));
    }
    return [];
}

async function getStreamsFromPage(pageUrl) {
    const html = await request(pageUrl, { headers: { Referer: `${BASE_URL}/` } });
    const servers = parsePlayerServers(html, pageUrl);
    if (!servers.length) {
        console.warn(`[AnimeSalt] No supported player servers on ${new URL(pageUrl).pathname}`);
        return [];
    }
    console.log(`[AnimeSalt] Resolving ${servers.length} server(s): ${servers.map(server => server.label).join(', ')}`);
    const results = await Promise.all(servers.map(async server => {
        try {
            const streams = await resolveServer(server, pageUrl);
            if (!streams.length) console.warn(`[AnimeSalt] ${server.label} did not yield a playable source`);
            return streams;
        } catch (error) {
            console.warn(`[AnimeSalt] ${server.label} resolution failed: ${error.message}`);
            return [];
        }
    }));
    return results.flat();
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
        console.log(`[AnimeSalt] Search parsed ${results.length} ${isMovie ? 'movie' : 'series'} result(s); ranked ${candidates.length} candidate(s)`);
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

        console.log(`[AnimeSalt] Fetching sources from ${new URL(pageUrl).pathname}`);
        const streams = await getStreamsFromPage(pageUrl);
        return streams.map(stream => ({
            name: 'AnimeSalt',
            title: `${title} - AnimeSalt ${isMovie ? 'Movie' : `S${seasonNumber}E${episodeNumber}`} - ${stream.server}`,
            ...stream
        }));
    } catch (error) {
        console.error(`[AnimeSalt] Failed for TMDB ${id} S${seasonNumber}E${episodeNumber}: ${error.message}`);
        return [];
    }
}

module.exports = { getStreams, parseSearchResults, rankSearchResults, findEpisodeUrlFromHtml, getEpisodeUrl, parsePlayerServers, extractPlayableSources };
