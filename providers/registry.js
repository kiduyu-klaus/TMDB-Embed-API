const { config } = require('../utils/config');
const fs = require('fs');
const path = require('path');
const { normalizeStreams } = require('../utils/streamResponse');
const { addFallbackSubtitles: addWyzieSubtitles } = require('../utils/wyzieSubtitles');
const { addOpenSubtitlesFallback } = require('../utils/opensubtitles');

// Wyzie first, OpenSubtitles only when Wyzie came back empty. Both helpers
// attach to streams that arrived without subtitles and leave existing ones alone.
async function addFallbackSubtitles(streams, context) {
  const withWyzie = await addWyzieSubtitles(streams, context);
  const stillMissing = withWyzie.some(
    stream => stream && (!Array.isArray(stream.subtitles) || stream.subtitles.length === 0)
  );
  return stillMissing ? addOpenSubtitlesFallback(withWyzie, context) : withWyzie;
}

// Lazy load cache for providers
const providerCache = new Map();

// Function name mappings for existing providers
const providerFunctionMap = {
  'Showbox.js': 'getStreamsFromTmdbId',
  '4khdhub.js': 'get4KHDHubStreams',
  'vixsrc.js': 'getVixsrcStreams',
  'videasy.js': 'getVideasyStreams',
  'vidlink.js': 'getVidlinkStreams',
  'vidup.js': 'getVidupStreams',
  'vidlove.js': 'getVidloveStreams',
  'vidfast.js': 'getVidfastStreams',
  'cinesrc.js': 'getCinesrcStreams',
  'playimdb.js': 'getPlayimdbStreams',
  'meowtv.js': 'getMeowtvStreams',
  'dahmermovies.js': 'getDahmermoviesStreams',
  'goojara.js': 'getStreams',
  'streamflix.js': 'getStreamflixStreams',
  'vaplayer.js': 'getVaplayerStreams',
  'castletv.js': 'getCastletvStreams',
  'hdghartv.js': 'getHdghartvStreams',
  'netmirror.js': 'getNetmirrorStreams',
  'onetouchtv.js': 'getOnetouchtvStreams',
  'zxcstreams.js': 'getZxcstreamsStreams',
  'animekai.js': 'getAnimekaiStreams',
  'allwish.js': 'getStreams',
  'animesalt.js': 'getStreams',
  'moviebox.js': 'getMovieboxStreams',
};

// Every registered provider belongs to exactly one media category.
// New providers default to MoviesTv until explicitly classified otherwise.
const providerCategoryMap = {
  'Showbox.js': 'MoviesTv',
  '4khdhub.js': 'MoviesTv',
  'vixsrc.js': 'MoviesTv',
  'videasy.js': 'MoviesTv',
  'vidlink.js': 'MoviesTv',
  'vidup.js': 'MoviesTv',
  'vidlove.js': 'MoviesTv',
  'vidfast.js': 'MoviesTv',
  'cinesrc.js': 'MoviesTv',
  'playimdb.js': 'MoviesTv',
  'meowtv.js': 'MoviesTv',
  'dahmermovies.js': 'MoviesTv',
  'goojara.js': 'MoviesTv',
  'streamflix.js': 'MoviesTv',
  'vaplayer.js': 'MoviesTv',
  'castletv.js': 'MoviesTv',
  'hdghartv.js': 'MoviesTv',
  'netmirror.js': 'MoviesTv',
  'onetouchtv.js': 'MoviesTv',
  'zxcstreams.js': 'MoviesTv',
  'animekai.js': 'Anime',
  'allwish.js': 'Anime',
  'animesalt.js': 'Anime',
  'moviebox.js': 'MoviesTv',
};

// Stats for debug endpoint
let lastCookieStats = { selected: null, index: null, total: 0, remainingMB: null, timestamp: null };

async function getEffectiveCookies() {
  return Array.isArray(config.febboxCookies) ? config.febboxCookies : [];
}

// Get all provider files
function getProviderFiles() {
  const providersDir = path.join(__dirname);
  return fs.readdirSync(providersDir)
    .filter(file => file.endsWith('.js') && file !== 'registry.js')
    .map(file => ({
      name: path.parse(file).name.toLowerCase(),
      file: file,
      functionName: providerFunctionMap[file],
      category: providerCategoryMap[file] || 'MoviesTv'
    }));
}

// Load a provider module
function loadProvider(providerFile) {
  if (!providerCache.has(providerFile)) {
    try {
      providerCache.set(providerFile, require(path.join(__dirname, providerFile)));
    } catch (e) {
      console.error(`Failed to load provider ${providerFile}:`, e.message);
      return null;
    }
  }
  return providerCache.get(providerFile);
}

// Create fetch function for a provider
function createFetchFunction(providerInfo) {
  return async function(ctx) {
    const module = loadProvider(providerInfo.file);
    if (!module) return [];

    const funcName = providerInfo.functionName;
    if (!module[funcName]) {
      console.error(`Provider ${providerInfo.name} does not export ${funcName}`);
      return [];
    }

    try {
      const animeMovie = ctx.type === 'anime' && ctx.season == null && ctx.episode == null;
      const mediaType = ctx.type === 'movie' || animeMovie ? 'movie' : (ctx.type === 'anime' ? 'anime' : 'tv');
      const t0 = Date.now();

      let result;
      if (providerInfo.name === 'showbox') {
        // Special case for Showbox with TMDB key and cookies
        const { getTmdbApiKey } = require('../utils/tmdbKey');
        const tmdbApiKey = getTmdbApiKey();
        if (!tmdbApiKey) {
          console.warn('[registry] showbox skipped: TMDB API key missing');
          return [];
        }
        const cookies = await getEffectiveCookies();
        const previousConfig = global.currentRequestConfig;
        global.currentRequestConfig = { ...(previousConfig || {}) };
        let selected = null;
        if (cookies.length > 0) {
          const index = Math.floor(Math.random() * cookies.length);
          selected = cookies[index];
          global.currentRequestConfig.cookie = selected.startsWith('ui=') ? selected : `ui=${selected}`;
          global.currentRequestConfig.cookies = cookies.map(c => c.startsWith('ui=') ? c : `ui=${c}`);
          lastCookieStats = { selected: selected.slice(0, 16) + '...', index, total: cookies.length, remainingMB: null, timestamp: Date.now() };
          console.log(`[registry] Cookie random pick index=${index} total=${cookies.length}`);
        }
        result = await module[funcName](mediaType, ctx.tmdbId, ctx.season || null, ctx.episode || null, null, selected);
        if (global.currentRequestUserCookieRemainingMB != null) {
          lastCookieStats.remainingMB = global.currentRequestUserCookieRemainingMB;
        }
        global.currentRequestConfig = previousConfig || {};
      } else {
        // Standard provider call
        result = await module[funcName](ctx.tmdbId, mediaType, ctx.season || null, ctx.episode || null);
      }

      const durationMs = Date.now() - t0;
      console.log(`[registry] ${providerInfo.name} fetch duration ${durationMs}ms`);

      if (!Array.isArray(result)) return [];

      const streams = normalizeStreams(result, providerInfo.name);
      if (providerInfo.category !== 'MoviesTv') return streams;
      return await addFallbackSubtitles(streams, {
        tmdbId: ctx.tmdbId,
        imdbId: ctx.imdbId,
        type: ctx.type,
        season: ctx.season,
        episode: ctx.episode
      });

    } catch (e) {
      console.error(`[registry] ${providerInfo.name} fetch error:`, e.message);
      return [];
    }
  };
}

// Initialize providers - always load all; enabled state is checked dynamically from live config
const providerFiles = getProviderFiles();
const providers = [];

for (const providerInfo of providerFiles) {
  providers.push({
    name: providerInfo.name,
    category: providerInfo.category,
    fetch: createFetchFunction(providerInfo)
  });
  console.log(`[registry] ${providerInfo.name} provider loaded`);
}

function isProviderEnabled(name) {
  const flag = `enable${name.charAt(0).toUpperCase() + name.slice(1)}Provider`;
  return config[flag] !== false;
}

function listProviders() { return providers.map(p => ({ name: p.name, category: p.category, enabled: isProviderEnabled(p.name) })); }
function getProvider(name) {
  const p = providers.find(p => p.name === name.toLowerCase());
  if (!p) return null;
  return { ...p, enabled: isProviderEnabled(p.name) };
}

function getCookieStats() { return lastCookieStats; }

module.exports = { listProviders, getProvider, getCookieStats };
