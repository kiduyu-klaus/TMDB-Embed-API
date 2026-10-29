/**
 * MovieBox provider scraper.
 * (header comments preserved from original — see original file)
 */

const PROVIDER = "MovieBox";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const { getTmdbApiKey } = require("../utils/tmdbKey");
const { config } = require("../utils/config");
const fs = require("node:fs");
const path = require("node:path");

const WEB_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
const MOBILE_USER_AGENT =
    "com.community.mbox.in/50020130 (Linux; B; Android 16; en_IN; Pixel 9; Build/UD1A.230803.041; Cronet/145.0.7582.0)";

const SITE_ORIGIN = "https://themoviebox.xyz";
const WEB_API_BASES = [
    `${SITE_ORIGIN}/wefeed-h5api-bff`,
    "https://h5-api.aoneroom.com/wefeed-h5api-bff",
];
const MOBILE_API_BASES = ["https://api3.aoneroom.com", "https://apig.inmoviebox.com"];
const CLIENT_TIMEZONE = "Asia/Calcutta";

const AUDIO_TRACK_LABELS = [
    "Original",
    "Arabic Dub", "Arabic Hardsub", "Bengali Dub", "English Dub", "Español [Latino]",
    "French Dub", "German Dub", "Hindi Dub", "Hindi Hardsub", "Indonesian Dub",
    "Indonesian Hardsub", "Italian Dub", "Japanese Dub", "Kannada Dub", "Korean Dub",
    "Kurdish Dub", "Kurdish Hardsub", "Malay Dub", "Malayalam Dub", "Português",
    "Português [Brasil]", "Punjabi Dub", "Russian Dub", "Russian Hardsub", "Español",
    "Spanish Dub", "Spanish Hardsub", "Tagalog Dub", "Tamil Dub", "Telugu Dub",
    "Thai Dub", "Turkish Dub", "Urdu Dub",
];
const ALWAYS_ENABLED_TRACKS = ["Original", "English Dub"];
const DEFAULT_ENABLED_TRACKS = ["Hindi Dub", "Tamil Dub", "Telugu Dub", "Malayalam Dub"];
const REGIONAL_AUDIO_LABELS = {
    esla: "Español [Latino]",
    ptbr: "Português [Brasil]",
    es: "Español",
    spanish: "Español",
    pt: "Português",
    portuguese: "Português",
};
const LANGUAGE_NAMES = {
    en: "English", hi: "Hindi", ta: "Tamil", te: "Telugu", ml: "Malayalam",
    kn: "Kannada", bn: "Bengali", pa: "Punjabi", mr: "Marathi", gu: "Gujarati",
    ur: "Urdu", ar: "Arabic", es: "Spanish", pt: "Portuguese", fr: "French",
    de: "German", it: "Italian", ru: "Russian", ja: "Japanese", ko: "Korean",
    zh: "Chinese", th: "Thai", id: "Indonesian", in: "Indonesian", ms: "Malay",
    tl: "Tagalog", fil: "Filipino", tr: "Turkish", vi: "Vietnamese", nl: "Dutch",
    pl: "Polish", sv: "Swedish", fa: "Persian", he: "Hebrew", el: "Greek",
    ro: "Romanian", hu: "Hungarian", cs: "Czech", uk: "Ukrainian", da: "Danish",
    fi: "Finnish", no: "Norwegian", bg: "Bulgarian", hr: "Croatian", sr: "Serbian",
    sk: "Slovak", si: "Sinhala", ne: "Nepali", my: "Burmese", km: "Khmer",
    ku: "Kurdish", ha: "Hausa", sw: "Swahili", uz: "Uzbek", so: "Somali",
    ps: "Pashto", sd: "Sindhi", as: "Assamese", or: "Odia", ml2: "Malayalam",
};

const RESOLUTION_OPTIONS = [
    { settingKey: "res_2160p", resolution: "2160p", enabledByDefault: true },
    { settingKey: "res_1440p", resolution: "1440p", enabledByDefault: true },
    { settingKey: "res_1080p", resolution: "1080p", enabledByDefault: true },
    { settingKey: "res_720p", resolution: "720p", enabledByDefault: true },
    { settingKey: "res_480p", resolution: "480p", enabledByDefault: true },
    { settingKey: "res_360p", resolution: "360p", enabledByDefault: true },
];
const RESOLUTION_RANK = { "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "360p": 0.5, "240p": 0.25 };

const STREAM_MIME_TYPES = {
    hls: "application/vnd.apple.mpegurl",
    dash: "application/dash+xml",
    mp4: "video/mp4",
};

const SOURCE_TLDS = [
    "com", "net", "org", "io", "co", "tv", "cc", "pe", "pet", "mom", "ag", "bh",
    "party", "xyz", "site", "live", "me", "app", "dev", "info", "top", "fun",
    "pro", "cms", "biz", "link", "online", "club", "vip", "to", "in", "ru",
    "care", "one", "world", "watch", "stream", "download", "space", "tech",
    "art", "asia", "best", "buzz", "cam", "chat", "click", "cloud", "codes",
    "cool", "digital", "email", "expert", "family", "games", "guru", "help",
    "host", "life", "media", "money", "movie", "news", "photo", "pics", "press",
    "pub", "rocks", "run", "shop", "show", "social", "software", "studio",
    "support", "systems", "team", "tips", "today", "tools", "trade", "travel",
    "video", "videos", "vision", "website", "works", "zone", "wtf",
    "us", "uk", "de", "fr", "jp", "kr", "cn", "mx", "br", "ar", "tr", "za",
    "ng", "pl", "nl", "se", "gr", "at", "ch", "be", "dk", "fi", "no", "pt",
    "es", "it", "ro", "hu", "cz", "sk", "hr", "rs", "bg", "ae", "sa", "il",
    "eg", "pk", "bd", "np", "my", "th", "ph", "id", "vn", "ua", "kz", "uz",
    "ge", "am", "az", "ma", "dz", "tn", "ke", "gh", "tz", "ug", "sn", "ci",
    "cm", "zw", "zm", "png", "hk", "tw",
];

const DEVICE_ID = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0")
).join("");

const CLIENT_INFO = JSON.stringify({
    package_name: "com.community.mbox.in",
    version_name: "4.0.03.0920.03",
    version_code: 50020130,
    os: "android",
    os_version: "14",
    device_id: DEVICE_ID,
    install_store: "official",
    brand: "Google",
    model: "Pixel 8",
    system_language: "en",
    net: "NETWORK_WIFI",
    region: "IN",
    timezone: CLIENT_TIMEZONE,
    sp_code: "",
});

/* -------------------------------------------------------------------------- */
/* logging                                                                     */
/* -------------------------------------------------------------------------- */

const LOG_PREFIX = "[MovieBox]";
const LOG_BODY_PREVIEW = 300;
let requestCounter = 0;
let movieboxProxyAgent = null;
let movieboxProxyUrl = "";
let movieboxProxySelection = null;
const MOVIEBOX_PROXY_LIST_PATH = path.join(__dirname, "..", "utils", "moviebox-proxies.json");
const MOVIEBOX_PROXY_PROBE_URL = "https://httpbin.org/ip";
const MOVIEBOX_PROXY_PROBE_TIMEOUT_MS = 2500;
const MOVIEBOX_PROXY_PROBE_LIMIT = 100;
const MOVIEBOX_PREFERRED_PROXY = "http://4.144.146.21:80";

function logEnabled() {
    const settings = getSettings();
    const value = settings ? settings.debug_logs : null;
    if (value == null || value === "") return true;
    return !(value === false || value === "false");
}

function log(level, scope, message, data) {
    if (!logEnabled()) return;
    const fn = (typeof console !== "undefined" && (console[level] || console.log)) || null;
    if (!fn) return;
    const line = `${LOG_PREFIX}[${scope}] ${message}`;
    if (data !== undefined) fn.call(console, line, data);
    else fn.call(console, line);
}

const logDebug = (scope, message, data) => log("log", scope, message, data);
const logInfo = (scope, message, data) => log("info", scope, message, data);
const logWarn = (scope, message, data) => log("warn", scope, message, data);
const logError = (scope, message, data) => log("error", scope, message, data);

function maskSecret(value) {
    const text = String(value == null ? "" : value);
    if (!text) return "";
    if (text.length <= 16) return "***";
    return `${text.slice(0, 8)}...${text.slice(-6)} (len ${text.length})`;
}

function maskHeaders(headers) {
    const out = {};
    Object.keys(headers || {}).forEach((key) => {
        const lower = key.toLowerCase();
        const sensitive =
            lower === "authorization" || lower === "cookie" || lower === "x-client-token" ||
            lower === "x-tr-signature" || lower === "x-mb-token" || lower.includes("token") ||
            lower.includes("sign");
        out[key] = sensitive ? maskSecret(headers[key]) : headers[key];
    });
    return out;
}

function previewText(text, limit) {
    const value = String(text == null ? "" : text);
    const max = limit || LOG_BODY_PREVIEW;
    return value.length > max ? `${value.slice(0, max)}... (+${value.length - max} chars)` : value;
}

function nowMs() {
    return typeof Date !== "undefined" ? Date.now() : 0;
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function getSettings() {
    return globalThis.SCRAPER_SETTINGS || config.movieboxSettings || {};
}

function isValidMovieboxProxyUrl(value) {
    if (typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return url.protocol === "http:" && !!url.hostname && !!url.port &&
            !url.username && !url.password && url.pathname === "/" &&
            !url.search && !url.hash;
    } catch (error) {
        return false;
    }
}

function readToggle(key, fallback) {
    const settings = getSettings();
    const value = settings ? settings[key] : null;
    if (value == null || value === "") return fallback;
    return !(value === false || value === "false");
}

function getCrypto() {
    if (globalThis.CryptoJS) return globalThis.CryptoJS;
    try {
        if (typeof require === "function") return require("crypto-js");
    } catch (error) {
        return null;
    }
    return null;
}

function isUsableProxy(proxy) {
    if (!proxy || proxy.alive !== true || proxy.ssl !== true ||
        proxy.protocol !== "http" || proxy.anonymity === "transparent" ||
        !isValidMovieboxProxyUrl(proxy.proxy)) return false;
    return true;
}

function readMovieboxProxyCandidates() {
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(MOVIEBOX_PROXY_LIST_PATH, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            throw new Error("MovieBox proxy list is missing; download the ProxyScrape JSON from the admin panel");
        }
        throw new Error(`Unable to read MovieBox proxy list: ${error.message}`);
    }
    if (!payload || !Array.isArray(payload.proxies)) {
        throw new Error("MovieBox proxy list has an invalid JSON format");
    }
    return payload.proxies
        .filter(isUsableProxy)
        .sort((a, b) =>
            (Number(b.uptime) || 0) - (Number(a.uptime) || 0) ||
            (Number(a.timeout) || Infinity) - (Number(b.timeout) || Infinity)
        )
        .slice(0, MOVIEBOX_PROXY_PROBE_LIMIT);
}

async function selectMovieboxProxy() {
    const { ProxyAgent, fetch: undiciFetch } = require("undici");
    async function probeProxy(proxyUrl, label) {
        const agent = new ProxyAgent({ uri: proxyUrl, connectTimeout: MOVIEBOX_PROXY_PROBE_TIMEOUT_MS });
        try {
            const response = await undiciFetch(MOVIEBOX_PROXY_PROBE_URL, {
                dispatcher: agent,
                signal: AbortSignal.timeout(MOVIEBOX_PROXY_PROBE_TIMEOUT_MS),
            });
            const result = await response.json();
            if (response.ok && typeof result.origin === "string" && result.origin.trim()) {
                movieboxProxyAgent = agent;
                movieboxProxyUrl = proxyUrl;
                logInfo("proxy", `selected working proxy: ${label}`);
                return agent;
            }
            logWarn("proxy", `${label} probe failed with HTTP ${response.status}`);
        } catch (error) {
            logDebug("proxy", `${label} probe failed`, error.code || error.name);
        }
        try {
            await agent.close();
        } catch (error) {
            logWarn("proxy", `failed to close rejected ${label} agent`, error.message);
        }
        return null;
    }

    logInfo("proxy", `checking preferred proxy ${MOVIEBOX_PREFERRED_PROXY} first`);
    const preferredAgent = await probeProxy(MOVIEBOX_PREFERRED_PROXY, "preferred proxy");
    if (preferredAgent) return preferredAgent;

    const candidates = readMovieboxProxyCandidates();
    if (!candidates.length) throw new Error("Preferred MovieBox proxy is unavailable and the proxy list contains no usable HTTP proxies");

    logInfo("proxy", `preferred proxy unavailable; probing up to ${candidates.length} ProxyScrape HTTP proxies`);
    for (const [index, candidate] of candidates.entries()) {
        const agent = await probeProxy(candidate.proxy, `ProxyScrape proxy (${index + 1}/${candidates.length})`);
        if (agent) return agent;
    }
    throw new Error(`No working MovieBox proxy found after probing ${candidates.length} candidates`);
}

function getMovieboxProxyAgent() {
    if (movieboxProxyAgent) return Promise.resolve(movieboxProxyAgent);
    if (!movieboxProxySelection) {
        movieboxProxySelection = selectMovieboxProxy().finally(() => {
            movieboxProxySelection = null;
        });
    }
    return movieboxProxySelection;
}

async function movieboxFetch(url, options) {
    if (getSettings().proxy_enabled !== true) return fetch(url, options);
    const { fetch: undiciFetch } = require("undici");
    const agent = await getMovieboxProxyAgent();
    return undiciFetch(url, { ...options, dispatcher: agent });
}

function getMovieboxProxyStatus() {
    return {
        enabled: getSettings().proxy_enabled === true,
        selectedProxy: movieboxProxyUrl || null,
        listAvailable: fs.existsSync(MOVIEBOX_PROXY_LIST_PATH),
        probeLimit: MOVIEBOX_PROXY_PROBE_LIMIT,
    };
}

function clientTimezone() {
    return CLIENT_TIMEZONE;
}

function isResolutionEnabled(resolution) {
    if (!resolution || resolution === "Unknown") return true;
    const option = RESOLUTION_OPTIONS.find((entry) => entry.resolution === resolution);
    if (!option) return true;
    return readToggle(option.settingKey, option.enabledByDefault);
}

function audioTrackSettingKey(label) {
    return "dub_" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function extractLanguageBase(rawName) {
    return String(rawName || "").split(/\sdub/i)[0].split(/\ssub/i)[0].trim();
}

function isHardsubName(rawName) {
    return /\ssub/i.test(String(rawName || ""));
}

function toAudioTrackLabel(rawName) {
    const raw = String(rawName || "");
    if (/original/i.test(raw)) return "Original";
    const isHardsub = isHardsubName(raw);
    const base = extractLanguageBase(raw);
    if (!base) return capitalize(raw.trim());
    const regionalLabel = REGIONAL_AUDIO_LABELS[base.toLowerCase()];
    if (regionalLabel) return isHardsub ? `${regionalLabel} Hardsub` : regionalLabel;
    return `${capitalize(base)}${isHardsub ? " Hardsub" : " Dub"}`;
}

function toAudioDisplayName(rawName) {
    const regional = REGIONAL_AUDIO_LABELS[extractLanguageBase(rawName).toLowerCase()];
    if (regional) return regional;
    return String(rawName || "Original").replace(/\bdub\b/gi, "Audio").replace(/\bsub\b/gi, "Sub");
}

function toLanguageName(rawLanguage) {
    const raw = String(rawLanguage || "").trim();
    if (!raw) return "Unknown";
    const code = raw.toLowerCase();
    if (LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
    if (code.includes("_") || code.includes("-")) {
        const parts = code.split(/[_-]/);
        for (const part of parts) {
            if (LANGUAGE_NAMES[part]) return LANGUAGE_NAMES[part];
        }
    }
    return LANGUAGE_NAMES[code.split("-")[0]] || raw;
}

function toSourceLabel(rawSource) {
    const raw = String(rawSource || "").trim();
    if (!raw) return "";
    const host = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0];
    if (!host) return "";

    let parts = host.split(".").filter(Boolean);
    if (!parts.length) return "";
    if (parts.length > 1 && SOURCE_TLDS.includes(parts[parts.length - 1].toLowerCase())) {
        parts = parts.slice(0, -1);
    }
    if (parts.length > 1 && parts[0].length <= 2) parts = parts.slice(1);

    const words = parts.join(" ").split(/[^a-z0-9]+/i).filter(Boolean);
    if (!words.length) return "";
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function formatSize(bytes) {
    const value = Number(bytes);
    if (!isFinite(value) || value <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    const decimals = unitIndex >= 3 ? 2 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(decimals)} ${units[unitIndex]}`;
}

function toMimeType(format) {
    const key = String(format || "").toLowerCase();
    return STREAM_MIME_TYPES[key] || STREAM_MIME_TYPES.mp4;
}

function toStreamLanguage(rawName) {
    const raw = String(rawName || "").trim();
    if (!raw) return "Original";
    if (/original/i.test(raw)) return "Original";
    const base = extractLanguageBase(raw);
    if (!base) return "Original";
    const regional = REGIONAL_AUDIO_LABELS[base.toLowerCase()];
    if (regional) return regional.replace(/\s*\[[^\]]*\]\s*/g, "").trim() || regional;
    return toLanguageName(base) || "Original";
}

function buildTitleLine(subject, metadata) {
    const fallback = metadata && metadata.titles && metadata.titles[0];
    const rawTitle = String((subject && subject.title) || fallback || "").trim();
    const title = rawTitle.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
    let year = metadata && metadata.year ? metadata.year : null;
    if (!year && subject && subject.releaseDate) {
        const parsed = parseInt(String(subject.releaseDate).slice(0, 4), 10);
        if (!isNaN(parsed)) year = parsed;
    }
    if (!title) return "";
    return year ? `${title} (${year})` : title;
}

/* -------------------------------------------------------------------------- */
/* web (h5) api - primary source                                               */
/* -------------------------------------------------------------------------- */

let webToken = "";
let webTokenRequest = null;

function parseTokenHeader(raw) {
    if (!raw) return "";
    try {
        const parsed = JSON.parse(raw);
        const token = parsed && parsed.token;
        if (typeof token === "string" && token.split(".").length === 3) return token;
    } catch (error) {
        /* fall through */
    }
    return typeof raw === "string" && raw.split(".").length === 3 ? raw : "";
}

function buildClientToken(timestamp) {
    const cryptoJs = getCrypto();
    if (!cryptoJs) return "";
    const value = String(timestamp);
    return `${value},${cryptoJs.MD5(value.split("").reverse().join("")).toString()}`;
}

function buildDetailReferer(subjectId, detailPath) {
    if (!detailPath) return `${SITE_ORIGIN}/`;
    return `${SITE_ORIGIN}/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`;
}

async function requestWebToken() {
    for (const base of WEB_API_BASES) {
        const url = `${base}/country-code`;
        const started = nowMs();
        try {
            logDebug("token", `GET ${url}`);
            const response = await movieboxFetch(url, {
                headers: {
                    Accept: "application/json",
                    "User-Agent": WEB_USER_AGENT,
                    "X-Client-Info": JSON.stringify({ timezone: clientTimezone() }),
                    "X-Request-Lang": "en",
                    "X-Source": "",
                },
            });
            const rawHeader = response.headers.get("x-user");
            const token = parseTokenHeader(rawHeader);
            logDebug("token", `<- ${response.status} in ${nowMs() - started}ms`, {
                url,
                contentType: response.headers.get("content-type"),
                hasXUserHeader: !!rawHeader,
                tokenParsed: !!token,
                token: maskSecret(token),
            });
            if (token) {
                webToken = token;
                return token;
            }
            logWarn("token", `no usable token from ${base}, trying next base`);
        } catch (error) {
            logError("token", `request to ${url} failed after ${nowMs() - started}ms`, String(error && error.message || error));
        }
    }
    if (!webToken) logError("token", "could not obtain a web token from any base");
    return webToken;
}

function ensureWebToken(forceRefresh) {
    if (forceRefresh || !webTokenRequest) webTokenRequest = requestWebToken();
    return webTokenRequest;
}

function buildWebHeaders(token, referer, extra) {
    const headers = {
        Accept: "application/json",
        "User-Agent": WEB_USER_AGENT,
        "X-Client-Info": JSON.stringify({ timezone: clientTimezone() }),
        "X-Request-Lang": "en",
        "X-Source": "",
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
        headers.Cookie = `mb_token=%22${token}%22; i18n_lang=en`;
    } else {
        const clientToken = buildClientToken(Math.floor(Date.now() / 1000));
        if (clientToken) headers["X-Client-Token"] = clientToken;
    }
    if (referer) headers.Referer = referer;
    return Object.assign(headers, extra || {});
}

async function rawWebRequest(base, path, options) {
    const token = options.token !== undefined ? options.token : await ensureWebToken(false);
    const headers = buildWebHeaders(token, options.referer, options.extra);
    const init = { method: options.method || "GET", headers };
    if (options.body != null) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
    }
    const reqId = ++requestCounter;
    const fullUrl = `${base}${path}`;
    const started = nowMs();
    logDebug("http", `#${reqId} -> ${init.method} ${fullUrl}`, {
        headers: maskHeaders(headers),
        body: init.body ? previewText(init.body) : undefined,
    });
    let response;
    let text;
    try {
        response = await movieboxFetch(fullUrl, init);
        text = await response.text();
    } catch (error) {
        logError("http", `#${reqId} network error after ${nowMs() - started}ms: ${fullUrl}`, String(error && error.message || error));
        throw error;
    }
    let json = null;
    let parseError = null;
    try {
        json = JSON.parse(text);
    } catch (error) {
        json = null;
        parseError = String(error && error.message || error);
    }
    const summary = {
        status: response.status,
        contentType: response.headers.get("content-type"),
        responseType: json === null ? "non-json" : Array.isArray(json) ? "json-array" : "json-object",
        bytes: text.length,
        elapsedMs: nowMs() - started,
        apiCode: json && json.code,
        apiMessage: json && (json.message || json.reason),
        dataKeys: json && json.data && typeof json.data === "object" ? Object.keys(json.data) : undefined,
    };
    if (json === null) {
        logWarn("http", `#${reqId} <- ${response.status} ${fullUrl} (unparseable: ${parseError})`, {
            ...summary,
            bodyPreview: previewText(text),
        });
    } else if (!response.ok || json.code !== 0) {
        logWarn("http", `#${reqId} <- ${response.status} ${fullUrl} (api error)`, {
            ...summary,
            bodyPreview: previewText(text),
        });
    } else {
        logDebug("http", `#${reqId} <- ${response.status} ${fullUrl}`, summary);
    }
    return { response, json };
}

function looksLikeTokenProblem(response, json) {
    if (!json) return response.status === 401;
    if (response.status === 401) return true;
    if (response.status !== 400) return false;
    const message = String(json.message || json.reason || "");
    return /token/i.test(message);
}

function looksLikeRateLimit(response, json) {
    if (response && response.status === 429) return true;
    if (json && (json.code === 429 || json.reason === "RESOURCE_EXHAUSTED")) return true;
    return false;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* --------------------------------------------------------------------------
 * request throttling (tuned up from 3/120ms to 5/60ms)
 * ------------------------------------------------------------------------ */

const WEB_MAX_CONCURRENCY = 5;
const WEB_MIN_GAP_MS = 60;
const RATE_LIMIT_BACKOFF_MS = [600, 1500, 3500, 7000];

let webActive = 0;
let webLastRequestAt = 0;
const webWaiters = [];

async function acquireWebSlot() {
    if (webActive >= WEB_MAX_CONCURRENCY) {
        await new Promise((resolve) => webWaiters.push(resolve));
    } else {
        webActive += 1;
    }
    const wait = webLastRequestAt + WEB_MIN_GAP_MS - Date.now();
    if (wait > 0) await delay(wait);
    webLastRequestAt = Date.now();
}

function releaseWebSlot() {
    const next = webWaiters.shift();
    if (next) {
        next();
    } else {
        webActive -= 1;
    }
}

async function webApi(base, path, options) {
    const opts = options || {};
    const maxAttempts = opts.maxAttempts || RATE_LIMIT_BACKOFF_MS.length + 1;
    let token = opts.token !== undefined ? opts.token : await ensureWebToken(false);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await acquireWebSlot();
        let result;
        try {
            result = await rawWebRequest(base, path, Object.assign({}, opts, { token }));
        } catch (error) {
            releaseWebSlot();
            logError("webApi", `attempt ${attempt + 1}/${maxAttempts} threw for ${base}${path}`, String(error && error.message || error));
            return null;
        }
        releaseWebSlot();

        if (looksLikeRateLimit(result.response, result.json)) {
            if (attempt < maxAttempts - 1) {
                const wait = RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length - 1)];
                logWarn("webApi", `rate limited (429) on ${path}; retry ${attempt + 2}/${maxAttempts} in ${wait}ms`);
                await delay(wait);
                continue;
            }
            logError("webApi", `rate limited (429) on ${path}; giving up after ${maxAttempts} attempts`);
            return null;
        }

        if (looksLikeTokenProblem(result.response, result.json)) {
            logWarn("webApi", `token rejected (${result.response.status}) on ${path}; refreshing token`);
            const fresh = await ensureWebToken(true);
            if (fresh && fresh !== token) {
                token = fresh;
                try {
                    await acquireWebSlot();
                    result = await rawWebRequest(base, path, Object.assign({}, opts, { token: fresh }));
                } catch (error) {
                    releaseWebSlot();
                    logError("webApi", `retry with fresh token threw for ${base}${path}`, String(error && error.message || error));
                    return null;
                }
                releaseWebSlot();
                logInfo("webApi", `retry with fresh token -> ${result.response.status}`);
            } else {
                logWarn("webApi", "token refresh did not produce a new token");
            }
        }
        if (!result.json || result.json.code !== 0) {
            logWarn("webApi", `no usable payload for ${base}${path}`, {
                status: result.response.status,
                code: result.json && result.json.code,
                message: result.json && (result.json.message || result.json.reason),
            });
            return null;
        }
        return result.json.data;
    }
    return null;
}

async function searchCatalog(keyword, subjectType) {
    logInfo("search", `catalog search keyword="${keyword}" subjectType=${subjectType}`);
    for (const base of WEB_API_BASES) {
        const data = await webApi(base, "/subject/search", {
            method: "POST",
            body: { keyword, page: 1, perPage: 20, subjectType: subjectType },
            referer: `${SITE_ORIGIN}/`,
        });
        const items = data && data.items;
        if (Array.isArray(items) && items.length) {
            logInfo("search", `${items.length} result(s) from ${base}`,
                items.slice(0, 10).map((item) => ({
                    subjectId: item.subjectId,
                    title: item.title,
                    subjectType: item.subjectType,
                    releaseDate: item.releaseDate,
                    detailPath: item.detailPath,
                })));
            return items;
        }
        logWarn("search", `no items from ${base} for "${keyword}"`);
    }
    return [];
}

/* Shared cache: used both by the initial candidate detail and by per-track
   source lookups. Prevents fetching the same detailPath twice. */
const trackSourceCache = new Map();
const subjectDetailCache = new Map();

async function fetchTrackSource(detailPath) {
    if (!detailPath) return "";
    if (trackSourceCache.has(detailPath)) {
        logDebug("source", `cache hit for ${detailPath}`);
        return trackSourceCache.get(detailPath);
    }
    const pending = fetchSubjectDetailCached(detailPath, null)
        .then((detail) => {
            const resource = detail && detail.resource;
            const source = resource && resource.source ? String(resource.source) : "";
            logDebug("source", `detailPath=${detailPath} source="${source}"`);
            return source;
        })
        .catch((error) => {
            logWarn("source", `failed to fetch source for ${detailPath}`, String(error && error.message || error));
            return "";
        });
    trackSourceCache.set(detailPath, pending);
    return pending;
}

async function fetchSubjectDetail(detailPath, season) {
    for (const base of WEB_API_BASES) {
        const query = season != null && season !== undefined
            ? `?detailPath=${encodeURIComponent(detailPath)}&se=${encodeURIComponent(season)}`
            : `?detailPath=${encodeURIComponent(detailPath)}`;
        const data = await webApi(base, `/detail${query}`, {
            referer: `${SITE_ORIGIN}/detail/${detailPath}`,
        });
        if (data && data.subject) {
            logDebug("detail", `detail ok from ${base} for ${detailPath}`, {
                subjectId: data.subject.subjectId,
                title: data.subject.title,
                dubs: Array.isArray(data.subject.dubs) ? data.subject.dubs.length : 0,
                resourceSource: data.resource && data.resource.source,
            });
            return data;
        }
        logWarn("detail", `no subject from ${base} for ${detailPath}`);
    }
    return null;
}

function fetchSubjectDetailCached(detailPath, season) {
    const key = `${detailPath}|${season == null ? "" : season}`;
    if (!subjectDetailCache.has(key)) {
        subjectDetailCache.set(key, fetchSubjectDetail(detailPath, season));
    }
    return subjectDetailCache.get(key);
}

async function fetchPlayPayload(subjectId, season, episode, detailPath) {
    const query = new URLSearchParams();
    query.set("subjectId", String(subjectId));
    query.set("se", String(season));
    query.set("ep", String(episode));
    query.set("detailPath", String(detailPath || ""));
    query.set("streamSignType", "1");
    query.append("supportCodecs[hevc]", "1");
    query.append("supportCodecs[h264]", "1");

    const referer = buildDetailReferer(subjectId, detailPath);
    logInfo("play", `play payload subjectId=${subjectId} se=${season} ep=${episode}`, { referer });
    for (const base of WEB_API_BASES) {
        const data = await webApi(base, `/subject/play?${query.toString()}`, { referer });
        if (!data) {
            logWarn("play", `no payload from ${base}`);
            continue;
        }
        const hasStreams = (Array.isArray(data.dash) && data.dash.length) ||
            (Array.isArray(data.hls) && data.hls.length);
        logDebug("play", `payload from ${base}`, {
            hasResource: data.hasResource,
            dash: Array.isArray(data.dash) ? data.dash.length : 0,
            hls: Array.isArray(data.hls) ? data.hls.length : 0,
            streams: Array.isArray(data.streams) ? data.streams.length : 0,
        });
        if (data.hasResource || hasStreams) return data;
        logWarn("play", `payload from ${base} has no resource/streams (check Referer)`);
    }
    return null;
}

const captionCache = new Map();

async function fetchWebCaptions(subjectId, detailPath, streamRowId, format) {
    if (!subjectId || !detailPath || !streamRowId) return [];
    const kind = String(format || "DASH").toUpperCase();
    const query = new URLSearchParams();
    query.set("format", kind);
    query.set("id", String(streamRowId));
    query.set("subjectId", String(subjectId));
    query.set("detailPath", String(detailPath));

    const referer = buildDetailReferer(subjectId, detailPath);
    const cacheKey = `${kind}|${streamRowId}|${subjectId}|${detailPath}`;
    if (captionCache.has(cacheKey)) {
        logDebug("captions", `cache hit ${cacheKey}`);
        return captionCache.get(cacheKey);
    }

    logInfo("captions", `fetching captions format=${kind} rowId=${streamRowId} subjectId=${subjectId}`);
    for (const base of WEB_API_BASES) {
        const data = await webApi(base, `/subject/caption?${query.toString()}`, { referer });
        if (!data) {
            logWarn("captions", `no payload from ${base}`);
            continue;
        }
        const captions = data.captions;
        if (!Array.isArray(captions)) {
            logWarn("captions", `payload from ${base} has no captions array`, { keys: Object.keys(data) });
            continue;
        }
        if (!captions.length) {
            logInfo("captions", `0 captions for subjectId=${subjectId} rowId=${streamRowId}`);
            captionCache.set(cacheKey, []);
            return [];
        }
        const mapped = [];
        const seen = new Set();
        captions.forEach((caption) => {
            if (!caption) return;
            const url = caption.url || caption.subtitleUrl || caption.captionUrl || caption.src;
            if (!url || seen.has(url)) return;
            seen.add(url);
            const rawCode = caption.lan || caption.language || caption.lanCode || "";
            const rawName = caption.lanName || caption.name || "";
            const language = toLanguageName(rawCode) || toLanguageName(rawName) || "Unknown";
            mapped.push({
                url,
                language,
                name: rawName || language,
                lang: rawCode || language,
            });
        });
        captionCache.set(cacheKey, mapped);
        logInfo("captions", `${mapped.length} caption(s) for subjectId=${subjectId}`, mapped.map((c) => c.language));
        return mapped;
    }
    logWarn("captions", `no captions resolved for subjectId=${subjectId} rowId=${streamRowId}`);
    return [];
}

/* -------------------------------------------------------------------------- */
/* mobile api - secondary source                                               */
/* -------------------------------------------------------------------------- */

function md5Hex(text) {
    const cryptoJs = getCrypto();
    if (!cryptoJs) return "";
    return cryptoJs.MD5(text).toString();
}

function buildCanonicalString({ method, accept, contentType, url, body, timestamp }) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/[^\\/?#]*([^?#]*)(?:\?([^#]*))?/i.exec(url);
    const path = match ? match[1] || "" : "";
    const rawQuery = match && match[2] ? match[2] : "";
    let canonicalUrl = path;
    if (rawQuery) {
        const sortedQuery = rawQuery
            .split("&")
            .map((part, index) => {
                const [key, value = ""] = part.split("=");
                return { key, value, index };
            })
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
            .map(({ key, value }) => `${key}=${value}`)
            .join("&");
        canonicalUrl = `${path}?${sortedQuery}`;
    }
    const bodyHash = body != null ? md5Hex(body) : "";
    const bodyLength = body != null ? String(new TextEncoder().encode(body).length) : "";
    return `${method.toUpperCase()}\n${accept}\n${contentType}\n${bodyLength}\n${timestamp}\n${bodyHash}\n${canonicalUrl}`;
}

function buildRequestSignature(request) {
    const cryptoJs = getCrypto();
    if (!cryptoJs) return "";
    const signingKey = cryptoJs.enc.Base64.parse(atob("NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw=="));
    const signature = cryptoJs.HmacMD5(buildCanonicalString(request), signingKey).toString(cryptoJs.enc.Base64);
    return `${request.timestamp}|2|${signature}`;
}

let mobileToken = "";
let mobileTokenRequest = null;

async function sendSignedRequest(method, url, body, withAuth) {
    const cryptoJs = getCrypto();
    if (!cryptoJs) return null;
    const timestamp = Date.now();
    const accept = "application/json";
    const contentType = method === "POST" ? "application/json; charset=utf-8" : "application/json";
    const headers = {
        "User-Agent": MOBILE_USER_AGENT,
        Accept: accept,
        "Content-Type": contentType,
        "x-client-token": buildClientToken(timestamp),
        "x-tr-signature": buildRequestSignature({ method, accept, contentType, url, body, timestamp }),
        "x-client-info": CLIENT_INFO,
        "x-client-status": "0",
    };
    if (withAuth && mobileToken) headers.Authorization = `Bearer ${mobileToken}`;
    const options = { method, headers };
    if (body != null) options.body = body;
    const reqId = ++requestCounter;
    const started = nowMs();
    logDebug("mobile", `#${reqId} -> ${method} ${url}`, {
        headers: maskHeaders(headers),
        body: body != null ? previewText(body) : undefined,
    });
    let response;
    try {
        response = await movieboxFetch(url, options);
    } catch (error) {
        logError("mobile", `#${reqId} network error after ${nowMs() - started}ms: ${url}`, String(error && error.message || error));
        throw error;
    }
    logDebug("mobile", `#${reqId} <- ${response.status} ${url}`, {
        contentType: response.headers.get("content-type"),
        elapsedMs: nowMs() - started,
        hasXUserHeader: !!response.headers.get("x-user"),
    });
    const refreshed = parseTokenHeader(response.headers.get("x-user"));
    if (refreshed) {
        mobileToken = refreshed;
        mobileTokenRequest = Promise.resolve(refreshed);
    }
    return response;
}

async function requestMobileToken() {
    for (const base of MOBILE_API_BASES) {
        try {
            const response = await sendSignedRequest(
                "GET",
                `${base}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`,
                null,
                false
            );
            if (!response) continue;
            const token = parseTokenHeader(response.headers.get("x-user"));
            if (token) {
                mobileToken = token;
                return token;
            }
        } catch (error) {
            /* try next base */
        }
    }
    return mobileToken;
}

function ensureMobileToken(forceRefresh) {
    if (forceRefresh || !mobileTokenRequest) mobileTokenRequest = requestMobileToken();
    return mobileTokenRequest;
}

async function callMobileApi(method, pathAndQuery, body) {
    for (const base of MOBILE_API_BASES) {
        try {
            const url = `${base}${pathAndQuery}`;
            const tokenBefore = mobileToken;
            let response = await sendSignedRequest(method, url, body, true);
            if (!response) continue;
            if ([401, 441, 403].includes(response.status)) {
                const refreshed = await ensureMobileToken(true);
                if (refreshed && refreshed !== tokenBefore) {
                    response = await sendSignedRequest(method, url, body, true);
                    if (!response) continue;
                }
            }
            if (response.status === 200) return response;
            logWarn("mobile", `non-200 (${response.status}) from ${url}, trying next base`);
        } catch (error) {
            logError("mobile", `request failed for ${base}${pathAndQuery}`, String(error && error.message || error));
        }
    }
    logWarn("mobile", `all mobile bases failed for ${pathAndQuery}`);
    return null;
}

async function fetchMobileJson(method, pathAndQuery, payload) {
    const response = await callMobileApi(method, pathAndQuery, payload ? JSON.stringify(payload) : null);
    if (!response) return null;
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/* tmdb metadata + matching                                                    */
/* -------------------------------------------------------------------------- */

async function fetchTmdbMetadata(tmdbId, mediaType) {
    const tmdbKey = getTmdbApiKey();
    if (!tmdbKey) {
        logWarn("tmdb", "no TMDB API key configured");
        return null;
    }
    const isTv = mediaType === "tv";
    let details;
    const tmdbUrl = `${TMDB_BASE_URL}/${isTv ? "tv" : "movie"}/${encodeURIComponent(tmdbId)}`;
    const started = nowMs();
    try {
        logDebug("tmdb", `GET ${tmdbUrl}?api_key=${maskSecret(tmdbKey)}`);
        const response = await movieboxFetch(`${tmdbUrl}?api_key=${encodeURIComponent(tmdbKey)}`);
        logDebug("tmdb", `<- ${response.status} in ${nowMs() - started}ms`, {
            contentType: response.headers.get("content-type"),
        });
        if (!response.ok) {
            logWarn("tmdb", `non-OK response ${response.status} for ${tmdbUrl}`);
            return null;
        }
        details = await response.json();
    } catch (error) {
        logError("tmdb", `request failed for ${tmdbUrl}`, String(error && error.message || error));
        return null;
    }
    if (!details) {
        logWarn("tmdb", "empty details payload");
        return null;
    }

    const titles = [];
    [details.title, details.name, details.original_title, details.original_name].forEach((candidate) => {
        const title = candidate ? String(candidate).trim() : "";
        if (title && !titles.includes(title)) titles.push(title);
    });
    if (!titles.length) {
        logWarn("tmdb", "no titles in TMDB details");
        return null;
    }

    const year = parseInt(String(details.release_date || details.first_air_date || "").slice(0, 4), 10);
    const metadata = {
        titles,
        year: isNaN(year) ? null : year,
        rating: typeof details.vote_average === "number" && details.vote_average > 0 ? details.vote_average : null,
        isTv,
    };
    logInfo("tmdb", `metadata for ${tmdbId} (${mediaType})`, metadata);
    return metadata;
}

function normalizeTitle(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
        .replace(/[^a-z0-9\u00c0-\uffff ]/g, " ")
        .replace(/[\u2000-\u206f\u3000-\u303f\uff00-\uff0f\uff1a-\uff20]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function stripTitleNoise(text) {
    return String(text || "")
        .replace(/\[.*?\]/g, " ")
        .replace(/\(.*?\)/g, " ")
        .replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, " ")
        .replace(/\b(season|series)\b/gi, " ")
        .replace(/\bs\d{1,2}\b/gi, " ");
}

function titlesOverlap(a, b) {
    const tokensA = new Set(a.split(" ").filter(Boolean));
    const tokensB = new Set(b.split(" ").filter(Boolean));
    if (!tokensA.size || !tokensB.size) return false;
    let shared = 0;
    tokensA.forEach((token) => {
        if (tokensB.has(token)) shared++;
    });
    return shared >= Math.max(1, Math.floor((Math.min(tokensA.size, tokensB.size) * 3) / 4));
}

function scoreTitleMatch(rawTitle, expectedTitles) {
    const variants = [
        normalizeTitle(rawTitle.split("[")[0].replace(/\(.*?\)/g, " ")),
        normalizeTitle(stripTitleNoise(rawTitle)),
    ];
    let score = 0;
    for (const expected of expectedTitles) {
        const normalizedExpected = normalizeTitle(expected);
        if (!normalizedExpected) continue;
        for (const variant of variants) {
            if (!variant) continue;
            if (titlesOverlap(normalizedExpected, variant)) return 50;
            if (normalizedExpected.includes(variant) || variant.includes(normalizedExpected)) score = Math.max(score, 20);
        }
    }
    return score;
}

function scoreYearMatch(expectedYear, releaseDate) {
    const foundYear = parseInt(String(releaseDate || "").slice(0, 4), 10);
    if (expectedYear == null || isNaN(foundYear)) return 0;
    const difference = Math.abs(foundYear - expectedYear);
    if (difference === 0) return 40;
    if (difference === 1) return 20;
    if (difference >= 4) return -40;
    if (difference >= 2) return -15;
    return 0;
}

function scoreRatingMatch(expectedRating, ratingValue) {
    const foundRating = parseFloat(ratingValue);
    if (expectedRating == null || isNaN(foundRating)) return 0;
    const difference = Math.abs(foundRating - expectedRating);
    if (difference <= 0.5) return 10;
    if (difference <= 1.0) return 5;
    return 0;
}

function scoreSearchResult(result, metadata) {
    const rawTitle = String(result.title || "");
    const subjectType = parseInt(result.subjectType, 10);
    const resultIsTv = subjectType === 2 || subjectType === 7;
    return (
        scoreTitleMatch(rawTitle, metadata.titles) +
        scoreYearMatch(metadata.year, result.releaseDate) +
        scoreRatingMatch(metadata.rating, result.imdbRatingValue) +
        (metadata.isTv === resultIsTv ? 15 : -30) +
        (rawTitle.includes("[") ? 0 : 2)
    );
}

async function findMatchingSubjects(metadata) {
    const subjectType = metadata.isTv ? 2 : 1;
    const queries = [];
    metadata.titles.forEach((title) => {
        const normalized = normalizeTitle(title);
        if (!normalized) return;
        if (queries.some((entry) => normalizeTitle(entry) === normalized)) return;
        queries.push(title);
    });

    const scored = new Map();
    for (const query of queries) {
        let results = await searchCatalog(query, subjectType);
        if (!results.length && subjectType !== 0) {
            const fallback = await searchCatalog(query, 0);
            if (fallback.length) results = results.concat(fallback);
        }
        for (const result of results) {
            if (!result || result.subjectId == null || !result.title) continue;
            const score = scoreSearchResult(result, metadata);
            const key = String(result.subjectId);
            const previous = scored.get(key);
            if (!previous || score > previous.score) {
                scored.set(key, {
                    subjectId: String(result.subjectId),
                    subjectType: parseInt(result.subjectType, 10),
                    title: String(result.title || ""),
                    detailPath: result.detailPath || null,
                    score,
                });
            }
        }
    }

    const all = [...scored.values()].sort((a, b) => b.score - a.score);
    const ranked = all.filter((entry) => entry.score >= 40);
    logInfo("match", `${ranked.length}/${all.length} candidate(s) passed score threshold (>=40)`,
        all.slice(0, 10).map((entry) => ({
            subjectId: entry.subjectId,
            title: entry.title,
            score: entry.score,
            accepted: entry.score >= 40,
            detailPath: entry.detailPath,
        })));
    return ranked;
}

/* -------------------------------------------------------------------------- */
/* stream helpers                                                              */
/* -------------------------------------------------------------------------- */

function resolutionRank(resolution) {
    return RESOLUTION_RANK[resolution] || 0;
}

function splitResolutions(value) {
    const list = Array.isArray(value)
        ? value
        : String(value == null ? "" : value).split(/[,\s/|]+/);
    const found = [];
    list.forEach((item) => {
        const match = String(item).toLowerCase().match(/(\d{3,4})\s*p?/);
        if (!match) return;
        const resolution = `${parseInt(match[1], 10)}p`;
        if (resolution === "0p") return;
        if (!found.includes(resolution)) found.push(resolution);
    });
    return found;
}

function parseResolution(value) {
    const list = splitResolutions(value);
    if (!list.length) return "Unknown";
    let best = list[0];
    let bestRank = resolutionRank(best);
    list.forEach((resolution) => {
        const rank = resolutionRank(resolution);
        if (rank > bestRank) {
            bestRank = rank;
            best = resolution;
        }
    });
    return best;
}

function decodeBase64(value) {
    let padded = String(value).replace(/\s/g, "");
    const remainder = padded.length % 4;
    if (remainder > 0) padded += "=".repeat(4 - remainder);
    return atob(padded);
}

function manifestFromCookie(signCookie) {
    if (!signCookie) return null;

    const edgeMatch = /Edge-Cache-Cookie=urlprefix=([^:;\s]+)/.exec(signCookie);
    if (edgeMatch) {
        try {
            const prefix = decodeBase64(edgeMatch[1].replace(/_/g, "/").replace(/-/g, "+"));
            return `${prefix.replace(/\/+$/, "")}/index_web.mpd`;
        } catch (error) {
            return null;
        }
    }

    const policyMatch = /CloudFront-Policy=([^;]+)/.exec(signCookie);
    if (!policyMatch) return null;
    const encodedPolicy = policyMatch[1];
    const decodingAttempts = [
        encodedPolicy.replace(/-/g, "+").replace(/~/g, "/").replace(/_/g, "="),
        encodedPolicy.replace(/-/g, "+").replace(/_/g, "/"),
    ];
    for (const attempt of decodingAttempts) {
        try {
            const policy = JSON.parse(decodeBase64(attempt));
            const resource = policy && policy.Statement && policy.Statement[0] && policy.Statement[0].Resource;
            if (resource) {
                const trimmed = String(resource).replace(/[*\\/]+$/, "");
                return /\.mpd$/i.test(trimmed) ? trimmed : `${trimmed}/index_web.mpd`;
            }
        } catch (error) {
            /* try next decoding */
        }
    }
    return null;
}

function isPlaceholderStream(resolvedUrl, originalUrl) {
    if (!resolvedUrl) return true;
    return (
        resolvedUrl.includes("b164fbfb4347792950bdfbfb563d39d9") ||
        (resolvedUrl === originalUrl && originalUrl.includes("/other/2026/09/"))
    );
}

function detectStreamFormat(declaredFormat, url) {
    const format = String(declaredFormat || "").toUpperCase();
    if (format === "DASH" || url.includes(".mpd")) return "DASH";
    if (format === "HLS" || url.includes(".m3u8")) return "HLS";
    return "MP4";
}

function buildStreamHeaders(subjectId, detailPath, row) {
    const headers = {
        "User-Agent": WEB_USER_AGENT,
        Accept: "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        Connection: "keep-alive",
        "Sec-Fetch-Dest": "video",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "cross-site",
        DNT: "1",
        Referer: buildDetailReferer(subjectId, detailPath),
    };
    const signCookie = row && row.signCookie ? String(row.signCookie) : "";
    if (signCookie) {
        const headerKey = row.signHeaderKey && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(String(row.signHeaderKey))
            ? String(row.signHeaderKey)
            : "X-MB-Token";
        headers[headerKey] = signCookie;
        headers.Cookie = signCookie;
    }
    return headers;
}

function buildStreamCandidates(row, subjectId, detailPath, declaredFormat) {
    if (!row) return [];
    const originalUrl = row.url ? String(row.url).trim() : "";
    const signCookie = row.signCookie ? String(row.signCookie) : "";
    const resolvedUrl = originalUrl || manifestFromCookie(signCookie);
    if (!resolvedUrl) {
        logDebug("stream", `skip row id=${row.id} (${declaredFormat}): empty url and no cookie fallback`);
        return [];
    }
    if (isPlaceholderStream(resolvedUrl, originalUrl)) {
        logWarn("stream", `skip row id=${row.id} (${declaredFormat}): placeholder stream`, resolvedUrl);
        return [];
    }

    const format = detectStreamFormat(declaredFormat, resolvedUrl);
    const resolutions = splitResolutions(row.resolutions);
    const usable = resolutions.length ? resolutions : ["Unknown"];
    const headers = buildStreamHeaders(subjectId, detailPath, row);
    logDebug("stream", `row id=${row.id} -> ${format}`, {
        url: resolvedUrl,
        urlSource: originalUrl ? "api" : "cookie-fallback",
        resolutions: usable,
        size: row.size,
        headers: maskHeaders(headers),
    });

    return usable.map((resolution) => ({
        url: resolvedUrl,
        format,
        resolution,
        headers,
        rowId: row.id != null ? String(row.id) : "",
        size: row.size != null ? row.size : null,
        row,
    }));
}

function extractAudioTracks(subject, subjectId, detailPath) {
    let originalLanguage = "Original";
    const seenIds = new Set();
    const tracks = [];
    (Array.isArray(subject.dubs) ? subject.dubs : []).forEach((dub) => {
        if (!dub) return;
        const dubSubjectId = dub.subjectId != null ? String(dub.subjectId) : "";
        const language = dub.lanName ? String(dub.lanName) : "";
        if (!dubSubjectId || !language) return;
        if (dub.original === true || dubSubjectId === subjectId) {
            originalLanguage = language;
            return;
        }
        if (seenIds.has(dubSubjectId)) return;
        seenIds.add(dubSubjectId);
        tracks.push({
            subjectId: dubSubjectId,
            language,
            label: toAudioTrackLabel(language),
            detailPath: dub.detailPath || detailPath,
        });
    });
    tracks.unshift({ subjectId, language: originalLanguage, label: toAudioTrackLabel(originalLanguage), detailPath });
    return tracks;
}

/* -------------------------------------------------------------------------- */
/* track resolution                                                            */
/* -------------------------------------------------------------------------- */

function isTrackEnabled(track) {
    if (readToggle("all_audio_tracks", true)) return true;
    const label = track.label || toAudioTrackLabel(track.language);
    if (/Hardsub$/.test(label)) return readToggle("hardsub_tracks", true);
    if (ALWAYS_ENABLED_TRACKS.includes(label)) return true;
    return readToggle(audioTrackSettingKey(label), DEFAULT_ENABLED_TRACKS.includes(label));
}

/**
 * Runs the `play` request and the `source` lookup in parallel, and only the
 * caption call stays sequential (it needs the row id from `play`).
 */
async function resolveWebTrack(track, context) {
    const [payload, source] = await Promise.all([
        fetchPlayPayload(track.subjectId, context.season, context.episode, track.detailPath),
        fetchTrackSource(track.detailPath),
    ]);
    if (!payload) return [];

    const rows = [];
    (Array.isArray(payload.dash) ? payload.dash : []).forEach((row) => {
        buildStreamCandidates(row, track.subjectId, track.detailPath, row.format || "DASH").forEach((c) => rows.push(c));
    });
    (Array.isArray(payload.hls) ? payload.hls : []).forEach((row) => {
        buildStreamCandidates(row, track.subjectId, track.detailPath, row.format || "HLS").forEach((c) => rows.push(c));
    });
    (Array.isArray(payload.streams) ? payload.streams : []).forEach((row) => {
        buildStreamCandidates(row, track.subjectId, track.detailPath, row.format || "MP4").forEach((c) => rows.push(c));
    });

    const enabled = rows.filter((candidate) => isResolutionEnabled(candidate.resolution));
    logInfo("track", `web track "${track.label}" (${track.subjectId}): ${rows.length} rendition(s), ${enabled.length} enabled`);
    if (!enabled.length) return [];

    let subtitles = [];
    if (readToggle("subtitles", true)) {
        const primary = enabled[0];
        subtitles = await fetchWebCaptions(track.subjectId, track.detailPath, primary.rowId, primary.format).catch(() => []);
        if (!subtitles.length) {
            for (const candidate of enabled.slice(1, 3)) {
                if (!candidate.rowId) continue;
                subtitles = await fetchWebCaptions(track.subjectId, track.detailPath, candidate.rowId, candidate.format).catch(() => []);
                if (subtitles.length) break;
            }
        }
    }

    return enabled.map((candidate) =>
        Object.assign({}, candidate, { language: track.language, label: track.label, subtitles, source })
    );
}

async function resolveMobileTrack(track, context) {
    const json = await fetchMobileJson(
        "GET",
        `/wefeed-mobile-bff/subject-api/play-info?subjectId=${track.subjectId}&se=${context.season}&ep=${context.episode}`,
        null
    );
    const streams = json && json.data && json.data.streams;
    if (!Array.isArray(streams)) return [];

    const rows = [];
    streams.forEach((row) => {
        buildStreamCandidates(row, track.subjectId, track.detailPath, row.format).forEach((c) => rows.push(c));
    });
    const enabled = rows.filter((candidate) => isResolutionEnabled(candidate.resolution));
    if (!enabled.length) return [];

    const subtitles = readToggle("subtitles", true)
        ? await fetchMobileCaptions(track, context, enabled[0]).catch(() => [])
        : [];
    return enabled.map((candidate) =>
        Object.assign({}, candidate, { language: track.language, label: track.label, subtitles })
    );
}

async function fetchMobileCaptions(track, context, primary) {
    const encodedStreamId = encodeURIComponent(`${primary && primary.rowId ? primary.rowId : track.subjectId}`);
    const endpoints = [
        `/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${track.subjectId}&streamId=${encodedStreamId}`,
        `/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${track.subjectId}&resourceId=${encodedStreamId}&episode=0`,
    ];
    const responses = await Promise.all(
        endpoints.map((endpoint) => fetchMobileJson("GET", endpoint, null).catch(() => null))
    );
    const audioName = toAudioDisplayName(track.language);
    const seenUrls = new Set();
    const subtitles = [];
    responses.forEach((json) => {
        const captions = json && json.data && (json.data.extCaptions || json.data.captions);
        if (!Array.isArray(captions)) return;
        captions.forEach((caption) => {
            const url = caption && caption.url;
            if (!url || seenUrls.has(url)) return;
            seenUrls.add(url);
            const rawLanguage = caption.lanName || caption.language || caption.lan || "Unknown";
            const language = toLanguageName(rawLanguage);
            subtitles.push({ url, language, name: `${language} (${audioName})` });
        });
    });
    return subtitles;
}

async function resolveAudioTrack(track, context) {
    const started = nowMs();
    try {
        const webTracks = await resolveWebTrack(track, context).catch((error) => {
            logError("track", `web resolution failed for "${track.label}"`, String(error && error.message || error));
            return [];
        });
        let usedMobile = false;
        let candidates = webTracks;
        if (!webTracks.length) {
            logWarn("track", `web path returned nothing for "${track.label}", falling back to mobile API`);
            usedMobile = true;
            candidates = await resolveMobileTrack(track, context).catch((error) => {
                logError("track", `mobile resolution failed for "${track.label}"`, String(error && error.message || error));
                return [];
            });
        }
        if (!candidates.length) {
            logWarn("track", `no streams for "${track.label}" (${track.subjectId}) after ${nowMs() - started}ms`);
            return [];
        }
        logInfo("track", `"${track.label}": ${candidates.length} stream(s) via ${usedMobile ? "mobile" : "web"} API in ${nowMs() - started}ms`, {
            source: candidates[0].source,
            subtitles: candidates[0].subtitles ? candidates[0].subtitles.length : 0,
        });
        return candidates;
    } catch (error) {
        logError("track", `unexpected error resolving "${track.label}"`, String(error && error.stack || error));
        return [];
    }
}

function dedupeByStream(candidates) {
    const seen = new Set();
    return candidates.filter((candidate) => {
        if (!candidate || !candidate.url) return false;
        const key = [
            candidate.url,
            candidate.format,
            candidate.resolution,
            candidate.language,
        ].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function sortByResolution(candidates) {
    return candidates.slice().sort((a, b) => {
        const byResolution = resolutionRank(b.resolution) - resolutionRank(a.resolution);
        if (byResolution !== 0) return byResolution;
        return String(a.language || "").localeCompare(String(b.language || ""));
    });
}

function toStreamResult(candidate, position, context) {
    const language = toStreamLanguage(candidate.language);
    const quality = candidate.resolution && candidate.resolution !== "Unknown" ? candidate.resolution : "";
    const format = String(candidate.format || "").toLowerCase();
    const sizeLabel = formatSize(candidate.size);
    const sourceLabel = toSourceLabel(candidate.source);
    const head = context && context.titleLine ? context.titleLine : "";
    const details = [quality, sizeLabel, sourceLabel].filter(Boolean).join(" | ");
    const name = [`${PROVIDER} [${language}]`].concat(quality ? [quality] : []).join(" | ");

    return {
        name,
        title: details ? `${head}\n${details}` : head,
        url: candidate.url,
        quality,
        provider: PROVIDER,
        headers: candidate.headers,
        subtitles: Array.isArray(candidate.subtitles) ? candidate.subtitles : [],
        language,
        format,
        mimeType: toMimeType(candidate.format),
    };
}

/* --------------------------------------------------------------------------
 * Bounded-concurrency track resolver with early exit.
 * Returns as soon as `MIN_STREAMS_TO_RETURN` streams are collected, or after
 * every track has settled — whichever comes first.
 * ------------------------------------------------------------------------ */

const TRACK_CONCURRENCY = 6;
const MIN_STREAMS_TO_RETURN = 12;

async function resolveTracksWithEarlyExit(tracks, context) {
    const collected = [];
    const log = [];
    let nextIndex = 0;
    let inflight = 0;
    let done = false;

    return new Promise((resolve) => {
        const finish = (early) => {
            if (done) return;
            done = true;
            logInfo("tracks", `resolving finished${early ? " (early exit)" : ""} with ${collected.length} candidate(s) from ${log.length}/${tracks.length} track(s)`);
            resolve(collected);
        };

        const launch = () => {
            if (done) return;
            while (inflight < TRACK_CONCURRENCY && nextIndex < tracks.length) {
                const track = tracks[nextIndex++];
                inflight += 1;
                resolveAudioTrack(track, context)
                    .then((res) => {
                        log.push(track.label);
                        if (Array.isArray(res)) collected.push(...res);
                    })
                    .catch(() => {})
                    .finally(() => {
                        inflight -= 1;
                        if (!done && collected.length >= MIN_STREAMS_TO_RETURN) {
                            finish(true);
                            return;
                        }
                        if (nextIndex >= tracks.length && inflight === 0) {
                            finish(false);
                            return;
                        }
                        launch();
                    });
            }
            if (inflight === 0 && nextIndex >= tracks.length) finish(false);
        };

        if (!tracks.length) {
            finish(false);
        } else {
            launch();
        }
    });
}

/* -------------------------------------------------------------------------- */
/* public api                                                                  */
/* -------------------------------------------------------------------------- */

async function onSettings() {
    const layout = [
        { type: "header", label: PROVIDER },
        {
            type: "toggle",
            key: "subtitles",
            label: "Subtitles",
            defaultValue: true,
            description: "Attach every caption track the title offers to each stream",
        },
        {
            type: "toggle",
            key: "all_audio_tracks",
            label: "All audio tracks",
            defaultValue: true,
            description: "Return every dub / hardsub version of the title (turn off to use the per-track switches below)",
        },
        {
            type: "toggle",
            key: "hardsub_tracks",
            label: "Hardsub versions",
            defaultValue: true,
            description: "Include the 'burned-in subtitle' versions of a title",
        },
        {
            type: "toggle",
            key: "debug_logs",
            label: "Debug logs",
            defaultValue: true,
            description: "Print detailed request / response / pipeline logs to the console",
        },
        { type: "header", label: "Resolutions" },
        { type: "info", label: "All renditions are returned by default. Turn off the ones you do not want." },
    ];
    RESOLUTION_OPTIONS.forEach((option) => {
        layout.push({
            type: "toggle",
            key: option.settingKey,
            label: option.resolution,
            defaultValue: option.enabledByDefault,
        });
    });
    layout.push({ type: "header", label: "Audio tracks" });
    layout.push({
        type: "info",
        label: "Only used when 'All audio tracks' is off. Original and English Dub are always on.",
    });
    AUDIO_TRACK_LABELS.filter((label) => !ALWAYS_ENABLED_TRACKS.includes(label)).forEach((label) => {
        layout.push({
            type: "toggle",
            key: audioTrackSettingKey(label),
            label,
            defaultValue: DEFAULT_ENABLED_TRACKS.includes(label),
        });
    });
    return layout;
}

async function getStreams(tmdbId, mediaType, season, episode) {
    const startedAt = nowMs();
    logInfo("getStreams", `START tmdbId=${tmdbId} mediaType=${mediaType} season=${season} episode=${episode}`);
    try {
        const isTv = mediaType === "tv";
        if (!isTv && mediaType !== "movie") {
            logWarn("getStreams", `unsupported mediaType "${mediaType}"`);
            return [];
        }
        if (isTv && (season == null || episode == null)) {
            logWarn("getStreams", "TV request without season/episode");
            return [];
        }

        const [metadata] = await Promise.all([fetchTmdbMetadata(tmdbId, mediaType), ensureWebToken(false)]);
        if (!metadata) {
            logError("getStreams", "no TMDB metadata, aborting");
            return [];
        }

        const candidates = await findMatchingSubjects(metadata);
        if (!candidates.length) {
            logWarn("getStreams", "no matching MovieBox subject found");
            return [];
        }

        const context = {
            season: isTv ? Number(season) : 0,
            episode: isTv ? Number(episode) : 0,
        };

        for (const candidate of candidates) {
            logInfo("getStreams", `trying candidate "${candidate.title}" (${candidate.subjectId}, score ${candidate.score})`);
            const detail = await fetchSubjectDetailCached(candidate.detailPath, isTv ? Number(season) : null);
            const subject = detail && detail.subject;
            if (!subject) {
                logWarn("getStreams", `no detail for candidate ${candidate.subjectId}, skipping`);
                continue;
            }

            const subjectId = String(subject.subjectId || candidate.subjectId);
            const detailPath = subject.detailPath || candidate.detailPath;
            const allTracks = extractAudioTracks(subject, subjectId, detailPath);
            const tracks = allTracks.filter(isTrackEnabled);
            logInfo("getStreams", `audio tracks: ${tracks.length}/${allTracks.length} enabled`,
                allTracks.map((t) => ({ label: t.label, subjectId: t.subjectId, enabled: tracks.includes(t) })));
            if (!tracks.length) continue;

            const titleLine = buildTitleLine(subject, metadata);
            const flat = await resolveTracksWithEarlyExit(tracks, context);
            const deduped = dedupeByStream(flat);
            logInfo("getStreams", `candidate ${candidate.subjectId}: ${flat.length} raw -> ${deduped.length} after dedupe`);
            const streams = sortByResolution(deduped).map((candidate, index) =>
                toStreamResult(candidate, index, { titleLine })
            );
            if (streams.length) {
                logInfo("getStreams", `DONE ${streams.length} stream(s) in ${nowMs() - startedAt}ms`,
                    streams.map((s) => ({ name: s.name, format: s.format, quality: s.quality, subtitles: s.subtitles.length, url: s.url })));
                return streams;
            }
            logWarn("getStreams", `candidate ${candidate.subjectId} produced no streams, trying next`);
        }
        logWarn("getStreams", `DONE with 0 streams in ${nowMs() - startedAt}ms`);
        return [];
    } catch (error) {
        logError("getStreams", `unexpected failure after ${nowMs() - startedAt}ms`, String(error && error.stack || error));
        return [];
    }
}
const getMovieboxStreams = getStreams;
module.exports = { getStreams, getMovieboxStreams, onSettings, getMovieboxProxyStatus };