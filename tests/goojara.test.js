const test = require('node:test');
const assert = require('node:assert/strict');
const tmdb = require('../utils/tmdb');
const goojara = require('../providers/goojara');

function mockResponse(body = '', status = 200, headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const value = normalized[String(name).toLowerCase()];
        return Array.isArray(value) ? value.join(', ') : value || null;
      },
      getSetCookie() {
        const value = normalized['set-cookie'];
        return value == null ? [] : Array.isArray(value) ? value : [value];
      },
      raw() { return normalized; },
    },
    async text() { return String(body); },
  };
}

function responseForMovie(url, options, calls) {
  const current = new URL(url);
  calls.push({ url: current, options });
  if (current.pathname === '/' && options.method !== 'POST') {
    return mockResponse('<html>home</html>', 200, { 'set-cookie': ['aGooz=temporary-test-session; Path=/; Secure'] });
  }
  if (current.pathname === '/xmre.php') {
    assert.equal(options.method, 'POST');
    assert.match(options.headers.Cookie, /aGooz=temporary-test-session/);
    assert.match(options.body, /q=Fight\+Club/);
    return mockResponse('<ul><li><a href="/mK552K">Fight Club (1999)</a></li><li><a href="https://evil.example/x">Untrusted</a></li></ul>');
  }
  if (current.pathname === '/mK552K') {
    const count = calls.filter(call => call.url.pathname === '/mK552K').length;
    if (count === 1) return mockResponse('<div class="snfo"><h1><a href="/movie/fight-club">Fight Club (1999)</a></h1></div>');
    return mockResponse('<html>show page</html>');
  }
  if (current.pathname === '/movie/fight-club') {
    const count = calls.filter(call => call.url.pathname === '/movie/fight-club').length;
    if (count === 1) return mockResponse('<html>movie details</html>');
    return mockResponse('<script>_3chk(\'challenge\', \'pass\')</script><div id="drl"><a href="/go.php?id=1">Wootly 1080p</a><a href="/go.php?id=2">luluvdo DVD</a></div>');
  }
  if (current.pathname === '/go.php') {
    assert.equal(options.redirect, 'manual');
    assert.match(options.headers.Cookie, /challenge=pass/);
    return mockResponse('', 302, { location: current.searchParams.get('id') === '1' ? 'https://embed.example/movie/1' : 'https://embed.example/movie/2' });
  }
  throw new Error(`Unexpected movie request ${current.hostname}${current.pathname}`);
}

test('Goojara movie flow uses a site-issued session cookie and returns every HTTPS redirect', async () => {
  const originalGetDetails = tmdb.getDetails;
  const originalFetch = global.fetch;
  const calls = [];
  tmdb.getDetails = async (type, id) => {
    assert.equal(type, 'movie');
    assert.equal(String(id), '550');
    return { title: 'Fight Club', original_title: 'Fight Club', release_date: '1999-10-15' };
  };
  global.fetch = async (url, options = {}) => responseForMovie(url, options, calls);
  try {
    const streams = await goojara.getStreams('550', 'movie');
    assert.equal(streams.length, 2);
    assert.deepEqual(streams.map(stream => stream.title), ['Fight Club (1999) - Wootly 1080p', 'Fight Club (1999) - luluvdo DVD']);
    assert.deepEqual(streams.map(stream => stream.quality), ['1080p', 'Auto']);
    assert.deepEqual(streams.map(stream => stream.url), ['https://embed.example/movie/1', 'https://embed.example/movie/2']);
    assert.equal(streams.every(stream => stream.name === 'Goojara' && stream.subtitles.length === 0), true);
    assert.equal(calls.some(call => call.url.hostname === 'evil.example'), false);
    assert.equal(calls.filter(call => call.url.pathname === '/go.php').length, 2);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
  }
});

test('Goojara TV flow selects the requested season and episode and resolves all servers', async () => {
  const originalGetDetails = tmdb.getDetails;
  const originalFetch = global.fetch;
  const calls = [];
  tmdb.getDetails = async (type, id) => {
    assert.equal(type, 'tv');
    assert.equal(String(id), '1399');
    return { name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17' };
  };
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.pathname === '/' && options.method !== 'POST') return mockResponse('home', 200, { 'set-cookie': ['aGooz=session-tv; Path=/'] });
    if (url.pathname === '/xmre.php') {
      assert.match(options.headers.Cookie, /aGooz=session-tv/);
      return mockResponse('<li><a href="/tKQBVe">Game of Thrones (2011)</a></li>');
    }
    if (url.pathname === '/tKQBVe') return mockResponse('<div class="snfo"><h1><a href="/show/got">Game of Thrones</a></h1></div>');
    if (url.pathname === '/show/got' && !url.searchParams.has('s')) return mockResponse('<div id="sesh"><a class="ste" href="/show/got?s=8">Season 8</a></div>');
    if (url.pathname === '/show/got' && url.searchParams.get('s') === '1') {
      return mockResponse('<div class="seho"><span class="sea">01</span><a href="/episode/got-s1e1">Episode 1</a></div><div class="seho"><span class="sea">02</span><a href="/episode/got-s1e2">Episode 2</a></div>');
    }
    if (url.pathname === '/episode/got-s1e1') return mockResponse('<div id="drl"><a href="/go.php?id=tv1">Dood HDTV</a><a href="/go.php?id=tv2">Vidsrc</a></div>');
    if (url.pathname === '/go.php') {
      assert.equal(options.redirect, 'manual');
      return mockResponse('', 302, { location: `https://embed.example/${url.searchParams.get('id')}` });
    }
    throw new Error(`Unexpected TV request ${url.hostname}${url.pathname}${url.search}`);
  };
  try {
    const streams = await goojara.getStreams('1399', 'tv', 1, 1);
    assert.equal(streams.length, 2);
    assert.deepEqual(streams.map(stream => stream.server), ['Dood HDTV', 'Vidsrc']);
    assert.deepEqual(streams.map(stream => stream.url), ['https://embed.example/tv1', 'https://embed.example/tv2']);
    assert.equal(calls.some(call => call.url.pathname === '/episode/got-s1e2'), false);
    assert.equal(calls.some(call => call.url.pathname === '/show/got' && call.url.searchParams.get('s') === '1'), true);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
  }
});

test('Goojara requires season and episode for TV streams and rejects non-HTTPS server links', async () => {
  assert.deepEqual(await goojara.getStreams('1399', 'tv'), []);
  assert.deepEqual(goojara.parseServerLinks('<div id="drl"><a href="http://insecure.example/video">bad</a><a href="javascript:alert(1)">bad2</a></div>', 'https://ww1.goojara.to/episode'), []);
  assert.equal(goojara.extractQuality('Server 2160p'), '4K');
  assert.equal(goojara.extractQuality('Wootly DVD'), 'Auto');
});

test('Goojara resolves Luluvdo and VidSrc sources in parallel and drops dead player links', async () => {
  const originalGetDetails = tmdb.getDetails;
  const originalFetch = global.fetch;
  const calls = [];
  const delayedHosts = new Set(['luluvdo.com', 'dood.watch', 'vidsrc.sh']);
  const firstRequests = new Set();
  let activeFirstRequests = 0;
  let maxParallelFirstRequests = 0;
  let luluIsDead = false;
  const packedPlayerScript = String.raw`eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\b'+c.toString(a)+'\\b','g'),k[c]);return p}('jwplayer("vplayer").setup({sources:[{file:"0"}]})',36,1,'https://lulu-cdn.example/master.m3u8?sig=mock'.split('|'))`;
  tmdb.getDetails = async () => ({ name: 'Game of Thrones', original_name: 'Game of Thrones', first_air_date: '2011-04-17' });
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (delayedHosts.has(url.hostname) && !firstRequests.has(url.hostname)) {
      firstRequests.add(url.hostname);
      activeFirstRequests += 1;
      maxParallelFirstRequests = Math.max(maxParallelFirstRequests, activeFirstRequests);
      await new Promise(resolve => setTimeout(resolve, 35));
      activeFirstRequests -= 1;
    }

    if (url.hostname === 'ww1.goojara.to') {
      if (url.pathname === '/' && options.method !== 'POST') return mockResponse('home', 200, { 'set-cookie': ['aGooz=parallel-session; Path=/'] });
      if (url.pathname === '/xmre.php') return mockResponse('<li><a href="/tKQBVe">Game of Thrones (2011)</a></li>');
      if (url.pathname === '/tKQBVe') return mockResponse('<div class="snfo"><h1><a href="/show/got">Game of Thrones</a></h1></div>');
      if (url.pathname === '/show/got' && !url.searchParams.has('s')) return mockResponse('<div id="sesh"><a class="ste" href="/show/got?s=8">Season 8</a></div>');
      if (url.pathname === '/show/got' && url.searchParams.get('s') === '1') {
        return mockResponse('<div class="seho"><span class="sea">01</span><a href="/episode/got-s1e1">Episode 1</a></div>');
      }
      if (url.pathname === '/episode/got-s1e1') {
        return mockResponse('<div id="drl"><a href="/go.php?id=lulu">luluvdo DVD</a><a href="/go.php?id=dood">Dood</a><a href="/go.php?id=vidsrc">VidSrc</a></div>');
      }
      if (url.pathname === '/go.php') {
        assert.equal(options.redirect, 'manual');
        const destinations = {
          lulu: 'https://luluvdo.com/qlzr2ersiloc',
          dood: 'https://dood.watch/d/z7s1zdsfc2nt',
          vidsrc: 'https://vidsrc.sh/embed/tv?imdb=tt0944947&season=1&episode=1',
        };
        return mockResponse('', 302, { location: destinations[url.searchParams.get('id')] });
      }
    }
    if (url.hostname === 'luluvdo.com' && url.pathname === '/qlzr2ersiloc') {
      return mockResponse('<title>Game of Thrones [1920x1080]</title><iframe src="https://luluvido.com/e/qlzr2ersiloc"></iframe>');
    }
    if (url.hostname === 'luluvido.com' && url.pathname === '/e/qlzr2ersiloc') {
      return mockResponse(luluIsDead
        ? '<div class="alert alert-danger">No such file=165eijz98v1e</div>'
        : `<title>LuluStream player</title><script>${packedPlayerScript}</script>`);
    }
    if (url.hostname === 'dood.watch' && url.pathname === '/d/z7s1zdsfc2nt') {
      return mockResponse('<div>Not Found video you are looking for is not found.</div>');
    }
    if (url.hostname === 'vidsrc.sh' && url.pathname === '/embed/tv') {
      return mockResponse('<iframe id="player_iframe" data-api="/vs_src.php?type=tv&amp;id=tt0944947&amp;season=1&amp;episode=1"></iframe>');
    }
    if (url.hostname === 'vidsrc.sh' && url.pathname === '/vs_src.php') {
      return mockResponse(JSON.stringify({ src: 'https://stellarconductornexus.com/embed/tv/tt0944947/1/1?vs=shell-token' }));
    }
    if (url.hostname === 'stellarconductornexus.com' && url.pathname === '/embed/tv/tt0944947/1/1') {
      return mockResponse(`<script>window.CFG = ${JSON.stringify({ playerUrl: '/embed/player/tv/tt0944947/1/1?vs=player-token' })};</script>`);
    }
    if (url.hostname === 'stellarconductornexus.com' && url.pathname === '/embed/player/tv/tt0944947/1/1') {
      return mockResponse(`<script>window.CONFIG = ${JSON.stringify({
        mediaType: 'tv',
        streamBase: 'https://data.vidsrc.sh/api.php?type=tv&imdb=tt0944947',
        season: 1,
        episode: 1,
        apiToken: 'single-use-test-token',
      })};</script>`);
    }
    if (url.hostname === 'data.vidsrc.sh' && url.pathname === '/api.php') {
      assert.equal(url.searchParams.get('season'), '1');
      assert.equal(url.searchParams.get('episode'), '1');
      assert.equal(url.searchParams.has('stream_urls'), true);
      assert.equal(url.searchParams.get('api_token'), 'single-use-test-token');
      assert.equal(options.headers.Referer, 'https://stellarconductornexus.com/embed/player/tv/tt0944947/1/1?vs=player-token');
      return mockResponse(JSON.stringify({ status_code: 200, vs: { w: 123 }, data: { stream_urls: ['https://got-cdn.example/episode/master.m3u8?sig=mock'] } }));
    }
    if (url.hostname === 'got-cdn.example' && url.pathname === '/generate.php') {
      return mockResponse('mock-stream-token');
    }
    throw new Error(`Unexpected stream-trace request ${url.hostname}${url.pathname}${url.search}`);
  };
  try {
    const streams = await goojara.getStreams('1399', 'tv', 1, 1);
    assert.equal(maxParallelFirstRequests, 3);
    assert.deepEqual(streams.map(stream => stream.url), [
      'https://lulu-cdn.example/master.m3u8?sig=mock',
      'https://got-cdn.example/episode/master.m3u8?sig=mock&token=mock-stream-token',
    ]);
    assert.equal(calls.some(call => call.url.hostname === 'dood.watch'), true);
    assert.equal(calls.some(call => call.url.hostname === 'data.vidsrc.sh' && call.url.searchParams.has('stream_urls')), true);

    luluIsDead = true;
    const streamsAfterDeadNotice = await goojara.getStreams('1399', 'tv', 1, 1);
    assert.deepEqual(streamsAfterDeadNotice.map(stream => stream.url), ['https://got-cdn.example/episode/master.m3u8?sig=mock&token=mock-stream-token']);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
  }
});


test('Goojara resolves Luluvdo packed HLS and Wootly grab/source redirects to direct media', async () => {
  const originalGetDetails = tmdb.getDetails;
  const originalFetch = global.fetch;
  const calls = [];
  const packedPlayerScript = String.raw`eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\b'+c.toString(a)+'\\b','g'),k[c]);return p}('jwplayer("vplayer").setup({sources:[{file:"0"}]})',36,1,'https://lulu-cdn.example/master.m3u8?sig=mock'.split('|'))`;
  tmdb.getDetails = async () => ({ title: 'Fight Club', original_title: 'Fight Club', release_date: '1999-10-15' });
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.hostname === 'ww1.goojara.to') {
      if (url.pathname === '/' && options.method !== 'POST') return mockResponse('home', 200, { 'set-cookie': ['aGooz=trace-session; Path=/'] });
      if (url.pathname === '/xmre.php') return mockResponse('<li><a href="/fight-club">Fight Club (1999)</a></li>');
      if (url.pathname === '/fight-club') return mockResponse('<div class="snfo"><h1><a href="/movie/fight-club">Fight Club (1999)</a></h1></div>');
      if (url.pathname === '/movie/fight-club') {
        const count = calls.filter(call => call.url.hostname === 'ww1.goojara.to' && call.url.pathname === '/movie/fight-club').length;
        return count === 1
          ? mockResponse('<html>details</html>')
          : mockResponse('<div id="drl"><a href="/go.php?id=lulu">luluvdo DVD</a><a href="/go.php?id=wootly">Wootly</a></div>');
      }
      if (url.pathname === '/go.php') {
        const destination = url.searchParams.get('id') === 'lulu'
          ? 'https://luluvdo.com/qlzr2ersiloc'
          : 'https://www.wootly.ch/?v=wootly1';
        return mockResponse('', 302, { location: destination });
      }
    }
    if (url.hostname === 'luluvdo.com' && url.pathname === '/qlzr2ersiloc') {
      return mockResponse('<title>Fight Club [1920x1080]</title><iframe src="https://luluvido.com/e/qlzr2ersiloc"></iframe>');
    }
    if (url.hostname === 'luluvido.com' && url.pathname === '/e/qlzr2ersiloc') {
      return mockResponse(`<title>LuluStream player</title><script>${packedPlayerScript}</script>`);
    }
    if (url.hostname === 'www.wootly.ch' && url.pathname === '/') {
      return mockResponse('<iframe src="https://web.wootly.ch/e/player1"></iframe>');
    }
    if (url.hostname === 'web.wootly.ch' && url.pathname === '/e/player1' && options.method !== 'POST') {
      return mockResponse('<form id="jgb"><input type="hidden" name="qdfx" value="1"></form>');
    }
    if (url.hostname === 'web.wootly.ch' && url.pathname === '/e/player1' && options.method === 'POST') {
      assert.match(options.body, /qdfx=1/);
      return mockResponse('<script>var vd="77",dd="1",tk="trace-token";</script>');
    }
    if (url.hostname === 'web.wootly.ch' && url.pathname === '/grabm') {
      assert.equal(url.searchParams.get('id'), '77');
      assert.equal(url.searchParams.get('t'), 'trace-token');
      return mockResponse('https://web.wootly.ch/source?id=trace');
    }
    if (url.hostname === 'web.wootly.ch' && url.pathname === '/source') {
      return mockResponse('', 302, { location: 'https://cdn.example/Film.720p.mp4?sig=mock' });
    }
    throw new Error(`Unexpected player request ${url.hostname}${url.pathname}`);
  };
  try {
    const streams = await goojara.getStreams('550', 'movie');
    assert.equal(streams.length, 2);
    assert.deepEqual(streams.map(stream => stream.server), ['luluvdo DVD', 'Wootly']);
    assert.deepEqual(streams.map(stream => stream.url), [
      'https://lulu-cdn.example/master.m3u8?sig=mock',
      'https://cdn.example/Film.720p.mp4?sig=mock',
    ]);
    assert.deepEqual(streams.map(stream => stream.quality), ['1080p', '720p']);
    assert.deepEqual(streams.map(stream => stream.headers.Referer), [
      'https://luluvido.com/e/qlzr2ersiloc',
      'https://web.wootly.ch/e/player1',
    ]);
    assert.equal(calls.some(call => call.url.hostname === 'cdn.example' || call.url.hostname === 'lulu-cdn.example'), false);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
  }
});


test('Goojara drops Luluvdo download pages marked No such file before opening the player', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return mockResponse('<div class="alert alert-danger" data-qb-rot="fixture">No such file=165eijz98v1e</div><video src="https://cdn.example/stale.mp4"></video>');
  });
  const streams = await goojara.resolveServer({url:'https://luluvdo.com/d/165eijz98v1e',label:'Lulu'},0,new Map(),'Fixture');
  assert.deepEqual(streams, []);
  assert.equal(requests, 1);
});

test('Goojara filters excluded output hosts and reads Luluvdo inline media without using ad quality', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname === 'luluvdo.com') return mockResponse('<title>Fixture 720p</title><p>Upgrade to 4K</p><iframe src="https://luluvido.com/e/fixture"></iframe>');
    return mockResponse('<video><source src="https://cdn.example/movie.m3u8"><source src="https://dood.watch/file.mp4"><source src="https://sub.vidsrc.me/file.m3u8"></video>');
  });
  const streams = await goojara.resolveServer({url:'https://luluvdo.com/d/fixture',label:'Lulu'},0,new Map(),'Fixture');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/movie.m3u8');
  assert.equal(streams[0].quality, '720p');
  assert.deepEqual(await goojara.resolveServer({url:'https://vidsrc.me/embed/movie/1',label:'VidSrc'},0,new Map(),'Fixture'), []);
});


test('Goojara resolves Dood media to a CDN source without returning the player URL', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    assert.equal(new URL(input).hostname, 'dood.watch');
    return mockResponse('<video src="https://media.example/episode.mp4"></video>');
  });
  const result = await goojara.resolveServer({url:'https://dood.watch/d/fixture',label:'Dood'},0,new Map(),'Fixture');
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://media.example/episode.mp4');
});
