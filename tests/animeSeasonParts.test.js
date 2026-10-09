const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const tmdb = require('../utils/tmdb');
const allwish = require('../providers/allwish');
const animekai = require('../providers/animekai');
const { selectSeasonPart } = require('../utils/animeSeasonParts');

const title = 'That Time I Got Reincarnated as a Slime';
const results = [
    { title: `${title} Season 2`, href: '/part-one' },
    { title: `${title} 2nd Season Part 2`, href: '/part-two' }
];

test('maps split-season boundaries, unnamed part 1, and S2E16 to part 2 episode 4', () => {
    for (const [episode, part, local] of [[1, 1, 1], [12, 1, 12], [13, 2, 1], [15, 2, 3], [16, 2, 4], [24, 2, 12]]) {
        const selected = selectSeasonPart(results, episode, 24);
        assert.equal(selected.part, part);
        assert.equal(selected.episode, local);
        assert.deepEqual(selected.results, [results[part - 1]]);
    }
    const explicit = [{ title: `${title} Season 2 Part 1` }, results[1]];
    assert.deepEqual(selectSeasonPart(explicit, 12, 24).results, [explicit[0]]);
    assert.deepEqual(selectSeasonPart(results, 25, 24).results, []);
    assert.deepEqual(selectSeasonPart(results, 16, undefined).results, []);
    assert.deepEqual(selectSeasonPart([results[0]], 16, undefined), {
        results: [results[0]], episode: 16, part: null
    });
});

test('both search parsers retain ordinal season part 2 and exclude other seasons', () => {
    const cards = [...results, { title: `${title} Season 3 Part 2`, href: '/other' }];
    const html = cards.map(item => `<div class="item"><div class="name"><a href="${item.href}">${item.title}</a></div></div>`).join('');
    assert.deepEqual(allwish.findAnimeSearchCandidates(html, title, 2).map(item => item.title), results.map(item => item.title));
    assert.deepEqual(animekai.matchAnimeSearchResults(cards, title, 2), results);
    assert.equal(allwish.findEpisodeDataIds('<div class="range"><div><a data-slug="2" data-ids="wrong"></a></div></div>', 1), null);
    assert.equal(animekai.findEpisodeUrl('<a href="/episode-10/">10</a>', 1, 'https://animekai.com.ro'), null);
});

for (const split of [true, false]) {
    test(`AllWish fetches S2E16 sources with ${split ? 'split' : 'unsplit'} numbering`, async (t) => {
        const localEpisode = split ? 4 : 16;
        const expectedPath = split ? '/part-two' : '/part-one';
        t.mock.method(tmdb, 'getDetails', async () => ({ name: title }));
        t.mock.method(tmdb, 'getSeasonDetails', async (id, season) => {
            assert.equal(id, '82684'); assert.equal(season, 2);
            return { episodes: Array.from({ length: 24 }, (_, i) => ({ episode_number: i + 1 })) };
        });
        t.mock.method(animekai, 'resolveDirectM3u8', async () => ({ url: 'https://cdn.example/episode.m3u8' }));
        const requested = [];
        t.mock.method(globalThis, 'fetch', async (input) => {
            const url = new URL(input);
            requested.push(url.pathname);
            let body;
            if (url.pathname === '/filter') body = (split ? results : [results[0]]).map(item => `<div class="item"><div class="name"><a href="${item.href}">${item.title}</a></div></div>`).join('');
            else if (url.pathname === expectedPath) body = '<main><div class="container" data-id="fixture"></div></main>';
            else if (url.pathname === '/ajax/episode/list/fixture') body = { status: 200, result: `<div class="range"><div><a data-slug="${localEpisode}" data-ids="right-episode"></a></div></div>` };
            else if (url.pathname === '/ajax/server/list') {
                assert.equal(url.searchParams.get('servers'), 'right-episode');
                body = { status: 200, result: '<div class="server-type" data-type="sub"><div class="server-list"><div class="server" data-link-id="source">Mega</div></div></div>' };
            } else if (url.pathname === '/ajax/server') body = { result: { url: 'https://megaplay.buzz/embed/fixture' } };
            else throw new Error(`Unexpected request: ${url.pathname}`);
            return { ok: true, text: async () => body, json: async () => body };
        });
        const streams = await allwish.getStreams('82684', 'anime', 2, 16);
        assert.equal(streams.length, 1);
        assert.equal(streams[0].url, 'https://cdn.example/episode.m3u8');
        assert.ok(requested.includes(expectedPath));
        if (split) assert.ok(!requested.includes('/part-one'));
    });

    test(`AnimeKai fetches S2E16 sources with ${split ? 'split' : 'unsplit'} numbering`, async (t) => {
        const localEpisode = split ? 4 : 16;
        const expectedPath = split ? '/part-two' : '/part-one';
        t.mock.method(tmdb, 'getDetails', async () => ({ name: title }));
        t.mock.method(tmdb, 'getSeasonDetails', async (id, season) => {
            assert.equal(id, '82684'); assert.equal(season, 2);
            return { name: 'Season 2', episodes: Array.from({ length: 24 }, (_, i) => ({ episode_number: i + 1 })) };
        });
        const requested = [];
        t.mock.method(axios, 'get', async (input) => {
            const url = new URL(input);
            requested.push(url.pathname);
            let data;
            if (url.pathname === '/') data = (split ? results : [results[0]]).map(item => `<div class="aitem"><a class="title" href="${item.href}">${item.title}</a><div class="info"><b>TV</b></div></div>`).join('');
            else if (url.pathname === expectedPath) data = `<a href="${expectedPath}/episode-${localEpisode}/"><span class="epl-num">${localEpisode}</span></a>`;
            else if (url.pathname === `${expectedPath}/episode-${localEpisode}/`) {
                const encoded = Buffer.from('<iframe src="https://megaplay.su/player"></iframe>').toString('base64');
                data = `<div class="ak-srv-links"><button class="ak-srv-btn" data-value="${encoded}">Mega</button></div>`;
            } else if (url.pathname === '/player') data = 'file: "https://cdn.example/episode.m3u8"';
            else throw new Error(`Unexpected request: ${url.pathname}`);
            return { data, status: 200 };
        });
        const streams = await animekai.getAnimekaiStreams('82684', 'anime', 2, 16);
        assert.equal(streams.length, 1);
        assert.equal(streams[0].url, 'https://cdn.example/episode.m3u8');
        assert.ok(requested.includes(`${expectedPath}/episode-${localEpisode}/`));
        if (split) assert.ok(!requested.includes('/part-one'));
    });
}
