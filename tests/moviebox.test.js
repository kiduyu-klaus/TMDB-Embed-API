const test = require('node:test');
const assert = require('node:assert/strict');
const moviebox = require('../providers/moviebox');
const { getProvider } = require('../providers/registry');

test('registers MovieBox as an enabled MoviesTv provider', () => {
  const provider = getProvider('moviebox');
  assert.ok(provider);
  assert.equal(provider.category, 'MoviesTv');
  assert.deepEqual(provider.categories, ['MoviesTv', 'Anime']);
  assert.equal(provider.enabled, true);
  assert.equal(typeof provider.fetch, 'function');
  assert.equal(typeof moviebox.getMovieboxStreams, 'function');
});

test('anime episodes use TMDB TV metadata and anime movies use movie metadata', async () => {
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const { createRequire } = require('module');
  const file = path.join(__dirname, '../providers/moviebox.js');
  const localRequire = createRequire(file);
  const requested = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, process: { env: {} }, setTimeout, clearTimeout, AbortController,
    console: { log() {}, warn() {}, error() {} },
    fetch: async url => {
      requested.push(new URL(url).pathname);
      // Empty metadata stops extraction before any external provider calls.
      return { ok: true, json: async () => ({}) };
    },
    require(name) {
      return name === '../utils/tmdbKey' ? { getTmdbApiKey: () => 'fixture-key' } : localRequire(name);
    }
  });
  await module.exports.getMovieboxStreams('82684', 'anime', 1, 1);
  await module.exports.getMovieboxStreams('1363974', 'anime');
  assert.deepEqual(requested, ['/3/tv/82684', '/3/movie/1363974']);
});

test('normalizes titles and chooses an exact movie/year match of the requested type', () => {
  assert.equal(moviebox.normalizeTitle('The Example Movie (2024) [4K] Dub'), 'the example movie');
  const subjects = [
    { subjectId: 'tv', subjectType: 2, title: 'The Example Movie', year: '2024' },
    { subjectId: 'older', subjectType: 1, title: 'The Example Movie', year: '2020' },
    { subjectId: 'correct', subjectType: 1, title: 'The Example Movie', year: '2024' }
  ];
  const match = moviebox.findBestMatch(subjects, {
    title: 'The Example Movie', originalTitle: 'The Example Movie', year: '2024'
  }, 'movie');
  assert.equal(match.subjectId, 'correct');
  assert.equal(moviebox.findBestMatch(subjects, { title: 'The Example Movie', year: '2024' }, 'tv').subjectId, 'tv');
});

test('extracts quality, format, and stream entries from MovieBox response shapes', () => {
  assert.equal(moviebox.formatQuality('1920x1080'), '1080p');
  assert.deepEqual(moviebox.getFormat('https://cdn.example/manifest.mpd?token=x'), {
    type: 'dash', label: 'DASH', mimeType: 'application/dash+xml'
  });
  assert.deepEqual(moviebox.getFormat('https://cdn.example/video.m3u8'), {
    type: 'hls', label: 'HLS', mimeType: 'application/vnd.apple.mpegurl'
  });
  assert.deepEqual(moviebox.collectRawStreams({ resourceDetectors: [
    { resolutionList: [{ resourceLink: 'https://cdn.example/1080.m3u8', resolution: '1080p', id: 7 }] }
  ] }), [{ url: 'https://cdn.example/1080.m3u8', quality: '1080p', id: 7 }]);
});
