const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../utils/config");

const BASE_URL = "https://vidfast.vc";
const ENC_API = "https://enc-dec.app/api/enc-vidfast";
const DEC_API = "https://enc-dec.app/api/dec-vidfast";
const VIDFAST_PROXY_LIST_PATH = path.join(__dirname, "..", "utils", "vidfast-proxies.json");
const VIDFAST_PREFERRED_PROXY = "http://4.144.146.21:80";
const PROXY_PROBE_URL = "https://httpbin.org/ip";
const PROXY_PROBE_TIMEOUT_MS = 2500;
const PROXY_PROBE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 8000;
const RESOLUTION_TIMEOUT_MS = 20000;
const ALW_RES = new Set(["2160p", "1080p", "Auto"]);
const HEADERS = {
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Origin": BASE_URL,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
};

let vidfastProxyAgent = null;
let vidfastProxyUrl = "";
let vidfastProxySelection = null;

const isValidProxyUrl = (value) => {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return url.protocol === "http:" && !!url.hostname && !!url.port &&
            !url.username && !url.password && url.pathname === "/" &&
            !url.search && !url.hash;
    } catch {
        return false;
    }
};

const readProxyCandidates = () => {
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(VIDFAST_PROXY_LIST_PATH, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error("VidFast proxy list is missing; download it from the Outbound connection panel");
        }
        throw new Error(`Unable to read VidFast proxy list: ${error.message}`);
    }
    if (!payload || !Array.isArray(payload.proxies)) {
        throw new Error("VidFast proxy list has an invalid JSON format");
    }
    return payload.proxies
        .filter((proxy) =>
            proxy && proxy.alive === true && proxy.ssl === true &&
            proxy.protocol === "http" && proxy.anonymity !== "transparent" &&
            isValidProxyUrl(proxy.proxy)
        )
        .sort((a, b) =>
            (Number(b.uptime) || 0) - (Number(a.uptime) || 0) ||
            (Number(a.timeout) || Infinity) - (Number(b.timeout) || Infinity)
        )
        .slice(0, PROXY_PROBE_LIMIT);
};

const selectVidfastProxy = async () => {
    const { ProxyAgent, fetch: undiciFetch } = require("undici");
    const probe = async (proxyUrl, label) => {
        const agent = new ProxyAgent({ uri: proxyUrl, connectTimeout: PROXY_PROBE_TIMEOUT_MS });
        try {
            console.info(`[VidFast][Proxy] -> GET ${PROXY_PROBE_URL} via ${proxyUrl} (${label})`);
            const response = await undiciFetch(PROXY_PROBE_URL, {
                dispatcher: agent,
                signal: AbortSignal.timeout(PROXY_PROBE_TIMEOUT_MS),
            });
            console.info(`[VidFast][Proxy] <- GET ${PROXY_PROBE_URL} status=${response.status}`);
            const result = await response.json();
            if (response.ok && typeof result.origin === "string" && result.origin.trim()) {
                vidfastProxyAgent = agent;
                vidfastProxyUrl = proxyUrl;
                console.info(`[VidFast][Proxy] selected ${label}: ${proxyUrl}`);
                return agent;
            }
        } catch (error) {
            console.warn(`[VidFast][Proxy] ${label} unavailable: ${error.code || error.name}`);
        }
        try {
            await agent.close();
        } catch (error) {
            console.warn(`[VidFast][Proxy] failed to close rejected ${label}: ${error.message}`);
        }
        return null;
    };

    console.info(`[VidFast][Proxy] checking preferred proxy first: ${VIDFAST_PREFERRED_PROXY}`);
    const preferredAgent = await probe(VIDFAST_PREFERRED_PROXY, "preferred proxy");
    if (preferredAgent) return preferredAgent;

    const candidates = readProxyCandidates();
    console.info(`[VidFast][Proxy] preferred proxy unavailable; probing ${candidates.length} list candidate(s)`);
    for (const [index, candidate] of candidates.entries()) {
        const agent = await probe(candidate.proxy, `list proxy ${index + 1}/${candidates.length}`);
        if (agent) return agent;
    }
    throw new Error(`No working VidFast proxy found after probing ${candidates.length} list candidates`);
};

const getVidfastProxyAgent = () => {
    if (vidfastProxyAgent) return Promise.resolve(vidfastProxyAgent);
    if (!vidfastProxySelection) {
        vidfastProxySelection = selectVidfastProxy().finally(() => {
            vidfastProxySelection = null;
        });
    }
    return vidfastProxySelection;
};

const fetchVidfast = async (url, options) => {
    if (config.vidfastProxyEnabled !== true) return fetch(url, options);
    const { fetch: undiciFetch } = require("undici");
    const dispatcher = await getVidfastProxyAgent();
    return undiciFetch(url, { ...options, dispatcher });
};

const fetchWithLogs = async (url, options = {}, resolutionSignal) => {
    const method = String(options.method || "GET").toUpperCase();
    console.info(`[VidFast][HTTP] -> ${method} ${url}`);
    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = resolutionSignal
        ? AbortSignal.any([resolutionSignal, timeoutSignal, ...(options.signal ? [options.signal] : [])])
        : options.signal || timeoutSignal;
    try {
        const response = await fetchVidfast(url, { ...options, signal });
        console.info(
            `[VidFast][HTTP] <- ${method} ${response.url || url} status=${response.status} ${response.statusText || ""} duration=${Date.now() - startedAt}ms`.trim()
        );
        return response;
    } catch (error) {
        console.error(`[VidFast][HTTP] !! ${method} ${url} duration=${Date.now() - startedAt}ms error=${error.message}`);
        throw error;
    }
};

const heightToQuality = (height) => {
    if (height >= 2160) return "2160p";
    if (height >= 1440) return "1440p";
    if (height >= 1080) return "1080p";
    if (height >= 720) return "720p";
    if (height >= 480) return "480p";
    if (height >= 360) return "360p";
    return `${height}p`;
};

const parseQualityLabel = (str) => {
    if (/2160|4k/i.test(str)) return "2160p";
    if (/1440/i.test(str)) return "1440p";
    if (/1080/i.test(str)) return "1080p";
    if (/720/i.test(str)) return "720p";
    if (/480/i.test(str)) return "480p";
    if (/360/i.test(str)) return "360p";
    if (/auto|adaptive/i.test(str)) return "Auto";
    return null;
};

const extractStreamQuality = (data) => {
    if (data.quality) {
        const q = parseQualityLabel(data.quality);
        if (q) return q;
    }
    if (data.label) {
        const q = parseQualityLabel(data.label);
        if (q) return q;
    }
    const match = data.url?.match(/(\d{3,4})[pP]/);
    if (match) return `${match[1]}p`;
    return "Auto";
};

const resWeight = (quality) => {
    if (quality === "2160p") return 2;
    if (quality === "1080p") return 1;
    return 0;
};

const getInvertedSortTag = (score, maxScore) => {
    maxScore = maxScore || 999999;
    let inv = Math.max(0, maxScore - Math.max(0, parseInt(score, 10) || 0));
    let bin = inv.toString(2);
    while (bin.length < 20) bin = "0" + bin;
    return bin.split("").map(b => b === "1" ? "\uFEFF" : "\u200B").join("");
};

const fetchPlaylistVariants = async (playlistUrl, resolutionSignal) => {
    try {
        const res = await fetchWithLogs(playlistUrl, {
            headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": `${BASE_URL}/`,
            },
        }, resolutionSignal);

        if (!res.ok) return null;

        const text = await res.text();
        if (!text.includes("#EXT-X-STREAM-INF")) return null;

        const tracks = [];
        const lines = text.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

            const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
            const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
            const urlLine = lines[i + 1]?.trim();

            if (!urlLine || urlLine.startsWith("#")) continue;

            const url = urlLine.startsWith("http")
                ? urlLine
                : playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1) + urlLine;

            tracks.push({
                url,
                quality: resMatch ? heightToQuality(parseInt(resMatch[2])) : null,
                bandwidth: bwMatch ? parseInt(bwMatch[1]) : 0,
            });
        }

        if (tracks.length === 0) return null;

        tracks.sort((a, b) => b.bandwidth - a.bandwidth);

        for (const track of tracks) {
            if (!track.quality) {
                const m = track.url.match(/(\d{3,4})[pP]/);
                track.quality = m ? `${m[1]}p` : heightToQuality(
                    tracks.indexOf(track) === 0 ? 2160 :
                        tracks.indexOf(track) === 1 ? 1080 : 720
                );
            }
        }

        return tracks;
    } catch {
        return null;
    }
};

const decrypt = async (payload, resolutionSignal) => {
    try {
        const res = await fetchWithLogs(DEC_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": HEADERS["User-Agent"],
            },
            body: JSON.stringify({ text: payload }),
        }, resolutionSignal);
        return await res.json();
    } catch (error) {
        console.warn(`[VidFast] decrypt request failed: ${error.message}`);
        return null;
    }
};

const encStage = async (text, stage, resolutionSignal) => {
    const url = `${ENC_API}?text=${encodeURIComponent(text)}&stage=${stage}`;
    const res = await fetchWithLogs(url, {}, resolutionSignal);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result || null;
};

const resolvePageUrl = (tmdbId, mediaType, season, episode) =>
    mediaType === "tv"
        ? `${BASE_URL}/tv/${tmdbId}/${season}/${episode}/`
        : `${BASE_URL}/movie/${tmdbId}/`;

const extractEncryptedPayload = (pageText) => {
    const m = String(pageText || "").match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    return m ? m[1] : null;
};

const fetchRawStreams = async (tmdbId, mediaType, season, episode) => {
    const resolutionSignal = AbortSignal.timeout(RESOLUTION_TIMEOUT_MS);
    const pageUrl = resolvePageUrl(tmdbId, mediaType, season, episode);
    const pageRes = await fetchWithLogs(pageUrl, {
        headers: {
            "User-Agent": HEADERS["User-Agent"],
            "Referer": `${BASE_URL}/`,
        },
    }, resolutionSignal);
    if (!pageRes.ok) return [];

    const payload = extractEncryptedPayload(await pageRes.text());
    if (!payload) return [];

    const first = await encStage(payload, 1, resolutionSignal);
    if (!first?.stage1) return [];

    const headers = {
        "User-Agent": HEADERS["User-Agent"],
        "Referer": `${BASE_URL}/`,
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": first.token || "",
    };

    const stage1Res = await fetchWithLogs(first.stage1, { method: "POST", headers }, resolutionSignal);
    if (!stage1Res.ok) return [];

    const second = await encStage(await stage1Res.text(), 2, resolutionSignal);
    if (!second?.servers || !second?.stream) return [];

    const streamBase = second.stream;
    headers["X-CSRF-Token"] = second.token || "";

    const serversRes = await fetchWithLogs(second.servers, { method: "POST", headers }, resolutionSignal);
    if (!serversRes.ok) return [];

    const decryptedServers = await decrypt(await serversRes.text(), resolutionSignal);
    if (!Array.isArray(decryptedServers?.result) || decryptedServers.result.length === 0) return [];

    const settled = (
        await Promise.allSettled(
            decryptedServers.result
                .map(async (server, i) => {
                    const name = server.name || `Server ${i + 1}`;
                    const streamUrl = `${streamBase}/${server.data}`;
                    const res = await fetchWithLogs(streamUrl, { method: "POST", headers }, resolutionSignal);
                    if (!res.ok) return null;

                    const streamData = await decrypt(await res.text(), resolutionSignal);
                    if (!streamData?.result?.url) return null;

                    const data = streamData.result;
                    return {
                        name,
                        url: data.url,
                        quality: extractStreamQuality(data),
                        isM3U8: data.url.includes(".m3u8"),
                    };
                })
        )
    )
        .filter(r => r.status === "fulfilled" && r.value != null)
        .map(r => r.value);

    const expanded = (
        await Promise.allSettled(
            settled.map(async (stream) => {
                if (!stream.isM3U8 || (ALW_RES.has(stream.quality) && stream.quality !== "Auto")) return [stream];
                const tracks = await fetchPlaylistVariants(stream.url, resolutionSignal);
                if (tracks?.length > 0) {
                    return tracks.map(t => ({
                        name: stream.name,
                        url: t.url,
                        quality: t.quality,
                        isM3U8: false,
                    }));
                }
                return [stream];
            })
        )
    )
        .filter(r => r.status === "fulfilled")
        .flatMap(r => r.value);

    const seen = new Set();
    return expanded.filter(s => {
        if (seen.has(s.url)) return false;
        seen.add(s.url);
        return ALW_RES.has(s.quality);
    });
};

const sortAndTag = (streams) => {
    streams.sort((a, b) => resWeight(b.quality) - resWeight(a.quality));
    const total = streams.length;
    return streams.map((s, i) => {
        const tag = getInvertedSortTag(total - i, total + 1);
        return { ...s, name: tag + s.name, title: tag + s.title };
    });
};

const normalizeStreams = (streams) =>
    sortAndTag(
        streams.map(stream => ({
            name: `VidFast \u2022 ${stream.name}`,
            title: `VidFast \u2022 ${stream.name}`,
            url: stream.url,
            quality: stream.quality,
            headers: {
                "User-Agent": HEADERS["User-Agent"],
                "Referer": `${BASE_URL}/`,
            },
        }))
    );

async function getVidfastStreams(tmdbId, mediaType, season, episode) {
    const startedAt = Date.now();
    try {
        if (mediaType !== "movie" && mediaType !== "tv") {
            console.warn(`[VidFast] unsupported media type "${mediaType}"`);
            return [];
        }
        if (mediaType === "tv" && (season == null || episode == null)) {
            console.warn("[VidFast] TV request is missing season or episode");
            return [];
        }

        const streams = await fetchRawStreams(tmdbId, mediaType, season, episode);
        if (!streams?.length) {
            console.info(`[VidFast] resolved no streams in ${Date.now() - startedAt}ms`);
            return [];
        }

        const result = normalizeStreams(streams);
        console.info(`[VidFast] resolved ${result.length} stream(s) in ${Date.now() - startedAt}ms`);
        return result;
    } catch (error) {
        console.error(`[VidFast] stream resolution failed after ${Date.now() - startedAt}ms: ${error.message}`);
        return [];
    }
}

function getVidfastProxyStatus() {
    return {
        enabled: config.vidfastProxyEnabled === true,
        selectedProxy: vidfastProxyUrl || null,
        listAvailable: fs.existsSync(VIDFAST_PROXY_LIST_PATH),
        probeLimit: PROXY_PROBE_LIMIT,
        preferredProxy: VIDFAST_PREFERRED_PROXY,
    };
}

module.exports = {
    getVidfastStreams,
    getVidfastProxyStatus,
};
