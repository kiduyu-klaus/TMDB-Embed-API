# AllWish source review

- Upstream source: https://raw.githubusercontent.com/phisher98/phisher-nuvio-providers/refs/heads/main/providers/allwish.js
- Retrieved during the 2026-10-09 AllWish test.
- The source exports `getStreams(tmdbId, mediaType, season, episode)` and scrapes `https://all-wish.me` search, episode-list, and server-list endpoints.
- The upstream file embedded a TMDB API key; it was not copied into the project. The project adaptation uses `utils/tmdb.getDetails('tv', id)` and the existing rotating configured TMDB keys.
- The upstream file imports `cheerio-without-node-native`, which is not installed here; the project adaptation uses the installed `cheerio` dependency.
- The upstream implementation chooses the first search card, ignores season selection, and falls back to the first episode if a requested episode is not found. The project adaptation adds title/season matching and does not silently substitute another episode.
- The upstream MegaPlay helper reads only `sources.file`; the project adaptation uses the existing tested AnimeKai resolver, which handles the current MegaPlay encrypted-source form and carries captions/intro/outro metadata.
- A static scan of the upstream file found no `eval`, `new Function`, `child_process`, filesystem import, or `process.` access.
- A sanitized copy of the upstream file is retained at `allwish-upstream-redacted.js`; the original downloaded source is working material only and is not part of the deliverable.
