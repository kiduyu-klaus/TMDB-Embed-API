const test = require('node:test');
const assert = require('node:assert/strict');
const moviebox = require('../providers/moviebox');
const { getProvider } = require('../providers/registry');

test('registers MovieBox as an enabled MoviesTv provider', () => {
  const provider = getProvider('moviebox');
  assert.ok(provider);
  assert.equal(provider.category, 'MoviesTv');
  assert.equal(provider.enabled, true);
  assert.equal(typeof provider.fetch, 'function');
  assert.equal(typeof moviebox.getMovieboxStreams, 'function');
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
