const { test } = require('node:test');
const assert = require('node:assert/strict');
const { playbackSource } = require('../providers/framextv');

test('FrameX proxy URLs become direct signed URLs with their playback headers', () => {
  const target = 'https://cdn.example/master.m3u8?signature=a%2Bb&expires=123';
  const params = new URLSearchParams({ url: target, referer: 'https://player.example/watch', origin: 'https://player.example' });
  const result = playbackSource({ url: 'https://api.framextv.tech/api/proxy?' + params });
  assert.equal(result.url, target);
  assert.equal(result.headers.Referer, 'https://player.example/watch');
  assert.equal(result.headers.Origin, 'https://player.example');
  assert.match(result.headers['User-Agent'], /Mozilla/);
});

test('explicit source headers override defaults case-insensitively and direct URLs stay intact', () => {
  const url = 'https://cdn.example/master.m3u8?url=https%3A%2F%2Fother.example';
  const result = playbackSource({ url, headers: { referer: 'https://source.example/', 'user-agent': 'source-agent' } }, { Referer: 'https://shared.example/', Cookie: 'required-cookie' });
  assert.equal(result.url, url);
  assert.equal(result.headers.referer, 'https://source.example/');
  assert.equal(result.headers.Referer, undefined);
  assert.equal(result.headers['user-agent'], 'source-agent');
  assert.equal(result.headers.Cookie, 'required-cookie');
});

test('malformed or non-HTTP proxy targets are rejected', () => {
  for (const target of ['', 'file:///secret', 'javascript:alert(1)']) {
    assert.throws(() => playbackSource({ url: 'https://api.framextv.tech/api/proxy?url=' + encodeURIComponent(target) }));
  }
});
