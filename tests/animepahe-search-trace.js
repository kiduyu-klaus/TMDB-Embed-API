const DEFAULT_QUERY = 'That Time I Got Reincarnated as a Slime season 4';
const DEFAULT_BASE_URL = 'https://animepahe.ch';
const DEFAULT_EPISODE_URL = 'https://animepahe.ch/that-time-i-got-reincarnated-as-a-slime-season-4-episode-7-english-subbed/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function trace(event, fields = {}) {
  console.log(`[animepahe-search-trace][${new Date().toISOString()}] ${event} ${JSON.stringify(fields)}`);
}

async function getScraper() {
  const [{ gotScraping }, cheerio] = await Promise.all([
    import('got-scraping'),
    Promise.resolve(require('cheerio-without-node-native')),
  ]);
  return { gotScraping, cheerio };
}

async function fetchHtml(gotScraping, url, referer) {
  trace('request.start', { url });
  const startedAt = Date.now();
  try {
    const response = await gotScraping({
      url,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(referer ? { Referer: referer } : {}),
      },
      throwHttpErrors: false,
      http2: false,
      timeout: { request: 20000 },
    });
    trace('request.response', {
      url: response.url || url,
      status: response.statusCode,
      contentType: response.headers['content-type'] || null,
      characters: response.body?.length || 0,
      elapsedMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    trace('request.failed', {
      url,
      errorType: error.name,
      code: error.code || null,
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function safeSameSiteUrl(rawUrl, baseUrl) {
  try {
    const parsed = new URL(rawUrl, baseUrl);
    return parsed.hostname === new URL(baseUrl).hostname ? parsed.href : null;
  } catch {
    return null;
  }
}

function safeHttpUrl(rawUrl, baseUrl) {
  try {
    const parsed = new URL(rawUrl, baseUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function parseSearchResults(html, cheerio, baseUrl) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $('.bsx').each((_, card) => {
    const item = $(card);
    const anchor = item.find('a.tip[href], a[href]').first();
    const url = safeSameSiteUrl(anchor.attr('href'), baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);

    const image = item.find('img').first();
    const imageUrl = image.attr('src') || image.attr('data-src');
    results.push({
      title: anchor.attr('title') || item.find('.tt h2, h2').first().text().trim() || anchor.text().replace(/\s+/g, ' ').trim(),
      url,
      status: item.find('.epx').first().text().replace(/\s+/g, ' ').trim() || null,
      audio: item.find('.sb').first().text().replace(/\s+/g, ' ').trim() || null,
      category: item.find('.typez').first().text().replace(/\s+/g, ' ').trim() || null,
      image: imageUrl ? safeSameSiteUrl(imageUrl, baseUrl) : null,
      malId: anchor.attr('rel') || null,
    });
  });

  return { pageTitle: $('title').text().trim(), results };
}

function parseEpisodes(html, cheerio, baseUrl) {
  const $ = cheerio.load(html);
  const episodes = [];
  const seen = new Set();

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href') || '';
    const text = anchor.text().replace(/\s+/g, ' ').trim();
    if (!/episode[-/]\d+/i.test(href)) return;

    const url = safeSameSiteUrl(href, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);

    const episodeMatch = `${text} ${url}`.match(/episode[-/\s]*#?(\d+)/i);
    episodes.push({
      episode: episodeMatch ? Number(episodeMatch[1]) : null,
      title: text || anchor.attr('title') || null,
      url,
    });
  });

  return { pageTitle: $('title').text().trim(), episodes };
}

function parseEpisodeSources(html, cheerio, pageUrl) {
  const $ = cheerio.load(html);
  const sources = [];
  const seen = new Set();
  const addSource = (kind, rawUrl, label, element) => {
    const url = safeHttpUrl(rawUrl, pageUrl);
    if (!url || seen.has(`${kind}:${url}`)) return;
    seen.add(`${kind}:${url}`);
    sources.push({ kind, label: label || null, url, host: new URL(url).hostname, element: element || null });
  };

  $('iframe, video, source').each((_, element) => {
    const node = $(element);
    const tag = String(element.tagName || '').toLowerCase();
    const rawUrl = node.attr('src') || node.attr('data-src') || node.attr('data-lazy-src') ||
      node.attr('data-url') || node.attr('data-embed');
    if (rawUrl) addSource(tag === 'iframe' ? 'embed' : 'media', rawUrl,
      node.attr('title') || node.attr('aria-label') || node.text().trim(), tag);
  });

  $('a[href]').each((_, element) => {
    const node = $(element);
    const rawUrl = node.attr('href');
    const label = node.text().replace(/\s+/g, ' ').trim() || node.attr('title') || '';
    const url = safeHttpUrl(rawUrl, pageUrl);
    if (!url) return;
    const host = new URL(url).hostname;
    const isDownload = /download/i.test(label) || /kwik|gofile/i.test(host);
    const isExternalSource = host !== new URL(pageUrl).hostname &&
      /source|server|stream|player|embed|video/i.test(`${label} ${url}`);
    if (isDownload || isExternalSource) addSource(isDownload ? 'download' : 'link', url, label, 'a');
  });

  const player = $('#megaplay-player');
  const playerMetadata = player.length ? {
    id: player.attr('data-id') || null,
    realId: player.attr('data-realid') || null,
    mediaId: player.attr('data-mediaid') || null,
    fileVersion: player.attr('data-fileversion') || null,
  } : null;
  const directMediaUrls = [...new Set(
    [...String(html).matchAll(/https?:\\?\/\\?\/[^\s"'<>\\]+\.(?:m3u8|mp4|m4v|mpd)(?:\?[^\s"'<>\\]*)?/gi)]
      .map(match => match[0].replace(/\\\//g, '/'))
      .map(rawUrl => safeHttpUrl(rawUrl, pageUrl))
      .filter(Boolean),
  )];

  return { pageTitle: $('title').text().trim(), sources, playerMetadata, directMediaUrls };
}

async function runSearchTrace({ query = DEFAULT_QUERY, maxResults = 10, baseUrl = DEFAULT_BASE_URL } = {}) {
  const { gotScraping, cheerio } = await getScraper();
  const searchUrl = new URL('/', baseUrl);
  searchUrl.searchParams.set('s', query);
  trace('search.start', { query, url: searchUrl.href });

  const searchResponse = await fetchHtml(gotScraping, searchUrl.href);
  if (searchResponse.statusCode < 200 || searchResponse.statusCode >= 300) {
    trace('search.failed', { status: searchResponse.statusCode });
    return { success: false, status: searchResponse.statusCode, results: [] };
  }

  const search = parseSearchResults(searchResponse.body, cheerio, baseUrl);
  const results = search.results.slice(0, Math.max(1, maxResults));
  trace('search.complete', {
    pageTitle: search.pageTitle,
    resultCount: search.results.length,
    resultsScraped: results.length,
  });

  for (const [index, result] of results.entries()) {
    trace('result.found', { index: index + 1, ...result });
    try {
      const pageResponse = await fetchHtml(gotScraping, result.url, searchUrl.href);
      if (pageResponse.statusCode < 200 || pageResponse.statusCode >= 300) {
        trace('series.failed', { index: index + 1, title: result.title, status: pageResponse.statusCode });
        result.scrapeStatus = pageResponse.statusCode;
        result.episodes = [];
        continue;
      }

      const series = parseEpisodes(pageResponse.body, cheerio, baseUrl);
      result.seriesPageTitle = series.pageTitle;
      result.episodes = series.episodes;
      result.scrapeStatus = pageResponse.statusCode;
      trace('series.complete', {
        index: index + 1,
        title: result.title,
        episodeCount: series.episodes.length,
        episodes: series.episodes,
      });
    } catch (error) {
      result.scrapeError = error.code || error.name || 'REQUEST_FAILED';
      result.episodes = [];
      trace('series.error', { index: index + 1, title: result.title, errorType: error.name, code: error.code || null });
    }
  }

  return {
    success: true,
    query,
    searchUrl: searchUrl.href,
    pageTitle: search.pageTitle,
    resultCount: search.results.length,
    results,
  };
}

async function runEpisodeTrace({ episodeUrl = DEFAULT_EPISODE_URL, baseUrl = DEFAULT_BASE_URL } = {}) {
  const { gotScraping, cheerio } = await getScraper();
  const safeEpisodeUrl = safeSameSiteUrl(episodeUrl, baseUrl);
  if (!safeEpisodeUrl) throw new Error('Episode URL must be on the configured AnimePahe host');

  trace('episode.start', { url: safeEpisodeUrl });
  const response = await fetchHtml(gotScraping, safeEpisodeUrl);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    trace('episode.failed', { status: response.statusCode });
    return { success: false, status: response.statusCode, url: safeEpisodeUrl, sources: [] };
  }

  const episode = parseEpisodeSources(response.body, cheerio, safeEpisodeUrl);
  trace('episode.sources', {
    pageTitle: episode.pageTitle,
    sourceCount: episode.sources.length,
    directMediaCount: episode.directMediaUrls.length,
    sources: episode.sources,
    directMediaUrls: episode.directMediaUrls,
  });

  for (const source of episode.sources.filter(item => item.kind === 'embed')) {
    try {
      const playerResponse = await fetchHtml(gotScraping, source.url, safeEpisodeUrl);
      source.probeStatus = playerResponse.statusCode;
      if (playerResponse.statusCode >= 200 && playerResponse.statusCode < 300) {
        const playerPage = parseEpisodeSources(playerResponse.body, cheerio, source.url);
        source.playerPageTitle = playerPage.pageTitle;
        source.playerMetadata = playerPage.playerMetadata;
        source.nestedSources = playerPage.sources;
        source.directMediaUrls = playerPage.directMediaUrls;
        trace('player.sources', {
          embedUrl: source.url,
          status: source.probeStatus,
          pageTitle: source.playerPageTitle,
          playerMetadata: source.playerMetadata,
          nestedSourceCount: source.nestedSources.length,
          directMediaCount: source.directMediaUrls.length,
        });
      } else {
        trace('player.failed', { embedUrl: source.url, status: source.probeStatus });
      }
    } catch (error) {
      source.probeError = error.code || error.name || 'REQUEST_FAILED';
      trace('player.error', { embedUrl: source.url, errorType: error.name, code: error.code || null });
    }
  }

  return {
    success: true,
    url: safeEpisodeUrl,
    pageTitle: episode.pageTitle,
    sourceCount: episode.sources.length,
    sources: episode.sources,
    directMediaUrls: episode.directMediaUrls,
  };
}

if (require.main === module) {
  const [, , modeOrQuery, secondArg] = process.argv;
  const traceRun = modeOrQuery === '--episode'
    ? runEpisodeTrace({ episodeUrl: secondArg || DEFAULT_EPISODE_URL })
    : runSearchTrace({ query: modeOrQuery || DEFAULT_QUERY, maxResults: Number.parseInt(secondArg || '10', 10) || 10 });
  traceRun
    .then(result => {
      console.log('TRACE_RESULT', JSON.stringify(result, null, 2));
      if (!result.success) process.exitCode = 1;
    })
    .catch(error => {
      trace('trace.failed', { errorType: error.name, code: error.code || null });
      process.exitCode = 1;
    });
}

module.exports = { runSearchTrace, runEpisodeTrace, parseSearchResults, parseEpisodes, parseEpisodeSources };
