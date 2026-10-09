# Goojara player-source trace

Inspection date: 2026-10-10. Pages were fetched read-only; JavaScript was not executed. The packed Luluvdo JWPlayer snippet was decoded as string data only.

## Wootly

- User-supplied page: https://www.wootly.ch/?v=80P4EEE4
- It embeds `https://web.wootly.ch/e/<time-limited-path>/80P4EEE4`.
- The embed page's public player flow submits its hidden `qdfx=1` form. The response contains a per-view video ID (`vd`) and token (`tk`). Its client requests `/grabm?t=<tk>&id=<vd>`, which returns a short-lived `https://web.wootly.ch/source?...` URL.
- The `/source` endpoint redirects to a signed CDN MP4 path. A HEAD check returned HTTP 200 and `video/mp4`; the example file name identifies 720p. The tested file was about 778 MB. Signed CDN hosts and parameters can change between requests; their values are intentionally not saved here.
- The embed's `/moon` target is an advertising redirect and is not needed for source extraction.

## Luluvdo

- User-supplied download page: https://luluvdo.com/d/xw3vquds5n86
- It exposes a player iframe: https://luluvido.com/e/xw3vquds5n86
- The player stores its JWPlayer `sources` setup in a Dean Edwards Packer string. Static unpacking reveals a signed HLS master under `https://61kzjdwdub6m.tnmr.org/hls2/.../master.m3u8` with signed query keys `t`, `s`, `e`, `f`, `i`, and `sp`.
- The master manifest returned HTTP 200, `application/vnd.apple.mpegurl`, and a single 1920x1080 variant at `index-v1-a1.m3u8`. The variant also returned HTTP 200. The exact signed values are per-request and not retained here.
