const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStreams } = require('../utils/streamResponse');
const { processStreamsForProxy } = require('../proxy/proxyServer');

test('preserves supplied stream fields and headers while completing the schema', () => {
  const headers = Object.freeze({ 'User-Agent': 'fixture', Referer: 'https://player.example/', Origin: 'https://player.example', Accept: '*/*' });
  const original = Object.freeze({ name: 'Example Server', title: 'Example - English',
    url: 'https://cdn.example/master.m3u8?token=signed', quality: 'English', provider: 'Example', headers });
  const [stream] = normalizeStreams([original], 'example');
  assert.deepEqual(stream, { ...original, format: 'hls', mimeType: 'application/vnd.apple.mpegurl', subtitles: [] });
  assert.equal(stream.headers, headers);
});

test('uses format metadata for opaque URLs and recognizes direct file types', () => {
  const cases = [
    [{ url: 'https://cdn.example/api?d=opaque', format: 'HLS' }, 'hls', 'application/vnd.apple.mpegurl'],
    [{ url: 'https://cdn.example/api', mimeType: 'video/mp4' }, 'mp4', 'video/mp4'],
    [{ url: 'https://cdn.example/a.MKV?token=1' }, 'mkv', 'video/x-matroska'],
    [{ url: 'https://cdn.example/a.webm' }, 'webm', 'video/webm'],
    [{ url: 'https://cdn.example/a.mpd' }, 'dash', 'application/dash+xml'],
    [{ url: 'https://cdn.example/api?d=opaque' }, 'unknown', 'application/octet-stream'],
  ];
  for (const [input, format, mimeType] of cases) {
    const [stream] = normalizeStreams([input]);
    assert.equal(stream.format, format);
    assert.equal(stream.mimeType, mimeType);
  }
});

test('fills subtitle fields, preserves URLs and explicit headers, and inherits only missing headers', () => {
  const headers = { Referer: 'https://player.example/', 'User-Agent': 'fixture' };
  const subtitleHeaders = { Referer: 'https://subs.example/' };
  const url = 'https://proxy.example/api?url=' + encodeURIComponent('https://subs.example/en.srt?Signature=a%2Fb');
  const [stream] = normalizeStreams([{ url: 'https://cdn.example/a.mp4', headers, subtitles: [
    { id: 'netflix-0-en', url, lang: 'en', label: 'English' },
    { url: 'https://subs.example/ar', lang: 'ar', label: 'العربية', mimeType: 'text/vtt', headers: subtitleHeaders },
  ] }], 'netmirror');
  assert.deepEqual(stream.subtitles[0], { id: 'netflix-0-en', url, lang: 'en', label: 'English',
    language: 'en', mimeType: 'application/x-subrip', headers });
  assert.equal(stream.subtitles[1].headers, subtitleHeaders);
  assert.equal(stream.subtitles[1].mimeType, 'text/vtt');
  assert.equal(stream.subtitles[1].language, 'ar');
});

test('normalizes mixed providers and rejects malformed entries', () => {
  const streams = normalizeStreams([null, {}, { url: 123 },
    { url: 'https://cdn.example/a.mp4', quality: 1080 },
    { url: 'https://cdn.example/b.m3u8', provider: 'Other', subtitles: null }], 'fixture');
  assert.equal(streams.length, 2);
  assert.equal(streams[0].quality, '1080');
  assert.equal(streams[0].provider, 'fixture');
  assert.equal(streams[1].provider, 'Other');
  assert.deepEqual(streams[1].headers, {});
  assert.deepEqual(streams[1].subtitles, []);
});

test('proxy mode preserves response metadata and headers, including extensionless MP4', () => {
  const streams = normalizeStreams([{ url: 'https://cdn.example/api?id=1', format: 'mp4',
    headers: { Referer: 'https://player.example/' }, subtitles: [{ url: 'https://subs.example/en.vtt', lang: 'en' }] }], 'fixture');
  const [proxied] = processStreamsForProxy(streams, 'http://localhost:8787/mount');
  assert.equal(new URL(proxied.url).pathname, '/mount/ts-proxy');
  assert.deepEqual(proxied.headers, streams[0].headers);
  assert.deepEqual(proxied.subtitles, streams[0].subtitles);
  assert.equal(proxied.mimeType, 'video/mp4');
  assert.equal(streams[0].url, 'https://cdn.example/api?id=1');
});
