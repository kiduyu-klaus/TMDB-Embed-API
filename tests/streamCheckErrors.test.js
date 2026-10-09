const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
const start = source.indexOf('async function readStreamCheckResponse(');
const end = source.indexOf('async function runProviderFunctionalChecks(', start);
const readResponse = vm.runInNewContext(`(${source.slice(start, end).trim()})`);

test('provider checks display the API error message for HTTP 500', async () => {
    await assert.rejects(readResponse({ ok: false, status: 500, text: async () => JSON.stringify({
        success: false, error: 'INTERNAL_ERROR', message: 'Upstream stream lookup failed'
    }) }), /HTTP 500: Upstream stream lookup failed/);
});

test('provider checks handle non-JSON errors and retain successful streams', async () => {
    await assert.rejects(readResponse({ ok: false, status: 500, statusText: 'Internal Server Error',
        text: async () => '<html>Error</html>' }), /HTTP 500: Internal Server Error/);
    await assert.rejects(readResponse({ ok: false, status: 500,
        text: async () => 'Upstream unavailable' }), /HTTP 500: Upstream unavailable/);
    const result = await readResponse({ ok: true, status: 200, text: async () => '{"success":true,"streams":[]}' });
    assert.equal(result.success, true);
    assert.equal(result.streams.length, 0);
});
