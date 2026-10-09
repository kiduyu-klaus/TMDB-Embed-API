'use strict';

const cheerio = require('cheerio');
const tmdb = require('../utils/tmdb');
const animeKai = require('./animekai');

const BASE_URL = 'https://all-wish.me';
const REQUEST_TIMEOUT_MS = 15_000;
const SUPPORTED_PLAYER_DOMAINS = [
    'megaplay.buzz', 'megaplay.su', 'rapid-cloud.co', 'rapid-cloud.io', 'rapid-cloud.ru',
    'gogoanime.me.uk', 'gogoanime.me'
];
const REQUEST_HEADERS = {
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
};

function normalizeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\b(?:season|s)\s*\d+\b/gi, ' ')
        .replace(/\b(?:dub|dubbed|sub|subbed)\b/gi, ' ')
        .replace(/\b(?:19|20)\d{2}\b/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function buildAnimeSearchTitle(title, season = 1) {
    return Number(season) > 1 ? `${title} season ${Number(season)}` : title;
}

function findAnimeSearchCandidate(html, title, season = 1) {
    const $ = cheerio.load(html || '');
    const expected = normalizeTitle(title);
    const requestedSeason = Number(season) || 1;
    const candidates = [];

    $('div.item').each((_, item) => {
        const anchor = $(item).find('div.name > a').first();
        const href = anchor.attr('href');
        const resultTitle = (anchor.attr('title') || anchor.text() || '').trim();
        if (!href || !resultTitle) return;

        const seasonMatch = resultTitle.match(/\bseason\s*(\d+)\b|\bs(\d+)\b/i);
        const resultSeason = seasonMatch ? Number(seasonMatch[1] || seasonMatch[2]) : null;
        if (resultSeason && resultSeason !== requestedSeason) return;

        const normalizedResult = normalizeTitle(resultTitle);
        if (!expected || (!normalizedResult.includes(expected) && !expected.includes(normalizedResult))) return;
        const score = normalizedResult === expected ? 100 : normalizedResult.includes(expected) ? 80 : 60;
        try {
            const resultUrl = new URL(href, BASE_URL);
            if (resultUrl.protocol !== 'https:' || (resultUrl.hostname !== 'all-wish.me' && !resultUrl.hostname.endsWith('.all-wish.me'))) return;
            candidates.push({ href: resultUrl.href.replace(/\/+$/, ''), title: resultTitle, score });
        } catch {
            // Ignore malformed result URLs.
        }
    });

    return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function findEpisodeDataIds(html, episodeNumber, seasonNumber = 1) {
    const $ = cheerio.load(html || '');
    const requestedEpisode = Number(episodeNumber) || 1;
    const requestedSeason = Number(seasonNumber) || 1;
    let match = null;
    const episodes = $('div.range > div > a');

    episodes.each((_, element) => {
        const anchor = $(element);
        const slug = anchor.attr('data-slug') || '';
        const parsedEpisode = Number.parseInt(slug, 10);
        const seasonValue = anchor.attr('data-season') || anchor.closest('[data-season]').attr('data-season');
        const parsedSeason = seasonValue ? Number.parseInt(seasonValue, 10) : null;
        if (parsedEpisode === requestedEpisode && (!parsedSeason || parsedSeason === requestedSeason)) {
            match = anchor.attr('data-ids') || null;
            return false;
        }
        return undefined;
    });

    if (!match && requestedEpisode === 1) {
        const first = episodes.first();
        const firstSeasonValue = first.attr('data-season') || first.closest('[data-season]').attr('data-season');
        const firstSeason = firstSeasonValue ? Number.parseInt(firstSeasonValue, 10) : null;
        if (!firstSeason || firstSeason === requestedSeason) match = first.attr('data-ids') || null;
    }
    return match;
}

function parseServerEntries(html) {
    const $ = cheerio.load(html || '');
    const servers = [];
    $('div.server-type').each((_, section) => {
        const sectionType = ($(section).attr('data-type') || 'sub').trim();
        $(section).find('div.server-list > div.server').each((__, server) => {
            const dataLinkId = $(server).attr('data-link-id');
            if (!dataLinkId) return;
            const label = ($(server).text() || $(server).attr('data-server-name') || '').trim();
            servers.push({ dataLinkId, sectionType, label });
        });
    });
    return servers;
}

async function fetchResponse(url, { json = false, headers = REQUEST_HEADERS } = {}) {
    const fetchImpl = typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : require('node-fetch');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
        const response = await fetchImpl(url, { headers, ...(controller ? { signal: controller.signal } : {}) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return json ? response.json() : response.text();
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function createStream(source, server, playerUrl) {
    const audioType = String(server.sectionType || 'sub').toUpperCase();
    const serverName = server.label || 'Server';
    const stream = {
        name: `AllWish ${audioType} - ${serverName}`,
        title: `AllWish ${audioType} - ${serverName}`,
        url: source.url,
        quality: '1080p',
        headers: {
            Referer: source.referer || playerUrl,
            'User-Agent': REQUEST_HEADERS['User-Agent']
        }
    };
    if (Array.isArray(source.subtitles) && source.subtitles.length) stream.subtitles = source.subtitles;
    if (source.intro != null) stream.intro = source.intro;
    if (source.outro != null) stream.outro = source.outro;
    return stream;
}

async function resolveServer(server) {
    try {
        const url = new URL('/ajax/server', BASE_URL);
        url.searchParams.set('get', server.dataLinkId);
        const result = await fetchResponse(url.href, { json: true });
        const rawPlayerUrl = result && result.result && result.result.url;
        if (!rawPlayerUrl) return [];
        const parsedPlayerUrl = new URL(rawPlayerUrl, BASE_URL);
        if (!['https:', 'http:'].includes(parsedPlayerUrl.protocol)) return [];
        const playerUrl = parsedPlayerUrl.href;
        const host = parsedPlayerUrl.hostname.toLowerCase();
        const isPlayer = SUPPORTED_PLAYER_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
        const isDirectMedia = /\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(playerUrl);

        if (isPlayer) {
            const resolved = await animeKai.resolveDirectM3u8(playerUrl);
            if (resolved && resolved.url) return [createStream(resolved, server, playerUrl)];
            if (!isDirectMedia) {
                console.warn(`[AllWish] Could not resolve player source for ${host}`);
                return [];
            }
        }

        return [createStream({ url: playerUrl, referer: playerUrl }, server, playerUrl)];
    } catch (error) {
        console.warn(`[AllWish] Server ${server.dataLinkId} failed: ${error.message}`);
        return [];
    }
}

async function getStreams(tmdbId, _mediaType = 'anime', season = 1, episode = 1) {
    const id = String(tmdbId || '').trim();
    const seasonNumber = Number(season) || 1;
    const episodeNumber = Number(episode) || 1;
    if (!/^\d+$/.test(id) || !Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
        console.warn('[AllWish] Expected a numeric TMDB ID, season, and episode');
        return [];
    }

    try {
        const details = await tmdb.getDetails('tv', id);
        const title = details && (details.name || details.title);
        if (!title) {
            console.warn(`[AllWish] TMDB returned no TV title for ${id}`);
            return [];
        }

        const query = buildAnimeSearchTitle(title, seasonNumber);
        const searchUrl = new URL('/filter', BASE_URL);
        searchUrl.searchParams.set('keyword', query);
        console.log(`[AllWish] Searching ${query} (S${seasonNumber}E${episodeNumber})`);
        const searchHtml = await fetchResponse(searchUrl.href);
        const candidate = findAnimeSearchCandidate(searchHtml, title, seasonNumber);
        if (!candidate) {
            console.warn(`[AllWish] No matching title found for ${query}`);
            return [];
        }

        const animePage = await fetchResponse(candidate.href);
        const dataId = cheerio.load(animePage)('main > div.container').attr('data-id');
        if (!dataId) {
            console.warn('[AllWish] Anime detail page has no data-id');
            return [];
        }

        const episodeListUrl = new URL(`/ajax/episode/list/${encodeURIComponent(dataId)}`, BASE_URL);
        episodeListUrl.searchParams.set('vrf', generateEpisodeVrf(dataId));
        const episodeList = await fetchResponse(episodeListUrl.href, { json: true });
        if (!episodeList || episodeList.status !== 200) {
            console.warn(`[AllWish] Episode list failed for ${candidate.title}`);
            return [];
        }

        const episodeIds = findEpisodeDataIds(episodeList.result || '', episodeNumber, seasonNumber);
        if (!episodeIds) {
            console.warn(`[AllWish] Requested S${seasonNumber}E${episodeNumber} is not listed`);
            return [];
        }

        const serverListUrl = new URL('/ajax/server/list', BASE_URL);
        serverListUrl.searchParams.set('servers', episodeIds);
        const serverList = await fetchResponse(serverListUrl.href, { json: true });
        if (!serverList || serverList.status !== 200) {
            console.warn(`[AllWish] Server list failed for S${seasonNumber}E${episodeNumber}`);
            return [];
        }

        const servers = parseServerEntries(serverList.result || '').slice(0, 5);
        console.log(`[AllWish] ${candidate.title} S${seasonNumber}E${episodeNumber}: ${servers.length} server(s)`);
        const streams = (await Promise.all(servers.map(resolveServer))).flat();
        console.log(`[AllWish] Returning ${streams.length} stream(s) for S${seasonNumber}E${episodeNumber}`);
        return streams;
    } catch (error) {
        console.error(`[AllWish] Failed for TMDB ${id} S${seasonNumber}E${episodeNumber}: ${error.message}`);
        return [];
    }
}

function generateEpisodeVrf(episodeId) {
    const secretKey = 'ysJhV6U27FVIjjuk';
    const encodedId = encodeURIComponent(episodeId);
    const keyCodes = [...secretKey].map(character => character.charCodeAt(0));
    const dataCodes = [...encodedId].map(character => character.charCodeAt(0));
    const permutation = Array.from({ length: 256 }, (_, index) => index);
    let index = 0;
    for (let position = 0; position < 256; position += 1) {
        index = (index + permutation[position] + keyCodes[position % keyCodes.length]) % 256;
        [permutation[position], permutation[index]] = [permutation[index], permutation[position]];
    }

    const encrypted = [];
    let i = 0;
    index = 0;
    for (const byte of dataCodes) {
        i = (i + 1) % 256;
        index = (index + permutation[i]) % 256;
        [permutation[i], permutation[index]] = [permutation[index], permutation[i]];
        encrypted.push(byte ^ permutation[(permutation[i] + permutation[index]) % 256]);
    }

    const base64 = Buffer.from(encrypted).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const transformed = [...base64].map((character, position) => {
        let code = character.charCodeAt(0);
        const offsets = [-3, 3, -4, 2, -2, 5, 4, 5];
        code = (code + offsets[position % 8]) & 255;
        return code;
    });
    return Buffer.from(transformed).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        .replace(/[A-Za-z]/g, character => {
            const base = character <= 'Z' ? 65 : 97;
            return String.fromCharCode((character.charCodeAt(0) - base + 13) % 26 + base);
        });
}

module.exports = {
    getStreams,
    buildAnimeSearchTitle,
    findAnimeSearchCandidate,
    findEpisodeDataIds,
    parseServerEntries,
    generateEpisodeVrf
};
