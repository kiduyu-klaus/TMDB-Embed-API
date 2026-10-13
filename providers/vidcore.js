const axios = require("axios");

const VIDCORE_BASE = "https://vidcore.io";
const ENC_DEC_API = "https://enc-dec.app/api";
const REQUEST_TIMEOUT_MS = 10000;

const VIDCORE_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: `${VIDCORE_BASE}/`,
  "X-Requested-With": "XMLHttpRequest",
};

// ---------------------------------------------------------------------------
// HTTP client adapter (curl-cffi / curl-impersonate).
// The Python sample uses curl_cffi so requests carry a browser TLS fingerprint.
// All network I/O goes through get/post below, so adjusting the client library
// only requires editing createClient().
//
// Expected shape of the client: { get(url, {headers, timeout}) -> {status, text},
//                                 post(url, {headers, json, timeout}) -> {status, text} }
// ---------------------------------------------------------------------------
let clientPromise = null;

async function createClient() {
  let impersonate = null;
  try {
    // Adjust the module name / call below to match the curl-cffi package you install.
    impersonate = require("curl-cffi");
  } catch {
    impersonate = null;
  }

  if (impersonate && typeof impersonate.get === "function") {
    const wrap = (res) => ({
      status: res.status ?? res.statusCode,
      text:
        typeof res.text === "function"
          ? res.text()
          : (res.text ?? res.body ?? res.data ?? ""),
    });
    return {
      async get(url, { headers, timeout } = {}) {
        return wrap(
          await impersonate.get(url, {
            headers,
            timeout,
            impersonate: "chrome",
          }),
        );
      },
      async post(url, { headers, json, timeout } = {}) {
        return wrap(
          await impersonate.post(url, {
            headers,
            ...(json !== undefined ? { json } : {}),
            timeout,
            impersonate: "chrome",
          }),
        );
      },
    };
  }

  console.warn("[Vidcore] curl-cffi not available; falling back to axios");
  return {
    async get(url, { headers, timeout } = {}) {
      const res = await axios.get(url, {
        headers,
        timeout,
        responseType: "text",
        transformResponse: (d) => d,
      });
      return { status: res.status, text: String(res.data) };
    },
    async post(url, { headers, json, timeout } = {}) {
      const res = await axios.post(url, json, {
        headers,
        timeout,
        responseType: "text",
        transformResponse: (d) => d,
      });
      return { status: res.status, text: String(res.data) };
    },
  };
}

function getClient() {
  if (!clientPromise) clientPromise = createClient();
  return clientPromise;
}

async function httpGet(url, headers = {}) {
  const client = await getClient();
  const res = await client.get(url, { headers, timeout: REQUEST_TIMEOUT_MS });
  return await res.text;
}

async function httpPost(url, headers = {}, json) {
  const client = await getClient();
  const res = await client.post(url, {
    headers,
    json,
    timeout: REQUEST_TIMEOUT_MS,
  });
  return await res.text;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePayload(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Vidcore ${label} returned non-JSON response`);
  }
}

function validateResponse(data, path) {
  if (
    !data ||
    data.status !== 200 ||
    data.result === undefined ||
    data.result === null
  ) {
    const status = data && data.status !== undefined ? data.status : "unknown";
    const error = data && data.error ? String(data.error) : "unknown";
    throw new Error(
      `Vidcore API error at ${path} (status=${status}, error=${error})`,
    );
  }
  return parsePayload(data.result);
}

function inferStreamType(url, rawType) {
  const type = String(rawType || "").toLowerCase();
  if (type.includes("hls") || /\.m3u8(?:$|[?#])/i.test(url)) return "hls";
  if (type.includes("dash") || /\.mpd(?:$|[?#])/i.test(url)) return "dash";
  return "direct";
}

function normalizeQuality(value) {
  const quality = String(value || "Auto").trim();
  if (/^\d{3,4}$/.test(quality)) return `${quality}p`;
  return quality || "Auto";
}

function collectStreamCandidates(
  value,
  inherited = {},
  output = [],
  seenObjects = new Set(),
) {
  const parsed = parsePayload(value);
  if (!parsed || typeof parsed !== "object") return output;
  if (seenObjects.has(parsed)) return output;
  seenObjects.add(parsed);

  if (Array.isArray(parsed)) {
    parsed.forEach((item) =>
      collectStreamCandidates(item, inherited, output, seenObjects),
    );
    return output;
  }

  const quality =
    parsed.quality || parsed.label || parsed.resolution || inherited.quality;
  const language = parsed.language || parsed.lang || inherited.language;
  const url =
    parsed.url || parsed.file || parsed.src || parsed.playlist || parsed.link;
  if (isHttpUrl(url)) {
    output.push({
      url,
      quality,
      language,
      type: parsed.type || parsed.format || inherited.type,
      headers:
        parsed.headers && typeof parsed.headers === "object"
          ? parsed.headers
          : null,
    });
  }

  Object.entries(parsed).forEach(([key, child]) => {
    if (["url", "file", "src", "playlist", "link", "headers"].includes(key))
      return;
    const next = { ...inherited };
    if (/^\d{3,4}p?$/i.test(key)) next.quality = key;
    collectStreamCandidates(child, next, output, seenObjects);
  });
  return output;
}

function normalizeStreams(payload, serverLabel) {
  const candidates = collectStreamCandidates(payload);
  const seen = new Set();
  return candidates.flatMap((item) => {
    if (!isHttpUrl(item.url) || seen.has(item.url)) return [];
    if (/\.(?:srt|vtt|ass|ssa)(?:$|[?#])/i.test(item.url)) return [];
    seen.add(item.url);
    const type = inferStreamType(item.url, item.type);
    const quality = normalizeQuality(item.quality);
    return [
      {
        name: `Vidcore ${serverLabel}`,
        title: `Vidcore ${serverLabel} - ${quality}`,
        url: item.url,
        quality,
        provider: "vidcore",
        type,
        ...(type === "hls"
          ? { mimeType: "application/vnd.apple.mpegurl" }
          : {}),
        ...(type === "dash" ? { mimeType: "application/dash+xml" } : {}),
        headers: item.headers
          ? { Referer: VIDCORE_HEADERS.Referer, ...item.headers }
          : { Referer: VIDCORE_HEADERS.Referer },
      },
    ];
  });
}

function buildPageUrl(tmdbId, mediaType, seasonNum, episodeNum) {
  const isSeries = mediaType === "tv" || mediaType === "series";
  return isSeries
    ? `${VIDCORE_BASE}/tv/${encodeURIComponent(tmdbId)}/${seasonNum}/${episodeNum}/`
    : `${VIDCORE_BASE}/movie/${encodeURIComponent(tmdbId)}/`;
}

function extractToken(html) {
  const match = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
  return match ? match[1] : null;
}

async function apiGet(path, params) {
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${ENC_DEC_API}/${path}?${query}`;
  const text = await httpGet(url, {});
  return validateResponse(parseJson(text, path), url);
}

async function apiDecrypt(text) {
  const url = `${ENC_DEC_API}/dec-vidcore`;
  const responseText = await httpPost(
    url,
    { "Content-Type": "application/json" },
    { text },
  );
  return validateResponse(parseJson(responseText, "dec-vidcore"), url);
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------
async function fetchServerStream(server, streamBase, headers) {
  const data = server && server.data;
  if (!data) return [];
  const label = String(server.name || server.label || server.title || data);
  const encrypted = await httpPost(
    `${streamBase}/${data}`,
    headers,
    undefined,
  );
  if (!encrypted || encrypted.startsWith("<")) return [];
  const decrypted = await apiDecrypt(encrypted);
  return normalizeStreams(decrypted, label);
}

async function getVidcoreStreams(
  tmdbId,
  mediaType = "movie",
  seasonNum = null,
  episodeNum = null,
) {
  const isSeries = mediaType === "tv" || mediaType === "series";
  if (
    isSeries &&
    (!Number.isInteger(Number(seasonNum)) ||
      Number(seasonNum) < 1 ||
      !Number.isInteger(Number(episodeNum)) ||
      Number(episodeNum) < 1)
  ) {
    console.warn("[Vidcore] Series request is missing season or episode");
    return [];
  }

  const headers = { ...VIDCORE_HEADERS };
  let servers;
  let streamBase;

  try {
    // 1. Page -> content token
    const html = await httpGet(
      buildPageUrl(tmdbId, mediaType, seasonNum, episodeNum),
      headers,
    );
    const enToken = extractToken(html);
    if (!enToken) {
      console.error("[Vidcore] Content token not found on page.");
      return [];
    }

    // 2. Stage 1 -> servers-token request
    const stage1 = await apiGet("enc-vidcore", { text: enToken, stage: 1 });
    headers["X-CSRF-Token"] = stage1.token;
    const stage1Text = await httpPost(stage1.stage1, headers, undefined);

    // 3. Stage 2 -> servers / stream URLs + new token
    const stage2 = await apiGet("enc-vidcore", {
      text: stage1Text,
      stage: 2,
    });
    headers["X-CSRF-Token"] = stage2.token;
    streamBase = stage2.stream;

    // 4. Server list (encrypted) -> decrypt
    const serversEncrypted = await httpPost(stage2.servers, headers, undefined);
    const decrypted = await apiDecrypt(serversEncrypted);
    servers = Array.isArray(decrypted) ? decrypted : [];
  } catch (error) {
    console.error(`[Vidcore] Setup failed: ${error.message}`);
    return [];
  }

  if (!servers.length || !streamBase) {
    console.warn("[Vidcore] No servers returned.");
    return [];
  }

  const results = await Promise.allSettled(
    servers.map((server) => fetchServerStream(server, streamBase, headers)),
  );

  const streams = [];
  const seen = new Set();
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const reason =
        result.reason && result.reason.message
          ? result.reason.message
          : "unknown error";
      console.warn(`[Vidcore] Server #${index} failed: ${reason}`);
      return;
    }
    result.value.forEach((stream) => {
      if (seen.has(stream.url)) return;
      seen.add(stream.url);
      streams.push(stream);
    });
  });

  console.log(`[Vidcore] Emitted ${streams.length} unique stream(s)`);
  return streams;
}

module.exports = {
  getVidcoreStreams,
  buildPageUrl,
  extractToken,
  normalizeStreams,
};