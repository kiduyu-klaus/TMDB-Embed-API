const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCipheriv } = require('node:crypto');
const { _test } = require('../providers/onetouchtv');

test('rejects the unrelated Breaking Bad Fortune Teller result', () => {
  const wrong = { title: 'Breaking Bad Fortune Teller (2016)', year: '2016', type: 'drama' };
  assert.equal(_test.findBestOttMatch([wrong], 'Breaking Bad', '2008', 'series', 1), null);
  const right = { title: 'Breaking Bad (2008)', year: '2008', type: 'drama' };
  assert.equal(_test.findBestOttMatch([wrong, right], 'Breaking Bad', '2008', 'series', 1), right);
});

test('preserves upstream cookies and case-insensitive playback header overrides', () => {
  const headers = _test.playbackHeaders({ cookie: 'signed-cookie', referer: 'https://cdn.example/', 'user-agent': 'upstream' });
  assert.equal(headers.cookie, 'signed-cookie');
  assert.equal(headers.referer, 'https://cdn.example/');
  assert.equal(headers.Referer, undefined);
  assert.equal(headers['user-agent'], 'upstream');
  assert.equal(headers.Origin, 'https://onetouchtv.xyz');
});

test('uses the web episode endpoint and validates locally decrypted responses', async t => {
  let payload = { success: true, status: 'success', code: 200, result: { sources: [] } };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).pathname, '/web/vod/example/episode/1');
    assert.equal(options.headers.Origin, 'https://onetouchtv.xyz');
    const cipher = createCipheriv('aes-256-cbc', Buffer.from('im72charPasswordofdInitVectorStm'), Buffer.from('im72charPassword'));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]).toString('base64').replace(/\//g, '-_.').replace(/\+/g, '@');
    return new Response(encrypted);
  });
  assert.deepEqual(await _test.getEpisodeStreams('example', 1), { sources: [] });
  payload = { success: false, code: 403, result: null };
  await assert.rejects(_test.fetchEncryptedOnce('https://api3.devcorp.me/web/vod/example/episode/1'), /unsuccessful/);
});
