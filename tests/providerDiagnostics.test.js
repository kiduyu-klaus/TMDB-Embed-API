const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiagnosticLogger } = require('../utils/providerDiagnostics');

test('diagnostics retain useful context without exposing request credentials', t => {
    const lines = [];
    t.mock.method(console, 'log', line => lines.push(line));
    createDiagnosticLogger('Vidup')('request.failed', {
        url: 'https://user:pass@example.com/stream?token=private-signed-token',
        message: 'Failure at https://example.com/api?api_key=private-key',
        token: 'private-csrf', headers: { Cookie: 'private-cookie' },
        status: 403, elapsedMs: 100
    });
    assert.match(lines[0], /Vidup-\d+/);
    assert.match(lines[0], /"status":403/);
    assert.match(lines[0], /"elapsedMs":100/);
    assert.ok(!/private-|user:pass/.test(lines[0]));
});
