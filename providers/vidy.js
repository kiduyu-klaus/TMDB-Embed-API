const { getTmdbApiKey } = require('../utils/tmdbKey');

// Detailed request logging with complete, unredacted URLs (local debugging).
// Set PROVIDER_LOG_REDACT=1 to force redaction back on.
const diagnostics = require('../utils/providerTrace').createProviderTrace('Vidy', { redact: false });
const tracedFetch = diagnostics.fetch;

const PROVIDER = 'Vidy';
const BASE_URL = 'https://www.vidy.st';
const API_BASE = 'https://api.wecollege.net';
const TMDB_API = 'https://api.themoviedb.org/3';
const REFERER = BASE_URL + '/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
const Q_RANK = { '2160p': 2, '1080p': 1, 'Auto': 0 };
const HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
    'Referer': REFERER,
    'Origin': BASE_URL
};
const P_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': REFERER,
    'Origin': BASE_URL
};
const SERVERS = [
    { slug: 'atlanta', display: 'Atlanta', langNote: 'English' },
    { slug: 'austin', display: 'Austin', langNote: 'English' },
    { slug: 'berlin', display: 'Berlin', langNote: 'German' },
    { slug: 'boise', display: 'Boise', langNote: 'English' },
    { slug: 'delhi', display: 'Delhi', langNote: 'Hindi' },
    { slug: 'miami', display: 'Miami', langNote: 'English' },
    { slug: 'munich', display: 'Munich', langNote: 'German' },
    { slug: 'phoenix', display: 'Phoenix', langNote: 'English' },
    { slug: 'reno', display: 'Reno', langNote: 'English' },
    { slug: 'seattle', display: 'Seattle', langNote: 'English' }
];

async function safeFetch(url, options) {
    try {
        return await tracedFetch(url, options);
    } catch (e) {
        diagnostics.log('request.failed', { url, error: e && e.message });
        return null;
    }
}

async function getJson(url) {
    const res = await safeFetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    if (!res || res.status !== 200) return null;
    try {
        return await res.json();
    } catch (e) {
        return null;
    }
}

function javaEncode(text) {
    return encodeURIComponent(text)
        .replace(/[!'()~]/g, function (c) {
            return '%' + c.charCodeAt(0).toString(16).toUpperCase();
        })
        .replace(/%20/g, '+');
}

function titleOnWire(title) {
    return javaEncode(title).replace(/\+/g, '%20').replace(/%/g, '%25');
}

function fmix(value) {
    let v = value | 0;
    v ^= v >>> 16;
    v = Math.imul(v, 0x85ebca6b);
    v ^= v >>> 13;
    v = Math.imul(v, 0xc2b2ae35);
    v ^= v >>> 16;
    return v | 0;
}

function rotl(value, shift) {
    const s = shift & 31;
    if (s === 0) return value | 0;
    return ((value << s) | (value >>> (32 - s))) | 0;
}

function mod61(value) {
    return (value >>> 0) % 61;
}

function fnv1aMixed(text) {
    let hash = -2128831035;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x1000193);
    }
    return fmix(hash);
}

function toUint32(text) {
    const parsed = Number(String(text).trim());
    if (!isFinite(parsed)) return 0;
    return (Math.trunc(parsed) >>> 0) | 0;
}

function initState(seed, mediaId) {
    const slots = new Array(61).fill(0);
    const filled = new Array(61).fill(false);
    let n = fmix(fnv1aMixed(seed) ^ fmix(toUint32(mediaId) ^ -1640531527));
    for (let round = 0; round < 8; round++) {
        const slot = mod61(n);
        n = rotl((n - 1640531527) | 0, 7 + (7 & round));
        slots[slot] = n ^ fmix(n);
        filled[slot] = true;
        n = fmix((n + slot) | 0);
    }
    return { slots: slots, filled: filled, acc: fmix(0xa5a5a5a5 ^ n) };
}

function nextWord(state, counter) {
    const slot = mod61(state.acc);
    const known = state.filled[slot];
    const picked = known ? state.slots[slot] : 0;
    const salt = picked ^ Math.imul(-1640531527, counter + 1);
    const acc = state.acc;
    const blended = known ? (acc | salt) : (acc ^ salt);
    const rotated = rotl((blended + acc) | 0, slot & 31) ^ rotl(acc, 31 & (slot * 7));
    const word = fmix((rotated - 1640531527) | 0);
    state.slots[slot] = word;
    state.filled[slot] = true;
    state.acc = word;
    return word;
}

function keystream(seed, mediaId, length) {
    const state = initState(seed, mediaId);
    const out = new Array(length);
    let index = 0;
    let counter = 0;
    while (index < length) {
        const word = nextWord(state, counter++);
        out[index++] = word & 0xff;
        if (index < length) out[index++] = (word >>> 8) & 0xff;
        if (index < length) out[index++] = (word >>> 16) & 0xff;
        if (index < length) out[index++] = (word >>> 24) & 0xff;
    }
    return out;
}

function decodeBase64Url(payload) {
    let text = String(payload).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    while (text.length % 4 !== 0) text += '=';
    const bin = atob(text);
    const bytes = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
    return bytes;
}

function utf8Decode(bytes, start) {
    let out = '';
    let i = start;
    while (i < bytes.length) {
        const b = bytes[i++];
        let cp;
        if (b < 0x80) {
            cp = b;
        } else if (b >= 0xc0 && b < 0xe0 && i < bytes.length) {
            cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
        } else if (b >= 0xe0 && b < 0xf0 && i + 1 < bytes.length) {
            cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else if (b >= 0xf0 && i + 2 < bytes.length) {
            cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) |
                ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
        } else {
            cp = 0xfffd;
        }
        if (cp > 0xffff) {
            cp -= 0x10000;
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
        } else {
            out += String.fromCharCode(cp);
        }
    }
    return out;
}

function decrypt(payload, seed, mediaId) {
    try {
        const raw = decodeBase64Url(payload);
        if (raw.length <= 4) return null;
        const mask = keystream(seed, mediaId, raw.length);
        const plain = new Array(raw.length);
        for (let i = 0; i < raw.length; i++) plain[i] = (raw[i] ^ mask[i]) & 0xff;
        if (plain[0] !== 109 || plain[1] !== 118 || plain[2] !== 109 || plain[3] !== 49) return null;
        return utf8Decode(plain, 4);
    } catch (e) {
        return null;
    }
}

function SeedPool(mediaId) {
    this.mediaId = mediaId;
    this.seed = null;
    this.expiresAt = 0;
    this.queue = Promise.resolve();
}

SeedPool.prototype.drop = function () {
    this.seed = null;
};

SeedPool.prototype.current = function () {
    const self = this;
    const run = this.queue.then(function () {
        if (self.seed !== null && Date.now() < self.expiresAt) return self.seed;
        return self.fetchSeed();
    });
    this.queue = run.then(function () { }, function () { });
    return run.catch(function () {
        return null;
    });
};

SeedPool.prototype.fetchSeed = async function () {
    let rateLimited = 0;
    for (; ;) {
        const res = await safeFetch(API_BASE + '/seed?mediaId=' + this.mediaId, { headers: HEADERS });
        if (!res) return null;
        if (res.status === 200) {
            let reply = null;
            try {
                reply = await res.json();
            } catch (e) {
                reply = null;
            }
            const fresh = reply && typeof reply.seed === 'string' && reply.seed ? reply.seed : null;
            if (!fresh) return null;
            this.seed = fresh;
            this.expiresAt = Date.now() - 5000 + (Number(reply.ttlMs) || 30000);
            diagnostics.log('seed.resolved', { mediaId: this.mediaId, seed: fresh, ttlMs: reply.ttlMs });
            return fresh;
        }
        if (res.status === 429 && rateLimited < 1) {
            rateLimited++;
            continue;
        }
        diagnostics.log('seed.failed', { mediaId: this.mediaId, status: res.status });
        return null;
    }
};

function buildUrl(city, req, seed) {
    let q = 'title=' + titleOnWire(req.title);
    q += '&mediaType=' + req.mediaType;
    q += '&year=' + req.year;
    q += '&episodeId=' + req.episode;
    q += '&seasonId=' + req.season;
    q += '&tmdbId=' + req.tmdbId;
    if (req.imdbId) q += '&imdbId=' + req.imdbId;
    if (city.slug === 'munich') q += '&language=german';
    if (city.slug === 'berlin' && req.germanTitle) q += '&altTitle=' + titleOnWire(req.germanTitle);
    q += '&enc=2&seed=' + javaEncode(seed);
    return API_BASE + '/' + city.slug + '/sources?' + q;
}

async function citySources(city, req, pool) {
    let transportRetries = 1;
    let staleStrikes = 0;
    let coolDowns = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
        const seed = await pool.current();
        if (!seed) return null;
        const url = buildUrl(city, req, seed);
        diagnostics.log('server.request', { server: city.slug, url });
        const res = await safeFetch(url, { headers: HEADERS });
        if (!res) {
            if (transportRetries > 0) {
                transportRetries--;
                continue;
            }
            return null;
        }
        const code = res.status;
        if (code === 200) {
            let body = null;
            try {
                body = await res.text();
            } catch (e) {
                body = null;
            }
            const plain = body ? decrypt(body, seed, req.tmdbId) : null;
            if (plain === null) {
                staleStrikes++;
                if (staleStrikes >= 2) {
                    pool.drop();
                    staleStrikes = 0;
                }
                continue;
            }
            try {
                return JSON.parse(plain);
            } catch (e) {
                return null;
            }
        } else if (code === 401) {
            staleStrikes++;
            if (staleStrikes >= 3) {
                pool.drop();
                staleStrikes = 0;
            }
        } else if (code === 429) {
            if (coolDowns >= 1) return null;
            coolDowns++;
            pool.drop();
        } else {
            diagnostics.log('server.http_error', { server: city.slug, status: code });
            return null;
        }
    }
    return null;
}

async function loadMeta(tmdbId, mediaType) {
    const tmdbKey = getTmdbApiKey();
    if (!tmdbKey) {
        diagnostics.log('abort.no_tmdb_key', { tmdbId, mediaType });
        return null;
    }
    const kind = mediaType === 'tv' ? 'tv' : 'movie';
    const base = TMDB_API + '/' + kind + '/' + tmdbId;
    const results = await Promise.all([
        getJson(base + '?api_key=' + tmdbKey + '&language=en&append_to_response=external_ids'),
        getJson(base + '/translations?api_key=' + tmdbKey)
    ]);
    const d = results[0];
    if (!d) return null;
    const title = String((kind === 'tv' ? d.name : d.title) || '').trim();
    if (!title) return null;
    const date = (kind === 'tv' ? d.first_air_date : d.release_date) || '';
    const year = /^\d{4}/.test(date) ? date.slice(0, 4) : '0';
    const imdbId = d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || '';

    let germanTitle = null;
    const list = results[1] && results[1].translations;
    if (Array.isArray(list)) {
        const de = list.find(function (t) {
            return t && t.iso_639_1 === 'de';
        });
        const data = de && de.data;
        const german = data && String(data.title || data.name || '').trim();
        if (german && german !== title) germanTitle = german;
    }
    diagnostics.log('tmdb.resolved', { tmdbId, mediaType, title, year, imdbId, germanTitle });
    return { title: title, year: year, imdbId: imdbId, germanTitle: germanTitle };
}

function bucket(height) {
    if (height >= 2000) return '2160p';
    if (height >= 1000) return '1080p';
    return 'Auto';
}

function qualityFromLabel(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    if (/\bauto\b/.test(t)) return 'Auto';
    if (/\b4k\b|\buhd\b/.test(t)) return '2160p';
    const m = t.match(/(?<![0-9a-z])(\d{3,4})p?(?![0-9a-z])/);
    if (m) return bucket(parseInt(m[1], 10));
    if (/\bfull\s*hd\b|\bfhd\b|\bhd\b/.test(t)) return '1080p';
    if (/\bsd\b/.test(t)) return 'Auto';
    return null;
}

function qualityFromUrl(url) {
    const m = String(url).toLowerCase().match(/(?<![0-9a-z])(2160|1440|1080|720|480|360)p?(?![0-9a-z])/);
    return m ? bucket(parseInt(m[1], 10)) : null;
}

async function probeQuality(record) {
    record.quality = 'Auto';
    const res = await safeFetch(record.url, { headers: P_HEADERS });
    if (!res || res.status !== 200) return;
    let text = '';
    try {
        text = await res.text();
    } catch (e) {
        return;
    }
    const re = /RESOLUTION=(\d+)x(\d+)/g;
    let best = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        const equivalent = Math.max(parseInt(m[2], 10), Math.round(parseInt(m[1], 10) * 9 / 16));
        if (equivalent > best) best = equivalent;
    }
    if (best > 0) record.quality = bucket(best);
}

function collectSubtitles(city, reply, seen) {
    const out = [];
    const subs = reply && Array.isArray(reply.subtitles) ? reply.subtitles : [];
    subs.forEach(function (sub) {
        if (!sub) return;
        const url = typeof sub.url === 'string' && sub.url.indexOf('http') === 0 ? sub.url : null;
        if (!url) return;
        const format = sub.type ? String(sub.type).toLowerCase() : '';
        if (format !== 'vtt' && format !== 'srt') return;
        let label = String(sub.language || sub.lang || '').trim();
        if (label.length < 4) return;
        const cut = label.indexOf(' - [');
        if (cut > 0) label = label.slice(0, cut).trim();
        if (seen.urls.has(url)) return;
        seen.urls.add(url);
        if (seen.labels.has(label.toLowerCase())) {
            label = label + ' (' + city.display + ')';
        } else {
            seen.labels.add(label.toLowerCase());
        }
        out.push({ url: url, language: label, name: label, headers: P_HEADERS });
    });
    return out;
}

function collectRecords(city, reply, seenLinks, seenSubs) {
    const out = [];
    const sources = reply && Array.isArray(reply.sources) ? reply.sources : [];
    const subtitles = collectSubtitles(city, reply, seenSubs);
    sources.forEach(function (source) {
        if (!source) return;
        const url = typeof source.url === 'string' && source.url.indexOf('http') === 0 ? source.url : null;
        if (!url) return;
        const label = String(source.quality || '').trim();
        if (!label) return;
        if (city.slug === 'austin' && label !== 'English') return;
        if (seenLinks.has(url)) return;
        seenLinks.add(url);

        const hls = url.indexOf('/mp4/') === -1;
        let quality = qualityFromLabel(label);
        if (quality === null) quality = qualityFromUrl(url);
        if (quality === null && !hls) quality = 'Auto';
        out.push({ city: city, url: url, quality: quality, hls: hls, subtitles: subtitles });
    });
    return out;
}

function getSortTag(rank, maxRank) {
    let bin = Math.max(0, maxRank - rank).toString(2);
    while (bin.length < 20) bin = '0' + bin;
    return bin.split('').map(function (b) {
        return b === '1' ? '\uFEFF' : '\u200B';
    }).join('');
}

function toStream(record) {
    const label = getSortTag(Q_RANK[record.quality], 2) +
        [PROVIDER, record.city.display, record.city.langNote].join(' \u2022 ');
    const stream = {
        name: label,
        title: label,
        url: record.url,
        quality: record.quality,
        headers: P_HEADERS
    };
    if (record.hls) stream.type = 'hls';
    if (record.subtitles.length) stream.subtitles = record.subtitles;
    return stream;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const args = [tmdbId, mediaType, season, episode];
    return diagnostics.run(() => getStreamsImpl(...args), args);
}

async function getStreamsImpl(tmdbId, mediaType, season, episode) {
    try {
        const id = String(tmdbId);
        if (!/^\d+$/.test(id)) return [];
        const isTv = mediaType === 'tv';
        if (isTv && (season == null || episode == null)) return [];

        const meta = await loadMeta(id, isTv ? 'tv' : 'movie');
        if (!meta) return [];

        const req = {
            mediaType: isTv ? 'tv' : 'movie',
            tmdbId: id,
            imdbId: meta.imdbId,
            title: meta.title,
            year: meta.year,
            season: isTv ? season : 1,
            episode: isTv ? episode : 1,
            germanTitle: meta.germanTitle
        };

        const pool = new SeedPool(id);
        const seenLinks = new Set();
        const seenSubs = { urls: new Set(), labels: new Set() };
        const records = [];
        // The plugin runtime injects SCRAPER_SETTINGS; outside it the global is absent and a
        // bare read would throw, which used to swallow the whole provider.
        const settings = (typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS) || {};
        const queue = SERVERS.filter(function (city) {
            return settings['city_' + city.slug] !== false;
        });

        async function worker() {
            while (queue.length) {
                const city = queue.shift();
                try {
                    const reply = await citySources(city, req, pool);
                    if (reply) {
                        collectRecords(city, reply, seenLinks, seenSubs).forEach(function (r) {
                            records.push(r);
                        });
                    }
                } catch (e) {
                    diagnostics.log('server.failed', { server: city.slug, error: e && e.message });
                }
            }
        }

        const workers = [];
        for (let i = 0; i < 10; i++) workers.push(worker());
        await Promise.all(workers);

        await Promise.all(records.filter(function (r) {
            return r.quality === null;
        }).map(probeQuality));

        const streams = records
            .sort(function (a, b) {
                return Q_RANK[b.quality] - Q_RANK[a.quality];
            })
            .map(toStream);
        diagnostics.log('streams.resolved', {
            tmdbId: id,
            mediaType: req.mediaType,
            season: req.season,
            episode: req.episode,
            servers: SERVERS.length,
            count: streams.length,
            streams: streams.map(stream => ({ name: stream.name, quality: stream.quality, url: stream.url }))
        });
        return streams;
    } catch (e) {
        diagnostics.log('streams.failed', { tmdbId, mediaType, error: e && e.message });
        return [];
    }
}

module.exports = { getStreams };
