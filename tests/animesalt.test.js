const test = require('node:test');
const assert = require('node:assert/strict');
const animesalt = require('../providers/animesalt');
const tmdb = require('../utils/tmdb');

test('parses AnimeSalt series search cards and filters out movies for anime requests', () => {
  const html = `
    <div id="movies-a">
      <article><h2 class="entry-title"><a href="https://animesalt.ac/movies/example-movie/">Example Anime</a></h2><span class="year">2018</span></article>
      <article><h2 class="entry-title"><a href="https://animesalt.ac/series/example-anime/">Example Anime</a></h2><span class="year">2018</span></article>
    </div>`;
  const results = animesalt.parseSearchResults(html, 'anime');
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'series');
  assert.equal(results[0].url, 'https://animesalt.ac/series/example-anime/');
  assert.equal(animesalt.rankSearchResults(results, 'Example Anime', 2018)[0], results[0]);
});

test('finds the requested season and episode link, including zero-padded URL numbers', () => {
  const html = '<a href="https://animesalt.ac/episode/example-s1x1/">Episode 1</a>' +
    '<a href="https://animesalt.ac/episode/example-s01x02/">Episode 2</a>' +
    '<a href="https://animesalt.ac/episode/example-s2x2/">Season 2 Episode 2</a>';
  assert.equal(animesalt.findEpisodeUrlFromHtml(html, 1, 2), 'https://animesalt.ac/episode/example-s01x02/');
  assert.equal(animesalt.findEpisodeUrlFromHtml(html, 2, 2), 'https://animesalt.ac/episode/example-s2x2/');
  assert.equal(animesalt.findEpisodeUrlFromHtml(html, 1, 3), null);
});

test('fetches TMDB 82684 season 1 episode 2 and returns HLS plus caption metadata', async () => {
  const originalGetDetails = tmdb.getDetails;
  const originalFetch = global.fetch;
  const requests = [];
  const response = (body, contentType = 'text') => ({
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
    contentType
  });

  tmdb.getDetails = async (type, id) => {
    assert.equal(type, 'tv');
    assert.equal(String(id), '82684');
    return { name: 'Example Anime', first_air_date: '2018-10-01' };
  };
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url, options });
    if (url.pathname === '/' && url.searchParams.has('s')) {
      return response('<div id="movies-a"><article><h2 class="entry-title"><a href="https://animesalt.ac/series/example-anime/">Example Anime</a></h2><span class="year">2018</span></article></div>');
    }
    if (url.pathname === '/series/example-anime/') {
      return response('<button data-post="100" data-season="1">Season 1</button><button data-post="200" data-season="2">Season 2</button>');
    }
    if (url.pathname === '/wp-admin/admin-ajax.php') {
      assert.equal(url.searchParams.get('action'), 'action_select_season');
      assert.equal(url.searchParams.get('season'), '1');
      assert.equal(url.searchParams.get('post'), '100');
      return response('<a href="https://animesalt.ac/episode/example-s1x1/">Episode 1</a><a href="https://animesalt.ac/episode/example-s1x2/">Episode 2</a>');
    }
    if (url.pathname === '/episode/example-s1x2/') {
      return response('<iframe src="https://as-cdn21.top/video/abcdef123456"></iframe>');
    }
    if (url.pathname === '/player/index.php') {
      assert.equal(options.method, 'POST');
      assert.equal(url.searchParams.get('data'), 'abcdef123456');
      assert.equal(url.searchParams.get('do'), 'getVideo');
      assert.match(options.body, /hash=abcdef123456/);
      return response(JSON.stringify({ videoSource: 'https://as-cdn21.top/cdn/hls/ff123456/master.m3u8' }), 'json');
    }
    throw new Error(`Unexpected AnimeSalt request ${url.pathname}`);
  };

  try {
    const streams = await animesalt.getStreams('82684', 'anime', 1, 2);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].name, 'AnimeSalt');
    assert.equal(streams[0].url, 'https://as-cdn21.top/cdn/hls/ff123456/master.m3u8');
    assert.equal(streams[0].quality, '720p');
    assert.equal(streams[0].subtitles[0].url, 'https://as-cdn21.top/cdn/down/ff123456/Subtitle/subtitle_eng.srt');
    assert.equal(streams[0].subtitles[0].language, 'en');
    assert.equal(requests.length, 5);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
  }
});
