# TMDB-Embed-API — Detailed Project Review

**Review date:** 2026-10-22  
**Repository state reviewed:** `main` at `fbadff4`, plus the four existing working-tree edits.  
**Scope:** source, configuration, deployment files, provider registry, browser admin UI, Cloudflare Worker, tests, Git state, and non-secret runtime metadata. Credential values were not opened or copied into this report.

## 1. Executive summary

This is a Node.js/Express streaming-source aggregation service. Its public API accepts a TMDB media type and ID, invokes one or more provider adapters, normalizes the returned stream objects, adds subtitle fallbacks for Movies/TV providers, applies quality/codec filters, and optionally rewrites playable URLs through an internal HLS/file/subtitle proxy. A browser-based admin panel manages runtime configuration and authentication. A separate Cloudflare Worker acts only as an authenticated-path-preserving reverse proxy to an existing Node backend; it does not run the provider code at the edge.

The design is capable and actively evolving, but it currently has a large security boundary problem: the configuration API is not protected even though the HTML admin page is protected. In addition, enabling the optional proxy exposes an unauthenticated arbitrary-URL proxy, and runtime configuration/auth files are tracked in Git. These should be treated as release-blocking issues before exposing the service to an untrusted network.

The codebase contains **59 provider modules**, with **42 MoviesTv memberships**, **18 Anime memberships**, and `moviebox` belonging to both categories. The README still says 54 providers. The provider registry contains one stale reference to `vidfast1.js`, which is not present on disk. The project has useful live-audit tooling, but the normal Node package has no automated test script and its lint baseline is currently very poor.

## 2. Repository shape and responsibilities

### Root runtime

- `apiServer.js` is the main Express application and route definition.
- `serverLauncher.js` is the local restart supervisor. `npm start` launches one child server and restarts it when the child exits with code 75.
- `package.json` identifies `apiServer.js` as the main entry point and exposes only `start`, `start:dev`, and `lint` scripts.
- `utils/config.js` loads environment variables, merges `utils/user-config.json`, normalizes values, and mirrors effective settings back into `process.env` for older provider code.
- `utils/auth.js` owns file-backed users, PBKDF2 password verification, HMAC-signed sessions, and the `requireAuth` middleware.

### Provider layer

- `providers/registry.js` scans provider files, maps each filename to an exported function, assigns categories, lazy-loads modules, applies a shared concurrency gate, normalizes streams, and adds subtitle fallbacks.
- `providers/*.js` contains 59 adapters. They are not uniform: some use the shared `adaptProvider` helper, some use `providerTrace`, and many are bespoke scrapers/resolvers with their own HTTP, parsing, caching, and error behavior.
- `utils/providerAdapter.js` validates IDs and TV season/episode inputs, applies a timeout race, removes duplicate URLs, infers format, normalizes headers, and normalizes subtitles.
- `utils/streamResponse.js` performs a second stream normalization pass at registry level, inferring format/mime type and adding a consistent subtitle schema.
- `utils/resourceLimits.js` limits concurrent provider work to 4 active jobs and 64 queued jobs, with a 30-second queue wait.

### Browser admin UI

- `public/index.html` is the login page; `public/login.js` handles login, session checks, lockout countdowns, and redirects.
- `public/config.html` is the authenticated admin dashboard.
- `public/index.js` loads/saves configuration, manages providers and defaults, displays metrics and logs, runs provider functional checks, controls restart, and manages the stream API token.
- `public/style.css`, `material.css`, Bootstrap assets, and icon assets provide the UI presentation.

### Optional proxy layer

- `proxy/proxyServer.js` registers `/m3u8-proxy`, `/ts-proxy`, and `/sub-proxy` only when `enableProxy` is true.
- It rewrites HLS playlists, resolves relative segment URLs, forwards selected headers, supports byte ranges, has bounded in-memory caches, performs progressive open-ended range growth, and optionally prefetches file tails.
- `processStreamsForProxy()` rewrites normalized stream URLs based on their format or host.

### Edge deployment

- `cloudflare/worker.mjs` forwards only the configured mount path to the backend, rejects invalid backend configuration, rewrites same-backend redirects, strips cookie domains, and preserves request bodies/ranges.
- `cloudflare/worker.test.mjs` covers backend validation, redirects, login forwarding/cookies, partial responses, and gateway failure behavior.
- `wrangler.toml` deploys this Worker with `MOUNT_PATH=/kiduyuTv_providers` and a configured HTTPS backend URL.

## 3. Main request flow

### Startup

1. `npm start` runs `serverLauncher.js`.
2. The launcher spawns `apiServer.js` with `KIDUYU_LAUNCHER=1`.
3. `apiServer.js` installs console capture, loads dotenv/configuration, creates the Express app, conditionally mounts the proxy, registers auth/static/API routes, scans provider files through the registry, and starts listening.
4. Shutdown is coordinated by `utils/appLifecycle.js`; active fetches receive an abort signal, tracked workers/children are terminated, sockets are drained, and the process exits according to launcher/Passenger/execve mode.

### Aggregate stream request

For `GET /api/streams/:type/:tmdbId`:

1. `requireStreamToken` checks the optional `?token=` credential. Authentication is disabled when no hash is configured.
2. The route validates `movie`, `series`, or `anime` and parses optional season/episode query values.
3. `utils/tmdb.js` attempts to resolve the TMDB ID to an IMDb ID, using a six-hour in-memory cache and randomly selecting one configured TMDB key per request.
4. The route chooses the configured default providers, or all providers in the requested category if no defaults are configured.
5. Providers are invoked concurrently. The registry skips disabled providers, limits provider concurrency, normalizes results, and catches provider-specific failures as empty results.
6. MoviesTv streams receive Wyzie subtitle fallback and then OpenSubtitles fallback only when needed. Anime streams do not receive this same registry fallback path.
7. `applyFilters()` applies the global minimum quality and codec-exclusion settings.
8. If proxy mode is enabled, stream URLs are rewritten to local proxy URLs while the provider headers remain in the response.
9. The API returns `tmdbId`, optional `imdbId`, count, per-provider timings, and the normalized stream list.

Provider-specific requests follow the same path but invoke exactly one provider and apply that provider's filtering/response logic.

## 4. Configuration model

`utils/config.js` merges configuration in this order:

1. Initial environment variables and optional `.env`.
2. `utils/user-config.json` overrides.
3. Normalization/defaulting of provider flags, quality settings, cookies, TMDB keys, proxy flags, functional-check targets, and stream-token hash.

The UI persists patches rather than a complete snapshot. `null` removes an override, while an explicit empty TMDB-key or cookie array is intended to shadow environment fallbacks. Effective provider enable flags are dynamically generated from the files in `providers/`.

This compatibility layer is useful for older provider implementations, but it also increases the number of places where secret-bearing values are copied: environment, merged config, override file, and `process.env` mirrors.

## 5. Authentication and token behavior

Admin authentication is file-backed:

- A missing auth file is auto-created with the documented `admin` / `change-me` initial credential.
- Passwords use PBKDF2-SHA512 with 100,000 iterations and a random salt.
- Sessions are HMAC-SHA256-signed payloads with a 12-hour expiry and an HttpOnly, SameSite=Lax cookie.
- Login failures are tracked in memory by client IP with a five-attempt window and escalating lockouts.
- The stream API uses a SHA-256 token hash. Both the plaintext token and the stored hash are accepted as bearer credentials.

The stream token design is convenient for the admin UI, but the hash is itself a bearer credential. The modified UI opens test URLs containing that hash in a new tab, which can expose the credential through browser history, copied URLs, referrers, screenshots, or other URL logging. Prefer a short-lived test token or a server-side test action that does not place the bearer hash in a URL.

## 6. Provider system assessment

The provider system is the largest part of the project and is intentionally resilient to upstream churn. It includes direct MP4/file providers, HLS/DASH resolvers, title-search scrapers, encrypted APIs, anime-specific season/episode resolvers, MovieBox/Showbox integrations, and several generated or imported implementations.

Positive design choices:

- Provider failures are isolated; one failing provider does not fail the aggregate request.
- Stream normalization creates a common `format`, `mimeType`, `quality`, `headers`, and subtitle shape.
- TV requests are guarded against missing season/episode in the shared adapter.
- Provider concurrency is bounded rather than allowing unbounded fan-out.
- TMDB metadata and subtitle lookups use caches.
- The registry supports category membership and MovieBox's dual MoviesTv/Anime classification.
- Provider diagnostics can log step-level events such as search, match, resolve, and stream completion.

Maintenance concerns:

- `providers/registry.js` contains a stale `vidfast1.js` mapping, although the file does not exist. The dynamic directory scan prevents it from being instantiated today, but it indicates registry drift.
- Provider implementation styles vary significantly. Only six provider files reference the shared adapter, while 25 reference provider tracing; the rest implement their own conventions.
- The README claims 54 providers while the registry currently exposes 59 modules.
- Several providers contain legacy/generated code with hundreds of lint warnings and numerous empty catch blocks.
- `moviebox.js` uses ESM-style `import`/`export` in a repository whose root package is otherwise CommonJS and declares Node `>=14`; it loaded successfully under the current Node 26 desktop runtime and returned five live streams, but this module format is not a safe match for the declared lower engine or the Node 20 Docker image. Normalize it to CommonJS or make the whole module boundary explicitly ESM with a supported engine range.

## 7. Frontend/admin assessment

The dashboard covers core settings, provider defaults/toggles, minimum quality, codec exclusions, TMDB keys, FebBox cookies, stream-token management, advanced flags, live merged/override configuration, metrics, logs, restart, and provider checks.

The current local UI changes add a provider-test button and modal. The modal chooses movie/TV or anime test targets and opens the stream endpoint with the displayed stream-token hash when one is configured. The configuration form also supports provider functional checks with configurable movie or TV targets.

The most notable UI concern is secret rendering through `innerHTML`: TMDB keys and FebBox cookie values are inserted into HTML strings. Values from a trusted admin-controlled configuration should still be inserted with DOM text APIs (`textContent`) to prevent stored-XSS if a malicious value is ever written through the API or file.

## 8. Cloudflare and deployment assessment

The Worker is intentionally thin and correctly keeps native provider execution on the Node backend. Its backend URL validation is conservative: it requires HTTPS, rejects credentials/query/hash, rejects same-host recursion, and requires the backend path to match the configured mount path. The five Worker tests pass.

Deployment inconsistencies to resolve:

- `wrangler.toml` points to `https://sflatransport.com/kiduyuTv_providers`, while `cloudflare/README.md` documents `https://secondbanklabs.com/kiduyuTv_providers`. The documentation is stale relative to the manifest.
- The Docker image runs `node apiServer.js` directly, while local development uses the restart launcher. This is fine when Docker restart policy is relied upon, but the operational difference should be explicit.
- The Dockerfile intentionally uses `npm install --omit=dev` rather than `npm ci`, citing a lockfile mismatch. The lockfile is valid JSON and has matching root metadata/dependency count, so the image should be moved to reproducible `npm ci --omit=dev` after confirming the lockfile in CI.
- Compose persists `utils/user-config.json` but not `utils/auth-users.json` or the session secret. This can cause credentials to be recreated or sessions to invalidate across container replacement. Persist the auth file or inject a stable `SESSION_SECRET` and use a deliberate credential-management strategy.
- The root README says Node 18+, while `package.json` says Node >=14 and the Dockerfile uses Node 20. Choose one supported baseline, especially after resolving the mixed CommonJS/ESM provider.

## 9. Verification performed

| Check | Result |
|---|---|
| Cloudflare Worker tests (`cloudflare/npm test`) | **Pass: 5/5** |
| Main lint (`npm run lint`) | **Fail: 306 errors, 1,587 warnings, 1,893 problems** |
| Project-owned JS/MJS syntax check, excluding scratch/generated folders | **Pass** |
| Scratch `.tmp-ua2.js` syntax check | **Fail**, but it is a temporary root scratch file rather than application source |
| Provider count from loaded registry | **59 providers** |
| Provider category membership | **42 MoviesTv, 18 Anime, MovieBox dual-category** |
| Live MovieBox smoke request | Returned **5 streams** in the current desktop runtime; this modified the tracked subtitle cache, which was restored afterward |
| Package lock parse | Valid JSON; root metadata and dependency count match `package.json` |
| Git working tree at review completion | Four pre-existing modified files remain; no application source was edited by this review |

The main lint failure is not a single regression. It is distributed across legacy/generated providers and utilities, with repeated `var` warnings, empty catch blocks, unused variables, undefined identifiers, mixed indentation, and other errors. The current `MoviesHunt.js` edit itself contributes empty-block and mixed-whitespace errors.

## 10. Findings by priority

### P0 — fix before untrusted deployment

1. **Unauthenticated configuration read/write.** In `apiServer.js`, `GET /api/config` and `POST /api/config` are registered without `requireAuth`. The HTML dashboard is protected, but a caller can access the API directly. The GET response exposes the merged configuration and override snapshot; only the stream-token hash is redacted, while TMDB keys and FebBox cookies are not. The POST route accepts arbitrary configuration patches and only removes stream-token fields. Protect both routes with admin auth, redact all secret-bearing fields for non-admin callers, and validate an explicit allowlist of writable settings.

2. **Open proxy/SSRF when proxy mode is enabled.** The three proxy routes accept arbitrary `url` and caller-provided `headers`, have public CORS behavior, and do not enforce an allowlist, private-address block, or proxy credential. A remote caller can use the service to make requests from the server network and potentially read internal resources. Restrict destinations, reject loopback/private/link-local/metadata targets after DNS resolution, strip unsafe headers, and require a signed short-lived proxy token.

3. **Credential-bearing runtime files are tracked.** `utils/user-config.json` and `utils/auth-users.json` are tracked by Git. The former is designed to contain TMDB keys, cookies, and runtime overrides; the latter contains password-derived authentication material. Remove runtime secrets/config from version control, rotate any values that may have been shared, and add explicit ignore rules. The subtitle cache is also tracked even though it is runtime-generated.

### P1 — fix before the next release

4. **Hard-coded TMDB-style keys in provider/shared code.** Source-level assignments were found in `providers/vidlink.js`, `utils/cinejoy_core.js`, `utils/moviebox/constants.mjs`, and several anime providers. This bypasses the advertised multi-key rotation and creates key leakage/rotation risk. Route all TMDB access through `utils/tmdbKey.js`, remove embedded values, and rotate exposed keys.

5. **Sensitive URLs can enter logs.** `providerDiagnostics.js` defaults to redaction, but providers can opt out with `{ redact: false }`; the README explicitly documents unredacted provider logging. The current `MoviesHunt.js` working-tree change uses this opt-out. API keys, signed URLs, cookies, and session tokens can therefore enter stdout and the admin log buffer. Keep redaction mandatory in production, separate local debug mode from deployment configuration, and scrub the existing log buffer/export path.

6. **Mixed module system and engine mismatch.** `moviebox.js` uses ESM syntax while the root package is CommonJS and advertises Node >=14. It works under Node 26's current module handling, but the project should not depend on runtime-specific syntax detection. Convert it and its helpers to a deliberate module format and test the exact Docker Node version in CI.

7. **No automated Node API test suite.** The only package-level automated test command is in the Cloudflare subproject. The main `tests/` directory and most live audit material are ignored/untracked, so route security, config merging, token behavior, normalization, proxy safety, and registry coverage are not protected by CI. Add deterministic `node:test` coverage for these areas and keep live provider audits separate.

### P2 — improve maintainability and operations

8. **Registry/documentation drift.** Correct the README provider count, remove or restore `vidfast1.js`, and add a startup/test assertion that every scanned provider has a mapped callable export.

9. **Lint debt obscures real regressions.** Establish a staged lint plan: first make core files and newly modified providers clean, then migrate generated/legacy providers. Avoid making all legacy warnings a prerequisite for every small fix, but do fail CI on new errors.

10. **Cookie/session hardening.** Add `Secure` to the session cookie when serving HTTPS, use a constant-time signature comparison for session HMACs, and ensure the trusted-proxy/IP model cannot be bypassed by arbitrary `X-Forwarded-For` headers.

11. **Admin UI output safety.** Render keys/cookies with `textContent`, not HTML interpolation. Avoid putting the stream-token hash into test URLs; use a server-side functional-test endpoint or a short-lived test credential.

12. **Align deployment documentation.** Update the Cloudflare README backend URL, choose a single supported Node baseline, document auth/session persistence in Compose, and move the image to `npm ci` after lockfile verification.

## 11. Current working-tree changes

The review started with four modified files, all still present at completion:

- `providers/MoviesHunt.js`: aggregates search results across query variants, filters movie-like results from series matches, and makes diagnostic error formatting safer. It also currently has lint errors for empty blocks and mixed spaces/tabs.
- `public/config.html`: adds the provider-test modal.
- `public/index.js`: adds provider-test actions and target selection, including token-bearing test URLs.
- `public/style.css`: styles the new provider-test button.

The review did not stage, commit, or modify these files. A subtitle cache modification caused by the live MovieBox smoke call was restored before finishing.

## 12. Recommended execution order

1. Lock down `/api/config`, `/api/debug/env`, and proxy routes; remove or redact all secret-bearing responses.
2. Remove tracked runtime files and rotate any keys/cookies/password-derived material that may have been exposed.
3. Remove hard-coded provider keys and enforce redacted logging.
4. Normalize MovieBox/module format and pin/test the supported Node version.
5. Add deterministic API/config/auth/registry/proxy tests and a registry export-consistency check.
6. Clean the current `MoviesHunt` change and establish a no-new-lint-errors rule.
7. Align Worker/Docker documentation and persistence behavior.
8. Only then perform another live provider audit and update the provider count/report.

Overall, the project has a strong aggregation concept, a broad provider surface, useful operational tooling, and a workable deployment split. Its immediate risk is not the provider logic itself; it is that the administrative configuration boundary and optional network proxy are currently much more open than the UI design implies.
