const diagnostics = require('../utils/providerTrace').createProviderTrace('PlayIMDb');
const fetch = diagnostics.fetch;
const { getDetails } = require('../utils/tmdb');
const { adaptProvider } = require('../utils/providerAdapter');

const STREAM_API = 'https://streamdata.vaplayer.ru/api.php';
const PLAYER_ORIGIN = 'https://nextgencloudfabric.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function inferAudioLabel(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (name.includes('dual') || (name.includes('hindi') && name.includes('english'))) return 'Dual Audio';
  if (name.includes('multi')) return 'Multilingual';
  if (name.includes('hindi')) return 'Hindi Audio';
  if (name.includes('english')) return 'English Audio';
  return 'Original Audio';
}

function inferStreamType(url) {
  const value = String(url || '').toLowerCase();
  if (value.includes('.m3u8')) return 'hls';
  if (value.includes('.mpd')) return 'dash';
  return 'direct';
}

function subtitleTracks(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  return subtitles.flatMap((subtitle) => {
    const url = subtitle?.url || subtitle?.file || subtitle?.src;
    if (!url) return [];
    return [{
      id: subtitle.code || subtitle.id,
      url,
      lang: subtitle.lang || subtitle.language,
      label: subtitle.label || subtitle.lang || subtitle.language
    }];
  });
}

async function fetchPlayImdbData(tmdbId, type, season, episode) {
  const params = new URLSearchParams({ tmdb: String(tmdbId), type });
  if (type === 'tv') {
    params.set('season', String(season));
    params.set('episode', String(episode));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${STREAM_API}?${params}`, {
      signal: controller.signal,
      headers: {
        Origin: PLAYER_ORIGIN,
        Referer: `${PLAYER_ORIGIN}/`,
        'User-Agent': USER_AGENT
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getPlayImdbStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  const type = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
  try {
    const [payload, details] = await Promise.all([
      fetchPlayImdbData(tmdbId, type, season, episode),
      getDetails(type, tmdbId, fetch).catch(() => null)
    ]);
    const streamUrls = payload?.data?.stream_urls;
    if (!Array.isArray(streamUrls) || streamUrls.length === 0) return [];

    const fileName = payload.data.file_name || '';
    const quality = /(?:2160|4k)/i.test(fileName) ? '2160p'
      : /1080/i.test(fileName) ? '1080p'
      : /720/i.test(fileName) ? '720p'
      : 'Auto';
    const audio = inferAudioLabel(fileName);
    const title = type === 'tv'
      ? `${details?.name || `TMDB ${tmdbId}`} · S${season}E${episode}`
      : `${details?.title || `TMDB ${tmdbId}`}${details?.release_date ? ` (${details.release_date.slice(0, 4)})` : ''}`;
    const subtitles = subtitleTracks(payload.default_subs);

    const streams = streamUrls.map((url, index) => ({
      name: `PlayIMDb · ${quality} · ${audio}`,
      title: `${title} · Server ${index + 1}`,
      url,
      quality,
      type: inferStreamType(url),
      headers: {
        Origin: PLAYER_ORIGIN,
        Referer: `${PLAYER_ORIGIN}/`,
        'User-Agent': USER_AGENT
      },
      subtitles,
      provider: 'playimdb'
    }));
    console.log(`[PlayIMDb] ${type}/${tmdbId}: ${streams.length} stream(s), ${subtitles.length} subtitle track(s)`);
    return streams;
  } catch (error) {
    console.warn(`[PlayIMDb] ${type}/${tmdbId}: ${error.message}`);
    return [];
  }
}

module.exports = {
  getPlayimdbStreams: adaptProvider({
    id: 'playimdb',
    label: 'PlayIMDb',
    extractor: (...args) => diagnostics.run(() => getPlayImdbStreams(...args), args),
    headers: {
      origin: PLAYER_ORIGIN,
      referer: `${PLAYER_ORIGIN}/`,
      userAgent: USER_AGENT
    }
  })
};
