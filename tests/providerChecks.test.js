const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

test('status checks use provider categories and separate movie IDs while retaining four workers', async () => {
    const dom = new JSDOM('<div id="statusMetrics"></div><div id="statusEndpoints"></div><div id="statusProvidersEnhanced"></div><input id="providerCheckTmdbId"><input id="animeProviderCheckTmdbId" value="1363974"><div id="providerCheckSummary"></div><button id="runProviderChecksBtn"></button>');
    const providers = [
        { name: 'animekai', category: 'Anime', enabled: true },
        { name: 'allwish', category: 'Anime', enabled: true },
        ...['vidlink', 'vixsrc', 'goojara'].map(name => ({ name, category: 'MoviesTv', enabled: true })),
        { name: 'disabled', category: 'Anime', enabled: false }
    ];
    const requests = [];
    let active = 0;
    let peak = 0;
    const context = vm.createContext({ document: dom.window.document, console,
        U: p => '/kiduyuTv_providers' + p, currentStreamTokenHash: () => 'fixture-token',
        fetch: async url => {
            if (url.endsWith('/api/status')) return { ok: true, json: async () => ({ success: true, providers, metrics: {}, endpoints: [], providerCheckTmdbId: '278' }) };
            requests.push(url);
            peak = Math.max(peak, ++active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--;
            return { ok: true, status: 200, text: async () => '{"success":true,"streams":[{}]}' };
        }
    });
    const source = fs.readFileSync(path.join(__dirname, '../public/index.js'), 'utf8');
    vm.runInContext(source.slice(source.indexOf('async function loadServerStatus('), source.indexOf('async function saveProviderCheckTmdbId(')), context);
    await context.loadServerStatus();
    await context.runProviderFunctionalChecks();
    assert.equal(peak, 4);
    assert.equal(requests.length, 5);
    for (const provider of providers.filter(p => p.enabled)) {
        const anime = provider.category === 'Anime';
        assert.ok(requests.includes(`/kiduyuTv_providers/api/streams/${provider.name}/${anime ? 'anime/1363974' : 'movie/278'}?token=fixture-token`));
    }
    assert.equal(dom.window.document.querySelector('#runProviderChecksBtn').disabled, false);
    dom.window.close();
});
