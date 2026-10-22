'use strict';

const cheerio = require('cheerio');
const similarity = require('string-similarity');
const { fetch } = require('../utils/providerFetch');
const { getDetails, resolveImdbId } = require('../utils/tmdb');

const BASE_URL = 'https://moviesjoy.mom';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const REQUEST_HEADERS = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};
const PROBE_SERVERS = new Set(['PrimeSrc', 'VidNest', 'VidUp']);
const REQUEST_TIMEOUT_MS = 25000;
const MIN_SIMILARITY = 0.70;

function normalizeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractYear(value) {
    const match = String(value || '').match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : null;
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

function cleanHtmlText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildSearchUrl(title, mediaType) {
    const type = mediaType === 'tv' ? 'series' : 'movie';
    return `${BASE_URL}/filter?q=${encodeURIComponent(title)}&type=${type}&genres=&country=&year=&rated=&sort=created_at.desc`;
}

function parseSearchResults(html, mediaType) {
    const $ = cheerio.load(html || '');
    const expectedType = mediaType === 'tv' ? 'series' : 'movie';
    const results = [];

    $('.movie-card[href]').each((_, element) => {
        const card = $(element);
        const href = absoluteUrl(card.attr('href'));
        if (!href) return;
        const title = cleanHtmlText(card.find('.title').first().text() || card.attr('title'));
        const meta = cleanHtmlText(card.find('.meta-details').first().text());
        const cardType = /\bTV\b|\bSeries\b/i.test(meta) || /\/seriesjoy\//i.test(href) ? 'series' : 'movie';
        if (cardType !== expectedType) return;
        results.push({
            title,
            year: extractYear(`${title} ${meta}`),
            url: href,
            type: cardType,
        });
    });

    return results;
}

function scoreSearchResult(result, title, year) {
    const wantedTitle = normalizeTitle(title);
    const resultTitle = normalizeTitle(result.title);
    const score = similarity.compareTwoStrings(wantedTitle, resultTitle);
    const yearMatches = Boolean(year && result.year === String(year));
    return { score, yearMatches, accepted: yearMatches && score >= MIN_SIMILARITY };
}

function selectBestResult(results, title, year) {
    return results
        .map(result => ({ result, ...scoreSearchResult(result, title, year) }))
        .filter(candidate => candidate.accepted)
        .sort((a, b) => b.score - a.score)[0]?.result || null;
}

function replaceTemplate(template, values) {
    return String(template || '').replace(/\{(imdb_id|tmdb_id|season|episode)\}/gi, (_, key) => {
        const value = values[key.toLowerCase()];
        return value == null ? '' : encodeURIComponent(String(value));
    });
}

function parseServerButtons(html, context) {
    const $ = cheerio.load(html || '');
    const servers = [];
    $('#serverSelector button[data-server-url], .player-server-list button[data-server-url]').each((_, element) => {
        const button = $(element);
        const name = cleanHtmlText(button.find('.server-name').first().text());
        if (!PROBE_SERVERS.has(name)) return;
        const template = button.attr('data-server-template') || button.attr('data-server-url');
        const url = replaceTemplate(template, context);
        const absolute = absoluteUrl(url);
        if (!absolute || servers.some(server => server.name === name && server.url === absolute)) return;
        servers.push({ name, url: absolute });
    });
    return servers;
}

function extractCandidateUrls(html, pageUrl) {
    const $ = cheerio.load(html || '');
    const candidates = [];
    const add = value => {
        const url = absoluteUrl(value, pageUrl);
        if (!url || candidates.includes(url)) return;
        if (/\.(?:srt|vtt)(?:[?#]|$)/i.test(url)) return;
        candidates.push(url);
    };

    $('iframe[src], video[src], source[src], [data-src], [data-file], [data-video]').each((_, element) => {
        const node = $(element);
        ['src', 'data-src', 'data-file', 'data-video'].forEach(attribute => add(node.attr(attribute)));
    });

    const sourcePattern = /(?:file|source|src|url|streamUrl|videoUrl)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = sourcePattern.exec(html || '')) !== null) add(match[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'));

    return candidates;
}

function streamFormat(url) {
    if (/\.m3u8(?:[?#]|$)/i.test(url)) return { format: 'hls', mimeType: 'application/vnd.apple.mpegurl' };
    if (/\.mpd(?:[?#]|$)/i.test(url)) return { format: 'dash', mimeType: 'application/dash+xml' };
    return { format: 'mp4', mimeType: 'video/mp4' };
}

async function requestText(url, headers = REQUEST_HEADERS) {
    const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

async function probeServer(server, referer) {
    const headers = { ...REQUEST_HEADERS, Referer: referer };
    try {
        const html = await requestText(server.url, headers);
        let urls = extractCandidateUrls(html, server.url);

        // Some server endpoints return a wrapper iframe before exposing the player source.
        for (const candidate of urls.slice(0, 2)) {
            if (/\.(?:m3u8|mpd|mp4)(?:[?#]|$)/i.test(candidate)) continue;
            try {
                const nestedHtml = await requestText(candidate, { ...headers, Referer: server.url });
                urls = urls.concat(extractCandidateUrls(nestedHtml, candidate));
            } catch {
                // One unavailable server must not prevent the other sources from returning.
            }
        }

        return urls
            .filter(url => /\.(?:m3u8|mpd|mp4)(?:[?#]|$)/i.test(url) || /(?:stream|video|play|source)/i.test(url))
            .filter((url, index, values) => values.indexOf(url) === index)
            .map(url => ({
                name: `MoviesJoy ${server.name}`,
                title: `MoviesJoy - ${server.name}`,
                url,
                quality: 'Auto',
                provider: 'moviesjoy',
                ...streamFormat(url),
                headers,
                subtitles: [],
            }));
    } catch (error) {
        console.warn(`[MoviesJoy] ${server.name} probe failed: ${error.message}`);
        return [];
    }
}

async function getmoviesjoyStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    if (type === 'tv' && (!Number.isInteger(Number(season)) || !Number.isInteger(Number(episode)))) {
        console.warn('[MoviesJoy] TV request is missing season or episode');
        return [];
    }

    try {
        const details = await getDetails(type, tmdbId);
        if (!details) return [];
        const title = type === 'tv' ? details.name : details.title;
        const year = extractYear(type === 'tv' ? details.first_air_date : details.release_date);
        if (!title || !year) return [];

        const searchUrl = buildSearchUrl(title, type);
        const searchHtml = await requestText(searchUrl);
        const match = selectBestResult(parseSearchResults(searchHtml, type), title, year);
        if (!match) {
            console.warn(`[MoviesJoy] No title match above ${MIN_SIMILARITY * 100}% for ${title} (${year})`);
            return [];
        }

        const imdbId = await resolveImdbId(type, tmdbId);
        const contentUrl = type === 'tv'
            ? `${match.url.replace(/\/$/, '')}/season-${encodeURIComponent(Number(season))}/episode-${encodeURIComponent(Number(episode))}`
            : match.url;
        const contentHtml = await requestText(contentUrl, { ...REQUEST_HEADERS, Referer: searchUrl });
        const servers = parseServerButtons(contentHtml, {
            tmdb_id: tmdbId,
            imdb_id: imdbId,
            season,
            episode,
        });
        if (!servers.length) return [];

        const streams = (await Promise.all(servers.map(server => probeServer(server, contentUrl)))).flat();
        const seen = new Set();
        return streams.filter(stream => {
            if (seen.has(stream.url)) return false;
            seen.add(stream.url);
            return true;
        });
    } catch (error) {
        console.error(`[MoviesJoy] getmoviesjoyStreams error: ${error.message}`);
        return [];
    }
}

module.exports = {
    getmoviesjoyStreams,
    buildSearchUrl,
    parseSearchResults,
    scoreSearchResult,
    selectBestResult,
    parseServerButtons,
    extractCandidateUrls,
    probeServer,
};
