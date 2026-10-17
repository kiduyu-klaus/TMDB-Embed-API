/**
 * CineJoy provider group A.
 * Shared implementation lives in cinejoy_core.js.
 */
const { getStreamsForServers } = require('../utils/cinejoy_core');
const diagnostics = require('../utils/providerTrace').createProviderTrace('CineJoy');

function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  const args = [tmdbId, mediaType, season, episode];
  return diagnostics.run(() => getStreamsImpl(...args), args);
}

function getStreamsImpl(tmdbId, mediaType, season, episode) {
  return getStreamsForServers(
    tmdbId,
    mediaType,
    season == null ? 1 : season,
    episode == null ? 1 : episode,
    ['Nebula', 'Scout', 'Solara'],
    diagnostics
  );
}

module.exports = { getStreams };
