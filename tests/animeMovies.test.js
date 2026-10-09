const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const tmdb = require('../utils/tmdb');
const allwish = require('../providers/allwish');
const animekai = require('../providers/animekai');
const title = 'Example Movie Part 2';

test('AnimeKai treats anime without episode parameters as a movie, without splitting its title', async t => {
    t.mock.method(tmdb, 'getDetails', async (type, id) => {
        assert.equal(type, 'movie'); assert.equal(id, '1363974'); return { title };
    });
    t.mock.method(tmdb, 'getSeasonDetails', async () => assert.fail('Movies must not fetch seasons'));
    t.mock.method(axios, 'get', async input => {
        const url = new URL(input);
        if (url.pathname === '/') {
            assert.equal(url.searchParams.get('s'), title);
            return { status: 200, data: `<div class="aitem"><a class="title" href="/movie">${title}</a><div class="info"><b>Movie</b></div></div>` };
        }
        if (url.pathname === '/movie') {
            const encoded = Buffer.from('<iframe src="https://megaplay.su/player"></iframe>').toString('base64');
            return { status: 200, data: `<div class="ak-srv-links"><button class="ak-srv-btn" data-value="${encoded}">Mega</button></div>` };
        }
        assert.equal(url.pathname, '/player');
        return { status: 200, data: 'file: "https://cdn.example/movie.m3u8"' };
    });
    const streams = await animekai.getAnimekaiStreams('1363974', 'anime');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, 'https://cdn.example/movie.m3u8');
    assert.deepEqual(animekai.matchAnimeSearchResults([{ title, type: 'tv' }], title, 1, null, 'movie'), []);
});

test('AllWish treats anime without episode parameters as a movie and resolves its episode-1 sources', async t => {
    t.mock.method(tmdb, 'getDetails', async (type, id) => {
        assert.equal(type, 'movie'); assert.equal(id, '1363974'); return { title };
    });
    t.mock.method(tmdb, 'getSeasonDetails', async () => assert.fail('Movies must not fetch seasons'));
    t.mock.method(animekai, 'resolveDirectM3u8', async () => ({ url: 'https://cdn.example/movie.m3u8' }));
    t.mock.method(globalThis, 'fetch', async input => {
        const url = new URL(input);
        let body;
        if (url.pathname === '/filter') {
            assert.equal(url.searchParams.get('keyword'), title);
            body = `<div class="item"><div class="name"><a href="/wrong-movie">Example Movie Part 1</a></div></div><div class="item"><div class="name"><a href="/movie">${title}</a></div></div>`;
        } else if (url.pathname === '/movie') body = '<main><div class="container" data-id="movie"></div></main>';
        else if (url.pathname === '/ajax/episode/list/movie') body = { status: 200, result: '<div class="range"><div><a data-slug="1" data-ids="movie-1"></a></div></div>' };
        else if (url.pathname === '/ajax/server/list') {
            assert.equal(url.searchParams.get('servers'), 'movie-1');
            body = { status: 200, result: '<div class="server-type"><div class="server-list"><div class="server" data-link-id="source">Mega</div></div></div>' };
        } else {
            assert.equal(url.pathname, '/ajax/server');
            body = { result: { url: 'https://megaplay.buzz/player' } };
        }
        return { ok: true, text: async () => body, json: async () => body };
    });
    const streams = await allwish.getStreams('1363974', 'anime');
    assert.equal(streams.length, 1);
    assert.equal(streams[0].url, 'https://cdn.example/movie.m3u8');
});
