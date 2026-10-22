const { getTmdbApiKey } = require('../utils/tmdbKey');

// Detailed request logging with complete, unredacted URLs (local debugging).
// Set PROVIDER_LOG_REDACT=1 to force redaction back on.
const diagnostics = require('../utils/providerTrace').createProviderTrace('MoviesHunt', { redact: false });
const tracedFetch = diagnostics.fetch;
const PROVIDER = 'MoviesHunt';
const BASE_URL = 'https://movieshunt.icu';
const TMDB_API = "https://api.themoviedb.org/3";
const ABHL_URL = 'https://abhilinks.site';
const Q_KEEP = new Set(['1080P', '2160P']);
const USER_AGENTS = [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36',
];

function randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function resWeight(quality) {
    const q = (quality || '').toUpperCase();
    if (q === '4K' || q === '2160P') return 5;
    if (q === '1440P') return 4;
    if (q === '1080P') return 3;
    if (q === '720P') return 2;
    if (q === '480P') return 1;
    return 0;
}

function sortTag(quality) {
    let inv = 5 - resWeight(quality);
    let bin = inv.toString(2);
    while (bin.length < 20) bin = '0' + bin;
    return bin.split('').map(b => b === '1' ? '\uFEFF' : '\u200B').join('');
}

function hdrs(ua, extra) {
    return Object.assign({
        'User-Agent': ua,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }, extra || {});
}

async function fetchText(url, options) {
    try {
        const res = await tracedFetch(url, options || {});
        if (res && res.ok) return await res.text();
    } catch { /* upstream failure - fall through to null */ }
    return null;
}

async function fetchJson(url, options) {
    try {
        const res = await tracedFetch(url, options || {});
        if (res && res.ok) return await res.json();
    } catch { /* upstream failure - fall through to null */ }
    return null;
}

async function getTMDBInfo(tmdbId, mediaType, ua) {
    if (!getTmdbApiKey()) return null;
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    return fetchJson(
        `${TMDB_API}/${endpoint}/${tmdbId}?api_key=${getTmdbApiKey()}&language=en-US`,
        { headers: { 'User-Agent': ua } }
    );
}

function firstSuccess(promises, isEmpty) {
    return new Promise((resolve, reject) => {
        let pending = promises.length;
        if (!pending) return reject(null);
        for (const p of promises) {
            Promise.resolve(p).then(val => {
                if (!isEmpty(val)) resolve(val);
                else if (--pending === 0) reject(null);
            }).catch(() => { if (--pending === 0) reject(null); });
        }
    });
}

async function searchSite(query, ua) {
    const queries = [query.replace(/'/g, '').trim()];
    const collected = [];
    const addResults = items => {
        if (!Array.isArray(items)) return;
        collected.push(...items.map(item => ({
            title: (item.title?.rendered || item.title || item.name || '').replace(/<[^>]+>/g, '').trim(),
            url: item.link || item.url || item.slug || null,
        })).filter(result => result.title.length > 5 && result.url));
    };
    const cleaned = query.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned !== queries[0]) queries.push(cleaned);
    const noYear = cleaned.replace(/\s*\d{4}\s*/g, ' ').trim();
    if (noYear && !queries.includes(noYear)) queries.push(noYear);
    const words = cleaned.split(' ').filter(w => w.length > 2);
    const wordsCopy = words.slice();
    while (wordsCopy.length > 1) {
        wordsCopy.pop();
        const partial = wordsCopy.join(' ');
        if (partial.length > 3 && !queries.includes(partial)) queries.push(partial);
    }
    if (cleaned) {
        const parts = cleaned.split(' ');
        if (parts.length > 1) {
            const lastTwo = parts.slice(-Math.min(2, parts.length)).join(' ');
            if (lastTwo.length > 3 && !queries.includes(lastTwo)) queries.push(lastTwo);
            const lastWord = parts[parts.length - 1];
            if (lastWord.length > 3 && /[a-zA-Z]/.test(lastWord) && !queries.includes(lastWord))
                queries.push(lastWord);
        }
    }

    for (const q of queries.filter(x => x.length >= 3)) {
        const data = await fetchJson(
            `${BASE_URL}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=10`,
            { headers: hdrs(ua) }
        );
        if (data && data.length) {
            addResults(data);
            continue;
        }
        const lookup = await fetchJson(
            `${BASE_URL}/lookup.php?q=${encodeURIComponent(q)}&page=1&per_page=30`,
            { headers: hdrs(ua) }
        );
        if (lookup && lookup.length) addResults(lookup);
    }
    const seen = new Set();
    return collected.filter(result => {
        if (seen.has(result.url)) return false;
        seen.add(result.url);
        return true;
    });
}

const STOP_WORDS = new Set(['and', '&', 'the', 'a', 'an']);
const STOP_WORDS_RE = /\b(and|&|the|a|an)\b/g;

function normalizeTitleText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
}

function tokenizeTitle(text) {
    return String(text || '')
        .split(/[^a-z0-9']+/i)
        .map(word => word.toLowerCase())
        .filter(Boolean);
}

// "Marvel's The Punisher" -> "The Punisher"; sites usually drop the franchise prefix.
function buildTitleVariants(title) {
    const variants = [];
    const push = value => {
        const trimmed = String(value || '').trim();
        if (!trimmed) return;
        if (!variants.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) {
            variants.push(trimmed);
        }
    };
    push(title);
    const possessive = String(title || '').match(/^[\w'’.-]+['’][\w'’.-]*\s+(.+)$/);
    if (possessive) push(possessive[1]);
    return variants;
}

// Word-boundary aware containment so short titles do not match inside unrelated words.
function containsPhrase(haystack, needle) {
    if (!needle) return false;
    if (haystack === needle) return true;
    let from = 0;
    for (;;) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) return false;
        const before = idx === 0 ? ' ' : haystack[idx - 1];
        const end = idx + needle.length;
        const after = end >= haystack.length ? ' ' : haystack[end];
        if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
        from = idx + 1;
    }
}

function extractYears(text) {
    const years = [];
    const yearRegex = /\b(19|20)\d{2}\b/g;
    let match;
    while ((match = yearRegex.exec(String(text || ''))) !== null) years.push(match[0]);
    return years;
}

function scoreAgainstVariant(resultLower, resultTokens, variantLower) {
    if (resultLower === variantLower) return 100;
    if (containsPhrase(resultLower, variantLower)) return 50;
    if (variantLower.includes(resultLower)) return 50;

    const resultNoStops = resultLower.replace(STOP_WORDS_RE, '').replace(/\s+/g, ' ').trim();
    const variantNoStops = variantLower.replace(STOP_WORDS_RE, '').replace(/\s+/g, ' ').trim();
    if (variantNoStops && (resultNoStops.includes(variantNoStops) || variantNoStops.includes(resultNoStops))) {
        return 50;
    }
    const normalizedResult = resultNoStops.replace(/[^a-z0-9\s]/g, '').trim();
    const normalizedVariant = variantNoStops.replace(/[^a-z0-9\s]/g, '').trim();
    if (normalizedVariant && normalizedResult === normalizedVariant) return 60;

    // Fall back to distinctive (non stop-word) token overlap.
    const distinctive = tokenizeTitle(variantLower).filter(word => word.length > 1 && !STOP_WORDS.has(word));
    if (!distinctive.length) return 0;
    const needed = Math.min(distinctive.length, 3);
    let hits = 0;
    for (const word of distinctive) {
        for (const resultWord of resultTokens) {
            if (resultWord === word || (word.length >= 5 && resultWord.startsWith(word))) { hits++; break; }
        }
    }
    return hits >= needed ? 50 : 0;
}

function matchHits(results, tmdbInfo, isSeries) {
    const tmdbTitle = (isSeries ? tmdbInfo.name : tmdbInfo.title) || '';
    const tmdbYear = isSeries
        ? (tmdbInfo.first_air_date || '').split('-')[0]
        : (tmdbInfo.release_date || '').split('-')[0];

    const variants = buildTitleVariants(tmdbTitle);
    diagnostics.log('match.variants', { title: tmdbTitle, variants });

    const scored = [];
    const seen = {};

    for (const result of results) {
        const resultTitle = result.title || '';
        const resultUrl = result.url || '';
        if (seen[resultUrl]) continue;
        seen[resultUrl] = true;

        const looksLikeMovie = /\b(?:full\s+movie|movie|bluray)\b/i.test(resultTitle)
            && !/\b(?:season|web\s+series|tv\s+series|series)\b/i.test(resultTitle);
        if (isSeries && looksLikeMovie) {
            diagnostics.log('match.rejected', { title: resultTitle, url: resultUrl, reason: 'looks-like-movie' });
            continue;
        }

        const resultLower = normalizeTitleText(resultTitle);
        const resultTokens = tokenizeTitle(resultTitle);
        let score = 0;
        let bestVariant = '';
        for (const variant of variants) {
            const variantScore = scoreAgainstVariant(resultLower, resultTokens, normalizeTitleText(variant));
            if (variantScore > score) {
                score = variantScore;
                bestVariant = variant;
            }
        }

        const resultYears = extractYears(resultTitle);
        let yearPenalty = 0;
        if (tmdbYear && resultYears.length) {
            const yearMatches = resultYears.some(year => Math.abs(parseInt(year, 10) - parseInt(tmdbYear, 10)) <= 1);
            if (yearMatches) score += 10;
            else {
                score -= 60;
                yearPenalty = -60;
            }
        }

        diagnostics.log('match.candidate', {
            title: resultTitle,
            url: resultUrl,
            score,
            variant: bestVariant,
            tmdbYear: tmdbYear || '',
            resultYears: resultYears.join(','),
            yearPenalty,
        });

        if (score >= 50) scored.push({ doc: result, score, year: resultYears[0] || '' });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(s => Object.assign({}, s.doc, { year: s.year }));
}

function extractAbhilinksUrl(html) {
    const btnMatch = html.match(/<a[^>]*href="(https:\/\/abhilinks\.(?:life|site)\/[^"]+)"[^>]*class="btn"[^>]*>/i);
    if (btnMatch) return btnMatch[1];
    const anyMatch = html.match(/<a[^>]*href="(https:\/\/abhilinks\.(?:life|site)\/[^"]+)"[^>]*>/i);
    if (anyMatch) return anyMatch[1];
    return null;
}

function extractQualityOptions(html) {
    const options = [];
    const qualityRegex = /(2160|1080|720|480)[pP](?:\s+\w{1,15})?\s*\[([^\]]+)\]/g;
    let match;
    while ((match = qualityRegex.exec(html)) !== null) {
        const quality = match[1] + 'P';
        const size = match[2];
        if (quality === '480P') continue;
        const context = html.substring(Math.max(0, match.index - 200), match.index + 600);
        const hubcloudMatch = context.match(/href="(https:\/\/hubcloud\.ist\/(?:drive|video)\/[^"]+)"/i);
        const vcloudMatch = context.match(/href="(https:\/\/href\.li\/\?https:\/\/vcloud\.fit\/[^"]+)"/i);
        if (hubcloudMatch) options.push({ quality, size, type: 'hubcloud', url: hubcloudMatch[1] });
        else if (vcloudMatch) options.push({ quality, size, type: 'vcloud', url: vcloudMatch[1] });
    }
    return options;
}

function extractVcloudUrl(raw) {
    const match = raw.match(/href\.li\/\?https:\/\/vcloud\.fit\/([^"&?]+)/i);
    if (match) return 'https://vcloud.fit/' + match[1];
    return null;
}

function extractR2Links(html) {
    const links = [];
    const anchorMatches = html.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
    if (!anchorMatches) return links;
    for (const anchor of anchorMatches) {
        const hrefMatch = anchor.match(/href="([^"]+)"/i);
        const textMatch = anchor.match(/>([\s\S]*?)<\/a>/i);
        if (!hrefMatch) continue;
        const url = hrefMatch[1].replace(/&amp;/g, '&');
        const text = textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : '';
        if (!url || url.startsWith('javascript:')) continue;
        if (/telegram/i.test(text) || /tg\//i.test(url) || /pixeldrain/i.test(url)) continue;
        if (!/r2\.cloudflarestorage/i.test(url)) continue;
        const qualityMatch = text.match(/(2160|1080|720|480)\s*[pP]/i);
        const quality = qualityMatch ? qualityMatch[1] + 'P' : '';
        links.push({ url, quality });
    }
    return links;
}

function extractEpisodes(html) {
    const episodes = [];
    const markers = [];
    const markerRegex = /-:\s*Episodes?\s*:\s*(\d+)\s*:-/gi;
    let match;
    while ((match = markerRegex.exec(html)) !== null)
        markers.push({ num: parseInt(match[1], 10), idx: match.index });

    if (markers.length === 0) {
        const fallback = />\s*Episode\s*(\d+)\s*</gi;
        while ((match = fallback.exec(html)) !== null)
            markers.push({ num: parseInt(match[1], 10), idx: match.index });
    }

    for (let i = 0; i < markers.length; i++) {
        const start = markers[i].idx;
        const end = i + 1 < markers.length ? markers[i + 1].idx : html.length;
        const segment = html.substring(start, end);
        const links = [];
        const hubcloudRegex = /href="(https:\/\/hubcloud\.ist\/(?:drive|video)\/[^"]+)"/gi;
        while ((match = hubcloudRegex.exec(segment)) !== null)
            links.push({ type: 'hubcloud', url: match[1] });
        const vcloudRegex = /href="(https:\/\/href\.li\/\?https:\/\/vcloud\.fit\/[^"]+)"/gi;
        while ((match = vcloudRegex.exec(segment)) !== null) {
            const vUrl = extractVcloudUrl(match[1]);
            if (vUrl) links.push({ type: 'vcloud', url: vUrl });
        }
        const sizeMatch = segment.match(/\[(\d+(?:\.\d+)?\s*(?:GB|MB))\]/i);
        const size = sizeMatch ? sizeMatch[1] : '';
        if (links.length) episodes.push({ number: markers[i].num, links, size });
    }
    return episodes;
}

function extractSeasonLinks(html) {
    const seasons = {};
    const h4Regex = /<h4[^>]*>([\s\S]*?)<\/h4>/gi;
    const h4s = [];
    let match;
    while ((match = h4Regex.exec(html)) !== null)
        h4s.push({ inner: match[1], start: match.index, end: match.index + match[0].length });

    for (let i = 0; i < h4s.length; i++) {
        const { inner, end: sectionStart } = h4s[i];
        const seasonMatch = inner.match(/Season\s+(\d+)/i);
        const qualityMatch = inner.match(/(\d+p)/i);
        if (!seasonMatch || !qualityMatch) continue;
        const seasonNum = parseInt(seasonMatch[1], 10);
        const quality = qualityMatch[1].toUpperCase();
        const sectionEnd = i + 1 < h4s.length ? h4s[i + 1].start : html.length;
        const segment = html.substring(sectionStart, sectionEnd);
        const abhiMatch = segment.match(/href="(https:\/\/abhilinks\.(?:life|site)\/archives\/\d+)\/?"/i);
        if (abhiMatch) {
            if (!seasons[seasonNum]) seasons[seasonNum] = {};
            if (!seasons[seasonNum][quality]) seasons[seasonNum][quality] = abhiMatch[1];
        }
    }
    return seasons;
}

async function processHubcloud(url, ua) {
    const html = await fetchText(url, { headers: hdrs(ua, { 'Referer': `${ABHL_URL}/` }) });
    if (!html) return null;

    const direct = extractR2Links(html);
    if (direct && direct.length) return direct;

    const phpMatch = html.match(/href="(https:\/\/[^"]*hubcloud\.php[^"]*)"/i);
    if (!phpMatch) return null;
    const phpUrl = phpMatch[1].replace(/&amp;/g, '&');
    const phpHtml = await fetchText(phpUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': url,
            'DNT': '1',
            'Cookie': 'xla=s4t',
        },
    });
    if (!phpHtml || phpHtml.length < 500) return null;
    return extractR2Links(phpHtml);
}

async function processVcloud(url, ua) {
    const html = await fetchText(url, { headers: hdrs(ua, { 'Referer': `${ABHL_URL}/` }) });
    if (!html) return null;
    const atobMatch = html.match(/atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/);
    if (!atobMatch) return null;
    let decoded;
    try { decoded = atob(atob(atobMatch[1])); } catch { return null; }
    const innerHtml = await fetchText(decoded, {
        headers: hdrs(ua, { 'Referer': `${BASE_URL}/`, 'Cookie': 'xla=s4t' }),
    });
    if (!innerHtml) return null;
    return extractR2Links(innerHtml);
}

function dedupe(arr) {
    const seen = new Set();
    return (arr || []).filter(item => {
        if (!item || !item.url) return false;
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });
}

async function resolveMatch(postUrl, isSeries, seasonNum, episodeNum, ua) {
    const postHtml = await fetchText(postUrl, { headers: hdrs(ua) });
    if (!postHtml) return [];

    let streams = [];

    if (isSeries) {
        const qualityEntries = [];

        if (seasonNum) {
            const seasonLinks = extractSeasonLinks(postHtml);
            if (seasonLinks[seasonNum]) {
                const qualities = Object.keys(seasonLinks[seasonNum]).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
                qualities.forEach(q => qualityEntries.push({ quality: q, url: seasonLinks[seasonNum][q] }));
            }
        }

        if (!qualityEntries.length) {
            const abhiUrl = extractAbhilinksUrl(postHtml);
            if (abhiUrl) qualityEntries.push({ quality: '', url: abhiUrl });
        }
        if (!qualityEntries.length) return [];

        const abhiHtmls = await Promise.all(
            qualityEntries.map(e => fetchText(e.url, { headers: hdrs(ua) }))
        );

        const tasks = [];
        for (let ei = 0; ei < qualityEntries.length; ei++) {
            const abhiHtml = abhiHtmls[ei];
            if (!abhiHtml) continue;
            const entry = qualityEntries[ei];
            const allEpisodes = extractEpisodes(abhiHtml);
            if (!allEpisodes.length) continue;
            const filtered = episodeNum ? allEpisodes.filter(ep => ep.number === episodeNum) : allEpisodes;
            if (episodeNum && !filtered.length) continue;

            for (const ep of filtered) {
                for (const link of ep.links) {
                    const epSize = ep.size;
                    tasks.push(async () => {
                        let r2Links = null;
                        if (link.type === 'hubcloud') r2Links = await processHubcloud(link.url, ua);
                        else if (link.type === 'vcloud') r2Links = await processVcloud(link.url, ua);
                        if (r2Links) r2Links.forEach(l => {
                            l.quality = l.quality || entry.quality;
                            l.size = epSize || '';
                        });
                        return r2Links;
                    });
                }
            }
        }

        if (!tasks.length) return [];
        const results = await Promise.all(tasks.map(t => t()));
        for (const group of results) {
            if (!group) continue;
            for (const item of group) {
                if (!Q_KEEP.has(item.quality)) continue;
                const sizePart = item.size ? ` \u2022 ${item.size}` : '';
                const name = `${PROVIDER} \u2022 ${item.quality.toLowerCase()}${sizePart}`;
                streams.push({
                    name,
                    title: name,
                    url: item.url,
                    quality: item.quality || '',
                    size: item.size || '',
                    headers: { 'Referer': `${BASE_URL}/`, 'User-Agent': ua },
                });
            }
        }
    } else {
        const abhiUrl = extractAbhilinksUrl(postHtml);
        if (!abhiUrl) return [];

        const abhiHtml = await fetchText(abhiUrl, { headers: hdrs(ua) });
        if (!abhiHtml) return [];

        const qualityOptions = extractQualityOptions(abhiHtml);
        if (!qualityOptions.length) return [];

        const results = await Promise.all(qualityOptions.map(opt => {
            if (opt.type === 'hubcloud') return processHubcloud(opt.url, ua);
            if (opt.type === 'vcloud') {
                const vUrl = extractVcloudUrl(opt.url);
                return vUrl ? processVcloud(vUrl, ua) : Promise.resolve(null);
            }
            return Promise.resolve(null);
        }));

        for (let i = 0; i < results.length; i++) {
            if (!results[i]) continue;
            const opt = qualityOptions[i];
            for (const item of results[i]) {
                const quality = item.quality || opt.quality;
                if (!Q_KEEP.has(quality)) continue;
                const sizePart = opt.size ? ` \u2022 ${opt.size}` : '';
                const name = `${PROVIDER} \u2022 ${quality.toLowerCase()}${sizePart}`;
                streams.push({
                    name,
                    title: name,
                    url: item.url,
                    quality,
                    size: opt.size || '',
                    headers: { 'Referer': `${BASE_URL}/`, 'User-Agent': ua },
                });
            }
        }
    }

    streams = dedupe(streams);
    streams.sort((a, b) => resWeight(b.quality) - resWeight(a.quality));
    streams = streams.map(s => {
        const tag = sortTag(s.quality);
        return Object.assign({}, s, { name: tag + s.name, title: tag + s.title });
    });

    return streams;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const args = [tmdbId, mediaType, season, episode];
    return diagnostics.run(() => getStreamsImpl(...args), args);
}

async function getStreamsImpl(tmdbId, mediaType, season, episode) {
    try {
        const ua = randomUA();
        const isSeries = mediaType === 'tv';

        if (isSeries && (season == null || episode == null)) {
            diagnostics.log('request.rejected', { tmdbId, mediaType, season, episode });
            return [];
        }

        const seasonNum = isSeries && season != null ? parseInt(season, 10) : null;
        const episodeNum = isSeries && episode != null ? parseInt(episode, 10) : null;

        const tmdbInfo = await getTMDBInfo(tmdbId, mediaType, ua);
        if (!tmdbInfo) {
            diagnostics.log('abort.no_tmdb', { tmdbId, mediaType });
            return [];
        }

        const title = isSeries ? tmdbInfo.name : tmdbInfo.title;
        if (!title) {
            diagnostics.log('abort.no_title', { tmdbId, mediaType });
            return [];
        }
        diagnostics.log('tmdb.resolved', { tmdbId, mediaType, title, year: tmdbInfo.year });

        const searchResults = await searchSite(title, ua);
        diagnostics.log('search.results', { title, count: (searchResults || []).length });
        if (!searchResults || !searchResults.length) {
            diagnostics.log('abort.no_results', { tmdbId, title });
            return [];
        }

        const matches = matchHits(searchResults, tmdbInfo, isSeries);
        diagnostics.log('search.matches', {
            title,
            count: matches.length,
            matches: matches.map(m => ({ url: m.url, title: m.title, year: m.year }))
        });
        if (!matches.length) {
            diagnostics.log('abort.no_matches', { tmdbId, title });
            return [];
        }

        try {
            const streams = await firstSuccess(
                matches.map(m => resolveMatch(m.url, isSeries, seasonNum, episodeNum, ua)),
                val => !val || !val.length
            );
            const list = Array.isArray(streams) ? streams : [];
            diagnostics.log('streams.resolved', {
                count: list.length,
                streams: list.map(s => ({ name: s.name, quality: s.quality, url: s.url }))
            });
            return streams;
        } catch (error) {
            diagnostics.log('resolve.failed', { tmdbId, title, error: error?.message || String(error || 'unknown error') });
            return [];
        }
    } catch (error) {
        diagnostics.log('extract.error', { tmdbId, mediaType, season, episode, error: error.message });
        return [];
    }
}

module.exports = { getStreams };
