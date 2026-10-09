const test = require('node:test');
const assert = require('node:assert/strict');
const animesalt = require('../providers/animesalt');
const tmdb = require('../utils/tmdb');

test('parses AnimeSalt series search cards and filters out movies for anime requests', () => {
  const html = `
    <div id="movies-a">
      <article><h2 class="entry-title"><a href="https://animesalt.cx/movies/example-movie/">Example Anime</a></h2><span class="year">2018</span></article>
      <article><h2 class="entry-title"><a href="https://animesalt.cx/series/example-anime/">Example Anime</a></h2><span class="year">2018</span></article>
    </div>`;
  const results = animesalt.parseSearchResults(html, 'anime');
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'series');
  assert.equal(results[0].url, 'https://animesalt.cx/series/example-anime/');
  assert.equal(animesalt.rankSearchResults(results, 'Example Anime', 2018)[0], results[0]);
});

test('finds the requested season and episode link, including zero-padded URL numbers', () => {
  const html = '<a href="https://animesalt.cx/episode/example-s1x1/">Episode 1</a>' +
    '<a href="https://animesalt.cx/episode/example-s01x02/">Episode 2</a>' +
    '<a href="https://animesalt.cx/episode/example-s2x2/">Season 2 Episode 2</a>';
  assert.equal(animesalt.findEpisodeUrlFromHtml(html, 1, 2), 'https://animesalt.cx/episode/example-s01x02/');
  assert.equal(animesalt.findEpisodeUrlFromHtml(html, 2, 2), 'https://animesalt.cx/episode/example-s2x2/');
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
      return response('<div id="movies-a"><article><h2 class="entry-title"><a href="https://animesalt.cx/series/example-anime/">Example Anime</a></h2><span class="year">2018</span></article></div>');
    }
    if (url.pathname === '/series/example-anime/') {
      return response('<button data-post="100" data-season="1">Season 1</button><button data-post="200" data-season="2">Season 2</button>');
    }
    if (url.pathname === '/wp-admin/admin-ajax.php') {
      assert.equal(url.searchParams.get('action'), 'action_select_season');
      assert.equal(url.searchParams.get('season'), '1');
      assert.equal(url.searchParams.get('post'), '100');
      return response('<a href="https://animesalt.cx/episode/example-s1x1/">Episode 1</a><a href="https://animesalt.cx/episode/example-s1x2/">Episode 2</a>');
    }
    if (url.pathname === '/episode/example-s1x2/') {
      return response('<iframe src="https://ravok.buzz/video/abcdef123456"></iframe>');
    }
    if (url.pathname === '/player/index.php') {
      assert.equal(options.method, 'POST');
      assert.equal(url.searchParams.get('data'), 'abcdef123456');
      assert.equal(url.searchParams.get('do'), 'getVideo');
      assert.match(options.body, /hash=abcdef123456/);
      assert.match(options.body, /r=https%3A%2F%2Fanimesalt.cx%2Fepisode%2Fexample-s1x2%2F/);
      assert.equal(options.headers.Referer, 'https://ravok.buzz/video/abcdef123456');
      return response(JSON.stringify({
        videoSource: 'https://ravok.buzz/cdn/hls/ff123456/master.m3u8',
        tracks: [{ file: 'https://ravok.buzz/cdn/down/ff123456/Subtitle/subtitle_eng.srt', label: 'English', language: 'en' }]
      }), 'json');
    }
    throw new Error(`Unexpected AnimeSalt request ${url.pathname}`);
  };

  try {
    const streams = await animesalt.getStreams('82684', 'anime', 1, 2);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].name, 'AnimeSalt');
    assert.equal(streams[0].url, 'https://ravok.buzz/cdn/hls/ff123456/master.m3u8');
    assert.equal(streams[0].quality, '720p');
    assert.equal(streams[0].subtitles[0].url, 'https://ravok.buzz/cdn/down/ff123456/Subtitle/subtitle_eng.srt');
    assert.equal(streams[0].subtitles[0].language, 'en');
    assert.equal(requests.length, 5);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
  }
});

test('does not mistake an MP4 filename in the Abyss player title for a media source', () => {
  const html = '<title>That Time I Got Reincarnated as a Slime Season 2 Episode 16-hin.mp4</title>' +
    '<script>const datas = "base64-encoded-player-payload";</script>';
  assert.deepEqual(animesalt.extractPlayableSources(html, 'https://player.abyssplayer.com/ni4MusXZU'), []);
});

test('resolves every supported AnimeSalt server for TMDB 82684 S2E16 in parallel', async () => {
  const originalGetDetails = tmdb.getDetails;
  const originalFetch = global.fetch;
  const requests = [];
  const response = body => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });
  tmdb.getDetails = async (type, id) => {
    assert.equal(type, 'tv');
    assert.equal(String(id), '82684');
    return { name: 'That Time I Got Reincarnated as a Slime', first_air_date: '2018-10-01' };
  };
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    requests.push({ url, options });
    if (url.pathname === '/' && url.searchParams.has('s')) {
      return response('<div id="movies-a"><article><h2 class="entry-title"><a href="https://animesalt.cx/series/that-time-i-got-reincarnated-as-a-slime/">That Time I Got Reincarnated as a Slime</a></h2><span class="year">2018</span></article></div>');
    }
    if (url.pathname === '/series/that-time-i-got-reincarnated-as-a-slime/') {
      return response('<a href="https://animesalt.cx/episode/that-time-i-got-reincarnated-as-a-slime-2x16/">Episode 16</a>');
    }
    if (url.pathname === '/episode/that-time-i-got-reincarnated-as-a-slime-2x16/') {
      return response(`
        <div class="server-grid">
          <div class="server-btn"><div class="server-name">SERVER 1</div><div class="server-info">MyStream</div></div>
          <div class="server-btn"><div class="server-name">SERVER 2</div><div class="server-info">Abyss</div></div>
          <div class="server-btn"><div class="server-name">SERVER 3</div><div class="server-info">StreamHG</div></div>
        </div>
        <div class="video aa-tb" id="options-0"><iframe src="https://ravok.buzz/video/abcdef1234567890abcdef1234567890" data-src="https://ravok.buzz/video/abcdef1234567890abcdef1234567890"></iframe></div>
        <div class="video aa-tb" id="options-1"><iframe data-src="https://animesalt.cx/wp-content/themes/torofilm/public/plyr/player.php?server=abyss"></iframe></div>
        <div class="video aa-tb" id="options-2"><iframe data-src="https://cybervynx.com/e/a7472ccj9tlm"></iframe></div>`);
    }
    if (url.hostname === 'ravok.buzz' && url.pathname === '/player/index.php') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Origin, 'https://ravok.buzz');
      return response(JSON.stringify({ videoSource: 'https://ravok.buzz/cdn/hls/ff123456/master.m3u8' }));
    }
    if (url.hostname === 'animesalt.cx' && url.pathname.endsWith('/player.php')) {
      return response('<iframe src="https://player.abyssplayer.com/ni4MusXZU"></iframe>');
    }
    if (url.hostname === 'player.abyssplayer.com' && url.pathname === '/ni4MusXZU') {
      return response('<script>jwplayer("player").setup({file:"https://player.abyssplayer.com/16-hin.mp4"});</script>');
    }
    if (url.hostname === 'cybervynx.com' && url.pathname === '/e/a7472ccj9tlm') {
      return response('<title>Loading...</title><script src="/main.js"></script>');
    }
    throw new Error(`Unexpected AnimeSalt request ${url.hostname}${url.pathname}`);
  };

  try {
    const streams = await animesalt.getStreams('82684', 'anime', 2, 16);
    assert.equal(streams.length, 2);
    assert.deepEqual(streams.map(stream => stream.server), ['SERVER 1 MyStream', 'SERVER 2 Abyss']);
    assert.equal(streams[0].url, 'https://ravok.buzz/cdn/hls/ff123456/master.m3u8');
    assert.equal(streams[0].subtitles.length, 0);
    assert.equal(streams[1].url, 'https://player.abyssplayer.com/16-hin.mp4');
    assert.equal(streams[0].title.endsWith('SERVER 1 MyStream'), true);
    assert.equal(streams[1].title.endsWith('SERVER 2 Abyss'), true);
    assert.equal(requests.some(({ url }) => url.hostname === 'cybervynx.com'), true);
    assert.equal(requests.some(({ url }) => url.hostname === 'cybervynx.com' && url.pathname === '/main.js'), false);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
  }
});
