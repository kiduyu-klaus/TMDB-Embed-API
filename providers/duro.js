const PROVIDER = "Dulo";
const BASE_URL = "https://dulo.mov";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_KEY = (typeof TMDB_API_KEY !== "undefined" && TMDB_API_KEY) || "307b7b8ef035c6aa336900aef4e203bd";
const HEADERS = {
    "User-Agent": USER_AGENT,
    Referer: `${BASE_URL}/`
};

async function fetchJson(url, referer) {
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/plain, */*", Referer: referer }
        });
        return response ? await response.json() : null;
    } catch (error) {
        return null;
    }
}

function detectQuality(label) {
    const text = String(label || "");
    const resolution = /\b(2160|1440|1080|720|480|360)\s*p\b/i.exec(text);
    if (resolution) return `${resolution[1]}p`;
    return /\b4K\b/i.test(text) ? "2160p" : "Auto";
}

function getQualityRank(quality) {
    if (quality === "2160p") return 2;
    if (quality === "1080p") return 1;
    return quality === "Auto" ? 0 : -1;
}

function buildSortTag(rank) {
    const binary = Math.max(0, 2 - rank).toString(2).padStart(20, "0");
    return binary.split("").map((bit) => (bit === "1" ? "\uFEFF" : "\u200B")).join("");
}

function cleanLabel(label) {
    const text = String(label);
    const cleaned = text.replace(/\s*[\u00B7\u2022|-]\s*(?:\d{3,4}p|4K)\b/gi, "").trim();
    return cleaned || text;
}

async function fetchMetadata(tmdbId, type) {
    const details = await fetchJson(`${TMDB_API}/${type}/${tmdbId}?api_key=${TMDB_KEY}`, "");
    if (!details) return null;
    const releaseDate = details.release_date || details.first_air_date || "";
    return {
        title: details.title || details.name || null,
        year: releaseDate.length >= 4 ? releaseDate.slice(0, 4) : null,
        runtime: details.runtime || null
    };
}

async function fetchSources(tmdbId, type, seasonNumber, episodeNumber, metadata) {
    let query = `tmdbId=${encodeURIComponent(tmdbId)}&type=${type}&progressive=true`;
    if (type === "tv") query += `&seasonId=${seasonNumber}&episodeId=${episodeNumber}`;
    if (metadata) {
        if (metadata.title) query += `&title=${encodeURIComponent(metadata.title)}`;
        if (metadata.year) query += `&year=${encodeURIComponent(metadata.year)}`;
        if (metadata.runtime) query += `&runtime=${encodeURIComponent(Math.round(metadata.runtime))}`;
    }

    const url = `${BASE_URL}/api/streams/resolve?${query}`;
    const referer = `${BASE_URL}/watch/${type}/${tmdbId}`;
    const sources = [];
    const knownLabels = new Set();

    for (let attempt = 0; attempt < 6; attempt++) {
        const payload = await fetchJson(url, referer);
        if (payload && Array.isArray(payload.sources)) {
            payload.sources.forEach((source) => {
                if (source && source.label && !knownLabels.has(source.label)) {
                    knownLabels.add(source.label);
                    sources.push(source);
                }
            });
        }
        if (!(payload && payload.pending)) break;
    }
    return sources;
}

function buildSubtitles(captions) {
    if (!Array.isArray(captions)) return [];
    return captions
        .filter((caption) => caption && typeof caption.url === "string" && caption.url)
        .map((caption) => ({ url: caption.url, language: String(caption.display || caption.language || "Unknown") }));
}

async function getStreams(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        const type = mediaType === "tv" ? "tv" : "movie";
        let seasonNumber = 0;
        let episodeNumber = 0;
        if (type === "tv") {
            if (season == null || episode == null) return [];
            seasonNumber = parseInt(season, 10);
            episodeNumber = parseInt(episode, 10);
            if (isNaN(seasonNumber) || isNaN(episodeNumber)) return [];
        }

        const metadata = await fetchMetadata(tmdbId, type);
        const sources = await fetchSources(tmdbId, type, seasonNumber, episodeNumber, metadata);

        const seenUrls = new Set();
        const streams = [];
        sources.forEach((source) => {
            if (typeof source.url !== "string" || !source.url || seenUrls.has(source.url)) return;
            const quality = detectQuality(source.label);
            const rank = getQualityRank(quality);
            if (rank < 0) return;
            seenUrls.add(source.url);

            const displayName = `${buildSortTag(rank)}${PROVIDER} \u2022 ${cleanLabel(source.label)}`;
            const stream = {
                name: displayName,
                title: displayName,
                url: source.url,
                quality,
                headers: HEADERS
            };
            if (!/^(mp4|mkv|webm)$/.test(String(source.type))) stream.type = "hls";
            const subtitles = buildSubtitles(source.captions);
            if (subtitles.length) stream.subtitles = subtitles;
            streams.push(stream);
        });

        return streams.sort((a, b) => getQualityRank(b.quality) - getQualityRank(a.quality));
    } catch (error) {
        return [];
    }
}

module.exports = { getStreams };