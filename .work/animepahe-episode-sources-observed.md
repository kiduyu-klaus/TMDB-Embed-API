# AnimePahe episode source trace observations

Observed on 2026-10-10 for the user-provided page:

- Episode page: https://animepahe.ch/that-time-i-got-reincarnated-as-a-slime-season-4-episode-7-english-subbed/
- HTTP response: 200 HTML; page title: `Watch That Time I Got Reincarnated as a Slime Season 4 Episode 7 English Subbed | Animepahe`.
- Page includes an embedded player iframe: `//megaplay.buzz/stream/s-2/362238/sub`.
- Page includes a Kwik download link: `https://kwik.cx/f/Ytu40urcW2Qe`.
- MegaPlay iframe response: https://megaplay.buzz/stream/s-2/362238/sub (HTTP 200; title `File 176430 - MegaPlay`).
- MegaPlay page exposes player metadata: `data-id=176430`, `data-realid=362238`, `data-mediaid=8679`, `data-fileversion=0`; it loads client scripts that dynamically request its sources. No direct `.m3u8`/`.mp4` URL was present in the static HTML captured during this trace.


## VidCore encryption bridge correction

The live bridge returned HTTP 400 when called without `stage`; its response says the required query parameters are `text` and `stage` (1 or 2). The upstream sample at https://raw.githubusercontent.com/smy778/EncDecEndpoints/main/samples/vidcore.py confirms the sequence: call `enc-vidcore` with `stage=1`, POST the returned `stage1` URL with its CSRF token, then call `enc-vidcore` with the returned text and `stage=2` to obtain server and stream URLs.
