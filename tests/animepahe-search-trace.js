const DEFAULT_QUERY = 'That Time I Got Reincarnated as a Slime season 4';
const DEFAULT_BASE_URL = 'https://animepahe.ch';
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

if (require.main === module) {
  const [, , query = DEFAULT_QUERY, maxResultsArg = '10'] = process.argv;
  const maxResults = Number.parseInt(maxResultsArg, 10);
  runSearchTrace({ query, maxResults: Number.isFinite(maxResults) ? maxResults : 10 })
    .then(result => {
      console.log('TRACE_RESULT', JSON.stringify(result, null, 2));
      if (!result.success) process.exitCode = 1;
    })
    .catch(error => {
      trace('trace.failed', { errorType: error.name, code: error.code || null });
      process.exitCode = 1;
    });
}

module.exports = { runSearchTrace, parseSearchResults, parseEpisodes };
