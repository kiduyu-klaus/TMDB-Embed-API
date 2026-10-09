const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const express = require('express');
const root = path.join(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };

test('both API endpoints retain the normalized contract with proxy enabled and disabled', async () => {
  const raw = { name: 'Fixture', title: 'Fixture - English', quality: 'English',
    url: 'https://cdn.example/a.m3u8', headers: { Referer: 'https://player.example/', 'User-Agent': 'fixture' },
    subtitles: [{ url: 'https://subs.example/en.vtt', lang: 'en' }] };
  for (const enableProxy of [false, true]) {
    const config = { port: 0, enableProxy, defaultProviders: [], febboxCookies: [], minQualities: null, excludeCodecs: null };
    const registryFile = path.join(root, 'providers/registry.js');
    const registryRequire = createRequire(registryFile);
    const registryModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(registryFile, 'utf8'), {
      module: registryModule, __dirname: path.dirname(registryFile), console: quiet,
      require(name) {
        if (name === '../utils/config') return { config };
        if (name === 'fs') return { readdirSync: () => ['vidlink.js'] };
        if (name === path.join(root, 'providers/vidlink.js')) return { getVidlinkStreams: async () => [raw] };
        return registryRequire(name);
      },
    });
    const app = express();
    app.listen = () => ({ on() {} });
    const expressStub = Object.assign(() => app, express);
    const apiRequire = createRequire(path.join(root, 'apiServer.js'));
    const pass = (_req, _res, next) => next();
    const context = vm.createContext({
      console: quiet, setImmediate() {}, setTimeout, setInterval: () => ({ unref() {} }),
      process: { env: {}, cwd: () => root, exit() {}, on() {} },
      require(name) {
        if (name === 'dotenv') return { config() {} };
        if (name === 'express') return expressStub;
        if (name === './utils/config') return { config };
        if (name === './utils/auth') return { requireAuth: pass };
        if (name === './utils/streamToken') return { requireStreamToken: pass };
        if (name === './providers/registry') return registryModule.exports;
        if (name === './utils/tmdb') return { resolveImdbId: async () => 'tt1234567' };
        return apiRequire(name);
      },
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'apiServer.js'), 'utf8'), context);
    const router = vm.runInContext('router', context);
    for (const routePath of ['/api/streams/:type/:tmdbId', '/api/streams/:provider/:type/:tmdbId']) {
      const route = router.stack.find(layer => layer.route && layer.route.path === routePath).route;
      let response;
      const req = { params: { type: 'movie', tmdbId: '550', provider: 'vidlink' }, query: {}, protocol: 'http', get: () => 'localhost:8787' };
      const res = { json(value) { response = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); } };
      await route.stack[route.stack.length - 1].handle(req, res);
      assert.equal(response.success, true);
      assert.equal(response.tmdbId, '550');
      assert.equal(response.imdbId, 'tt1234567');
      assert.equal(response.count, 1);
      assert.equal(typeof response.providerTimings.vidlink, 'number');
      const stream = response.streams[0];
      assert.deepEqual(stream.headers, raw.headers);
      assert.equal(stream.format, 'hls');
      assert.equal(stream.mimeType, 'application/vnd.apple.mpegurl');
      assert.equal(stream.subtitles[0].language, 'en');
      assert.deepEqual(stream.subtitles[0].headers, raw.headers);
      assert.equal(stream.url.startsWith('http://localhost:8787/m3u8-proxy?'), enableProxy);
    }
  }
});
