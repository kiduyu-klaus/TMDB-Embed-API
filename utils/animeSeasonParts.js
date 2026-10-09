// Only remap episodes when the matching search results explicitly advertise parts.
function seasonNumbers(title) {
    return [...String(title || '').matchAll(/\bseason\s*(\d+)\b|\bs(\d+)\b|\b(\d+)(?:st|nd|rd|th)\s+season\b/gi)]
        .map(match => Number(match[1] || match[2] || match[3]));
}

function partNumber(title) {
    const match = String(title || '').match(/\bpart\s*(\d+)\b/i);
    return match ? Number(match[1]) : null;
}

function selectSeasonPart(results, episode, totalEpisodes) {
    if (!results.some(result => partNumber(result.title) !== null)) {
        return { results, episode, part: null };
    }
    // Unknown counts and splits into more than two parts cannot safely use halves.
    const count = Number(totalEpisodes);
    if (!Number.isInteger(count) || count < 2 || episode < 1 || episode > count ||
        results.some(result => partNumber(result.title) > 2)) {
        return { results: [], episode, part: null };
    }
    const halfway = Math.ceil(count / 2);
    const part = episode <= halfway ? 1 : 2;
    return {
        results: results.filter(result => (partNumber(result.title) || 1) === part),
        episode: part === 2 ? episode - halfway : episode,
        part
    };
}

module.exports = { seasonNumbers, partNumber, selectSeasonPart };
