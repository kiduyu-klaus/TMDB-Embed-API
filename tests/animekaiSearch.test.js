const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { parseAnimeKaiSearchResults, resolveDirectM3u8 } = require('../providers/animekai');
const { getSeasonDetails } = require('../utils/tmdb');

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
