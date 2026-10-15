'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../providers/byse');

function jsonResponse(data) {
    return { ok: true, status: 200, json: async () => data };
}

test('accepts only Byse-style embed URLs with a player code', () => {
    assert.deepEqual(_test.parseEmbedUrl('https://player.example/e/abc123?x=1'), {
        embedUrl: 'https://player.example/e/abc123?x=1',
        embedOrigin: 'https://player.example',
        code: 'abc123',
    });
    assert.throws(() => _test.parseEmbedUrl('not-a-url'), /valid embed URL/);
    assert.throws(() => _test.parseEmbedUrl('https://player.example/watch/abc123/extra'), /player path/);
});

test('solves a zero-difficulty Byse proof of work immediately', async () => {
    assert.equal(await _test.solvePow({ pow_nonce: 'nonce', pow_difficulty: 0 }), '0');
    await assert.rejects(_test.solvePow({ pow_nonce: '', pow_difficulty: 1 }), /invalid proof-of-work/);
});

test('builds the movie lookup with the IMDb ID and uses the redirect Location as the embed URL', async () => {
    let request;
    const fetchImpl = async (url, options) => {
        request = { url, options };
        return { status: 302, headers: { get: name => name.toLowerCase() === 'location' ? 'https://bysesayeveum.com/e/moviecode' : null } };
    };
    const embedUrl = await _test.getEmbedUrl('12345', 'tv', null, null, {
        fetchImpl,
        resolveImdbIdFn: async (type, tmdbId) => {
            assert.equal(type, 'movie');
            assert.equal(tmdbId, '12345');
            return 'tt7654321';
        },
    });
    assert.equal(request.url, 'https://0123movie.space/mv/tt7654321/12345/');
    assert.equal(request.options.redirect, 'manual');
    assert.equal(request.options.headers.Referer, 'https://1hd.one/');
    assert.equal(embedUrl, 'https://bysesayeveum.com/e/moviecode');
});

test('builds the series lookup from TMDB ID, season, and episode', async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
        requests.push({ url, options });
        if (requests.length === 1) {
            return { status: 301, headers: { get: name => name.toLowerCase() === 'location' ? '/pl/67890/2/1/' : null } };
        }
        return { status: 302, headers: { get: name => name.toLowerCase() === 'location' ? 'https://mfw09.org/e/g2o9pjloqhzb' : null } };
    };
    const embedUrl = await _test.getEmbedUrl('67890', 'movie', 2, 1, { fetchImpl });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://0123movie.space/pl/67890/2/1');
    assert.equal(requests[1].url, 'https://0123movie.space/pl/67890/2/1/');
    assert.equal(requests[0].options.headers.Referer, 'https://1hd.one/');
    assert.equal(requests[1].options.headers.Referer, 'https://1hd.one/');
    assert.equal(embedUrl, 'https://mfw09.org/e/g2o9pjloqhzb');
});

test('uses movie when season and episode are not both present, regardless of mediaType argument', async () => {
    let requestUrl;
    const embedUrl = await _test.getEmbedUrl('67890', 'tv', 1, null, {
        fetchImpl: async url => {
            requestUrl = url;
            return { status: 302, headers: { get: name => name.toLowerCase() === 'location' ? 'https://mfw09.org/e/moviecode' : null } };
        },
        resolveImdbIdFn: async () => 'tt1234567',
    });
    assert.equal(requestUrl, 'https://0123movie.space/mv/tt1234567/67890/');
    assert.equal(embedUrl, 'https://mfw09.org/e/moviecode');
});

test('normalizes decrypted Byse sources with the frame playback headers', () => {
    const streams = _test.normalizeSources({ sources: [
        { file: 'https://cdn.example/episode-1080p.m3u8', language: 'Japanese' },
        { url: 'https://cdn.example/episode-1080p.m3u8', language: 'Japanese' },
        { url: 'javascript:alert(1)' },
    ] }, { 'User-Agent': 'UA', Referer: 'https://frame.example', Origin: 'https://frame.example' }, 'https://player.example/e/abc123');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, 'https://cdn.example/episode-1080p.m3u8');
    assert.equal(streams[0].quality, '1080p');
    assert.equal(streams[0].language, 'Japanese');
    assert.equal(streams[0].type, 'hls');
    assert.equal(streams[0].mimeType, 'application/vnd.apple.mpegurl');
    assert.equal(streams[0].headers.Referer, 'https://frame.example');
});

test('falls back to the legacy details endpoint only when the embed details route returns 404', async () => {
    const calls = [];
    const fetchImpl = async url => {
        calls.push(url);
        if (url.endsWith('/embed/details')) {
            return { ok: false, status: 404, json: async () => ({ error: 'video not found' }) };
        }
        return jsonResponse({ embed_frame_url: 'https://frame.example/player/code' });
    };
    const details = await _test.getEmbedDetails(fetchImpl, 'https://player.example', 'abc123', {});
    assert.equal(calls.length, 2);
    assert.equal(calls[0], 'https://player.example/api/videos/abc123/embed/details');
    assert.equal(calls[1], 'https://player.example/api/videos/abc123/details');
    assert.equal(details.embed_frame_url, 'https://frame.example/player/code');
});

test('completes the Byse challenge, attestation, PoW, verification, and decryption flow', async () => {
    const calls = [];
    const responses = new Map([
        ['https://player.example/api/videos/abc123/embed/details', { id: 123, code: 'abc123' }],
        ['https://player.example/api/videos/access/challenge', { challenge_id: 'challenge-id' }],
        ['https://enc-dec.app/api/enc-byse', { status: 200, result: { signed_challenge: true } }],
        ['https://player.example/api/videos/access/attest', {
            token: 'attestation', viewer_id: 'viewer', device_id: 'device', confidence: 0.9,
        }],
        ['https://player.example/api/videos/abc123/embed/captcha', {
            pow_token: 'pow-token', pow_nonce: 'nonce', pow_difficulty: 0,
        }],
        ['https://player.example/api/videos/abc123/embed/captcha/verify', { token: 'captcha-token' }],
        ['https://player.example/api/videos/abc123/embed/playback', { encrypted_playback: true }],
        ['https://enc-dec.app/api/dec-byse', { status: 200, result: { sources: [
            { url: 'https://cdn.example/episode.m3u8', quality: '720p' },
        ] } }],
    ]);
    const fakeFetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (!responses.has(url)) throw new Error(`Unexpected test request: ${url}`);
        return jsonResponse(responses.get(url));
    };

    const streams = await _test.resolveEmbed('https://player.example/e/abc123', fakeFetch);
    assert.equal(calls.length, 8);
    assert.deepEqual(calls.map(call => call.url), [...responses.keys()]);
    const captchaCall = calls.find(call => call.url.endsWith('/embed/captcha'));
    assert.equal(captchaCall.options.headers['X-Embed-Parent'], 'https://player.example/e/abc123');
    assert.match(captchaCall.options.headers.Cookie, /byse_viewer_id=viewer/);
    const verifyCall = calls.find(call => call.url.endsWith('/captcha/verify'));
    assert.equal(JSON.parse(verifyCall.options.body).solution, '0');
    const playbackCall = calls.find(call => call.url.endsWith('/embed/playback'));
    assert.equal(playbackCall.options.headers['X-Captcha-Token'], 'captcha-token');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].provider, 'byse');
    assert.equal(streams[0].quality, '720p');
    assert.equal(streams[0].headers.Origin, 'https://player.example');
});
