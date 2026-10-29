# 🍿 KiduyuTvProviders

> Modern, configurable streaming metadata + source aggregation API with a secure admin panel and multi-key TMDB rotation.

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat" />
  <img src="https://img.shields.io/badge/Status-Active-success?style=flat" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat" />
  <img src="https://img.shields.io/badge/Version-1.3.0-informational?style=flat" />
  <img src="https://img.shields.io/docker/pulls/inside4ndroid/tmdb-embed-api?label=Docker%20Pulls&style=flat" />
</p>

---

## 📸 Screenshots
<p align="center">
  <img src="screenshots/Screenshot 2025-09-16 174931.png" width="46%" />
  <img src="screenshots/Screenshot 2025-09-16 175002.png" width="46%" />
</p>
<p align="center">
  <img src="screenshots/Screenshot 2025-09-16 175008.png" width="46%" />
  <img src="screenshots/Screenshot 2025-09-16 175013.png" width="46%" />
</p>
<p align="center">
  <img src="screenshots/Screenshot 2025-09-16 175020.png" width="46%" />
  <img src="screenshots/Screenshot 2025-09-16 175026.png" width="46%" />
</p>
<p align="center">
  <img src="screenshots/Screenshot 2025-09-16 175033.png" width="46%" />
  <img src="screenshots/Screenshot 2025-09-16 175040.png" width="46%" />
</p>

---

## ✨ Features
- **66 Built-in Providers** – MoviesTv + Anime sources with per-provider enable toggles + default selection.
- **Multi-TMDB Key Rotation** – Supply multiple API keys; one is chosen randomly per request.
- **🔥 Plugin System** – Drop new provider files in `providers/` and add its exported function to the registry map (`providers/registry.js` → `providerFunctionMap`). No core file edits required.
- **Dynamic Filtering** – Minimum quality presets, custom JSON quality map, codec exclusion rules (presets + JSON).
- **Runtime Overrides UI** – Fully interactive web admin at `/config.html` (login protected) writing to `utils/user-config.json`.
- **Session Auth + Rate Limiting** – Login system with brute-force lockouts, logout, and password change.
- **Status & Health Panel** – Live metrics, provider status, endpoint list, and per-provider functional checks (configurable check title via TMDB ID).
- **Config Propagation** – Overrides mirrored to `process.env` for legacy compatibility (no `.env` required after first save).
- **Back-Navigation Safe** – Cache-control + visibility/session revalidation.
- **Optional Stream Proxy Layer** – When enabled, rewrites returned stream URLs so HLS playlists, TS segments, and subtitles are served through internal endpoints (`/m3u8-proxy`, `/ts-proxy`, `/sub-proxy`) allowing uniform headers, origin shielding, and optional segment caching.
  Stream responses retain the provider's original `headers`, including when proxying is enabled.

  Proxy Tuning Parameters (query flags accepted by `/ts-proxy` – defaults shown):
  - `clampOpen` (on) – If a client sends an ambiguous `Range: bytes=0-`, constrain it to an initial window of `openChunkKB` (default 4096 KB) to avoid huge first reads.
  - `openChunkKB=4096` – Size (KB) used for both clamp window and each progressive expansion increment.
  - `progressiveOpen` (on) – Grow successive ambiguous head requests (`bytes=0-`) incrementally instead of one large span. Maintains a per-URL expansion map.
  - `initChunkKB=512` – Size used for a synthetic initial partial (206) when no client range is provided and progressive growth is disabled. Capped 64–2048 KB.
  - `noSynth=1` – Disable synthetic initial partial generation (forces pass-through behavior).
  - `force200=1` – Normalize upstream 206 responses to 200 (diagnostics / edge player testing).
  - `tailPrefetch` (on) – Enable asynchronous tail fetch of the file's last bytes to satisfy rapid player tail probes.
  - `tailPrefetchKB=256` – Tail window size (64–2048 KB). Cached in memory with TTL cleanup.
  Behavior Notes:
  - Synthetic partials auto-disable when `progressiveOpen` is active (real progressive ranges preferred).
  - Player tail probes (e.g., VLC metadata scans) are accelerated by the cached tail window.
  - Forced 200 mode strips `Content-Range` to emulate full responses for troubleshooting.
  - Host Overrides: `pixeldrain.*` and `video-downloads.googleusercontent.com` URLs are routed through `/ts-proxy` regardless of extension to ensure correct range + MIME handling.

---

## 📦 Quick Start
```bash
# 1. Install dependencies
npm install

# 2. (Optional) Copy example env if you want an initial TMDB key
cp .env.example .env   # then edit TMDB_API_KEY=

# 3. Start API with automatic restarts (recommended for local dev)
npm start

# Or production-style single run
# node apiServer.js

# 4. Open the Admin UI (login page) in browser
http://localhost:8787/

# 5. Health check
curl http://localhost:8787/api/health
```

**Default credentials (first run):** `admin` / `change-me` — **change them immediately** from the dashboard or via `POST /auth/change-password`.

---

## 🐳 Docker Usage

### Pull & Run (Fastest)
If you just want to run it (no building):
```bash
docker pull inside4ndroid/tmdb-embed-api:latest
docker run --name tmdb-embed-api -p 8787:8787 \
  -e TMDB_API_KEY=YOUR_TMDB_KEY \
  inside4ndroid/tmdb-embed-api:latest
```

Or the minimal quick-test run:
```bash
docker run -it -p 8787:8787 inside4ndroid/tmdb-embed-api:latest
```

Persist overrides (Windows PowerShell example) by mounting a local file:
```powershell
New-Item -ItemType File -Path .\utils\user-config.json -Force | Out-Null
docker run --name tmdb-embed-api -p 8787:8787 `
  -e TMDB_API_KEY=YOUR_TMDB_KEY `
  -v ${PWD}/utils/user-config.json:/app/utils/user-config.json `
  inside4ndroid/tmdb-embed-api:latest
```

### Build Locally
```bash
docker build -t tmdb-embed-api .
docker run --name tmdb-embed -p 8787:8787 \
  -e TMDB_API_KEY=YOUR_TMDB_KEY \
  -v "$(pwd)/utils/user-config.json:/app/utils/user-config.json" \
  tmdb-embed-api
```

After first login + save, the UI writes overrides into the mounted `user-config.json` so they persist across container restarts.

### docker-compose
An example `docker-compose.yml` is included (healthcheck + `restart: unless-stopped`). Start with:
```bash
docker compose up -d --build
```
Environment variables can be supplied via a `.env` file in the same directory (Compose automatically loads it). Example `.env`:
```
TMDB_API_KEY=first_key
```

To stop & remove:
```bash
docker compose down
```

### Switching to Multiple TMDB Keys
Either set `TMDB_API_KEYS` to a JSON array string:
```bash
docker run -p 8787:8787 \
  -e TMDB_API_KEYS='["KEY1","KEY2","KEY3"]' \
  tmdb-embed-api
```
or add / remove keys inside the Admin UI (Keys panel) and save.

If both `TMDB_API_KEY` and `TMDB_API_KEYS` are provided, rotation uses the array. Clearing the array in the UI also clears the legacy key.

### Key Environment Variables
| Variable | Purpose | Notes |
|----------|---------|-------|
| `API_PORT` | Port the server listens on | Defaults to `8787` |
| `BIND_HOST` | Interface to bind | Defaults to `0.0.0.0` |
| `TMDB_API_KEY` | Single TMDB key (legacy) | Use if you only have one key |
| `TMDB_API_KEYS` | JSON array of keys | Overrides single key when present |
| `DEFAULT_PROVIDERS` | Comma-separated default providers | Used by the aggregate endpoint |
| `DEFAULT_REGION` / `FEBBOX_REGION` | Default region | Passed through for legacy compat |
| `MIN_QUALITIES` | Min quality setting / JSON | Mirrored to the config model |
| `EXCLUDE_CODECS` | Codec exclusion JSON | e.g. `{"excludeDV":true}` |
| `FEBBOX_COOKIES` | FebBox JWT cookie(s) | Comma-separated; required for Showbox |
| `ENABLE_<PROVIDER>_PROVIDER` | Per-provider enable flags | e.g. `ENABLE_4KHDHUB_PROVIDER=true` |
| `DISABLE_CACHE` | Disable internal caches | `true`/`false` |
| `PROVIDER_LOG_REDACT` | Force URL redaction back on | `1` re-redacts the unredacted providers below |
| `ENABLE_PSTREAM_API` | PStream API flag | Default `true` |
| `DISABLE_URL_VALIDATION` | Skip general URL checks | Default `false` |
| `DISABLE_4KHDHUB_URL_VALIDATION` | Skip 4khdhub URL checks | Default `false` |
| `ENABLE_PROXY` | Mount proxy routes | Default `false` |
| `PROVIDER_CHECK_TMDB_ID` | Title for dashboard functional checks | Default `278` |
| `SHOWBOX_CACHE_DIR` | Custom Showbox cache directory | Optional |
| `NETMIRROR_API_BASE` | NetMirror embed base URL | Optional override |
| `NETMIRROR_STREAM_REFERER` | NetMirror stream Referer header | Optional override |
| `MOVIEBOX_API_URL` | MovieBox API base URL | Defaults to `https://api3.aoneroom.com` |
| `MOVIEBOX_THROTTLE_MS` | Minimum delay between MovieBox API requests | Defaults to `100` ms |

### Updating the Image
```bash
docker compose pull   # if using an external registry (future)
docker compose up -d --build
```

### Restart from Admin UI
The Admin panel includes a Restart Server control.
- Local: `npm start` and `npm run start:dev` run a lightweight launcher with exactly one server child. An admin restart exits with code 75; the launcher waits for exit before starting its replacement. It does not watch files or retry crashes.
- cPanel/Passenger: keep `apiServer.js` as the startup file. Set `APP_RESTART_MODE=passenger` if automatic Passenger detection is unavailable. After cleanup, the app writes `tmp/restart.txt` and exits so Passenger can start a replacement.
- Direct `node apiServer.js` on supported Linux Node versions replaces the current process with `process.execve`. On platforms without this support, use `npm start`; the endpoint rejects unsupported restarts before stopping the server.
- External supervisors using `node apiServer.js` can set `APP_RESTART_MODE=supervisor` to handle replacement themselves.
- Docker Compose: the container exits and is restarted by `restart: unless-stopped`.

### Healthcheck
Container health relies on `GET /api/health`. If you disable or modify that route, adjust the Dockerfile / compose healthcheck accordingly.

---

## 🔐 Authentication
The root (`/`) serves the login page. After successful login a session cookie (`session`) is issued (HttpOnly; 12h lifetime). All admin pages (e.g. `config.html`) require an active session.

Credentials are stored in `utils/auth-users.json` (auto-created on first run with `admin` / `change-me`). Passwords are hashed with PBKDF2-SHA512 (100,000 iterations, random salt). There is no `PASSWORD_HASH` / `ADMIN_USERNAME` environment override — manage users directly in this file or via the change-password endpoint.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/login` | POST | Authenticate (JSON: `{ username, password }`) |
| `/auth/logout` | POST | Destroy session |
| `/auth/session` | GET | Check session status |
| `/auth/change-password` | POST | Update password (requires session) |

Repeated failed logins trigger escalating lockouts (`Retry-After` header emitted; 5 attempts per window).

---

## 🛠 Configuration Model
All runtime state collapses into a *merged* object displayed in the UI (Live Config panel). Source order:
1. Initial environment variables / optional `.env`
2. JSON overrides: `utils/user-config.json`

Saving in the UI writes only changed keys. Setting a field to empty removes the override (reverting to env/default). Removing all TMDB keys (and saving) clears `tmdbApiKeys` and the legacy `tmdbApiKey`.

**Override File:** `utils/user-config.json`
```json
{
  "defaultProviders": ["4khdhub"],
  "tmdbApiKeys": ["KEY_A","KEY_B"],
  "enable4khdhubProvider": true,
  "providerCheckTmdbId": "278"
}
```

---

## 🎛 Admin UI Sections
| Panel | Summary |
|-------|---------|
| Core | Port, default providers, default region |
| Quality / Filters | Min quality presets & codec exclusion JSON |
| Keys | Add/remove TMDB API keys (rotated randomly) |
| Advanced | Provider toggles, cache & validation flags |
| MovieBox | Configure audio tracks, resolutions, subtitles, and provider logs |
| Outbound connection | Configure MovieBox and independent provider outbound proxy settings |
| Server Status | Live metrics, provider functional checks |
| Live Config | View merged + override JSON snapshots |

Session is revalidated on visibility and back/forward navigation to prevent stale access.

MovieBox, VidFast, Vidy, BingeBang, Videasy, Vidlove, and Superstream proxying are optional in the Outbound
connection panel. MovieBox uses `utils/moviebox-proxies.json`; VidFast, Vidy,
BingeBang, Videasy, Vidlove, and Superstream share `utils/vidfast-proxies.json` but keep
independent enable settings and proxy selection. Each provider checks the
preferred proxy first, then probes the shared list if needed. TMDB API requests
from Videasy, Vidlove, and Superstream bypass the proxy. Free proxies are
third-party services and may be unreliable.

---

## 🔌 Providers
The API supports a plugin system. Drop a new provider file in the `providers/` folder and register its exported function in `providers/registry.js` under `providerFunctionMap`. Also classify it in `providerCategoryMap` as `MoviesTv` or `Anime`; new providers default to `MoviesTv`.

### Current Built-in Providers
- `showbox` - Showbox/FebBox streams (requires FebBox JWT cookie)
- `4khdhub` - 4KHDHub streams
- `vixsrc` - VixSrc streams
- `videasy` - Videasy streams (18 servers via enc-dec.app)
- `vidy` - Vidy streams (10 servers via api.wecollege.net)
- `vidlink` - Vidlink streams
- `dahmermovies` - DahmerMovies streams (direct file links)
- `streamflix` - StreamFlix streams (direct MP4 links)
- `vaplayer` - VaPlayer streams (HLS via IMDb ID)
- `castletv` - CastleTV streams (AES-128 encrypted API)
- `hdghartv` - HDGharTV streams (title-matched search + IMDb verification)
- `netmirror` - NetMirror streams (Netflix direct + NewTV platform fallback)
- `onetouchtv` - OneTouchTV streams (AES-256 encrypted API)
- `zxcstreams` - ZXCStreams streams (multi-server backend, dynamic domain discovery)
- `animekai` - AnimeKai anime streams (Anime category)
- `allwish` - AllWish anime streams (Anime category; season/episode-aware)
- `animesalt` - AnimeSalt anime streams (Anime category; season/episode-aware)
- `moviebox` - MovieBox movie and TV streams (requires a TMDB API key; original + dub audio tracks, per-track subtitles)
- `anv` - Anv anime streams (Anime category; season/episode-aware, needs a TMDB key)
- `watchanimeworld` - WatchAnimeWorld anime streams (Anime category; needs a TMDB key)
- `wcoflix` - WcoFlix anime streams (Anime category; needs a TMDB key)
- `vegamovies` - VegaMovies movie and TV streams (direct file links; needs a TMDB key)
- `vidbolt` - VidBolt movie and TV streams (multi-server resolver)

Providers that rely on title resolution against TMDB (`castletv`, `hdghartv`, `onetouchtv`, `zxcstreams`, `vaplayer`, `netmirror`, `moviebox`, `allwish`, `animesalt`, `anv`, `watchanimeworld`, `wcoflix`, `vegamovies`) require at least one TMDB API key configured.

> **MovieBox resolution gate:** the upstream provider ships Stremio-style per-resolution toggles
> (`res_2160p`, `res_1080p`, `res_720p`) that are read from `SCRAPER_SETTINGS`, which this API never
> populates. Left on the upstream defaults the gate would pin MovieBox to 2160p/1080p and silently
> drop the many titles whose best copy is 720p — including most original-audio tracks. MovieBox
> therefore follows the project's own `MIN_QUALITIES` setting instead (720p floor by default), and
> still honours `SCRAPER_SETTINGS` when an external host does populate it.

### Verbose Provider Logging

`anv`, `watchanimeworld`, `wcoflix`, `vegamovies`, `vidbolt`, and `moviebox` are instrumented with the project's
`utils/providerTrace` diagnostics, so every request they make is logged with the **complete,
unredacted URL** (method, status, content-type, elapsed time), plus step-level events such as
`tmdb.resolved`, `search.results`, `match.selected`, `catalog.loaded`, `resolve.done`, and
`streams.resolved` with the final playable URLs.

Logs go to stdout and to the in-memory buffer served by `GET /api/logs` (admin session required).

> **Note:** unredacted logging means TMDB API keys, signed CDN URLs (`X-Amz-Signature`,
> `X-Amz-Credential`), and provider session tokens appear verbatim in the logs. Set
> `PROVIDER_LOG_REDACT=1` to force redaction back on, or flip `{ redact: false }` to
> `{ redact: true }` in the provider's `createProviderTrace(...)` call to re-redact it permanently.

### Adding a New Provider
The MoviesTv category also includes `superstream`, `hdmovie2`, `vidbox`, `vidrock`, and `moviesdrive1`. HDMovie2 currently handles movies only; TV requests return no streams. MoviesDrive uses the configured TMDB API key. Superstream includes the Vidnest decoding helper.

1. **Create** `providers/yourprovider.js` with your stream fetching logic
2. **Export** a function like `getYourproviderStreams(tmdbId, mediaType, season, episode)`
3. **Register** it in `providers/registry.js` → `providerFunctionMap`:
   ```js
   // providers/registry.js
   const providerFunctionMap = {
     'Showbox.js': 'getStreamsFromTmdbId',
     '4khdhub.js': 'get4KHDHubStreams',
     'vixsrc.js': 'getVixsrcStreams',
     'videasy.js': 'getVideasyStreams',
     'vidlink.js': 'getVidlinkStreams',
     'dahmermovies.js': 'getDahmermoviesStreams',
     'streamflix.js': 'getStreamflixStreams',
     'vaplayer.js': 'getVaplayerStreams',
     'castletv.js': 'getCastletvStreams',
     'hdghartv.js': 'getHdghartvStreams',
     'netmirror.js': 'getNetmirrorStreams',
     'onetouchtv.js': 'getOnetouchtvStreams',
     'zxcstreams.js': 'getZxcstreamsStreams',
     'moviebox.js': 'getStreams',
     'yourprovider.js': 'getYourproviderStreams'
   };
   ```
4. The provider will appear in the admin UI with an enable/disable toggle.

**Example Provider (Unified Output):**
```javascript
async function getYourproviderStreams(tmdbId, mediaType, season, episode) {
  // Your scraping/API logic here
  return [{
    name: "YourProvider",
    title: "Fight Club - 1080p [YourProvider #1]",
    url: "https://stream.url/video.mp4",
    quality: "1080p",
    provider: "yourprovider",
    headers: { "User-Agent": "Mozilla/5.0" }
  }];
}

module.exports = { getYourproviderStreams };
```

> **⚠️ Important**: All providers must return streams in the unified JSON format to ensure compatibility with filtering and aggregation.

The system automatically:
- ✅ Detects new provider files
- ✅ Adds enable/disable toggles in the admin UI
- ✅ Includes them in stream aggregation
- ✅ Applies filtering and quality controls
- ✅ No core file edits required!

---

## 📡 Key Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Basic heartbeat |
| `GET /api/metrics` | Runtime counters & summary |
| `GET /api/status` | Metrics + providers + endpoints + `providerCheckTmdbId` |
| `GET /api/logs` | Incremental console log history (admin session required) |
| `GET /api/providers` | All providers with enabled status |
| `GET /api/providers/:name` | Single provider status |
| `GET /api/streams/:type/:tmdbId` | Aggregate MoviesTv streams (`type` = movie\|series; supports `?season=&episode=`) |
| `GET /api/streams/:provider/:type/:tmdbId` | Provider-specific MoviesTv streams (same query params) |
| `GET /api/streams/anime/:tmdbId` | Aggregate anime movies when season and episode are omitted; anime series when either is supplied |
| `GET /api/streams/:provider/anime/:tmdbId` | Anime provider streams; omit season and episode for movies, or supply them for series |
| `GET /api/config` | `{ merged, override, overridePath }` |
| `POST /api/config` | Apply override patch (persisted to `utils/user-config.json`) |
| `POST /api/restart` | Graceful shutdown and supervisor restart (Passenger marker + exit) |
| `POST /api/stream-token` | Set the stream token (admin session required) |
| `DELETE /api/stream-token` | Disable stream token auth (admin session required) |
| `GET /api/debug/env` | Debug environment/config snapshot |

### 🔐 Stream API token
The `/api/streams/*` endpoints can require a token. Manage it in the admin UI under
**Config → Keys → Stream API Token Password**, or by setting `STREAM_TOKEN_HASH`
(a SHA-256 hex digest) in your environment.

```bash
curl "http://localhost:8787/api/streams/series/1396?season=1&episode=1&token=YOUR_TOKEN"
curl "http://localhost:8787/api/streams/movie/550?token=YOUR_TOKEN"
curl "http://localhost:8787/api/streams/4khdhub/movie/550?token=YOUR_TOKEN"
```

Either form of `YOUR_TOKEN` is accepted:

- the **hash itself** (this is what the Keys panel displays and copies), or
- the **plaintext password** it was hashed from.

Both are compared in constant time. Only the digest is ever stored — the plaintext
is never written to disk or returned by any endpoint. Requests with no token get
`401 AUTHENTICATION_REQUIRED`; a wrong token gets `403 INVALID_TOKEN`. Leave
`STREAM_TOKEN_HASH` empty to keep the stream endpoints open.

> The stored hash doubles as the bearer credential, so `GET /api/config` redacts
> `streamTokenHash` for callers without an admin session.

### 📁 Hosting under a sub-path
If the app sits behind a reverse proxy or a Plesk/CPanel *Application root*, set
`MOUNT_PATH` to the prefix and every route, static asset, redirect and proxy URL
moves under it:

```bash
MOUNT_PATH=/kiduyuTv_providers
```

```bash
# now served as:
http://localhost:8787/kiduyuTv_providers/
http://localhost:8787/kiduyuTv_providers/config.html
http://localhost:8787/kiduyuTv_providers/api/health
http://localhost:8787/kiduyuTv_providers/api/streams/movie/550?token=...
```

Leave it empty (the default) to keep serving from the domain root — plain
localhost and Docker setups need no change. The proxy layer also prefixes the
`/m3u8-proxy`, `/ts-proxy` and `/sub-proxy` URLs it writes into playlists, so
sub-path deployments stream correctly without extra configuration.

> Your reverse proxy must forward the **full** path including the prefix. If it
> strips `/kiduyuTv_providers` before proxying, set `MOUNT_PATH` to empty instead
> so the app expects root-level paths.

Proxy routes (mounted only when `enableProxy` is on):
| Endpoint | Description |
|----------|-------------|
| `GET /m3u8-proxy?url=...&headers=...` | Rewrites & serves HLS playlists/segments |
| `GET /ts-proxy?url=...&headers=...` | Range-aware file/segment proxy |
| `GET /sub-proxy?url=...` | Subtitle passthrough proxy |

The aggregate endpoint auto-resolves IMDb when needed, merges all enabled (or `defaultProviders`) provider output, then applies filtering. Provider timing is returned per provider (`providerTimings`).

---

## 🧪 Stream Object Schema (Unified)
```json
{
  "name": "ProviderDisplay",
  "title": "Fight Club - 1080p [YourProvider #1]",
  "url": "https://stream.url/video.mp4",
  "quality": "1080p",
  "provider": "yourprovider",
  "headers": { "User-Agent": "Mozilla/5.0" },
  "format": "mp4",
  "mimeType": "video/mp4",
  "subtitles": [ { "id": "yourprovider-0-en", "url": "https://subs.example/en.vtt", "lang": "en", "label": "English", "language": "en", "mimeType": "text/vtt", "headers": { "User-Agent": "Mozilla/5.0" } } ]
}
```
- `name` / `title` – display strings (often include quality/source hints).
- `url` – direct upstream URL (or proxied URL when `enableProxy` is on).
- `quality` – e.g. `Auto`, `1080p`, `720p`, `480p`, `4K`. Missing/unknown qualities parse as `0`.
- `headers` – upstream request headers preserved as supplied, or `{}` when absent; retained when proxying.
- `subtitles` – subtitle tracks supplied by the provider, or an empty array.

Filtering passes through `applyFilters` to enforce min quality + codec exclusions (see below).

Every stream also includes `format`, `mimeType`, and a `subtitles` array (empty when unavailable). Format is inferred from provider metadata or the URL without additional network requests; opaque URLs without metadata use `unknown` and `application/octet-stream`. Subtitle entries include `id`, `url`, `lang`, `label`, `language`, `mimeType`, and `headers`. Existing subtitle headers are preserved; missing headers inherit the stream headers. Known SRT URLs use `application/x-subrip`; VTT uses `text/vtt`. This normalization does not convert subtitle contents.

When `enableProxy` is on, stream URLs are rewritten but provider headers and media metadata remain in the response. Clients using the internal proxy do not need to resend the upstream headers themselves.

---

## ⚙️ Configuration Flags (Advanced Panel)
| Flag | Default | Purpose |
|------|---------|---------|
| `enable<Name>Provider` | true | Enable/disable a provider (e.g. `enableCastletvProvider`) |
| `disableCache` | false | Disables internal caches |
| `enablePStreamApi` | true | PStream API flag |
| `disableUrlValidation` | false | Skip general URL pattern validation checks |
| `disable4khdhubUrlValidation` | false | Skip 4khdhub-specific URL validation |
| `enableProxy` | false | Mounts proxy routes and rewrites stream URLs through them |
| `providerCheckTmdbId` | `278` | TMDB ID used by dashboard functional checks |
| `showboxCacheDir` | — | Custom Showbox cache directory |

Toggle `enableProxy` to activate the internal proxy. This adds lightweight playlist/segment/subtitle rewriting without modifying provider code. Disable it to return direct upstream URLs.

---

## 🧩 Quality & Codec Filtering
- Presets: `all`, `480p`, `720p`, `1080p`, `1440p`, `2160p`.
- Custom quality JSON example (runtime applies the `default` entry; per-provider keys are preserved for future use):
```json
{ "default": "900p" }
```
- Quality strings are normalized numerically — `Auto` ≈ 1080, `HD` ≈ 720, `SD` ≈ 480, plus `4K`/`2160`, `1440`, `1080`, `720`, `576`, `480`, `360`, `240`.
- Codec exclusion JSON example:
```json
{ "excludeDV": true, "excludeHDR": false }
```

---

## 📊 Server Status & Functional Checks
The **Server Status** panel shows live metrics, the endpoint list, and a per-provider functional check table:

- **Run Provider Functional Checks** – hits `/api/streams/:provider/movie/:tmdbId` for each enabled provider and reports pass/fail with stream counts.
- **Provider check TMDB ID** – the title used for the checks is configurable in the dashboard (default `278` = *The Shawshank Redemption*). The value is persisted to `utils/user-config.json` and exposed via `/api/status` as `providerCheckTmdbId`.

---

## 🔐 Security Notes
- Admin UI requires login; session cookie is HttpOnly.
- Cache-control headers disable storing sensitive pages.
- Login is rate limited with escalating lockouts (5 attempts per window).
- Password change endpoint enforces minimum length (8+).
- Default credentials (`admin` / `change-me`) are generated on first run — change them immediately.

---

## 🚀 Deployment Tips
| Aspect | Recommendation |
|--------|---------------|
| Node Version | 18+ LTS |
| Reverse Proxy | Terminate TLS (e.g., Nginx) and forward to API port |
| Persistent Config | Mount / persist `utils/user-config.json` |
| Auth Users | Persist `utils/auth-users.json` so credentials survive restarts |
| Logs | Pipe stdout to centralized logger |
| Scaling | Use a single instance unless providers are CPU bound |

For ephemeral platforms (e.g., Vercel) note that some providers use temporary directories; avoid enabling disk-heavy cache directories.

---

## 💡 Troubleshooting
| Symptom | Cause / Fix |
|---------|------------|
| TMDB quota issues | Add more keys under Keys panel |
| Provider missing in matrix | Ensure its enable flag exists & UI updated |
| Empty merged config after restart | `user-config.json` deleted or unreadable |
| Streams low quality | Adjust min quality preset or custom JSON |
| Showbox shows nothing | Provide `FEBBOX_COOKIES` (comma-separated) under Keys |
| Functional checks fail | Some providers 0-stream legit titles; try changing the *Provider check TMDB ID* |

---

## 🤝 Contributing
PRs welcome. Keep changes focused and avoid unrelated formatting churn. For new providers include:
- A short rationale
- Retry / timeout safeguards
- Respect for existing filtering structure

---

## ❤️ Sponsorship
If this project helps you, consider sponsoring to support continued development & maintenance:

<p align="center">
  <a href="https://github.com/sponsors/Inside4ndroid">
    <img src="https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="Sponsor on GitHub" />
  </a>
</p>

Every contribution accelerates feature delivery & sustainability.

---

## 📜 License
MIT.

---

## 🙏 Acknowledgements
Inspired by community scraping/stream aggregation efforts. Credits also to the original NuvioStreamsAddon work for earlier concepts.

---

> *Happy streaming & hacking!* ✨

---
