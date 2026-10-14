const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetch: providerFetch } = require('../utils/providerFetch');

test('provider fetch applies a 30-second deadline and preserves caller cancellation', async t => {
  const deadline = new AbortController();
  const caller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', ms => {
    assert.equal(ms, 30000);
    return deadline.signal;
  });
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    forwarded = options;
    return new Response('ok');
  });
  await providerFetch('https://example.com', { signal: caller.signal, headers: { Accept: 'text/plain' } });
  assert.equal(forwarded.headers.Accept, 'text/plain');
  caller.abort();
  assert.equal(forwarded.signal.aborted, true);
  await providerFetch('https://example.com');
  deadline.abort();
  assert.equal(forwarded.signal.aborted, true);
});

test('Vidlink returns the complete direct DASH URL with signed cookies and subtitles', async t => {
  const playlist = 'https://cdn.example/dash/index.mpd?signature=complete&expires=123';
  t.mock.method(globalThis, 'fetch', async url => {
    const body = url.includes('themoviedb') ? { title: 'Example', release_date: '2020-01-01' }
      : url.includes('enc-dec') ? { result: 'encrypted' }
        : { stream: { playlist, requiresProxy: true, playlistHeaders: { cookie: 'signed-cookie', Referer: 'https://required.example/' }, captions: [{ url: 'https://cdn.example/en.vtt', language: 'English' }] } };
    return new Response(JSON.stringify(body));
  });
  const { getVidlinkStreams } = require('../providers/vidlink');
  const [stream] = await getVidlinkStreams(550, 'movie');
  assert.equal(stream.url, playlist);
  assert.equal(stream.headers.cookie, 'signed-cookie');
  assert.equal(stream.headers.Referer, 'https://required.example/');
  assert.equal(stream.mimeType, 'application/dash+xml');
  assert.equal(stream.format, 'dash');
  assert.equal(stream.subtitles.length, 1);
});
