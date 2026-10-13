import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const env = { BACKEND_URL: 'https://backend.example/kiduyuTv_providers' };
const url = 'https://app.example/kiduyuTv_providers';

test('missing, recursive and mismatched backends fail closed', async () => {
  for (const BACKEND_URL of [undefined, url, 'https://backend.example/other']) {
    const response = await worker.fetch(new Request(url + '/api/health'), { BACKEND_URL });
    assert.equal(response.status, 503);
  }
});

test('root redirects to application and unrelated paths are rejected', async () => {
  const response = await worker.fetch(new Request('https://app.example/'), env);
  assert.equal(response.headers.get('location'), url + '/');
  assert.equal((await worker.fetch(new Request('https://app.example/unknown'), env)).status, 404);
});

test('forwards login body and cookies, rewrites redirects and preserves separate cookies', async (t) => {
  t.mock.method(globalThis, 'fetch', async (target, init) => {
    assert.equal(target.href, env.BACKEND_URL + '/auth/login?x=1');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.get('cookie'), 'session=old');
    assert.equal(init.headers.get('x-forwarded-host'), 'app.example');
    assert.equal(await new Response(init.body).text(), '{"username":"test"}');
    const headers = new Headers({ location: env.BACKEND_URL + '/config.html' });
    headers.append('set-cookie', 'session=new; Domain=backend.example; Path=/; HttpOnly');
    headers.append('set-cookie', 'other=1; Path=/');
    return new Response(null, { status: 302, headers });
  });
  const response = await worker.fetch(new Request(url + '/auth/login?x=1', {
    method: 'POST', body: '{"username":"test"}', headers: { cookie: 'session=old' }
  }), env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), url + '/config.html');
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.doesNotMatch(response.headers.get('set-cookie'), /Domain=/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('preserves partial media responses and backend errors', async (t) => {
  for (const status of [206, 401, 500]) {
    t.mock.method(globalThis, 'fetch', async (target, init) => {
      assert.equal(init.headers.get('range'), 'bytes=0-3');
      return new Response('data', { status, headers: { 'content-range': 'bytes 0-3/100' } });
    });
    const response = await worker.fetch(new Request(url + '/api/streams/movie/1', {
      headers: { range: 'bytes=0-3' }
    }), env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-range'), 'bytes 0-3/100');
    assert.equal(await response.text(), 'data');
  }
});

test('network failure returns a JSON gateway error without credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('secret-token'); });
  const response = await worker.fetch(new Request(url + '/api/health'), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'BACKEND_UNREACHABLE');
});
