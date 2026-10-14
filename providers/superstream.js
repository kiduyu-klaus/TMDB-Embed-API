// Superstream — the "superstream" backend of the vidnest.fun embed (lookmovie2).
//
// Decoded payload is:
//   { streams: [{ quality, url, type, language }], subtitles: [{ lang, url }] }
//
// Every url is a bare *media* playlist on tinyloud.site rather than a master,
// so one stream object is emitted per quality. Its 1080p runs around 3.5 Mbps
// against roughly 1 Mbps for vaplayer's 1080p, which makes it the better
// fallback when Catflix has no entry for a title.
//
// Subtitles are plain .vtt on lookmovie2.to and need no special headers, but
// the server answers with content-type application/octet-stream, so the MIME
// type is declared rather than sniffed.
const { adaptProvider } = require('../utils/providerAdapter');
const { fetchVidnestPayload, REQUEST_HEADERS } = require('../utils/vidnest');

const PROVIDER_ID = 'superstream';
const PROVIDER_LABEL = 'Superstream';
const BACKEND = 'superstream';
const REQUEST_TIMEOUT_MS = 30000;
const STREAM_HEADERS = {
  'Referer': 'https://vidnest.fun/',
  'Origin': 'https://vidnest.fun',
  'User-Agent': REQUEST_HEADERS['User-Agent']
};

// "English" -> "en" so Media3/Android gets an ISO 639-1 code. The language is
// taken from the .vtt filename when the label is not one we know, since
// lookmovie2 names every track <lang>_<hash>.vtt.
const LANGUAGE_MAP = {
  english: 'en', eng: 'en', en: 'en',
  hindi: 'hi', hin: 'hi', hi: 'hi',
  spanish: 'es', spa: 'es', es: 'es', latin: 'es', 'latin america': 'es', latam: 'es',
  french: 'fr', fra: 'fr', fre: 'fr', fr: 'fr',
  german: 'de', deu: 'de', ger: 'de', de: 'de', deutsch: 'de',
  portuguese: 'pt', por: 'pt', pt: 'pt', portugues: 'pt', brazilian: 'pt',
  russian: 'ru', rus: 'ru', ru: 'ru',
  japanese: 'ja', jpn: 'ja', ja: 'ja',
  korean: 'ko', kor: 'ko', ko: 'ko',
  chinese: 'zh', chi: 'zh', zho: 'zh', zh: 'zh', mandarin: 'zh', cantonese: 'zh',
  arabic: 'ar', ara: 'ar', ar: 'ar',
  turkish: 'tr', tur: 'tr', tr: 'tr',
  italian: 'it', ita: 'it', it: 'it',
  dutch: 'nl', dut: 'nl', nld: 'nl', nl: 'nl',
  polish: 'pl', pol: 'pl', pl: 'pl',
  swedish: 'sv', swe: 'sv', sv: 'sv',
  norwegian: 'no', nor: 'no', nb: 'no', nn: 'no',
  danish: 'da', dan: 'da', da: 'da',
  finnish: 'fi', fin: 'fi', fi: 'fi',
  czech: 'cs', ces: 'cs', cze: 'cs', cs: 'cs',
  hungarian: 'hu', hun: 'hu', hu: 'hu',
  romanian: 'ro', ron: 'ro', rum: 'ro', ro: 'ro',
  greek: 'el', gre: 'el', ell: 'el', el: 'el',
  thai: 'th', tha: 'th', th: 'th',
  indonesian: 'id', ind: 'id', id: 'id',
  malay: 'ms', may: 'ms', ms: 'ms',
  vietnamese: 'vi', vie: 'vi', vi: 'vi',
  ukrainian: 'uk', ukr: 'uk', uk: 'uk',
  // Codes that lookmovie2 uses but have no English name in its label field.
  hebrew: 'he', he: 'he',
  persian: 'fa', fas: 'fa', per: 'fa', fa: 'fa', farsi: 'fa',
  bosnian: 'bs', bos: 'bs', bs: 'bs',
  slovak: 'sk', slk: 'sk', slo: 'sk', sk: 'sk',
  urdu: 'ur', ur: 'ur',
  uzbek: 'uz', uzb: 'uz', uz: 'uz',
  tamil: 'ta', tam: 'ta', ta: 'ta',
  croatian: 'hr', hrv: 'hr', hr: 'hr', hrvatski: 'hr',
  azerbaijani: 'az', aze: 'az', az: 'az',
  catalan: 'ca', cat: 'ca', ca: 'ca',
  bulgarian: 'bg', bul: 'bg', bg: 'bg',
  estonian: 'et', est: 'et', et: 'et',
  latvian: 'lv', lav: 'lv', lv: 'lv',
  lithuanian: 'lt', lit: 'lt', lt: 'lt',
  serbian: 'sr', srp: 'sr', sr: 'sr',
  slovenian: 'sl', slv: 'sl', sl: 'sl',
  icelandic: 'is', isl: 'is', is: 'is',
  original: 'und'
};

// lookmovie2 names every track <lang>_<hash>.vtt (e.g. "he_23cc80….vtt"), so
// the code can come from the filename when the label is a bare code or a name
// we do not have in the table. Handles "en", "en-US", "az-ZB" and "he_<hash>".
function languageFromFilename(url) {
  const pathname = String(url || '').split('?')[0];
  const last = pathname.split('/').pop() || '';
  const stem = last.replace(/\.[a-z0-9]+$/i, '');

  // Split off a trailing "_<hash>" so "he_23cc80…" is read as "he".
  const head = stem.split('_')[0].trim().toLowerCase();
  if (!head) return null;

  // Regional forms: "en-us", "az-zb", "pt-br".
  const regional = head.match(/^([a-z]{2,3})[-]([a-z]{2,4})$/);
  if (regional) {
    const key = regional[1];
    if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
    if (/^[a-z]{2,3}$/.test(key)) return key; // unknown but well-formed code
    return null;
  }
  if (LANGUAGE_MAP[head]) return LANGUAGE_MAP[head];
  return /^[a-z]{2,3}$/.test(head) ? head : null;
}

function resolveLanguage(label, url) {
  const normalized = String(label || '').toLowerCase().replace(/[()[\]]/g, ' ');
  if (normalized) {
    const keys = Object.keys(LANGUAGE_MAP).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (new RegExp(`(^|[^a-z])${key}([^a-z]|$)`, 'i').test(normalized)) {
        return LANGUAGE_MAP[key];
      }
    }
  }
  return languageFromFilename(url);
}

// lookmovie2 returns several English tracks for a title (one per audio
// release). They are all kept but de-duplicated by url, since distinct files
// really are distinct subtitle sets.
function normalizeSubtitleList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const subs = [];
  for (const item of raw) {
    if (!item) continue;
    const url = typeof item === 'string'
      ? item.trim()
      : String(item.url || item.file || item.src || '').trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const label = typeof item === 'string' ? '' : String(item.label || item.lang || item.language || '').trim();
    const language = resolveLanguage(label, url);
    subs.push({
      url,
      // Declared rather than sniffed: the host serves .vtt as octet-stream.
      mimeType: /\.srt(?:$|[?#])/i.test(url) ? 'application/x-subrip' : 'text/vtt',
      language,
      label: label || language || 'Subtitle',
      headers: { 'User-Agent': STREAM_HEADERS['User-Agent'] }
    });
  }
  return subs;
}

async function getSuperstreamStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  console.log(`[Superstream] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);
  try {
    const payload = await fetchVidnestPayload(
      BACKEND, mediaType, String(tmdbId), season, episode, REQUEST_TIMEOUT_MS
    );

    const list = Array.isArray(payload?.streams) ? payload.streams : [];
    if (list.length === 0) {
      console.log(`[Superstream] No Superstream entry for TMDB ${tmdbId}`);
      return [];
    }

    const subtitles = normalizeSubtitleList(payload.subtitles);
    const label = mediaType === 'tv' ? `S${season}E${episode}` : '';

    const streams = list
      .filter(item => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url.trim()))
      .filter(item => !item.type || /hls|m3u8/i.test(String(item.type)))
      .map(item => {
        const quality = String(item.quality || '').trim() || 'Auto';
        return {
          name: PROVIDER_LABEL,
          title: `Superstream${label ? ` ${label}` : ''} - ${quality}`,
          url: item.url.trim(),
          quality,
          provider: PROVIDER_ID,
          type: 'hls',
          format: 'hls',
          subtitles,
          headers: { ...STREAM_HEADERS }
        };
      });

    if (streams.length === 0) {
      console.log(`[Superstream] All ${list.length} entries for ${tmdbId} were non-HLS or invalid`);
      return [];
    }

    console.log(`[Superstream] Got ${streams.length} stream(s), ${subtitles.length} subtitle(s) for ${tmdbId}`);
    return streams;
  } catch (err) {
    console.warn(`[Superstream] Failed for ${tmdbId}: ${err.message}`);
    return [];
  }
}

module.exports = {
  getSuperstreamStreams: adaptProvider({
    id: PROVIDER_ID,
    label: PROVIDER_LABEL,
    extractor: getSuperstreamStreams,
    headers: STREAM_HEADERS
  })
};
