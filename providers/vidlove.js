var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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

// src/vidlove/http.js
var require_http = __commonJS({
  "src/vidlove/http.js"(exports2, module2) {
    var DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    var DEFAULT_HEADERS = {
      "User-Agent": DEFAULT_UA,
      "Referer": "https://player.vidlove.cc/"
    };
    function fetchText(url) {
      return __async(this, null, function* () {
        const res = yield fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
          throw new Error("HTTP " + res.status);
        return res.text();
      });
    }
    function fetchJson(url) {
      return __async(this, null, function* () {
        const res = yield fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
          throw new Error("HTTP " + res.status);
        const text = yield res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          return null;
        }
      });
    }
    module2.exports = { fetchText, fetchJson, DEFAULT_HEADERS, DEFAULT_UA };
  }
});

// src/vidlove/discover.js
var require_discover = __commonJS({
  "src/vidlove/discover.js"(exports2, module2) {
    var { fetchText } = require_http();
    var HARDCODED_BASE = "https://api.vidlove.cc";
    var API_FALLBACK_BASES = ["api", "a2", "d", "d2", "c", "c2"].map((host) => "https://" + host + ".phantomflix.net");
    var DISCOVERED_BASE = "";
    var BUNDLE_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;
    var DOMAIN_RE = /https:\/\/[a-z0-9-]+\.com/;
    function normalizeBase(value) {
      return (value || "").replace(/\/+$/, "");
    }
    function extractApiBaseFromHtml(html) {
      const m = String(html || "").match(/(?:var|let|const)\s+API\s*=\s*["'](https:\/\/[^"']+)["']/i);
      return m ? normalizeBase(m[1]) : "";
    }
    var BACKEND_ASSIGN_RE = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*["'](https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+)["']\s*\.replace\(\/\\\/\+\$\/,""\)/;
    function extractApiBaseFromBundle(bundleJs) {
      const m = bundleJs.match(BACKEND_ASSIGN_RE);
      if (!m)
        return "";
      return normalizeBase(m[1]);
    }
    function discoverBaseFromPlayer() {
      return __async(this, null, function* () {
        try {
          const html = yield fetchText("https://player.vidlove.cc/embed/movie/1");
          const htmlBase = extractApiBaseFromHtml(html);
          if (htmlBase)
            return htmlBase;
          const bundleMatch = html.match(BUNDLE_RE);
          if (!bundleMatch) {
            console.error("[Vidlove] discovery failed: player bundle script not found");
            return "";
          }
          const bundleUrl = "https://player.vidlove.cc" + bundleMatch[0];
          const bundle = yield fetchText(bundleUrl);
          const base = extractApiBaseFromBundle(bundle);
          if (!base) {
            console.error("[Vidlove] discovery failed: no backend assignment found in bundle");
            return "";
          }
          return base;
        } catch (e) {
          console.error("[Vidlove] discovery failed:", e.message);
          return "";
        }
      });
    }
    function getBaseUrl(requestMovieApi) {
      return __async(this, null, function* () {
        if (DISCOVERED_BASE)
          return DISCOVERED_BASE;
        DISCOVERED_BASE = normalizeBase(HARDCODED_BASE);
        return DISCOVERED_BASE;
      });
    }
    module2.exports = { HARDCODED_BASE, API_FALLBACK_BASES, DISCOVERED_BASE, normalizeBase, extractApiBaseFromHtml, extractApiBaseFromBundle, getBaseUrl, BUNDLE_RE, DOMAIN_RE };
  }
});

// src/vidlove/extractor.js
var require_extractor = __commonJS({
  "src/vidlove/extractor.js"(exports2, module2) {
    var { fetchJson, DEFAULT_HEADERS } = require_http();
    var { getBaseUrl, API_FALLBACK_BASES, normalizeBase } = require_discover();
    var RESOLUTION_RE = /RESOLUTION=(\d+)x(\d+)/;
    var RECOMMENDED_KEYS = ["moviebox2", "vidapi"];
    var MOVIE_ORDER = ["moviebox2", "vidapi"];
    var TV_ORDER = ["moviebox2", "vidapi"];
    var QUALITY_RE = /(2160|1440|1080|720|480|360)/;
    function detectQuality(value) {
      if (value === void 0 || value === null)
        return 0;
      const match = String(value).match(QUALITY_RE);
      return match ? parseInt(match[1], 10) : 0;
    }
    function resolutionToQuality(width, height) {
      const h = Number(height) || 0;
      if (h >= 2160)
        return 2160;
      if (h >= 1080)
        return 1080;
      if (h >= 720)
        return 720;
      if (h >= 480)
        return 480;
      if (h >= 360)
        return 360;
      return h;
    }
    function formatFromUrl(url) {
      const lower = String(url || "").toLowerCase();
      if (lower.indexOf(".m3u8") !== -1)
        return "m3u8";
      if (lower.indexOf(".mp4") !== -1)
        return "mp4";
      if (lower.indexOf(".mkv") !== -1)
        return "mkv";
      return "hls";
    }
    function mediaTypeForUrl(url) {
      const format = formatFromUrl(url);
      if (format === "mp4")
        return { type: "mp4", mimeType: "video/mp4" };
      if (format === "mkv")
        return { type: "mkv", mimeType: "video/x-matroska" };
      return { type: "hls", mimeType: "application/vnd.apple.mpegurl" };
    }
    function resolveStreamUrl(url, baseUrl) {
      if (typeof url !== "string" || !url.trim())
        return "";
      try {
        return new URL(url.trim(), baseUrl || void 0).toString();
      } catch (e) {
        return url.trim();
      }
    }
    function parseManifest(manifestText, baseUrl) {
      if (!manifestText || typeof manifestText !== "string")
        return [];
      const lines = manifestText.split("\n");
      const variants = [];
      let current = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const inf = line.match(/^#EXT-X-STREAM-INF:/);
        if (inf) {
          const resMatch = line.match(RESOLUTION_RE);
          current = {
            url: "",
            width: resMatch ? parseInt(resMatch[1], 10) : 0,
            height: resMatch ? parseInt(resMatch[2], 10) : 0
          };
          continue;
        }
        if (line.startsWith("#"))
          continue;
        if (current && line) {
          current.url = resolveStreamUrl(line, baseUrl);
          variants.push(current);
          current = null;
        }
      }
      return variants.map((v) => ({
        url: v.url,
        quality: v.width && v.height ? resolutionToQuality(v.width, v.height) : 0
      }));
    }
    function buildApiUrl(base, mediaType, tmdbId, season, episode) {
      const id = String(tmdbId);
      if (mediaType === "tv") {
        return `${base}/tv?id=${encodeURIComponent(id)}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}&mode=json`;
      }
      return `${base}/movie?id=${encodeURIComponent(id)}&mode=json`;
    }
    function requestMovieApi(base, id) {
      return fetchJson(buildApiUrl(base, "movie", id, void 0, void 0));
    }
    function buildStreamHeaders() {
      return {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        Referer: "https://player.vidlove.cc/",
        Origin: "https://player.vidlove.cc"
      };
    }
    function buildStream(quality, url, sourceKey, headers) {
      const qualityStr = quality ? String(quality) : "Auto";
      const sourceName = sourceKey || "Default";
      const mediaType = mediaTypeForUrl(url);
      return {
        name: "Vidlove " + sourceName,
        title: "Vidlove " + sourceName + " - " + qualityStr,
        url,
        quality: qualityStr,
        provider: "Vidlove",
        type: mediaType.type,
        mimeType: mediaType.mimeType,
        subtitles: [],
        headers
      };
    }
    function buildQualityStream(entry, sourceKey, headers, baseUrl) {
      const url = resolveStreamUrl(entry && entry.url, baseUrl);
      if (!url)
        return null;
      const quality = detectQuality(entry.quality || "") || 720;
      const qualityStr = String(quality);
      const sourceName = sourceKey || "Default";
      const mediaType = mediaTypeForUrl(url);
      return {
        name: "Vidlove " + sourceName,
        title: "Vidlove " + sourceName + " - " + qualityStr,
        url,
        quality: qualityStr,
        provider: "Vidlove",
        type: mediaType.type,
        mimeType: mediaType.mimeType,
        subtitles: [],
        headers
      };
    }
    function isValidStreamUrl(url) {
      return typeof url === "string" && url.trim().length >= 10 && (url.indexOf("m3u8") !== -1 || url.indexOf(".mp4") !== -1 || url.indexOf("://") !== -1);
    }
    function manifestHasSplitAudio(manifestText) {
      return typeof manifestText === "string" && manifestText.indexOf("#EXT-X-MEDIA:TYPE=AUDIO") !== -1;
    }
    function streamsFromSource(source, sourceKey, headers) {
      if (!source || !isValidStreamUrl(source.url))
        return [];
      const streams = [];
      if (Array.isArray(source.qualities) && source.qualities.length > 0) {
        for (const entry of source.qualities) {
          const s = buildQualityStream(entry, sourceKey, headers, source.url);
          if (s)
            streams.push(s);
        }
        if (streams.length > 0)
          return streams;
      }
      const variants = parseManifest(source.manifest, source.url);
      if (manifestHasSplitAudio(source.manifest)) {
        const maxQuality = variants.reduce((max, v) => Math.max(max, v.quality), 0);
        streams.push(buildStream(maxQuality, source.url, sourceKey, headers));
        return streams;
      }
      for (const v of variants) {
        streams.push(buildStream(v.quality, v.url, sourceKey, headers));
      }
      if (streams.length > 0)
        return streams;
      if (isValidStreamUrl(source.url)) {
        streams.push(buildStream(0, source.url, sourceKey, headers));
      }
      return streams;
    }
    function trySource(base, mediaType, tmdbId, season, episode, key, headers) {
      return __async(this, null, function* () {
        const bases = [...new Set([normalizeBase(base), ...API_FALLBACK_BASES.map(normalizeBase)])];
        const collected = [];
        for (const candidate of bases) {
          const url = buildApiUrl(candidate, mediaType, tmdbId, season, episode) + "&sources=" + encodeURIComponent(key);
          try {
            let source = null;
            if (key === "moviebox2") {
              const hevcData = yield fetchJson(url + "&hevc=1");
              source = hevcData && hevcData.source;
            }
            if (!source || !source.url) {
              const data = yield fetchJson(url);
              source = data && data.source;
            }
            if (source && typeof source.url === "string")
              source = { ...source, url: resolveStreamUrl(source.url, candidate) };
            const host = new URL(candidate).hostname;
            const streams = streamsFromSource(source, key + " (" + host + ")", headers);
            collected.push(...streams);
          } catch (e) {
            console.warn("[Vidlove] source " + key + " API candidate failed:", candidate, e.message);
          }
        }
        return collected;
      });
    }
    function getVidloveStreams2(tmdbId, mediaType, season, episode) {
      return __async(this, null, function* () {
        const base = yield getBaseUrl(requestMovieApi);
        if (!base)
          return [];
        const order = mediaType === "tv" ? TV_ORDER : MOVIE_ORDER;
        const headers = buildStreamHeaders();
        const collected = [];
        for (const key of order) {
          const streams = yield trySource(base, mediaType, tmdbId, season, episode, key, headers);
          collected.push(...streams);
        }
        const unique = [];
        const seen = new Set();
        for (const stream of collected) {
          const streamKey = [stream.url, stream.quality, stream.type].join("|");
          if (seen.has(streamKey))
            continue;
          seen.add(streamKey);
          unique.push(stream);
        }
        return unique;
      });
    }
    module2.exports = { getVidloveStreams: getVidloveStreams2, parseManifest, formatFromUrl, buildApiUrl, resolutionToQuality, detectQuality, manifestHasSplitAudio, RECOMMENDED_KEYS, MOVIE_ORDER, TV_ORDER, RESOLUTION_RE };
  }
});

// src/vidlove/index.js
var { getVidloveStreams } = require_extractor();
module.exports = { getVidloveStreams };
