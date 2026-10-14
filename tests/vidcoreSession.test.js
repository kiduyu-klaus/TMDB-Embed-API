const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Response } = require('node-fetch');
const { createVidcoreSession } = require('../utils/vidcoreSession');
const silent = { log() {}, warn() {} };

test('session retains page cookies with CSRF and isolates concurrent extractions', async () => {
  function session(value) {
    return createVidcoreSession({ logger: silent, fetch: async (url, options) => {
      if (url.endsWith('/page')) return new Response('', { headers: {
        'set-cookie': `session=${value}; Path=/api; Secure; HttpOnly`,
      } });
      assert.equal(options.headers.get('cookie'), url.includes('/api/') ? `session=${value}` : null);
      assert.equal(options.headers.get('x-csrf-token'), 'csrf-value');
      return new Response('ok');
    } });
  }
  await Promise.all(['one', 'two'].map(async value => {
    const request = session(value);
    await request('https://vidcore.io/page');
    await Promise.all(['/api/server1', '/api/server2', '/other'].map(path =>
      request('https://vidcore.io' + path, { headers: { 'X-CSRF-Token': 'csrf-value' } })));
  }));
});

test('redirect cookies are retained but credentials do not cross origins', async () => {
  let calls = 0;
  const request = createVidcoreSession({ logger: silent, fetch: async (url, options) => {
    calls++;
    if (calls === 1) return new Response('', { status: 302, headers: {
      location: '/next', 'set-cookie': 'session=secret; Path=/; Secure',
    } });
    if (calls === 2) {
      assert.equal(options.headers.get('cookie'), 'session=secret');
      assert.equal(options.headers.get('x-csrf-token'), 'csrf');
      return new Response('', { status: 307, headers: { location: 'https://enc-dec.app/final' } });
    }
    assert.equal(options.headers.get('cookie'), null);
    assert.equal(options.headers.get('authorization'), null);
    assert.equal(options.headers.get('x-csrf-token'), null);
    return new Response('ok');
  } });
  await request('https://vidcore.io/start', { headers: { authorization: 'Bearer secret', 'X-CSRF-Token': 'csrf' } });
  assert.equal(calls, 3);
});

test('403 diagnostics include stage and allowlisted headers, not secrets or signed paths', async () => {
  const logs = [];
  const request = createVidcoreSession({ logger: { log: v => logs.push(v), warn: v => logs.push(v) },
    fetch: async () => new Response('body-secret', { status: 403, headers: {
      server: 'cloudflare', 'cf-ray': 'ray-id', 'cf-mitigated': 'challenge',
      'content-type': 'text/html', 'set-cookie': 'session=cookie-secret; Path=/',
    } }),
  });
  await request('https://vidcore.io/path-secret?token=query-secret', {
    headers: { authorization: 'Bearer auth-secret', 'X-CSRF-Token': 'csrf-secret' },
  }, 'Stage 1 Vidcore handoff');
  const output = logs.join('\n');
  for (const text of ['Stage 1 Vidcore handoff', '403', 'cloudflare', 'ray-id', 'challenge', 'text/html']) assert.ok(output.includes(text));
  assert.doesNotMatch(output, /body-secret|cookie-secret|path-secret|query-secret|auth-secret|csrf-secret/);
});

test('network exceptions never expose original URL or response data', async () => {
  const logs = [];
  const request = createVidcoreSession({ logger: { log: v => logs.push(v), warn: v => logs.push(v) },
    fetch: async () => { throw new Error('https://vidcore.io/private-token?secret=value'); },
  });
  await assert.rejects(request('https://vidcore.io/private-token?secret=value'), error => {
    assert.doesNotMatch(error.message, /private-token|secret=value/);
    return true;
  });
  assert.doesNotMatch(logs.join('\n'), /private-token|secret=value/);
});
