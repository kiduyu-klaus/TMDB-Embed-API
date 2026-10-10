function applyAnimeStreamHeaders(stream) {
    try {
        if (new URL(stream.url).hostname !== 'fetch.nexabloom.top') return stream;
    } catch {
        return stream;
    }
    const headers = Object.fromEntries(Object.entries(stream.headers || {}).filter(
        ([name]) => !['user-agent', 'referer', 'origin'].includes(name.toLowerCase())
    ));
    return {
        ...stream,
        headers: {
            ...headers,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://megaplay.buzz/',
            Origin: 'https://megaplay.buzz'
        }
    };
}

module.exports = { applyAnimeStreamHeaders };
