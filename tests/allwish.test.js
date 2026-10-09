const test = require('node:test');
const assert = require('node:assert/strict');
const allwish = require('../providers/allwish');
const tmdb = require('../utils/tmdb');
const animeKai = require('../providers/animekai');

test('builds season-aware AllWish anime search queries', () => {
  assert.equal(allwish.buildAnimeSearchTitle('Example Anime', 1), 'Example Anime');
  assert.equal(allwish.buildAnimeSearchTitle('Example Anime', 2), 'Example Anime season 2');
});

test('selects the matching title and requested season instead of the first search result', () => {
  const html = `
    <div class="item"><div class="name"><a href="/other-anime" title="Different Show"></a></div></div>
    <div class="item"><div class="name"><a href="/example-season-1" title="Example Anime Season 1 (Sub)">Example Anime</a></div></div>
    <div class="item"><div class="name"><a href="/example-season-2" title="Example Anime Season 2 (Dub)">Example Anime</a></div></div>`;
  const result = allwish.findAnimeSearchCandidate(html, 'Example Anime', 2);
  assert.equal(result.href, 'https://all-wish.me/example-season-2');
  assert.equal(result.title, 'Example Anime Season 2 (Dub)');
});

test('selects only the requested episode and never substitutes a different episode', () => {
  const html = '<div class="range"><div><a data-slug="1" data-ids="episode-one"></a><a data-slug="2" data-ids="episode-two"></a></div></div>';
  assert.equal(allwish.findEpisodeDataIds(html, 2, 1), 'episode-two');
  assert.equal(allwish.findEpisodeDataIds(html, 3, 1), null);
});

test('parses subtitle and dub server groups', () => {
  const html = '<div class="server-type" data-type="sub"><div class="server-list"><div class="server" data-link-id="sub-id">Mega Sub</div></div></div>' +
    '<div class="server-type" data-type="dub"><div class="server-list"><div class="server" data-link-id="dub-id">Cloud Dub</div></div></div>';
  assert.deepEqual(allwish.parseServerEntries(html), [
    { dataLinkId: 'sub-id', sectionType: 'sub', label: 'Mega Sub' },
    { dataLinkId: 'dub-id', sectionType: 'dub', label: 'Cloud Dub' }
  ]);
});

test('fetches TMDB 82684 season 1 episode 2 and resolves every returned server', async () => {
  const originalGetDetails = tmdb.getDetails;
  const originalFetch = global.fetch;
  const originalResolver = animeKai.resolveDirectM3u8;
  const requests = [];
  const resolvedPlayers = [];
  const htmlResponse = (body) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) });

  tmdb.getDetails = async (type, id) => {
    assert.equal(type, 'tv');
    assert.equal(String(id), '82684');
    return { name: 'Example Anime' };
  };
  animeKai.resolveDirectM3u8 = async (playerUrl) => {
    resolvedPlayers.push(playerUrl);
    const serverName = new URL(playerUrl).searchParams.get('server');
    return {
      url: `https://cdn.example/${serverName}.m3u8`,
      referer: playerUrl,
      subtitles: [{ id: 'en', url: 'https://subs.example/en.vtt', lang: 'en' }],
      intro: { start: 0, end: 90 },
      outro: { start: 1300, end: 1390 }
    };
  };
  global.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname === '/filter') {
      return htmlResponse('<div class="item"><div class="name"><a href="/example-s1" title="Example Anime Season 1"></a></div></div>');
    }
    if (url.pathname === '/example-s1') {
      return htmlResponse('<main><div class="container" data-id="anime-42"></div></main>');
    }
    if (url.pathname === '/ajax/episode/list/anime-42') {
      return htmlResponse(JSON.stringify({ status: 200, result: '<div class="range"><div><a data-slug="1" data-ids="ep-1"></a><a data-slug="2" data-ids="ep-2"></a></div></div>' }));
    }
    if (url.pathname === '/ajax/server/list') {
      assert.equal(url.searchParams.get('servers'), 'ep-2');
      return htmlResponse(JSON.stringify({ status: 200, result: '<div class="server-type" data-type="sub"><div class="server-list"><div class="server" data-link-id="sub-id">Sub Server</div></div></div><div class="server-type" data-type="dub"><div class="server-list"><div class="server" data-link-id="dub-id">Dub Server</div></div></div>' }));
    }
    if (url.pathname === '/ajax/server') {
      const id = url.searchParams.get('get');
      return htmlResponse(JSON.stringify({ result: { url: `https://megaplay.buzz/embed?server=${id}` } }));
    }
    throw new Error(`Unexpected request path ${url.pathname}`);
  };

  try {
    const streams = await allwish.getStreams('82684', 'anime', 1, 2);
    assert.equal(streams.length, 2);
    assert.deepEqual(resolvedPlayers.sort(), [
      'https://megaplay.buzz/embed?server=dub-id',
      'https://megaplay.buzz/embed?server=sub-id'
    ]);
    assert.deepEqual(streams.map((stream) => stream.url).sort(), [
      'https://cdn.example/dub-id.m3u8',
      'https://cdn.example/sub-id.m3u8'
    ]);
    assert.equal(streams[0].subtitles[0].lang, 'en');
    assert.deepEqual(streams[0].intro, { start: 0, end: 90 });
    assert.deepEqual(streams[0].outro, { start: 1300, end: 1390 });
    assert.equal(requests.some((url) => url.pathname === '/filter' && url.searchParams.get('keyword') === 'Example Anime'), true);
  } finally {
    tmdb.getDetails = originalGetDetails;
    global.fetch = originalFetch;
    animeKai.resolveDirectM3u8 = originalResolver;
  }
});
