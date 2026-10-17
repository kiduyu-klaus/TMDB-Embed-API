const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createErrorPages } = require('../utils/errorPages');

test('universal errors preserve status, mounted asset paths, and API JSON', async t => {
  const app = express();
  const errors = createErrorPages('/kiduyuTv_providers');
  app.use(errors.middleware);
  app.use(express.json());
  const router = express.Router();
  router.get('/fail', () => { throw new Error('private-secret-stack'); });
  router.get('/forbidden', (_req, res) => res.status(403).json({ error: 'PRIVATE' }));
  router.get('/api/fail', () => { throw new Error('private-secret-stack'); });
  router.get('/auth/session', (_req, res) => res.status(401).json({ error: 'AUTH_REQUIRED' }));
  app.use('/kiduyuTv_providers', router);
  app.use(errors.notFound);
  app.use(errors.onError);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/kiduyuTv_providers`;
  for (const [route, status] of [['/missing/deep', 404], ['/fail', 500], ['/forbidden', 403]]) {
    const res = await fetch(base + route, { headers: { Accept: 'text/html' } });
    const body = await res.text();
    assert.equal(res.status, status);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(body, /KiduyuTvProviders/);
    assert.match(body, /href="\/kiduyuTv_providers\/favicon.ico"/);
    assert.doesNotMatch(body, /private-secret-stack|Cannot GET|\{\{STATUS\}\}/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  for (const [route, status, error] of [['/api/missing', 404, 'NOT_FOUND'], ['/api/fail', 500, 'INTERNAL_ERROR'], ['/auth/session', 401, 'AUTH_REQUIRED']]) {
    const res = await fetch(base + route, { headers: { Accept: 'text/html' } });
    assert.equal(res.status, status);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).error, error);
  }
  const malformed = await fetch(base + '/api/missing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'REQUEST_ERROR');
});
