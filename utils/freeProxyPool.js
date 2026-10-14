"use strict";

const nodeFetch = require("node-fetch");
const { HttpsProxyAgent } = require("https-proxy-agent");

const PROXY_SOURCES = [
  {
    name: "ProxyScrape",
    url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text",
  },
  {
    name: "Scrappey",
    url: "https://scrappey.com/tools/free-proxy-lists",
  },
];
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const EMPTY_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHED_PROXIES = 100;
const USER_AGENT = "Mozilla/5.0 (compatible; TMDB-Embed-API/1.0)";

let cachedProxies = [];
let cacheExpiresAt = 0;
let loadingProxies = null;

function isPublicIpv4(value) {
  const parts = String(value || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function createCandidate(ip, port, source) {
  const portNumber = Number(port);
  if (!isPublicIpv4(ip) || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    return null;
  }
  // These lists label HTTP proxies by HTTPS support; CONNECT still targets HTTPS end-to-end.
  return { server: `http://${ip}:${portNumber}`, source };
}

function uniqueProxies(proxies) {
  const seen = new Set();
  return proxies.filter((proxy) => {
    if (!proxy || !proxy.server || seen.has(proxy.server)) return false;
    seen.add(proxy.server);
    return true;
  });
}

function parseProxyScrape(text) {
  const proxies = [];
  const linePattern = /^(?:(?:https?):\/\/)?((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})$/i;
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.trim().match(linePattern);
    if (!match) continue;
    const proxy = createCandidate(match[1], match[2], "ProxyScrape");
    if (proxy) proxies.push(proxy);
  }
  return uniqueProxies(proxies);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseScrappey(html) {
  const proxies = [];
  const rows = String(html || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = Array.from(row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (match) => stripHtml(match[1]));
    const ipIndex = cells.findIndex((cell) => isPublicIpv4(cell));
    if (ipIndex < 0) continue;

    const port = cells[ipIndex + 1];
    const protocol = cells.find((cell) => /^(?:http|https|socks4|socks5)$/i.test(cell));
    if (!/^(?:http|https)$/i.test(protocol || "")) continue;

    const proxy = createCandidate(cells[ipIndex], port, "Scrappey");
    if (proxy) proxies.push(proxy);
  }
  return uniqueProxies(proxies);
}

function shuffle(items) {
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled;
}

async function readProxySource(source, fetchImpl) {
  const response = await fetchImpl(source.url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/plain,text/html;q=0.9,*/*;q=0.8" },
    timeout: FETCH_TIMEOUT_MS,
    size: 2 * 1024 * 1024,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  return source.name === "ProxyScrape" ? parseProxyScrape(body) : parseScrappey(body);
}

async function getFreeProxies({ fetchImpl = nodeFetch, forceRefresh = false, max = 24 } = {}) {
  if (!forceRefresh && cacheExpiresAt > Date.now()) return cachedProxies.slice(0, max);
  if (!loadingProxies) {
    loadingProxies = Promise.allSettled(
      PROXY_SOURCES.map(async (source) => ({ source: source.name, proxies: await readProxySource(source, fetchImpl) })),
    )
      .then((results) => {
        const collected = [];
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index];
          const source = PROXY_SOURCES[index].name;
          if (result.status === "fulfilled") {
            console.log("[FreeProxyPool] source.loaded", { source, count: result.value.proxies.length });
            collected.push(...result.value.proxies);
          } else {
            console.warn("[FreeProxyPool] source.failed", { source });
          }
        }
        cachedProxies = shuffle(uniqueProxies(collected)).slice(0, MAX_CACHED_PROXIES);
        cacheExpiresAt = Date.now() + (cachedProxies.length ? CACHE_TTL_MS : EMPTY_CACHE_TTL_MS);
        return cachedProxies;
      })
      .finally(() => {
        loadingProxies = null;
      });
  }
  const proxies = await loadingProxies;
  return proxies.slice(0, max);
}

function headerValue(headers, targetName) {
  const match = Object.entries(headers || {}).find(([name]) => name.toLowerCase() === targetName.toLowerCase());
  return match ? match[1] : "";
}

function isVidcoreRequest(url, options = {}) {
  try {
    const target = new URL(url);
    if (target.protocol !== "https:") return false;
    if (target.hostname === "vidcore.io" || target.hostname.endsWith(".vidcore.io")) return true;
    const referer = headerValue(options.headers, "referer");
    const refererHost = referer ? new URL(referer).hostname : "";
    return refererHost === "vidcore.io" || refererHost.endsWith(".vidcore.io");
  } catch (_) {
    return false;
  }
}

function discardResponseBody(response) {
  if (response && response.body && typeof response.body.resume === "function") response.body.resume();
}

async function fetchWithFreeProxyFallback(url, options = {}, config = {}) {
  const request = config.request || nodeFetch;
  const shouldUseProxy = config.shouldUseProxy || isVidcoreRequest;
  const directResponse = await request(url, options);
  if (directResponse.status !== 403 || !shouldUseProxy(url, options)) return directResponse;

  let proxies;
  try {
    const getProxies = config.getProxies || getFreeProxies;
    proxies = await getProxies({ max: config.maxAttempts || 3 });
  } catch (_) {
    console.warn("[FreeProxyPool] proxy list unavailable after HTTP 403");
    return directResponse;
  }
  if (!Array.isArray(proxies) || !proxies.length) return directResponse;

  let lastResponse = directResponse;
  const maxAttempts = Math.max(1, config.maxAttempts || 3);
  for (const proxy of proxies.slice(0, maxAttempts)) {
    discardResponseBody(lastResponse);
    try {
      const agent = config.agentFactory
        ? config.agentFactory(proxy)
        : new HttpsProxyAgent(proxy.server);
      const response = await request(url, { ...options, agent });
      console.log("[FreeProxyPool] proxy.attempt", {
        source: proxy.source || "unknown",
        attempt: proxies.indexOf(proxy) + 1,
        status: response.status,
      });
      lastResponse = response;
      if (response.status !== 403 && ![407, 429, 500, 502, 503, 504].includes(response.status)) {
        return response;
      }
    } catch (_) {
      console.warn("[FreeProxyPool] proxy.failed", {
        source: proxy.source || "unknown",
        attempt: proxies.indexOf(proxy) + 1,
      });
    }
  }
  return lastResponse;
}

function clearProxyCache() {
  cachedProxies = [];
  cacheExpiresAt = 0;
  loadingProxies = null;
}

module.exports = {
  getFreeProxies,
  parseProxyScrape,
  parseScrappey,
  isVidcoreRequest,
  fetchWithFreeProxyFallback,
  clearProxyCache,
};
