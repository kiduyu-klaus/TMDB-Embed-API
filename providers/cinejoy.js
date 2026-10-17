/**
 * CineJoy provider group A.
 * Shared implementation lives in cinejoy_core.js.
 */
const { getStreamsForServers } = require('../utils/cinejoy_core');

function getStreams(tmdbId, mediaType = 'movie', season = null, episode = null) {
  return getStreamsForServers(
    tmdbId,
    mediaType,
    season == null ? 1 : season,
    episode == null ? 1 : episode,
    ['Nebula', 'Scout', 'Solara']
  );
}

module.exports = { getStreams };
