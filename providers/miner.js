/* FrameXTV provider for Nuvio TV. No imports, Node APIs, or build step. */
(function () {
  'use strict';
  var API = 'https://api.framextv.tech';
  var PROVIDER = "miner";
  var LABEL = "Miner";
  var MOVY = 'https://api.wecollege.net';
  var MOVY_HEADERS = { Origin: 'https://www.movy.bz', Referer: 'https://www.movy.bz/' };

  function fetchWithin(url, options, milliseconds) {
    var work = Promise.resolve().then(function () { return fetch(url, options); });
    if (typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') return work;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('Request timeout')); }, milliseconds);
      work.then(function (value) { clearTimeout(timer); resolve(value); }, function (error) { clearTimeout(timer); reject(error); });
    });
  }
  // The website's public Miner client decodes encrypted JSON source responses.
  // Use 32-bit arithmetic so the same code works without BigInt or Math.imul.
  function multiply(a, b) {
    return ((a & 65535) * (b & 65535) + ((((a >>> 16) * (b & 65535) + (a & 65535) * (b >>> 16)) & 65535) << 16)) | 0;
  }
  function mix(n) {
    n = n >>> 0; n ^= n >>> 16; n = multiply(n, 2246822507); n ^= n >>> 13;
    n = multiply(n, 3266489909); return (n ^ (n >>> 16)) >>> 0;
  }
  function rotate(n, count) { count &= 31; return count ? ((n << count) | (n >>> (32 - count))) >>> 0 : n >>> 0; }
  function seedHash(seed) {
    var n = 2166136261;
    for (var i = 0; i < seed.length; i++) n = multiply(n ^ seed.charCodeAt(i), 16777619) >>> 0;
    return mix(n);
  }
  function cipherState(seed, id) {
    var state = { values: [], assigned: [], acc: 0 }, n = mix(seedHash(seed) ^ mix((id ^ 2654435769) >>> 0));
    for (var i = 0; i < 8; i++) {
      var slot = n % 61; n = rotate((n + 2654435769) >>> 0, 7 + (i & 7));
      state.values[slot] = (n ^ mix(n)) >>> 0; state.assigned[slot] = true; n = mix((n + slot) >>> 0);
    }
    state.acc = mix((2779096485 ^ n) >>> 0); return state;
  }
  function cipherWord(state, index) {
    var n = state.acc, slot = n % 61, mask = state.assigned[slot] ? 4294967295 : 0;
    var value = state.assigned[slot] ? state.values[slot] : 0;
    var c = (value ^ (multiply(index + 1, 2654435769) >>> 0)) >>> 0;
    n = mix(((rotate((((n ^ c) | (n & c & mask)) >>> 0) + n >>> 0, slot & 31) ^ rotate(n, (slot * 7) & 31)) + 2654435769) >>> 0);
    state.values[slot] = n; state.assigned[slot] = true; state.acc = n; return n;
  }
  function decodeSources(encoded, seed, id) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = [], bits = 0, acc = 0;
    encoded = String(encoded).trim().replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid source encoding');
    for (var i = 0; i < encoded.length; i++) {
      if (encoded.charAt(i) === '=') break;
      acc = (acc << 6) | alphabet.indexOf(encoded.charAt(i)); bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((acc >>> bits) & 255); }
    }
    if (bytes.length <= 4) throw new Error('Empty source response');
    var state = cipherState(seed, Number(id));
    for (var offset = 0, word = 0; offset < bytes.length; word++) {
      var key = cipherWord(state, word);
      for (var j = 0; j < 4 && offset < bytes.length; j++, offset++) bytes[offset] ^= (key >>> (j * 8)) & 255;
    }
    if (bytes.slice(0, 4).join(',') !== '109,118,109,49') throw new Error('Invalid source response');
    var escaped = '';
    bytes.slice(4).forEach(function (b) { escaped += '%' + ('0' + b.toString(16)).slice(-2); });
    return JSON.parse(decodeURIComponent(escaped));
  }
  function minerPayload(id, type, season, episode) {
    return fetchWithin(MOVY + '/seed?mediaId=' + encodeURIComponent(id), { headers: MOVY_HEADERS }, 20000).then(function (response) {
      if (!response.ok) throw new Error('Miner seed HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      if (!data || typeof data.seed !== 'string' || !data.seed) throw new Error('Miner seed unavailable');
      return Promise.all(['miami', 'atlanta', 'dallas'].map(function (city) {
        var url = MOVY + '/' + city + '/sources?mediaType=' + type + '&tmdbId=' + encodeURIComponent(id) + '&enc=2&seed=' + encodeURIComponent(data.seed);
        if (type === 'tv') url += '&seasonId=' + season + '&episodeId=' + episode;
        return fetchWithin(url, { headers: MOVY_HEADERS }, 12000).then(function (response) {
          if (!response.ok) throw new Error('Miner ' + city + ' HTTP ' + response.status);
          return response.text();
        }).then(function (body) {
          var decoded = decodeSources(body, data.seed, id);
          return { city: city, data: decoded };
        }).catch(function (error) { console.log('[FrameXTV Miner] ' + error.message); return null; });
      }));
    }).then(function (groups) {
      var payload = { success: true, provider: 'miner', sources: [], subtitles: [] };
      groups.forEach(function (group) {
        if (!group) return;
        (Array.isArray(group.data.sources) ? group.data.sources : []).forEach(function (source) {
          if (!source || !httpUrl(source.url) || /^(?:iframe|embed)$/i.test(source.type || '')) return;
          var playbackHeaders = headers(MOVY_HEADERS), extraHeaders = headers(source.headers);
          Object.keys(extraHeaders).forEach(function (key) { playbackHeaders[key] = extraHeaders[key]; });
          payload.sources.push({ url: source.url, quality: source.quality || 'Auto',
            type: source.type || (/\.mp4(?:[?#]|$)/i.test(source.url) ? 'mp4' : 'hls'),
            server: 'Miner XIX (' + group.city.charAt(0).toUpperCase() + group.city.slice(1) + ')',
            headers: playbackHeaders,
            subtitles: source.subtitles, audioTracks: source.audioTracks });
        });
        payload.subtitles = payload.subtitles.concat(Array.isArray(group.data.subtitles) ? group.data.subtitles : []);
      });
      if (!payload.sources.length) throw new Error('No Miner client streams');
      return payload;
    });
  }

  function httpUrl(value) {
    if (typeof value !== 'string') return '';
    value = value.trim();
    if (/^\/api\//.test(value)) return API + value;
    return /^https?:\/\//i.test(value) ? value : '';
  }

  function headers(value) {
    var result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    Object.keys(value).forEach(function (key) {
      if (typeof value[key] === 'string') result[key] = value[key];
    });
    return result;
  }

  function subtitles(value) {
    var seen = {};
    return (Array.isArray(value) ? value : []).map(function (item) {
      if (!item || typeof item !== 'object') return null;
      var url = httpUrl(item.url);
      if (!url || seen[url]) return null;
      seen[url] = true;
      return {
        id: url,
        url: url,
        language: item.language || item.lang || 'Unknown',
        name: item.label || 'FrameXTV',
        headers: headers(item.headers)
      };
    }).filter(function (item) { return item !== null; });
  }

  function normalize(payload) {
    if (!payload || payload.success === false || !Array.isArray(payload.sources)) return [];
    var seen = {};
    return payload.sources.map(function (source) {
      if (!source || typeof source !== 'object') return null;
      var url = httpUrl(source.url);
      // A web player cannot be played as a media stream by Nuvio.
      if (!url || source.type === 'iframe' || source.type === 'embed' || seen[url]) return null;
      seen[url] = true;
      var server = source.server || payload.provider || 'Auto';
      var quality = typeof source.quality === 'string' && source.quality.trim()
        ? source.quality : 'Auto';
      // Some API fields are server tags (dcloud/tcloud), not resolutions.
      var sourceTag = /(?:\d+p|\b4k\b|\bauto\b)/i.test(quality) ? '' : quality;
      if (sourceTag) quality = 'Unknown';
      var audio = (Array.isArray(source.audioTracks) ? source.audioTracks : []).map(function (track) {
        return track && (track.label || track.language);
      }).filter(Boolean).join(', ');
      var requestHeaders = headers(payload.headers);
      var sourceHeaders = headers(source.headers);
      Object.keys(sourceHeaders).forEach(function (key) { requestHeaders[key] = sourceHeaders[key]; });
      return {
        name: 'FrameXTV | ' + LABEL,
        title: 'FrameXTV | ' + server + (sourceTag ? ' (' + sourceTag + ')' : '') +
          ' | ' + quality + (audio ? ' | ' + audio : ''),
        quality: quality,
        _audio: audio,
        url: url,
        headers: requestHeaders,
        subtitles: subtitles((Array.isArray(payload.subtitles) ? payload.subtitles : [])
          .concat(Array.isArray(source.subtitles) ? source.subtitles : [])),
        _type: source.type
      };
    }).filter(function (item) { return item !== null; });
  }

  function resolveUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) return '';
    value = value.trim();
    // Resolve before invoking URL: Nuvio runtimes provide a limited URL shim.
    if (/^\/\//.test(value)) value = 'https:' + value;
    else if (!/^https?:\/\//i.test(value)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
      var parent = String(base || API + '/').split('#')[0];
      var origin = parent.match(/^https?:\/\/[^/?#]+/i);
      if (!origin) return '';
      if (value.charAt(0) === '?') value = parent.split('?')[0] + value;
      else if (value.charAt(0) === '#') value = parent + value;
      else if (value.charAt(0) === '/') value = origin[0] + value;
      else {
        parent = parent.split('?')[0];
        if (parent === origin[0]) parent += '/';
        value = parent.replace(/\/[^/]*$/, '/') + value;
      }
    }
    var parts = value.match(/^(https?:\/\/[^/?#]+)([^?#]*)([\s\S]*)$/i);
    if (!parts) return '';
    var path = parts[2] || '/', resolved = [];
    path.split('/').forEach(function (segment) {
      if (segment === '..') { if (resolved.length > 1) resolved.pop(); }
      else if (segment !== '.') resolved.push(segment);
    });
    var tail = /\/(?:\.|\.\.)$/.test(path) ? '/' : '';
    var finalPath = resolved.join('/') || '/';
    if (tail && finalPath.charAt(finalPath.length - 1) !== '/') finalPath += tail;
    value = parts[1] + finalPath + parts[3];
    try {
      var url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }

  function attributes(line) {
    var result = {};
    var regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    var match;
    while ((match = regex.exec(line))) result[match[1]] = match[2].replace(/^"|"$/g, '');
    return result;
  }

  function qualityLabel(attrs) {
    var resolution = String(attrs.RESOLUTION || '').match(/^(\d+)x(\d+)$/);
    if (!resolution) return '';
    var width = Number(resolution[1]);
    var height = Number(resolution[2]);
    // Cinematic streams are cropped: 1920x800 is still the 1080p tier.
    var tier = width >= 3840 ? 2160 : width >= 2560 ? 1440 : width >= 1920 ? 1080
      : width >= 1280 ? 720 : width >= 854 ? 480 : width >= 640 ? 360 : height;
    return (tier === 2160 ? '4K' : tier + 'p') +
      (attrs['VIDEO-RANGE'] && attrs['VIDEO-RANGE'] !== 'SDR' ? ' ' + attrs['VIDEO-RANGE'] : '');
  }

  function parseMaster(text, base) {
    if (!/^\s*#EXTM3U/.test(text)) return null;
    var lines = text.split(/\r?\n/);
    var variants = [];
    var audioGroups = {}, subtitleGroups = {};
    var pending = null;
    lines.forEach(function (line) {
      line = line.trim();
      if (line.indexOf('#EXT-X-MEDIA:') === 0) {
        var media = attributes(line);
        if (media.TYPE === 'AUDIO' && media.URI) audioGroups[media['GROUP-ID']] = true;
        if (media.TYPE === 'SUBTITLES' && media.URI) subtitleGroups[media['GROUP-ID']] = true;
      }
      if (line.indexOf('#EXT-X-STREAM-INF:') === 0) pending = attributes(line);
      else if (pending && line && line.charAt(0) !== '#') {
        var url = resolveUrl(line, base);
        if (url) variants.push({ url: url, quality: qualityLabel(pending),
          bandwidth: Number(pending.BANDWIDTH || 0), audioGroup: pending.AUDIO || '', subtitleGroup: pending.SUBTITLES || '' });
        pending = null;
      }
    });
    return { variants: variants, audioGroups: audioGroups, subtitleGroups: subtitleGroups };
  }

  function copyStream(stream, url, quality, extra) {
    return { name: stream.name, title: stream.title.split(' | ').slice(0, 2).join(' | ') +
      ' | ' + quality + (stream._audio ? ' | ' + stream._audio : '') + (extra ? ' | ' + extra : ''),
      quality: quality, url: url, type: stream._type || stream.type || '',
      headers: stream.headers, subtitles: stream.subtitles };
  }

  function expandQualities(stream) {
    var original = copyStream(stream, stream.url, stream.quality, 'API source');
    var isHls = stream._type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(stream.url);
    if (!isHls) return Promise.resolve([original]);
    return Promise.resolve().then(function () {
      return fetchWithin(stream.url, { headers: stream.headers }, 10000);
    }).then(function (response) {
      if (!response.ok) { var error = new Error('Playlist HTTP ' + response.status); error.status = response.status; throw error; }
      return response.text().then(function (text) { return { text: text, base: response.url || stream.url }; });
    }).then(function (response) {
      var master = parseMaster(response.text, response.base);
      // Drop confirmed HTML error pages. Retain API URLs when a probe fails.
      if (!master) return /^\s*(?:<!doctype|<html|[\[{])/i.test(response.text) ? [] : [original];
      if (!master.variants.length) return [original];
      var qualities = [];
      master.variants.forEach(function (variant) {
        if (variant.quality && qualities.indexOf(variant.quality) < 0) qualities.push(variant.quality);
      });
      var auto = copyStream(stream, stream.url, 'Auto', qualities.length ? qualities.join(' / ') : 'Adaptive');
      var seen = {};
      var output = [auto];
      master.variants.sort(function (a, b) { return b.bandwidth - a.bandwidth; }).forEach(function (variant) {
        // External audio/subtitle renditions need the parent master.
        if (master.audioGroups[variant.audioGroup] || master.subtitleGroups[variant.subtitleGroup]) return;
        if (seen[variant.url]) return;
        seen[variant.url] = true;
        var quality = variant.quality || (variant.bandwidth ?
          (variant.bandwidth / 1000000).toFixed(1) + ' Mbps' : 'Unknown');
        output.push(copyStream(stream, variant.url, quality,
          variant.bandwidth ? (variant.bandwidth / 1000000).toFixed(1) + ' Mbps' : ''));
      });
      return output;
    }).catch(function (error) {
      console.log('[FrameXTV ' + LABEL + '] Playlist: ' + error.message);
      if (error.status === 404 || error.status === 410) return [];
      return [original];
    });
  }

  function getStreams(tmdbId, mediaType, season, episode) {
    var type = String(mediaType || '').toLowerCase();
    if (type === 'series') type = 'tv';
    var id = String(tmdbId == null ? '' : tmdbId).replace(/^tmdb[:/]/i, '').trim();
    if ((type !== 'movie' && type !== 'tv') || !/^[1-9]\d*$/.test(id)) return Promise.resolve([]);
    var url = API + '/api/stream?type=' + type + '&id=' + encodeURIComponent(id);
    if (type === 'tv') {
      var s = String(season == null ? '' : season);
      var e = String(episode == null ? '' : episode);
      // Season 0 is valid for specials. Never silently request episode 1.
      if (!/^\d+$/.test(s) || !/^[1-9]\d*$/.test(e)) return Promise.resolve([]);
      url += '&season=' + encodeURIComponent(s) + '&episode=' + encodeURIComponent(e);
    }
    url += '&provider=' + encodeURIComponent(PROVIDER);
    var lookupStart = Date.now();
    function backend() {
      return fetchWithin(url, { headers: { Accept: 'application/json' } }, Math.min(18000, Math.max(1000, 45000 - (Date.now() - lookupStart)))).then(function (response) {
        if (!response.ok) throw new Error('API HTTP ' + response.status);
        return response.json();
      });
    }
    return minerPayload(id, type, season, episode).catch(function (error) {
      console.log('[FrameXTV Miner] Client lookup: ' + error.message); return backend();
    }).then(normalize).then(function (streams) {
      // Each FrameXTV provider is a separate Nuvio scraper, so one failed API
      // provider cannot discard the results from the other scrapers.
      return Promise.all(streams.map(expandQualities)).then(function (groups) {
        var result = [];
        var seen = {};
        groups.forEach(function (group) { group.forEach(function (stream) {
          if (!seen[stream.url]) { seen[stream.url] = true; result.push(stream); }
        }); });
        return result;
      });
    }).catch(function (error) {
      console.log('[FrameXTV] ' + (error && error.message ? error.message : 'Request failed'));
      return [];
    });
  }

  module.exports = { getStreams: getStreams };
}());
