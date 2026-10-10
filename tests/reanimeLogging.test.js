const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

test('Reanime logs request stages, redacts secrets, and retains stream extraction and cache hits', async () => {
  const logs = [], requests = [], module = { exports: {} };
  const context = {
    module, URL, AbortController, setTimeout, clearTimeout,
    console: { log: line => logs.push(line) },
    require: name => name === '../utils/tmdbKey' ? { getTmdbApiKey: () => 'private-api-key' } : require(name),
    fetch: async raw => {
      const url = new URL(raw);
      requests.push(url);
      let body;
      if (url.hostname === 'api.themoviedb.org') body = { name: 'Fixture' };
      else if (url.hostname === 'anikoto-nuvio.netlify.app') body = { ok: true, eligibility: 'anime', mapping: { mal_id: '21', mal_episode: 1, title: 'Fixture' } };
      else if (url.hostname === 'graphql.anilist.co') body = { data: { Media: { id: 21, title: { english: 'Fixture' } } } };
      else if (url.hostname === 'reanime.to') body = { success: true, servers: [{ dataType: 'sub', dataLink: 'https://flixcloud.cc/e/fixture' }] };
      else if (url.hostname === 'flixcloud.cc') body = '12345678-1234-1234-1234-123456789abc eyJsecret.payload.signature 1080p';
      else throw Error('Unexpected URL');
      return { ok: true, status: 200, json: async () => body, text: async () => body };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../providers/reanime.js'), 'utf8'), context);
  const streams = await module.exports.getStreams('37854', 'anime', 1, 1);
  assert.equal(streams.length, 1);
  assert.match(streams[0].url, /token=eyJsecret/);
  assert.equal(streams[0].headers.Referer, 'https://flixcloud.cc/');
  assert.ok(requests.some(url => url.pathname === '/3/tv/37854'));
  const calls = requests.length;
  await module.exports.getStreams('37854', 'anime', 1, 1);
  assert.equal(requests.length, calls);
  const text = logs.join('\n');
  for (const stage of ['REQUEST start', 'HTTP start', 'HTTP end', 'MAPPER response', 'DOMAIN selected', 'SERVERS', 'FLIX signed download ready', 'STREAM resolved', 'REQUEST end', 'CACHE streams hit']) assert.ok(text.includes(stage), stage);
  assert.ok(!text.includes('private-api-key'));
  assert.ok(!text.includes('eyJsecret'));
  assert.match(text, /37854:tv:1:1#1/);
  await module.exports.getStreams('129', 'anime');
  assert.ok(requests.some(url => url.pathname === '/3/movie/129'));
});
