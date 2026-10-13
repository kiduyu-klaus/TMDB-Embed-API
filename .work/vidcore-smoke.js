const assert = require('assert');
const provider = require('../providers/vidcore');

assert.strictEqual(provider.buildPageUrl('1399', 'tv', 1, 1), 'https://vidcore.io/tv/1399/1/1/');
assert.strictEqual(provider.buildPageUrl('603', 'movie'), 'https://vidcore.io/movie/603');
const html = 'data \\\"en\\\":\\\"token-value\\\" end';
assert.strictEqual(provider.extractContentToken(html), 'token-value');
const streams = provider.normalizeStreams({ sources: [{ url: 'https://cdn.test/video.m3u8', quality: '1080p' }] }, 1);
assert.strictEqual(streams.length, 1);
assert.strictEqual(streams[0].provider, 'VidCore');
assert.strictEqual(streams[0].quality, '1080p');
console.log('VidCore helper checks passed');
