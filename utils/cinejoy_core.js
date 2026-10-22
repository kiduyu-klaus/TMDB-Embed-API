/**
 * cinejoy-tv - Built from src/cinejoy-tv/
 * Generated: 2026-10-14T03:32:49.069Z
 */
const __defProp = Object.defineProperty;
const __defProps = Object.defineProperties;
const __getOwnPropDesc = Object.getOwnPropertyDescriptor;
const __getOwnPropDescs = Object.getOwnPropertyDescriptors;
const __getOwnPropNames = Object.getOwnPropertyNames;
const __getOwnPropSymbols = Object.getOwnPropertySymbols;
const __hasOwnProp = Object.prototype.hasOwnProperty;
const __propIsEnum = Object.prototype.propertyIsEnumerable;
const __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
const __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
const __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
const __export = (target, all) => {
  for (let name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
const __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
const __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
const __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
const __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    let fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    let rejected = (value) => {
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

// src/cinejoy-tv/core.js
const cinejoy_core_exports = {};
__export(cinejoy_core_exports, {
  getStreamsForServers: () => getStreamsForServers
});
module.exports = __toCommonJS(cinejoy_core_exports);

// src/cinejoy-tv/constants.js
const DEFAULT_DOMAIN = "https://cinejoy.pk";
const CANDIDATE_DOMAINS = [
  "https://cinejoy.pk",
  "https://cinejoy.to",
  "https://cinejoy.stream",
  "https://cinejoy.lol"
];
const DEFAULT_API_HOST = "https://api.wing.st";
const CANDIDATE_API_HOSTS = [
  "https://api.wing.st",
  "https://api.shegu.st"
];
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "8476a7ab80ad76f0936744df0430e67c";
const FALLBACK_SERVERS = ["Nebula", "Lisbon", "Scout", "Riga", "Solara", "Athens"];
const ENC_DEC_API = "https://enc-dec.app/api/enc-cinejoy";
const DEFAULT_SUBTITLES_HOST = "https://subs.wing.st";
const CANDIDATE_SUBTITLES_HOSTS = [
  "https://subs.wing.st",
  "https://subs.shegu.st"
];
const HARDCODED_WORKER_URL = "https://cinejoy-phi.vercel.app";
const LANGUAGE_NAMES = {
  en: "English",
  id: "Indonesian",
  es: "Spanish",
  ar: "Arabic",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  pob: "Portuguese (Brazil)",
  "pt-br": "Portuguese (Brazil)",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  "zh-cn": "Chinese (Simplified)",
  "zh-tw": "Chinese (Traditional)",
  hi: "Hindi",
  tr: "Turkish",
  nl: "Dutch",
  pl: "Polish",
  sv: "Swedish",
  vi: "Vietnamese",
  th: "Thai",
  ro: "Romanian",
  bn: "Bengali",
  sr: "Serbian",
  el: "Greek",
  fa: "Persian",
  he: "Hebrew",
  fi: "Finnish",
  bg: "Bulgarian",
  hr: "Croatian",
  cs: "Czech",
  kn: "Kannada",
  et: "Estonian",
  si: "Sinhala",
  ml: "Malayalam",
  hu: "Hungarian",
  da: "Danish",
  ms: "Malay",
  tl: "Filipino",
  uk: "Ukrainian",
  no: "Norwegian",
  sk: "Slovak",
  sl: "Slovenian",
  ur: "Urdu",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  pa: "Punjabi",
  sw: "Swahili",
  af: "Afrikaans",
  sq: "Albanian",
  hy: "Armenian",
  az: "Azerbaijani",
  eu: "Basque",
  be: "Belarusian",
  bs: "Bosnian",
  ca: "Catalan",
  gl: "Galician",
  ka: "Georgian",
  is: "Icelandic",
  kk: "Kazakh",
  km: "Khmer",
  mk: "Macedonian",
  mn: "Mongolian",
  ne: "Nepali",
  uz: "Uzbek",
  cy: "Welsh",
  my: "Burmese",
  ps: "Pashto",
  sd: "Sindhi",
  so: "Somali",
  am: "Amharic",
  ku: "Kurdish"
};
const ISO_639_2_TO_1 = {
  eng: "en",
  ind: "id",
  spa: "es",
  ara: "ar",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  ita: "it",
  por: "pt",
  pob: "pt",
  rus: "ru",
  jpn: "ja",
  kor: "ko",
  zho: "zh",
  chi: "zh",
  hin: "hi",
  tur: "tr",
  nld: "nl",
  dut: "nl",
  pol: "pl",
  swe: "sv",
  vie: "vi",
  tha: "th",
  ron: "ro",
  rum: "ro",
  ben: "bn",
  srp: "sr",
  ell: "el",
  gre: "el",
  fas: "fa",
  per: "fa",
  heb: "he",
  fin: "fi",
  bul: "bg",
  hrv: "hr",
  ces: "cs",
  cze: "cs",
  kan: "kn",
  est: "et",
  sin: "si",
  mal: "ml",
  hun: "hu",
  dan: "da",
  msa: "ms",
  may: "ms",
  fil: "tl",
  tgl: "tl",
  ukr: "uk",
  nor: "no",
  slk: "sk",
  slo: "sk",
  slv: "sl",
  urd: "ur",
  tam: "ta",
  te: "te",
  mar: "mr",
  pan: "pa"
};
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*"
};

function tracedFetch(diagnostics, url, options) {
  return diagnostics ? diagnostics.fetch(url, options) : fetch(url, options);
}

// src/cinejoy-tv/utils.js
let cachedDomain = DEFAULT_DOMAIN;
let lastDomainResolvedTime = 0;
const DOMAIN_CACHE_TTL = 3 * 60 * 60 * 1e3;
let cachedApiHost = DEFAULT_API_HOST;
function resolveDomain(force = false, diagnostics = null) {
  return __async(this, null, function* () {
    const now = Date.now();
    if (!force && lastDomainResolvedTime > 0 && now - lastDomainResolvedTime < DOMAIN_CACHE_TTL) {
      return cachedDomain;
    }
    const candidates = [cachedDomain, ...CANDIDATE_DOMAINS.filter((d) => d !== cachedDomain)];
    for (const candidate of candidates) {
      try {
        const res = yield tracedFetch(diagnostics, candidate, {
          headers: { "User-Agent": HEADERS["User-Agent"] }
        });
        if (res.ok || res.status >= 200 && res.status < 400) {
          cachedDomain = candidate.replace(/\/+$/, "");
          lastDomainResolvedTime = now;
          return cachedDomain;
        }
      } catch (e) { /* empty */ }
    }
    return cachedDomain || DEFAULT_DOMAIN;
  });
}
function getActiveServers(domain = DEFAULT_DOMAIN, diagnostics = null) {
  return __async(this, arguments, function* (domain = DEFAULT_DOMAIN, diagnostics = null) {
    const cleanDomain = domain.replace(/\/+$/, "");
    const apiHosts = [cachedApiHost, ...CANDIDATE_API_HOSTS.filter((h) => h !== cachedApiHost)];
    for (const host of apiHosts) {
      try {
        const res = yield tracedFetch(diagnostics, `${host}/servers`, {
          headers: {
            "Origin": cleanDomain,
            "Referer": `${cleanDomain}/`,
            "User-Agent": HEADERS["User-Agent"]
          }
        });
        if (res.ok) {
          const json = yield res.json();
          const arr = json.servers;
          if (Array.isArray(arr) && arr.length > 0) {
            cachedApiHost = host;
            const validServers = [];
            const seen = /* @__PURE__ */ new Set();
            for (const s of arr) {
              const name = (s.name || "").trim();
              const status = (s.status || "").toLowerCase().trim();
              if (name && (status === "" || status === "ok")) {
                validServers.push(name);
                seen.add(name.toLowerCase());
              }
            }
            for (const fallback of FALLBACK_SERVERS) {
              if (!seen.has(fallback.toLowerCase())) {
                validServers.push(fallback);
                seen.add(fallback.toLowerCase());
              }
            }
            if (validServers.length > 0)
              return { host: cachedApiHost, servers: validServers };
          }
        }
      } catch (e) { /* empty */ }
    }
    return { host: cachedApiHost, servers: [...FALLBACK_SERVERS] };
  });
}
function getTmdbDetails(tmdbId, mediaType = "movie", diagnostics = null) {
  return __async(this, null, function* () {
    let _a;
    try {
      const type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
      const url = `${TMDB_BASE_URL}/${type}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield tracedFetch(diagnostics, url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": HEADERS["User-Agent"]
        }
      });
      if (!res.ok)
        return null;
      const data = yield res.json();
      const title = type === "tv" ? data.name || data.original_name : data.title || data.original_title;
      const date = type === "tv" ? data.first_air_date : data.release_date;
      const year = date ? date.split("-")[0] : "";
      const imdbId = ((_a = data.external_ids) == null ? void 0 : _a.imdb_id) || "";
      return { title, year, imdbId };
    } catch (e) {
      if (diagnostics)
        diagnostics.log("metadata.failed", { errorType: e.name });
      else
        console.warn("[Cinejoy-TV] TMDB metadata fetch error:", e.message);
      return null;
    }
  });
}

// src/cinejoy-tv/subtitles.js
const NATSUKI_BASE = "https://natsuki.hls.lol/subs";
const GRANITE_BASE = "https://sub.vdrk.site/v1";
const OPENSUBS_BASE = "https://rest.opensubtitles.org";
const OPENSUBS_USER_AGENT = "VLSub 0.10.2";
function normalizeLanguageCode(code) {
  if (!code)
    return "en";
  const clean2 = String(code).toLowerCase().trim();
  if (ISO_639_2_TO_1[clean2])
    return ISO_639_2_TO_1[clean2];
  if (LANGUAGE_NAMES[clean2])
    return clean2;
  const two = clean2.slice(0, 2);
  if (LANGUAGE_NAMES[two])
    return two;
  return clean2;
}
function getLanguageDisplayName(code) {
  const norm = normalizeLanguageCode(code);
  return LANGUAGE_NAMES[norm] || LANGUAGE_NAMES[code] || norm.toUpperCase();
}
function fetchJson(url, options = {}, diagnostics = null) {
  return __async(this, arguments, function* (url, options = {}, diagnostics = null) {
    try {
      const res = yield tracedFetch(diagnostics, url, options);
      let data = null;
      if (res.ok) {
        data = yield res.json();
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: null };
    }
  });
}
let cachedSubtitlesHost = DEFAULT_SUBTITLES_HOST;
function fetchCinejoySubtitles(tmdbId, mediaType, season, episode, maxPerLang = 3, diagnostics = null) {
  return __async(this, null, function* () {
    let _a, _b;
    const subtitles = [];
    if (!tmdbId)
      return subtitles;
    const isTv = mediaType === "tv" || mediaType === "series";
    const hosts = [cachedSubtitlesHost, ...CANDIDATE_SUBTITLES_HOSTS.filter((h) => h !== cachedSubtitlesHost)];
    for (const host of hosts) {
      try {
        const type = isTv ? "tv" : "movie";
        let url = `${host}/subtitles?type=${type}&tmdb=${encodeURIComponent(tmdbId)}`;
        if (isTv) {
          url += `&season=${encodeURIComponent(season || 1)}&episode=${encodeURIComponent(episode || 1)}`;
        }
        const result = yield fetchJson(url, {
          headers: {
            "Accept": "application/json",
            "Origin": DEFAULT_DOMAIN,
            "Referer": `${DEFAULT_DOMAIN}/`,
            "User-Agent": HEADERS["User-Agent"]
          }
        }, diagnostics);
        if (!result.ok || !result.data)
          continue;
        const list = Array.isArray(result.data) ? result.data : Array.isArray((_a = result.data) == null ? void 0 : _a.subtitles) ? result.data.subtitles : Array.isArray((_b = result.data) == null ? void 0 : _b.data) ? result.data.data : [];
        if (list.length === 0)
          continue;
        cachedSubtitlesHost = host;
        const langCount = {};
        for (const item of list) {
          const subUrl = item.url || item.id;
          if (!subUrl || typeof subUrl !== "string" || !subUrl.startsWith("http"))
            continue;
          const rawLang = item.language || item.lang || "en";
          const langCode = normalizeLanguageCode(rawLang);
          const currentCount = langCount[langCode] || 0;
          if (maxPerLang > 0 && currentCount >= maxPerLang) {
            continue;
          }
          langCount[langCode] = currentCount + 1;
          const baseName = getLanguageDisplayName(langCode);
          const display = String(item.display || item.label || "");
          const isHi = /[\._\- ](hi|sdh|cc)[\._\- ]|\b(hi|sdh|cc)\.srt$/i.test(display);
          let trackName = baseName;
          if (isHi) {
            trackName = `${baseName} [CC]`;
          } else if (currentCount > 0) {
            trackName = `${baseName} #${currentCount + 1}`;
          }
          subtitles.push({
            url: subUrl,
            language: langCode,
            name: trackName,
            headers: {
              "Origin": DEFAULT_DOMAIN,
              "Referer": `${DEFAULT_DOMAIN}/`,
              "User-Agent": HEADERS["User-Agent"]
            }
          });
        }
        if (subtitles.length > 0) {
          return subtitles;
        }
      } catch (e) {
        if (diagnostics)
          diagnostics.log("subtitles.source.failed", { host, errorType: e.name });
        else
          console.warn(`[Cinejoy] Subtitle fetch from ${host} error:`, e.message);
      }
    }
    return subtitles;
  });
}
function fetchGranite(tmdbId, mediaType, season, episode, maxPerLang = 3, diagnostics = null) {
  return __async(this, null, function* () {
    if (!tmdbId)
      return [];
    const isTv = mediaType === "tv" || mediaType === "series";
    const url = isTv ? `${GRANITE_BASE}/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(season || 1)}/${encodeURIComponent(episode || 1)}` : `${GRANITE_BASE}/movie/${encodeURIComponent(tmdbId)}`;
    const result = yield fetchJson(url, { headers: { "User-Agent": HEADERS["User-Agent"] } }, diagnostics);
    if (!result.ok || !Array.isArray(result.data)) {
      return [];
    }
    const tracks = [];
    const langCount = {};
    for (let i = 0; i < result.data.length; i++) {
      const item = result.data[i];
      if (!item || !item.file || !item.label)
        continue;
      const label = String(item.label);
      const base = label.replace(/\s*hi\d*$/i, "").replace(/\d+$/, "");
      const code = normalizeLanguageCode(base);
      if (!code)
        continue;
      const currentCount = langCount[code] || 0;
      if (maxPerLang > 0 && currentCount >= maxPerLang)
        continue;
      langCount[code] = currentCount + 1;
      const isHi = /hi/i.test(label);
      const baseName = getLanguageDisplayName(code);
      const name = isHi ? `${baseName} [CC]` : currentCount > 0 ? `${baseName} #${currentCount + 1}` : label;
      tracks.push({
        url: item.file,
        language: code,
        name
      });
    }
    return tracks;
  });
}
function fetchNatsuki(imdbId, season, episode, maxPerLang = 3, diagnostics = null) {
  return __async(this, null, function* () {
    if (!imdbId)
      return [];
    const parts = [`imdbId=${encodeURIComponent(imdbId)}`];
    if (season && episode) {
      parts.push(`season=${encodeURIComponent(season)}`);
      parts.push(`episode=${encodeURIComponent(episode)}`);
    }
    const headers = {
      "Accept": "application/json, text/plain, */*",
      "Origin": "https://atlantic.st",
      "Referer": "https://atlantic.st/",
      "User-Agent": HEADERS["User-Agent"]
    };
    const result = yield fetchJson(`${NATSUKI_BASE}?${parts.join("&")}`, { headers }, diagnostics);
    if (!result.ok || !result.data || !Array.isArray(result.data.subtitles)) {
      return [];
    }
    const tracks = [];
    const langCount = {};
    for (let i = 0; i < result.data.subtitles.length; i++) {
      const item = result.data.subtitles[i];
      if (!item || !item.url)
        continue;
      const code = normalizeLanguageCode(item.language || item.langCode);
      if (!code)
        continue;
      const currentCount = langCount[code] || 0;
      if (maxPerLang > 0 && currentCount >= maxPerLang)
        continue;
      langCount[code] = currentCount + 1;
      const baseName = getLanguageDisplayName(code);
      tracks.push({
        url: item.url,
        language: code,
        name: currentCount > 0 ? `${baseName} #${currentCount + 1}` : baseName
      });
    }
    return tracks;
  });
}
function fetchOpenSubtitles(imdbId, mediaType, season, episode, maxPerLang = 3, diagnostics = null) {
  return __async(this, null, function* () {
    let _a;
    if (!imdbId)
      return [];
    const isTv = mediaType === "tv" || mediaType === "series";
    try {
      const subUrl = isTv ? `https://opensubtitles-v3.strem.io/subtitles/series/${imdbId}:${season || 1}:${episode || 1}.json` : `https://opensubtitles-v3.strem.io/subtitles/movie/${imdbId}.json`;
      const res = yield fetchJson(subUrl, {
        headers: { "User-Agent": HEADERS["User-Agent"] }
      }, diagnostics);
      if (res.ok && Array.isArray((_a = res.data) == null ? void 0 : _a.subtitles) && res.data.subtitles.length > 0) {
        const tracks = [];
        const langCount = {};
        for (const sub of res.data.subtitles) {
          if (!sub || !sub.url || typeof sub.url !== "string")
            continue;
          const code = normalizeLanguageCode(sub.lang || "en");
          const currentCount = langCount[code] || 0;
          if (maxPerLang > 0 && currentCount >= maxPerLang)
            continue;
          langCount[code] = currentCount + 1;
          const baseName = getLanguageDisplayName(code);
          tracks.push({
            url: sub.url,
            language: code,
            name: currentCount > 0 ? `${baseName} #${currentCount + 1}` : baseName
          });
        }
        if (tracks.length > 0)
          return tracks;
      }
    } catch (e) {
    }
    try {
      const cleanId = String(imdbId).replace(/^tt/, "");
      const hasEpisode = Boolean(isTv && season && episode);
      const path = "/search/" + (hasEpisode ? `episode-${encodeURIComponent(episode)}/` : "") + `imdbid-${encodeURIComponent(cleanId)}` + (hasEpisode ? `/season-${encodeURIComponent(season)}` : "");
      const res = yield fetchJson(OPENSUBS_BASE + path, {
        headers: {
          "Accept": "application/json, text/plain, */*",
          "User-Agent": HEADERS["User-Agent"],
          "X-User-Agent": OPENSUBS_USER_AGENT
        }
      }, diagnostics);
      if (res.ok && Array.isArray(res.data)) {
        const tracks = [];
        const langCount = {};
        for (let i = 0; i < res.data.length; i++) {
          const item = res.data[i];
          if (!item || !item.SubDownloadLink)
            continue;
          const code = normalizeLanguageCode(item.LanguageName || item.ISO639);
          if (!code)
            continue;
          const currentCount = langCount[code] || 0;
          if (maxPerLang > 0 && currentCount >= maxPerLang)
            continue;
          langCount[code] = currentCount + 1;
          const url = String(item.SubDownloadLink).replace(/\.gz$/i, "").replace("/download/", "/download/subencoding-utf8/");
          const baseName = getLanguageDisplayName(code);
          tracks.push({
            url,
            language: code,
            name: currentCount > 0 ? `${baseName} #${currentCount + 1}` : baseName
          });
        }
        return tracks;
      }
    } catch (e) {
    }
    return [];
  });
}
function fetchAllSubtitles(tmdbId, mediaType, season, episode, imdbId, maxPerLang = 3, diagnostics = null) {
  return __async(this, null, function* () {
    const jobs = [
      fetchCinejoySubtitles(tmdbId, mediaType, season, episode, maxPerLang, diagnostics),
      fetchGranite(tmdbId, mediaType, season, episode, maxPerLang, diagnostics),
      fetchNatsuki(imdbId, season, episode, maxPerLang, diagnostics),
      fetchOpenSubtitles(imdbId, mediaType, season, episode, maxPerLang, diagnostics)
    ];
    const settled = yield Promise.all(jobs.map((job) => job.catch(() => [])));
    const allTracks = [];
    const seen = /* @__PURE__ */ new Set();
    const langTotals = {};
    for (const list of settled) {
      if (!Array.isArray(list))
        continue;
      for (const track of list) {
        if (!track || !track.url)
          continue;
        if (seen.has(track.url))
          continue;
        const code = track.language || "en";
        const count = langTotals[code] || 0;
        if (maxPerLang > 0 && count >= maxPerLang)
          continue;
        seen.add(track.url);
        langTotals[code] = count + 1;
        allTracks.push(track);
      }
    }
    return allTracks;
  });
}

// node_modules/@noble/ciphers/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
const atitle = (title) => title ? `"${title}" ` : "";
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function anumber(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes(value, length, title = "") {
  if (isBytes(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber(length, "length");
  const bytes = isBytes(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function aoutput32(out, instance) {
  aoutput(out, instance);
  if (!isAligned32(out))
    throw new Error("invalid output, must be aligned");
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
const isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
const swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n) >>> 0;
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
const swap32IfBE = isLE ? (u) => u : byteSwap32;
function equalBytes(a, b) {
  a = abytes(a);
  b = abytes(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function wrapMacConstructor(keyLen, macCons, fromMsg) {
  const mac = macCons;
  const getArgs = fromMsg || (() => []);
  const macC = (msg, key) => mac(key, ...getArgs(msg)).update(msg).digest();
  const tmp = mac(new Uint8Array(keyLen), ...getArgs(new Uint8Array(0)));
  macC.outputLen = tmp.outputLen;
  macC.blockLen = tmp.blockLen;
  macC.create = (key, ...args) => mac(key, ...args);
  return macC;
}
const wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes(key, void 0, "key");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    const aadStart = params.nonceLength !== void 0 ? 1 : 0;
    if (!params.withAAD) {
      for (let i = aadStart; i < args.length; i++)
        if (isBytes(args[i]))
          throw new Error("AAD not supported");
    }
    if (params.withAAD && args[aadStart] !== void 0)
      abytes(args[aadStart], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes(data, void 0, "data");
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes(data, void 0, "data");
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length >= tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  abytes(out, expectedLength, "output");
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function u64Lengths(dataLength, aadLength, isLE2) {
  anumber(dataLength);
  anumber(aadLength);
  abool(isLE2);
  const num = new Uint8Array(16);
  const view = createView(num);
  view.setBigUint64(0, BigInt(aadLength), isLE2);
  view.setBigUint64(8, BigInt(dataLength), isLE2);
  return num;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes(bytes));
}

// node_modules/@noble/ciphers/_polyval.js
const BLOCK_SIZE = 16;
const ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
const ZEROS32 = /* @__PURE__ */ u32(ZEROS16);
const POLY = 225;
const mul2 = (s0, s1, s2, s3) => {
  const hiBit = s3 & 1;
  return {
    s3: s2 << 31 | s3 >>> 1,
    s2: s1 << 31 | s2 >>> 1,
    s1: s0 << 31 | s1 >>> 1,
    // NIST SP 800-38D §6.3 applies `V >> 1` and XORs R on carry. In this
    // 4x32-bit split, R = 0xe1 || 0^120 lives in the top byte of s0.
    s0: s0 >>> 1 ^ POLY << 24 & -(hiBit & 1)
    // reduce % poly
  };
};
const swapLE = (n) => (n >>> 0 & 255) << 24 | (n >>> 8 & 255) << 16 | (n >>> 16 & 255) << 8 | n >>> 24 & 255 | 0;
const estimateWindow = (bytes) => {
  if (bytes > 64 * 1024)
    return 8;
  if (bytes > 1024)
    return 4;
  return 2;
};
const GHASH = class {
  // We select bits per window adaptively based on expectedLength
  constructor(key, expectedLength) {
    __publicField(this, "blockLen", BLOCK_SIZE);
    __publicField(this, "outputLen", BLOCK_SIZE);
    __publicField(this, "s0", 0);
    __publicField(this, "s1", 0);
    __publicField(this, "s2", 0);
    __publicField(this, "s3", 0);
    __publicField(this, "finished", false);
    __publicField(this, "destroyed", false);
    __publicField(this, "t");
    __publicField(this, "W");
    __publicField(this, "windowSize");
    abytes(key, 16, "key");
    key = copyBytes(key);
    const kView = createView(key);
    let k0 = kView.getUint32(0, false);
    let k1 = kView.getUint32(4, false);
    let k2 = kView.getUint32(8, false);
    let k3 = kView.getUint32(12, false);
    const doubles = [];
    for (let i = 0; i < 128; i++) {
      doubles.push({ s0: swapLE(k0), s1: swapLE(k1), s2: swapLE(k2), s3: swapLE(k3) });
      ({ s0: k0, s1: k1, s2: k2, s3: k3 } = mul2(k0, k1, k2, k3));
    }
    const W = estimateWindow(expectedLength || 1024);
    if (![1, 2, 4, 8].includes(W))
      throw new Error("ghash: invalid window size, expected 2, 4 or 8");
    this.W = W;
    const bits = 128;
    const windows = bits / W;
    const windowSize = this.windowSize = 2 ** W;
    const items = [];
    for (let w = 0; w < windows; w++) {
      for (let byte = 0; byte < windowSize; byte++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let j = 0; j < W; j++) {
          const bit = byte >>> W - j - 1 & 1;
          if (!bit)
            continue;
          const { s0: d0, s1: d1, s2: d2, s3: d3 } = doubles[W * w + j];
          s0 ^= d0, s1 ^= d1, s2 ^= d2, s3 ^= d3;
        }
        items.push({ s0, s1, s2, s3 });
      }
    }
    this.t = items;
  }
  _updateBlock(s0, s1, s2, s3) {
    s0 ^= this.s0, s1 ^= this.s1, s2 ^= this.s2, s3 ^= this.s3;
    const { W, t, windowSize } = this;
    let o0 = 0, o1 = 0, o2 = 0, o3 = 0;
    const mask = (1 << W) - 1;
    let w = 0;
    for (const num of [s0, s1, s2, s3]) {
      for (let bytePos = 0; bytePos < 4; bytePos++) {
        const byte = num >>> 8 * bytePos & 255;
        for (let bitPos = 8 / W - 1; bitPos >= 0; bitPos--) {
          const bit = byte >>> W * bitPos & mask;
          const { s0: e0, s1: e1, s2: e2, s3: e3 } = t[w * windowSize + bit];
          o0 ^= e0, o1 ^= e1, o2 ^= e2, o3 ^= e3;
          w += 1;
        }
      }
    }
    this.s0 = o0;
    this.s1 = o1;
    this.s2 = o2;
    this.s3 = o3;
  }
  update(data) {
    aexists(this);
    abytes(data);
    data = copyBytes(data);
    const b32 = u32(data);
    const blocks = Math.floor(data.length / BLOCK_SIZE);
    const left = data.length % BLOCK_SIZE;
    for (let i = 0; i < blocks; i++) {
      this._updateBlock(swap8IfBE(b32[i * 4 + 0]), swap8IfBE(b32[i * 4 + 1]), swap8IfBE(b32[i * 4 + 2]), swap8IfBE(b32[i * 4 + 3]));
    }
    if (left) {
      ZEROS16.set(data.subarray(blocks * BLOCK_SIZE));
      this._updateBlock(swap8IfBE(ZEROS32[0]), swap8IfBE(ZEROS32[1]), swap8IfBE(ZEROS32[2]), swap8IfBE(ZEROS32[3]));
      clean(ZEROS32);
    }
    return this;
  }
  destroy() {
    this.destroyed = true;
    const { t } = this;
    for (const elm of t) {
      elm.s0 = 0, elm.s1 = 0, elm.s2 = 0, elm.s3 = 0;
    }
  }
  digestInto(out) {
    aexists(this);
    aoutput32(out, this);
    this.finished = true;
    const { s0, s1, s2, s3 } = this;
    const o32 = u32(out);
    o32[0] = s0;
    o32[1] = s1;
    o32[2] = s2;
    o32[3] = s3;
    if (!isLE)
      swap32IfBE(o32.subarray(0, BLOCK_SIZE / 4));
  }
  digest() {
    const res = new Uint8Array(BLOCK_SIZE);
    this.digestInto(res);
    this.destroy();
    return res;
  }
};
const ghash = /* @__PURE__ */ wrapMacConstructor(16, (key, expectedLength) => new GHASH(key, expectedLength), (msg) => [msg.length]);

// node_modules/@noble/ciphers/aes.js
const BLOCK_SIZE2 = 16;
const BLOCK_SIZE32 = 4;
const EMPTY_BLOCK = /* @__PURE__ */ new Uint8Array(BLOCK_SIZE2);
const POLY2 = 283;
function validateKeyLength(key) {
  if (![16, 24, 32].includes(key.length))
    throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
}
function mul22(n) {
  return n << 1 ^ POLY2 & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul22(a);
  }
  return res;
}
const sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul22(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean(t);
  return box;
})();
const rotr32_8 = (n) => n << 24 | n >>> 8;
const rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox2, fn) {
  if (sbox2.length !== 256)
    throw new Error("wrong sbox length");
  const T0 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
  const T1 = T0.map(rotl32_8);
  const T2 = T1.map(rotl32_8);
  const T3 = T2.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox22 = new Uint16Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T0[i] ^ T1[j];
      T23[idx] = T2[i] ^ T3[j];
      sbox22[idx] = sbox2[i] << 8 | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T0, T1, T2, T3, T01, T23 };
}
const tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
const xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul22(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes(key);
  const len = key.length;
  validateKeyLength(key);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isLE || !isAligned32(key))
    toClean.push(key = copyBytes(key));
  const k32 = swap32IfBE(u32(key));
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean(...toClean);
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctr32(xk, isLE2, nonce, src, dst) {
  abytes(nonce, BLOCK_SIZE2, "nonce");
  abytes(src);
  dst = getOutput(src.length, dst);
  const ctr = nonce;
  const c32 = u32(ctr);
  const view = createView(ctr);
  const src32 = u32(src);
  const dst32 = u32(dst);
  const ctrPos = isLE2 ? 0 : 12;
  const srcLen = src.length;
  let ctrNum = view.getUint32(ctrPos, isLE2);
  for (let i = 0; i + 4 <= src32.length; i += 4) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    dst32[i + 0] = src32[i + 0] ^ swap8IfBE(s0);
    dst32[i + 1] = src32[i + 1] ^ swap8IfBE(s1);
    dst32[i + 2] = src32[i + 2] ^ swap8IfBE(s2);
    dst32[i + 3] = src32[i + 3] ^ swap8IfBE(s3);
    ctrNum = ctrNum + 1 >>> 0;
    view.setUint32(ctrPos, ctrNum, isLE2);
  }
  const start = BLOCK_SIZE2 * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const { s0, s1, s2, s3 } = encrypt(xk, swap8IfBE(c32[0]), swap8IfBE(c32[1]), swap8IfBE(c32[2]), swap8IfBE(c32[3]));
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    swap32IfBE(b32);
    const buf = u8(b32);
    for (let i = start, pos = 0; i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean(b32);
  }
  return dst;
}
function computeTag(fn, isLE2, key, data, AAD) {
  const aadLength = AAD ? AAD.length : 0;
  const h = fn.create(key, data.length + aadLength);
  if (AAD)
    h.update(AAD);
  const num = u64Lengths(8 * data.length, 8 * aadLength, isLE2);
  h.update(data);
  h.update(num);
  const res = h.digest();
  clean(num);
  return res;
}
const gcm = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 12, tagLength: 16, withAAD: true, varSizeNonce: true }, function aesgcm(key, nonce, AAD) {
  if (nonce.length < 8)
    throw new Error("aes/gcm: invalid nonce length");
  const tagLength = 16;
  function _computeTag(authKey, tagMask, data) {
    const tag = computeTag(ghash, false, authKey, data, AAD);
    for (let i = 0; i < tagMask.length; i++)
      tag[i] ^= tagMask[i];
    return tag;
  }
  function deriveKeys() {
    const xk = expandKeyLE(key);
    const authKey = EMPTY_BLOCK.slice();
    const counter = EMPTY_BLOCK.slice();
    ctr32(xk, false, counter, counter, authKey);
    if (nonce.length === 12) {
      counter.set(nonce);
    } else {
      const nonceLen = EMPTY_BLOCK.slice();
      const view = createView(nonceLen);
      view.setBigUint64(8, BigInt(nonce.length * 8), false);
      const g = ghash.create(authKey).update(nonce).update(nonceLen);
      g.digestInto(counter);
      g.destroy();
    }
    const tagMask = ctr32(xk, false, counter, EMPTY_BLOCK);
    return { xk, authKey, counter, tagMask };
  }
  return {
    encrypt(plaintext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const out = new Uint8Array(plaintext.length + tagLength);
      const toClean = [xk, authKey, counter, tagMask];
      if (!isAligned32(plaintext))
        toClean.push(plaintext = copyBytes(plaintext));
      ctr32(xk, false, counter, plaintext, out.subarray(0, plaintext.length));
      const tag = _computeTag(authKey, tagMask, out.subarray(0, out.length - tagLength));
      toClean.push(tag);
      out.set(tag, plaintext.length);
      clean(...toClean);
      return out;
    },
    decrypt(ciphertext) {
      const { xk, authKey, counter, tagMask } = deriveKeys();
      const toClean = [xk, authKey, tagMask, counter];
      if (!isAligned32(ciphertext))
        toClean.push(ciphertext = copyBytes(ciphertext));
      const data = ciphertext.subarray(0, -tagLength);
      const passedTag = ciphertext.subarray(-tagLength);
      const tag = _computeTag(authKey, tagMask, data);
      toClean.push(tag);
      if (!equalBytes(tag, passedTag)) {
        clean(...toClean);
        throw new Error("aes-gcm: invalid tag");
      }
      const out = ctr32(xk, false, counter, data);
      clean(...toClean);
      return out;
    }
  };
});

// src/cinejoy-tv/crypto.js
const HW = "lumen-gate-v2";
const CW = 12;
function base64ToBytes(b64) {
  if (!b64)
    return new Uint8Array(0);
  let clean2 = String(b64).replace(/-/g, "+").replace(/_/g, "/");
  while (clean2.length % 4 !== 0) {
    clean2 += "=";
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean2, "base64"));
  }
  if (typeof atob !== "undefined") {
    const bin = atob(clean2);
    const bytes2 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes2[i] = bin.charCodeAt(i);
    }
    return bytes2;
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  const len = clean2.length;
  const placeHolders = clean2.endsWith("==") ? 2 : clean2.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(len * 3 / 4 - placeHolders);
  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[clean2.charCodeAt(i)];
    const b = lookup[clean2.charCodeAt(i + 1)];
    const c = lookup[clean2.charCodeAt(i + 2)];
    const d = lookup[clean2.charCodeAt(i + 3)];
    bytes[j++] = a << 2 | b >> 4;
    if (j < bytes.length)
      bytes[j++] = (b & 15) << 4 | c >> 2;
    if (j < bytes.length)
      bytes[j++] = (c & 3) << 6 | d & 63;
  }
  return bytes;
}
function decodeUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") {
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
    }
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("utf8");
  }
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  try {
    return decodeURIComponent(escape(str));
  } catch (e) {
    return str;
  }
}
function makeAad(keyId, ephemeralPublic) {
  let k;
  if (typeof TextEncoder !== "undefined") {
    k = new TextEncoder().encode(HW);
  } else if (typeof Buffer !== "undefined") {
    k = Buffer.from(HW, "utf8");
  } else {
    k = new Uint8Array(HW.length);
    for (let i = 0; i < HW.length; i++)
      k[i] = HW.charCodeAt(i);
  }
  const ephem = ephemeralPublic instanceof Uint8Array ? ephemeralPublic : base64ToBytes(ephemeralPublic);
  const e = new Uint8Array(k.length + 3 + ephem.length);
  e.set(k, 0);
  e[k.length] = 0;
  e[k.length + 1] = 2;
  e[k.length + 2] = Number(keyId);
  e.set(ephem, k.length + 3);
  return e;
}
function decrypt(encData, sealResult) {
  return __async(this, null, function* () {
    const encBytes = encData instanceof Uint8Array ? encData : new Uint8Array(encData);
    const iv = encBytes.slice(0, CW);
    const ciphertextWithTag = encBytes.slice(CW);
    let keyBytes;
    if (sealResult.responseKey instanceof Uint8Array) {
      keyBytes = sealResult.responseKey;
    } else if (typeof sealResult.responseKey === "string") {
      keyBytes = base64ToBytes(sealResult.responseKey);
    } else {
      keyBytes = new Uint8Array(sealResult.responseKey);
    }
    let aadBytes;
    if (sealResult.aad) {
      if (sealResult.aad instanceof Uint8Array) {
        aadBytes = sealResult.aad;
      } else if (typeof sealResult.aad === "string") {
        aadBytes = base64ToBytes(sealResult.aad);
      } else {
        aadBytes = new Uint8Array(sealResult.aad);
      }
    } else {
      aadBytes = makeAad(sealResult.keyId, sealResult.ephemeralPublic);
    }
    const cipher = gcm(keyBytes, iv, aadBytes);
    const decryptedBytes = cipher.decrypt(ciphertextWithTag);
    return decodeUtf8(decryptedBytes);
  });
}

// src/cinejoy-tv/wasm.js
const CRUSH_WASM_RAW_B64 = "AGFzbQEAAAABbQ5gAn9/AGACf38Bf2ADf39/AX9gA39/fwBgAX8Bf2ABfwBgBX9/f39/AGAEf39/fwBgBX9/f39/AX9gBn9/f39/fwBgBn9/f39/fwF/YAd/f39/f39/AX9gC39/f39/f39/f39/AX9gA39+fgADvQG7AQAACQQDBgMDAAQEBgUEAwMGAAAGAwMAAwAFAAMDAwUFAQAEBAUFAwADAwAEAQEBBQABAQABAwAEAAoHAQACAwcGBQABAQAAAAMDAwMDAAADBwAAAAAAAQEBAQEBAQEBAQEBAQEAAAEEBAQDBAYFBgYABwAAAAAAAwMDAwACAAAAAwEFBQABAgMAAAAFBAEAAAABAAAAAQYDAAMDAgAFAAIBCAEGAwEDAQEBAgEIAQgCCwwIAwEBAwENBwIEBQFwATY2BQMBABEGGQN/AUGAgMAAC38AQZW+wAALfwBBoL7AAAsHRgYGbWVtb3J5AgAFYWxsb2MANwdkZWFsbG9jADgMc2VhbF9yZXF1ZXN0ADkKX19kYXRhX2VuZAMBC19faGVhcF9iYXNlAwIJUgEAQQELNSQ2IiN8fTIsNC5bIGEtWVpXMWJWXbQBXGCiAV5YpQFjZo4BggGGAYUBgQF+f5UBkgGTAZQBgwGRAY8BkAGEAagBXKkBtwGqAasBrQEK9M8DuwGeAgEFfyMAQSBrIgIkACACQRhqIAFBGGopAgA3AwAgAkEQaiABQRBqKQIANwMAIAJBCGogAUEIaikCADcDACACIAEpAgA3AwAjAEEgayIFJAAgBSACEFMjAEEgayIBQRhqQgA3AwAgAUEQakIANwMAIAFBCGpCADcDACABQgA3AwAgBUEcaiEGA0AgBEEgRiIDIANyRQRAIAEgBGogBigCACIDQRh0IANBgP4DcUEIdHIgA0EIdkGA/gNxIANBGHZycjYAACAEQQRqIQQgBkEEayEGDAELCyAAIAEpAwA3AAAgAEEYaiABQRhqKQMANwAAIABBEGogAUEQaikDADcAACAAQQhqIAFBCGopAwA3AAAgBUEgaiQAIAJBIGokAAs3AQJ/IAAgASgCACICIAEoAgQiA0cEfyABIAJBAWo2AgAgAi0AAAUgAQs6AAEgACACIANHOgAACzwAAkAgASACTQRAIAIgBE0NASACIAQgBRCaAQALIAFBACAFEKQBAAsgACACIAFrNgIEIAAgASADajYCAAsJACAALQBAEGcLzwUBDH8jAEHgAmsiAyQAIANBDGoiBCABEFIgA0HoAGpCADcDACADQeAAakIANwMAIANB2ABqQgA3AwAgA0IANwNQIANBMGoiBSADQdAAaiAEIAMtACwQUCADQbgBaiIJIAUgBRAGIANBwAJqIgogCSAFEAYgA0GUAWoiAUGEjsAAIAUQBiADQaACaiILIAogARAHIANB0AFqIgxBvI7AACkCADcDACADQcgBaiINQbSOwAApAgA3AwAgA0HAAWoiDkGsjsAAKQIANwMAIANBpI7AACkCADcDuAEgA0H0AGoiBSALIAkQByMAQaACayIEJAAgBEGAAmoiBiAFEE4gBCAFIAYQSCAGIARBAhBPIARBIGoiByAEIAYQSCAGIAdBBBBPIARBQGsiCCAHIAYQSCAGIAhBCBBPIARB4ABqIgcgBiAIEEggBiAHQRAQTyAEQeABaiIIIAYgBxBIIAYgCEEgEE8gBEHAAWoiByAGIAUQSCAGIAdB4AAQTyAEQaABaiIIIAYgBRBIIARBgAFqIgcgCEHeABBPIAYgByAHEEggASAGIAUQQzoAICABQRhqIARBmAFqKQIANwIAIAFBEGogBEGQAWopAgA3AgAgAUEIaiAEQYgBaikCADcCACABIAQpAoABNwIAIARBoAJqJAAgA0G4AmpCADcDACADQbACakIANwMAIANBqAJqQgA3AwAgA0IANwOgAiADQYACaiIFIAsgASADLQC0ARBQIAogBRAIIANB2AFqIAogBSMAQSBrIgEkACABIAUQUyABKAIAQQFxEGchBSABQSBqJAAgAiAFcxBnEAkQUCAOIANBOGopAgA3AwAgDSADQUBrKQIANwMAIAwgA0HIAGopAgA3AwAgA0EAOgD4ASADIAMpAjA3A7gBIAMtACwgAy0AtAFxEGchASAAIAlBxAD8CgAAIAAgAToARCADQeACaiQACz0BAX8jAEEQayIFJAAgBUEIakEAIAEgAiADIAQQAiAFKAIMIQEgACAFKAIINgIAIAAgATYCBCAFQRBqJAALIgEBfyMAQSBrIgMkACADIAEgAhBJIAAgAxBFIANBIGokAAsiAQF/IwBBIGsiAyQAIAMgASACEEogACADEEUgA0EgaiQACyUBAX8jAEEgayICJAAgAkG4oMAAIAEQTCAAIAIQRSACQSBqJAALDAAgAEF/c0EBcRBnCwsAIAAQDUH/AXFFC2gBAX8jAEEgayIFJAAgAiADSQRAIAVBADYCGCAFQQE2AgwgBUGok8AANgIIIAVCBDcCECAFQQhqIAQQngEACyAAIAM2AgQgACABNgIAIAAgAiADazYCDCAAIAEgA2o2AgggBUEgaiQAC4oDAQJ/IwBBIGsiASQAIAEgADYCBCAAQSBHBEAgAUEANgIIIwBBEGsiAiQAIAJB8I3AADYCDCACIAFBBGo2AggjAEHwAGsiACQAIABBzLTAADYCDCAAIAJBCGo2AgggAEHMtMAANgIUIAAgAkEMajYCECAAQai6wAAoAgA2AhwgAEGcusAAKAIANgIYAkAgAUEIaiIBKAIABEAgAEEwaiABQRBqKQIANwMAIABBKGogAUEIaikCADcDACAAIAEpAgA3AyAgAEEENgJcIABBzLXAADYCWCAAQgQ3AmQgACAAQRBqrUKAgICA8AWENwNQIAAgAEEIaq1CgICAgPAFhDcDSCAAIABBIGqtQoCAgICQBoQ3A0AMAQsgAEEDNgJcIABBmLXAADYCWCAAQgM3AmQgACAAQRBqrUKAgICA8AWENwNIIAAgAEEIaq1CgICAgPAFhDcDQAsgACAAQRhqrUKAgICAgAaENwM4IAAgAEE4ajYCYCAAQdgAakH0jcAAEJ4BAAsgAUEgaiQAC1oBAn8jAEHwAGsiASQAIAFBCGoiAiAALQAAECogASgCCEEFRwRAIAFBPGoiACACQTT8CgAAQYCWwABBCyAAQdCTwABBjJbAABCjAQALIAEtAAwgAUHwAGokAAvJBQENfyMAQaAEayIDJAAgAyABIAIQBiADQSBqIgcgAUEgaiIJIAJBIGoiChAGIANBQGsiBiABQUBrIgsgAkFAayIMEAYgA0HgA2oiBSABIAkQByADQYAEaiIEIAIgChAHIANBwANqIgggBSAEEAYgBCADIAcQByADQeAAaiINIAggBBAXIAUgCSALEAcgBCAKIAwQByAIIAUgBBAGIAQgByAGEAcgA0GAAWoiCiAIIAQQFyAFIAEgCxAHIAQgAiAMEAcgCCAFIAQQBiAEIAMgBhAHIANBoAFqIgsgCCAEEBcgBEGkjsAAIAYQBiADQcABaiIBIAsgBBAXIAUgARBVIANBmARqIgEgA0HYAWopAgA3AwAgA0GQBGoiAiADQdABaikCADcDACADQYgEaiIJIANByAFqKQIANwMAIAMgAykCwAE3A4AEIANB4AFqIgwgBSAEEAcgA0GAAmoiDiAHIAwQFyADQaACaiIPIAcgDBAHIAUgBhBVIAEgA0HYAGopAgA3AwAgAiADQdAAaikCADcDACAJIANByABqKQIANwMAIAMgAykCQDcDgAQgA0HAAmoiByAFIAQQByAFQaSOwAAgCxAGIAQgByADEAcgA0HgAmoiBiAFIAQQFyAFIAYQVSABIANB+AJqKQIANwMAIAIgA0HwAmopAgA3AwAgCSADQegCaikCADcDACADIAMpAuACNwOABCADQYADaiIGIAUgBBAHIAUgAxBVIAEgA0EYaikCADcDACACIANBEGopAgA3AwAgCSADQQhqKQIANwMAIAMgAykCADcDgAQgCCAFIAQQByADQaADaiIBIAggBxAXIAUgDyANEAYgBCAKIAYQBiAAIAUgBBAXIAUgDyAOEAYgBCABIAYQBiAAQSBqIAUgBBAHIAUgDiAKEAYgBCANIAEQBiAAQUBrIAUgBBAHIANBoARqJAAL1wcBC38jAEHwEGsiAyQAIANByA9qIAJBGGopAgA3AwAgA0HAD2ogAkEQaikCADcDACADQbgPaiACQQhqKQIANwMAIAMgAikCADcDsA8gA0GQEGoiBBBBIANCoICAgMAANwLcDkEAIQIgA0EANgLUDiADIANBsBBqNgLQDiADQdgOaiIFIAQ2AgAgA0HQDmoQayEEIANByABqIANB4A5qKAIANgIAIANBQGsgBSkCADcCACADQQg2AlQgAyADQdAPajYCNCADIAMpAtAONwI4IANBCCAEIARBCE8bIgQ2AlAgAyADQbAPajYCMCADQThqIQUDQAJAIAIgBE8NACADIAJBAWo2AkwgAygCMCACQQJ0aigCACEEIANBCGogBSACEGogAygCCCICRQ0AIAMoAgwhBiADIAQ2AtAOIAIgBiADQdAOakEEQaiRwAAQECADKAJQIQQgAygCTCECDAELCyADQRhqIANBmBBqKQAANwMAIANBIGogA0GgEGopAAA3AwAgA0EoaiADQagQaikAADcDACADIAMpAJAQNwMQQQAhAgNAIAJBgAxGRQRAIANBMGogAmpBiI/AAEHgAPwKAAAg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IAE2AgAgAEECNgIMIABBzLjAADYCCCAAQgI3AhQgACAAQQRqrUKAgICAwAOENwMoIAAgAK1CgICAgMADhDcDICAAIABBIGo2AhAgAEEIaiAEEJ4BAAsgACADIAFrNgIEIAAgASACajYCAAsYACAAIAApAyAgAq18NwMgIAAgASACED4LpwUCBn8DfiMAQZABayIDJAAgA0EYahBBIAEtAEAhBCADIAA2AjggACkDICEJIAEgBGpBgAE6AAAgAyADQThqNgI8IANBEGogBEEBaiABQcAAQfiQwAAQEyAErUIDhiEKIAMoAhQhACADKAIQIQUDQCAABEAgBUEAOgAAIABBAWshACAFQQFqIQUMAQsLIApCOIYgCUIJhiILIAqEIgpCgP4Dg0IohoQgCkKAgPwHg0IYhiAKQoCAgPgPg0IIhoSEIAlCAYZCgICA+A+DIAlCD4hCgID8B4OEIAlCH4hCgP4DgyALQjiIhISEIQkCQCAEQThxQThHBEAgASAJNwA4IANBPGogARAWDAELIANBPGoiACABEBYgA0HQAGoiBEEAQTj8CwAgAyAJNwCIASAAIAQQFgsgAUEAOgBAIANCoICAgMAANwJIIANBADYCQCADIANBOGo2AjwgAygCOCEEIAMgA0EYajYCRCMAQRBrIgEkACABIARBIGoiCDYCDCABIAQ2AgggA0E8aiIFEGshBiABQQhqIgAoAgQgACgCAGtBAnYhByADQdAAaiIAIAY2AiQgAEEANgIcIAAgCDYCGCAAIAQ2AhQgAEEQaiAFQRBqKAIANgIAIABBCGogBUEIaikCADcCACAAIAUpAgA3AgAgACAHIAYgBiAHSxs2AiAgAUEQaiQAA0ACQCADKAJsIgAgAygCcE8NACADIABBAWo2AmwgA0EIaiADQdAAaiAAEGogAygCCCIBRQ0AIAMoAgwhBCADIAMoAmQgAEECdGooAgAiAEEYdCAAQYD+A3FBCHRyIABBCHZBgP4DcSAAQRh2cnI2AjwgASAEIANBPGpBBEH8nMAAEBAMAQsLIAJBICADQRhqQSBB6I/AABAQIANBkAFqJAALEAAgACgCACgCACABQQEQPgsiAQF/IwBBIGsiAyQAIAMgASACEEwgACADEEUgA0EgaiQAC9wBAQR/AkAjAEEgayIDJABBECABQRBqIAFrIgQgBEEQTxsh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QQRqIQMMAQsLIAwgASkC+AE3AgggDCABKQLwATcCACABQYACaiQAIBcgDEEIaikCADcCACANIAwpAgA3AhAgDEEgaiQAIBBBEGokACAAQRBqIQAMAQsLIBJBEGokAAvLAQIEfwF+IwBBEGsiBCQAIARBBGoiAwJ/AkAgAa0iB0IgiFAEQCAHpyIFQf////8HTQ0BCyADQQA2AgRBAQwBCyAFRQRAIANBATYCCCADQQA2AgRBAAwBCyAFQQEQOyIGBEAgAyAGNgIIIAMgATYCBEEADAELIAMgBTYCCCADQQE2AgRBAQs2AgAgBCgCCCEBIAQoAgRBAUYEQCABIAQoAgwgAhCXAQALIAQoAgwhAiAAQQA2AgggACACNgIEIAAgATYCACAEQRBqJAALdAEEfyMAQSBrIgEkACABQQhqIgJCADcDACABQRBqIgNCADcDACABQRhqIgRCADcDACABQgA3AwAgACABKQMANwIAIABBCGogAikDADcCACAAQRBqIAMpAwA3AgAgAEEYaiAEKQMANwIAIAAQHyABQSBqJAALIQEBfyMAQRBrIgEkACABIAA2AgwgAC0AABogAUEQaiQAC04BAX8jAEEQayICJAAgAiAAKAIAIgA2AgwgAUHMlsAAQQVB0ZbAAEEEIABBCGpBrJbAAEHVlsAAQQggAkEMakG8lsAAELEBIAJBEGokAAtdAQF/IwBBIGsiAiQAIAIQQSABIAFBKGogAhAVIABBGGogAkEYaikAADcAACAAQRBqIAJBEGopAAA3AAAgAEEIaiACQQhqKQAANwAAIAAgAikAADcAACACQSBqJAALBwAgACgCCAsIACAAKAIIRQsGACAAEC8LRQEEfyAAQQ9qIQIDQAJAIAFBeEYNACAALQAAIQMgACABIAJqIgQtAAA6AAAgBCADOgAAIAFBAWshASAAQQFqIQAMAQsLC9ACAQV/IwBBQGoiAyQAIAMgADYCKCAAQdAAaiEFIAAtAJABIQQgAyADQShqNgIsAkACQAJAQcAAIARrIgYgAk0EQCAEDQEMAgsgA0EQaiAEIAVBwABByJDAABATIANBCGogAiADKAIQIAMoAhRB2JDAABAFIAMoAgggAygCDCABIAJB6JDAABAQIAIgBGohBAwCCyADQTBqIAEgAiAGQfiPwAAQCyADKAI8IQIgAygCOCEBIAMoAjQhBiADKAIwIQcgA0EgaiAEIAVBwABBiJDAABATIAMoAiAgAygCJCAHIAZBmJDAABAQIANBLGogBUEBEDULIAJBP3EhBCACQcAATwRAIANBLGogASACQQZ2EDULIANBGGogBCAFQcAAQaiQwAAQBSADKAIYIAMoAhwgASACQUBxaiAEQbiQwAAQEAsgACAEOgCQASADQUBrJAALswEBBH8jAEHQAGsiAiQAIAJBEGoiBRBBIAJBMGoiAxBBIAEgAUHQAGoiBCADEBUgAUEAOgCQASACQQhqQSAgBEHAAEHYkMAAEAUgAigCCCACKAIMIANBIEHokMAAEBAgAUEgOgCQASABQShqIAQgBRAVIABBGGogAkEoaikAADcAACAAQRBqIAJBIGopAAA3AAAgAEEIaiACQRhqKQAANwAAIAAgAikAEDcAACACQdAAaiQAC5ICAQJ/IwBB0AJrIgMkACADQRBqIgRBAEHAAPwLAAJAIAJBwABNBEAgA0EIaiACIARBwABB8JTAABAFIAMoAgggAygCDCABIAJBgJXAABAQDAELIANBmAFqQQBBwQD8CwAgA0GIAWpBqJ3AACkDADcDACADQYABakGgncAAKQMANwMAIANB+ABqQZidwAApAwA3AwAgA0IANwOQASADQZCdwAApAwA3A3AgA0HwAGoiBCABIAIQKSADQeABaiIBIARB8AD8CgAAIANB0ABqIgIgARAhIANBICADQRBqQcAAQdCUwAAQBSADKAIAIAMoAgQgAkEgQeCUwAAQEAsgACADQRBqQcAA/AoAACADQdACaiQAC80CAQV/IwBBQGoiAyQAIAMgADYCKCAAQShqIQUgAC0AaCEEIAMgA0EoajYCLAJAAkACQEHAACAEayIGIAJNBEAgBA0BDAILIANBEGogBCAFQcAAQciQwAAQEyADQQhqIAIgAygCECADKAIUQdiQwAAQBSADKAIIIAMoAgwgASACQeiQwAAQECACIARqIQQMAgsgA0EwaiABIAIgBkH4j8AAEAsgAygCPCECIAMoAjghASADKAI0IQYgAygCMCEHIANBIGogBCAFQcAAQYiQwAAQEyADKAIgIAMoAiQgByAGQZiQwAAQECADQSxqIAVBARA1CyACQT9xIQQgAkHAAE8EQCADQSxqIAEgAkEGdhA1CyADQRhqIAQgBUHAAEGo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AWogAiAFIAIbQcEAQSAgAhsQKEEAIQIDQCACQcAARwRAIARBwAFqIAJqIgUgBS0AAEE2czoAACACQQFqIQIMAQsLQQAhAiAEQZgCakGoncAAKQMANwMAIARBkAJqQaCdwAApAwA3AwAgBEGIAmpBmJ3AACkDADcDACAEQgA3A6ACIARBkJ3AACkDADcDgAIgBEGAAmogBEHAAWpBARAUA0AgAkHAAEcEQCAEQcABaiACaiIFIAUtAABB6gBzOgAAIAJBAWohAgwBCwsgBEHAAmpBqJ3AACkDADcDACAEQbgCakGgncAAKQMANwMAIARBsAJqQZidwAApAwA3AwAgBEIANwPIAiAEQZCdwAApAwA3A6gCIARBqAJqIgIgBEHAAWpBARAUIARB+AJqIAJBKPwKAAAgBEHQAmoiAiAEQYACakEo/AoAACAEQfgAakEAQcEA/AsAIARBKGoiBSACQdAA/AoAACAIIAVBmAH8CgAAIARBoANqJAAgCCABQSAQJiAIQZgBaiIBIAhBmAH8CgAAIwBB4AFrIgIkACACQShqIgUgAUGYAfwKAAAgAkHAAWoiASAFECcgAkEIaiIEIAEQGiMAQeABayIBJAAgASAEQSAQKEEAIQQDQCAEQcAARwRAIAEgBGoiCiAKLQAAQTZzOgAAIARBAWohBAwBCwtBACEEIAFB2ABqQaidwAApAwA3AwAgAUHQAGpBoJ3AACkDADcDACABQcgAakGYncAAKQMANwMAIAFCADcDYCABQZCdwAApAwA3A0AgAUFAayABQQEQFANAIARBwABHBEAgASAEaiIKIAotAABB6gBzOgAAIARBAWohBAwBCwsgAUGAAWpBqJ3AACkDADcDACABQfgAakGgncAAKQMANwMAIAFB8ABqQZidwAApAwA3AwAgAUIANwOIASABQZCdwAApAwA3A2ggAUHoAGoiBCABQQEQFCABQbgBaiAEQSj8CgAAIAFBkAFqIgQgAUFAa0Eo/AoAACAFQQhqIARB0AD8CgAAIAVCADcDACABQeABaiQAAkAgAigCKEEBRwRAIAdBIGogAkEwakHQAPwKAAAgB0EYaiACQSBqKQAANwAAIAdBEGogAkEYaikAADcAACAHQQhqIAJBEGopAAA3AAAgByACKQAINwAAIAJB4AFqJAAMAQtBrJTAAEETIAJBwAFqQcCTwABBwJTAABCjAQALIAhBsAJqJAAgBiAHQSBqQdAA/AoAACAHQfAAaiQAIAZB6ABqIgxCADcDACAGQeAAaiINQgA3AwAgBkHYAGoiDkIANwMAIAZCADcDUCAGQfQAaiIBQRFBuJ/AABAdIAFBoJ/AAEENEHogASADQQQQeiAGKAJ4IQEgBigCfCECIAZB0ABqIQUjAEEQayIIJAAgCCACNgIMIAggATYCCCAIQQhqIQFBACECQSAhBCMAQaADayIDJAAgA0EAOgAPIAZBKGohDyADQRBqIQcgA0GAAWohECADQZACaiERA0AgBARAIBEgD0Eo/AoAACADQegBaiIKIAZBKPwKAAAgEEEAQcEA/AsAIANBMGoiCSAKQdAA/AoAACACQQFxBEAgCSAHQSAQJgsgBEEgIAQgBEEgTxsiCmshBEEIIQkgASECA0AgCQRAIANBMGogAigCACACKAIEECYgCUEIayEJIAJBCGohAgwBCwtBASECIAMgEkEBaiISOgDoASADQTBqIgsgA0HoAWoiCUEBECYgCSALQZgB/AoAACADQYADaiILIAkQJyADQcgBaiIJIAsQGiAFIAogCSAKQZyUwAAQECAHQRhqIANB4AFqKQAANwAAIAdBEGogA0HYAWopAAA3AAAgB0EIaiADQdABaikAADcAACAHIAMpAMgBNwAAIANBAToADyAFIApqIQUMAQsLIANBoANqJAAgCEEQaiQAIAAgBikDUDcAASAAQRlqIAwpAwA3AAAgAEERaiANKQMANwAAIABBCWogDikDADcAACAGQfQAahAvIABBADoAACAGQYABaiQACxsAAn8gAUEJTwRAIAEgABCNAQwBCyAAEIwBCwteAQJ/AkACQCAAQQRrKAIAIgJBeHEiA0EEQQggAkEDcSICGyABak8EQCACQQAgAyABQSdqSxsNASAAEIsBDAILQcSxwABB9LHAABCcAQALQYSywABBtLLAABCcAQALC+YFAQV/An8CQAJAAkAgAEEEayIEKAIAIgZBeHEiA0EEQQggBkEDcSIFGyABak8EQCAFQQAgAUEnaiADSRsNAQJAIAJBzP97Sw0AQRAgAkELakF4cSACQQtJGyEBAkAgBUUEQCABQYACSSADIAFBBHJJciADIAFrQYGACE9yDQEMBgsgAEEIayIFIANqIQcCQAJAAkACQCABIANLBEAgB0H4vcAAKAIARg0EIAdB9L3AACgCAEYNAiAHKAIEIgZBAnENBSAGQXhxIgYgA2oiAyABSQ0FIAcgBhCIASADIAFrIgJBEEkNASAEIAEgBCgCAEEBcXJBAnI2AgAgASAFaiIBIAJBA3I2AgQgAyAFaiIEIAQoAgRBAXI2AgQgASACEIkBDAoLIAMgAWsiAkEPSw0CDAkLIAQgAyAEKAIAQQFxckECcjYCACADIAVqIgEgASgCBEEBcjYCBAwIC0HsvcAAKAIAIANqIgMgAUkNAgJAIAMgAWsiAkEPTQRAIAQgBkEBcSADckECcjYCACADIAVqIgEgASgCBEEBcjYCBEEAIQJBACEBDAELIAQgASAGQQFxckECcjYCACABIAVqIgEgAkEBcjYCBCADIAVqIgQgAjYCACAEIAQoAgRBfnE2AgQLQfS9wAAgATYCAEHsvcAAIAI2AgAMBwsgBCABIAZBAXFyQQJyNgIAIAEgBWoiASACQQNyNgIEIAcgBygCBEEBcjYCBCABIAIQiQEMBgtB8L3AACgCACADaiIDIAFLDQQLIAIQjAEiAUUNACACQXxBeCAEKAIAIgRBA3EbIARBeHFqIgQgAiAESRsiAgRAIAEgACAC/AoAAAsgABCLASABDAULQQAMBAtBxLHAAEH0scAAEJwBAAtBhLLAAEG0ssAAEJwBAAsgBCABIAZBAXFyQQJyNgIAIAEgBWoiAiADIAFrIgFBAXI2AgRB8L3AACABNgIAQfi9wAAgAjYCACAADAELIAALC5s6ASZ/IwBBkANrIgMkACADQQxqQQBBwAD8CwAgASACQQZ0aiEnIAAoAhwhIyAAKAIYISQgACgCFCEfIAAoAhAhICAAKAIMISUgACgCCCEmIAAoAgQhISAAKAIAISIDQCABICdHBEAgA0KAgICAwAA3AlggAyABNgJMIANBwAA2AlAgAyABQUBrIig2AlQgA0HMAGoiAigCECIIRQRAQaigwAAQnQEAC0EQIAIoAgQgCG4iAiACQRBPG0ECdCEOQQAhAgNAIAIgDkcEQCADQQxqIAJqIAEgAmooAAAiCEEYdCAIQYD+A3FBCHRyIAhBCHZBgP4DcSAIQRh2cnI2AgAgAkEEaiECDAELCyADKAJIIQ8gAygCRCEQIAMoAkAhESADKAI8IRIgAygCOCETIAMoAjQhFCADKAIwIRUgAygCLCEWIAMoAighFyADKAIkIRggAygCICEZIAMoAhwhGiADKAIYIR4gAygCFCEbIAMoAhAhHCADKAIMIR0gAyAmNgLwAiADICU2AvQCIAMgJDYC+AIgAyAjNgL8AiADIB82AowDIAMgIDYCiAMgAyAhNgKEAyADICI2AoADIAMgHUGY36iUBGoiDTYCWCADIBxBkYndiQdqIgQ2AlQgAyAbQbGI/NEEayIFNgJQIAMgHkHbyKiyAWsiBjYCTCADQeACaiIOIANB8AJqIgEgA0GAA2oiAiADQcwAaiIIED8gAyAFNgJsIAMgBjYCaCADIA02AmQgAyAENgJgIAMoAuACIQ0gAygC5AIhBCADKALoAiEFIAMoAuwCIQYgAyAfNgKMAyADICA2AogDIAMgITYChAMgAyAiNgKAAyADIAY2AlggAyAFNgJUIAMgBDYCUCADIA02AkwgASACIAggA0HgAGoQPyADKALwAiEJIAMoAvQCIQogAygC+AIhCyADKAL8AiEMIAMgBjYC/AIgAyAFNgL4AiADIAQ2AvQCIAMgDTYC8AIgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIBpB24TbygNqIg02AlggAyAZQfGjxM8FaiIENgJUIAMgGEHc+oHuBmsiBTYCUCADIBdBq8KOpwVrIgY2AkwgDiABIAIgCBA/IAMgBTYCfCADIAY2AnggAyANNgJ0IAMgBDYCcCADKALgAiENIAMoAuQCIQQgAygC6AIhBSADKALsAiEGIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAGNgJYIAMgBTYCVCADIAQ2AlAgAyANNgJMIAEgAiAIIANB8ABqED8gAygC8AIhCSADKAL0AiEKIAMoAvgCIQsgAygC/AIhDCADIAY2AvwCIAMgBTYC+AIgAyAENgL0AiADIA02AvACIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAWQeiq4b8CayINNgJYIAMgFUGBto2UAWoiBDYCVCADIBRBvovGoQJqIgU2AlAgAyATQcP7sagFaiIGNgJMIA4gASACIAgQPyADIAU2AowBIAMgBjYCiAEgAyANNgKEASADIAQ2AoABIAMoAuACIQ0gAygC5AIhBCADKALoAiEFIAMoAuwCIQYgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIAY2AlggAyAFNgJUIAMgBDYCUCADIA02AkwgASACIAggA0GAAWoQPyADKALwAiEJIAMoAvQCIQogAygC+AIhCyADKAL8AiEMIAMgBjYC/AIgAyAFNgL4AiADIAQ2AvQCIAMgDTYC8AIgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIBJB9Lr5lQdqIg02AlggAyARQYKchfkHayIENgJUIAMgEEHZ8o+hBmsiBTYCUCADIA9BjJ2Q8wNrIgY2AkwgDiABIAIgCBA/IAMgBTYCnAEgAyAGNgKYASADIA02ApQBIAMgBDYCkAEgAygC4AIhBCADKALkAiEFIAMoAugCIQYgAygC7AIhByADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgBzYCWCADIAY2AlQgAyAFNgJQIAMgBDYCTCABIAIgCCADQZABahA/IAMoAvACIQkgAygC9AIhCiADKAL4AiELIAMoAvwCIQwgAyAdNgLsAiADIBw2AugCIAMgGzYC5AIgAyAeNgLgAiADIBo2AvwCIAMgGTYC+AIgAyAYNgL0AiADIBc2AvACIAMgFjYCjAMgAyAVNgKIAyADIBQ2AoQDIAMgEzYCgAMgAyASNgJYIAMgETYCVCADIBA2AlAgAyAPNgJMIANB0AJqIh4gDiABIAIgCBBAIAMoAtACIRsgAygC1AIhHCADKALYAiEdIAMoAtwCIQ0gAyAHNgL8AiADIAY2AvgCIAMgBTYC9AIgAyAENgLwAiADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgDUG/rJLbAWsiBDYCWCADIB1B+vCGggFrIgU2AlQgAyAcQca7hv4AaiIGNgJQIAMgG0HMw7KgAmoiBzYCTCAOIAEgAiAIED8gAyAGNgKsASADIAc2AqgBIAMgBDYCpAEgAyAFNgKgASADKALgAiEEIAMoAuQCIQUgAygC6AIhBiADKALsAiEHIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAHNgJYIAMgBjYCVCADIAU2AlAgAyAENgJMIAEgAiAIIANBoAFqED8gAygC8AIhCSADKAL0AiEKIAMoAvgCIQsgAygC/AIhDCADIBo2AuwCIAMgGTYC6AIgAyAYNgLkAiADIBc2AuACIAMgFjYC/AIgAyAVNgL4AiADIBQ2AvQCIAMgEzYC8AIgAyASNgKMAyADIBE2AogDIAMgEDYChAMgAyAPNgKAAyADIA02AlggAyAdNgJUIAMgHDYCUCADIBs2AkwgHiAOIAEgAiAIEEAgAygC0AIhFyADKALUAiEYIAMoAtgCIRkgAygC3AIhGiADIAc2AvwCIAMgBjYC+AIgAyAFNgL0AiADIAQ2AvACIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAaQe/YpO8CaiIENgJYIAMgGUGqidLTBGoiBTYCVCADIBhB3NPC5QVqIgY2AlAgAyAXQdqR5rcHaiIHNgJMIA4gASACIAgQPyADIAY2ArwBIAMgBzYCuAEgAyAENgK0ASADIAU2ArABIAMoAuACIQQgAygC5AIhBSADKALoAiEGIAMoAuwCIQcgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIAc2AlggAyAGNgJUIAMgBTYCUCADIAQ2AkwgASACIAggA0GwAWoQPyADKALwAiEJIAMoAvQCIQogAygC+AIhCyADKAL8AiEMIAMgFjYC7AIgAyAVNgLoAiADIBQ2AuQCIAMgEzYC4AIgAyASNgL8AiADIBE2AvgCIAMgEDYC9AIgAyAPNgLwAiADIA02AowDIAMgHTYCiAMgAyAcNgKEAyADIBs2AoADIAMgGjYCWCADIBk2AlQgAyAYNgJQIAMgFzYCTCAeIA4gASACIAgQQCADKALQAiETIAMoAtQCIRQgAygC2AIhFSADKALcAiEWIAMgBzYC/AIgAyAGNgL4AiADIAU2AvQCIAMgBDYC8AIgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIBZBrt2GvgZrIgQ2AlggAyAVQZPzuL4FayIFNgJUIAMgFEG4sPP/BGsiBjYCUCADIBNBuYCahQRrIgc2AkwgDiABIAIgCBA/IAMgBjYCzAEgAyAHNgLIASADIAQ2AsQBIAMgBTYCwAEgAygC4AIhBCADKALkAiEFIAMoAugCIQYgAygC7AIhByADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgBzYCWCADIAY2AlQgAyAFNgJQIAMgBDYCTCABIAIgCCADQcABahA/IAMoAvACIQkgAygC9AIhCiADKAL4AiELIAMoAvwCIQwgAyASNgLsAiADIBE2AugCIAMgEDYC5AIgAyAPNgLgAiADIA02AvwCIAMgHTYC+AIgAyAcNgL0AiADIBs2AvACIAMgGjYCjAMgAyAZNgKIAyADIBg2AoQDIAMgFzYCgAMgAyAWNgJYIAMgFTYCVCADIBQ2AlAgAyATNgJMIB4gDiABIAIgCBBAIAMoAtACIQ8gAygC1AIhECADKALYAiERIAMoAtwCIRIgAyAHNgL8AiADIAY2AvgCIAMgBTYC9AIgAyAENgLwAiADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgEkGN6P/IA2siBDYCWCADIBFBud3h0gJrIgU2AlQgAyAQQdHGqTZqIgY2AlAgAyAPQefSpKEBaiIHNgJMIA4gASACIAgQPyADIAY2AtwBIAMgBzYC2AEgAyAENgLUASADIAU2AtABIAMoAuACIQQgAygC5AIhBSADKALoAiEGIAMoAuwCIQcgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIAc2AlggAyAGNgJUIAMgBTYCUCADIAQ2AkwgASACIAggA0HQAWoQPyADKALwAiEJIAMoAvQCIQogAygC+AIhCyADKAL8AiEMIAMgDTYC7AIgAyAdNgLoAiADIBw2AuQCIAMgGzYC4AIgAyAaNgL8AiADIBk2AvgCIAMgGDYC9AIgAyAXNgLwAiADIBY2AowDIAMgFTYCiAMgAyAUNgKEAyADIBM2AoADIAMgEjYCWCADIBE2AlQgAyAQNgJQIAMgDzYCTCAeIA4gASACIAgQQCADKALQAiEbIAMoAtQCIRwgAygC2AIhHSADKALcAiENIAMgBzYC/AIgAyAGNgL4AiADIAU2AvQCIAMgBDYC8AIgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIA1BhZXcvQJqIgQ2AlggAyAdQbjC7PACaiIFNgJUIAMgHEH827HpBGoiBjYCUCADIBtBk5rgmQVqIgc2AkwgDiABIAIgCBA/IAMgBjYC7AEgAyAHNgLoASADIAQ2AuQBIAMgBTYC4AEgAygC4AIhBCADKALkAiEFIAMoAugCIQYgAygC7AIhByADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgBzYCWCADIAY2AlQgAyAFNgJQIAMgBDYCTCABIAIgCCADQeABahA/IAMoAvACIQkgAygC9AIhCiADKAL4AiELIAMoAvwCIQwgAyAaNgLsAiADIBk2AugCIAMgGDYC5AIgAyAXNgLgAiADIBY2AvwCIAMgFTYC+AIgAyAUNgL0AiADIBM2AvACIAMgEjYCjAMgAyARNgKIAyADIBA2AoQDIAMgDzYCgAMgAyANNgJYIAMgHTYCVCADIBw2AlAgAyAbNgJMIB4gDiABIAIgCBBAIAMoAtACIRcgAygC1AIhGCADKALYAiEZIAMoAtwCIRogAyAHNgL8AiADIAY2AvgCIAMgBTYC9AIgAyAENgLwAiADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgGkHU5qmoBmoiBDYCWCADIBlBu5WoswdqIgU2AlQgAyAYQdLt9PEHayIGNgJQIAMgF0H7prfsBmsiBzYCTCAOIAEgAiAIED8gAyAGNgL8ASADIAc2AvgBIAMgBDYC9AEgAyAFNgLwASADKALgAiEEIAMoAuQCIQUgAygC6AIhBiADKALsAiEHIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAHNgJYIAMgBjYCVCADIAU2AlAgAyAENgJMIAEgAiAIIANB8AFqED8gAygC8AIhCSADKAL0AiEKIAMoAvgCIQsgAygC/AIhDCADIBY2AuwCIAMgFTYC6AIgAyAUNgLkAiADIBM2AuACIAMgEjYC/AIgAyARNgL4AiADIBA2AvQCIAMgDzYC8AIgAyANNgKMAyADIB02AogDIAMgHDYChAMgAyAbNgKAAyADIBo2AlggAyAZNgJUIAMgGDYCUCADIBc2AkwgHiAOIAEgAiAIEEAgAygC0AIhEyADKALUAiEUIAMoAtgCIRUgAygC3AIhFiADIAc2AvwCIAMgBjYC+AIgAyAFNgL0AiADIAQ2AvACIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAWQd+ugOoFayIENgJYIAMgFUG1s5a/BWsiBTYCVCADIBRBkOnR7QNrIgY2AlAgAyATQd3czsQDayIHNgJMIA4gASACIAgQPyADIAY2AowCIAMgBzYCiAIgAyAENgKEAiADIAU2AoACIAMoAuACIQQgAygC5AIhBSADKALoAiEGIAMoAuwCIQcgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIAc2AlggAyAGNgJUIAMgBTYCUCADIAQ2AkwgASACIAggA0GAAmoQPyADKALwAiEJIAMoAvQCIQogAygC+AIhCyADKAL8AiEMIAMgEjYC7AIgAyARNgLoAiADIBA2AuQCIAMgDzYC4AIgAyANNgL8AiADIB02AvgCIAMgHDYC9AIgAyAbNgLwAiADIBo2AowDIAMgGTYCiAMgAyAYNgKEAyADIBc2AoADIAMgFjYCWCADIBU2AlQgAyAUNgJQIAMgEzYCTCAeIA4gASACIAgQQCADKALQAiEPIAMoAtQCIRAgAygC2AIhESADKALcAiESIAMgBzYC/AIgAyAGNgL4AiADIAU2AvQCIAMgBDYC8AIgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIBJB56+08wJrIgQ2AlggAyARQdzzm8sCayIFNgJUIAMgEEH7lMffAGsiBjYCUCADIA9B8MCqgwFqIgc2AkwgDiABIAIgCBA/IAMgBjYCnAIgAyAHNgKYAiADIAQ2ApQCIAMgBTYCkAIgAygC4AIhBCADKALkAiEFIAMoAugCIQYgAygC7AIhByADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgBzYCWCADIAY2AlQgAyAFNgJQIAMgBDYCTCABIAIgCCADQZACahA/IAMoAvACIQkgAygC9AIhCiADKAL4AiELIAMoAvwCIQwgAyANNgLsAiADIB02AugCIAMgHDYC5AIgAyAbNgLgAiADIBo2AvwCIAMgGTYC+AIgAyAYNgL0AiADIBc2AvACIAMgFjYCjAMgAyAVNgKIAyADIBQ2AoQDIAMgEzYCgAMgAyASNgJYIAMgETYCVCADIBA2AlAgAyAPNgJMIB4gDiABIAIgCBBAIAMoAtACIRsgAygC1AIhHCADKALYAiEdIAMoAtwCIQ0gAyAHNgL8AiADIAY2AvgCIAMgBTYC9AIgAyAENgLwAiADIAw2AowDIAMgCzYCiAMgAyAKNgKEAyADIAk2AoADIAMgDUGWgpPNAWoiBDYCWCADIB1BiNjd8QFqIgU2AlQgAyAcQczuoboCaiIGNgJQIAMgG0G1+cKlA2oiBzYCTCAOIAEgAiAIED8gAyAGNgKsAiADIAc2AqgCIAMgBDYCpAIgAyAFNgKgAiADKALgAiEEIAMoAuQCIQUgAygC6AIhBiADKALsAiEHIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAHNgJYIAMgBjYCVCADIAU2AlAgAyAENgJMIAEgAiAIIANBoAJqED8gAygC8AIhCSADKAL0AiEKIAMoAvgCIQsgAygC/AIhDCADIBo2AuwCIAMgGTYC6AIgAyAYNgLkAiADIBc2AuACIAMgFjYC/AIgAyAVNgL4AiADIBQ2AvQCIAMgEzYC8AIgAyASNgKMAyADIBE2AogDIAMgEDYChAMgAyAPNgKAAyADIA02AlggAyAdNgJUIAMgHDYCUCADIBs2AkwgHiAOIAEgAiAIEEAgAygC0AIhFyADKALUAiEYIAMoAtgCIRkgAygC3AIhGiADIAc2AvwCIAMgBjYC+AIgAyAFNgL0AiADIAQ2AvACIAMgDDYCjAMgAyALNgKIAyADIAo2AoQDIAMgCTYCgAMgAyAaQbOZ8MgDaiIENgJYIAMgGUHK1OL2BGoiBTYCVCADIBhBz5Tz3AVqIgY2AlAgAyAXQfPfucEGaiIHNgJMIA4gASACIAgQPyADIAY2ArwCIAMgBzYCuAIgAyAENgK0AiADIAU2ArACIAMoAuACIQQgAygC5AIhBSADKALoAiEGIAMoAuwCIQcgAyAMNgKMAyADIAs2AogDIAMgCjYChAMgAyAJNgKAAyADIAc2AlggAyAGNgJUIAMgBTYCUCADIAQ2AkwgASACIAggA0GwAmoQPyADKALwAiEJIAMoAvQCIQogAygC+AIhCyADKAL8AiEMIAMgFjYC7AIgAyAVNgLoAiADIBQ2AuQCIAMgEzYC4AIgAyASNgL8AiADIBE2AvgCIAMgEDYC9AIgAyAPNgLwAiADIA02AowDIAMgHTYCiAMgAyAcNgKEAyADIBs2AoADIAMgGjYCWCADIBk2AlQgAyAYNgJQIAMgFzYCTCAeIA4gASACIAgQQCADKALQAiETIAMoAtQCIRQgAygC2AIhFSADKALcAiEWIAMgBzYC/AIgAyAGNgL4AiADIAU2AvQCIAMgBDYC8AIgAyAMNgKMAyADIAs2AogD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QQhqIANqIAEgA2otAAA6AAAgA0EBaiEDDAELAAsACwsgACACKQMgNwIAIABBGGogAkE4aikDADcCACAAQRBqIAJBMGopAwA3AgAgAEEIaiACQShqKQMANwIAIAJBQGskAAs8ACAAIAEpAgA3AgAgAEEYaiABQRhqKQIANwIAIABBEGogAUEQaikCADcCACAAQQhqIAFBCGopAgA3AgALIgEBfyMAQSBrIgMkACADIAEgAhBJIAAgAxBCIANBIGokAAvKBgIBfxl+IwBBwAJrIgMkACADIAIpAgAiBSABKQIAIgQQuAEgA0EQaiACKQIIIgYgBBC4ASADQSBqIAIpAhAiByAEELgBIANBMGogAikCGCIIIAQQuAEgA0FAayAFIAEpAggiBBC4ASADQfAAaiAGIAQQuAEgA0GgAWogByAEELgBIANB0AFqIAggBBC4ASADQdAAaiAFIAEpAhAiBBC4ASADQYABaiAGIAQQuAEgA0GwAWogByAEELgBIANB4AFqIAggBBC4ASADQeAAaiAFIAEpAhgiBRC4ASADQZABaiAGIAUQuAEgA0HAAWogByAFELgBIANB8AFqIAggBRC4ASADIAMpAwA3A4ACIAMpAxghBCADKQMgIQYgAykDKCEHIAMpAzAhCCADKQM4IQkgAykD0AEhDCADKQPYASEPIAMpA6ABIQ0gAykDqAEhECADKQNwIQogAykDeCERIAMgAykDECILIAMpAwh8IgUgAykDQHwiDjcDiAIgAykD4AEhEiADKQPoASETIAMpA7ABIRQgAykDuAEhFSADKQOAASEWIAMpA4gBIRcgAyAKIAYgBCAFIAtUrXwiC3wiBHwiBiADKQNIIAUgDlatfHwiBSADKQNQfCIKNwOQAiADKQPwASEOIAMpA/gBIRggAykDwAEhGSADKQPIASEaIAMpA5ABIRsgAykDmAEhHCADIBYgDSAIIAcgBCALVK18Igt8Igd8IgggBSAGVK0gESAEIAZWrXx8fCIEfCIGIAMpA1ggBSAKVq18fCIFIAMpA2B8Ig03A5gCIAMgGyAUIAwgCSAHIAtUrXwiCnwiCSAEIAhUrSAQIAcgCFatfHx8Igd8IgggBSAGVK0gFyAEIAZWrXx8fCIEfCIGIAMpA2ggBSANVq18fCIMNwOgAiADIBkgEiAHIAlUrSAPIAkgClStfHwiCXwiBSAEIAhUrSAVIAcgCFatfHx8Igd8IgggBiAMVq0gHCAEIAZWrXx8fCIENwOoAiADIA4gBSAHVq0gEyAFIAlUrXx8IgZ8IgUgBCAIVK0gGiAHIAhWrXx8fCIENwOwAiADIAQgBVStIBggBSAGVK18fDcDuAIgACADQYACahBNIANBwAJqJAAL6wECAX8IfiMAQdAAayIDJAAgASkCCCEEIAIpAgghBSACKQIYIQkgASkCGCEKIAIpAhAhBiABKQIQIQcgAyACKQIAIgggASkCAHwiCzcDACADIAQgBXwiBCAIIAtWrXwiCDcDCCADIAYgB3wiByAEIAVUrSAEIAhWrXx8IgQ3AxAgAyAJIAp8IgUgBiAHVq0gBCAHVK18fCIGNwMYIAMgBSAJVK0gBSAGVq18NwMgIANCADcDSCADQoGAgIBwNwNAIANCADcDOCADQv////8PNwMwIANCfzcDKCAAIAMgA0EoahBLIANB0ABqJAALswIBCH4gACABKQMIIgMgAikDCCIEfSIFIAEpAwAiBiACKQMAIghUrSIHfSIJIAVUrSAHIAMgBFStfH1CP4ciAyABKQMQIgQgAikDECIFVK19IAMgBCAFfSIDfCIHIANUrXxCP4ciAyABKQMYIgQgAikDGCIFVK19IAMgBCAFfSIDfCIKIANUrXxCP4ciAyABKQMgIgQgAikDICIFVK19IAMgBCAFfSIDfCADVK18IgMgBiAIfXwiBD4CACAAIARCIIg+AgQgACADQv////8PgyIGIAl8IgUgAyAEVq18IgQ+AgggACAEQiCIPgIMIAAgBSAGVK0gBCAFVK18IgUgB3wiBD4CECAAIARCIIg+AhQgACAEIAVUrSADQoGAgIBwgyAKfHwiAz4CGCAAIANCIIg+AhwLoQECAX8IfiMAQdAAayIDJAAgAikCACEEIAIpAgghBSACKQIQIQYgAikCGCEHIAEpAgAhCCABKQIIIQkgASkCECEKIAEpAhghCyADQgA3AyAgAyALNwMYIAMgCjcDECADIAk3AwggAyAINwMAIANCADcDSCADIAc3A0AgAyAGNwM4IAMgBTcDMCADIAQ3AyggACADIANBKGoQSyADQdAAaiQAC9MEAgF/EX4jAEGgAWsiAiQAIAJBMGogASkDACIDQv////8PELgBIAJBQGsgA0KBgICAcBC4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A0EIaikCADcDACACQThqIANBEGopAgA3AwAgAiADKQIANwMoIAJBHGpBrLHAACACQShqEJ8BGiACQRhqIAQoAgAiAzYCACACIAIpAhwiBTcDECABQQhqIAM2AgAgASAFNwIACyABKQIAIQUgAUKAgICAEDcCACACQQhqIgMgAUEIaiIBKAIANgIAIAFBADYCACACIAU3AwBBDEEEEDsiAUUEQEEEQQwQmAEACyABIAIpAwA3AgAgAUEIaiADKAIANgIAIABBiLPAADYCBCAAIAE2AgAgAkFAayQAC8IBAgN/AX4jAEEwayICJAAgASgCAEGAgICAeEYEQCABKAIMIQMgAkEUaiIEQQA2AgAgAkKAgICAEDcCDCACQSBqIAMoAgAiA0EIaikCADcDACACQShqIANBEGopAgA3AwAgAiADKQIANwMYIAJBDGpBrLHAACACQRhqEJ8BGiACQQhqIAQoAgAiAzYCACACIAIpAgwiBTcDACABQQhqIAM2AgAgASAFNwIACyAAQYizwAA2AgQgACABNgIAIAJBMGokAAt7AQF/IwBBIGsiAiQAAn8gACgCAEGAgICAeEcEQCABIAAoAgQgACgCCBCvAQwBCyACQRBqIAAoAgwoAgAiAEEIaikCADcDACACQRhqIABBEGopAgA3AwAgAiAAKQIANwMIIAEoAgAgASgCBCACQQhqEJ8BCyACQSBqJAALRQECfyABKAIEIQIgASgCACEDQQhBBBA7IgFFBEBBBEEIEJgBAAsgASACNgIEIAEgAzYCACAAQZizwAA2AgQgACABNgIACxMAIABBmLPAADYCBCAAIAE2AgALDAAgACABKQIANwMACxEAIAEgACgCACAAKAIEEK8BC5UCAQJ/IwBBIGsiBSQAQci6wABByLrAACgCACIGQQFqNgIAAn9BACAGQQBIDQAaQQFBlL7AAC0AAA0AGkGUvsAAQQE6AABBkL7AAEGQvsAAKAIAQQFqNgIAQQILQf8BcSIGQQJHBEAgBkEBcQRAIAVBCGogACABKAIYEQAACwALAkBBvLrAACgCACIGQQBOBEBBvLrAACAGQQFqNgIAQcC6wAAoAgAEQCAFIAAgASgCFBEAACAFIAQ6AB0gBSADOgAcIAUgAjYCGCAFIAUpAwA3AhBBwLrAACgCACAFQRBqQcS6wAAoAgAoAhQRAAALQby6wABBvLrAACgCAEEBazYCAEGUvsAAQQA6AAAgA0UNAQALAAsAC0IAIAAEQCAAIAEQmAEACyMAQSBrIgAkACAAQQA2AhggAEEBNgIMIABB9LPAADYCCCAAQgQ3AhAgAEEIaiACEJ4BAAsZACAAIAFBuLrAACgCACIAQR8gABsRAAAAC2sBAX8jAEEwayIDJAAgAyABNgIEIAMgADYCACADQQI2AgwgA0G8tMAANgIIIANCAjcCFCADIAOtQoCAgIDAA4Q3AyggAyADQQRqrUKAgICAwAOENwMgIAMgA0EgajYCECADQQhqIAIQngEACxAAIAAgASACQey4wAAQuQEL4AQBBn8CQAJAIAAoAggiB0GAgIDAAXFFDQACQAJAAkACQCAHQYCAgIABcQRAIAAvAQ4iAw0BQQAhAgwCCyACQRBPBEAgASACEKABIQMMBAsgAkUEQEEAIQIMBAsgAkEDcSEGAkAgAkEESQRADAELIAJBDHEhCANAIAMgASAFaiIELAAAQb9/SmogBEEBaiwAAEG/f0pqIARBAmosAABBv39KaiAEQQNqLAAAQb9/SmohAyAIIAVBBGoiBUcNAAsLIAZFDQMgASAFaiEEA0AgAyAELAAAQb9/SmohAyAEQQFqIQQgBkEBayIGDQALDAMLIAEgAmohCEEAIQIgASEEIAMhBQNAIAQiBiAIRg0CAn8gBkEBaiAGLAAAIgRBAE4NABogBkECaiAEQWBJDQAaIAZBA2ogBEFwSQ0AGiAGQQRqCyIEIAZrIAJqIQIgBUEBayIFDQALC0EAIQULIAMgBWshAwsgAyAALwEMIgRPDQAgBCADayEGQQAhA0EAIQUCQAJAAkAgB0EddkEDcUEBaw4CAAECCyAGIQUMAQsgBkH+/wNxQQF2IQULIAdB////AHEhCCAAKAIEIQcgACgCACEAA0AgA0H//wNxIAVB//8DcUkEQEEBIQQgA0EBaiEDIAAgCCAHKAIQEQEARQ0BDAMLC0EBIQQgACABIAIgBygCDBECAA0BQQAhAyAGIAVrQf//A3EhAQNAIANB//8DcSICIAFJIQQgASACTQ0CIANBAWohAyAAIAggBygCEBEBAEUNAAsMAQsgACgCACABIAIgACgCBCgCDBECACEECyAEC0IBAX8jAEEgayICJAAgAkEANgIQIAJBATYCBCACQgQ3AgggAkEuNgIcIAIgADYCGCACIAJBGGo2AgAgAiABEJ4BAAs3AQF/IwBBIGsiASQAIAFBADYCGCABQQE2AgwgAUGQuMAANgIIIAFCBDcCECABQQhqIAAQngEAC/wBAgJ/AX4jAEEQayICJAAgAkEBOwEMIAIgATYCCCACIAA2AgQjAEEQayIBJAAgAkEEaiIAKQIAIQQgASAANgIMIAEgBDcCBCMAQRBrIgAkACABQQRqIgEoAgAiAigCDCEDAkACQAJAAkAgAigCBA4CAAECCyADDQFBASECQQAhAwwCCyADDQAgAigCACICKAIEIQMgAigCACECDAELIABBgICAgHg2AgAgACABNgIMIABBxLPAACABKAIEIAEoAggiAC0ACCAALQAJEJYBAAsgACADNgIEIAAgAjYCACAAQaizwAAgASgCBCABKAIIIgAtAAggAC0ACRCWAQALugQBCH8jAEEQayIDJAAgAyABNgIEIAMgADYCACADQqCAgIAONwIIAn8CQAJAAkAgAigCECIJBEAgAigCFCIADQEMAgsgAigCDCIARQ0BIAIoAggiASAAQQN0aiEEIABBAWtB/////wFxQQFqIQYgAigCACEAA0ACQCAAQQRqKAIAIgVFDQAgAygCACAAKAIAIAUgAygCBCgCDBECAEUNAEEBDAULQQEgASgCACADIAFBBGooAgARAQANBBogAEEIaiEAIAQgAUEIaiIBRw0ACwwCCyAAQRhsIQogAEEBa0H/////AXFBAWohBiACKAIIIQQgAigCACEAA0ACQCAAQQRqKAIAIgFFDQAgAygCACAAKAIAIAEgAygCBCgCDBECAEUNAEEBDAQLQQAhB0EAIQgCQAJAAkAgBSAJaiIBQQhqLwEAQQFrDgIBAgALIAFBCmovAQAhCAwBCyAEIAFBDGooAgBBA3RqLwEEIQgLAkACQAJAIAEvAQBBAWsOAgECAAsgAUECai8BACEHDAELIAQgAUEEaigCAEEDdGovAQQhBwsgAyAHOwEOIAMgCDsBDCADIAFBFGooAgA2AghBASAEIAFBEGooAgBBA3RqIgEoAgAgAyABKAIEEQEADQMaIABBCGohACAFQRhqIgUgCkcNAAsMAQsLAkAgBiACKAIETw0AIAMoAgAgAigCACAGQQN0aiIAKAIAIAAoAgQgAygCBCgCDBECAEUN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cGkucnMAcnVzdC9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvY3J5cHRvLWJpZ2ludC0wLjUuNS9zcmMvdWludC9lbmNvZGluZy5ycwBydXN0L3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9jaXBoZXItMC40LjQvc3JjL3N0cmVhbV9jb3JlLnJzAHJ1c3QvcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2RpZ2VzdC0wLjEwLjcvc3JjL2NvcmVfYXBpL2N0X3ZhcmlhYmxlLnJzAC9ydXN0Yy8yOTQ4Mzg4M2VlZDY5ZDVmYjRkYjAxOTY0Y2RmMmFmNGQ4NmU5Y2IyL2xpYnJhcnkvY29yZS9zcmMvc2xpY2UvbW9kLnJzAC9ydXN0Yy8yOTQ4Mzg4M2VlZDY5ZDVmYjRkYjAxOTY0Y2RmMmFmNGQ4NmU5Y2IyL2xpYnJhcnkvYWxsb2Mvc3JjL3Jhd192ZWMvbW9kLnJzAC9ydXN0L2RlcHMvZGxtYWxsb2MtMC4yLjkvc3JjL2RsbWFsbG9jLnJzAGxpYnJhcnkvc3RkL3NyYy9hbGxvYy5ycwBydXN0L3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9nZW5lcmljLWFycmF5LTAuMTQuNy9zcmMvbGliLnJzAHJ1c3QvcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2NvbnN0LW9pZC0wLjkuNi9zcmMvbGliLnJzAHJ1c3QvcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2hrZGYtMC4xMi40L3NyYy9saWIucnMAcnVzdC9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvYmxvY2stYnVmZmVyLTAuMTAuNC9zcmMvbGliLnJzAHJ1c3QvcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2Flcy1nY20tMC4xMC4zL3NyYy9saWIucnMAcnVzdC9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvYWVhZC0wLjUuMi9zcmMvbGliLnJzAHJ1c3QvcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL3VuaXZlcnNhbC1oYXNoLTAuNS4xL3NyYy9saWIucnMAcnVzdC9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvaG1hYy0wLjEyLjEvc3JjL2xpYi5ycwBydXN0L3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9wb2x5dmFsLTAuNi4yL3NyYy9iYWNrZW5kL3NvZnQzMi5ycwBydXN0L3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9jdHItMC45LjIvc3JjL2ZsYXZvcnMvY3RyMzIucnMAcnVzdC9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvYWVzLTAuOC40L3NyYy9zb2Z0L2ZpeHNsaWNlMzIucnMAAAAgAAAAgQMQAFMAAAA8AgAACQAAAPz//////////////wMAQZyOwAALKAQAAAD8////373EKWLfnNiQMIR4zQXwrNYuIferIKLlNEiHBB0GMNwAQYSPwAALAQEAQaiPwAALAQEAQbSPwAALEP////////////////7///8AQeiPwAALoQFCAhAAXQAAAHwAAAAkAAAAbAQQAFIAAACiAAAAJwAAAGwEEABSAAAApAAAABgAAABsBBAAUgAAAKQAAAAgAAAAbAQQAFIAAACuAAAAFAAAAGwEEABSAAAArgAAABoAAABsBBAAUgAAAJ0AAAAYAAAAbAQQAFIAAACdAAAAHwAAAGwEEABSAAAAnQAAACUAAABsBBAAUgAAAC0BAAAiAAAAAQBBlJHAAAupAv////////////////7///8AAAAAkwEQAFwAAACaAAAAEQAAAFNsaWNlIG11c3QgYmUgdGhlIHNhbWUgbGVuZ3RoIGFzIHRoZSBhcnJheQAAgQMQAFMAAABcAgAADgAAAAAAEABbAAAApwAAABIAAAAAABAAWwAA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bGVmdDogAAAAZxoQABAAAACwGhAAEAAAAMAaEAAJAAAAjhoQAAkAAAA6IAAAAQAAAAAAAADsGhAAAgAAAAAAAAAMAAAABAAAADMAAAA0AAAANQAAACAgICAgeyAsICB7CiwKfSB9KCgKLDB4MDAwMTAyMDMwNDA1MDYwNzA4MDkxMDExMTIxMzE0MTUxNjE3MTgxOTIwMjEyMjIzMjQyNTI2MjcyODI5MzAzMTMyMzMzNDM1MzYzNzM4Mzk0MDQxNDI0MzQ0NDU0NjQ3NDg0OTUwNTE1MjUzNTQ1NTU2NTc1ODU5NjA2MTYyNjM2NDY1NjY2NzY4Njk3MDcxNzI3Mzc0NzU3Njc3Nzg3OTgwODE4MjgzODQ4NTg2ODc4ODg5OTA5MTkyOTM5NDk1OTY5Nzk4OTlhdHRlbXB0IHRvIGRpdmlkZSBieSB6ZXJv9xsQABkAAAByYW5nZSBzdGFydCBpbmRleCAgb3V0IG9mIHJhbmdlIGZvciBzbGljZSBvZiBsZW5ndGggGBwQABIAAAAqHBAAIgAAAHJhbmdlIGVuZCBpbmRleCBcHBAAEAAAACocEAAiAAAAc2xpY2UgaW5kZXggc3RhcnRzIGF0ICBidXQgZW5kcyBhdCAAfBwQABYAAACSHBAADQAAAGNvcHlfZnJvbV9zbGljZTogc291cmNlIHNsaWNlIGxlbmd0aCAoKSBkb2VzIG5vdCBtYXRjaCBkZXN0aW5hdGlvbiBzbGljZSBsZW5ndGggKAAAALAcEAAmAAAA1hwQACsAAAD8GRAAAQAAAFwaEABeGhAAYBoQAAIAAAACAAAABw==";
const IW = 44;
const Y = 32;
const RW = 1;
const VW = 65;
const WW = Y + RW + VW;
function getRandomValues(buf) {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) {
    return globalThis.crypto.getRandomValues(buf);
  }
  try {
    const nodeCrypto = require("crypto");
    return nodeCrypto.randomFillSync(buf);
  } catch (e) {
    for (let i = 0; i < buf.length; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
    return buf;
  }
}
let cachedInstance = null;
function getWasmInstance() {
  return __async(this, null, function* () {
    if (cachedInstance)
      return cachedInstance;
    if (typeof WebAssembly === "undefined" || typeof WebAssembly.instantiate !== "function") {
      throw new Error("WebAssembly.instantiate is not supported in this runtime");
    }
    const wasmBytes = base64ToBytes(CRUSH_WASM_RAW_B64);
    const result = yield WebAssembly.instantiate(wasmBytes, {});
    cachedInstance = result.instance || result;
    return cachedInstance;
  });
}
function sealWithWasm(path, payloadJson) {
  return __async(this, null, function* () {
    const instance = yield getWasmInstance();
    const { alloc, dealloc, seal_request, memory } = instance.exports;
    const fullJson = JSON.stringify({
      path,
      payload: payloadJson ? typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson : null
    });
    let n;
    if (typeof TextEncoder !== "undefined") {
      n = new TextEncoder().encode(fullJson);
    } else if (typeof Buffer !== "undefined") {
      n = Buffer.from(fullJson, "utf8");
    } else {
      n = new Uint8Array(fullJson.length);
      for (let i = 0; i < fullJson.length; i++)
        n[i] = fullJson.charCodeAt(i);
    }
    const m = new Uint8Array(IW);
    getRandomValues(m);
    const p = n.length + 512;
    const s = alloc(n.length);
    const a = alloc(m.length);
    const r = alloc(p);
    try {
      const mem = new Uint8Array(memory.buffer);
      mem.set(n, s);
      mem.set(m, a);
      const t = seal_request(s, n.length, a, m.length, r, p);
      if (t <= WW || t > p)
        throw new Error("WASM seal failed with code: " + t);
      const out = new Uint8Array(memory.buffer, r, t);
      const responseKey = out.slice(0, Y);
      const keyId = out[Y];
      const ephemeralPublic = out.slice(Y + RW, WW);
      const body = out.slice(WW, t);
      return { responseKey, keyId, ephemeralPublic, body, aad: null };
    } finally {
      try {
        dealloc(s, n.length);
      } catch (e) {
      }
      try {
        dealloc(a, m.length);
      } catch (e) {
      }
      try {
        dealloc(r, p);
      } catch (e) {
      }
    }
  });
}
function sealWithApi(serverInfo, diagnostics = null) {
  return __async(this, null, function* () {
    const isTv = !!serverInfo.isTv;
    const tmdbId = serverInfo.tmdbId;
    const server = serverInfo.server;
    const season = serverInfo.season || 1;
    const episode = serverInfo.episode || 1;
    const title = serverInfo.title || "";
    const year = serverInfo.year || "";
    const imdbId = serverInfo.imdbId || "";
    let sheguUrl = `https://api.shegu.xyz/?type=${isTv ? "series" : "movie"}&tmdb=${tmdbId}&server=${server}`;
    if (isTv) {
      sheguUrl += `&season=${season}&episode=${episode}`;
    }
    if (title)
      sheguUrl += `&title=${encodeURIComponent(title)}`;
    if (year)
      sheguUrl += `&year=${year}`;
    if (imdbId)
      sheguUrl += `&imdb=${imdbId}`;
    const encUrl = `${ENC_DEC_API}?url=${encodeURIComponent(sheguUrl)}`;
    const res = yield tracedFetch(diagnostics, encUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (!res.ok)
      throw new Error(`enc-dec API HTTP ${res.status}`);
    const json = yield res.json();
    if (json.status !== 200 || !json.result) {
      throw new Error(json.error || "Failed to seal via enc-dec API");
    }
    const body = base64ToBytes(json.result.data);
    const responseKey = base64ToBytes(json.result.state.responseKey);
    const aad = base64ToBytes(json.result.state.aad);
    return {
      body,
      responseKey,
      aad,
      keyId: null,
      ephemeralPublic: null
    };
  });
}
function seal(path, payloadJson, serverInfo, diagnostics = null) {
  return __async(this, null, function* () {
    const isMockRuntime = typeof __native_fetch !== "undefined" || typeof HermesInternal !== "undefined" || typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function" && (WebAssembly.instantiate.toString().includes("placeholder") || WebAssembly.instantiate.name === "");
    if (!isMockRuntime && typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function") {
      try {
        return yield sealWithWasm(path, payloadJson);
      } catch (wasmErr) {
        if (diagnostics)
          diagnostics.log("seal.wasm.failed", { errorType: wasmErr.name, fallback: "API" });
        else
          console.warn("[Cinejoy] Local WASM seal failed, attempting API fallback:", wasmErr.message);
      }
    }
    if (serverInfo) {
      return yield sealWithApi(serverInfo, diagnostics);
    }
    throw new Error("Cannot seal request: WebAssembly is unavailable and no serverInfo was provided");
  });
}

// src/cinejoy-tv/index.js
function parseHlsVariants(masterText, baseUrl) {
  const lines = masterText.split("\n");
  const variants = [];
  let currentInf = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      currentInf = {
        width: resMatch ? parseInt(resMatch[1], 10) : 0,
        height: resMatch ? parseInt(resMatch[2], 10) : 0,
        bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : 0
      };
    } else if (line && !line.startsWith("#") && currentInf) {
      let streamUrl = line;
      if (!streamUrl.startsWith("http")) {
        streamUrl = new URL(streamUrl, baseUrl).toString();
      }
      variants.push(__spreadProps(__spreadValues({}, currentInf), {
        url: streamUrl
      }));
      currentInf = null;
    }
  }
  return variants;
}
function getQualityBadge(height) {
  const h = Number(height) || 0;
  if (h >= 2160)
    return "4K";
  if (h >= 1440)
    return "1440p";
  if (h >= 1080)
    return "1080p";
  if (h >= 720)
    return "720p";
  if (h >= 480)
    return "480p";
  if (h >= 360)
    return "360p";
  return h ? `${h}p` : "Auto";
}
function normalizeQuality(qKey) {
  const s = String(qKey || "").toLowerCase();
  if (s.includes("2160") || s.includes("4k"))
    return "4K";
  if (s.includes("1440") || s.includes("2k"))
    return "1440p";
  if (s.includes("1080") || s.includes("fhd"))
    return "1080p";
  if (s.includes("720") || s.includes("hd"))
    return "720p";
  if (s.includes("480") || s.includes("sd"))
    return "480p";
  if (s.includes("360"))
    return "360p";
  return getQualityBadge(parseInt(s, 10));
}
function qualityLabel(q) {
  const badge = normalizeQuality(q);
  if (badge === "4K")
    return "4K (2160p)";
  if (!badge || badge === "Auto")
    return "Auto (Adaptive)";
  return badge;
}
function streamLabel(serverDisplayName, label) {
  return `Cinejoy-TV - ${serverDisplayName} - ${label}`;
}
function relabelResolverStreams(list, serverDisplayName, customResolver = "") {
  return list.map((st) => {
    if (!st || typeof st !== "object")
      return st;
    const match = String(st.title || "").match(/^(?:Cinejoy|Cinejoy-TV)\s*-\s*[^-]+?\s*-\s*(.+)$/i);
    const label = match ? match[1].trim() : qualityLabel(st.quality);
    let url = st.url || "";
    if (url.startsWith("http://") && customResolver && customResolver.startsWith("https://")) {
      url = url.replace(/^http:\/\//i, "https://");
    }
    return __spreadProps(__spreadValues({}, st), {
      name: streamLabel(serverDisplayName, label),
      title: streamLabel(serverDisplayName, label),
      url
    });
  });
}
function getStreamsForServers(tmdbId, mediaType = "movie", season = 1, episode = 1, allowedServers = null, diagnostics = null) {
  return __async(this, null, function* () {
    let id = tmdbId;
    let type = mediaType;
    let s = season;
    let ep = episode;
    if (typeof tmdbId === "object" && tmdbId !== null) {
      id = tmdbId.tmdbId || tmdbId.id || tmdbId.tmdb;
      type = tmdbId.mediaType || tmdbId.type || type || "movie";
      s = tmdbId.season || season || 1;
      ep = tmdbId.episode || episode || 1;
    }
    const cleanTmdb = String(id || "").trim();
    if (!cleanTmdb || cleanTmdb === "[object Object]") {
      if (diagnostics)
        diagnostics.log("lookup.rejected", { reason: "invalid TMDB ID" });
      else
        console.warn("[Cinejoy-TV] Invalid TMDB ID provided:", tmdbId);
      return [];
    }
    const cleanMediaType = String(type || "movie").toLowerCase().trim();
    const isTv = cleanMediaType === "tv" || cleanMediaType === "series";
    const cleanSeason = Number(s) || 1;
    const cleanEpisode = Number(ep) || 1;
    if (diagnostics)
      diagnostics.log("lookup.start", { tmdbId: cleanTmdb, mediaType: isTv ? "tv" : "movie", season: cleanSeason, episode: cleanEpisode, allowedServers });
    else
      console.log(`[Cinejoy-TV] Fetching streams for TMDB: ${cleanTmdb}, Type: ${isTv ? "tv" : "movie"}, S: ${cleanSeason}, E: ${cleanEpisode}`);
    const streams = [];
    const settings = globalThis.SCRAPER_SETTINGS || {};
    let customResolver = (settings.resolverUrl || HARDCODED_WORKER_URL).trim().replace(/\/+$/, "");
    if (customResolver && !customResolver.startsWith("http://") && !customResolver.startsWith("https://")) {
      customResolver = "https://" + customResolver;
    }
    if (diagnostics)
      diagnostics.log("resolver.selected", { resolver: customResolver });
    else
      console.log(`[Cinejoy-TV] Using stream resolver: ${customResolver}`);
    let maxPerLang = 3;
    if (settings.maxSubtitlesPerLanguage !== void 0) {
      const parsed = Number(settings.maxSubtitlesPerLanguage);
      if (!isNaN(parsed) && parsed >= 0)
        maxPerLang = parsed;
    }
    try {
      const domainPromise = resolveDomain(false, diagnostics);
      const tmdbInfoPromise = getTmdbDetails(cleanTmdb, isTv ? "tv" : "movie", diagnostics);
      const [domain, tmdbInfo] = yield Promise.all([domainPromise, tmdbInfoPromise]);
      const serversPromise = getActiveServers(domain, diagnostics);
      const subsPromise = fetchAllSubtitles(cleanTmdb, isTv ? "tv" : "movie", cleanSeason, cleanEpisode, tmdbInfo == null ? void 0 : tmdbInfo.imdbId, maxPerLang, diagnostics);
      const [{ host: apiHost, servers: discoveredServers }, combinedSubtitles] = yield Promise.all([
        serversPromise,
        subsPromise
      ]);
      const allowed = Array.isArray(allowedServers) && allowedServers.length > 0
        ? new Set(allowedServers.map((name) => String(name).toLowerCase()))
        : null;
      const servers = allowed
        ? discoveredServers.filter((name) => allowed.has(String(name).toLowerCase()))
        : discoveredServers;
      if (diagnostics) {
        diagnostics.log("sources.discovered", { domain, apiHost, servers, subtitles: combinedSubtitles.length });
      } else {
        console.log(`[Cinejoy-TV] Active domain: ${domain}, API Host: ${apiHost}, Servers: ${servers.join(", ")}`);
        console.log(`[Cinejoy-TV] Resolved ${combinedSubtitles.length} subtitle track(s)`);
      }
      const playbackOrigin = new URL(domain).origin;
      const playbackReferer = `${playbackOrigin}/`;
      const streamHeaders = {
        "Origin": playbackOrigin,
        "Referer": playbackReferer,
        "User-Agent": HEADERS["User-Agent"]
      };
      const serverPromises = servers.map((server) => __async(this, null, function* () {
        let _a, _b;
        try {
          const serverDisplayName = server.charAt(0).toUpperCase() + server.slice(1);
          if (diagnostics)
            diagnostics.log("server.start", { server });
          if (customResolver) {
            try {
              const targetUrl = `${customResolver}/api/stream?tmdb=${cleanTmdb}&type=${isTv ? "series" : "movie"}&server=${encodeURIComponent(server)}&season=${cleanSeason}&episode=${cleanEpisode}&imdb=${encodeURIComponent((tmdbInfo == null ? void 0 : tmdbInfo.imdbId) || "")}&title=${encodeURIComponent((tmdbInfo == null ? void 0 : tmdbInfo.title) || "")}&year=${encodeURIComponent((tmdbInfo == null ? void 0 : tmdbInfo.year) || "")}`;
              const rRes = yield tracedFetch(diagnostics, targetUrl, {
                headers: { "User-Agent": HEADERS["User-Agent"] }
              });
              if (diagnostics)
                diagnostics.log("resolver.response", { server, status: rRes.status, url: rRes.url || targetUrl });
              if (rRes.ok) {
                const rJson = yield rRes.json();
                if (Array.isArray(rJson == null ? void 0 : rJson.streams) && rJson.streams.length > 0) {
                  const list = relabelResolverStreams(rJson.streams, serverDisplayName, customResolver);
                  for (const st of list) {
                    const sSubs = [...combinedSubtitles];
                    const existing = new Set(sSubs.map((s2) => s2.url));
                    for (const sub of st.subtitles || []) {
                      if (sub && sub.url && !existing.has(sub.url)) {
                        existing.add(sub.url);
                        sSubs.unshift(sub);
                      }
                    }
                    st.subtitles = sSubs;
                  }
                  if (diagnostics)
                    diagnostics.log("server.complete", { server, streams: list.length, source: "resolver" });
                  return list;
                }
                const rRawStreams = ((_a = rJson == null ? void 0 : rJson.data) == null ? void 0 : _a.stream) || [];
                const parsedFromResolver = [];
                for (const item of rRawStreams) {
                  const sSubs = [...combinedSubtitles];
                  const sSubsSeen = new Set(sSubs.map((s2) => s2.url));
                  for (const c of item.captions || []) {
                    if (c.url && !sSubsSeen.has(c.url)) {
                      sSubsSeen.add(c.url);
                      sSubs.unshift({
                        url: c.url,
                        language: (c.language || c.id || "en").toLowerCase(),
                        name: c.language || c.id || "Subtitle"
                      });
                    }
                  }
                  if (item.type === "hls" && item.playlist) {
                    try {
                      const m3u8Res = yield tracedFetch(diagnostics, item.playlist, { headers: streamHeaders });
                      if (m3u8Res.ok) {
                        const m3u8Text = yield m3u8Res.text();
                        const variants = parseHlsVariants(m3u8Text, item.playlist);
                        for (const v of variants) {
                          const badge = getQualityBadge(v.height);
                          const label = badge === "4K" ? "4K (2160p)" : `${v.height}p`;
                          parsedFromResolver.push({
                            name: streamLabel(serverDisplayName, label),
                            title: streamLabel(serverDisplayName, label),
                            url: `${customResolver}/api/playlist?url=${encodeURIComponent(item.playlist)}&height=${v.height}`,
                            quality: badge,
                            headers: streamHeaders,
                            subtitles: [...sSubs]
                          });
                        }
                      }
                    } catch (e) {
                    }
                    parsedFromResolver.push({
                      name: streamLabel(serverDisplayName, "Auto (Adaptive)"),
                      title: streamLabel(serverDisplayName, "Auto (Adaptive)"),
                      url: item.playlist,
                      quality: "Auto",
                      headers: streamHeaders,
                      subtitles: [...sSubs]
                    });
                  }
                }
                if (parsedFromResolver.length > 0) {
                  if (diagnostics)
                    diagnostics.log("server.complete", { server, streams: parsedFromResolver.length, source: "resolver" });
                  return parsedFromResolver;
                }
              } else {
                if (diagnostics)
                  diagnostics.log("resolver.rejected", { server, status: rRes.status });
                else
                  console.warn(`[Cinejoy-TV] Custom resolver returned HTTP ${rRes.status} for server ${server}`);
              }
            } catch (resolverErr) {
              if (diagnostics)
                diagnostics.log("resolver.failed", { server, errorType: resolverErr.name });
              else
                console.warn(`[Cinejoy-TV] Custom resolver error for ${server}:`, resolverErr.message);
            }
          }
          const path = `/${server.toLowerCase()}/${isTv ? "series" : "movie"}`;
          const payloadObj = isTv ? __spreadValues(__spreadValues(__spreadValues({
            tmdb: cleanTmdb,
            season: String(cleanSeason),
            episode: String(cleanEpisode)
          }, (tmdbInfo == null ? void 0 : tmdbInfo.imdbId) ? { imdb: tmdbInfo.imdbId } : {}), (tmdbInfo == null ? void 0 : tmdbInfo.title) ? { title: tmdbInfo.title } : {}), (tmdbInfo == null ? void 0 : tmdbInfo.year) ? { year: String(tmdbInfo.year) } : {}) : __spreadValues(__spreadValues(__spreadValues({
            tmdb: cleanTmdb
          }, (tmdbInfo == null ? void 0 : tmdbInfo.imdbId) ? { imdb: tmdbInfo.imdbId } : {}), (tmdbInfo == null ? void 0 : tmdbInfo.title) ? { title: tmdbInfo.title } : {}), (tmdbInfo == null ? void 0 : tmdbInfo.year) ? { year: String(tmdbInfo.year) } : {});
          const serverInfo = {
            server,
            isTv,
            tmdbId: cleanTmdb,
            season: cleanSeason,
            episode: cleanEpisode,
            title: (tmdbInfo == null ? void 0 : tmdbInfo.title) || "",
            year: (tmdbInfo == null ? void 0 : tmdbInfo.year) || "",
            imdbId: (tmdbInfo == null ? void 0 : tmdbInfo.imdbId) || ""
          };
          const sealed = yield seal(path, payloadObj, serverInfo, diagnostics);
          const gatewayUrl = `${apiHost}/g`;
          const res = yield tracedFetch(diagnostics, gatewayUrl, {
            method: "POST",
            body: sealed.body,
            headers: {
              "Content-Type": "application/octet-stream",
              "Origin": playbackOrigin,
              "Referer": playbackReferer,
              "User-Agent": HEADERS["User-Agent"]
            }
          });
          if (diagnostics)
            diagnostics.log("gateway.response", { server, status: res.status, url: res.url || gatewayUrl });
          if (!res.ok) {
            if (diagnostics)
              diagnostics.log("gateway.rejected", { server, status: res.status });
            else
              console.warn(`[Cinejoy-TV] [${server}] HTTP ${res.status}: Gateway rejected request`);
            return null;
          }
          let encBytes;
          if (typeof res.arrayBuffer === "function") {
            const arrayBuf = yield res.arrayBuffer();
            encBytes = new Uint8Array(arrayBuf);
          } else {
            const text = yield res.text();
            encBytes = new Uint8Array(text.length);
            for (let i = 0; i < text.length; i++) {
              encBytes[i] = text.charCodeAt(i) & 255;
            }
          }
          const decryptedStr = yield decrypt(encBytes, sealed);
          const json = JSON.parse(decryptedStr);
          const streamArr = ((_b = json.data) == null ? void 0 : _b.stream) || [];
          const serverStreams = [];
          for (const item of streamArr) {
            const type2 = item.type;
            const playlist = item.playlist;
            const captions = item.captions || [];
            const serverSubs = [...combinedSubtitles];
            const serverSubsSeen = new Set(serverSubs.map((s2) => s2.url));
            for (const c of captions) {
              if (c.url && !serverSubsSeen.has(c.url)) {
                serverSubsSeen.add(c.url);
                serverSubs.unshift({
                  url: c.url,
                  language: (c.language || c.id || "en").toLowerCase(),
                  name: c.language || c.id || "Subtitle"
                });
              }
            }
            if (type2 === "hls" && playlist) {
              try {
                const m3u8Res = yield tracedFetch(diagnostics, playlist, { headers: streamHeaders });
                if (m3u8Res.ok) {
                  const m3u8Text = yield m3u8Res.text();
                  const variants = parseHlsVariants(m3u8Text, playlist);
                  for (const v of variants) {
                    const badge = getQualityBadge(v.height);
                    const label = badge === "4K" ? "4K (2160p)" : `${v.height}p`;
                    serverStreams.push({
                      name: streamLabel(serverDisplayName, label),
                      title: streamLabel(serverDisplayName, label),
                      url: customResolver ? `${customResolver}/api/playlist?url=${encodeURIComponent(playlist)}&height=${v.height}` : v.url,
                      quality: badge,
                      headers: streamHeaders,
                      subtitles: [...serverSubs]
                    });
                  }
                }
              } catch (mErr) {
                if (diagnostics)
                  diagnostics.log("playlist.failed", { server, url: playlist, errorType: mErr.name });
                else
                  console.warn(`[Cinejoy-TV] Failed to parse HLS variants for ${server}:`, mErr.message);
              }
              serverStreams.push({
                name: streamLabel(serverDisplayName, "Auto (Adaptive)"),
                title: streamLabel(serverDisplayName, "Auto (Adaptive)"),
                url: playlist,
                quality: "Auto",
                headers: streamHeaders,
                subtitles: [...serverSubs]
              });
            } else if (type2 === "file" && item.qualities) {
              const qualities = item.qualities;
              for (const qKey of Object.keys(qualities)) {
                const qObj = qualities[qKey];
                const fileUrl = qObj == null ? void 0 : qObj.url;
                if (fileUrl && fileUrl.startsWith("http")) {
                  const badge = normalizeQuality(qKey);
                  const label = badge === "4K" ? "4K (2160p)" : qKey;
                  serverStreams.push({
                    name: streamLabel(serverDisplayName, label),
                    title: streamLabel(serverDisplayName, label),
                    url: fileUrl,
                    quality: badge,
                    headers: streamHeaders,
                    subtitles: [...serverSubs]
                  });
                }
              }
            }
          }
          if (diagnostics)
            diagnostics.log("server.complete", { server, streams: serverStreams.length });
          return serverStreams;
        } catch (serverErr) {
          if (diagnostics)
            diagnostics.log("server.failed", { server, errorType: serverErr.name });
          else
            console.warn(`[Cinejoy-TV] Error querying server ${server}:`, serverErr.message);
          return null;
        }
      }));
      const serverResults = yield Promise.all(serverPromises);
      for (const resList of serverResults) {
        if (Array.isArray(resList)) {
          for (const stream of resList) {
            if (!stream.subtitles || stream.subtitles.length === 0) {
              stream.subtitles = [...combinedSubtitles];
            }
            streams.push(stream);
          }
        }
      }
      if (diagnostics)
        diagnostics.log("lookup.complete", { streams: streams.length });
      else
        console.log(`[Cinejoy-TV] Successfully retrieved ${streams.length} stream(s)`);
    } catch (error) {
      if (diagnostics)
        diagnostics.log("lookup.failed", { errorType: error.name, code: error.code });
      else
        console.error(`[Cinejoy-TV] Error: ${error.message}`);
    }
    return streams;
  });
}
/*! Bundled license information:

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)
*/
