const BASE_URL = "https://vidbolt.xyz";

// Detailed request logging with complete, unredacted URLs (local debugging).
// Set PROVIDER_LOG_REDACT=1 to force redaction back on.
const diagnostics = require('../utils/providerTrace').createProviderTrace('VidBolt', { redact: false });
const tracedFetch = diagnostics.fetch;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const P_HEADERS = {
    "Referer": `${BASE_URL}/`,
    "User-Agent": USER_AGENT,
};
const HEADERS = { ...P_HEADERS, "Accept": "application/json" };
const SERVERS = ["quantum", "vega", "callisto", "orion", "fastva"];
const SERVER_LABELS = {
    quantum: "Quantum",
    vega: "Vega",
    callisto: "Callisto",
    orion: "Orion",
    fastva: "FastVA",
};
const Q_2160 = { label: "2160p", prefix: "\u200B".repeat(20) };
const Q_1080 = { label: "1080p", prefix: "\u200B".repeat(17) + "\uFEFF\u200B\u200B" };

async function fetchResolverPayload(queryString) {
    try {
        const response = await tracedFetch(`${BASE_URL}/api/resolve?${queryString}`, { headers: HEADERS });
        if (!response.ok) {
            diagnostics.log('resolver.empty', { queryString, status: response.status });
            return null;
        }
        return await response.json();
    } catch (error) {
        diagnostics.log('resolver.failed', { queryString, error: error.message });
        return null;
    }
}

function parseQuality(rawQuality) {
    const normalized = String(rawQuality || "").trim().toLowerCase();
    if (/2160|4k|uhd/.test(normalized)) return Q_2160;
    if (/1080|fhd/.test(normalized)) return Q_1080;
    return null;
}

function parseSources(payload) {
    const stream = payload && payload.stream;
    const rawSources = stream && Array.isArray(stream.sources) ? stream.sources : [];
    const seenUrls = new Set();
    const candidates = [];

    for (const source of rawSources) {
        if (!source || typeof source.url !== "string" || !source.url || seenUrls.has(source.url)) continue;
        const quality = parseQuality(source.quality || source.name);
        if (!quality) continue;
        seenUrls.add(source.url);
        candidates.push({ url: source.url, quality });
    }

    return {
        candidates,
        serverName: stream && typeof stream.server === "string" ? stream.server : "",
    };
}

async function locateSources(queryString) {
    const primary = parseSources(await fetchResolverPayload(queryString));
    diagnostics.log('resolver.primary', { queryString, candidates: primary.candidates.length, server: primary.serverName });
    if (primary.candidates.length) return primary;

    const fallbacks = await Promise.all(
        SERVERS.map(async (server) => {
            const parsed = parseSources(await fetchResolverPayload(`${queryString}&prefer=${server}`));
            diagnostics.log('resolver.fallback', { server, candidates: parsed.candidates.length, serverName: parsed.serverName });
            return { candidates: parsed.candidates, serverName: parsed.serverName || server };
        })
    );

    const winner = fallbacks.find((result) => result.candidates.length) || { candidates: [], serverName: "" };
    diagnostics.log('resolver.selected', { serverName: winner.serverName, candidates: winner.candidates.length });
    return winner;
}

function formatServer(serverName) {
    if (!serverName) return "";
    const label = SERVER_LABELS[serverName.toLowerCase()] || `${serverName.charAt(0).toUpperCase()}${serverName.slice(1)}`;
    return ` \u2022 ${label}`;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const args = [tmdbId, mediaType, season, episode];
    return diagnostics.run(() => getStreamsImpl(...args), args);
}

async function getStreamsImpl(tmdbId, mediaType, season, episode) {
    if (!/^\d+$/.test(String(tmdbId))) {
        diagnostics.log('request.rejected', { tmdbId, mediaType });
        return [];
    }

    const isSeries = mediaType === "tv";
    if (!isSeries && mediaType !== "movie") {
        diagnostics.log('request.rejected', { tmdbId, mediaType });
        return [];
    }
    if (isSeries && (season == null || episode == null)) {
        diagnostics.log('request.rejected', { tmdbId, mediaType, season, episode });
        return [];
    }

    const queryString = isSeries
        ? `type=tv&id=${tmdbId}&season=${season}&episode=${episode}`
        : `type=movie&id=${tmdbId}`;

    const { candidates, serverName } = await locateSources(queryString);
    const serverLabel = formatServer(serverName);

    const streams = candidates.slice(0, 3).map(({ url, quality }) => {
        const label = `${quality.prefix}VidBolt${serverLabel} \u2022 ${quality.label}`;
        return {
            name: label,
            title: label,
            url,
            quality: quality.label,
            headers: P_HEADERS,
        };
    });

    diagnostics.log('streams.resolved', {
        count: streams.length,
        server: serverName,
        streams: streams.map((s) => ({ name: s.name, quality: s.quality, url: s.url }))
    });

    return streams;
}

module.exports = { getStreams };