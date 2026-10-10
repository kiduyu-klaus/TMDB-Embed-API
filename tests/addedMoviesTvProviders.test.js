const test = require('node:test');
const assert = require('node:assert/strict');

const exportsByProvider = {
  superstream: 'getSuperstreamStreams',
  hdmovie2: 'getHdmovie2Streams',
  vidbox: 'getVidboxStreams',
  vidrock: 'getVidrockStreams',
  vidcore: 'getVidcoreStreams',
  moviesdrive1: 'getMoviesDriveStreams'
};

test('new MoviesTv providers load and receive movie and TV requests through the registry', async t => {
  t.mock.method(require('../utils/wyzieSubtitles'), 'addFallbackSubtitles', async streams => streams);
  t.mock.method(require('../utils/opensubtitles'), 'addOpenSubtitlesFallback', async streams => streams);
  const { getProvider, listProviders } = require('../providers/registry');

  for (const [name, exportName] of Object.entries(exportsByProvider)) {
    const implementation = require(`../providers/${name}`);
    assert.equal(typeof implementation[exportName], 'function', `${name} export loads`);
    const calls = [];
    t.mock.method(implementation, exportName, async (...args) => {
      calls.push(args);
      return [{ url: 'https://example.com/video.m3u8', quality: '1080p', headers: { Referer: 'https://example.com/' } }];
    });
    assert.equal(listProviders().find(p => p.name === name).category, 'MoviesTv');
    const provider = getProvider(name);
    for (const context of [
      { tmdbId: '278', type: 'movie' },
      { tmdbId: '1399', type: 'tv', season: 1, episode: 2 }
    ]) {
      const result = await provider.fetch(context);
      assert.equal(result.length, 1);
      assert.equal(result[0].provider, name);
      assert.equal(result[0].url, 'https://example.com/video.m3u8');
      assert.equal(result[0].headers.Referer, 'https://example.com/');
    }
    assert.deepEqual(calls, [['278', 'movie', null, null], ['1399', 'tv', 1, 2]]);
  }
});
