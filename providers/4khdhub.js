const axios = require('axios');
const cheerio = require('cheerio');
const { getTmdbApiKey } = require('../utils/tmdbKey');

const PROVIDER = '4khdhub';
const DISPLAY_NAME = '4KHDHub';
const DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
const DEFAULT_MAIN_URL = 'https://4khdhub.one';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HEADERS = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};
const client = axios.create({
    timeout: 20000,
    maxRedirects: 8,
    headers: HEADERS,
    validateStatus: status => status >= 200 && status < 400
});

let domainCache = null;
let domainCacheTime = 0;

function validHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function fixUrl(value, baseUrl) {
    if (!value) return '';
    try {
        return new URL(value.startsWith('//') ? `https:${value}` : value, baseUrl).href;
    } catch {
        return '';
    }
}

async function getMainUrl() {
    if (domainCache && Date.now() - domainCacheTime < 10 * 60 * 1000) return domainCache;
    try {
        const response = await client.get(DOMAINS_URL, { timeout: 10000 });
        domainCache = response.data?.['4khdhub'] || response.data?.n4khdhub || DEFAULT_MAIN_URL;
    } catch (error) {
        console.warn(`[4KHDHub] Domain feed unavailable: ${error.message}`);
        domainCache = DEFAULT_MAIN_URL;
    }
    domainCacheTime = Date.now();
    return domainCache.replace(/\/+$/, '');
}

function normalizeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\b(?:19|20)\d{2}\b/g, ' ')
        .replace(/\b(?:season|s)\s*0*\d+\b/g, ' ')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(?:the|a|an)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleScore(expected, candidate) {
    const left = normalizeTitle(expected);
    const right = normalizeTitle(candidate);
    if (!left || !right) return 0;
    if (left === right) return 1;
    const leftWords = new Set(left.split(' '));
    const rightWords = new Set(right.split(' '));
    const overlap = [...leftWords].filter(word => rightWords.has(word)).length;
    return (2 * overlap) / (leftWords.size + rightWords.size);
}

function extractYear(value) {
    const match = String(value || '').match(/\b(19\d{2}|20\d{2})\b/);
    return match ? Number(match[1]) : null;
}

function parseQuality(...values) {
    const value = values.filter(Boolean).join(' ');
    for (const quality of [2160, 1440, 1080, 720, 480, 360]) {
        if (new RegExp(`\\b${quality}p?\\b`, 'i').test(value)) return `${quality}p`;
    }
    if (/\b(?:4k|uhd)\b/i.test(value)) return '2160p';
    return 'Auto';
}

async function getTmdbDetails(tmdbId, mediaType) {
    const apiKey = getTmdbApiKey();
    if (!apiKey) throw new Error('TMDB API key is missing');
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    const response = await client.get(`https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}`, {
        params: { api_key: apiKey },
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    });
    return {
        title: response.data?.title || response.data?.name || '',
        originalTitle: response.data?.original_title || response.data?.original_name || '',
        year: extractYear(response.data?.release_date || response.data?.first_air_date)
    };
}

async function searchContent(query, details, mediaType, season) {
    const mainUrl = await getMainUrl();
    const response = await client.get(`${mainUrl}/`, { params: { s: query } });
    const $ = cheerio.load(String(response.data));
    const candidates = [];
    $('div.card-grid a, div.card-grid-small a').each((_, element) => {
        const link = $(element);
        const title = link.find('h3').first().text().trim()
            || link.attr('title')
            || link.find('img').attr('alt')
            || link.text().trim();
        const url = fixUrl(link.attr('href'), mainUrl);
        if (!title || !url || /\/(?:category|tag)\//i.test(url)) return;
        const candidateYear = extractYear(`${title} ${link.find('.movie-card-meta').text()}`);
        const candidateSeason = String(title).match(/\b(?:season|s)\s*0*(\d+)\b/i);
        let score = titleScore(details.title, title);
        if (details.originalTitle && details.originalTitle !== details.title) {
            score = Math.max(score, titleScore(details.originalTitle, title));
        }
        if (details.year && candidateYear === details.year) score += 0.3;
        if (details.year && candidateYear && candidateYear !== details.year) score -= 0.8;
        if (mediaType !== 'movie' && candidateSeason && Number(candidateSeason[1]) === Number(season)) score += 0.35;
        if (mediaType !== 'movie' && candidateSeason && Number(candidateSeason[1]) !== Number(season)) score -= 1;
        candidates.push({ title, url, score });
    });
    return candidates.filter(item => item.score >= 0.65).sort((a, b) => b.score - a.score)[0] || null;
}

function collectPageLinks(html, pageUrl, mediaType, season, episode) {
    const $ = cheerio.load(html);
    const results = [];
    if (mediaType === 'movie' || !$('div.episodes-list').length) {
        $('div.download-item a[href]').each((_, element) => {
            results.push({
                url: fixUrl($(element).attr('href'), pageUrl),
                label: $(element).text().replace(/\s+/g, ' ').trim()
                    || $(element).closest('div.download-item').text().replace(/\s+/g, ' ').trim()
            });
        });
    } else {
        $('div.episodes-list div.season-item').each((_, seasonElement) => {
            const seasonText = $(seasonElement).find('div.episode-number').first().text();
            const seasonMatch = seasonText.match(/S?0*(\d+)/i);
            if (!seasonMatch || Number(seasonMatch[1]) !== Number(season)) return;
            $(seasonElement).find('div.episode-download-item').each((__, episodeElement) => {
                const episodeText = $(episodeElement).find('div.episode-file-info span.badge-psa').text()
                    || $(episodeElement).text();
                const episodeMatch = episodeText.match(/(?:episode|e)[-\s_]*0*(\d+)/i);
                if (!episodeMatch || Number(episodeMatch[1]) !== Number(episode)) return;
                $(episodeElement).find('a[href]').each((___, linkElement) => {
                    results.push({
                        url: fixUrl($(linkElement).attr('href'), pageUrl),
                        label: $(linkElement).text().replace(/\s+/g, ' ').trim() || `S${season}E${episode}`
                    });
                });
            });
        });
    }
    const seen = new Set();
    return results.filter(item => item.url && !seen.has(item.url) && seen.add(item.url));
}

function decodeRedirectPayload(html) {
    const regex = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    let combined = '';
    let match;
    while ((match = regex.exec(html)) !== null) combined += match[1] || match[2] || '';
    if (!combined) return null;
    const first = Buffer.from(combined, 'base64').toString('utf8');
    const second = Buffer.from(first, 'base64').toString('utf8');
    const rotated = second.replace(/[A-Za-z]/g, char => {
        const base = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
    });
    return JSON.parse(Buffer.from(rotated, 'base64').toString('utf8'));
}

async function resolveRedirect(url) {
    try {
        const response = await client.get(url);
        const payload = decodeRedirectPayload(String(response.data));
        if (!payload) return '';
        if (payload.o) return Buffer.from(payload.o, 'base64').toString('utf8').trim();
        if (payload.data && payload.blog_url) {
            const data = Buffer.from(payload.data, 'base64').toString('utf8').trim();
            const resolved = await client.get(`${payload.blog_url}?re=${encodeURIComponent(data)}`);
            const $ = cheerio.load(String(resolved.data));
            return $('body').text().trim() || String(resolved.data).trim();
        }
    } catch (error) {
        console.warn(`[4KHDHub] Redirect resolution failed: ${error.message}`);
    }
    return '';
}

function isDirectMedia(url, label = '') {
    if (!validHttpUrl(url)) return false;
    const parsed = new URL(url);
    const text = decodeURIComponent(`${parsed.pathname}${parsed.search} ${label}`).toLowerCase();
    if (/\.zip(?:$|[?&])/.test(text) || /(?:telegram|ampproject|bloggingvector)/i.test(parsed.hostname)) return false;
    return /\.(?:m3u8|mp4|mkv|webm)(?:$|[?&#])/i.test(text)
        || /(?:r2\.dev|r2\.cloudflarestorage\.com|fsl-buckets|fukggl|gigabytes|oreao-cdn)/i.test(parsed.hostname);
}

function buildStream(label, url, referer = '') {
    const quality = parseQuality(label, decodeURIComponent(url));
    const pathname = new URL(url).pathname.toLowerCase();
    const isHls = pathname.endsWith('.m3u8');
    const isMkv = pathname.endsWith('.mkv') || /\.mkv\b/i.test(label);
    return {
        name: `${DISPLAY_NAME} ${quality}`,
        title: `${DISPLAY_NAME} - ${quality}${label ? ` - ${label}` : ''}`,
        url,
        quality,
        provider: PROVIDER,
        type: isHls ? 'hls' : 'direct',
        mimeType: isHls ? 'application/vnd.apple.mpegurl'
            : (isMkv ? 'video/x-matroska' : 'video/mp4'),
        subtitles: [],
        headers: {
            'User-Agent': USER_AGENT,
            ...(referer ? { Referer: referer } : {})
        }
    };
}

async function resolveHubcloud(url, label, referer) {
    let entryUrl = url;
    let response = await client.get(entryUrl, { headers: { Referer: referer || url } });
    let $ = cheerio.load(String(response.data));
    if (!/hubcloud\.php/i.test(entryUrl)) {
        const download = $('#download').attr('href');
        if (!download) return [];
        entryUrl = fixUrl(download, entryUrl);
        response = await client.get(entryUrl, { headers: { Referer: url } });
        $ = cheerio.load(String(response.data));
    }
    const header = $('div.card-header').first().text().replace(/\s+/g, ' ').trim();
    const size = $('i#size').first().text().trim();
    const results = [];
    $('a.btn[href]').each((_, element) => {
        const link = fixUrl($(element).attr('href'), entryUrl);
        const text = $(element).text().replace(/\s+/g, ' ').trim();
        const lower = text.toLowerCase();
        if (!link || /telegram/.test(lower)) return;
        if (lower.includes('pixeldrain') && !link.includes('/api/file/')) {
            try {
                const parsed = new URL(link);
                const id = parsed.pathname.split('/').filter(Boolean).pop();
                if (id) {
                    const direct = `${parsed.origin}/api/file/${id}?download`;
                    results.push(buildStream(`${label} - ${text} ${header} ${size}`.trim(), direct, entryUrl));
                }
            } catch {
                // Ignore malformed mirrors independently.
            }
            return;
        }
        if (isDirectMedia(link, `${text} ${header}`) || /(?:download file|fsl|s3 server|mega server|pdl server|buzzserver)/i.test(text)) {
            results.push(buildStream(`${label} - ${text} ${header} ${size}`.trim(), link, entryUrl));
        }
    });
    return results;
}

async function resolveLink(rawUrl, label, referer = '', depth = 0) {
    if (!rawUrl || depth > 4) return [];
    let url = rawUrl;
    if (/[?&]id=/i.test(url)) url = await resolveRedirect(url) || url;
    if (!validHttpUrl(url)) return [];
    if (isDirectMedia(url, label)) return [buildStream(label, url, referer)];

    const hostname = new URL(url).hostname.toLowerCase();
    try {
        if (hostname.includes('hubdrive')) {
            const response = await client.get(url);
            const $ = cheerio.load(String(response.data));
            const next = $('a.btn.btn-primary.btn-user.btn-success1.m-1').attr('href');
            return next ? resolveLink(fixUrl(next, url), `${label} - HubDrive`, url, depth + 1) : [];
        }
        if (hostname.includes('hubcloud')) return resolveHubcloud(url, label, referer);
        if (hostname.includes('hubcdn')) {
            const response = await client.get(url, { headers: { Referer: referer || url } });
            const html = String(response.data);
            const encoded = html.match(/r=([A-Za-z0-9+/=]+)/)?.[1]
                || html.match(/reurl\s*=\s*"([^"]+)"/)?.[1]?.split('?r=').pop();
            if (!encoded) return [];
            const decoded = Buffer.from(encoded, 'base64').toString('utf8').split('link=').pop();
            return validHttpUrl(decoded) ? [buildStream(`${label} - HubCDN`, decoded, url)] : [];
        }
        if (hostname.includes('hblinks')) {
            const response = await client.get(url);
            const $ = cheerio.load(String(response.data));
            const nested = [];
            $('h3 a[href], h5 a[href], div.entry-content p a[href]').each((_, element) => {
                const link = fixUrl($(element).attr('href'), url);
                if (link) nested.push(link);
            });
            const settled = await Promise.allSettled(
                [...new Set(nested)].map(link => resolveLink(link, `${label} - HBLinks`, url, depth + 1))
            );
            return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        }
    } catch (error) {
        console.warn(`[4KHDHub] ${hostname} extraction failed: ${error.message}`);
    }
    return [];
}

async function get4KHDHubStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    if (type === 'tv' && (!season || !episode)) return [];
    try {
        const details = await getTmdbDetails(tmdbId, type);
        if (!details.title) return [];
        let match = await searchContent(details.title, details, type, season);
        if (!match && details.originalTitle && details.originalTitle !== details.title) {
            match = await searchContent(details.originalTitle, details, type, season);
        }
        if (!match) {
            console.log(`[4KHDHub] No confident match for ${type} TMDB ${tmdbId}`);
            return [];
        }

        const response = await client.get(match.url);
        const links = collectPageLinks(String(response.data), match.url, type, season, episode);
        console.log(`[4KHDHub] Matched title; detected ${links.length} source links`);
        const settled = await Promise.allSettled(
            links.map(item => resolveLink(item.url, item.label || DISPLAY_NAME, match.url))
        );
        const streams = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
        const seen = new Set();
        const unique = streams
            .filter(stream => validHttpUrl(stream.url) && !seen.has(stream.url) && seen.add(stream.url))
            .filter(stream => /fsl/i.test(stream.title || ''))
            .sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
        console.log(`[4KHDHub] Returning ${unique.length} streams`);
        return unique;
    } catch (error) {
        console.error(`[4KHDHub] Provider failed: ${error.message}`);
        return [];
    }
}

module.exports = {
    get4KHDHubStreams,
    _test: { normalizeTitle, titleScore, collectPageLinks, decodeRedirectPayload, parseQuality, isDirectMedia }
};
