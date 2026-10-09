const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SEARCH_URL = 'https://sub.wyzie.io/search';
const OUTPUT_FORMATS = new Set(['srt', 'sub', 'mpl', 'webvtt', 'dfxp', 'txt']);
const MIME_TYPES = {
    srt: 'application/x-subrip', webvtt: 'text/vtt', dfxp: 'application/ttml+xml',
    sub: 'text/plain', mpl: 'text/plain', txt: 'text/plain'
};

function normalizeResults(results) {
    if (!Array.isArray(results)) return [];
    const seen = new Set();
    return results.flatMap(item => {
        if (!item || typeof item.url !== 'string') return [];
        let url;
        try { url = new URL(item.url); } catch { return []; }
        if (!['https:', 'http:'].includes(url.protocol)) return [];
        // Do not rewrite signed URLs: accept only an explicitly supported URL format.
        const format = (url.searchParams.get('format') || url.pathname.match(/\.([a-z]+)$/i)?.[1] || '').toLowerCase();
        if (!OUTPUT_FORMATS.has(format) || seen.has(url.href)) return [];
        seen.add(url.href);
        const language = String(item.language || item.lang || 'und');
        const display = String(item.display || item.label || language);
        const label = `${display}${item.isHearingImpaired ? ' (SDH)' : ''}${item.release ? ` - ${item.release}` : ''}`;
        return [{
            url: url.href, mimeType: MIME_TYPES[format], language, label, name: label,
            format, headers: {}
        }];
    });
}

function createSubtitleFallback({
    request = (params, timeout) => axios.get(SEARCH_URL, { params, timeout, maxContentLength: 5 * 1024 * 1024 }),
    getKey = () => process.env.WYZIE_API_KEY,
    now = Date.now,
    cacheFile = null
} = {}) {
    const cache = new Map();
    const maxEntries = 500;
    const cacheTtlMs = 24 * 60 * 60 * 1000;
    let writes = Promise.resolve();
    let migrateCache = false;
    if (cacheFile) {
        try {
            const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (saved.version === 1 && Array.isArray(saved.entries)) {
                migrateCache = true;
                for (const [id, entry] of saved.entries.slice(-maxEntries)) {
                    if (typeof id !== 'string' || !Number.isFinite(entry?.expires) || entry.expires <= now()) continue;
                    const subtitles = normalizeResults(entry.subtitles);
                    cache.set(id, { expires: entry.expires, subtitles, promise: Promise.resolve(subtitles) });
                }
            } else if (saved.version === 2 && saved.entries && typeof saved.entries === 'object') {
                for (const entry of Object.values(saved.entries).slice(-maxEntries)) {
                    if (!/^\d+$/.test(String(entry?.tmdbId)) || !/^[a-f0-9]{64}$/.test(entry.credentialId || '') ||
                        !['movie', 'tv'].includes(entry.type) || !Number.isFinite(entry.expires) || entry.expires <= now()) continue;
                    if (entry.type === 'tv' && ![entry.season, entry.episode].every(value => Number.isInteger(value) && value > 0)) continue;
                    const subtitles = normalizeResults(entry.subtitles);
                    const restored = { ...entry, subtitles, promise: Promise.resolve(subtitles) };
                    const suffix = `${entry.type}:${entry.type === 'tv' ? `${entry.season}:${entry.episode}` : ''}:${entry.credentialId}`;
                    cache.set(`${entry.tmdbId}:${suffix}`, restored);
                    if (/^tt\d+$/.test(entry.imdbId || '')) cache.set(`${entry.imdbId}:${suffix}`, restored);
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') console.warn('[subtitles] Ignoring unreadable Wyzie cache');
        }
    }

    function persistCache() {
        if (!cacheFile) return Promise.resolve();
        writes = writes.then(async () => {
            const entries = {};
            for (const [alias, entry] of [...cache].slice(-maxEntries)) {
                if (entry.expires <= now() || !Array.isArray(entry.subtitles)) continue;
                // Persist one copy by TMDB identity, not one copy for each IMDb/TMDB alias.
                const match = alias.match(/^(\d+):(movie|tv):(?:(\d+):(\d+))?:([a-f0-9]{64})$/);
                if (!match) continue;
                const [, tmdbId, type, season, episode, credentialId] = match;
                const id = type === 'tv' ? `tv:${tmdbId}:${season}:${episode}` : `movie:${tmdbId}`;
                entries[id] = {
                    tmdbId, type, season: type === 'tv' ? Number(season) : null,
                    episode: type === 'tv' ? Number(episode) : null,
                    imdbId: entry.imdbId || null, credentialId,
                    expires: entry.expires, subtitles: entry.subtitles
                };
            }
            let savedEntries = {};
            try {
                const saved = JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
                if (saved.version === 2 && saved.entries && typeof saved.entries === 'object') {
                    savedEntries = saved.entries;
                }
            } catch (error) {
                if (error.code !== 'ENOENT') console.warn('[subtitles] Ignoring unreadable Wyzie cache before update');
            }
            const mergedEntries = new Map(
                Object.entries(savedEntries).filter(([, entry]) =>
                    /^\d+$/.test(String(entry?.tmdbId)) &&
                    /^[a-f0-9]{64}$/.test(entry.credentialId || '') &&
                    ['movie', 'tv'].includes(entry.type) &&
                    Number.isFinite(entry.expires) && entry.expires > now() &&
                    (entry.type !== 'tv' || [entry.season, entry.episode].every(value => Number.isInteger(value) && value > 0))
                )
            );
            for (const [id, entry] of Object.entries(entries)) {
                mergedEntries.delete(id);
                mergedEntries.set(id, entry);
            }
            const retainedEntries = Object.fromEntries([...mergedEntries].slice(-maxEntries));
            const temporary = `${cacheFile}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
            try {
                await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
                await fs.promises.writeFile(temporary, JSON.stringify({ version: 2, entries: retainedEntries }, null, 2), { mode: 0o600 });
                await fs.promises.rename(temporary, cacheFile);
            } finally {
                await fs.promises.unlink(temporary).catch(() => {});
            }
        }).catch(() => console.warn('[subtitles] Could not save Wyzie cache; using memory cache'));
        return writes;
    }
    if (migrateCache) void persistCache();

    async function lookup(context) {
        await writes;
        const key = getKey();
        if (!key) return [];
        const type = context.type === 'series' || context.type === 'tv' ? 'tv' : 'movie';
        const { season, episode } = context;
        if (type === 'tv' && ![season, episode].every(value => Number.isInteger(Number(value)) && Number(value) > 0)) return [];
        const ids = [];
        if (/^tt\d+$/.test(String(context.imdbId || ''))) ids.push(String(context.imdbId));
        if (/^\d+$/.test(String(context.tmdbId || ''))) ids.push(String(context.tmdbId));
        if (!ids.length) return [];

        const credentialId = crypto.createHash('sha256').update(key).digest('hex');
        const suffix = `${type}:${type === 'tv' ? `${Number(season)}:${Number(episode)}` : ''}:${credentialId}`;
        const aliases = ids.map(id => `${id}:${suffix}`);
        for (const [id, entry] of cache) if (entry.expires <= now()) cache.delete(id);
        let entry = aliases.map(id => cache.get(id)).find(Boolean);
        if (!entry) {
            entry = { expires: now() + 10000, promise: null };
            entry.promise = (async () => {
                const deadline = now() + 8000;
                for (const id of ids) {
                    const timeout = deadline - now();
                    if (timeout <= 0) break;
                    const params = { id, key };
                    if (type === 'tv') Object.assign(params, { season: Number(season), episode: Number(episode) });
                    try {
                        const response = await request(params, timeout);
                        const subtitles = normalizeResults(response.data);
                        entry.expires = now() + cacheTtlMs;
                        if (subtitles.length) return subtitles;
                    } catch (error) {
                        // Axios error messages/config can contain the credential URL.
                        console.warn(`[subtitles] Wyzie lookup failed (HTTP ${error.response?.status || 'unavailable'})`);
                        break;
                    }
                }
                entry.expires = now() + cacheTtlMs;
                return [];
            })().then(async subtitles => {
                entry.subtitles = subtitles;
                await persistCache();
                return subtitles;
            });
        }
        if (ids.some(id => id.startsWith('tt'))) entry.imdbId = ids.find(id => id.startsWith('tt'));
        // Aliases share both completed results and the in-flight request.
        for (const alias of aliases) cache.set(alias, entry);
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return entry.promise;
    }

    return async function addFallbackSubtitles(streams, context) {
        if (!Array.isArray(streams) || !streams.some(stream => stream && (!Array.isArray(stream.subtitles) || stream.subtitles.length === 0))) return streams;
        const subtitles = await lookup(context);
        if (!subtitles.length) return streams;
        return streams.map(stream => {
            if (!stream || (Array.isArray(stream.subtitles) && stream.subtitles.length)) return stream;
            return { ...stream, subtitles: subtitles.map(subtitle => ({ ...subtitle, headers: {} })) };
        });
    };
}

module.exports = {
    addFallbackSubtitles: createSubtitleFallback({
        cacheFile: process.env.WYZIE_CACHE_FILE || path.join(__dirname, '.cache', 'wyzie-subtitles.json')
    }),
    createSubtitleFallback, normalizeResults
};
