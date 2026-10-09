// Normalize provider output without fetching URLs or changing upstream headers.
const MIME_TYPES = {
  hls: 'application/vnd.apple.mpegurl', dash: 'application/dash+xml',
  mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm',
  avi: 'video/x-msvideo', ts: 'video/mp2t',
  vtt: 'text/vtt', srt: 'application/x-subrip', ass: 'text/x-ssa',
};
const ALIASES = { m3u8: 'hls', mpegurl: 'hls', mpd: 'dash', matroska: 'mkv', subrip: 'srt', webvtt: 'vtt' };
const PROVIDER_FORMATS = { vixsrc: 'hls', vaplayer: 'hls', streamflix: 'mp4' };
const LANGUAGE_CODES = {
  english: 'en', arabic: 'ar', bengali: 'bn', filipino: 'fil', hindi: 'hi',
  french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', russian: 'ru',
  japanese: 'ja', korean: 'ko', chinese: 'zh', tamil: 'ta', telugu: 'te',
};

function knownFormat(value) {
  if (typeof value !== 'string') return null;
  const text = value.toLowerCase().split(';')[0].trim();
  return ALIASES[text] || (MIME_TYPES[text] ? text : null)
    || Object.keys(MIME_TYPES).find(key => MIME_TYPES[key] === text)
    || (text === 'application/x-mpegurl' ? 'hls' : null);
}

function urlFormat(value, depth = 0) {
  if (typeof value !== 'string' || depth > 2) return null;
  try {
    const url = new URL(value);
    const extension = url.pathname.match(/\.([a-z0-9]+)$/i);
    const format = extension && knownFormat(extension[1]);
    if (format) return format;
    for (const key of ['url', 'u', 'file', 'src']) {
      const nested = url.searchParams.get(key);
      const nestedFormat = nested && urlFormat(nested, depth + 1);
      if (nestedFormat) return nestedFormat;
    }
  } catch { /* Opaque URLs need provider metadata. */ }
  return null;
}

function normalizeSubtitles(subtitles, headers, provider) {
  if (!Array.isArray(subtitles)) return [];
  return subtitles.filter(s => s && typeof s.url === 'string' && s.url).map((s, index) => {
    const hint = String(s.language || s.lang || s.label || '').trim();
    const language = LANGUAGE_CODES[hint.toLowerCase()]
      || (/^[a-z]{2,3}(?:-[a-z0-9]+)*$/i.test(hint) ? hint.toLowerCase() : 'und');
    const format = knownFormat(s.mimeType) || knownFormat(s.format) || urlFormat(s.url);
    return {
      ...s,
      id: s.id || `${provider}-${index}-${language}`,
      url: s.url,
      lang: s.lang || language,
      label: s.label || s.lang || s.language || 'Unknown',
      mimeType: s.mimeType || MIME_TYPES[format] || 'application/octet-stream',
      language,
      headers: s.headers == null ? { ...headers } : s.headers,
    };
  });
}

function normalizeStreams(streams, providerName = 'unknown') {
  if (!Array.isArray(streams)) return [];
  return streams.filter(s => s && typeof s.url === 'string' && s.url).map(s => {
    const provider = s.provider || providerName;
    const headers = s.headers == null ? {} : s.headers;
    const format = knownFormat(s.format) || knownFormat(s.mimeType) || knownFormat(s.type)
      || urlFormat(s.url) || PROVIDER_FORMATS[providerName.toLowerCase()] || 'unknown';
    return {
      ...s,
      name: s.name || provider,
      title: s.title || s.name || provider,
      url: s.url,
      quality: s.quality == null ? 'Auto' : String(s.quality),
      provider,
      headers,
      format,
      mimeType: s.mimeType || MIME_TYPES[format] || 'application/octet-stream',
      subtitles: normalizeSubtitles(s.subtitles, headers, providerName),
    };
  });
}

module.exports = { normalizeStreams };
