const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 OPR/137.0.0.0";

const BASE_URL = "https://noxpulse.cc/";
const API_URL = "https://api.noxpulse.cc";
const SOURCE_KEY = "noxpulse";

// Diagnostics are optional so the provider also runs standalone outside the host project.
let diagnostics;
try {
    diagnostics = require('../utils/providerTrace').createProviderTrace('NoxPulse', { redact: false });
} catch (_) {
    diagnostics = {
        fetch: (...args) => globalThis.fetch(...args),
        log: () => {},
        run: (fn, args) => fn(...args)
    };
}
const tracedFetch = diagnostics.fetch ?? ((...args) => globalThis.fetch(...args));

function buildWatchPath(tmdbId, type, season, episode) {
    if (type === "tv") return `/watch/series/${tmdbId}/${Number(season)}/${Number(episode)}`;
    return `/watch/movie/${tmdbId}`;
}

function buildHeaders() {
    return {
        Referer: BASE_URL,
        Origin: BASE_URL.replace(/\/$/, ""),
        "User-Agent": DESKTOP_UA
    };
}

function normalizeEntries(watchData) {
    const entries = [];
    if (watchData?.source) entries.push(watchData.source);
    if (Array.isArray(watchData?.alternates)) entries.push(...watchData.alternates);
    return entries.filter(entry => entry && entry.url);
}

function toStream(entry) {
    const title = entry.title || entry.name || SOURCE_KEY;
    const quality = entry.quality && entry.quality !== "Unknown" ? entry.quality : "Auto";
    return {
        name: `NoxPulse • ${title}`,
        title: `NoxPulse • ${title}`,
        source: SOURCE_KEY,
        url: entry.url,
        quality,
        type: entry.type || entry.kind || "mp4",
        headers: buildHeaders()
    };
}

async function getStreamsImpl(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        const type = mediaType === "tv" ? "tv" : "movie";
        if (type === "tv" && (season == null || episode == null)) return [];

        const path = buildWatchPath(tmdbId, type, season, episode);
        const response = await tracedFetch(`${API_URL}${path}`, {
            method: "GET",
            headers: {
                Accept: "application/json",
                Referer: `${BASE_URL.replace(/\/$/, "")}${path}`,
                Origin: BASE_URL.replace(/\/$/, ""),
                "User-Agent": DESKTOP_UA
            }
        });

        if (!response.ok) {
            diagnostics.log("watch.error", {
                tmdbId,
                mediaType: type,
                season,
                episode,
                status: response.status
            });
            return [];
        }

        const watchData = await response.json();
        const entries = normalizeEntries(watchData);
        const seen = new Set();
        const streams = entries
            .map(toStream)
            .filter(stream => {
                if (!stream.url || seen.has(stream.url)) return false;
                seen.add(stream.url);
                return true;
            });

        diagnostics.log("streams.resolved", {
            tmdbId,
            mediaType: type,
            season,
            episode,
            resolvedSources: streams.map(stream => stream.url),
            count: streams.length
        });
        return streams;
    } catch (error) {
        diagnostics.log("extract.error", { tmdbId, mediaType, season, episode, error: error.message });
        return [];
    }
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const args = [tmdbId, mediaType, season, episode];
    return diagnostics.run(() => getStreamsImpl(...args), args);
}

module.exports = { getStreams };