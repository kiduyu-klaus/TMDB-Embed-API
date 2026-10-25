const crypto = require("crypto");
const diagnostics = require('../utils/providerTrace').createProviderTrace('Mapple', { redact: false });
const tracedFetch = diagnostics.fetch;

const BASE_URL = "https://mapple.fun";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 OPR/137.0.0.0";

const SOURCES = [
    { name: "Poseidon", key: "s25" },
    { name: "Prometheus", key: "s10" },
    { name: "Zeus", key: "mapple" },
    { name: "Athena", key: "s2" },
    { name: "Astraeus", key: "s28" },
    { name: "Apollo", key: "s19" },
    { name: "Hera", key: "s4" },
    { name: "Persephone", key: "s12" },
    { name: "Aphrodite", key: "s6" },
    { name: "Demeter", key: "s7" },
    { name: "Dionysus", key: "s8" }
];

function hasLeadingZeroBits(hash, bits) {
    const fullBytes = Math.floor(bits / 8);
    const remainingBits = bits % 8;
    for (let i = 0; i < fullBytes; i++) {
        if (hash[i] !== 0) return false;
    }
    if (remainingBits > 0) {
        const mask = 0xff << (8 - remainingBits);
        if ((hash[fullBytes] & mask) !== 0) return false;
    }
    return true;
}

function solveProofOfWork(challenge, difficulty) {
    for (let nonce = 0; nonce <= 50000000; nonce++) {
        const hash = crypto.createHash("sha256").update(`${challenge}${nonce}`).digest();
        if (hasLeadingZeroBits(hash, difficulty)) return String(nonce);
    }
    return null;
}

function createCookieJar() {
    const cookies = new Map();
    return {
        update(response) {
            let values = [];
            try {
                if (typeof response?.headers?.getSetCookie === "function") {
                    values = response.headers.getSetCookie() || [];
                } else {
                    const value = response?.headers?.get("set-cookie");
                    if (value) values = [value];
                }
            } catch (_) {}
            for (const value of values) {
                const pair = value.split(";", 1)[0];
                const separator = pair.indexOf("=");
                if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
            }
        },
        serialize() {
            return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
        }
    };
}

function apiHeaders(referer, jar, json = false) {
    const headers = {
        Accept: "*/*",
        Origin: BASE_URL,
        Referer: referer,
        "User-Agent": DESKTOP_UA
    };
    if (json) headers["Content-Type"] = "application/json";
    const cookie = jar?.serialize();
    if (cookie) headers.Cookie = cookie;
    return headers;
}

async function createSession(tmdbId, mediaType, tvSlug, referer) {
    const jar = createCookieJar();
    try {
        const home = await tracedFetch(`${BASE_URL}/`, {
            headers: { "User-Agent": DESKTOP_UA, Accept: "text/html" }
        });
        jar.update(home);
        await home.text();

        const sessionResponse = await tracedFetch(`${BASE_URL}/api/ui/session`, {
            method: "POST",
            headers: apiHeaders(referer, jar, true)
        });
        jar.update(sessionResponse);
        if (!sessionResponse.ok) return null;
        const session = await sessionResponse.json();
        const requestToken = session?.token;
        if (!requestToken) return null;

        const mediaPayload = {
            mediaId: Number(tmdbId),
            mediaType,
            requestToken
        };
        if (mediaType === "tv") mediaPayload.tv_slug = tvSlug;

        const mediaResponse = await tracedFetch(`${BASE_URL}/api/media-session`, {
            method: "POST",
            headers: apiHeaders(referer, jar, true),
            body: JSON.stringify(mediaPayload)
        });
        jar.update(mediaResponse);
        if (!mediaResponse.ok) return null;
        const mediaSession = await mediaResponse.json();

        if (mediaSession?.requiresPow && mediaSession.pow) {
            const nonce = solveProofOfWork(mediaSession.pow.challenge, mediaSession.pow.difficulty || 18);
            if (nonce === null) return null;
            mediaPayload.pow = {
                challengeId: mediaSession.pow.challengeId,
                nonce
            };
        }

        const playbackResponse = await tracedFetch(`${BASE_URL}/api/playback-init`, {
            method: "POST",
            headers: apiHeaders(referer, jar, true),
            body: JSON.stringify(mediaPayload)
        });
        jar.update(playbackResponse);
        if (!playbackResponse.ok) return null;
        const playback = await playbackResponse.json();
        if (!playback?.token) return null;

        return { requestToken, playbackToken: playback.token, jar, referer };
    } catch (error) {
        diagnostics.log("session.error", { tmdbId, mediaType, error: error.message });
        return null;
    }
}

async function fetchServerStream(server, tmdbId, mediaType, tvSlug, session) {
    try {
        const encryptedResponse = await tracedFetch(`${BASE_URL}/api/encrypt`, {
            method: "POST",
            headers: apiHeaders(session.referer, session.jar, true),
            body: JSON.stringify({
                data: {
                    mediaId: Number(tmdbId),
                    mediaType,
                    tv_slug: tvSlug,
                    source: server.key
                },
                endpoint: "stream-encrypted",
                requestToken: session.requestToken
            })
        });
        if (!encryptedResponse.ok) return null;
        const encrypted = await encryptedResponse.json();
        if (!encrypted?.url) return null;

        const streamUrl = `${BASE_URL}${encrypted.url}&requestToken=${encodeURIComponent(session.requestToken)}&token=${encodeURIComponent(session.playbackToken)}`;
        const resolvedResponse = await tracedFetch(streamUrl, {
            headers: apiHeaders(session.referer, session.jar)
        });
        if (!resolvedResponse.ok) return null;
        const resolved = await resolvedResponse.json();
        const url = resolved?.success ? resolved?.data?.stream_url : "";
        if (!url || String(url).includes("playback-unavailable")) return null;

        return {
            name: `Mapple • ${server.name}`,
            title: `Mapple • ${server.name}`,
            source: server.key,
            url,
            quality: "Auto",
            headers: {
                Referer: `${BASE_URL}/`,
                Origin: BASE_URL,
                "User-Agent": DESKTOP_UA
            }
        };
    } catch (error) {
        diagnostics.log("source.error", { source: server.key, error: error.message });
        return null;
    }
}

async function getStreamsImpl(tmdbId, mediaType, season, episode) {
    try {
        if (!/^\d+$/.test(String(tmdbId))) return [];
        const type = mediaType === "tv" ? "tv" : "movie";
        if (type === "tv" && (season == null || episode == null)) return [];

        const tvSlug = type === "tv" ? `${Number(season)}-${Number(episode)}` : "";
        const referer = type === "tv"
            ? `${BASE_URL}/watch/tv/${tmdbId}-${Number(season)}-${Number(episode)}`
            : `${BASE_URL}/watch/movie/${tmdbId}`;
        const session = await createSession(tmdbId, type, tvSlug, referer);
        if (!session) return [];

        // Intentionally resolve every configured source. One success must not stop the others.
        const results = await Promise.all(
            SOURCES.map(source => fetchServerStream(source, tmdbId, type, tvSlug, session))
        );
        const seen = new Set();
        const streams = results.filter(stream => {
            if (!stream || !stream.url || seen.has(stream.url)) return false;
            seen.add(stream.url);
            return true;
        });
        diagnostics.log("streams.resolved", {
            tmdbId,
            mediaType: type,
            season,
            episode,
            attemptedSources: SOURCES.map(source => source.key),
            resolvedSources: streams.map(stream => stream.source),
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
