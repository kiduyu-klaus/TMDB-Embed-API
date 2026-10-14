/* CineStream — multi-source movie/TV aggregator for Zangetsu.
 * Port of CineStream (CloudStream, by megix / SaurabhKaperwan/CSX).
 * Search + metadata via TMDB API, streams from multiple sub-sources:
 * VidFast, Vidcore, Vidlink (via enc-dec.app) plus Indian mirrors
 * VegaMovies and 4KHDHub. On the mirrors every language is a separate
 * download link, so each becomes its own labeled VideoSource, e.g.
 * "VegaMovies [Hindi 720p]" / "4KHDHub [Hindi + English 1080p]".
 * type: movie, lang: en, version 1.0.2
 *
 * Settings (via getSettings):
 *   tmdbApiKey   - TMDB API key (built-in works, override if rate-limited)
 *   srcVidfast   - enable VidFast source
 *   srcVidcore   - enable Vidcore source
 *   srcVidlink   - enable Vidlink source
 *   srcVegamovies - enable VegaMovies source (Hindi/English)
 *   src4khdhub    - enable 4KHDHub source (Hindi/English)
 */
'use strict';

var _TMDB_BASE = 'https://api.themoviedb.org/3';
var _DECRYPT_API = 'https://enc-dec.app/api';
var _UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const { normalizeStreams } = require('../utils/streamResponse');
const trace = require('../utils/cinestreamTrace').createCineStreamTrace();
const fetch = trace.fetch;

function getInfo() {
  return {
    name: 'CineStream',
    lang: 'en',
    baseUrl: 'https://github.com/SaurabhKaperwan/CSX',
    logo: 'https://raw.githubusercontent.com/SaurabhKaperwan/CSX/main/CineStream/icons/cinestream.png',
    type: 'movie',
    version: '1.0.4'
  };
}

/* ---- Settings ---- */
function getSettings() {
  return [
    {
      key: 'tmdbApiKey',
      label: 'TMDB API Key (built-in active — paste yours to override)',
      type: 'text',
      default: ''
    },
    {
      key: 'catTmdb',
      label: 'TMDB catalog (Trending rows)',
      type: 'bool',
      default: true
    },
    {
      key: 'catCinemeta',
      label: 'Cinemeta catalog (Top Movies/Series rows)',
      type: 'bool',
      default: true
    },
    {
      key: 'srcVidfast',
      label: 'VidFast source',
      type: 'bool',
      default: true
    },
    {
      key: 'srcVidcore',
      label: 'Vidcore source',
      type: 'bool',
      default: true
    },
    {
      key: 'srcVidlink',
      label: 'Vidlink source',
      type: 'bool',
      default: true
    },
    {
      key: 'srcVegamovies',
      label: 'VegaMovies source (Hindi/English)',
      type: 'bool',
      default: true
    },
    {
      key: 'src4khdhub',
      label: '4KHDHub source (Hindi/English)',
      type: 'bool',
      default: true
    }
  ];
}

function _cfg(key, def) {
  try {
    var s = (__settings && __settings.cinestream) || {};
    var v = s[key];
    return (v === undefined || v === null) ? def : v;
  } catch (e) {
    return def;
  }
}

var _BUILTIN_TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
function _tmdbKey() {
  var k = _cfg('tmdbApiKey', '');
  return k || _BUILTIN_TMDB_KEY;
}

/* ---- HTTP helpers ---- */
function _getJson(url, headers) {
  var h = headers || {};
  h['User-Agent'] = _UA;
  h['Accept'] = 'application/json';
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function _getText(url, headers) {
  var h = headers || {};
  h['User-Agent'] = _UA;
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

function _postJson(url, data, headers) {
  var h = headers || {};
  h['User-Agent'] = _UA;
  h['Content-Type'] = 'application/json';
  h['Accept'] = 'application/json';
  return fetch(url, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(data)
  }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

/* Fail-soft wrapper for a sub-source job. NOTE: `.then(f, r)`'s second arg
 * only catches the INPUT promise's rejection — never failures from f's own
 * returned chain — so each scraper is wrapped here instead: one flaky
 * sub-source (e.g. VidFast 500s) must not kill the other sources. */
function _soft(p) {
  return Promise.resolve(p).then(function (v) { return v; },
    function () { return []; });
}

/* ---- TMDB ---- */
function _tmdbSearch(query, page) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set. Add it in CineStream settings.'));
  var url = _TMDB_BASE + '/search/multi?api_key=' + encodeURIComponent(key) +
    '&query=' + encodeURIComponent(query) + '&page=' + (page || 1);
  return _getJson(url).then(function (d) {
    var results = (d && d.results) || [];
    var items = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var mt = r.media_type;
      if (mt !== 'movie' && mt !== 'tv') continue;
      var title = mt === 'movie' ? (r.title || r.original_title) : (r.name || r.original_name);
      if (!title) continue;
      var year = (r.release_date || r.first_air_date || '').slice(0, 4) || null;
      items.push({
        id: 'cs://' + mt + '/' + r.id,
        title: title,
        url: 'cs://' + mt + '/' + r.id,
        type: 'movie',
        cover: r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : undefined,
        year: year
      });
    }
    return items;
  });
}

function _tmdbDetail(mediaType, tmdbId) {
  var key = _tmdbKey();
  if (!key) return Promise.reject(new Error('TMDB API key not set.'));
  var url = _TMDB_BASE + '/' + mediaType + '/' + tmdbId + '?api_key=' + encodeURIComponent(key) +
    '&append_to_response=external_ids';
  return _getJson(url).then(function (d) {
    var title = mediaType === 'movie' ? (d.title || d.original_title) : (d.name || d.original_name);
    return {
      title: title || ('TMDB ' + tmdbId),
      year: ((d.release_date || d.first_air_date || '').slice(0, 4)) || null,
      cover: d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : undefined,
      description: d.overview || '',
      imdbId: (d.external_ids && d.external_ids.imdb_id) || null
    };
  });
}

function _tmdbSeasons(mediaType, tmdbId) {
  // For TV: get season/episode list from TMDB
  if (mediaType !== 'tv') return Promise.resolve(null);
  var key = _tmdbKey();
  if (!key) return Promise.resolve(null);
  var url = _TMDB_BASE + '/tv/' + tmdbId + '?api_key=' + encodeURIComponent(key);
  return _getJson(url).then(function (d) {
    return d.seasons || [];
  }, function () { return null; });
}

/* ---- Provider interface ---- */
function search(query, page, opts) {
  return _tmdbSearch(query, page || 1);
}

function getHome(opts) {
  var jobs = [];

  if (_cfg('catTmdb', true)) {
    var key = _tmdbKey();
    if (key) {
      // Trending movies + trending TV as home rows
      var trendingMovie = _getJson(_TMDB_BASE + '/trending/movie/week?api_key=' + encodeURIComponent(key))
        .then(function (d) {
          var items = [];
          var results = (d && d.results) || [];
          for (var i = 0; i < Math.min(results.length, 20); i++) {
            var r = results[i];
            if (!r.title) continue;
            items.push({
              id: 'cs://movie/' + r.id,
              title: r.title || r.original_title,
              url: 'cs://movie/' + r.id,
              type: 'movie',
              cover: r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : undefined,
              year: (r.release_date || '').slice(0, 4) || null
            });
          }
          return { title: 'Trending Movies', items: items };
        }, function () { return { title: 'Trending Movies', items: [] }; });

      var trendingTv = _getJson(_TMDB_BASE + '/trending/tv/week?api_key=' + encodeURIComponent(key))
        .then(function (d) {
          var items = [];
          var results = (d && d.results) || [];
          for (var i = 0; i < Math.min(results.length, 20); i++) {
            var r = results[i];
            if (!r.name) continue;
            items.push({
              id: 'cs://tv/' + r.id,
              title: r.name || r.original_name,
              url: 'cs://tv/' + r.id,
              type: 'movie',
              cover: r.poster_path ? 'https://image.tmdb.org/t/p/w500' + r.poster_path : undefined,
              year: (r.first_air_date || '').slice(0, 4) || null
            });
          }
          return { title: 'Trending TV Shows', items: items };
        }, function () { return { title: 'Trending TV Shows', items: [] }; });

      jobs.push(trendingMovie, trendingTv);
    }
  }

  if (_cfg('catCinemeta', true)) {
    // Top Movies / Top Series rows from the public Cinemeta catalogs
    // (same source as the original plugin's "CineStream" catalog).
    var topMovies = _getJson('https://cinemeta-catalogs.strem.io/top/catalog/movie/top/skip=0.json')
      .then(function (d) {
        return { title: 'Top Movies', items: _cinemetaItems((d && d.metas) || []) };
      }, function () { return { title: 'Top Movies', items: [] }; });
    var topSeries = _getJson('https://cinemeta-catalogs.strem.io/top/catalog/series/top/skip=0.json')
      .then(function (d) {
        return { title: 'Top Series', items: _cinemetaItems((d && d.metas) || []) };
      }, function () { return { title: 'Top Series', items: [] }; });
    jobs.push(topMovies, topSeries);
  }

  if (!jobs.length) return Promise.resolve([]);
  return Promise.all(jobs);
}

function _cinemetaItems(metas) {
  var items = [];
  for (var i = 0; i < Math.min(metas.length, 20); i++) {
    var m = metas[i] || {};
    var imdb = /^tt\d+$/.test(m.id || '') ? m.id : null;
    if (!m.name || !imdb) continue;
    items.push({
      id: 'cs://imdb/' + imdb,
      title: m.name,
      url: 'cs://imdb/' + imdb,
      type: 'movie',
      cover: m.poster || undefined,
      year: (m.releaseInfo || '').slice(0, 4) || null
    });
  }
  return items;
}

// Resolve an IMDb id to a TMDB id via the TMDB find endpoint.
function _tmdbFind(imdbId) {
  var key = _tmdbKey();
  var url = _TMDB_BASE + '/find/' + encodeURIComponent(imdbId) +
    '?api_key=' + encodeURIComponent(key) + '&external_source=imdb_id';
  return _getJson(url).then(function (d) {
    var mr = (d && d.movie_results) || [];
    var tr = (d && d.tv_results) || [];
    if (mr.length) return { mediaType: 'movie', tmdbId: String(mr[0].id) };
    if (tr.length) return { mediaType: 'tv', tmdbId: String(tr[0].id) };
    throw new Error('not found on TMDB: ' + imdbId);
  });
}

function _parseUrl(url) {
  // cs://imdb/<ttId> (Cinemeta rows; resolved via TMDB find in getDetail)
  var mi = /^cs:\/\/imdb\/(tt\d+)$/.exec(url || '');
  if (mi) return { mediaType: 'imdb', imdbId: mi[1], tmdbId: null, season: null, episode: null };
  // cs://<movie|tv>/<tmdbId>[/<season>/<episode>]
  var m = /^cs:\/\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/.exec(url || '');
  if (!m) return null;
  return {
    mediaType: m[1],
    tmdbId: m[2],
    season: m[3] ? parseInt(m[3], 10) : null,
    episode: m[4] ? parseInt(m[4], 10) : null
  };
}

function getDetail(url, opts) {
  var p = _parseUrl(url);
  if (!p) return Promise.reject(new Error('bad url: ' + url));
  var resolved = (p.mediaType === 'imdb')
    ? _tmdbFind(p.imdbId).then(function (r) {
        return { mediaType: r.mediaType, tmdbId: r.tmdbId, season: null, episode: null };
      })
    : Promise.resolve(p);
  return resolved.then(function (rp) {
    return _tmdbDetail(rp.mediaType, rp.tmdbId).then(function (meta) {
    var detail = {
      id: 'cs://' + rp.mediaType + '/' + rp.tmdbId,
      title: meta.title,
      url: url,
      type: 'movie',
      year: meta.year,
      cover: meta.cover,
      description: meta.description
    };
    if (rp.mediaType === 'movie') {
      // Single episode for movies
      var epUrl = 'cs://movie/' + rp.tmdbId + '/1/1';
      detail.episodes = [{ id: epUrl, title: meta.title, url: epUrl, number: 1 }];
      return detail;
    }
    // TV: fetch seasons to build episode list
    return _tmdbSeasons(rp.mediaType, rp.tmdbId).then(function (seasons) {
      var eps = [];
      if (seasons) {
        for (var i = 0; i < seasons.length; i++) {
          var s = seasons[i];
          if (!s.season_number || s.season_number < 1) continue;
          var count = s.episode_count || 0;
          for (var e = 1; e <= count; e++) {
            var eu = 'cs://tv/' + rp.tmdbId + '/' + s.season_number + '/' + e;
            eps.push({
              id: eu,
              title: 'S' + s.season_number + ' E' + e,
              url: eu,
              number: e
            });
          }
          if (eps.length >= 100) break; // cap for sanity
        }
      }
      if (!eps.length) {
        // Fallback: single episode
        var fu = 'cs://tv/' + rp.tmdbId + '/1/1';
        eps = [{ id: fu, title: 'S1 E1', url: fu, number: 1 }];
      }
      detail.episodes = eps;
      return detail;
      });
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}

/* ---- Sub-source scrapers (via enc-dec.app for server-side decrypt) ---- */

function _extractToken(page) {
  var m = /\\"(?:en|token)\\":\\"(.*?)\\"/.exec(String(page || ''));
  return m ? m[1] : null;
}

function _browserHeaders(baseUrl, extra) {
  var origin = /^(https?:)?\/\//.test(baseUrl || '') ? String(baseUrl).replace(/\/+$/, '') : 'https://vidcore.io';
  var headers = {
    'User-Agent': _UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Origin': origin,
    'Referer': origin + '/'
  };
  if (extra) {
    for (var key in extra) {
      headers[key] = extra[key];
    }
  }
  return headers;
}

function _fetchJsonWithBrowserFlow(url, init, label) {
  var requestInit = Object.assign({
    credentials: 'include',
    redirect: 'follow',
    cache: 'no-store'
  }, init || {});
  return fetch(url, requestInit).then(function (r) {
    if (!r.ok) {
      trace.log('stage.http_failed', { stage: label, status: r.status, origin: new URL(url).origin }, true);
      return null;
    }
    return r.text();
  });
}

function _scrapeVidfast(p) {
  if (!_cfg('srcVidfast', true)) return Promise.resolve([]);
  var base = 'https://vidfast.vc';
  var pageUrl = p.mediaType === 'movie'
    ? base + '/movie/' + p.tmdbId + '/'
    : base + '/tv/' + p.tmdbId + '/' + p.season + '/' + p.episode + '/';
  var headers = _browserHeaders(base, {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Dest': 'document'
  });
  return _getText(pageUrl, headers).then(function (page) {
    var token = _extractToken(page);
    if (!token) return [];
    return _getJson(_DECRYPT_API + '/enc-vidfast?text=' + encodeURIComponent(token) + '&stage=1').then(function (ij1) {
      var stage1 = (ij1 && ij1.result) || {};
      if (!stage1.stage1) return [];
      var h1 = _browserHeaders(base, {
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Dest': 'empty'
      });
      if (stage1.token) h1['X-CSRF-Token'] = stage1.token;
      return _fetchJsonWithBrowserFlow(stage1.stage1, { method: 'POST', headers: h1 }, 'Vidfast stage1').then(function (stage1Text) {
        if (!stage1Text) return [];
        return _getJson(_DECRYPT_API + '/enc-vidfast?text=' + encodeURIComponent(stage1Text) + '&stage=2').then(function (ij2) {
          var init = (ij2 && ij2.result) || {};
          if (!init.servers || !init.stream) return [];
          var h2 = _browserHeaders(base, {
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Dest': 'empty'
          });
          if (init.token) h2['X-CSRF-Token'] = init.token;
          return _fetchJsonWithBrowserFlow(init.servers, { method: 'POST', headers: h2 }, 'Vidfast servers').then(function (serversEnc) {
            if (!serversEnc) return [];
            return _postJson(_DECRYPT_API + '/dec-vidfast', { text: serversEnc });
          }).then(function (sj) {
            var servers = (sj && sj.result) || [];
            var jobs = [];
            for (var i = 0; i < Math.min(servers.length, 5); i++) {
              (function (server) {
                jobs.push(
                  _fetchJsonWithBrowserFlow(init.stream + '/' + server.data, { method: 'POST', headers: h2 }, 'Vidfast stream ' + (server.name || i + 1))
                    .then(function (streamEnc) {
                      if (!streamEnc) return null;
                      return _postJson(_DECRYPT_API + '/dec-vidfast', { text: streamEnc });
                    })
                    .then(function (stj) {
                      var data = (stj && stj.result) || {};
                      if (!data.url) return null;
                      var src = {
                        url: data.url,
                        container: /\.m3u8(\?|$)/i.test(data.url) ? 'hls' : 'mp4',
                        label: 'VidFast [' + (server.name || 'server') + ']',
                        headers: { 'Referer': base + '/' }
                      };
                      // Subtitles
                      var tracks = data.tracks || [];
                      var subs = [];
                      for (var t = 0; t < Math.min(tracks.length, 8); t++) {
                        if (tracks[t] && tracks[t].file) {
                          subs.push({
                            url: tracks[t].file,
                            lang: tracks[t].label || 'en',
                            label: (tracks[t].label || 'Subtitle') + ' [VidFast]'
                          });
                        }
                      }
                      if (subs.length) src.subtitles = subs;
                      return src;
                    }, function () { return null; })
                );
              })(servers[i]);
            }
            return Promise.all(jobs).then(function (results) {
              var out = [];
              for (var j = 0; j < results.length; j++) {
                if (results[j]) out.push(results[j]);
              }
              return out;
            });
          });
        });
      });
    });
  }, function () { return []; });
}

function _scrapeVidcore(p) {
  if (!_cfg('srcVidcore', true)) return Promise.resolve([]);
  var base = 'https://vidcore.io';
  var pageUrl = p.mediaType === 'movie'
    ? base + '/movie/' + p.tmdbId
    : base + '/tv/' + p.tmdbId + '/' + p.season + '/' + p.episode;
  var pageHeaders = _browserHeaders(base, {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Dest': 'document'
  });
  return _getText(pageUrl, pageHeaders).then(function (page) {
    var token = _extractToken(page);
    if (!token) return [];
    return _getJson(_DECRYPT_API + '/enc-vidcore?text=' + encodeURIComponent(token) + '&stage=1').then(function (ij1) {
      var stage1 = (ij1 && ij1.result) || {};
      if (!stage1.stage1) return [];
      var h1 = _browserHeaders(base, {
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Dest': 'empty'
      });
      if (stage1.token) h1['X-CSRF-Token'] = stage1.token;
      return _fetchJsonWithBrowserFlow(stage1.stage1, { method: 'POST', headers: h1 }, 'Vidcore stage1').then(function (stage1Text) {
        if (!stage1Text) return [];
        return _getJson(_DECRYPT_API + '/enc-vidcore?text=' + encodeURIComponent(stage1Text) + '&stage=2').then(function (ij2) {
          var init = (ij2 && ij2.result) || {};
          if (!init.servers || !init.stream) return [];
          var h2 = _browserHeaders(base, {
            'Accept': 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Dest': 'empty'
          });
          if (init.token) h2['X-CSRF-Token'] = init.token;
          return _fetchJsonWithBrowserFlow(init.servers, { method: 'POST', headers: h2 }, 'Vidcore servers').then(function (serversEnc) {
            if (!serversEnc) return [];
            return _postJson(_DECRYPT_API + '/dec-vidcore', { text: serversEnc });
          }).then(function (sj) {
            var servers = (sj && sj.result) || [];
            var jobs = [];
            for (var i = 0; i < Math.min(servers.length, 5); i++) {
              (function (server) {
                jobs.push(
                  _fetchJsonWithBrowserFlow(init.stream + '/' + server.data, { method: 'POST', headers: h2 }, 'Vidcore stream ' + (server.name || i + 1))
                    .then(function (streamEnc) {
                      if (!streamEnc) return null;
                      return _postJson(_DECRYPT_API + '/dec-vidcore', { text: streamEnc });
                    })
                    .then(function (stj) {
                      var data = (stj && stj.result) || {};
                      if (!data.url) return null;
                      var src = {
                        url: data.url,
                        container: /\.m3u8(\?|$)/i.test(data.url) ? 'hls' : 'mp4',
                        label: 'Vidcore [' + (server.name || 'server') + ']',
                        headers: { 'Referer': base + '/' }
                      };
                      var tracks = data.tracks || [];
                      var subs = [];
                      for (var t = 0; t < Math.min(tracks.length, 8); t++) {
                        if (tracks[t] && tracks[t].file) {
                          subs.push({
                            url: tracks[t].file,
                            lang: tracks[t].label || 'en',
                            label: (tracks[t].label || 'Subtitle') + ' [Vidcore]'
                          });
                        }
                      }
                      if (subs.length) src.subtitles = subs;
                      return src;
                    }, function () { return null; })
                );
              })(servers[i]);
            }
            return Promise.all(jobs).then(function (results) {
              var out = [];
              for (var j = 0; j < results.length; j++) {
                if (results[j]) out.push(results[j]);
              }
              return out;
            });
          });
        });
      });
    });
  }, function () { return []; });
}

function _scrapeVidlink(p) {
  if (!_cfg('srcVidlink', true)) return Promise.resolve([]);
  return _getJson(_DECRYPT_API + '/enc-vidlink?text=' + encodeURIComponent(p.tmdbId)).then(function (encRes) {
    var enc = encRes && encRes.result;
    if (!enc) return [];
    var apiUrl = 'https://vidlink.pro/api/b/' + (p.mediaType === 'movie' ? 'movie' : 'tv') + '/' + enc;
    if (p.mediaType === 'tv') apiUrl += '/' + p.season + '/' + p.episode;
    var headers = {
      'User-Agent': _UA,
      'Origin': 'https://vidlink.pro',
      'Referer': 'https://vidlink.pro/'
    };
    return _getJson(apiUrl, headers).then(function (d) {
      var out = [];
      if (d && d.stream) {
        var stream = d.stream;
        if (stream.playlist) {
          out.push({
            url: stream.playlist,
            container: 'hls',
            label: 'Vidlink [Primary HLS]',
            headers: { 'Referer': 'https://vidlink.pro/' }
          });
        }
        if (stream.qualities) {
          var qKeys = Object.keys(stream.qualities);
          for (var k = 0; k < qKeys.length; k++) {
            var q = qKeys[k];
            var item = stream.qualities[q];
            if (item && item.url) {
              out.push({
                url: item.url,
                container: item.type === 'mp4' ? 'mp4' : 'hls',
                quality: q + 'p',
                label: 'Vidlink [' + q + 'p ' + (item.type || 'mp4') + ']',
                headers: { 'Referer': 'https://vidlink.pro/' }
              });
            }
          }
        }
      }
      if (d && d.url) {
        out.push({
          url: d.url,
          container: /\.m3u8(\?|$)/i.test(d.url) ? 'hls' : 'mp4',
          label: 'Vidlink',
          headers: { 'Referer': 'https://vidlink.pro/' }
        });
      }
      return out;
    });
  }, function () { return []; });
}

/* ---- Indian mirrors: VegaMovies + 4KHDHub (per-language download links) ----
 * Each language (Hindi / English / Dual-Audio ...) is a separate download
 * link on these sites. The link label text is captured, the language is
 * detected from it, and each becomes its own VideoSource, e.g.
 * "VegaMovies [Hindi 720p]". Hub links resolve through the HubCloud
 * redirect chain (rot13 + nested base64), ported from CineStream's
 * HubCloud extractor. All cheerio traversals rewritten as regex
 * (cheerio does not exist in QuickJS).
 */

var _URLS_JSON = 'https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json';
var _DYN_CACHE = null;
var _DYN_AT = 0;

function _dynamicUrls() {
  var now = Date.now();
  if (_DYN_CACHE && now - _DYN_AT < 30 * 60 * 1000) return Promise.resolve(_DYN_CACHE);
  return _getJson(_URLS_JSON).then(function (d) {
    _DYN_CACHE = d || {};
    _DYN_AT = Date.now();
    return _DYN_CACHE;
  }, function () { return _DYN_CACHE || {}; });
}

function _dynUrl(key) {
  return _dynamicUrls().then(function (d) { return d[key] || ''; });
}

/* -- QuickJS-safe string helpers (no atob / Buffer / URL / TextEncoder) -- */
var _B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function _b64ToBytes(b64) {
  var clean = String(b64 || '').replace(/[^A-Za-z0-9+\/=]/g, '');
  var bytes = [];
  var i = 0;
  while (i < clean.length) {
    var e1 = _B64CHARS.indexOf(clean.charAt(i++));
    var e2 = _B64CHARS.indexOf(clean.charAt(i++));
    var e3 = _B64CHARS.indexOf(clean.charAt(i++));
    var e4 = _B64CHARS.indexOf(clean.charAt(i++));
    var n1 = (e1 << 2) | (e2 >> 4);
    var n2 = ((e2 & 15) << 4) | (e3 >> 2);
    var n3 = ((e3 & 3) << 6) | e4;
    bytes.push(n1);
    if (e3 !== 64) bytes.push(n2);
    if (e4 !== 64) bytes.push(n3);
  }
  return bytes;
}

function _b64DecodeUtf8(b64) {
  try {
    var bytes = _b64ToBytes(b64);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(out)); } catch (e2) { return out; }
  } catch (e) { return ''; }
}

function _b64EncodeUtf8(s) {
  var bytes = [];
  var enc = unescape(encodeURIComponent(String(s || '')));
  for (var i = 0; i < enc.length; i++) bytes.push(enc.charCodeAt(i));
  var out = '';
  for (var j = 0; j < bytes.length; j += 3) {
    var a = bytes[j];
    var b = j + 1 < bytes.length ? bytes[j + 1] : 0;
    var c = j + 2 < bytes.length ? bytes[j + 2] : 0;
    var n = (a << 16) | (b << 8) | c;
    out += _B64CHARS.charAt((n >> 18) & 63) + _B64CHARS.charAt((n >> 12) & 63);
    out += j + 1 < bytes.length ? _B64CHARS.charAt((n >> 6) & 63) : '=';
    out += j + 2 < bytes.length ? _B64CHARS.charAt(n & 63) : '=';
  }
  return out;
}

function _rot13(s) {
  return String(s || '').replace(/[a-zA-Z]/g, function (c) {
    var base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function _stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ');
}

function _clean(s) {
  return _decodeEntities(_stripTags(s)).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}

function _decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, n) {
      var cp = parseInt(n, 16);
      try { return String.fromCodePoint(cp); } catch (e) { return m; }
    })
    .replace(/&#(\d+);/g, function (m, n) {
      var cp = parseInt(n, 10);
      try { return String.fromCodePoint(cp); } catch (e) { return m; }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function _getBaseUrl(url) {
  var m = /^(https?:\/\/[^\/]+)/i.exec(String(url || ''));
  return m ? m[1] : String(url || '');
}

function _fixUrl(url, domain) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
  if (url.charAt(0) === '/') return domain + url;
  return domain + '/' + url;
}

/* All anchors on a page: [{href, text, raw}] */
function _anchorList(html) {
  var out = [];
  var re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a\s*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    out.push({ href: m[1], text: _clean(m[2]), raw: m[0] });
  }
  return out;
}

/* Balanced <div>...</div> block starting at a '<div' index. */
function _divBlock(html, startIdx) {
  var re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = startIdx;
  var depth = 0;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (m[0].charAt(1) === '/') depth--;
    else depth++;
    if (depth === 0) return html.substring(startIdx, m.index + m[0].length);
  }
  return html.substring(startIdx, startIdx + 8000);
}

/* Language detection from a download label, e.g.
 * "Deadpool (2016) ... [Hindi DDP 5.1 + English TrueHD Atmos 7.1]"
 * "{Hindi + English AAC 2.0} 480p BluRay" / "Dual Audio (Hindi + English)" */
function _detectLang(text) {
  var t = ' ' + String(text || '').toLowerCase() + ' ';
  var langs = [];
  function has(word) { return t.indexOf(word) !== -1; }
  if (has('hindi') || has(' hin ') || has('(hin)') || has('[hin]')) langs.push('Hindi');
  if (has('tamil')) langs.push('Tamil');
  if (has('telugu')) langs.push('Telugu');
  if (has('malayalam')) langs.push('Malayalam');
  if (has('kannada')) langs.push('Kannada');
  if (has('bengali')) langs.push('Bengali');
  if (has('punjabi')) langs.push('Punjabi');
  if (has('english') || has(' eng ') || has('(eng)') || has('[eng]')) langs.push('English');
  var s = langs.join(' + ');
  if (/multi[\s._-]*audio/.test(t)) return s ? 'Multi-Audio (' + s + ')' : 'Multi-Audio';
  if (/dual[\s._-]*audio/.test(t)) return s ? 'Dual-Audio (' + s + ')' : 'Dual-Audio';
  return s;
}

function _parseQuality(raw) {
  var s = String(raw == null ? '' : raw).toLowerCase();
  var m = s.match(/(\d{3,4})\s*p/);
  if (m) {
    var n = parseInt(m[1], 10);
    if (n >= 4000) return '8K';
    if (n >= 2000) return '4K';
    if (n >= 1000) return '1080p';
    if (n >= 700) return '720p';
    if (n >= 400) return '480p';
    if (n > 0) return '360p';
  }
  if (/\b8k\b/.test(s)) return '8K';
  if (/2160|4k|uhd/.test(s)) return '4K';
  if (/cam|ts|telesync|telecine|hdcam/.test(s)) return 'CAM';
  if (/\bhd\b/.test(s)) return '720p';
  return '';
}

/* Port of getRedirectLinks(): shortlink pages (greenmotors.club etc.)
 * hide the hub URL behind rot13 + triple-nested base64. */
function _hubGetRedirectLinks(url) {
  return _getText(url).then(function (doc) {
    var combined = '';
    var m;
    var re = /s\('o','([A-Za-z0-9+/=]+)'/g;
    while ((m = re.exec(doc)) !== null) combined += m[1];
    if (!combined) {
      var re2 = /ck\('_wp_http_\d+','([^']+)'/g;
      while ((m = re2.exec(doc)) !== null) combined += m[1];
    }
    if (!combined) return '';
    var decoded = _b64DecodeUtf8(_rot13(_b64DecodeUtf8(_b64DecodeUtf8(combined))));
    var obj;
    try { obj = JSON.parse(decoded); } catch (e) { return ''; }
    var encodedUrl = _b64DecodeUtf8(obj.o || '').replace(/^\s+|\s+$/g, '');
    var data = obj.data || '';
    var blogUrl = String(obj.blog_url || '').replace(/^\s+|\s+$/g, '');
    if (blogUrl && data) {
      return _getText(blogUrl + '?re=' + encodeURIComponent(_b64EncodeUtf8(data))).then(function (t) {
        var direct = String(t || '').replace(/^\s+|\s+$/g, '');
        return encodedUrl || direct;
      }, function () { return encodedUrl; });
    }
    return encodedUrl;
  }, function () { return ''; });
}

function _extractDoubleAtob(html) {
  var m = /var\s+url\s*=\s*atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/.exec(String(html || ''));
  if (!m) return '';
  try { return _b64DecodeUtf8(_b64DecodeUtf8(m[1])); } catch (e) { return ''; }
}

/* Port of Gofile.getUrl() happy path. */
function _hubResolveGofile(url, langLabel, source) {
  return fetch('https://api.gofile.io/accounts', {
    method: 'POST',
    headers: { 'User-Agent': _UA, 'Accept': 'application/json' }
  }).then(function (r) { return r.json(); }).then(function (acc) {
    var token = acc && acc.data && acc.data.token;
    var idm = /(?:d\/|\/d\/)([A-Za-z0-9-]+)/.exec(String(url || ''));
    var id = idm ? idm[1] : String(url || '').split('/').pop();
    if (!token || !id) return [];
    return fetch('https://api.gofile.io/contents/' + id + '?wt=4fd6sg89d7s6', {
      headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': _UA, 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (content) {
      var children = (content && content.data && content.data.children) || {};
      var files = [];
      for (var k in children) {
        if (children.hasOwnProperty(k)) files.push(children[k]);
      }
      var best = null;
      for (var i = 0; i < files.length; i++) {
        if (files[i] && files[i].link && /\.(mp4|mkv|m3u8)/i.test(files[i].link)) { best = files[i]; break; }
      }
      if (!best) best = files[0];
      if (!best || !best.link) return [];
      var s = _makeHubSource(source, langLabel, best.link, best.name || '', 'Gofile', '');
      return s ? [s] : [];
    }, function () { return []; });
  }, function () { return []; });
}

function _makeHubSource(source, langLabel, url, qualityText, server, referer) {
  if (!url || url.indexOf('http') !== 0) return null;
  var q = _parseQuality(qualityText || '');
  var lang = _detectLang((langLabel || '') + ' ' + (qualityText || ''));
  var parts = [];
  if (server) parts.push(server);
  if (lang) parts.push(lang);
  if (q) parts.push(q);
  return {
    url: url,
    container: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4',
    quality: q || undefined,
    label: source + (parts.length ? ' [' + parts.join(' ') + ']' : ''),
    headers: { 'User-Agent': _UA, 'Referer': referer || (_getBaseUrl(url) + '/') }
  };
}

/* Buzz Server pages hide the real link behind a .download-btn. */
function _hubBuzzDl(href, base) {
  return _getText(href).then(function (bHtml) {
    var m = /<[^>]*class="[^"]*download-btn[^"]*"[^>]*href="([^"]+)"/i.exec(bHtml) ||
            /<a[^>]*href="([^"]+)"[^>]*class="[^"]*download-btn[^"]*"/i.exec(bHtml);
    return m ? _fixUrl(m[1], base) : '';
  }, function () { return ''; });
}

/* Collect server buttons from a hub page2 (FSL / 10Gbps / Download File /
 * Mega / Buzz / Gofile / Pixeldrain). Button hrefs are signed URLs the
 * player follows at play time. */
function _hubExtractButtons(page2, page2Url, langLabel, name) {
  var header = '';
  var hm = /<div[^>]*class="[^"]*card-header[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i.exec(page2);
  if (hm) header = _clean(hm[1]);
  var cands = [];
  var gofileHrefs = [];
  var seen = {};
  var anchors = _anchorList(page2);
  for (var i = 0; i < anchors.length; i++) {
    var href = anchors[i].href;
    if (!href || seen[href]) continue;
    var text = anchors[i].text;
    var server = null;
    if (/FSLv2/i.test(text)) server = 'FSLv2';
    else if (/FSL Server/i.test(text)) server = 'FSL';
    else if (/Mega Server/i.test(text)) server = 'Mega';
    else if (/Download File/i.test(text)) server = 'Download';
    else if (/Server\s*:\s*10Gbps/i.test(text)) server = '10Gbps';
    else if (/Buzz Server/i.test(text)) server = 'Buzz';
    else if (/Gofile/i.test(text)) { gofileHrefs.push(href); seen[href] = true; continue; }
    else if (/pixeldra/i.test(href)) {
      var pxlm = /var\s+pxl\s*=\s*["']([^"']+)["']/.exec(page2);
      if (pxlm) {
        var pxl = pxlm[1];
        href = /download/i.test(pxl) ? pxl : _getBaseUrl(pxl) + '/api/file/' + pxl.split('/').pop() + '?download';
        server = 'Pixeldrain';
      }
    }
    if (!server) continue;
    seen[href] = true;
    cands.push({ href: href, server: server });
  }
  var prio = { '10Gbps': 0, 'FSL': 1, 'FSLv2': 1, 'Download': 2, 'Mega': 3, 'Pixeldrain': 4, 'Buzz': 5 };
  cands.sort(function (a, b) { return (prio[a.server] || 9) - (prio[b.server] || 9); });
  var jobs = [];
  var pageBase = _getBaseUrl(page2Url);
  for (var j = 0; j < Math.min(cands.length, 3); j++) {
    (function (c) {
      if (c.server === 'Buzz') {
        jobs.push(_hubBuzzDl(c.href, _getBaseUrl(c.href)).then(function (u) {
          var s = _makeHubSource(name, langLabel, u || c.href, header, c.server, pageBase + '/');
          return s ? [s] : [];
        }));
      } else if (/(?:hubcloud\.|gpdl\.hubcloud\.|vcloud\.)/i.test(c.href)) {
        // Some 4KHDHub terminal pages now expose gpdl.hubcloud.ist as
        // another link-generator layer. Resolve it instead of returning
        // the HTML endpoint as if it were playable media.
        jobs.push(_hubResolveCloudPage(c.href, langLabel, name));
      } else {
        var s = _makeHubSource(name, langLabel, c.href, header, c.server, pageBase + '/');
        jobs.push(Promise.resolve(s ? [s] : []));
      }
    })(cands[j]);
  }
  for (var g = 0; g < Math.min(gofileHrefs.length, 2); g++) {
    (function (u) {
      jobs.push(_hubResolveGofile(u, langLabel, name));
    })(gofileHrefs[g]);
  }
  return Promise.all(jobs).then(function (arrs) {
    var out = [];
    for (var a = 0; a < arrs.length; a++) {
      for (var b = 0; b < arrs[a].length; b++) out.push(arrs[a][b]);
    }
    return out;
  });
}

/* Port of HubCloud.getUrl() / VCloud core: drive page -> var url ->
 * terminal page -> server buttons. */
function _hubResolveCloudPage(url, langLabel, source) {
  var name = source || 'HubCloud';
  return _dynUrl(/vcloud/i.test(url) ? 'vcloud' : 'hubcloud').then(function (latest) {
    var baseUrl = _getBaseUrl(url);
    if (latest && baseUrl !== latest && !/(?:pixel|gpdl)\.hubcloud\.ist$/i.test(baseUrl)) {
      url = url.split(baseUrl).join(latest);
      baseUrl = latest;
    }
    return fetch(url, {
      headers: { 'User-Agent': _UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.text().then(function (doc) { return { doc: doc, finalUrl: r.url || url }; });
    });
  }).then(function (page) {
    var doc = page.doc;
    var pageUrl = page.finalUrl || url;
    // Current pixel.hubcloud terminals redirect to a link-generator page
    // whose final URL contains the real Google-hosted media URL as ?link=.
    // The old parser only looked for `var url = ...`, so it returned the
    // HTML interstitial instead of the playable file.
    var generated = /[?&]link=([^&]+)/i.exec(String(pageUrl || ''));
    if (generated) {
      var direct = generated[1];
      try { direct = decodeURIComponent(direct); } catch (e) {}
      if (/^https?:\/\/(?:[^/]*googleusercontent\.com|[^/]*\.m3u8(?:\?|$)|[^/]*\.(?:mp4|mkv)(?:\?|$))/i.test(direct)) {
        var directSource = _makeHubSource(name, langLabel, direct, direct, 'HubCloud', _getBaseUrl(pageUrl) + '/');
        if (directSource && /googleusercontent\.com/i.test(direct)) directSource.container = 'mkv';
        return directSource ? [directSource] : [];
      }
    }
    var link = '';
    if (url.indexOf('/video/') !== -1) {
      var vm = /<div[^>]*class="[^"]*\bvd\b[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i.exec(doc);
      link = vm ? vm[1].replace(/^\s+|\s+$/g, '') : '';
    } else if (/vcloud/i.test(url)) {
      link = _extractDoubleAtob(doc);
    } else {
      var m = /var url = '([^']*)'/.exec(doc);
      link = m ? m[1] : '';
    }
    if (!link) return [];
    if (link.indexOf('https://') !== 0) link = _getBaseUrl(url) + link;
    return _getText(link).then(function (page2) {
      return _hubExtractButtons(page2, link, langLabel, name);
    }, function () { return []; });
  }, function () { return []; });
}

/* Port of Hubdrive.getUrl(): success-button href -> terminal chain. */
function _hubResolveDrive(url, langLabel, source) {
  return _getText(url).then(function (html) {
    var m = /<a[^>]*class="[^"]*btn-success1[^"]*"[^>]*href="([^"]+)"/i.exec(html) ||
            /<a[^>]*href="([^"]+)"[^>]*class="[^"]*btn-success1[^"]*"/i.exec(html);
    var href = m ? m[1] : '';
    if (!href) return [];
    return _hubResolveLink(source, _fixUrl(href, _getBaseUrl(url)), langLabel);
  }, function () { return []; });
}

/* Route a scraped href through the right terminal. */
function _hubResolveLink(source, url, langLabel) {
  var u = String(url || '');
  if (!u) return Promise.resolve([]);
  if (/fastdl\.beer\/embed/i.test(u)) {
    return _getText(u).then(function (html) {
      var m = /href=["'](https?:\/\/fastdl\.beer\/dl\.php\?link=[^"']+)["']/i.exec(html) ||
              /(https?:\/\/fastdl\.beer\/dl\.php\?link=https?%3A%2F%2F[^"'\s<]+)/i.exec(html) ||
              /var\s+reurl\s*=\s*["'](https?:\/\/fastdl\.beer\/dl\.php\?link=[^"']+)["']/i.exec(html);
      if (!m) return [];
      var href = _decodeEntities(m[1]);
      var lm = /[?&]link=(https?:\/\/[^&"'\s<]+)/i.exec(href);
      var direct = lm ? lm[1] : href;
      try { direct = decodeURIComponent(direct); } catch (e) {}
      var s = _makeHubSource(source, langLabel, direct, direct, 'FastDL', _getBaseUrl(u) + '/');
      return s ? [s] : [];
    }, function () { return []; });
  }
  if (/hubdrive\./i.test(u)) return _hubResolveDrive(u, langLabel, source);
  if (/(?:hubcloud\.|gpdl\.hubcloud\.|vcloud\.)/i.test(u)) return _hubResolveCloudPage(u, langLabel, source);
  if (/gofile\.io\/d\//i.test(u)) return _hubResolveGofile(u, langLabel, source);
  if (/\.(mp4|mkv|m3u8)(\?|$)/i.test(u)) {
    var s = _makeHubSource(source, langLabel, u, u, '', '');
    return Promise.resolve(s ? [s] : []);
  }
  return Promise.resolve([]);
}

/* Resolve hub links 4-wide, cap 8 per source (signed links rot fast). */
function _resolveMany(source, links) {
  var queue = (links || []).slice(0, 8);
  var out = [];
  function runChunk(i) {
    if (i >= queue.length) return Promise.resolve(out);
    var jobs = [];
    for (var j = i; j < Math.min(i + 4, queue.length); j++) {
      (function (item) {
        jobs.push(_hubResolveLink(source, item.url, item.label).then(function (r) { return r; },
          function () { return []; }));
      })(queue[j]);
    }
    return Promise.all(jobs).then(function (results) {
      for (var k = 0; k < results.length; k++) {
        var arr = results[k] || [];
        for (var n = 0; n < arr.length; n++) out.push(arr[n]);
      }
      return runChunk(i + 4);
    });
  }
  return runChunk(0);
}

/* ---- VegaMovies ----
 * search.php (IMDb id, title fallback) -> detail page -> each <h5>
 * release heading (e.g. "{Hindi + English AAC 2.0} 480p BluRay") is
 * followed by its dwd-button link. Button pages list V-Cloud/hub links. */
function _scrapeVegamovies(p, meta) {
  if (!_cfg('srcVegamovies', true)) return Promise.resolve([]);
  var isTv = p.mediaType === 'tv';
  return _dynUrl('vegamovies').then(function (base) {
    if (!base) return [];
    var q = meta.imdbId || meta.title;
    if (!q) return [];
    return _getJson(base + '/search.php?q=' + encodeURIComponent(q) + '&page=1').then(function (sj) {
      var hits = (sj && sj.hits) || [];
      var permalink = '';
      var i, doc;
      if (meta.imdbId) {
        var bestScore = -1;
        for (i = 0; i < hits.length; i++) {
          doc = hits[i].document || hits[i];
          if ((doc.imdb_id || doc.imdbId) !== meta.imdbId) continue;
          var score = 0;
          if (isTv) {
            var listing = String(doc.post_title || '') + ' ' + String(doc.permalink || '');
            var wantedSeason = String(p.season);
            if (new RegExp('season\\s*' + wantedSeason + '\\b|s0?' + wantedSeason + '(?:e|\\b)', 'i').test(listing)) score = 5;
            var range = /season[-_\s]*(\d+)\s*[-–]&?[-_\s]*(\d+)/i.exec(listing);
            if (range && p.season >= parseInt(range[1], 10) && p.season <= parseInt(range[2], 10)) score = Math.max(score, 4);
          }
          if (score > bestScore) { bestScore = score; permalink = doc.permalink; }
        }
      }
      if (!permalink && meta.title) {
        var want = String(meta.title).toLowerCase();
        for (i = 0; i < hits.length; i++) {
          doc = hits[i].document || hits[i];
          var pt = String(doc.post_title || '').toLowerCase();
          if (pt.indexOf(want) !== -1 && (!meta.year || pt.indexOf(String(meta.year)) !== -1)) {
            permalink = doc.permalink; break;
          }
        }
      }
      if (!permalink) return [];
      return _getText(_fixUrl(permalink, base)).then(function (pageHtml) {
        if (!isTv) return _vegaMovieLinks(pageHtml, base);
        return _vegaTvLinks(pageHtml, base, p.season, p.episode);
      }).then(function (links) {
        return _resolveMany('VegaMovies', links);
      });
    }, function () { return []; });
  }, function () { return []; });
}

function _vegaMovieLinks(pageHtml, base) {
  var items = [];
  var hre = /<h5[^>]*>([\s\S]*?)<\/h5\s*>/gi;
  var m;
  while ((m = hre.exec(pageHtml)) !== null) {
    var label = _clean(m[1]);
    var winStart = m.index + m[0].length;
    var nextH = pageHtml.indexOf('<h5', winStart);
    var winEnd = nextH === -1 ? winStart + 2500 : nextH;
    var seg = pageHtml.substring(winStart, winEnd);
    var anchors = _anchorList(seg);
    for (var i = 0; i < anchors.length; i++) {
      if (/dwd-button/i.test(anchors[i].raw)) {
        items.push({ btn: _fixUrl(anchors[i].href, base), label: label });
        break;
      }
    }
    if (items.length >= 6) break;
  }
  var jobs = [];
  for (var j = 0; j < items.length; j++) {
    (function (item) {
      jobs.push(_getText(item.btn).then(function (sub) {
        var links = [];
        var anchors = _anchorList(sub);
        for (var k = 0; k < anchors.length; k++) {
          var h = anchors[k].href;
          if (/hubcloud|gpdl\.hubcloud|vcloud|hubdrive|gofile|\.(mp4|mkv|m3u8)/i.test(h)) {
            links.push({ url: _fixUrl(h, _getBaseUrl(item.btn)), label: item.label });
          }
        }
        return links;
      }, function () { return []; }));
    })(items[j]);
  }
  return Promise.all(jobs).then(function (arrs) {
    var out = [];
    for (var a = 0; a < arrs.length; a++) {
      for (var b = 0; b < arrs[a].length; b++) out.push(arrs[a][b]);
    }
    return out;
  });
}

function _vegaTvLinks(pageHtml, base, season, episode) {
  var links = [];
  var hre = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi;
  var m;
  var activeSeason = null;
  while ((m = hre.exec(pageHtml)) !== null) {
    var t = _clean(m[1]);
    var seasonMarker = /\bSeason\s*(\d+)\b/i.exec(t) || /\bS0?(\d+)\b/i.exec(t);
    if (seasonMarker) activeSeason = parseInt(seasonMarker[1], 10);
    if (activeSeason !== Number(season)) continue;
    var nextH = pageHtml.indexOf('<h', m.index + m[0].length);
    var end = nextH === -1 ? m.index + m[0].length + 6000 : nextH;
    var anchors = _anchorList(pageHtml.substring(m.index + m[0].length, end));
    for (var i = 0; i < anchors.length; i++) {
      if (/V-Cloud|G-Direct|Single|Episode/i.test(anchors[i].text)) {
        links.push({ url: _fixUrl(anchors[i].href, base), label: anchors[i].text + ' S' + season + ' E' + episode });
      }
    }
  }
  var jobs = [];
  for (var j = 0; j < Math.min(links.length, 4); j++) {
    (function (item) {
      jobs.push(_getText(item.url).then(function (sub) {
        var out = [];
        var hre2 = /<h4[^>]*>([\s\S]*?)<\/h4\s*>/gi;
        var m2;
        while ((m2 = hre2.exec(sub)) !== null) {
          var t2 = _clean(m2[1]);
          if (!new RegExp('Episodes?[^\\d]*0?' + episode + '\\b', 'i').test(t2)) continue;
          var nx = sub.indexOf('<h4', m2.index + m2[0].length);
          var en = nx === -1 ? m2.index + m2[0].length + 4000 : nx;
          var as2 = _anchorList(sub.substring(m2.index + m2[0].length, en));
          for (var k = 0; k < as2.length; k++) {
            if (/V-Cloud|Direct-Download|G-Direct/i.test(as2[k].text) || /fastdl\.beer|filebee\.xyz/i.test(as2[k].href)) {
              out.push({ url: _fixUrl(as2[k].href, base), label: item.label + ' ' + t2 });
            }
          }
        }
        return out;
      }, function () { return []; }));
    })(links[j]);
  }
  return Promise.all(jobs).then(function (arrs) {
    var out = [];
    for (var a = 0; a < arrs.length; a++) {
      for (var b = 0; b < arrs[a].length; b++) out.push(arrs[a][b]);
    }
    return out;
  });
}

/* ---- 4KHDHub ----
 * ?s=<title> search -> detail page -> download-item blocks. Each block's
 * file-title (e.g. "[Hindi DDP 5.1 + English TrueHD Atmos 7.1]") is the
 * language label; its buttons go through the shortlink decode chain. */
function _scrape4khdhub(p, meta) {
  if (!_cfg('src4khdhub', true)) return Promise.resolve([]);
  var isTv = p.mediaType === 'tv';
  return _dynUrl('4khdhub').then(function (base) {
    if (!base || !meta.title) return [];
    return _getText(base + '/?s=' + encodeURIComponent(meta.title)).then(function (searchHtml) {
      var want = String(meta.title).toLowerCase();
      var anchors = _anchorList(searchHtml);
      var href = '';
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        if (a.href.indexOf('/category/') === 0) continue;
        if (a.text.length < 15) continue;
        var t = a.text.toLowerCase();
        if (t.indexOf(want) !== -1 && (!meta.year || t.indexOf(String(meta.year)) !== -1)) { href = a.href; break; }
      }
      if (!href) return [];
      return _getText(_fixUrl(href, base)).then(function (pageHtml) {
        var items = isTv
          ? _4khdhubTvLinks(pageHtml, p.season, p.episode)
          : _4khdhubMovieLinks(pageHtml);
        return _4khdhubResolveButtons(items, base);
      });
    }, function () { return []; });
  }).then(function (links) {
    // Prefer HubCloud/VCloud terminals (verified working); HubDrive
    // currently lands on a login page and resolves to nothing.
    links.sort(function (a, b) {
      var ah = /(?:hubcloud\.|gpdl\.hubcloud\.|vcloud\.)/i.test(a.url) ? 0 : 1;
      var bh = /(?:hubcloud\.|gpdl\.hubcloud\.|vcloud\.)/i.test(b.url) ? 0 : 1;
      return ah - bh;
    });
    return _resolveMany('4KHDHub', links);
  }, function () { return []; });
}

function _4khdhubMovieLinks(pageHtml) {
  var items = [];
  var re = /<div[^>]*class="[^"]*\bdownload-item\b[^"]*"[^>]*>/gi;
  var m;
  while ((m = re.exec(pageHtml)) !== null) {
    var block = _divBlock(pageHtml, m.index);
    var ftm = /<div[^>]*class="[^"]*file-title[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i.exec(block);
    var label = ftm ? _clean(ftm[1]) : '';
    if (!label) {
      var htm = /<div[^>]*class="[^"]*download-header[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i.exec(block);
      label = htm ? _clean(htm[1]) : '';
    }
    var anchors = _anchorList(block);
    for (var i = 0; i < anchors.length; i++) {
      if (/btn/i.test(anchors[i].raw)) items.push({ href: anchors[i].href, label: label });
    }
    if (items.length >= 8) break;
  }
  return items;
}

function _4khdhubTvLinks(pageHtml, season, episode) {
  var items = [];
  var s = String(season);
  var e = String(episode);
  if (s.length < 2) s = '0' + s;
  if (e.length < 2) e = '0' + e;
  var code = ('s' + s + 'e' + e).toLowerCase();
  var re = /<div[^>]*class="[^"]*episode-download-item[^"]*"[^>]*>/gi;
  var m;
  while ((m = re.exec(pageHtml)) !== null) {
    var block = _divBlock(pageHtml, m.index);
    var ftm = /<div[^>]*class="[^"]*episode-file-title[^"]*"[^>]*>([\s\S]*?)<\/div\s*>/i.exec(block);
    var title = ftm ? _clean(ftm[1]) : '';
    if (title.toLowerCase().indexOf(code) === -1) continue;
    var anchors = _anchorList(block);
    for (var i = 0; i < anchors.length; i++) {
      if (/btn/i.test(anchors[i].raw)) items.push({ href: anchors[i].href, label: title });
    }
    if (items.length >= 8) break;
  }
  return items;
}

function _4khdhubResolveButtons(items, base) {
  var jobs = [];
  for (var i = 0; i < items.length; i++) {
    (function (it) {
      var href = _fixUrl(it.href, base);
      var job = /hubcloud|gpdl\.hubcloud|hubdrive|vcloud|gofile/i.test(href)
        ? Promise.resolve(href)
        : _hubGetRedirectLinks(href);
      jobs.push(job.then(function (u) {
        if (!u || !/hubcloud|gpdl\.hubcloud|hubdrive|vcloud|gofile|\.(mp4|mkv|m3u8)/i.test(u)) return [];
        return [{ url: u, label: it.label }];
      }, function () { return []; }));
    })(items[i]);
  }
  return Promise.all(jobs).then(function (arrs) {
    var out = [];
    for (var a = 0; a < arrs.length; a++) {
      for (var b = 0; b < arrs[a].length; b++) out.push(arrs[a][b]);
    }
    return out;
  });
}

function getVideoSources(episodeUrl) {
  var p = _parseUrl(episodeUrl);
  if (!p) return Promise.reject(new Error('bad url: ' + episodeUrl));
  if (!p.season) p.season = 1;
  if (!p.episode) p.episode = 1;

  // Indian mirrors need title/year/imdbId from TMDB (one extra call,
  // only when a mirror source is enabled).
  var mirrorJob;
  if (_cfg('srcVegamovies', true) || _cfg('src4khdhub', true)) {
    mirrorJob = _tmdbDetail(p.mediaType, p.tmdbId).then(function (meta) {
      return Promise.all([
        trace.source('VegaMovies', () => _scrapeVegamovies(p, meta)),
        trace.source('4KHDHub', () => _scrape4khdhub(p, meta))
      ]);
    }, function () { trace.log('metadata.failed', {}, true); return [[], []]; });
  } else {
    mirrorJob = Promise.resolve([[], []]);
  }

  // Fan out to all enabled sub-sources. Each job is fail-soft: a single
  // flaky sub-source must never abort the whole lookup.
  return Promise.all([
    _soft(trace.source('Vidfast', () => _scrapeVidfast(p))),
    _soft(trace.source('Vidcore', () => _scrapeVidcore(p))),
    _soft(trace.source('Vidlink', () => _scrapeVidlink(p))),
    _soft(mirrorJob)
  ]).then(function (results) {
    var out = [];
    var seen = {};
    var duplicates = 0;
    function pushArr(arr) {
      for (var j = 0; j < arr.length; j++) {
        var s = arr[j];
        if (s && s.url && seen[s.url]) duplicates++;
        if (s && s.url && !seen[s.url]) {
          seen[s.url] = true;
          out.push(s);
        }
      }
    }
    pushArr(results[0]);
    pushArr(results[1]);
    pushArr(results[2]);
    var m = results[3] || [];
    pushArr(m[0]);
    pushArr(m[1]);
    trace.log('sources.merged', { count: out.length, duplicates });
    if (!out.length) throw new Error('No streams found. Check TMDB API key in settings and source toggles.');
    return out;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getInfo, getSettings, getDetail, getEpisodes,
    getVideoSources: (...args) => trace.run(() => getVideoSources(...args)),
    getcinestreams: (...args) => trace.run(() => getcinestreams(...args)) };
}

// Registry adapter: source metadata/headers survive the shared normalizer.
async function getcinestreams(tmdbId, mediaType = 'movie', season = 1, episode = 1) {
  const type = String(mediaType).toLowerCase();
  if (!['movie', 'tv', 'series'].includes(type)) throw new Error('Unsupported CineStream media type');
  if (!/^\d+$/.test(String(tmdbId)) || Number(tmdbId) < 1) throw new Error('Invalid TMDB ID');
  const isTv = type !== 'movie';
  const seasonNum = season == null ? 1 : Number(season);
  const episodeNum = episode == null ? 1 : Number(episode);
  if (isTv && (!Number.isInteger(seasonNum) || seasonNum < 1 || !Number.isInteger(episodeNum) || episodeNum < 1)) {
    throw new Error('Invalid season or episode');
  }
  const url = `cs://${isTv ? 'tv' : 'movie'}/${tmdbId}/${isTv ? seasonNum : 1}/${isTv ? episodeNum : 1}`;
  const started = Date.now();
  trace.log('extraction.start', { tmdbId, type, season: isTv ? seasonNum : null, episode: isTv ? episodeNum : null });
  try {
    const sources = await getVideoSources(url);
    const streams = normalizeStreams(sources.filter(s => s && /^https?:\/\//i.test(s.url || '')).map(s => ({
      name: `CineStream - ${s.label || 'Stream'}`,
      title: s.label || 'CineStream',
      url: s.url,
      quality: s.quality || (String(s.label || '').match(/\b(\d{3,4}p)\b/i) || [])[1] || 'Auto',
      provider: 'cinestream',
      headers: { 'User-Agent': _UA, ...(s.headers || {}) },
      format: s.container || s.format,
      subtitles: s.subtitles || [],
    })), 'cinestream');
    trace.log('extraction.complete', { count: streams.length, elapsedMs: Date.now() - started });
    return streams;
  } catch (_) {
    trace.log('extraction.failed', { elapsedMs: Date.now() - started });
    return [];
  }
}
