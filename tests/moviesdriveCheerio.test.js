const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const providerPath = require.resolve('../providers/moviesdrive1');
const providerRequire = createRequire(providerPath);

for (const mode of ['tv', 'movie', 'html-search']) {
    test(`MoviesDrive parses ${mode} through resolver pages with installed Cheerio`, async () => {
        const requests = [];
        const base = 'https://moviesdrive.test';
        const streamUrl = 'https://media.test/video.mkv';
        const pages = {
            [`${base}/post`]: mode === 'movie'
                ? `<h5><a href="${base}/resolver">Download</a></h5>`
                : `<h4>Season 1</h4><p><a href="${base}/episodes">Episodes</a></p>`,
            [`${base}/episodes`]: `<h5>Episode 1</h5><p><a href="${base}/resolver">Download</a></p><h5>Episode 2</h5>`,
            [`${base}/resolver`]: '<a href="https://hubcloud.test/drive/example">HubCloud</a>',
            'https://hubcloud.test/drive/example': '<a href="/hubcloud.php">Continue</a>',
            'https://hubcloud.test/hubcloud.php': `<div class="card-header">1080p</div><a href="${streamUrl}">FSLv2</a>`
        };
        const document = { post_title: 'Lanterns (Season 1)', permalink: '/post', imdb_id: 'tt26545992' };
        const fetch = async url => {
            requests.push(url);
            let data;
            if (url.endsWith('/domains.json')) data = { moviesdrive: base };
            else if (url.includes('/search.php?')) data = { hits: mode === 'html-search' ? [] : [{ document }] };
            else if (url.includes('/search.html?')) data = '<a href="/post">Lanterns (Season 1)</a>';
            else {
                assert.ok(Object.hasOwn(pages, url), `Unexpected request: ${url}`);
                data = pages[url];
            }
            return { ok: true, status: 200, url, json: async () => data, text: async () => data };
        };
        const context = vm.createContext({
            module: { exports: {} }, URL, URLSearchParams,
            console: { log() {} }, process: { env: { MOVIESDRIVE_LOG_LEVEL: '0' } },
            require: name => {
                if (name === 'node-fetch') return fetch;
                if (name === '../utils/tmdb') return {
                    getDetails: async () => ({ name: 'Lanterns', title: 'Lanterns' }),
                    getExternalIds: async () => ({ imdb_id: 'tt26545992' })
                };
                return providerRequire(name);
            }
        });
        vm.runInContext(fs.readFileSync(providerPath, 'utf8'), context, { filename: providerPath });
        const streams = await context.module.exports.getMoviesDriveStreams('95350', mode === 'movie' ? 'movie' : 'tv', 1, 1);
        assert.equal(streams.length, 1);
        assert.equal(streams[0].url, streamUrl);
        assert.equal(streams[0].quality, 1080);
        assert.equal(streams[0].mimeType, 'video/x-matroska');
        assert.ok(requests.includes('https://hubcloud.test/hubcloud.php'));
        assert.ok(!context.__moviesdriveLogBuffer.some(entry => entry.level === 'error'));
    });
}
