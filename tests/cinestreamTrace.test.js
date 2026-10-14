const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCineStreamTrace } = require('../utils/cinestreamTrace');

function setup(transport) {
  const lines = [];
  const logger = { log: line => lines.push(line), warn: line => lines.push(line) };
  return { trace: createCineStreamTrace({ logger, transport }), lines };
}

test('parallel extractions retain their source and request correlation without logging secrets', async () => {
  const { trace, lines } = setup(async () => new Response('{"ok":true}', {
    headers: { server: 'cloudflare', 'cf-ray': 'test-ray', 'content-type': 'application/json' },
  }));
  await Promise.all(['Vidcore', 'Vidfast'].map(name => trace.run(() => trace.source(name, async () => {
    const response = await trace.fetch('https://example.com/private-token?signature=secret', {
      headers: { Authorization: 'Bearer credential', Cookie: 'session=private-cookie' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.bodyUsed, true);
    return [1];
  }))));
  const responses = lines.filter(line => line.includes('request.response')).map(line => JSON.parse(line.slice(line.indexOf('{'))));
  assert.equal(new Set(responses.map(event => event.extractionId)).size, 2);
  assert.deepEqual(responses.map(event => event.source).sort(), ['Vidcore', 'Vidfast']);
  for (const event of responses) {
    assert.equal(event.requestId, 1);
    assert.equal(event.origin, 'https://example.com');
    assert.equal(event.cfRay, 'test-ray');
  }
  assert.doesNotMatch(lines.join('\n'), /private-token|signature|secret|credential|private-cookie/);
});

test('HTTP and parsing failures are recorded without response bodies', async () => {
  const { trace, lines } = setup(async () => new Response('sensitive error body', {
    status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' },
  }));
  await assert.rejects(trace.run(() => trace.source('Vidcore', async () => {
    const response = await trace.fetch('https://example.com/');
    await response.json();
  })), SyntaxError);
  const output = lines.join('\n');
  assert.match(output, /"status":403/);
  assert.match(output, /"cfMitigated":"challenge"/);
  assert.match(output, /response.parse_failed/);
  assert.match(output, /source.failed/);
  assert.match(output, /trace.end/);
  assert.doesNotMatch(output, /sensitive error body/);
});

test('network errors preserve the original exception but redact its message', async () => {
  const error = new Error('failed https://example.com/?token=private');
  const { trace, lines } = setup(async () => { throw error; });
  await assert.rejects(trace.run(() => trace.fetch('https://example.com/')), e => e === error);
  assert.match(lines.join('\n'), /NETWORK_ERROR/);
  assert.doesNotMatch(lines.join('\n'), /token=private/);
});
