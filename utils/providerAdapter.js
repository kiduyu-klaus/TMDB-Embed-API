const { normalizeSubtitles } = require('./subtitles');
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function findHeader(headers, ...names) {
  const wanted = names.map(name => name.toLowerCase());
  const entry = Object.entries(headers || {}).find(([name]) =>
    wanted.includes(name.toLowerCase())
  );
  return entry && typeof entry[1] === 'string' ? entry[1].trim() : '';
}

function cleanHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([name, value]) =>
      typeof name === 'string' && name.trim() &&
      typeof value === 'string' && value.trim() &&
      !/[\r\n]/.test(name) && !/[\r\n]/.test(value)
    )
  );
}

function normalizeHeaders(rawHeaders, defaults) {
  const source = cleanHeaders(rawHeaders);
  const referer = findHeader(source, 'Referer', 'Referrer') || defaults.referer;
  let origin = findHeader(source, 'Origin') || defaults.origin;
  if (!origin && referer) {
    try { origin = new URL(referer).origin; } catch { /* keep empty */ }
  }

  const normalized = Object.fromEntries(
    Object.entries(source).filter(([name]) =>
      !['user-agent', 'referer', 'referrer', 'origin'].includes(name.toLowerCase())
    )
  );
  normalized['User-Agent'] = findHeader(source, 'User-Agent') || defaults.userAgent || DEFAULT_USER_AGENT;
  if (origin) normalized.Origin = origin;
  if (referer) normalized.Referer = referer;
  return normalized;
}

function inferType(url, value) {
  const type = String(value || '').toLowerCase();
  if (type.includes('hls') || /\.m3u8(?:$|[?#])/i.test(url)) return 'hls';
  if (type.includes('dash') || /\.mpd(?:$|[?#])/i.test(url)) return 'dash';
  return 'direct';
}

function normalizeQuality(value) {
  const quality = String(value || 'Auto').trim();
  return /^\d{3,4}$/.test(quality) ? `${quality}p` : quality || 'Auto';
}


function adaptProvider({ id, label, extractor, headers = {}, timeoutMs = 14_000 }) {
  if (typeof extractor !== 'function') throw new TypeError(`${id} extractor is not a function`);
  const defaults = {
    userAgent: headers.userAgent || DEFAULT_USER_AGENT,
    origin: headers.origin || '',
    referer: headers.referer || ''
  };

  return async function getProviderStreams(
    tmdbId,
    mediaType = 'movie',
    season = null,
    episode = null
  ) {
    const type = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
    if (!/^\d+$/.test(String(tmdbId || ''))) return [];
    if (type === 'tv' &&
        (!Number.isInteger(Number(season)) || Number(season) < 1 ||
         !Number.isInteger(Number(episode)) || Number(episode) < 1)) {
      console.warn(`[${label}] Series request is missing season or episode`);
      return [];
    }

    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`${label} extraction timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    const result = await Promise.race([
      extractor(tmdbId, type, season, episode),
      timeout
    ]).finally(() => clearTimeout(timeoutId));
    const streams = Array.isArray(result) ? result : [];
    const seen = new Set();
    return streams.flatMap(stream => {
      if (!stream || !isHttpUrl(stream.url) || seen.has(stream.url)) return [];
      seen.add(stream.url);
      const streamType = inferType(stream.url, stream.type || stream.format);
      const quality = normalizeQuality(stream.quality);
      const subtitles = normalizeSubtitles(stream.subtitles || stream.captions);
      return [{
        ...stream,
        name: String(stream.name || label),
        title: String(stream.title || `${label} - ${quality}`),
        url: stream.url,
        quality,
        provider: id,
        format: streamType,
        ...(streamType === 'hls' ? { mimeType: 'application/vnd.apple.mpegurl' } : {}),
        ...(streamType === 'dash' ? { mimeType: 'application/dash+xml' } : {}),
        headers: normalizeHeaders(stream.headers, defaults),
        subtitles
      }];
    });
  };
}

module.exports = { adaptProvider };
