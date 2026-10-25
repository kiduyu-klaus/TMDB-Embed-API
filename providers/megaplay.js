const crypto = require('crypto');
const tmdb = require('../utils/tmdb');
const { fetch } = require('../utils/providerFetch');

const MEGAPLAY_BASE = 'https://megaplay.buzz';
const ANILIST_API = 'https://graphql.anilist.co';
const MEGAPLAY_AES_KEY = 'i?LMTAx0Q6,:}50U';
const MEGAPLAY_AES_IV = "W0;27ToaUpl_P%'c";
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137.0.0.0 Safari/537.36';
const PLAYER_HEADERS = {
  'User-Agent': USER_AGENT,
  Origin: MEGAPLAY_BASE,
  Referer: `${MEGAPLAY_BASE}/`,
  
};
const SUBTITLE_LANGUAGE_CODES = {
  english: 'en', eng: 'en', arabic: 'ar', ara: 'ar', bengali: 'bn', ben: 'bn',
  filipino: 'fil', fil: 'fil', hindi: 'hi', hin: 'hi', french: 'fr', fra: 'fr', fre: 'fr',
  spanish: 'es', spa: 'es', german: 'de', deu: 'de', ger: 'de', portuguese: 'pt', por: 'pt',
  russian: 'ru', rus: 'ru', japanese: 'ja', jpn: 'ja', korean: 'ko', kor: 'ko',
  chinese: 'zh', zho: 'zh', chi: 'zh', tamil: 'ta', telugu: 'te', italian: 'it', ita: 'it',
  turkish: 'tr', tur: 'tr', ukrainian: 'uk', ukr: 'uk', thai: 'th', tha: 'th',
  vietnamese: 'vi', vie: 'vi', persian: 'fa', fas: 'fa', per: 'fa', indonesian: 'id', ind: 'id',
  dutch: 'nl', nld: 'nl', dut: 'nl', polish: 'pl', pol: 'pl', greek: 'el', ell: 'el',
  may: 'ms', malay: 'ms',
};
const SUBTITLE_MIME_TYPES = {
  vtt: 'text/vtt',
  srt: 'application/x-subrip',
  ass: 'text/x-ass',
  ssa: 'text/x-ssa',
};
const MEDIA_MIME_TYPES = {
  hls: 'application/vnd.apple.mpegurl',
  dash: 'application/dash+xml',
  mp4: 'video/mp4',
};

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function yearFromDate(value) {
  const match = String(value || '').match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

async function getTmdbAnimeInfo(tmdbId, mediaType, seasonNumber) {
  const details = await tmdb.getDetails(mediaType, tmdbId);
  if (!details) return null;

  const title = mediaType === 'tv'
    ? details.name || details.original_name
    : details.title || details.original_title;
  const titles = uniqueStrings([
    details.name,
    details.title,
    details.original_name,
    details.original_title,
  ]);
  let year = yearFromDate(mediaType === 'tv' ? details.first_air_date : details.release_date);

  if (mediaType === 'tv' && seasonNumber >= 0) {
    try {
      const season = await tmdb.getSeasonDetails(tmdbId, seasonNumber);
      year = yearFromDate(season && season.air_date) || year;
    } catch (_) {
      // Fall back to the series' first-air year if season metadata is unavailable.
    }
  }

  return { title: String(title || '').trim(), titles: uniqueStrings(titles), year };
}

function getCandidateTitles(media) {
  const title = media && media.title ? media.title : {};
  return uniqueStrings([
    title.english,
    title.romaji,
    title.native,
    title.userPreferred,
    ...(Array.isArray(media && media.synonyms) ? media.synonyms : []),
  ]);
}

function titleMatchScore(media, wantedTitles) {
  const candidateTitles = getCandidateTitles(media).map(normalizeTitle).filter(Boolean);
  const targets = wantedTitles.map(normalizeTitle).filter(Boolean);
  let score = 0;

  for (const target of targets) {
    for (const candidate of candidateTitles) {
      if (candidate === target) score = Math.max(score, 100);
      else if (candidate.startsWith(`${target} season `) || candidate.startsWith(`${target} the final season`)) {
        score = Math.max(score, 85);
      }
    }
  }
  return score;
}

function formatMatchesMediaType(format, mediaType) {
  const normalized = String(format || '').toUpperCase();
  return mediaType === 'movie' ? normalized === 'MOVIE' : normalized !== 'MOVIE';
}

async function searchAniList(title, year) {
  const query = `
    query ($search: String, $seasonYear: Int) {
      Page(perPage: 10) {
        media(search: $search, seasonYear: $seasonYear, type: ANIME) {
          id
          idMal
          format
          seasonYear
          startDate { year }
          title { english romaji native userPreferred }
          synonyms
        }
      }
    }`;
  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables: { search: title, seasonYear: year } }),
  });
  if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);
  const json = await response.json();
  if (Array.isArray(json.errors) && json.errors.length) {
    throw new Error(json.errors.map(error => error.message).join('; '));
  }
  return json && json.data && json.data.Page && Array.isArray(json.data.Page.media)
    ? json.data.Page.media
    : [];
}

async function resolveMalId(tmdbInfo, mediaType) {
  if (!tmdbInfo || !tmdbInfo.title || !tmdbInfo.year) return null;
  const searchTitles = uniqueStrings([tmdbInfo.title, ...tmdbInfo.titles]);
  const candidates = new Map();

  for (const searchTitle of searchTitles) {
    try {
      const results = await searchAniList(searchTitle, tmdbInfo.year);
      for (const media of results) {
        if (!media || !media.idMal || !formatMatchesMediaType(media.format, mediaType)) continue;
        const resultYear = Number(media.seasonYear || (media.startDate && media.startDate.year) || 0);
        if (resultYear && resultYear !== tmdbInfo.year) continue;
        const score = titleMatchScore(media, searchTitles);
        if (!score) continue;
        const previous = candidates.get(String(media.id));
        if (!previous || score > previous.score) {
          candidates.set(String(media.id), { media, score });
        }
      }
    } catch (error) {
      console.warn(`[MegaPlay] AniList search failed for "${searchTitle}" (${tmdbInfo.year}): ${error.message}`);
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aFormat = String(a.media.format || '').toUpperCase();
    const bFormat = String(b.media.format || '').toUpperCase();
    if (mediaType === 'tv') {
      if (aFormat === 'TV' && bFormat !== 'TV') return -1;
      if (bFormat === 'TV' && aFormat !== 'TV') return 1;
    }
    return 0;
  });

  return ordered.length ? String(ordered[0].media.idMal) : null;
}

function decryptMegaPlaySources(encodedPayload) {
  if (typeof encodedPayload !== 'string' || !encodedPayload) return null;
  const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const key = Buffer.alloc(32);
  Buffer.from(MEGAPLAY_AES_KEY, 'utf8').copy(key, 0, 0, 32);
  const iv = Buffer.alloc(16);
  Buffer.from(MEGAPLAY_AES_IV, 'utf8').copy(iv, 0, 0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(paddedBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

async function fetchText(url, headers) {
  const response = await fetch(url, { headers: headers || PLAYER_HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers: headers || PLAYER_HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function extractContentId(html) {
  const match = String(html || '').match(/<title>\s*File\s+(\d+)\s*-\s*MegaPlay\s*<\/title>/i);
  return match ? match[1] : null;
}

function getPlayableSourceUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim(), `${MEGAPLAY_BASE}/`);
    if (url.protocol !== 'https:') return null;
    if (!/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(url.href)) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

function languageCode(track, url) {
  const hint = String((track && (track.language || track.lang || track.label)) || '').trim().toLowerCase();
  const directCode = hint.match(/^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i);
  if (directCode) return SUBTITLE_LANGUAGE_CODES[hint] || hint.replace(/_/g, '-');

  for (const [name, code] of Object.entries(SUBTITLE_LANGUAGE_CODES)) {
    if (hint === name || hint.startsWith(`${name} `) || hint.startsWith(`${name} (`)) return code;
  }

  const filename = (() => {
    try { return new URL(url).pathname.split('/').pop() || ''; } catch (_) { return ''; }
  })().toLowerCase();
  const fileCode = filename.match(/(?:^|[-_.])([a-z]{2,3})(?:[-_.]|$)/);
  return fileCode ? (SUBTITLE_LANGUAGE_CODES[fileCode[1]] || fileCode[1]) : 'und';
}

function normalizeSubtitles(tracks) {
  if (!Array.isArray(tracks)) return [];
  return tracks.flatMap((track, index) => {
    if (!track || typeof track !== 'object') return [];
    const kind = String(track.kind || '').toLowerCase();
    if (kind && !/caption|subtitle/.test(kind)) return [];

    const rawUrl = track.file || track.url;
    if (typeof rawUrl !== 'string' || !rawUrl) return [];
    let subtitleUrl;
    let extension;
    try {
      const parsed = new URL(rawUrl, `${MEGAPLAY_BASE}/`);
      if (!['http:', 'https:'].includes(parsed.protocol)) return [];
      subtitleUrl = parsed.href;
      extension = parsed.pathname.split('.').pop().toLowerCase();
    } catch (_) {
      return [];
    }

    if (!SUBTITLE_MIME_TYPES[extension] && !/caption|subtitle/.test(kind)) return [];
    const language = languageCode(track, subtitleUrl);
    const label = String(track.label || track.language || track.lang || language).trim();
    return [{
      id: `megaplay-${index}-${language}`,
      url: subtitleUrl,
      lang: language,
      label,
      mimeType: track.mimeType || SUBTITLE_MIME_TYPES[extension] || 'text/vtt',
      language,
      headers: {
        Referer: `${MEGAPLAY_BASE}/`,
        'User-Agent': USER_AGENT,
      },
    }];
  });
}

function formatForUrl(url) {
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch (_) { return 'hls'; }
  if (pathname.endsWith('.mpd')) return 'dash';
  if (pathname.endsWith('.mp4')) return 'mp4';
  return 'hls';
}

async function fetchMegaPlayPayload(malId, episode, voiceType) {
  const playerUrl = `${MEGAPLAY_BASE}/stream/mal/${encodeURIComponent(malId)}/${encodeURIComponent(episode)}/${voiceType}`;
  const html = await fetchText(playerUrl, PLAYER_HEADERS);
  const contentId = extractContentId(html);
  if (!contentId) throw new Error(`MegaPlay content ID not found for ${voiceType}`);

  const sourcesUrl = `${MEGAPLAY_BASE}/stream/getSources?id=${encodeURIComponent(contentId)}&platform=OTHER`;
  const sourcesHeaders = {
    ...PLAYER_HEADERS,
    'X-Requested-With': 'XMLHttpRequest',
  };
  const encryptedPayload = await fetchJson(sourcesUrl, sourcesHeaders);
  let decryptedPayload = {};

  if (encryptedPayload && encryptedPayload.sources && encryptedPayload.sources.file) {
    decryptedPayload = encryptedPayload.sources;
  } else if (encryptedPayload && typeof encryptedPayload.enc === 'string') {
    decryptedPayload = decryptMegaPlaySources(encryptedPayload.enc) || {};
  }

  const sourceData = { ...(encryptedPayload || {}), ...(decryptedPayload || {}) };
  const streamUrl = getPlayableSourceUrl(
    sourceData.file || (sourceData.sources && sourceData.sources.file)
  );
  if (!streamUrl) throw new Error(`No supported media URL found for ${voiceType}`);

  return { sourceData, streamUrl };
}

async function getStreams(tmdbId, mediaType = 'tv', season = 1, episode = 1) {
  try {
    const type = String(mediaType || 'tv').toLowerCase();
    const id = String(tmdbId || '').trim();
    if (!/^\d{1,10}$/.test(id) || Number(id) <= 0 || !['tv', 'movie'].includes(type)) return [];

    const seasonNumber = Number.isInteger(Number(season)) && Number(season) >= 0 ? Number(season) : 1;
    const episodeNumber = type === 'movie' ? 1 : (Number.isInteger(Number(episode)) && Number(episode) > 0 ? Number(episode) : 1);
    const info = await getTmdbAnimeInfo(id, type, seasonNumber);
    if (!info || !info.title || !info.year) {
      console.warn(`[MegaPlay] TMDB metadata unavailable for ${type}/${id}`);
      return [];
    }

    const malId = await resolveMalId(info, type);
    if (!malId) {
      console.warn(`[MegaPlay] No high-confidence MAL match for TMDB ${type}/${id} (${info.title}, ${info.year})`);
      return [];
    }

    const title = info.title;
    const voiceTypes = ['sub', 'dub'];
    const settled = await Promise.allSettled(voiceTypes.map(async voiceType => {
      const { sourceData, streamUrl } = await fetchMegaPlayPayload(malId, episodeNumber, voiceType);
      const format = formatForUrl(streamUrl);
      const voiceLabel = voiceType === 'sub' ? 'Sub' : 'Dub';
      const serverLabel = sourceData.server != null ? `Server ${sourceData.server}` : 'Server 1';
      const stream = {
        name: `MegaPlay - ${title} - ${serverLabel} - ${voiceLabel}`,
        title: `${title} - ${serverLabel} - ${voiceLabel}`,
        url: streamUrl,
        quality: 'Auto',
        type: format,
        provider: 'megaplay',
        headers: { ...PLAYER_HEADERS },
        subtitles: normalizeSubtitles(sourceData.tracks),
        format,
        mimeType: MEDIA_MIME_TYPES[format] || 'application/octet-stream',
      };
      if (sourceData.intro != null) stream.intro = sourceData.intro;
      if (sourceData.outro != null) stream.outro = sourceData.outro;
      return stream;
    }));

    return settled.flatMap(result => {
      if (result.status === 'fulfilled') return [result.value];
      console.warn(`[MegaPlay] Stream lookup failed for ${type}/${id}: ${result.reason.message}`);
      return [];
    });
  } catch (error) {
    console.warn(`[MegaPlay] Failed for TMDB ${tmdbId}: ${error.message}`);
    return [];
  }
}

module.exports = { getStreams };
