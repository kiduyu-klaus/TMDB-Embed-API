const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

for (const [id, host, exportName] of [
    ['vidup', 'https://vidup.to', 'getVidupStreams'],
    ['vidcore', 'https://vidcore.io', 'getVidcoreStreams'],
    ['vidfast', 'https://vidfast.vc', 'getVidfastStreams']
]) {
    test(`${id} completes both handshake stages and keeps streams/subtitles when a server fails`, async t => {
        const provider = require(`../providers/${id}`);
        const bridge = `https://enc-dec.app/api/enc-${id}`;
        const decrypt = `https://enc-dec.app/api/dec-${id}`;
        const base = `${host}/stream/signed?token=preserve`;
        const requests = [];
        const result = value => ({ data: { status: 200, result: value } });
        t.mock.method(axios, 'get', async (url, options) => {
            requests.push(url);
            if (url === `${host}/tv/1399/1/1` || url === `${host}/movie/278`) {
                return { data: String.raw`\"token\":\"page-token\"` };
            }
            if (url === bridge) {
                if (options.params.stage === 1) {
                    assert.equal(options.params.text, 'page-token');
                    return result({ stage1: `${host}/handshake`, token: '' });
                }
                assert.equal(options.params.stage, 2);
                assert.equal(options.params.text, 'handshake-result');
                return result({ servers: `${host}/servers`, stream: base, token: 'second-token' });
            }
            if (url.startsWith('https://cdn.example/')) return { status: 200, data: '#EXTM3U\n', headers: { 'content-type': 'application/vnd.apple.mpegurl' } };
            throw new Error(`Unexpected GET ${url}`);
        });
        t.mock.method(axios, 'post', async (url, body, options) => {
            if (url === `${host}/handshake`) {
                assert.equal(options.headers['X-CSRF-Token'], '');
                return { data: 'handshake-result' };
            }
            if (url === decrypt) {
                if (body.text === 'servers') return result([{ name: 'One', data: 'one' }, { name: 'Two', data: 'two' }, { name: 'Dead', data: 'dead' }, null]);
                return result({ sources: [{ file: `https://cdn.example/${body.text}.m3u8`, type: 'hls' }],
                    tracks: body.text === 'one' ? [
                        { file: '/en.vtt', label: 'English', kind: 'captions' },
                        { file: '/preview.vtt', kind: 'thumbnails' }
                    ] : [] });
            }
            assert.equal(options.headers['X-CSRF-Token'], 'second-token');
            assert.equal(options.headers.Referer, host + '/');
            if (url === `${host}/servers`) return { data: 'servers' };
            if (url === `${base}/dead`) throw new Error('Upstream 404');
            if (url === `${base}/one`) return { data: 'one' };
            if (url === `${base}/two`) return { data: 'two' };
            throw new Error(`Unexpected POST ${url}`);
        });
        for (const args of [['1399', 'tv', 1, 1], ['278', 'movie']]) {
            const streams = await provider[exportName](...args);
            assert.equal(streams.length, 2);
            for (const stream of streams) {
                assert.equal(stream.headers.Referer, host + '/');
                assert.equal(stream.subtitles.length, 1);
                assert.equal(stream.subtitles[0].url, 'https://cdn.example/en.vtt');
                assert.equal(stream.subtitles[0].language, 'en');
                assert.equal(stream.subtitles[0].mimeType, 'text/vtt');
                assert.equal(stream.subtitles[0].headers.Referer, host + '/');
            }
        }
        assert.ok(requests.includes(`${host}/tv/1399/1/1`));
        assert.ok(requests.includes(`${host}/movie/278`));
    });
}
