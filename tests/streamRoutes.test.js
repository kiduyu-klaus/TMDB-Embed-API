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
    let animeMediaType;
    let allwishArgs;
    let animeSaltArgs;
    let goojaraArgs;
    let movieboxArgs;
    let requestedLogSince;
    let imdbType;
    let streamFailure;
    const loggedErrors = [];
    vm.runInNewContext(fs.readFileSync(registryFile, 'utf8'), {
      module: registryModule, __dirname: path.dirname(registryFile), console: quiet,
      require(name) {
        if (name === '../utils/config') return { config };
        if (name === 'fs') return { readdirSync: () => ['vidlink.js', 'animekai.js', 'allwish.js', 'animesalt.js', 'goojara.js', 'moviebox.js'] };
        if (name === path.join(root, 'providers/moviebox.js')) return { getMovieboxStreams: async (...args) => { movieboxArgs = args; return [raw]; } };
        if (name === path.join(root, 'providers/vidlink.js')) return { getVidlinkStreams: async () => [raw] };
        if (name === path.join(root, 'providers/animekai.js')) return { getAnimekaiStreams: async (_id, type) => { animeMediaType = type; return [raw]; } };
        if (name === path.join(root, 'providers/allwish.js')) return { getStreams: async (...args) => { allwishArgs = args; return [raw]; } };
        if (name === path.join(root, 'providers/animesalt.js')) return { getStreams: async (...args) => { animeSaltArgs = args; return [raw]; } };
        if (name === path.join(root, 'providers/goojara.js')) return { getStreams: async (...args) => { goojaraArgs = args; return args[1] === 'tv' ? [raw] : []; } };
        return registryRequire(name);
      },
    });
    const app = express();
    app.listen = () => ({ on() {} });
    const expressStub = Object.assign(() => app, express);
    const apiRequire = createRequire(path.join(root, 'apiServer.js'));
    const pass = (_req, _res, next) => next();
    const context = vm.createContext({
      console: { ...quiet, error(...args) { loggedErrors.push(args.join(' ')); } }, setImmediate() {}, setTimeout, setInterval: () => ({ unref() {} }),
      process: { env: {}, cwd: () => root, exit() {}, on() {} },
      require(name) {
        if (name === 'dotenv') return { config() {} };
        if (name === 'express') return expressStub;
        if (name === './utils/config') return { config };
        if (name === './utils/consoleLogs') return {
          installConsoleLogCapture() {},
          getConsoleLogs(since) {
            requestedLogSince = since;
            return { entries: [{ id: 4, timestamp: '2026-01-01T00:00:00.000Z', level: 'info', message: 'fixture log' }], cursor: 4, truncated: false };
          }
        };
        if (name === './utils/auth') return { requireAuth: pass };
        if (name === './utils/streamToken') return { requireStreamToken: pass };
        if (name === './providers/registry') return registryModule.exports;
        if (name === './utils/tmdb') return { resolveImdbId: async (type) => { if (streamFailure) throw streamFailure; imdbType = type; return 'tt1234567'; } };
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
      assert.equal(response.count, routePath === '/api/streams/:type/:tmdbId' ? 2 : 1);
      assert.equal(typeof response.providerTimings.vidlink, 'number');
      const stream = response.streams[0];
      assert.deepEqual(stream.headers, raw.headers);
      assert.equal(stream.format, 'hls');
      assert.equal(stream.mimeType, 'application/vnd.apple.mpegurl');
      assert.equal(stream.subtitles[0].language, 'en');
      assert.deepEqual(stream.subtitles[0].headers, raw.headers);
      assert.equal(stream.url.startsWith('http://localhost:8787/m3u8-proxy?'), enableProxy);
    }

    const aggregateRoute = router.stack.find(layer => layer.route && layer.route.path === '/api/streams/:type/:tmdbId').route;
    let animeResponse;
    await aggregateRoute.stack[aggregateRoute.stack.length - 1].handle({
      params: { type: 'anime', tmdbId: '123' }, query: {}, protocol: 'http', get: () => 'localhost:8787'
    }, { json(value) { animeResponse = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); } });
    assert.equal(animeResponse.success, true);
    assert.equal(animeResponse.count, 4);
    assert.equal(animeResponse.providerTimings.moviebox >= 0, true);
    assert.equal(animeResponse.providerTimings.animekai >= 0, true);
    assert.equal(animeResponse.providerTimings.allwish >= 0, true);
    assert.equal(animeResponse.providerTimings.animesalt >= 0, true);
    assert.equal(animeMediaType, 'movie');
    assert.equal(imdbType, 'movie');

    const providerRoute = router.stack.find(layer => layer.route && layer.route.path === '/api/streams/:provider/:type/:tmdbId').route;
    config.defaultProviders = ['moviebox'];
    for (const route of [aggregateRoute, providerRoute]) {
      for (const [type, query, expectedType] of [
        ['anime', { season: '1', episode: '1' }, 'anime'],
        ['anime', {}, 'movie'],
        ['movie', {}, 'movie'],
        ['series', { season: '1', episode: '1' }, 'tv']
      ]) {
        let result;
        await route.stack[route.stack.length - 1].handle({
          params: { provider: 'moviebox', type, tmdbId: '82684' }, query,
          protocol: 'http', get: () => 'localhost:8787'
        }, { json(value) { result = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); } });
        assert.equal(result.success, true);
        assert.equal(result.count, 1);
        assert.ok(result.providerTimings.moviebox >= 0);
        assert.deepEqual(movieboxArgs, ['82684', expectedType, query.season ? 1 : null, query.episode ? 1 : null]);
      }
    }
    config.defaultProviders = [];
    let providerStatus;
    let providerError;
    const animeProviderRes = {
      status(code) { providerStatus = code; return this; },
      json(value) { providerError = value; }
    };
    await providerRoute.stack[providerRoute.stack.length - 1].handle({
      params: { provider: 'vidlink', type: 'anime', tmdbId: '123' }, query: {}
    }, animeProviderRes);
    assert.equal(providerStatus, 404);
    assert.equal(providerError.error, 'PROVIDER_NOT_IN_CATEGORY');

    let animeProviderResponse;
    await providerRoute.stack[providerRoute.stack.length - 1].handle({
      params: { provider: 'animekai', type: 'anime', tmdbId: '123' }, query: {}, protocol: 'http', get: () => 'localhost:8787'
    }, { json(value) { animeProviderResponse = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); } });
    assert.equal(animeProviderResponse.success, true);
    assert.equal(animeProviderResponse.provider, 'animekai');
    assert.equal(animeMediaType, 'movie');
    assert.equal(imdbType, 'movie');

    let allwishResponse;
    await providerRoute.stack[providerRoute.stack.length - 1].handle({
      params: { provider: 'allwish', type: 'anime', tmdbId: '82684' }, query: { season: '1', episode: '2' }, protocol: 'http', get: () => 'localhost:8787'
    }, { json(value) { allwishResponse = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); } });
    assert.equal(allwishResponse.success, true);
    assert.equal(allwishResponse.provider, 'allwish');
    assert.deepEqual(allwishArgs, ['82684', 'anime', 1, 2]);

    let animeSaltResponse;
    await providerRoute.stack[providerRoute.stack.length - 1].handle({
      params: { provider: 'animesalt', type: 'anime', tmdbId: '82684' }, query: { season: '1', episode: '2' }, protocol: 'http', get: () => 'localhost:8787'
    }, { json(value) { animeSaltResponse = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); } });
    assert.equal(animeSaltResponse.success, true);
    assert.equal(animeSaltResponse.provider, 'animesalt');
    assert.deepEqual(animeSaltArgs, ['82684', 'anime', 1, 2]);

    let goojaraResponse;
    await providerRoute.stack[providerRoute.stack.length - 1].handle({
      params: { provider: 'goojara', type: 'series', tmdbId: '1399' }, query: { season: '1', episode: '1' }, protocol: 'http', get: () => 'localhost:8787'
    }, { json(value) { goojaraResponse = value; }, status(code) { assert.fail(`Unexpected HTTP ${code}`); } });
    assert.equal(goojaraResponse.success, true);
    assert.equal(goojaraResponse.provider, 'goojara');
    assert.deepEqual(goojaraArgs, ['1399', 'tv', 1, 1]);

    for (const route of [aggregateRoute, providerRoute]) {
      for (const query of [{}, { season: '2' }, { episode: '16' }, { season: '2', episode: '16' }]) {
        const isMovie = Object.keys(query).length === 0;
        await route.stack[route.stack.length - 1].handle({
          params: { provider: 'allwish', type: 'anime', tmdbId: '1363974' }, query,
          protocol: 'http', get: () => 'localhost:8787'
        }, { json() {}, status(code) { assert.fail('Unexpected HTTP ' + code); } });
        assert.equal(imdbType, isMovie ? 'movie' : 'tv');
        assert.equal(allwishArgs[1], isMovie ? 'movie' : 'anime');
        if (route === aggregateRoute) assert.equal(animeSaltArgs[1], isMovie ? 'movie' : 'anime');
      }
    }

    streamFailure = new Error('Stream lookup failed unexpectedly');
    for (const route of [aggregateRoute, providerRoute]) {
      let errorStatus;
      let errorResponse;
      const params = { type: 'anime', tmdbId: '82684' };
      if (route === providerRoute) params.provider = 'allwish';
      await route.stack[route.stack.length - 1].handle({
        params, query: { season: '2', episode: '16', token: 'private-token' }
      }, {
        status(code) { errorStatus = code; return this; },
        json(value) { errorResponse = value; }
      });
      assert.equal(errorStatus, 500);
      assert.equal(errorResponse.success, false);
      assert.equal(errorResponse.message, streamFailure.message);
      assert.match(loggedErrors.at(-1), /HTTP 500.*tmdbId=82684.*Stream lookup failed unexpectedly/);
      assert.ok(!loggedErrors.at(-1).includes('private-token'));
    }
    streamFailure = null;

    const logsRoute = router.stack.find(layer => layer.route && layer.route.path === '/api/logs').route;
    assert.equal(logsRoute.stack[0].handle, pass, 'logs endpoint must require an admin session');
    let logsResponse;
    await logsRoute.stack[logsRoute.stack.length - 1].handle({ query: { since: '3' } }, {
      setHeader(name, value) { assert.equal(name, 'Cache-Control'); assert.match(value, /no-store/); },
      json(value) { logsResponse = value; }
    });
    assert.equal(requestedLogSince, 3);
    assert.equal(logsResponse.success, true);
    assert.equal(logsResponse.entries[0].message, 'fixture log');
  }
});
