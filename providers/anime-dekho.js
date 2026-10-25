const diagnostics = require("../utils/providerTrace").createProviderTrace("AnimeDekho");
const fetch = diagnostics.fetch;
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

// src/utils/extractors.js
var require_extractors = __commonJS({
  "src/utils/extractors.js"(exports2, module2) {
    var cheerio2 = require("cheerio");
    function unpack(packed) {
      const regex = new RegExp('eval\\s*\\(\\s*function\\s*\\(\\s*p\\s*,\\s*a\\s*,\\s*c\\s*,\\s*k\\s*,\\s*e\\s*,\\s*d\\s*\\).*?return\\s+p\\s*}\\s*\\(\\s*\\"(.*?)\\"\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*\\"(.*?)\\"\\.split\\(\\"\\|\\"\\)', "s");
      let match = packed.match(regex);
      if (!match) {
        const regexSq = new RegExp("eval\\s*\\(\\s*function\\s*\\(\\s*p\\s*,\\s*a\\s*,\\s*c\\s*,\\s*k\\s*,\\s*e\\s*,\\s*d\\s*\\).*?return\\s+p\\s*}\\s*\\(\\s*\\'(.*?)\\'\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*\\'(.*?)\\'\\.split\\(\\'\\|\\'\\)", "s");
        match = packed.match(regexSq);
      }
      if (!match)
        return null;
      let p = match[1];
      const a = parseInt(match[2], 10);
      let c = parseInt(match[3], 10);
      const k = match[4].split("|");
      function e(c2) {
        return (c2 < a ? "" : e(Math.floor(c2 / a))) + (c2 % a > 35 ? String.fromCharCode(c2 % a + 29) : (c2 % a).toString(36));
      }
      while (c--) {
        if (k[c]) {
          const pattern = new RegExp("\\b" + e(c) + "\\b", "g");
          p = p.replace(pattern, k[c]);
        }
      }
      return p;
    }
    function extractVidmoly(url) {
      return __async(this, null, function* () {
        try {
          const res = yield fetch(url, { headers: { "Referer": url } });
          const html = yield res.text();
          const m = html.match(/file:\s*["'](.*?m3u8.*?)["']/);
          if (m)
            return { url: m[1], quality: "Unknown", source: "Vidmoly" };
        } catch (e) { diagnostics.log("stage.failed", { errorType: e.name, stage: "server/extractor" }); }
        return null;
      });
    }
    function extractFilemoon(url) {
      return __async(this, null, function* () {
        try {
          const res = yield fetch(url, { headers: { "Referer": url } });
          const html = yield res.text();
          const unpacked = unpack(html);
          if (unpacked) {
            const m = unpacked.match(/file:\s*["'](.*?m3u8.*?)["']/);
            if (m)
              return { url: m[1], quality: "Unknown", source: "Filemoon" };
          }
        } catch (e) { diagnostics.log("stage.failed", { errorType: e.name, stage: "server/extractor" }); }
        return null;
      });
    }
    function extractStreamhide(url) {
      return __async(this, null, function* () {
        try {
          const res = yield fetch(url, { headers: { "Referer": url } });
          const html = yield res.text();
          const unpacked = unpack(html);
          if (unpacked) {
            const m = unpacked.match(/sources:\s*\[\s*{\s*file:\s*["'](.*?m3u8.*?)["']/);
            if (m)
              return { url: m[1], quality: "Unknown", source: "Streamhide" };
          }
        } catch (e) { diagnostics.log("stage.failed", { errorType: e.name, stage: "server/extractor" }); }
        return null;
      });
    }
    function extractVoe(url) {
      return __async(this, null, function* () {
        try {
          const res = yield fetch(url);
          const html = yield res.text();
          const m = html.match(/hls':\s*'(.*?)'/);
          if (m)
            return { url: m[1], quality: "Unknown", source: "Voe" };
        } catch (e) { diagnostics.log("stage.failed", { errorType: e.name, stage: "server/extractor" }); }
        return null;
      });
    }
    function extract2(url) {
      return __async(this, null, function* () {
        if (!url)
          return null;
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes("vidmoly")) {
          return yield extractVidmoly(url);
        } else if (lowerUrl.includes("filemoon") || lowerUrl.includes("abyssplayer") || lowerUrl.includes("rubystm")) {
          return yield extractFilemoon(url);
        } else if (lowerUrl.includes("streamhide") || lowerUrl.includes("cloudy.upns") || lowerUrl.includes("gdmirrorbot") || lowerUrl.includes("emturbovid")) {
          return yield extractStreamhide(url);
        } else if (lowerUrl.includes("voe.sx") || lowerUrl.includes("voe.network")) {
          return yield extractVoe(url);
        }
        return null;
      });
    }
    module2.exports = { extract: extract2 };
  }
});

// src/providers/anime-dekho.js
var cheerio = require("cheerio");
var BASE_URL = "https://animedekho.app";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Referer": `${BASE_URL}/`
};
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const tmdbUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
      const mediaInfo = yield (yield fetch(tmdbUrl, { skipSizeCheck: true })).json();
      const title = mediaInfo.title || mediaInfo.name;
      diagnostics.log("tmdb.resolved", { title, found: !!title });
      if (!title)
        { diagnostics.log("stage.empty", { location: "anime-dekho:147" }); return []; }
      const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(title)}`;
      const searchHtml = yield (yield fetch(searchUrl, { headers: HEADERS, skipSizeCheck: true })).text();
      const $ = cheerio.load(searchHtml);
      let itemUrl = null;
      $("ul[data-results] li article").each((_, el) => {
        if (!itemUrl) {
          const href = $(el).find("a.lnk-blk").attr("href");
          if (href)
            itemUrl = href;
        }
      });
      if (!itemUrl) {
        $("article").each((_, el) => {
          if (!itemUrl) {
            const href = $(el).find("a.lnk-blk").attr("href");
            if (href)
              itemUrl = href;
          }
        });
      }
      diagnostics.log("search.selected", { url: itemUrl, found: !!itemUrl });
      if (!itemUrl)
        { diagnostics.log("stage.empty", { location: "anime-dekho:170" }); return []; }
      const animePage = yield (yield fetch(itemUrl, { headers: HEADERS, skipSizeCheck: true })).text();
      const $2 = cheerio.load(animePage);
      const bodyClass = $2("body").attr("class") || "";
      const termMatch = bodyClass.match(/(?:term|postid)-(\d+)/);
      const term = termMatch?.[1];
      diagnostics.log("page.parsed", { hasTerm: !!term });
      if (!term)
        { diagnostics.log("stage.empty", { location: "anime-dekho:177" }); return []; }
      const seasonItems = $2("ul.seasons-lst li");
      let targetUrl = itemUrl;
      let mediaType2 = 1;
      if (seasonItems.length > 0) {
        mediaType2 = 2;
        seasonItems.each((_, el) => {
          const seasonNum = $2(el).find("h3.title > span").text().match(/S(\d+)/)?.[1];
          const href = $2(el).find("a").attr("href");
          if (href && parseInt(seasonNum) === (season || 1)) {
            targetUrl = href;
          }
        });
      }
      diagnostics.log("season.selected", { url: targetUrl, season, availableSeasons: seasonItems.length });
      const targetPage = yield (yield fetch(targetUrl, { headers: HEADERS, skipSizeCheck: true })).text();
      const $3 = cheerio.load(targetPage);
      const targetBodyClass = $3("body").attr("class") || "";
      const targetTermMatch = targetBodyClass.match(/(?:term|postid)-(\d+)/);
      const targetTerm = targetTermMatch?.[1] || term;
      const streams = [];
      const epNum = episode || 1;
      for (let i = 0; i <= 10; i++) {
        try {
          const iframePageUrl = `${BASE_URL}/?trdekho=${i}&trid=${targetTerm}&trtype=${mediaType2}`;
          const iframePageHtml = yield (yield fetch(iframePageUrl, { headers: HEADERS, skipSizeCheck: true })).text();
          const $4 = cheerio.load(iframePageHtml);
          const iframeSrc = $4("iframe").attr("src");
          diagnostics.log("server.discovered", { index: i, found: !!iframeSrc, url: iframeSrc });
          if (iframeSrc && iframeSrc.startsWith("http")) {
            streams.push({
              url: iframeSrc,
              quality: "Unknown",
              title: `AnimeDekho [S${season || 1}E${epNum}]`,
              subtitles: []
            });
          }
        } catch (_) { diagnostics.log("stage.failed", { errorType: _.name, stage: "server/extractor" }); }
      }
      return streams;
    } catch (e) {
      diagnostics.log("provider.failed", { errorType: e.name });
      { diagnostics.log("stage.empty", { location: "anime-dekho:217" }); return []; }
    }
  });
}
var { extract } = require_extractors();
function wrappedGetStreams(...args) {
  return __async(this, null, function* () {
    const streams = yield getStreams(...args);
    diagnostics.log("candidates.found", { count: streams.length });
    const finalStreams = [];
    for (const s of streams) {
      if (!s.url)
        continue;
      diagnostics.log("server.start", { url: s.url });
      const ext = yield extract(s.url);
      diagnostics.log("server.resolved", { url: s.url, extracted: !!ext, source: ext?.source });
      if (ext) {
        s.url = ext.url;
        if (ext.quality !== "Unknown")
          s.quality = ext.quality;
        finalStreams.push(s);
      } else if (s.url.includes(".mp4") || s.url.includes(".m3u8") || s.url.includes(".mkv") || s.url.includes(".avi") || s.url.startsWith("magnet:") || s.url.includes("/api/file/") || s.url.includes(".cloudflarestorage.com")) {
        finalStreams.push(s);
      }
    }
    return finalStreams;
  });
}
module.exports = { getStreams: (...args) => diagnostics.run(() => wrappedGetStreams(...args), args) };
