const { config } = require('../utils/config');
const fs = require('fs');
const path = require('path');
const { normalizeStreams } = require('../utils/streamResponse');
const { providerGate } = require('../utils/resourceLimits');
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

const standardProviderLabels = {
  cinejoy: 'Cinejoy',
  bower: 'Bowler',
  miner: 'Miner',
};

function standardizeNewProviderStreams(streams, providerName) {
  const label = standardProviderLabels[providerName];
  if (!label) return streams;
  return streams.map(stream => {
    let name = label;
    if (providerName === 'cinejoy') {
      const server = String(stream.name || stream.title || '').match(/Cinejoy(?:-TV)?\s*-\s*([^-|]+)/i);
      if (server) name = `${label} ${server[1].trim()}`;
    }
    const quality = String(stream.quality || 'Auto');
    return {
      ...stream,
      name,
      title: `${name} - ${quality}`,
      language: stream.language || 'Original',
      provider: label,
    };
  });
}

// Lazy load cache for providers
const providerCache = new Map();

// Function name mappings for existing providers
const providerFunctionMap = {
  'framextv.js': 'getStreams',
  'superstream.js': 'getSuperstreamStreams',
  'hdmovie2.js': 'getHdmovie2Streams',
  'vidbox.js': 'getVidboxStreams',
  'vidrock.js': 'getVidrockStreams',
  'cinestream.js': 'getcinestreams',
  'moviesdrive1.js': 'getMoviesDriveStreams',
  'dexter.js': 'getStreams',
  'Showbox.js': 'getStreamsFromTmdbId',
  '4khdhub.js': 'get4KHDHubStreams',
  'vixsrc.js': 'getVixsrcStreams',
  'videasy.js': 'getVideasyStreams',
  'vidlink.js': 'getVidlinkStreams',
  'vidlove.js': 'getVidloveStreams',
  'vidfast.js': 'getVidfastStreams',
  'vidfast1.js': 'getVidfast1Streams',
  'cinesrc.js': 'getCinesrcStreams',
  'playimdb.js': 'getPlayimdbStreams',
  'meowtv.js': 'getMeowtvStreams',
  'animeonsen.js': 'getStreams',
  'anikoto.js': 'getStreams',
  'megaplay.js': 'getStreams',
  'anizone.js': 'getStreams',
  'hianime.js': 'getStreams',
  'byse.js': 'getStreams',
  'dahmermovies.js': 'getDahmermoviesStreams',
  'streamflix.js': 'getStreamflixStreams',
  'vaplayer.js': 'getVaplayerStreams',
  'castletv.js': 'getCastletvStreams',
  'hdghartv.js': 'getHdghartvStreams',
  'netmirror.js': 'getNetmirrorStreams',
  'onetouchtv.js': 'getOnetouchtvStreams',
  'zxcstreams.js': 'getZxcstreamsStreams',
  'animekai.js': 'getAnimekaiStreams',
  'reanime.js': 'getStreams',
  'allwish.js': 'getStreams',
  'animesalt.js': 'getStreams',
  'moviebox.js': 'getStreams',
  'desiflix.js': 'getStreams',
  'anime-dekho.js': 'getStreams',
  'animekhor.js': 'getStreams',
  'kickassanime.js': 'getStreams',
  'flixcloud.js': 'getFlixcloudStreams',
  'cinejoy.js': 'getStreams',
  'cinejoytv.js': 'getStreams',
  'bower.js': 'getStreams',
  'miner.js': 'getStreams',
  'valkyrie.js': 'getStreams',
  'titan.js': 'getStreams',
  'Barbarian.js': 'getStreams',
  'vidsrc.js': 'getVidsrcStreams',
  'anv.js': 'getStreams',
  'kisskh.js': 'getKisskhStreams',
  'watchanimeworld.js': 'getStreams',
  'WcoFlix.js': 'getStreams',
  'vegamovies.js': 'getStreams',
  'vidbolt.js': 'getStreams',
  'anikage.js': 'getStreams',
  'animepika.js': 'getStreams',
  'MoviesHunt.js': 'getStreams',
  'moviesjoy.js': 'getmoviesjoyStreams',
  'mapple.js': 'getStreams',
  'noxpulse.js': 'getStreams',
  'movix.js': 'getStreams',
  'bingebang.js': 'getStreams',
  'uhdmovies.js': 'getStreams',

};

// Providers may belong to more than one media category.
// For backward compatibility, category remains the first (primary) category;
// categories contains the full set for consumers that need multi-category mapping.
const providerCategoryMap = {
  'framextv.js': 'MoviesTv',
  'superstream.js': 'MoviesTv',
  'hdmovie2.js': 'MoviesTv',
  'vidbox.js': 'MoviesTv',
  'vidrock.js': 'MoviesTv',
  'cinestream.js': 'MoviesTv',
  'moviesdrive1.js': 'MoviesTv',
  'dexter.js': 'MoviesTv',
  'Showbox.js': 'MoviesTv',
  '4khdhub.js': 'MoviesTv',
  'vixsrc.js': 'MoviesTv',
  'videasy.js': 'MoviesTv',
  'vidlink.js': 'MoviesTv',
  'vidlove.js': 'MoviesTv',
  'vidfast.js': 'MoviesTv',
  'vidfast1.js': 'MoviesTv',
  'cinesrc.js': 'MoviesTv',
  'playimdb.js': 'MoviesTv',
  'meowtv.js': 'MoviesTv',
  'animeonsen.js': 'Anime',
  'anikoto.js': 'Anime',
  'megaplay.js': 'Anime',
  'anizone.js': 'Anime',
  'hianime.js': 'Anime',
  'byse.js': 'MoviesTv',
  'dahmermovies.js': 'MoviesTv',
  'streamflix.js': 'MoviesTv',
  'vaplayer.js': 'MoviesTv',
  'castletv.js': 'MoviesTv',
  'hdghartv.js': 'MoviesTv',
  'netmirror.js': 'MoviesTv',
  'onetouchtv.js': 'MoviesTv',
  'zxcstreams.js': 'MoviesTv',
  'animekai.js': 'Anime',
  'reanime.js': 'Anime',
  'allwish.js': 'Anime',
  'animesalt.js': 'Anime',
  'moviebox.js': ['MoviesTv', 'Anime'],
  'kisskh.js': ['MoviesTv', 'Anime'],
  'desiflix.js': 'MoviesTv',
  'anime-dekho.js': 'Anime',
  'animekhor.js': 'Anime',
  'kickassanime.js': 'Anime',
  'flixcloud.js': 'Anime',
  'cinejoy.js': 'MoviesTv',
  'cinejoytv.js': 'MoviesTv',
  'bower.js': 'MoviesTv',
  'miner.js': 'MoviesTv',
  'valkyrie.js': 'MoviesTv',
  'titan.js': 'MoviesTv',
  'Barbarian.js': 'MoviesTv',
  'vidsrc.js': 'MoviesTv',
  'anv.js': 'Anime',
  'watchanimeworld.js': 'Anime',
  'WcoFlix.js': 'Anime',
  'vegamovies.js': 'MoviesTv',
  'vidbolt.js': 'MoviesTv',
  'anikage.js': 'Anime',
  'animepika.js': 'Anime',
  'MoviesHunt.js': 'MoviesTv',
  'moviesjoy.js': 'MoviesTv',
  'mapple.js': 'MoviesTv',
  'noxpulse.js': 'MoviesTv',
  'movix.js': 'MoviesTv',
  'bingebang.js': ['MoviesTv', 'Anime'], 
  'uhdmovies.js': 'MoviesTv',
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
    .map(file => {
      const mappedCategories = providerCategoryMap[file] || 'MoviesTv';
      const categories = Array.isArray(mappedCategories) ? mappedCategories : [mappedCategories];
      return {
        name: path.parse(file).name.toLowerCase(),
        file: file,
        functionName: providerFunctionMap[file],
        category: categories[0],
        categories
      };
    });
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

    let release;
    try {
      release = await providerGate.acquire();
      const animeMovie = ctx.type === 'anime' && ctx.season == null && ctx.episode == null;
      // Anime series is TV on TMDB, so providers get 'tv' rather than 'anime'
      // and don't each have to special-case it. Anime movies still map to 'movie'.
      const mediaType = ctx.type === 'movie' || animeMovie ? 'movie' : 'tv';
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

      const streams = standardizeNewProviderStreams(
        normalizeStreams(result, providerInfo.name),
        providerInfo.name
      );
      if (!providerInfo.categories.includes('MoviesTv')) return streams;
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
    } finally {
      release?.();
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
    categories: providerInfo.categories,
    fetch: createFetchFunction(providerInfo)
  });
  console.log(`[registry] ${providerInfo.name} provider loaded`);
}

function isProviderEnabled(name) {
  const flag = `enable${name.charAt(0).toUpperCase() + name.slice(1)}Provider`;
  return config[flag] !== false;
}

function listProviders() { return providers.map(p => ({ name: p.name, category: p.category, categories: p.categories, enabled: isProviderEnabled(p.name) })); }
function getProvider(name) {
  const p = providers.find(p => p.name === name.toLowerCase());
  if (!p) return null;
  return { ...p, enabled: isProviderEnabled(p.name) };
}

function getCookieStats() { return lastCookieStats; }

module.exports = { listProviders, getProvider, getCookieStats };
