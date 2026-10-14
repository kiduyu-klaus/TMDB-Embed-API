const assert = require('assert');
const provider = require('../providers/vidcore');

assert.strictEqual(provider.buildPageUrl('1399', 'tv', 1, 1), 'https://vidcore.io/tv/1399/1/1/');
assert.strictEqual(provider.buildPageUrl('603', 'movie'), 'https://vidcore.io/movie/603/');
assert.strictEqual(provider.extractToken('data \\\"en\\\":\\\"token-value\\\" end'), 'token-value');
const streams = provider.normalizeStreams({ sources: [{ url: 'https://cdn.test/video.m3u8', quality: '1080p' }] }, 'Test');
assert.strictEqual(streams.length, 1);
assert.strictEqual(streams[0].provider, 'vidcore');
assert.strictEqual(streams[0].quality, '1080p');
assert.strictEqual(provider.isChallengeResponse(403, 'Forbidden'), true);
assert.strictEqual(provider.isChallengeResponse(200, 'Just a moment, checking your browser'), true);
assert.strictEqual(provider.isChallengeResponse(200, 'normal page'), false);
console.log('VidCore helper and 403 classification checks passed');
