const { getDetails } = require('../utils/tmdb');
const { adaptProvider } = require('../utils/providerAdapter');

const fetch = globalThis.fetch || require('node-fetch');

const BASE_URL = (process.env.HDMOVIE2_BASE_URL || 'https://newhdmovie2.dev/').replace(/\/$/, '');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const MAX_SERVERS = 4;

const PAGE_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`
};

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeTitle(value) {
  return decodeHtml(value)
    .toLowerCase()
    .replace(/\b(hindi|dubbed|dual audio|web[- ]?dl|bluray|netflix|amzn|hd)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleBeforeYear(value) {
  return String(value || '').split(/\(\d{4}\)/, 1)[0];
}

async function fetchText(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...PAGE_HEADERS, ...(options.headers || {}) },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseSearchResults(html) {
  const results = [];
  const seen = new Set();
  const articlePattern = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let articleMatch;

  while ((articleMatch = articlePattern.exec(html)) !== null) {
    const article = articleMatch[1];
    const linkMatch = article.match(/href=["'](https?:\/\/[^"']+\/movies\/([^"'/]+)\/)["']/i);
    const titleMatch = article.match(/alt=["']([^"']+)["']/i);
    if (!linkMatch || !titleMatch || seen.has(linkMatch[1])) continue;

    const title = decodeHtml(titleMatch[1]).trim();
    const yearMatch = title.match(/\((\d{4})\)/);
    seen.add(linkMatch[1]);
    results.push({
      url: linkMatch[1],
      slug: linkMatch[2],
      title,
      year: yearMatch ? Number(yearMatch[1]) : null
    });
  }
  return results;
}

function selectMatchingResult(results, title, year) {
  const expectedTitle = normalizeTitle(title);
  return results
    .map(result => {
      const candidateTitle = normalizeTitle(titleBeforeYear(result.title));
      const titleMatches = candidateTitle === expectedTitle;
      const yearMatches = !year || !result.year || Math.abs(result.year - year) <= 1;
      return {
        ...result,
        score: (titleMatches ? 100 : 0) + (yearMatches ? 20 : 0) - Math.abs(candidateTitle.length - expectedTitle.length)
      };
    })
    .filter(result => normalizeTitle(titleBeforeYear(result.title)) === expectedTitle)
    .filter(result => !year || !result.year || Math.abs(result.year - year) <= 1)
    .sort((a, b) => b.score - a.score)[0] || null;
}

async function searchMovie(title, year) {
  const html = await fetchText(`${BASE_URL}/?s=${encodeURIComponent(title)}`);
  const results = parseSearchResults(html);
  const match = selectMatchingResult(results, title, year);
  console.log(`[HDMovie2] Search candidates=${results.length}; matched=${Boolean(match)}`);
  return match;
}

function extractEmbedUrl(value) {
  const cleaned = decodeHtml(value).replace(/\\\//g, '/');
  const iframe = cleaned.match(/src=["']([^"']+)["']/i);
  const rawUrl = iframe ? iframe[1] : cleaned.trim();
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl, BASE_URL).href;
  } catch {
    return null;
  }
}

async function resolveMolop(playerUrl) {
  const html = await fetchText(playerUrl, {
    headers: { Referer: `${BASE_URL}/` }
  });
  const match = html.match(
    /sniff\s*\(\s*["'][^"']+["']\s*,\s*["'](\d+)["']\s*,\s*["']([a-f0-9]+)["']/i
  );
  if (!match) return null;

  const origin = new URL(playerUrl).origin;
  return {
    url: `${origin}/m3u8/${match[1]}/${match[2]}/master.m3u8?s=1&cache=1`,
    quality: 'Auto',
    type: 'hls',
    headers: {
      'User-Agent': USER_AGENT,
      Origin: origin,
      Referer: `${origin}/`
    }
  };
}

async function resolveHdm2(playerUrl) {
  const html = await fetchText(playerUrl, {
    headers: { Referer: `${BASE_URL}/` }
  });
  const match = html.match(/data-stream-url=["']([^"']+)["']/i);
  if (!match) return null;

  const origin = new URL(playerUrl).origin;
  return {
    url: new URL(decodeHtml(match[1]), origin).href,
    quality: 'Auto',
    type: 'hls',
    headers: {
      'User-Agent': USER_AGENT,
      Origin: origin,
      Referer: `${origin}/`
    }
  };
}

async function resolvePlayer(playerUrl) {
  const host = new URL(playerUrl).hostname.toLowerCase();
  if (host === 'molop.art' || host.endsWith('.molop.art')) return resolveMolop(playerUrl);
  if (/^hdm2\./i.test(host)) return resolveHdm2(playerUrl);
  return null;
}

async function getPostId(movieUrl) {
  const html = await fetchText(movieUrl, {
    headers: { Referer: `${BASE_URL}/` }
  });
  return html.match(/postid-(\d+)/i)?.[1] || null;
}

async function getServerStream(postId, movieUrl, serverNumber) {
  const body = new URLSearchParams({
    action: 'doo_player_ajax',
    post: postId,
    nume: String(serverNumber),
    type: 'movie'
  }).toString();
  const responseText = await fetchText(`${BASE_URL}/wp-admin/admin-ajax.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: movieUrl
    },
    body
  });

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return null;
  }
  const playerUrl = extractEmbedUrl(payload.embed_url);
  if (!playerUrl) return null;

  try {
    const stream = await resolvePlayer(playerUrl);
    return stream ? { ...stream, serverNumber } : null;
  } catch (error) {
    console.warn(`[HDMovie2] Server ${serverNumber} failed: ${error.message}`);
    return null;
  }
}

async function extractHdmovie2Streams(tmdbId, mediaType = 'movie') {
  // HDMovie2 publishes TV seasons as complete videos rather than episode files.
  // Returning those for an episode request would play the wrong media.
  if (mediaType !== 'movie') {
    console.log('[HDMovie2] Series extraction is unsupported because pages are season-complete videos');
    return [];
  }

  try {
    const details = await getDetails('movie', tmdbId);
    const title = details?.title || details?.name;
    const releaseDate = details?.release_date || '';
    const year = /^\d{4}/.test(releaseDate) ? Number(releaseDate.slice(0, 4)) : null;
    if (!title) return [];

    const result = await searchMovie(title, year);
    if (!result) return [];
    const postId = await getPostId(result.url);
    if (!postId) return [];

    const settled = await Promise.allSettled(
      Array.from({ length: MAX_SERVERS }, (_, index) =>
        getServerStream(postId, result.url, index + 1)
      )
    );
    const streams = settled
      .filter(entry => entry.status === 'fulfilled' && entry.value)
      .map(entry => entry.value);

    console.log(`[HDMovie2] Resolved streams=${streams.length} from servers=${MAX_SERVERS}`);
    return streams.map(stream => ({
      name: 'HDMovie2',
      title: `HDMovie2 - Server ${stream.serverNumber}`,
      url: stream.url,
      quality: stream.quality,
      type: stream.type,
      headers: stream.headers
    }));
  } catch (error) {
    console.error(`[HDMovie2] Extraction failed: ${error.message}`);
    return [];
  }
}

const getHdmovie2Streams = adaptProvider({
  id: 'hdmovie2',
  label: 'HDMovie2',
  extractor: extractHdmovie2Streams,
  timeoutMs: 25_000,
  headers: {
    userAgent: USER_AGENT,
    origin: BASE_URL,
    referer: `${BASE_URL}/`
  }
});

module.exports = { getHdmovie2Streams };
