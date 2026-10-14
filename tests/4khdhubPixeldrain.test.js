const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('../providers/4khdhub');

test('reads every supported Open Graph tag and deduplicates exact signed URLs', () => {
    const html = '<meta property="og:video" content="/api/file/one?x=1&amp;y=2">' +
        '<meta property="og:video:url" content="/api/file/one?x=1&amp;y=2">' +
        '<meta property="og:video:secure_url" content="https://pixeldrain.dev/api/file/two">';
    assert.deepEqual(_test.pixeldrainMediaUrls(html, 'https://pixeldrain.dev/u/id'), [
        'https://pixeldrain.dev/api/file/one?x=1&y=2', 'https://pixeldrain.dev/api/file/two',
    ]);
});

test('opens the page and returns response metadata separately from playback headers', async () => {
    const http = {
        get: async () => ({ data: '<meta property="og:video:url" content="/api/file/id">' }),
        head: async () => ({ status: 200, headers: { 'content-type': 'video/x-matroska', 'content-length': '100', 'accept-ranges': 'bytes', 'set-cookie': 'private=secret' } }),
    };
    const [stream] = await _test.resolvePixeldrain('https://pixeldrain.dev/u/id', '1080p', '', http);
    assert.equal(stream.url, 'https://pixeldrain.dev/api/file/id');
    assert.equal(stream.mimeType, 'video/x-matroska');
    assert.equal(stream.responseHeaders['accept-ranges'], 'bytes');
    assert.equal(stream.responseHeaders['set-cookie'], undefined);
    assert.equal(stream.headers['content-length'], undefined);
});

test('HEAD fallback bounds download and destroys the response stream', async () => {
    let destroyed = false;
    const http = {
        head: async () => { throw new Error('HEAD unsupported'); },
        get: async (url, options) => {
            assert.equal(options.headers.Range, 'bytes=0-0');
            assert.equal(options.responseType, 'stream');
            return { status: 206, headers: { 'content-type': 'video/mp4' }, data: { destroy() { destroyed = true; } } };
        },
    };
    const streams = await _test.resolvePixeldrain('https://pixeldrain.dev/api/file/id', '', '', http);
    assert.equal(streams.length, 1);
    assert.ok(destroyed);
});

test('does not invent URLs when metadata is absent or return HTML as a stream', async () => {
    assert.deepEqual(await _test.resolvePixeldrain('https://pixeldrain.dev/u/missing', '', '', {
        get: async () => ({ data: '<html>Not found</html>' }),
    }), []);
    assert.deepEqual(await _test.resolvePixeldrain('https://pixeldrain.dev/api/file/missing', '', '', {
        head: async () => ({ status: 200, headers: { 'content-type': 'text/html' } }),
    }), []);
});

test('uses the language badge from each movie download card', () => {
    const html = '<div class="download-item"><span class="badge">Hindi, Tamil, Telugu, English</span>' +
        '<a href="https://greenmotors.club/?id=encoded">Download HubCloud</a></div>';
    const [link] = _test.collectPageLinks(html, 'https://4khdhub.one/love-of-your-life-movie-8345/', 'movie');
    const stream = _test.buildStream(link.label, 'https://cdn.example/video.mkv');
    assert.equal(stream.language, ' Hindi . Tamil . Telugu . English');
});

test('uses the language badge from the matching TV season release header', () => {
    const html = '<div class="episodes-list"><div class="season-item">' +
        '<div class="episode-number">S01</div><div class="episode-header"><span class="badge">Hindi, Tamil, Telugu, English</span></div>' +
        '<div class="episode-download-item"><div class="episode-file-info"><span class="badge-psa">Episode-02</span></div>' +
        '<a href="https://greenmotors.club/?id=encoded">Download HubCloud</a></div></div></div>';
    const [link] = _test.collectPageLinks(html, 'https://4khdhub.one/visionquest-series-8342/', 'tv', 1, 2);
    const stream = _test.buildStream(link.label, 'https://cdn.example/video.mkv');
    assert.equal(stream.language, ' Hindi . Tamil . Telugu . English');
});
