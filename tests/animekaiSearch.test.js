const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const axios = require('axios');
const {
  parseAnimeKaiSearchResults,
  getAnimekaiStreams,
  resolveDirectM3u8,
  buildAnimeSearchQuery,
  matchAnimeSearchResults,
  findEpisodeUrl,
  extractAnimeKaiServerOptions
} = require('../providers/animekai');
const { getSeasonDetails } = require('../utils/tmdb');
const tmdb = require('../utils/tmdb');

test('TMDB utility exports the season-details helper required by AnimeKai', () => {
  assert.equal(typeof getSeasonDetails, 'function');
});

test('parses AnimeKai .aitem cards and title anchors from current search markup', () => {
  const html = `
    <div class="ak-main">
      <div class="aitem-wrapper regular ak-grid">
        <div class="aitem"><div class="inner">
          <a class="title" href="https://animekai.com.ro/demon-slayer-infinity-castle-episode-1/"
             title="Demon Slayer: Kimetsu no Yaiba Infinity Castle"
             data-jp="Kimetsu no Yaiba Movie: Mugen Jou-hen"
             data-en="Demon Slayer: Kimetsu no Yaiba Infinity Castle">Demon Slayer: Kimetsu no Yaiba Infinity Castle</a>
          <div class="info"><span><b>Movie</b></span></div>
        </div></div>
        <div class="aitem"><div class="inner">
          <a href="https://animekai.com.ro/demon-slayer-swordsmith-village-arc/"
             data-en="Demon Slayer: Kimetsu no Yaiba Swordsmith Village Arc"
             class="title" title="Demon Slayer: Kimetsu no Yaiba Swordsmith Village Arc">Swordsmith Village Arc</a>
          <div class="info"><span><b>TV</b></span></div>
        </div></div>
      </div>
    </div>`;

  const results = parseAnimeKaiSearchResults(html);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    href: 'https://animekai.com.ro/demon-slayer-infinity-castle-episode-1/',
    title: 'Demon Slayer: Kimetsu no Yaiba Infinity Castle',
    type: 'movie'
  });
  assert.deepEqual(results[1], {
    href: 'https://animekai.com.ro/demon-slayer-swordsmith-village-arc/',
    title: 'Demon Slayer: Kimetsu no Yaiba Swordsmith Village Arc',
    type: 'tv'
  });
});

test('resolves relative AnimeKai result links against the configured site base', () => {
  const results = parseAnimeKaiSearchResults('<div class="aitem"><a class="title" href="/series/test" data-en="Test"></a></div>');
  assert.equal(results[0].href, 'https://animekai.com.ro/series/test');
});

test('adds a season suffix to AnimeKai search only for season 2 and later', () => {
  const title = 'That Time I Got Reincarnated as a Slime';
  assert.equal(buildAnimeSearchQuery(title, 1), title);
  assert.equal(buildAnimeSearchQuery(title, 2), `${title} season 2`);
});

test('matches every Dub/Sub result for the requested season and excludes other seasons', () => {
  const title = 'That Time I Got Reincarnated as a Slime';
  const results = [
    { title: `${title} Season 1 (Sub)`, type: 'tv' },
    { title: `${title} Season 2 (Dub)`, type: 'tv' },
    { title: `${title} Season 2 (Sub)`, type: 'tv' },
    { title: `${title} Season 3 (Dub)`, type: 'tv' },
    { title: `${title} Season 2 Movie`, type: 'movie' }
  ];

  assert.deepEqual(matchAnimeSearchResults(results, title, 1).map((item) => item.title), [results[0].title]);
  assert.deepEqual(matchAnimeSearchResults(results, title, 2).map((item) => item.title), [results[1].title, results[2].title]);
});

test('selects the requested episode and decodes every AnimeKai server button', () => {
  const episodeHtml = '<a href="/series/test-episode-4/"><div class="epl-num">4</div></a>';
  assert.equal(findEpisodeUrl(episodeHtml, 4, 'https://animekai.com.ro/series/test/'), 'https://animekai.com.ro/series/test-episode-4/');

  const servers = [
    ['Server -1', 'https://gogoanime.me/newplayer.php?mal_id=59970&ep=23&category=sub', 'Sub'],
    ['Vidstream-2', 'https://megaplay.buzz/stream/s-2/783027/sub', 'Sub'],
    ['Vidstream-1 beta', 'https://megaplay.buzz/videojs/stream/s-2/783027/sub', 'Sub'],
    ['HD-2', 'https://megaplay.buzz/stream/s-2/783027/sub?s=bcdn', 'Sub']
  ];
  const buttons = servers.map(([name, url, lang]) => {
    const dataValue = Buffer.from(`<iframe src="${url}" title="${name}"></iframe>`).toString('base64');
    return `<button class="ak-srv-btn" data-value="${dataValue}" data-lang="${lang}">${name}</button>`;
  }).join('');
  const parsed = extractAnimeKaiServerOptions(`<div class="ak-srv-links">${buttons}</div>`);

  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed.map((server) => server.name), servers.map(([name]) => name));
  assert.deepEqual(parsed.map((server) => server.url), servers.map(([, url]) => url));
  assert.ok(parsed.every((server) => server.language === 'Sub'));
});

test('fetches every matching season-2 result and returns every server in parallel', async () => {
  const title = 'That Time I Got Reincarnated as a Slime';
  const searchHtml = [
    ['slime-season-2-sub', `${title} Season 2 (Sub)`],
    ['slime-season-2-dub', `${title} Season 2 (Dub)`]
  ].map(([slug, resultTitle]) => `<div class="aitem"><a class="title" href="/series/${slug}/" data-en="${resultTitle}" title="${resultTitle}">${resultTitle}</a><div class="info"><b>TV</b></div></div>`).join('');
  const servers = ['Server -1', 'Vidstream-2', 'Vidstream-1 beta', 'HD-2'];
  const encryptSource = (file) => {
    const key = Buffer.alloc(32);
    Buffer.from('i?LMTAx0Q6,:}50U').copy(key);
    const iv = Buffer.alloc(16);
    Buffer.from("W0;27ToaUpl_P%'c").copy(iv);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([cipher.update(JSON.stringify({ file })), cipher.final()])
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const captionTracks = [
    { file: 'https://subs.example/en.vtt?sig=one', label: 'English', kind: 'captions' },
    { file: 'https://subs.example/fr.vtt?sig=two', label: 'French (- Francais(France))', kind: 'captions' },
    { file: 'https://audio.example/audio.mp3', label: 'Audio', kind: 'audio' }
  ];
  const buildEpisodeHtml = (variant) => {
    const serverButtons = servers.map((name, index) => {
      const serverUrl = index === 0
        ? `https://megaplay.buzz/stream/s-2/9298/${variant}`
        : `https://player.example/embed/${variant}-server-${index}`;
      const dataValue = Buffer.from(`<iframe src="${serverUrl}" title="${name}"></iframe>`).toString('base64');
      return `<button class="ak-srv-btn" data-value="${dataValue}" data-lang="Sub">${name}</button>`;
    }).join('');
    return `<div class="ak-srv-links">${serverButtons}</div>`;
  };
  const originalGet = axios.get;
  const originalDetails = tmdb.getDetails;
  const originalSeasonDetails = tmdb.getSeasonDetails;
  let searchQuery;
  let activeSeriesRequests = 0;
  let maxConcurrentSeriesRequests = 0;

  tmdb.getDetails = async (type, id) => {
    assert.equal(type, 'tv');
    assert.equal(id, '82684');
    return { name: title };
  };
  tmdb.getSeasonDetails = async () => ({ name: 'Season 2', episodes: [] });
  axios.get = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/') {
      searchQuery = parsed.searchParams.get('s');
      return { data: searchHtml, status: 200 };
    }
    if (parsed.hostname === 'animekai.com.ro' && parsed.pathname.startsWith('/series/')) {
      activeSeriesRequests += 1;
      maxConcurrentSeriesRequests = Math.max(maxConcurrentSeriesRequests, activeSeriesRequests);
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeSeriesRequests -= 1;
      const slug = parsed.pathname.split('/').filter(Boolean)[1];
      return { data: `<a href="/episodes/${slug}-episode-4/"><div class="epl-num">4</div></a>`, status: 200 };
    }
    if (parsed.hostname === 'animekai.com.ro' && parsed.pathname.startsWith('/episodes/')) {
      return { data: buildEpisodeHtml(parsed.pathname.includes('-dub-') ? 'dub' : 'sub'), status: 200 };
    }
    if (parsed.hostname === 'megaplay.buzz' && parsed.pathname.startsWith('/stream/s-2/')) {
      const fileId = parsed.pathname.endsWith('/dub') ? '140719' : '140718';
      return { data: `<html><head><title>File ${fileId} - MegaPlay</title></head></html>`, status: 200 };
    }
    if (parsed.hostname === 'player.example') {
      const streamId = parsed.pathname.split('/').pop();
      return { data: `jwplayer('player').setup({ file: 'https://cdn.example/${streamId}.m3u8', type: 'hls' });`, status: 200 };
    }
    if (parsed.hostname === 'megaplay.buzz' && parsed.pathname === '/stream/getSources') {
      const fileId = parsed.searchParams.get('id');
      return {
        data: {
          tracks: captionTracks,
          intro: { start: 0, end: 88 },
          outro: { start: 1326, end: 1414 },
          enc: encryptSource(`https://cdn.example/${fileId}.m3u8`)
        },
        status: 200
      };
    }
    throw new Error(`Unexpected mocked request: ${parsed.origin}${parsed.pathname}`);
  };

  try {
    const streams = await getAnimekaiStreams('82684', 'anime', 2, 4);
    assert.equal(searchQuery, `${title} season 2`);
    assert.equal(maxConcurrentSeriesRequests, 2, 'matching Dub/Sub result pages should be fetched concurrently');
    assert.equal(streams.length, 8, 'both matching results should contribute all four server streams');
    assert.ok(streams.some((stream) => stream.name.includes('(Sub)')));
    assert.ok(streams.some((stream) => stream.name.includes('(Dub)')));
    assert.equal(new Set(streams.map((stream) => stream.url)).size, 8);
    const metadataStream = streams.find((stream) => stream.intro && stream.outro);
    assert.ok(metadataStream, 'the MegaPlay stream should include intro/outro metadata');
    assert.deepEqual(metadataStream.intro, { start: 0, end: 88 });
    assert.deepEqual(metadataStream.outro, { start: 1326, end: 1414 });
    assert.equal(metadataStream.subtitles.length, 2, 'caption tracks should be included and audio tracks excluded');
    assert.deepEqual(metadataStream.subtitles[0], {
      id: 'animekai-0-en',
      url: 'https://subs.example/en.vtt?sig=one',
      lang: 'en',
      label: 'English',
      mimeType: 'text/vtt',
      language: 'en',
      headers: {
        Referer: 'https://megaplay.buzz/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      }
    });
    assert.equal(metadataStream.subtitles[1].lang, 'fr');
  } finally {
    axios.get = originalGet;
    tmdb.getDetails = originalDetails;
    tmdb.getSeasonDetails = originalSeasonDetails;
  }
});

test('resolves MegaPlay JWPlayer file URLs without requiring a numeric file ID', async () => {
  const playerUrl = 'https://megaplay.su/embed.php?sid=test-sid-value';
  const mediaUrl = 'https://megaplay.su/uploads/hls/test-sid-value/index.m3u8?v=123';
  const html = `<!doctype html><html><head><title>MegaPlay Player</title></head><body>
    <div id="player-container"></div>
    <script>jwplayer("player-container").setup({ file: "${mediaUrl}", type: "hls" });</script>
  </body></html>`;
  const originalGet = axios.get;
  let requests = 0;

  axios.get = async () => {
    requests += 1;
    return { data: html, status: 200 };
  };

  try {
    const result = await resolveDirectM3u8(playerUrl);
    assert.deepEqual(result, { url: mediaUrl, referer: playerUrl });
    assert.equal(requests, 1, 'direct JWPlayer URL should avoid the legacy getSources request');
  } finally {
    axios.get = originalGet;
  }
});

test('follows the supplied GoGoAnime wrapper and decrypts MegaPlay enc sources', async () => {
  const gogoUrl = 'https://gogoanime.me.uk/newplayer.php?mal_id=59970&ep=23&category=sub';
  const megaUrl = 'https://megaplay.buzz/stream/mal/59970/23/sub?autostart=true';
  const mediaUrl = 'https://cdn.example/anime/test/master.m3u8';
  const key = Buffer.alloc(32);
  Buffer.from('i?LMTAx0Q6,:}50U').copy(key);
  const iv = Buffer.alloc(16);
  Buffer.from("W0;27ToaUpl_P%'c").copy(iv);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ file: mediaUrl })),
    cipher.final()
  ]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const originalGet = axios.get;
  const requestedUrls = [];

  axios.get = async (url) => {
    requestedUrls.push(url);
    if (url === gogoUrl) {
      return { data: `<html><title>MAL #59970 - Episode 23</title><iframe src="${megaUrl}"></iframe></html>`, status: 200 };
    }
    if (url === megaUrl) {
      return { data: '<html><head><title>File 140718 - MegaPlay</title></head><body>Player</body></html>', status: 200 };
    }
    if (url === 'https://megaplay.buzz/stream/getSources?id=140718') {
      return { data: { tracks: [], t: 1, server: 4, enc: encrypted }, status: 200 };
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };

  try {
    const result = await resolveDirectM3u8(gogoUrl);
    assert.deepEqual(result, { url: mediaUrl, referer: megaUrl });
    assert.deepEqual(requestedUrls, [
      gogoUrl,
      megaUrl,
      'https://megaplay.buzz/stream/getSources?id=140718'
    ]);
  } finally {
    axios.get = originalGet;
  }
});
