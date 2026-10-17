/**
 * CineJoy provider group B.
 * Shared implementation lives in cinejoy_core.js.
 */
const { getStreamsForServers } = require('../utils/cinejoy_core');
const diagnostics = require('../utils/providerTrace').createProviderTrace('CineJoyTV');

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
    ['Lisbon', 'Riga', 'Athens']
  );
}

module.exports = { getStreams };
