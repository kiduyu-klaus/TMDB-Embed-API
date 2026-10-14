const { getDetails, getExternalIds } = require('../utils/tmdb');
const fetch = (url, options = {}) => require('node-fetch')(url, { timeout: 15000, ...options });
/**
 * moviesdrive - Built from src/moviesdrive/
 * Generated: 2026-09-22T10:00:32.946Z
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (const prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (const prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// ============================================================================
// moviesdrive diagnostic logger
// ----------------------------------------------------------------------------
// Primary control: env var MOVIESDRIVE_LOG_LEVEL (0..3). Set it before starting
// the process. All output is emitted through a single console.log channel.
//
//   0 = silent
//   1 = info / warn / error  (production tracing)
//   2 = + debug   (DEFAULT — every fetch URL + status, per-branch decisions)
//   3 = + trace   (most granular, including cheerio scan internals)
//
// Example (server):
//     MOVIESDRIVE_LOG_LEVEL=3 node your-app.js
//
// Ad-hoc runtime tweaks (REPL / debugger on a live process):
//     globalThis.__moviesdriveSetLevel(0)   // mute without restart
//     globalThis.__moviesdriveLogDump()     // dump in-memory buffer
// ============================================================================
var __MOVIESDRIVE_LOG_LEVEL = (function () {
  try {
    if (typeof globalThis !== "undefined" && typeof globalThis.__MOVIESDRIVE_LOG_LEVEL === "number") {
      return globalThis.__MOVIESDRIVE_LOG_LEVEL;
    }
  } catch (e) { /* Fall back to the environment setting. */ }
  if (typeof process !== "undefined" && process && process.env && process.env.MOVIESDRIVE_LOG_LEVEL) {
    var v = parseInt(process.env.MOVIESDRIVE_LOG_LEVEL, 10);
    if (!isNaN(v)) return v;
  }
  return 2;
})();
var __MOVIESDRIVE_LOG_PREFIX = "[MoviesDrive]";
var __moviesdriveLogSeq = 0;
var __moviesdriveLogBuffer = [];
var __MOVIESDRIVE_LOG_BUFFER_SIZE = 5000;

function __mdLog(stage, level, ...args) {
  try {
    var lvl = level === "error" || level === "warn" || level === "info" ? 1
            : level === "debug" ? 2
            : 3;
    if (__MOVIESDRIVE_LOG_LEVEL < lvl) return;
    var lvlTag = (level || "info").toUpperCase();
    var prefix = __MOVIESDRIVE_LOG_PREFIX + "[" + lvlTag + "][" + stage + "]#" + (++__moviesdriveLogSeq);
    // single output channel — all diagnostic traffic goes through console.log
    console.log(prefix, ...args);

    // small ring buffer for post-mortem inspection via globalThis.__moviesdriveLogDump()
    __moviesdriveLogBuffer.push({ ts: Date.now(), level: level, stage: stage, args: args });
    if (__moviesdriveLogBuffer.length > __MOVIESDRIVE_LOG_BUFFER_SIZE) {
      __moviesdriveLogBuffer.shift();
    }
  } catch (e) { /* logging must never break the caller */ }
}

function __mdTimer(stage, label) {
  if (__MOVIESDRIVE_LOG_LEVEL < 2) return function () {};
  var t = Date.now();
  return function () {
    var ms = Date.now() - t;
    __mdLog(stage, "debug", "elapsed_ms", ms, "(" + label + ")");
  };
}

async function __mdMapLimit(items, limit, mapper) {
  var results = new Array(items.length);
  var nextIndex = 0;
  var workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, async function () {
    while (nextIndex < items.length) {
      var index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

// ---------------------------------------------------------------------------
// Stream classification
// ---------------------------------------------------------------------------
// Infers playback format (hls | dash | direct) and MIME type from the URL
// extension. Anything we can't positively identify falls back to a direct
// progressive download with application/octet-stream — players will sniff
// the response either way.
function __mdInferFormat(url) {
  var u = String(url || "");
  if (/\.m3u8(\?|#|$)/i.test(u)) return { format: "hls",    mimeType: "application/x-mpegURL" };
  if (/\.mpd(\?|#|$)/i.test(u))  return { format: "dash",   mimeType: "application/dash+xml" };
  if (/\.mp4(\?|#|$)/i.test(u))  return { format: "direct", mimeType: "video/mp4" };
  if (/\.mkv(\?|#|$)/i.test(u))  return { format: "direct", mimeType: "video/x-matroska" };
  if (/\.webm(\?|#|$)/i.test(u)) return { format: "direct", mimeType: "video/webm" };
  if (/\.mov(\?|#|$)/i.test(u))  return { format: "direct", mimeType: "video/quicktime" };
  if (/\.ts(\?|#|$)/i.test(u))   return { format: "direct", mimeType: "video/mp2t" };
  return { format: "direct", mimeType: "application/octet-stream" };
}

function __mdIsGoogleDownloadUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase() === "video-downloads.googleusercontent.com";
  } catch (e) {
    return false;
  }
}

// Wraps the raw extractor output with the metadata consumers expect:
//   - title     : human-readable label
//   - provider  : source identifier
//   - headers   : request headers the player should replay
//   - format    : "hls" | "dash" | "direct"
//   - mimeType  : inferred content type
async function __mdGetResponseHeaders(url) {
  var response;
  try {
    response = await fetch(url, { method: "GET", headers: HEADERS, redirect: "follow" });
    var responseHeaders = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name.toLowerCase()] = value;
    });
    __mdLog("getMoviesDriveStreams", "debug", "stream.response-headers", {
      status: response.status,
      headerNames: Object.keys(responseHeaders)
    });
    return responseHeaders;
  } catch (e) {
    __mdLog("getMoviesDriveStreams", "warn", "stream.response-headers.failed", {
      url,
      error: e && e.message || String(e)
    });
    return {};
  } finally {
    // Fetch resolves as soon as response headers arrive. Stop the body stream
    // immediately so metadata lookup never downloads the video itself.
    if (response && response.body && typeof response.body.destroy === "function") {
      response.body.destroy();
    }
  }
}

async function __mdEnrichStream(s, titlePrefix) {
  var fmt = __mdInferFormat(s && s.url);
  __mdLog("getMoviesDriveStreams", "debug", "stream.enrich", {
    name: s && s.name,
    url: s && s.url,
    format: fmt.format,
    mimeType: fmt.mimeType
  });
  var headers = __spreadValues({}, HEADERS);
  try {
    if (new URL(s && s.url).hostname.toLowerCase() === "video-downloads.googleusercontent.com") {
      headers = __spreadValues(headers, await __mdGetResponseHeaders(s.url));
    }
  } catch (e) { /* Non-HTTP or malformed URLs are handled by the caller. */ }
  return __spreadProps(__spreadValues({}, s), {
    title: titlePrefix + s.name + " [" + s.quality + "p]",
    provider: "moviesdrive",
    language: " English . Hindi",
    headers,
    format: fmt.format,
    mimeType: fmt.mimeType
  });
}

// src/moviesdrive/index.js
var import_cheerio_without_node_native2 = __toESM(require("cheerio"));

// src/moviesdrive/constants.js
var MAIN_URL = "https://new4.moviesdrive.christmas";
var DOMAINS_URL = "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "max-age=0",
  "Connection": "keep-alive"
};

__mdLog("BOOT", "info", "module loaded", {
  mainUrl: MAIN_URL,
  domainsUrl: DOMAINS_URL,
  logLevel: __MOVIESDRIVE_LOG_LEVEL
});

// src/moviesdrive/utils.js
var import_cheerio_without_node_native = __toESM(require("cheerio"));
var cachedMainUrl = "";

function getMainUrl() {
  return __async(this, null, function* () {
    var end = __mdTimer("getMainUrl", "total");
    __mdLog("getMainUrl", "info", "start", { cached: !!cachedMainUrl });
    if (cachedMainUrl) {
      __mdLog("getMainUrl", "debug", "cache hit", cachedMainUrl);
      end();
      return cachedMainUrl;
    }
    try {
      __mdLog("getMainUrl", "debug", "fetch", DOMAINS_URL);
      var response = yield fetch(DOMAINS_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
      __mdLog("getMainUrl", "debug", "fetch.status", response.status, "ok=", response.ok);
      var data = yield response.json();
      cachedMainUrl = data.moviesdrive || MAIN_URL;
      __mdLog("getMainUrl", "info", "resolved", {
        url: cachedMainUrl,
        source: data.moviesdrive ? "domains.json" : "fallback"
      });
      end();
      return cachedMainUrl;
    } catch (e) {
      __mdLog("getMainUrl", "warn", "domain lookup failed, using fallback", {
        fallback: MAIN_URL,
        error: e && e.message || String(e)
      });
      cachedMainUrl = MAIN_URL;
      end();
      return MAIN_URL;
    }
  });
}

function getIndexQuality(str) {
  __mdLog("getIndexQuality", "debug", "input", str);
  if (!str) {
    __mdLog("getIndexQuality", "debug", "empty input, default 1080");
    return 1080;
  }
  var match = str.match(/(\d{3,4})[pP]/);
  if (match) {
    var q = parseInt(match[1]);
    __mdLog("getIndexQuality", "debug", "matched numeric", { quality: q, token: match[1] });
    return q;
  }
  if (str.toUpperCase().includes("4K") || str.toUpperCase().includes("2160P") || str.toUpperCase().includes("UHD")) {
    __mdLog("getIndexQuality", "debug", "matched 4K tag", { quality: 2160 });
    return 2160;
  }
  __mdLog("getIndexQuality", "debug", "no match, default 1080");
  return 1080;
}

function extractMdrive(url) {
  return __async(this, null, function* () {
    var end = __mdTimer("extractMdrive", "total");
    __mdLog("extractMdrive", "info", "start", { url });
    if (!url) {
      __mdLog("extractMdrive", "debug", "empty url, returning []");
      end();
      return [];
    }
    var regex = /hubcloud|gdflix|gdlink/i;
    // search-recover.php is a resolver page, not a final drive/file URL.
    // Do not short-circuit it or the recovery API below is never reached.
    if (regex.test(url) && !url.includes("search-recover.php") && (url.includes("/drive/") || url.includes("/file/"))) {
      __mdLog("extractMdrive", "info", "short-circuit (already a final drive/file URL)", { url });
      end();
      return [url];
    }
    try {
      var fetchHeaders = __spreadProps(__spreadValues({}, HEADERS), { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
      __mdLog("extractMdrive", "debug", "fetch.page", url);
      var res = yield fetch(url, { headers: fetchHeaders });
      __mdLog("extractMdrive", "debug", "fetch.page.status", { status: res.status, ok: res.ok, finalUrl: res.url });
      var html = yield res.text();
      __mdLog("extractMdrive", "debug", "fetch.page.bytes", html.length);

      if (url.includes("search-recover.php")) {
        __mdLog("extractMdrive", "info", "search-recover branch");
        var qMatch = html.match(/const\s+Q_INITIAL\s*=\s*["']([^"']+)["']/) ||
          [null, new URL(url).searchParams.get("q") || ""];
        var tokenMatch = html.match(/const\s+FROM_AC_TOKEN\s*=\s*["']([^"']+)["']/) ||
          [null, new URL(url).searchParams.get("from_ac") || ""];
        __mdLog("extractMdrive", "debug", "search-recover.tokens", {
          q: qMatch && qMatch[1],
          from_ac: tokenMatch && tokenMatch[1]
        });
        if (qMatch && tokenMatch) {
          var apiBase = new URL(url).origin;
          var searchParams = new URLSearchParams({
            api: "search",
            q: qMatch[1],
            page: "1",
            from_ac: tokenMatch[1]
          });
          var apiUrl = apiBase + "/drive/search-recover.php?" + searchParams.toString();
          __mdLog("extractMdrive", "debug", "fetch.api", apiUrl);
          var apiRes = yield fetch(apiUrl, {
            headers: __spreadProps(__spreadValues({}, HEADERS), { "Accept": "application/json", Referer: url, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" })
          });
          __mdLog("extractMdrive", "debug", "fetch.api.status", { status: apiRes.status, ok: apiRes.ok });
          var data = yield apiRes.json();
          if (data && data.hits) {
            __mdLog("extractMdrive", "info", "search-recover hits", data.hits.length);
            var urls = data.hits.map((h) => h.url || (h.document && h.document.url)).filter(Boolean);
            __mdLog("extractMdrive", "debug", "search-recover urls", { count: urls.length, urls });
            end();
            return urls;
          }
          __mdLog("extractMdrive", "debug", "search-recover no hits in data", data);
        }
      }

      var $ = import_cheerio_without_node_native.load(html);
      var allHrefs = $("a[href]").map((i, el) => $(el).attr("href")).get();
      var filtered = allHrefs.filter((href) => regex.test(href));
      __mdLog("extractMdrive", "info", "cheerio scan", {
        total: allHrefs.length,
        matched: filtered.length,
        matchedUrls: filtered
      });
      end();
      return filtered;
    } catch (e) {
      __mdLog("extractMdrive", "warn", "extraction failed", {
        url,
        error: e && e.message || String(e)
      });
      end();
      return [];
    }
  });
}

function hubCloudExtractor(url, referer) {
  return __async(this, null, function* () {
    var end = __mdTimer("hubCloudExtractor", "total");
    __mdLog("hubCloudExtractor", "info", "start", { url, referer });
    try {
      var currentUrl = url;
      __mdLog("hubCloudExtractor", "debug", "fetch.first", currentUrl);
      var pageResponse = yield fetch(currentUrl, {
        headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: referer })
      });
      __mdLog("hubCloudExtractor", "debug", "fetch.first.status", {
        status: pageResponse.status, ok: pageResponse.ok, finalUrl: pageResponse.url
      });
      if (!pageResponse.ok) {
        __mdLog("hubCloudExtractor", "warn", "first fetch not ok, returning []", { url: currentUrl });
        end();
        return [];
      }
      var pageData = yield pageResponse.text();
      __mdLog("hubCloudExtractor", "debug", "fetch.first.bytes", pageData.length);
      // Fetch follows hubcloud.cx -> hubcloud.ist redirects. Use the final URL
      // when resolving relative links and when sending the next Referer.
      var finalUrl = pageResponse.url || currentUrl;
      __mdLog("hubCloudExtractor", "debug", "finalUrl.afterFirst", finalUrl);

      if (!currentUrl.includes("hubcloud.php")) {
        __mdLog("hubCloudExtractor", "debug", "not hubcloud.php, looking for next href");
        var nextHref = "";
        var $first = import_cheerio_without_node_native.load(pageData);
        var phpLink = $first('a[href*="hubcloud.php"]').attr("href");
        if (phpLink) {
          nextHref = phpLink;
          __mdLog("hubCloudExtractor", "debug", "found hubcloud.php link", nextHref);
        } else {
          var downloadBtn = $first("#download");
          if (downloadBtn.length) {
            nextHref = downloadBtn.attr("href");
            __mdLog("hubCloudExtractor", "debug", "found #download link", nextHref);
          } else {
            var scriptUrlMatch = pageData.match(/var url = ["']([^"']*)["']/);
            if (scriptUrlMatch) {
              nextHref = scriptUrlMatch[1];
              __mdLog("hubCloudExtractor", "debug", "found var url from script", nextHref);
            } else {
              __mdLog("hubCloudExtractor", "debug", "no next href found in first page");
            }
          }
        }
        if (nextHref) {
          nextHref = new URL(nextHref, finalUrl).href;
          finalUrl = nextHref;
          __mdLog("hubCloudExtractor", "debug", "fetch.second", finalUrl);
          var secondResponse = yield fetch(finalUrl, {
            headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: currentUrl })
          });
          __mdLog("hubCloudExtractor", "debug", "fetch.second.status", {
            status: secondResponse.status, ok: secondResponse.ok, finalUrl: secondResponse.url
          });
          if (!secondResponse.ok) {
            __mdLog("hubCloudExtractor", "warn", "second fetch not ok, returning []", { url: finalUrl });
            end();
            return [];
          }
          finalUrl = secondResponse.url || finalUrl;
          __mdLog("hubCloudExtractor", "debug", "finalUrl.afterSecond", finalUrl);
          pageData = yield secondResponse.text();
          __mdLog("hubCloudExtractor", "debug", "fetch.second.bytes", pageData.length);
        }
      } else {
        __mdLog("hubCloudExtractor", "debug", "already on hubcloud.php, skipping redirect");
      }

      var $ = import_cheerio_without_node_native.load(pageData);
      var size = $("i#size").text().trim();
      var header = $("div.card-header").text().trim();
      var quality = getIndexQuality(header);
      var pxlMatch = pageData.match(/var\s+pxl\s*=\s*["']([^"']+)["']/i);
      __mdLog("hubCloudExtractor", "info", "page parsed", {
        size, header, quality, hasPxl: !!pxlMatch, pxl: pxlMatch && pxlMatch[1]
      });

      var links = [];
      var elements = $("a[href]").get();
      __mdLog("hubCloudExtractor", "debug", "anchor count", elements.length);
      var blocked = ["tinyurl", "telegram", "hubcloud.cx/tg", "hubcloud.foo/tg"];
      for (const el of elements) {
        var link = $(el).attr("href");
        var text = $(el).text().toLowerCase().trim();
        if (!link || blocked.some((b) => link.includes(b))) {
          __mdLog("hubCloudExtractor", "trace", "skip.blocked-or-empty", { link, text });
          continue;
        }
        if (link.includes("negn6f") && pxlMatch) {
          __mdLog("hubCloudExtractor", "debug", "negn6f branch -> using pxlMatch", {
            from: link, to: pxlMatch[1]
          });
          link = pxlMatch[1];
        }
        if (text.includes("fslv2")) {
          links.push({ name: "HubCloud - FSLv2", quality, url: link, size });
          __mdLog("hubCloudExtractor", "debug", "link.add", { type: "FSLv2", url: link });
        } else if (text.includes("fsl server") || text.includes("fsl") && !text.includes("v2")) {
          links.push({ name: "HubCloud - FSL Server", quality, url: link, size });
          __mdLog("hubCloudExtractor", "debug", "link.add", { type: "FSL Server", url: link });
        } else if (text.includes("download file") || text.includes("instant download") || text.includes("instant") || text.includes("10gbps")) {
          __mdLog("hubCloudExtractor", "debug", "instant branch enter", { url: link, text });
          var streamUrl = link;
          if (streamUrl.includes("link=")) {
            streamUrl = streamUrl.split("link=")[1];
            __mdLog("hubCloudExtractor", "debug", "instant.link-query split", streamUrl);
          } else {
            try {
              __mdLog("hubCloudExtractor", "debug", "instant.fetch", link);
              var res = yield fetch(link, {
                headers: __spreadProps(__spreadValues({}, HEADERS), { Referer: finalUrl }),
                redirect: "follow"
              });
              __mdLog("hubCloudExtractor", "debug", "instant.fetch.status", {
                status: res.status, ok: res.ok, finalUrl: res.url
              });
              var resolvedHtml = yield res.text();
              // PixelServer redirects to gamerxyt's link generator. Node's
              // fetch stops at /dl.php?link=..., while the browser executes
              // the page and exposes the same URL in #downloadBtn.
              if (res.url && res.url.includes("dl.php")) {
                try {
                  var generated = new URL(res.url).searchParams.get("link");
                  if (generated && generated.startsWith("http")) {
                    streamUrl = generated;
                    __mdLog("hubCloudExtractor", "debug", "instant.dl.php-link", streamUrl);
                  }
                } catch (e) {
                  __mdLog("hubCloudExtractor", "warn", "instant.dl.php-parse-fail", e && e.message || e);
                }
              }
              if (streamUrl === link && resolvedHtml) {
                var generatedMatch = resolvedHtml.match(/id=["']downloadBtn["'][^>]*href=["']([^"']+)["']/i) ||
                  resolvedHtml.match(/href=["']([^"']+)["'][^>]*id=["']downloadBtn["']/i) ||
                  resolvedHtml.match(/https:\/\/video-downloads\.googleusercontent\.com\/[^"'\s<]+/i);
                if (generatedMatch) {
                  streamUrl = generatedMatch[1] || generatedMatch[0];
                  __mdLog("hubCloudExtractor", "debug", "instant.downloadBtn-match", streamUrl);
                }
              }
              if (streamUrl.includes("link=")) {
                try {
                  streamUrl = new URL(streamUrl).searchParams.get("link") || streamUrl;
                  __mdLog("hubCloudExtractor", "debug", "instant.link-query-resolved", streamUrl);
                } catch (e) {
                  streamUrl = streamUrl.split("link=")[1];
                  __mdLog("hubCloudExtractor", "warn", "instant.link-query-fallback-split", streamUrl);
                }
              }
            } catch (e) {
              __mdLog("hubCloudExtractor", "warn", "instant.fetch-failed", {
                url: link, error: e && e.message || String(e)
              });
            }
          }
          // Some current 10Gbps links do not redirect outside a browser. Keep
          // the original URL when fetch cannot expose a redirect.
          if (streamUrl && streamUrl.startsWith("http")) {
            links.push({ name: "HubCloud - Instant", quality, url: streamUrl, size });
            __mdLog("hubCloudExtractor", "debug", "link.add", { type: "Instant", url: streamUrl });
          } else {
            __mdLog("hubCloudExtractor", "debug", "instant.no-stream-url", { original: link });
          }
        } else if (text.includes("pixeldra") || text.includes("pixelserver") || text.includes("pixeldrain") || link.includes("pixeldrain") || link.includes("pixel.hubcloud")) {
          var pUrl = link;
          if (pUrl.includes("/u/")) {
            var fileId = pUrl.split("/u/")[1].split("?")[0].replace("/", "");
            pUrl = `https://pixeldrain.dev/api/file/${fileId}?download`;
            __mdLog("hubCloudExtractor", "debug", "pixeldrain.rewrite", pUrl);
          }
          links.push({ name: "HubCloud - Pixeldrain", quality, url: pUrl, size });
          __mdLog("hubCloudExtractor", "debug", "link.add", { type: "Pixeldrain", url: pUrl });
        } else if (text.includes("buzzserver") || text.includes("buzz server") || text.includes("buzz") || text.includes("fuckingfast")) {
          __mdLog("hubCloudExtractor", "debug", "buzz branch enter", { url: link, text });
          try {
            var dlRes = yield fetch(link, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              }
            });
            __mdLog("hubCloudExtractor", "debug", "buzz.fetch.status", { status: dlRes.status, ok: dlRes.ok });
            var dlHtml = yield dlRes.text();
            var copyMatch = dlHtml.match(/copyDownloadLink\(['"]([^'"]+)['"]\)/);
            var dlPath = copyMatch ? copyMatch[1].replace(/\\\//g, "/") : null;
            __mdLog("hubCloudExtractor", "debug", "buzz.copyMatch", dlPath);
            var base = new URL(link).origin;
            var dlUrl = dlPath ? dlPath.startsWith("http") ? dlPath : `${base}${dlPath}` : link.endsWith("/download") ? link : `${link}/download`;
            __mdLog("hubCloudExtractor", "debug", "buzz.fetch.dlUrl", dlUrl);
            var resp = yield fetch(dlUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Referer": link,
                "HX-Request": "true"
              },
              redirect: "manual"
            });
            __mdLog("hubCloudExtractor", "debug", "buzz.fetch.dl.status", {
              status: resp.status, location: resp.headers.get("location"), hxRedirect: resp.headers.get("hx-redirect")
            });
            var dlink = resp.headers.get("hx-redirect") || resp.headers.get("location");
            if (dlink) {
              links.push({ name: "HubCloud - BuzzServer", quality, url: dlink, size });
              __mdLog("hubCloudExtractor", "debug", "link.add", { type: "BuzzServer", url: dlink });
            } else {
              __mdLog("hubCloudExtractor", "debug", "buzz.no-redirect-header");
            }
          } catch (e) {
            __mdLog("hubCloudExtractor", "warn", "buzz.failed", {
              url: link, error: e && e.message || String(e)
            });
          }
        } else if (text.includes("s3 server")) {
          links.push({ name: "HubCloud - S3", quality, url: link, size });
          __mdLog("hubCloudExtractor", "debug", "link.add", { type: "S3", url: link });
        } else if (text.includes("mega server")) {
          links.push({ name: "HubCloud - Mega", quality, url: link, size });
          __mdLog("hubCloudExtractor", "debug", "link.add", { type: "Mega", url: link });
        } else if (link.includes("r2.dev")) {
          links.push({ name: "Direct R2", quality, url: link, size });
          __mdLog("hubCloudExtractor", "debug", "link.add", { type: "DirectR2", url: link });
        } else if (link.includes("workers.dev")) {
          links.push({ name: "ZipDisk Server", quality, url: link, size });
          __mdLog("hubCloudExtractor", "debug", "link.add", { type: "ZipDisk", url: link });
        } else {
          __mdLog("hubCloudExtractor", "trace", "link.unmatched", { link, text });
        }
      }
      // Fallback for gamerxyt pages whose download anchors are injected or
      // hidden from the HTML parser. The current page exposes the PixelServer
      // target in `var pxl` and the 10Gbps target as a pixel.hubcloud URL.
      if (!links.length) {
        __mdLog("hubCloudExtractor", "info", "no links so far, applying fallback");
        if (pxlMatch && /^https?:\/\//i.test(pxlMatch[1])) {
          var pUrl2 = pxlMatch[1];
          if (pUrl2.includes("/u/")) {
            var fileId2 = pUrl2.split("/u/")[1].split("?")[0].replace("/", "");
            pUrl2 = `https://pixeldrain.dev/api/file/${fileId2}?download`;
          }
          links.push({ name: "HubCloud - Pixeldrain", quality, url: pUrl2, size });
          __mdLog("hubCloudExtractor", "debug", "fallback.pixeldrain", pUrl2);
        }
        var instantMatch = pageData.match(/href=["']([^"']*pixel\.hubcloud[^"']+)["'][^>]*>[^<]*Download[^<]*10Gbps/i);
        if (instantMatch) {
          links.push({ name: "HubCloud - Instant", quality, url: instantMatch[1], size });
          __mdLog("hubCloudExtractor", "debug", "fallback.instant", instantMatch[1]);
        }
      }
      __mdLog("hubCloudExtractor", "info", "done", {
        count: links.length,
        types: links.map(function (l) { return l.name; })
      });
      end();
      return links;
    } catch (e) {
      __mdLog("hubCloudExtractor", "error", "extraction failed", {
        url,
        referer,
        error: e && e.message || String(e),
        stack: e && e.stack
      });
      end();
      return [];
    }
  });
}

function loadExtractor(url, referer) {
  return __async(this, null, function* () {
    var end = __mdTimer("loadExtractor", "total");
    __mdLog("loadExtractor", "info", "start", { url, referer });
    try {
      var hostname = new URL(url).hostname;
      __mdLog("loadExtractor", "debug", "hostname", hostname);
      if (hostname.includes("hubcloud")) {
        __mdLog("loadExtractor", "debug", "dispatch.hubcloud", url);
        var r = yield hubCloudExtractor(url, referer);
        end();
        return r;
      }
      if (hostname.includes("gdflix") || hostname.includes("gdlink")) {
        __mdLog("loadExtractor", "debug", "dispatch.gdflix/gdlink", url);
        end();
        return [{ name: "GDFlix", quality: 1080, url }];
      }
      __mdLog("loadExtractor", "debug", "no dispatcher matched", hostname);
      end();
      return [];
    } catch (e) {
      __mdLog("loadExtractor", "warn", "dispatcher failed", {
        url, error: e && e.message || String(e)
      });
      end();
      return [];
    }
  });
}

// src/moviesdrive/index.js
function getMoviesDriveStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    var _a;
    var end = __mdTimer("getMoviesDriveStreams", "total");
    __mdLog("getMoviesDriveStreams", "info", "start", {
      tmdbId, mediaType, seasonNum, episodeNum
    });

    var [details, externalIds] = yield Promise.all([
      getDetails(mediaType, tmdbId), getExternalIds(mediaType, tmdbId)
    ]);
    var tmdbData = { ...details, external_ids: externalIds };
    var imdbId = (_a = tmdbData.external_ids) == null ? void 0 : _a.imdb_id;
    var cleanTitle = tmdbData.title || tmdbData.name || "";
    __mdLog("getMoviesDriveStreams", "info", "tmdb.resolved", { imdbId, title: cleanTitle });

    var mainUrl = yield getMainUrl();
    __mdLog("getMoviesDriveStreams", "info", "mainUrl", mainUrl);

    var match = null;
    var findMatch = (hits) => {
      if (!hits || !hits.length) {
        __mdLog("findMatch", "debug", "no hits");
        return null;
      }
      if (mediaType === "tv") {
        var sSlug = String(seasonNum).padStart(2, "0");
        var seasonPatterns = [
          new RegExp(`\\bseason\\s*0?${seasonNum}\\b`, "i"),
          new RegExp(`\\bs0?${seasonNum}\\b`, "i"),
          new RegExp(`\\bseason\\s*${sSlug}\\b`, "i"),
          // Combined posts use labels such as "Season 1 – 4".
          /\bseason\s*\d+\s*(?:-|–|—|to)\s*\d+\b/i
        ];
        var foundTv = hits.find((doc) => {
          var postTitle = (doc.post_title || "").toLowerCase();
          var permalink2 = (doc.permalink || "").toLowerCase();
          var normDocTitle = postTitle.replace(/[^a-z0-9]/g, "");
          var normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
          var titleMatches = normDocTitle.includes(normTitle) || postTitle.includes(cleanTitle.toLowerCase()) || permalink2.includes(cleanTitle.toLowerCase().replace(/ /g, "-"));
          var seasonMatches = seasonPatterns.some((pat) => pat.test(postTitle) || pat.test(permalink2));
          return titleMatches && seasonMatches;
        });
        __mdLog("findMatch", "debug", "tv scan", {
          hits: hits.length, found: !!foundTv, sample: hits.slice(0, 3).map(function (d) { return d.post_title; })
        });
        return foundTv;
      } else {
        var foundMovie = hits.find((d) => imdbId && d.imdb_id === imdbId) || hits.find((doc) => {
          var postTitle = (doc.post_title || "").toLowerCase();
          var permalink2 = (doc.permalink || "").toLowerCase();
          var normDocTitle = postTitle.replace(/[^a-z0-9]/g, "");
          var normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
          return normDocTitle.includes(normTitle) || postTitle.includes(cleanTitle.toLowerCase()) || permalink2.includes(cleanTitle.toLowerCase().replace(/ /g, "-"));
        });
        __mdLog("findMatch", "debug", "movie scan", {
          hits: hits.length, found: !!foundMovie, sample: hits.slice(0, 3).map(function (d) { return d.post_title; })
        });
        return foundMovie;
      }
    };

    if (imdbId) {
      try {
        var searchUrl = `${mainUrl}/search.php?q=${imdbId}&page=1`;
        __mdLog("getMoviesDriveStreams", "info", "search.strategy.imdb", searchUrl);
        var searchRes = yield fetch(searchUrl, {
          headers: __spreadProps(__spreadValues({}, HEADERS), {
            "Accept": "application/json",
            "Referer": `${mainUrl}/search.html?q=${encodeURIComponent(cleanTitle)}`,
            "X-Requested-With": "XMLHttpRequest"
          })
        });
        __mdLog("getMoviesDriveStreams", "debug", "search.imdb.status", {
          status: searchRes.status, ok: searchRes.ok
        });
        if (searchRes.ok) {
          var searchData = yield searchRes.json();
          var docs = (searchData.hits || []).map((h) => h.document);
          __mdLog("getMoviesDriveStreams", "debug", "search.imdb.hits", {
            count: docs.length, sample: docs.slice(0, 3).map(function (d) { return d && d.post_title; })
          });
          match = findMatch(docs);
          if (match) __mdLog("getMoviesDriveStreams", "info", "search.imdb.match", {
            post_title: match.post_title, permalink: match.permalink
          });
        }
      } catch (e) {
        __mdLog("getMoviesDriveStreams", "warn", "search.imdb.failed", e && e.message || e);
      }
    } else {
      __mdLog("getMoviesDriveStreams", "debug", "search.skip.imdb", "no imdbId");
    }

    if (!match && cleanTitle) {
      try {
        var searchUrl2 = `${mainUrl}/search.php?q=${encodeURIComponent(cleanTitle)}&page=1`;
        __mdLog("getMoviesDriveStreams", "info", "search.strategy.title-api", searchUrl2);
        var searchRes2 = yield fetch(searchUrl2, {
          headers: __spreadProps(__spreadValues({}, HEADERS), {
            "Accept": "application/json",
            "Referer": `${mainUrl}/search.html?q=${encodeURIComponent(cleanTitle)}`,
            "X-Requested-With": "XMLHttpRequest"
          })
        });
        __mdLog("getMoviesDriveStreams", "debug", "search.title-api.status", {
          status: searchRes2.status, ok: searchRes2.ok
        });
        if (searchRes2.ok) {
          var searchData2 = yield searchRes2.json();
          var docs2 = (searchData2.hits || []).map((h) => h.document);
          __mdLog("getMoviesDriveStreams", "debug", "search.title-api.hits", {
            count: docs2.length, sample: docs2.slice(0, 3).map(function (d) { return d && d.post_title; })
          });
          match = findMatch(docs2);
          if (match) __mdLog("getMoviesDriveStreams", "info", "search.title-api.match", {
            post_title: match.post_title, permalink: match.permalink
          });
        }
      } catch (e) {
        __mdLog("getMoviesDriveStreams", "warn", "search.title-api.failed", e && e.message || e);
      }
    }

    // The public site search remains available even when search.php is
    // blocked or returns no JSON result. It also exposes combined posts such
    // as "Reacher (Season 1 – 4)" that the API search may omit.
    if (!match && cleanTitle) {
      try {
        var searchUrl3 = `${mainUrl}/search.html?q=${encodeURIComponent(cleanTitle)}`;
        __mdLog("getMoviesDriveStreams", "info", "search.strategy.html", searchUrl3);
        var searchRes3 = yield fetch(searchUrl3, { headers: HEADERS });
        __mdLog("getMoviesDriveStreams", "debug", "search.html.status", {
          status: searchRes3.status, ok: searchRes3.ok
        });
        if (searchRes3.ok) {
          var searchHtml = yield searchRes3.text();
          var $search = import_cheerio_without_node_native2.load(searchHtml);
          var htmlHits = $search("a[href]").map((_, a) => {
            var href = $search(a).attr("href");
            var postTitle = $search(a).text().replace(/\\s+/g, " ").trim();
            if (!href || !postTitle || href.includes("/tag/") || href.includes("/category/"))
              return null;
            return { post_title: postTitle, permalink: href };
          }).get().filter(Boolean);
          __mdLog("getMoviesDriveStreams", "debug", "search.html.hits", {
            count: htmlHits.length, sample: htmlHits.slice(0, 3).map(function (d) { return d.post_title; })
          });
          match = findMatch(htmlHits);
          if (!match && htmlHits.length === 1) {
            match = htmlHits[0];
            __mdLog("getMoviesDriveStreams", "info", "search.html.single-hit auto-pick", {
              post_title: match.post_title, permalink: match.permalink
            });
          } else if (match) {
            __mdLog("getMoviesDriveStreams", "info", "search.html.match", {
              post_title: match.post_title, permalink: match.permalink
            });
          }
        }
      } catch (e) {
        __mdLog("getMoviesDriveStreams", "warn", "search.html.failed", e && e.message || e);
      }
    }

    if (!match) {
      __mdLog("getMoviesDriveStreams", "warn", "no matching post found", { tmdbId, mediaType, cleanTitle });
      end();
      return [];
    }

    var permalink = match.permalink;
    var href = permalink.startsWith("http") ? permalink : `${mainUrl}${permalink}`;
    __mdLog("getMoviesDriveStreams", "info", "post.url", href);

    try {
      __mdLog("getMoviesDriveStreams", "debug", "fetch.post", href);
      var pageRes = yield fetch(href, { headers: HEADERS });
      __mdLog("getMoviesDriveStreams", "debug", "fetch.post.status", {
        status: pageRes.status, ok: pageRes.ok
      });
      var pageHtml = yield pageRes.text();
      __mdLog("getMoviesDriveStreams", "debug", "fetch.post.bytes", pageHtml.length);
      var $ = import_cheerio_without_node_native2.load(pageHtml);
      var allStreams = [];
      var resolveLinks = async function (links, referer, titlePrefix, context) {
        var extractedByLink = await __mdMapLimit(links, 4, async function (link, index) {
          __mdLog("getMoviesDriveStreams", "debug", context + ".link.process", {
            i: index + 1, of: links.length, link
          });
          var extracted = await extractMdrive(link);
          __mdLog("getMoviesDriveStreams", "debug", context + ".link.extracted", {
            i: index + 1, servers: extracted.length
          });
          return extracted.map(function (server) {
            return { server: server, linkIndex: index + 1 };
          });
        });
        var servers = extractedByLink.reduce(function (all, extracted) {
          return all.concat(extracted);
        }, []);
        var streamsByServer = await __mdMapLimit(servers, 4, async function (entry) {
          var streams = await loadExtractor(entry.server, referer);
          __mdLog("getMoviesDriveStreams", "debug", context + ".link.loaded", {
            i: entry.linkIndex, server: entry.server, streams: streams.length,
            titles: streams.map(function (s) { return s.name; })
          });
          return Promise.all(streams.map(function (stream) {
            return __mdEnrichStream(stream, titlePrefix);
          }));
        });
        return streamsByServer.reduce(function (all, streams) {
          return all.concat(streams);
        }, []);
      };

      if (mediaType === "movie") {
        __mdLog("getMoviesDriveStreams", "info", "mode.movie");
        var links = [];
        $("h5 a").each((_, a) => {
          var h = $(a).attr("href");
          if (h) links.push(h);
        });
        var uniqueLinks = [...new Set(links)];
        __mdLog("getMoviesDriveStreams", "debug", "movie.links", {
          total: links.length, unique: uniqueLinks.length
        });
        allStreams.push(...(yield resolveLinks(uniqueLinks, href, cleanTitle + " - ", "movie")));
      } else {
        __mdLog("getMoviesDriveStreams", "info", "mode.tv", { seasonNum, episodeNum });
        var sSlug2 = String(seasonNum).padStart(2, "0");
        var stag = `Season ${seasonNum}|S${sSlug2}`;
        var sepRegex = new RegExp(`\\b(?:ep|episode|e)\\s*0?${episodeNum}\\b|s0?${seasonNum}\\s*e0?${episodeNum}\\b`, "i");
        var stopRegex = /^\s*(EP\d+|Episode\s*\d+|S\d+E\d+)/i;
        var entries = $("h4, h5").filter((i, el) => new RegExp(stag, "i").test($(el).text()));
        __mdLog("getMoviesDriveStreams", "debug", "tv.seasonHeaderMatches", {
          count: entries.length, stag
        });
        for (const entry of entries.get()) {
          var nextHref = $(entry).next().find("a").attr("href") || $(entry).find("a").attr("href");
          if (!nextHref) {
            __mdLog("getMoviesDriveStreams", "debug", "tv.entry.no-href");
            continue;
          }
          __mdLog("getMoviesDriveStreams", "debug", "tv.episodePage.fetch", nextHref);
          var epPageRes = yield fetch(nextHref, { headers: HEADERS });
          __mdLog("getMoviesDriveStreams", "debug", "tv.episodePage.status", {
            status: epPageRes.status, ok: epPageRes.ok
          });
          var epPageHtml = yield epPageRes.text();
          var $ep = import_cheerio_without_node_native2.load(epPageHtml);
          var epEntries = $ep("h5").filter((i, el) => sepRegex.test($ep(el).text()));
          __mdLog("getMoviesDriveStreams", "debug", "tv.episodeHeaderMatches", {
            count: epEntries.length, for: nextHref
          });
          for (const epEntry of epEntries.get()) {
            var epLinks = [];
            var sibling = $ep(epEntry).next();
            while (sibling.length && !stopRegex.test(sibling.text().trim())) {
              sibling.find("a[href]").each((_, a) => {
                var h = $ep(a).attr("href");
                if (h) epLinks.push(h);
              });
              sibling = sibling.next();
            }
            if (epLinks.length === 0) {
              var l1 = $ep(epEntry).next().find("a").attr("href");
              var l2 = $ep(epEntry).next().next().find("a").attr("href");
              [l1, l2].forEach((l) => l && epLinks.push(l));
              __mdLog("getMoviesDriveStreams", "debug", "tv.fallback-link-scrape", epLinks);
            } else {
              __mdLog("getMoviesDriveStreams", "debug", "tv.sibling-scrape", epLinks.length);
            }
            allStreams.push(...(yield resolveLinks(
              [...new Set(epLinks)],
              nextHref,
              cleanTitle + " S" + seasonNum + "E" + episodeNum + " - ",
              "tv"
            )));
          }
        }
      }
      // Do not expose GDFlix landing pages or Googleusercontent downloads as playable streams.
      allStreams = allStreams.filter((stream) =>
        !String(stream.url || "").trim().toLowerCase().startsWith("https://gdflix.dev") &&
        !__mdIsGoogleDownloadUrl(stream.url)
      );
      __mdLog("getMoviesDriveStreams", "info", "done", {
        totalStreams: allStreams.length,
        types: allStreams.reduce(function (acc, s) {
          acc[s.name] = (acc[s.name] || 0) + 1;
          return acc;
        }, {}),
        formats: allStreams.reduce(function (acc, s) {
          acc[s.format] = (acc[s.format] || 0) + 1;
          return acc;
        }, {}),
        mimeTypes: allStreams.reduce(function (acc, s) {
          acc[s.mimeType] = (acc[s.mimeType] || 0) + 1;
          return acc;
        }, {})
      });
      end();
      return allStreams;
    } catch (e) {
      __mdLog("getMoviesDriveStreams", "error", "page processing failed", {
        error: e && e.message || String(e),
        stack: e && e.stack
      });
      end();
      return [];
    }
  });
}

module.exports = { getMoviesDriveStreams };

// Expose helpers for ad-hoc tweaks from a running server process.
// Primary control is the env var MOVIESDRIVE_LOG_LEVEL. The runtime helpers
// exist so you can crank verbosity or dump the in-memory buffer without a
// restart (e.g. inside a REPL / debugger attached to a live Node process).
if (typeof globalThis !== "undefined") {
  globalThis.__moviesdriveLogBuffer = __moviesdriveLogBuffer;
  globalThis.__moviesdriveLogDump = function () {
    try {
      return __moviesdriveLogBuffer.map(function (e) {
        return "[" + new Date(e.ts).toISOString() + "][" + e.level.toUpperCase() + "][" + e.stage + "] " +
          e.args.map(function (a) {
            if (typeof a === "string") return a;
            try { return JSON.stringify(a); } catch (err) { return String(a); }
          }).join(" ");
      }).join("\n");
    } catch (e) { return "[dump failed] " + (e && e.message); }
  };
  globalThis.__moviesdriveSetLevel = function (n) {
    __MOVIESDRIVE_LOG_LEVEL = n;
  };
}
