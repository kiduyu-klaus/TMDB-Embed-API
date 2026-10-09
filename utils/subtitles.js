const MEDIA3_MIME_TYPES = {
  vtt: 'text/vtt',
  webvtt: 'text/vtt',
  srt: 'application/x-subrip',
  subrip: 'application/x-subrip',
  ass: 'text/x-ssa',
  ssa: 'text/x-ssa',
  ttml: 'application/ttml+xml',
  dfxp: 'application/ttml+xml',
  xml: 'application/ttml+xml',
  sub: 'application/vobsub',
  idx: 'application/vobsub',
  sup: 'application/pgs',
  tx3g: 'application/x-quicktime-tx3g'
};

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Infer subtitle MIME type conforming to Android Media3 / ExoPlayer specifications.
 * Checks existing mimeType, format/type hints, URL path extensions (including query parameters),
 * and falls back safely to 'text/vtt'.
 */
function inferSubtitleMimeType(sub) {
  if (!sub) return MEDIA3_MIME_TYPES.vtt;

  // 1. Explicit mimeType or contentType
  const explicitMime = String(sub.mimeType || sub.contentType || '').trim().toLowerCase();
  if (explicitMime.startsWith('text/') || explicitMime.startsWith('application/')) {
    if (explicitMime.includes('vtt')) return MEDIA3_MIME_TYPES.vtt;
    if (explicitMime.includes('subrip') || explicitMime.includes('srt')) return MEDIA3_MIME_TYPES.srt;
    if (explicitMime.includes('ssa') || explicitMime.includes('ass')) return MEDIA3_MIME_TYPES.ass;
    if (explicitMime.includes('ttml') || explicitMime.includes('dfxp')) return MEDIA3_MIME_TYPES.ttml;
    if (explicitMime.includes('vobsub')) return MEDIA3_MIME_TYPES.sub;
    if (explicitMime.includes('pgs')) return MEDIA3_MIME_TYPES.sup;
    return explicitMime;
  }

  // 2. Format or type hint (e.g. format: 'vtt', type: 'srt')
  const formatHint = String(sub.format || sub.type || sub.ext || '').trim().toLowerCase();
  if (MEDIA3_MIME_TYPES[formatHint]) {
    return MEDIA3_MIME_TYPES[formatHint];
  }

  // 3. Extract URL pathname and check file extension
  const rawUrl = typeof sub === 'string' ? sub : (sub.url || sub.file || sub.src || '');
  let pathname = '';
  try {
    pathname = new URL(rawUrl).pathname.toLowerCase();
  } catch {
    pathname = String(rawUrl).split('?')[0].toLowerCase();
  }

  const match = pathname.match(/\.([a-z0-9]+)$/i);
  if (match) {
    const ext = match[1].toLowerCase();
    if (MEDIA3_MIME_TYPES[ext]) {
      return MEDIA3_MIME_TYPES[ext];
    }
  }

  // 4. Check query parameters or URL substring hints (e.g. .srt?Policy=..., format=vtt)
  const fullUrl = String(rawUrl).toLowerCase();
  if (/\.vtt(?=[?#&]|$)/i.test(fullUrl) || /[\?&](?:format|ext|type)=vtt\b/i.test(fullUrl)) return MEDIA3_MIME_TYPES.vtt;
  if (/\.srt(?=[?#&]|$)/i.test(fullUrl) || /[\?&](?:format|ext|type)=srt\b/i.test(fullUrl)) return MEDIA3_MIME_TYPES.srt;
  if (/\.(?:ass|ssa)(?=[?#&]|$)/i.test(fullUrl)) return MEDIA3_MIME_TYPES.ass;
  if (/\.(?:ttml|dfxp)(?=[?#&]|$)/i.test(fullUrl)) return MEDIA3_MIME_TYPES.ttml;
  if (/\.sup(?=[?#&]|$)/i.test(fullUrl)) return MEDIA3_MIME_TYPES.sup;
  if (/\.sub(?=[?#&]|$)/i.test(fullUrl)) return MEDIA3_MIME_TYPES.sub;

  // 5. Check name/label hints if URL has no extension
  const textHint = String(sub.name || sub.label || sub.title || '').toLowerCase();
  if (/\bsrt\b/i.test(textHint)) return MEDIA3_MIME_TYPES.srt;
  if (/\bvtt\b/i.test(textHint)) return MEDIA3_MIME_TYPES.vtt;
  if (/\b(?:ass|ssa)\b/i.test(textHint)) return MEDIA3_MIME_TYPES.ass;

  // 6. Safe default for web / streaming subtitles
  return MEDIA3_MIME_TYPES.vtt;
}

/**
 * Normalizes a single subtitle entry to conform to the Media3 SubtitleItem contract:
 * {
 *   url: String,
 *   mimeType: String,
 *   language: String?,
 *   label: String?,
 *   headers: Map<String, String>
 * }
 */
function normalizeSubtitle(sub, defaultHeaders = {}) {
  if (!sub) return null;
  const rawUrl = typeof sub === 'string' ? sub.trim() : String(sub.url || sub.file || sub.src || '').trim();
  if (!isHttpUrl(rawUrl)) return null;

  const mimeType = inferSubtitleMimeType(sub);
  const language = typeof sub === 'string'
    ? null
    : (sub.language || sub.lang || sub.srclang || null);
  const label = typeof sub === 'string'
    ? null
    : (sub.label || sub.name || sub.title || sub.language || sub.lang || 'Subtitle');

  let headers = {};
  if (typeof sub === 'object' && sub !== null && sub.headers && typeof sub.headers === 'object') {
    headers = { ...sub.headers };
  } else if (defaultHeaders && typeof defaultHeaders === 'object') {
    headers = { ...defaultHeaders };
  }

  const base = typeof sub === 'object' && sub !== null ? sub : {};

  return {
    ...base,
    url: rawUrl,
    mimeType,
    language: language ? String(language).trim() : null,
    label: label ? String(label).trim() : null,
    headers
  };
}

/**
 * Normalizes an array of subtitle items, filtering duplicates and ensuring valid Media3 properties.
 */
function normalizeSubtitles(subtitles, defaultHeaders = {}) {
  if (!Array.isArray(subtitles)) return [];
  const seen = new Set();
  const output = [];

  for (const item of subtitles) {
    const normalized = normalizeSubtitle(item, defaultHeaders);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    output.push(normalized);
  }

  return output;
}

module.exports = {
  MEDIA3_MIME_TYPES,
  inferSubtitleMimeType,
  normalizeSubtitle,
  normalizeSubtitles,
  isHttpUrl
};
