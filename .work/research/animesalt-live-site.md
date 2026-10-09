# AnimeSalt live test findings

The provider source supplied for testing was `https://raw.githubusercontent.com/D3adlyRocket/Anime-Nuvio/refs/heads/main/providers/animesalt.js`. Its embedded TMDB API key is intentionally not copied into the project; the local adaptation uses the shared rotating-key TMDB utility.

A live lookup through the adapted provider for TMDB `82684`, season 1, episode 2 returned zero streams because the search request redirects from `animesalt.ac` to `animesalt.cx`, while the first local parser version accepted only `.ac` result URLs. The live search results page was reachable and returned the expected series title on `animesalt.cx`.

The public series page `https://animesalt.cx/series/that-time-i-got-reincarnated-as-a-slime/` reports four seasons and includes the expected episode link `https://animesalt.cx/episode/that-time-i-got-reincarnated-as-a-slime-1x2/`. This confirms a host migration mismatch in the initial implementation; the series page's current links use `.cx`.
