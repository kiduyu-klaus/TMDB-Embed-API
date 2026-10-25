const axios = require('axios').create({ timeout: 30000 });
const json5 = require('json5');
const stringSimilarity = require('string-similarity');
const { getTmdbApiKey } = require('../utils/tmdbKey');

const FLIXCLOUD_BASE = 'https://flixcloud.cc';
const REANIME_BASE = 'https://reanime.to';
const ENC_DEC_API = 'https://enc-dec.app/api';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

const FLIXCLOUD_HEADERS = {
    'User-Agent': USER_AGENT,
    'Referer': `${FLIXCLOUD_BASE}/`
};

const REANIME_HEADERS = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
    'Referer': `${REANIME_BASE}/`
};

function validateEncDec(data, path) {
    if (!data || data.status !== 200) {
        console.warn(`[Flixcloud] enc-dec request failed at ${path}: status=${data?.status || 'unknown'}`);
        return null;
    }
    return data.result;
}

function normalizeSubtitles(subtitles) {
    if (!Array.isArray(subtitles)) return [];
    return subtitles.flatMap((subtitle, index) => {
        const url = subtitle?.url || subtitle?.file;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return [];
        const cleanUrl = url.trim();
        const extension = cleanUrl.split('?')[0].split('.').pop()?.toLowerCase();
        const format = subtitle.type || (extension === 'vtt' ? 'vtt' : 'srt');
        const mimeType = format === 'vtt' ? 'text/vtt' : 'application/x-subrip';
        const language = subtitle.language || subtitle.lang || subtitle.lan || 'und';
        const label = subtitle.label || subtitle.language || subtitle.lanName || 'Unknown';
        return [{
            id: subtitle.id || `flixcloud-subtitle-${index + 1}`,
            url: cleanUrl,
            mimeType,
            label,
            language,
            headers: {},
            lang: language,
            format
        }];
    });
}

function normalizeTitle(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function candidateTitles(candidate) {
    const title = candidate?.title || {};
    return [title.english, title.romaji, title.user_preferred, title.native]
        .filter(Boolean);
}

function titleScore(candidate, wantedTitle) {
    const normalizedWanted = normalizeTitle(wantedTitle);
    return Math.max(0, ...candidateTitles(candidate).map(title =>
        stringSimilarity.compareTwoStrings(normalizedWanted, normalizeTitle(title))
    ));
}

function isFormatCompatible(format, type) {
    const normalized = String(format || '').toUpperCase();
    return type === 'movie' ? normalized === 'MOVIE' : normalized !== 'MOVIE';
}

async function fetchTmdbMetadata(tmdbId, type) {
    const apiKey = getTmdbApiKey();
    if (!apiKey) throw new Error('TMDB API key is not configured');
    const response = await axios.get(`https://api.themoviedb.org/3/${type}/${encodeURIComponent(tmdbId)}`, {
        params: { api_key: apiKey },
        timeout: 30000
    });
    return {
        title: type === 'tv' ? response.data?.name : response.data?.title,
        year: Number(String(type === 'tv' ? response.data?.first_air_date : response.data?.release_date).slice(0, 4)) || null
    };
}

async function findReanimeCandidate(tmdbId, title, year, type, seasonNum) {
    const searchResponse = await axios.get(`${REANIME_BASE}/api/v1/search`, {
        headers: REANIME_HEADERS,
        params: { q: title, limit: 30, offset: 0 },
        timeout: 30000
    });
    const searchResults = Array.isArray(searchResponse.data?.results) ? searchResponse.data.results : [];
    const likelyResults = searchResults
        .filter(item => item?.anime_id && isFormatCompatible(item.format, type))
        .sort((a, b) => titleScore(b, title) - titleScore(a, title))
        .slice(0, 12);

    const detailResults = await Promise.all(likelyResults.map(async item => {
        try {
            const response = await axios.get(`${REANIME_BASE}/api/v1/anime/${encodeURIComponent(item.anime_id)}`, {
                headers: REANIME_HEADERS,
                timeout: 30000
            });
            return response.data;
        } catch (error) {
            console.warn(`[Flixcloud] ReAnime candidate ${item.anime_id} failed: ${error.message}`);
            return null;
        }
    }));
    const candidates = detailResults.filter(Boolean);
    const wantedTmdbId = Number(tmdbId);
    const wantedSeason = Number(seasonNum || 1);

    const exactMatches = candidates.filter(candidate => Number(candidate.themoviedb_id) === wantedTmdbId);
    if (type === 'tv') {
        const exactSeason = exactMatches.find(candidate =>
            Number(candidate.external_seasons?.tmdb || 1) === wantedSeason
        );
        if (exactSeason) return exactSeason;
    } else if (exactMatches.length > 0) {
        return exactMatches.sort((a, b) => titleScore(b, title) - titleScore(a, title))[0];
    }

    // Some ReAnime records do not carry a TMDB id. Only accept a very close
    // title/year match so an unrelated fuzzy search result is never returned.
    return candidates
        .filter(candidate => titleScore(candidate, title) >= 0.92)
        .filter(candidate => !year || !candidate.season_year || Math.abs(Number(candidate.season_year) - year) <= 1)
        .filter(candidate => type !== 'tv' || Number(candidate.external_seasons?.tmdb || 1) === wantedSeason)
        .sort((a, b) => titleScore(b, title) - titleScore(a, title))[0] || null;
}

async function findFlixcloudEmbedUrls(tmdbId, title, year, type, seasonNum, episodeNum) {
    let candidate = await findReanimeCandidate(tmdbId, title, year, type, seasonNum);
    if (!candidate) return [];

    let episode = type === 'movie' ? 1 : Number(episodeNum);
    let anilistId = Number(candidate.anilist_id || 0);
    if (!Number.isInteger(episode) || episode < 1 || anilistId < 1) return [];

    const fetchServers = async (id, episodeNumber) => axios.get(`${REANIME_BASE}/api/flix/${id}/${episodeNumber}`, {
        headers: REANIME_HEADERS,
        timeout: 30000
    });
    let response = await fetchServers(anilistId, episode);
    let servers = response.data?.success && Array.isArray(response.data.servers)
        ? response.data.servers
        : [];

    // TMDB numbers a split cour continuously (e.g. episodes 13-24), while
    // ReAnime exposes each cour as a separate 12-episode anime entry.
    const seasonEpisodeCount = Number(candidate.episodes_total);
    if (servers.length === 0 && type === 'tv' && seasonEpisodeCount > 0 && episode > seasonEpisodeCount) {
        const partTwo = await findReanimeCandidate(
            tmdbId,
            `${title} season ${seasonNum || 1} part 2`,
            year,
            type,
            seasonNum
        );
        const localEpisode = episode - seasonEpisodeCount;
        if (partTwo && Number(partTwo.anilist_id) !== anilistId && localEpisode > 0 &&
            (!partTwo.episodes_total || localEpisode <= Number(partTwo.episodes_total))) {
            response = await fetchServers(Number(partTwo.anilist_id), localEpisode);
            servers = response.data?.success && Array.isArray(response.data.servers)
                ? response.data.servers
                : [];
            if (servers.length > 0) {
                candidate = partTwo;
                episode = localEpisode;
                anilistId = Number(partTwo.anilist_id);
            }
        }
    }
    if (servers.length === 0) return [];

    const unique = new Map();
    for (const server of servers) {
        const value = server?.dataLink;
        if (typeof value !== 'string') continue;
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== 'https:' || parsed.hostname !== 'flixcloud.cc' || !parsed.pathname.startsWith('/e/')) continue;
            if (!unique.has(parsed.href)) unique.set(parsed.href, {
                url: parsed.href,
                serverName: server.serverName || 'Flixcloud',
                audioType: server.dataType || null
            });
        } catch (_) {
            // Ignore malformed catalog entries without losing other servers.
        }
    }
    return [...unique.values()];
}

async function resolveFlixcloudUrl(embedUrl) {
    const pageResponse = await axios.get(embedUrl, {
        headers: FLIXCLOUD_HEADERS,
        timeout: 30000
    });
    const html = typeof pageResponse.data === 'string' ? pageResponse.data : '';
    const match = html.match(/type:\s*["']data["']\s*,\s*data:\s*(\{.*?\})\s*,\s*uses:/s);
    if (!match) return null;

    let embeddedData;
    try {
        embeddedData = json5.parse(match[1]);
    } catch (error) {
        console.warn(`[Flixcloud] Embedded data parse failed: ${error.message}`);
        return null;
    }
    const subtitles = normalizeSubtitles(embeddedData.subtitles);
    delete embeddedData.subtitles;

    const tokenPath = `${ENC_DEC_API}/dec-flixcloud?type=token`;
    const tokenResponse = await axios.post(tokenPath, { data: embeddedData }, { timeout: 30000 });
    const tokenData = validateEncDec(tokenResponse.data, tokenPath);
    if (!tokenData?.token || !tokenData.context) return null;

    const encryptedResponse = await axios.get(`${FLIXCLOUD_BASE}/api/m3u8/${encodeURIComponent(tokenData.token)}`, {
        headers: FLIXCLOUD_HEADERS,
        timeout: 30000
    });
    const streamPath = `${ENC_DEC_API}/dec-flixcloud?type=stream`;
    const streamResponse = await axios.post(streamPath, {
        data: {
            context: tokenData.context,
            stream_response: encryptedResponse.data
        }
    }, { timeout: 30000 });
    const streamData = validateEncDec(streamResponse.data, streamPath);
    if (!streamData?.stream || !streamData.context?.w_payload) return null;

    const manifestUrl = `${ENC_DEC_API}/parse-flixcloud?${new URLSearchParams({
        url: streamData.stream,
        w_payload: streamData.context.w_payload
    })}`;
    return { manifestUrl, subtitles, headers: FLIXCLOUD_HEADERS };
}

async function isPlayableManifest(manifestUrl, headers) {
    try {
        const masterResponse = await axios.get(manifestUrl, {
            headers,
            timeout: 30000,
            responseType: 'text'
        });
        const masterText = String(masterResponse.data || '');
        if (!masterText.startsWith('#EXTM3U')) return false;
        const childLine = masterText.split(/\r?\n/).find(line => /^https?:\/\//i.test(line.trim()));
        if (!childLine) return false;

        const childUrl = new URL(childLine.trim(), manifestUrl).href;
        const mediaResponse = await axios.get(childUrl, {
            headers,
            timeout: 30000,
            responseType: 'text'
        });
        const mediaText = String(mediaResponse.data || '');
        if (!mediaText.startsWith('#EXTM3U')) return false;
        const segmentLine = mediaText.split(/\r?\n/).find(line => line && !line.startsWith('#'));
        if (!segmentLine) return false;

        const segmentUrl = new URL(segmentLine.trim(), childUrl).href;
        const segmentResponse = await axios.get(segmentUrl, {
            headers: { ...headers, Range: 'bytes=0-1023' },
            timeout: 30000,
            responseType: 'arraybuffer',
            maxContentLength: 128 * 1024,
            validateStatus: status => status === 200 || status === 206
        });
        return segmentResponse.data?.byteLength > 0;
    } catch (_) {
        return false;
    }
}

async function getFlixcloudStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const type = mediaType === 'tv' || mediaType === 'series' ? 'tv' : 'movie';
    console.log(`[Flixcloud] Fetching ${type} streams for TMDB ID: ${tmdbId}`);
    try {
        if (type === 'tv' && (!Number(seasonNum) || !Number(episodeNum))) {
            console.warn('[Flixcloud] TV request is missing season or episode');
            return [];
        }
        const metadata = await fetchTmdbMetadata(tmdbId, type);
        if (!metadata.title) return [];
        const embeds = await findFlixcloudEmbedUrls(
            tmdbId,
            metadata.title,
            metadata.year,
            type,
            seasonNum,
            episodeNum
        );
        if (embeds.length === 0) {
            console.log(`[Flixcloud] No matching ReAnime sources for TMDB ID: ${tmdbId}`);
            return [];
        }

        const resolvedResults = await Promise.all(embeds.map(async embed => {
            try {
                const resolved = await resolveFlixcloudUrl(embed.url);
                if (!resolved || !(await isPlayableManifest(resolved.manifestUrl, resolved.headers))) {
                    console.warn(`[Flixcloud] ${embed.serverName} returned an unplayable manifest`);
                    return null;
                }
                return { ...embed, ...resolved };
            } catch (error) {
                console.warn(`[Flixcloud] ${embed.serverName} resolution failed: ${error.message}`);
                return null;
            }
        }));
        const uniqueStreams = new Map();
        for (const stream of resolvedResults.filter(Boolean)) {
            if (uniqueStreams.has(stream.manifestUrl)) continue;
            const audioSuffix = stream.audioType ? ` ${stream.audioType.toUpperCase()}` : '';
            uniqueStreams.set(stream.manifestUrl, {
                name: `Flixcloud ${stream.serverName}${audioSuffix}`,
                title: `${metadata.title} - ${stream.serverName}${audioSuffix}`,
                url: stream.manifestUrl,
                quality: 'Auto',
                type: 'hls',
                provider: 'flixcloud',
                mimeType: 'application/vnd.apple.mpegurl',
                headers: stream.headers,
                subtitles: stream.subtitles
            });
        }
        console.log(`[Flixcloud] Total streams: ${uniqueStreams.size}`);
        return [...uniqueStreams.values()];
    } catch (error) {
        console.error(`[Flixcloud] Error: ${error.message}`);
        return [];
    }
}

module.exports = {
    getFlixcloudStreams,
    resolveFlixcloudUrl,
    findFlixcloudEmbedUrls,
    findReanimeCandidate
};
