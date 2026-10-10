const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createCurlClient } = require('../utils/curlCffiClient');

test('native curl adapter preserves JSON, raw bytes, cookies, headers and HTTP errors', async t => {
    const logs = [];
    t.mock.method(console, 'log', line => logs.push(line));
    const server = http.createServer(async (req, res) => {
        if (req.url === '/bytes') { res.end(Buffer.from([0, 255, 128, 42])); return; }
        if (req.url === '/missing') { res.writeHead(404, { Server: 'fixture-edge', 'CF-Ray': 'fixture-ray' }); res.end('missing'); return; }
        let body = '';
        for await (const chunk of req) body += chunk;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Set-Cookie', 'session=fixture; Path=/');
        res.end(JSON.stringify({ url: req.url, body, csrf: req.headers['x-csrf-token'], cookie: req.headers.cookie }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = createCurlClient();
    t.after(() => { client.close(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const first = await client.get(base + '/', { params: { stage: 1, text: 'a+b&c' } });
    assert.equal(first.data.url, '/?stage=1&text=a%2Bb%26c');
    const next = await client.post(base + '/', { text: 'encrypted' }, { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'second' } });
    assert.equal(next.data.csrf, 'second');
    assert.equal(next.data.cookie, 'session=fixture');
    assert.deepEqual(JSON.parse(next.data.body), { text: 'encrypted' });
    assert.deepEqual((await client.get(base + '/bytes', { responseType: 'arraybuffer' })).data, Buffer.from([0, 255, 128, 42]));
    await assert.rejects(client.get(base + '/missing'), error => error.response.status === 404);
    assert.equal((await client.get(base + '/missing', { validateStatus: () => true })).status, 404);
    const output = logs.join('\n');
    for (const event of ['native.init.start', 'session.open', 'request.start', 'request.response', 'request.failed']) assert.ok(output.includes(event), event);
    assert.ok(!output.includes('encrypted'));
    assert.ok(!output.includes('session=fixture'));
    assert.ok(!output.includes('a%2Bb'));
    assert.ok(output.includes('"server":"fixture-edge"'));
    assert.ok(output.includes('"cfRay":"fixture-ray"'));
});
