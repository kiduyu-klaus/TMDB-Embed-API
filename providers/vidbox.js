const axios = require('axios');
const cheerio = require('cheerio');
const { getDetails } = require('../utils/tmdb');

const API_BASE = "https://h5-api.aoneroom.com/wefeed-h5api-bff";

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Referer": "https://moviebox.ph/",
    "Origin": "https://moviebox.ph",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Request-Lang": "en",
    "Accept": "application/json",
    "Content-Type": "application/json",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site"
};

const PLAYER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "X-Client-Info": '{"timezone":"Asia/Dhaka"}',
    "X-Source": "",
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
};

let cachedToken = null;
let tokenExpiry = 0;

// Helper to clean/normalize text for similarity comparison
function normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
        .replace(/\[[^\]]+\]/g, '') // remove bracket info e.g. [English]
        .replace(/\([^)]*\)/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function getGuestToken() {
    if (cachedToken && Date.now() < tokenExpiry) {
        return cachedToken;
    }

    try {
        const resp = await axios.get(`${API_BASE}/home?host=moviebox.ph`, {
            headers: DEFAULT_HEADERS,
            timeout: 10000
        });

        let token = null;

        // Try x-user header first (preferred)
        const xUserHeader = resp.headers['x-user'];
        if (xUserHeader) {
            try {
                const parsed = JSON.parse(xUserHeader);
                token = parsed.token;
            } catch (parseErr) {
                console.warn("[Vidbox] Failed to parse x-user header:", parseErr.message);
            }
        }

        // Fallback to set-cookie parsing
        if (!token) {
            const setCookie = resp.headers['set-cookie'];
            if (setCookie) {
                const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;
                const match = cookieStr.match(/token=([^;]+)/);
                if (match) {
                    token = match[1];
                }
            }
        }

        if (token) {
            cachedToken = token;
            // Token is a JWT, usually valid for hours/days. Set safe local expiry to 1 hour.
            tokenExpiry = Date.now() + 60 * 60 * 1000;
            console.log("[Vidbox] Guest token obtained successfully");
            return token;
        } else {
            console.warn("[Vidbox] No token found in x-user header or set-cookie");
            console.log("[Vidbox] Response headers:", JSON.stringify(resp.headers));
        }
    } catch (e) {
        console.error("[Vidbox] Failed to fetch guest token:", e.message);
    }
    return null;
}

async function searchMovieBoxPage(keyword, authHeaders) {
    try {
        const response = await axios.get('https://moviebox.ph/web/searchResult', {
            params: { keyword },
            headers: DEFAULT_HEADERS,
            timeout: 15000
        });
        const $ = cheerio.load(response.data);
        const paths = [...new Set($('a[href^="/moviedetail/"]').map((_, element) =>
            String($(element).attr('href') || '').replace(/^\/moviedetail\//, '').trim()
        ).get().filter(Boolean))].slice(0, 12);

        const details = await Promise.all(paths.map(async detailPath => {
            try {
                const response = await axios.get(`${API_BASE}/detail`, {
                    params: { detailPath },
                    headers: authHeaders,
                    timeout: 10000
                });
                const subject = response.data?.data?.subject;
                if (!subject?.subjectId) return null;
                return { ...subject, detailPath: subject.detailPath || detailPath };
            } catch {
                return null;
            }
        }));
        return details.filter(Boolean);
    } catch (error) {
        console.warn(`[Vidbox] HTML search fallback failed: ${error.message}`);
        return [];
    }
}

async function getVidboxStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[Vidbox] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}`);

    try {
        // 1. Fetch details from TMDB to get the title and release year
        const details = await getDetails(mediaType, tmdbId);
        if (!details) {
            console.error("[Vidbox] Failed to retrieve details from TMDB.");
            return [];
        }

        // Prefer original_title for better matching against the search index
        // Fall back to title/name if original is not available
        const originalTitle = details.original_title || details.original_name || details.title || details.name || '';
        const displayTitle = details.title || details.name || originalTitle;
        const releaseDate = mediaType === 'movie' ? details.release_date : details.first_air_date;
        const releaseYear = releaseDate ? releaseDate.split('-')[0] : '';

        if (!originalTitle) {
            console.error("[Vidbox] TMDB did not return a valid title/name.");
            console.error("[Vidbox] Details:", JSON.stringify(details).slice(0, 200));
            return [];
        }

        console.log(`[Vidbox] TMDB Title: "${originalTitle}" (${releaseYear}) | Display: "${displayTitle}"`);

        // 2. Get the auth guest token
        const token = await getGuestToken();
        if (!token) {
            console.error("[Vidbox] No authentication token available.");
            return [];
        }

        const authHeaders = {
            ...DEFAULT_HEADERS,
            "Authorization": `Bearer ${token}`
        };

        // 3. Search for the title on the BFF API — try both original and display title
        let items = [];
        const titlesToTry = [originalTitle, displayTitle].filter((v, i, a) => v && a.indexOf(v) === i);

        for (const searchTitle of titlesToTry) {
            if (items.length > 0) break; // stop if we already found results
            console.log(`[Vidbox] Searching for: "${searchTitle}"`);
            try {
                const searchResp = await axios.post(`${API_BASE}/subject/search`, {
                    keyword: searchTitle,
                    page: 1,
                    perPage: 20
                }, { headers: authHeaders, timeout: 10000 });

                items = searchResp.data?.data?.items || [];
                if (items.length > 0) {
                    console.log(`[Vidbox] Search for "${searchTitle}" returned ${items.length} item(s)`);
                }
            } catch (searchErr) {
                console.warn(`[Vidbox] Search for "${searchTitle}" failed: ${searchErr.message}`);
            }
        }

        if (items.length === 0) {
            console.log('[Vidbox] API search was rejected; trying the public search page');
            items = await searchMovieBoxPage(originalTitle, authHeaders);
            console.log(`[Vidbox] Public search returned ${items.length} item(s)`);
        }

        if (items.length === 0) {
            console.log(`[Vidbox] No search results returned for keyword: "${originalTitle}"`);
            return [];
        }

        // Normalize the TMDB original title for comparison
        const normalizedTarget = normalizeTitle(originalTitle);

        // Filter and find matching items (could be multiple for different dubs)
        // Use looser matching: just remove brackets and alphanumerics
        const matchedItems = items.filter(item => {
            const normalizedItem = normalizeTitle(item.title);
            // Require the complete normalized title. Prefix-only matching caused
            // unrelated results such as "Fight of Fury" to match "Fight Club".
            const itemYearMatch = item.title ? item.title.match(/\((\d{4})\)/) : null;
            const itemYear = itemYearMatch ? itemYearMatch[1] : null;
            const yearMatch = !itemYear || !releaseYear || itemYear === releaseYear;

            return yearMatch && normalizedItem === normalizedTarget;
        });

        if (matchedItems.length === 0) {
            console.log(`[Vidbox] No search items matched the target title: "${originalTitle}"`);
            console.log(`[Vidbox] Available items:`, items.map(i => i.title).slice(0, 5).join(', '));
            return [];
        }

        console.log(`[Vidbox] Found ${matchedItems.length} matching search candidate(s).`);

        // Get media player domain (netfilm.world or movibox.net)
        let playerDomain = "https://netfilm.world";
        try {
            const domResp = await axios.get(`${API_BASE}/media-player/get-domain`, { headers: authHeaders, timeout: 8000 });
            if (domResp.data?.data) {
                playerDomain = domResp.data.data.replace(/\/$/, "");
                console.log(`[Vidbox] Player domain: ${playerDomain}`);
            }
        } catch (domErr) {
            console.warn("[Vidbox] Failed to retrieve player domain, falling back to netfilm.world:", domErr.message);
        }

        // 4. Resolve streams for each matched item (dub) in parallel
        const streamPromises = matchedItems.map(async (item) => {
            const itemStreams = [];
            try {
                const subjectId = item.subjectId;
                const detailPath = item.detailPath;
                const itemTitle = item.title;

                // Determine dub label from search item title (e.g. "One Piece [English]" -> "English")
                let dubLabel = "Sub/Original";
                const dubMatch = itemTitle.match(/\[([^\]]+)\]/);
                if (dubMatch) {
                    dubLabel = dubMatch[1];
                }

                // Fetch the detail of the item to get seasons/episodes structure
                const detailResp = await axios.get(`${API_BASE}/detail?detailPath=${detailPath}`, { headers: authHeaders, timeout: 10000 });
                const detailData = detailResp.data?.data || {};
                const seasons = detailData.resource?.seasons || [];

                let se = 1;
                let ep = 1;

                if (mediaType === 'movie') {
                    // The H5 play API uses se=0, ep=0 for movies. ep=1 returns
                    // hasResource=false even when the detail lists resolutions.
                    se = seasons[0]?.se !== undefined ? seasons[0].se : 0;
                    ep = 0;
                } else {
                    // TV Series / Anime
                    if (seasons.length === 1 && seasons[0].se === 1 && seasons[0].maxEp > 100) {
                        // Anime continuous absolute episode structure (e.g. One Piece)
                        se = 1;
                        ep = episodeNum || 1;
                    } else {
                        // Regular multi-season structure
                        const matchedSeason = seasons.find(s => s.se === seasonNum);
                        if (matchedSeason) {
                            se = seasonNum;
                            ep = episodeNum || 1;
                        } else {
                            // If the season is not found, skip this candidate as it does not cover the requested season
                            console.log(`[Vidbox] Season ${seasonNum} not found in "${itemTitle}". Available seasons:`, seasons.map(s => s.se).join(', '));
                            return [];
                        }
                    }
                }

                // FIX: Use the actual playerDomain for both movies AND TV, not hardcoded movibox.net
                // The anti-hotlinking check needs the correct domain that the API returned
                const refererDomain = playerDomain;

                // FIX: Use correct path for the referer based on mediaType
                // Movies use /movies/ path, TV uses /tv/ path
                const refererPath = mediaType === 'movie' ? 'movies' : 'tv';
                const playerReferer = `${refererDomain}/spa/videoPlayPage/${refererPath}/${detailPath}?id=${subjectId}&type=/${refererPath}/detail&detailSe=${mediaType === 'movie' ? '' : se}&detailEp=${mediaType === 'movie' ? '' : ep}&lang=en`;

                const playPath = `/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(detailPath)}`;
                const playBases = [API_BASE, `${refererDomain}/wefeed-h5api-bff`];
                let playResp;
                let lastPlayError;
                for (const playBase of [...new Set(playBases)]) {
                    const playUrl = `${playBase}${playPath}`;
                    console.log(`[Vidbox] Play URL: ${playUrl}`);
                    try {
                        playResp = await axios.get(playUrl, {
                            headers: {
                                ...PLAYER_HEADERS,
                                "Referer": playerReferer,
                                "Authorization": `Bearer ${token}`
                            },
                            timeout: 12000
                        });
                        if (playResp.data?.data?.hasResource) break;
                    } catch (error) {
                        lastPlayError = error;
                        console.warn(`[Vidbox] Play host ${new URL(playBase).host} failed: ${error.message}`);
                    }
                }
                if (!playResp && lastPlayError) throw lastPlayError;

                const playData = playResp.data?.data || {};
                if (!playData.hasResource) {
                    console.log(`[Vidbox] No resource for "${itemTitle}" (se=${se}, ep=${ep})`);
                    return [];
                }

                const streams = playData.streams || [];
                const dash = playData.dash || [];

                console.log(`[Vidbox] "${itemTitle}" (se=${se}, ep=${ep}): ${streams.length} MP4 streams, ${dash.length} DASH streams`);

                // Fetch subtitles/captions if any stream/dash item exists
                const subs = [];
                let firstStreamId = null;
                let streamFormat = "MP4";

                if (streams.length > 0) {
                    firstStreamId = streams[0].id;
                    streamFormat = streams[0].format || "MP4";
                } else if (dash.length > 0) {
                    firstStreamId = dash[0].id;
                    streamFormat = dash[0].format || "DASH";
                }

                if (firstStreamId) {
                    try {
                        const capUrl = `${API_BASE}/subject/caption?format=${streamFormat}&id=${firstStreamId}&subjectId=${subjectId}&detailPath=${detailPath}`;
                        const capResp = await axios.get(capUrl, { headers: authHeaders, timeout: 8000 });
                        const captions = capResp.data?.data?.captions || capResp.data?.data || [];

                        if (Array.isArray(captions)) {
                            captions.forEach(cap => {
                                if (cap.url) {
                                    subs.push({
                                        url: cap.url,
                                        label: cap.lanName || 'Unknown',
                                        lang: cap.lan || 'en',
                                        format: cap.url.includes('.vtt') ? 'vtt' : 'srt'
                                    });
                                }
                            });
                        }
                    } catch (capErr) {
                        // ignore caption errors silently
                    }
                }

                // Add direct MP4 streams
                streams.forEach(s => {
                    if (s.url) {
                        itemStreams.push({
                            name: `Vidbox - ${dubLabel} (${s.resolutions}p)`,
                            title: `${displayTitle} - ${dubLabel} (${s.resolutions}p)`,
                            url: s.url,
                            quality: `${s.resolutions}p`,
                            type: 'mp4',
                            provider: 'vidbox',
                            subtitles: subs,
                            headers: {
                                "Referer": `${refererDomain}/`,
                                "User-Agent": PLAYER_HEADERS["User-Agent"]
                            }
                        });
                    }
                });

                // Add DASH streams
                dash.forEach(d => {
                    if (d.url) {
                        itemStreams.push({
                            name: `Vidbox DASH - ${dubLabel} (${d.resolutions}p)`,
                            title: `${displayTitle} - DASH ${dubLabel} (${d.resolutions}p)`,
                            url: d.url,
                            quality: `${d.resolutions}p`,
                            type: 'dash',
                            provider: 'vidbox',
                            subtitles: subs,
                            headers: {
                                "Referer": `${refererDomain}/`,
                                "User-Agent": PLAYER_HEADERS["User-Agent"]
                            }
                        });
                    }
                });

            } catch (candErr) {
                console.error(`[Vidbox] Error resolving candidate "${item.title}":`, candErr.message);
            }
            return itemStreams;
        });

        const streamResults = await Promise.all(streamPromises);
        const allStreams = streamResults.flat();

        console.log(`[Vidbox] Resolved ${allStreams.length} total stream(s) in parallel.`);
        return allStreams;

    } catch (err) {
        console.error("[Vidbox] Main error:", err.message);
        return [];
    }
}

module.exports = { getVidboxStreams };
