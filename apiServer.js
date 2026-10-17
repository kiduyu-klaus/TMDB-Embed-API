const { installConsoleLogCapture, getConsoleLogs } = require('./utils/consoleLogs');
installConsoleLogCapture();
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const os = require('os');
const { config, saveConfigPatch, OVERRIDE_PATH } = require('./utils/config');
const { authenticate, issueSession, requireAuth, getSession, updatePassword } = require('./utils/auth');
const path = require('path');
const { listProviders, getProvider, getCookieStats } = require('./providers/registry');
const { createProxyRoutes, processStreamsForProxy } = require('./proxy/proxyServer');
const { resolveImdbId } = require('./utils/tmdb');
const { applyFilters } = require('./utils/streamFilters');
const { requireStreamToken, hashStreamToken, isValidStreamTokenFormat, normalizeTokenHash } = require('./utils/streamToken');

const app = express();
app.set('trust proxy', 1);

// Raw JSON documents have no HTML icon link. Browsers look at the origin root
// for /favicon.ico, including when the API is mounted under a sub-path.
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), { maxAge: '1h' });
});

// --- Sub-path mounting (e.g. hosted at https://host/kiduyuTv_providers) ---
// MOUNT_PATH lets the whole app live under a prefix. Everything below is
// registered on a router, which is then mounted at the prefix. Leave it empty
// to serve from the domain root (plain localhost / Docker setups).
function normalizeMountPath(raw) {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  if (!value || value === '/') return '';
  if (!value.startsWith('/')) value = '/' + value;
  return value.replace(/\/+$/, '');
}
const MOUNT_PATH = normalizeMountPath(process.env.MOUNT_PATH);
const router = express.Router();
const errorPages = require('./utils/errorPages').createErrorPages(MOUNT_PATH);
app.use(errorPages.middleware);
router.get('/error.html', (req, res) => errorPages.send(req, res, req.query.status || 500));

if (config.enableProxy) {
  console.log('[startup] enableProxy flag active: mounting proxy routes');
  createProxyRoutes(router, MOUNT_PATH);
} else {
  console.log('[startup] enableProxy flag disabled: proxy routes not mounted');
}
if (MOUNT_PATH) console.log(`[startup] MOUNT_PATH active: serving under ${MOUNT_PATH}`);

// --- Simple In-Memory Rate Limiting for /auth/login ---
const loginAttempts = new Map(); // key: ip, value: { count, first, last, lockedUntil }
const MAX_ATTEMPTS_WINDOW = 5; // attempts allowed
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes window
const BASE_LOCK_MS = 5 * 60 * 1000; // 5 minutes base lock

function getClientIp(req){
  return (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
}

function recordLoginFailure(ip){
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry) {
    entry = { count:1, first: now, last: now, lockedUntil:0 };
    loginAttempts.set(ip, entry);
    return entry;
  }
  // Reset window if outside timeframe and not locked
  if (now - entry.first > WINDOW_MS && now > entry.lockedUntil) {
    entry.count = 1;
    entry.first = now;
  } else {
    entry.count++;
  }
  entry.last = now;
  if (entry.count > MAX_ATTEMPTS_WINDOW) {
    // Exponential backoff lock: base * 2^(count - limit)
    const over = entry.count - MAX_ATTEMPTS_WINDOW;
    const lockMs = BASE_LOCK_MS * Math.min(8, Math.pow(2, over-1));
    entry.lockedUntil = now + lockMs;
  }
  return entry;
}

function canAttempt(ip){
  const entry = loginAttempts.get(ip);
  if (!entry) return { allowed:true };
  const now = Date.now();
  if (entry.lockedUntil && now < entry.lockedUntil) {
    return { allowed:false, retryAfter: Math.ceil((entry.lockedUntil - now)/1000) };
  }
  if (now - entry.first > WINDOW_MS) {
    // Window passed; reset
    loginAttempts.delete(ip);
    return { allowed:true };
  }
  return { allowed:true };
}

function recordLoginSuccess(ip){
  // On success clear state to avoid lingering count
  loginAttempts.delete(ip);
}

// Guard against premature process.exit from imported legacy modules, but allow controlled restarts
const realProcessExit = process.exit.bind(process);
const instanceId = require('crypto').randomUUID();
const { restartMode } = require('./utils/restartMode');
let restartPending = false;
let shutdownManager;
function scheduleRestart() {
  if (restartPending) return;
  restartPending = true;
  // The restart endpoint calls this after its response has flushed.
  setTimeout(() => shutdownManager.shutdown('restart'), 300);
}
let allowControlledExit = false;
process.exit = function(code){
  if (allowControlledExit) return realProcessExit(code);
  console.warn('[diagnostic] Intercepted process.exit with code', code, new Error('exit trace').stack);
  // keep process alive for debugging
};
setImmediate(()=>console.log('[diagnostic] post-start setImmediate fired'));
router.use(cors());
router.use((req, res, next) => {
  if (restartPending) {
    res.setHeader('Connection', 'close');
    return res.status(503).json({ success: false, error: 'SERVER_RESTARTING' });
  }
  next();
});
router.use(express.json());

// --- Auth Routes (login before static serving) ---
router.post('/auth/login', (req,res) => {
  const { username, password } = req.body || {};
  const ip = getClientIp(req);
  const attemptState = canAttempt(ip);
  if (!attemptState.allowed) {
    res.setHeader('Retry-After', String(attemptState.retryAfter));
    return res.status(429).json({ success:false, error:'TOO_MANY_ATTEMPTS', retryAfter: attemptState.retryAfter });
  }
  if (!username || !password) return res.status(400).json({ success:false, error:'MISSING_CREDENTIALS' });
  if (!authenticate(username, password)) {
    const entry = recordLoginFailure(ip);
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
      const retryAfter = Math.ceil((entry.lockedUntil - Date.now())/1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ success:false, error:'LOCKED', retryAfter });
    }
    return res.status(401).json({ success:false, error:'INVALID_CREDENTIALS', remaining: Math.max(0, MAX_ATTEMPTS_WINDOW - entry.count) });
  }
  recordLoginSuccess(ip);
  const token = issueSession(username);
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12*60*60}`);
  res.json({ success:true, username });
});

router.post('/auth/logout', (req,res) => {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ success:true });
});

router.get('/auth/session', (req,res) => {
  const sess = getSession(req);
  if (!sess) return res.json({ authenticated:false });
  res.json({ authenticated:true, username: sess.u });
});

router.post('/auth/change-password', requireAuth, (req,res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ success:false, error:'MISSING_FIELDS' });
  const sess = req.session;
  if (!authenticate(sess.u, oldPassword)) return res.status(401).json({ success:false, error:'INVALID_OLD_PASSWORD' });
  if (newPassword.length < 8) return res.status(400).json({ success:false, error:'PASSWORD_TOO_SHORT' });
  if (!updatePassword(sess.u, newPassword)) return res.status(500).json({ success:false, error:'UPDATE_FAILED' });
  res.json({ success:true, message:'PASSWORD_UPDATED' });
});

// Protect config panel (HTML) explicitly before static middleware
router.get('/config.html', (req,res,next) => {
  const sess = getSession(req);
  if (!sess) return res.redirect(302, `${MOUNT_PATH}/`);
  res.setHeader('Cache-Control','no-store, must-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.sendFile(path.join(process.cwd(),'public','config.html'));
});

// Explicit root handler for login page to ensure no-store
router.get('/', (req,res) => {
  res.setHeader('Cache-Control','no-store, must-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.sendFile(path.join(process.cwd(),'public','index.html'));
});

// Diagnostics for unexpected exits
process.on('beforeExit', (code) => {
  console.log('[diagnostic] beforeExit code=', code);
});
process.on('exit', (code) => {
  console.log('[diagnostic] exit code=', code);
});
process.on('uncaughtException', (err) => {
  console.error('[diagnostic] uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[diagnostic] unhandledRejection', reason);
});
// Periodic heartbeat to confirm event loop activity (can be removed later)
let hbCount = 0;
setInterval(()=>{
  hbCount++;
  if (hbCount % 6 === 0) { // every 60s if interval is 10s
    console.log('[diagnostic] heartbeat 60s elapsed, process alive');
  }
}, 10_000).unref();


// --- Metrics (in-memory) ---
const metrics = {
  startTime: Date.now(),
  requestsTotal: 0,
  streamRequests: 0,
  providerCalls: {},
  lastRequestAt: null,
  lastError: null,
  streamsReturned: 0,
  tmdbToImdbLookups: 0
};

router.use((req,res,next)=>{ metrics.requestsTotal++; metrics.lastRequestAt = Date.now(); next(); });
// Serve static UI (login page at /)
router.use(express.static(path.join(process.cwd(),'public')));

// Config API
// The stream token hash doubles as a bearer credential, so it is only ever
// disclosed to a caller holding a valid admin session.
const REDACTED_TOKEN = '(set — admin session required)';
function redactTokenHashes(source){
  if (!source || typeof source !== 'object') return source;
  if (source.streamTokenHash) source.streamTokenHash = REDACTED_TOKEN;
  return source;
}
router.get('/api/config', (req,res) => {
  const fs = require('fs');
  let override = {};
  try { if (fs.existsSync(OVERRIDE_PATH)) override = JSON.parse(fs.readFileSync(OVERRIDE_PATH,'utf8')); } catch (e) {
    // ignore JSON parse or fs errors reading override; return base config
  }
  const isAdmin = !!getSession(req);
  const mergedOut = isAdmin ? config : redactTokenHashes({ ...config });
  const overrideOut = isAdmin ? override : redactTokenHashes({ ...override });
  res.json({ success:true, merged: mergedOut, override: overrideOut, overridePath: OVERRIDE_PATH });
});
router.post('/api/config', (req,res) => {
  const patch = req.body || {};
  // Token changes go through the session-guarded /api/stream-token endpoint only.
  delete patch.streamTokenHash;
  delete patch.STREAM_TOKEN_HASH;
  if (patch.port) {
    const p = Number(patch.port); if (!Number.isFinite(p) || p<=0 || p>65535) return res.status(400).json({ success:false, error:'INVALID_PORT'});
    patch.port = p;
  }
  if (patch.defaultProviders && !Array.isArray(patch.defaultProviders)) return res.status(400).json({ success:false, error:'DEFAULT_PROVIDERS_NOT_ARRAY'});
  const ok = saveConfigPatch(patch);
  res.json({ success: ok, merged: config });
});

// --- Stream API token management (session required) ---
// The plaintext password is hashed here and discarded; only the digest is stored.
router.post('/api/stream-token', requireAuth, (req,res) => {
  const password = (req.body || {}).password;
  if (!isValidStreamTokenFormat(password)) {
    return res.status(400).json({
      success:false,
      error:'INVALID_TOKEN_PASSWORD',
      message:'Token password must be 8-64 letters or numbers only.'
    });
  }
  const hash = hashStreamToken(password.trim());
  if (!normalizeTokenHash(hash)) {
    return res.status(500).json({ success:false, error:'HASH_FAILED' });
  }
  const ok = saveConfigPatch({ streamTokenHash: hash, STREAM_TOKEN_HASH: null });
  if (!ok) return res.status(500).json({ success:false, error:'SAVE_FAILED' });
  res.json({ success:true, streamTokenHash: normalizeTokenHash(config.streamTokenHash) });
});

// Disable stream endpoint auth by clearing the stored hash.
// NOTE: an empty string (not null) is written on purpose. saveConfigPatch drops
// null keys so they fall back to env, and .env may define STREAM_TOKEN_HASH.
// An explicit '' still normalizes to "unset" but keeps shadowing the env value,
// so this button actually turns auth off.
router.delete('/api/stream-token', requireAuth, (req,res) => {
  const ok = saveConfigPatch({ streamTokenHash: '', STREAM_TOKEN_HASH: null });
  if (!ok) return res.status(500).json({ success:false, error:'SAVE_FAILED' });
  res.json({ success:true, streamTokenHash: null });
});

// Restart endpoint (requires auth via session cookie on /config.html UI)
router.post('/api/restart', (req,res) => {
  const sess = getSession(req);
  if(!sess) return res.status(401).json({ success:false, error:'UNAUTHORIZED' });
  if (restartMode() === 'unavailable') return res.status(503).json({ success: false,
    error: 'RESTART_UNAVAILABLE', message: 'Start the app with npm start, or use the cPanel application manager.' });
  res.once('finish', scheduleRestart);
  res.json({ success:true, message:'RESTARTING', instanceId });
});

// --- Basic informational endpoints ---
router.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, service: 'tmdb-embed-api', instanceId, restartPending, time: new Date().toISOString() });
});

// Metrics endpoint
router.get('/api/metrics', (req,res) => {
  res.json({
    uptimeSeconds: Math.round((Date.now()-metrics.startTime)/1000),
    requestsTotal: metrics.requestsTotal,
    streamRequests: metrics.streamRequests,
    providerCalls: metrics.providerCalls,
    streamsReturned: metrics.streamsReturned,
    tmdbToImdbLookups: metrics.tmdbToImdbLookups,
    lastRequestAt: metrics.lastRequestAt,
    memoryMB: Math.round(process.memoryUsage().rss/1024/1024),
    loadAvg: os.loadavg ? os.loadavg() : [],
    nodeVersion: process.version,
    configDefaults: {
      region: config.defaultRegion,
      providers: config.defaultProviders,
      minQualities: config.minQualities ? Object.keys(config.minQualities).length : 0,
      excludeCodecs: config.excludeCodecs ? Object.keys(config.excludeCodecs).filter(k=>config.excludeCodecs[k]).length : 0,
      febboxCookies: config.febboxCookies.length
    }
  });
});

// Consolidated status (metrics + providers + endpoints)
router.get('/api/status', (req,res) => {
  const endpoints = [
    'GET /api/health',
    'GET /api/metrics',
    'GET /api/status',
    'GET /api/logs (admin session required)',
    'GET /api/providers',
    'GET /api/providers/:name',
    'GET /api/streams/:type/:tmdbId',
    'GET /api/streams/anime/:tmdbId',
    'GET /api/streams/:provider/:type/:tmdbId',
    'POST /api/config',
    'GET /api/config'
  ];
  // Determine cookie requirement heuristically (currently Showbox / PStream)
  const cookieRequiredProviders = new Set(['showbox']);
  const providers = listProviders().map(p => {
    const cookieRequired = cookieRequiredProviders.has(p.name);
    const cookieOk = !cookieRequired || (config.febboxCookies && config.febboxCookies.length > 0);
    return { name: p.name, category: p.category, categories: p.categories, enabled: p.enabled, cookieRequired, cookieOk };
  });
  res.json({ success:true, providerCheckTmdbId: config.providerCheckTmdbId, animeProviderCheckTmdbId: config.animeProviderCheckTmdbId,
    providerCheckType: config.providerCheckType, providerCheckSeriesTmdbId: config.providerCheckSeriesTmdbId,
    providerCheckSeason: config.providerCheckSeason, providerCheckEpisode: config.providerCheckEpisode, metrics: {
    uptimeSeconds: Math.round((Date.now()-metrics.startTime)/1000),
    requestsTotal: metrics.requestsTotal,
    streamRequests: metrics.streamRequests,
    providerCalls: metrics.providerCalls,
    streamsReturned: metrics.streamsReturned,
    tmdbToImdbLookups: metrics.tmdbToImdbLookups,
    lastRequestAt: metrics.lastRequestAt,
    memoryMB: Math.round(process.memoryUsage().rss/1024/1024)
  }, endpoints, providers });
});

// Console log history is private because provider output can contain request details.
router.get('/api/logs', requireAuth, (req, res) => {
  const rawSince = Number(req.query.since || 0);
  const since = Number.isSafeInteger(rawSince) && rawSince >= 0 ? rawSince : 0;
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({ success: true, ...getConsoleLogs(since) });
});

// Providers list
router.get('/api/providers', (req,res) => {
  res.json({ success: true, providers: listProviders() });
});

// Debug environment/config endpoint (do not expose publicly in production)
router.get('/api/debug/env', (req,res) => {
  const cookieStats = getCookieStats ? getCookieStats() : null;
  res.json({
    port: config.port,
    defaultProviders: config.defaultProviders,
    febboxCookieCount: config.febboxCookies.length,
    showboxCacheDir: process.env.SHOWBOX_CACHE_DIR || '(os tmp)',
    nodeVersion: process.version,
    cookieStats
  });
});

// Single provider info
router.get('/api/providers/:name', (req,res) => {
  const p = getProvider(req.params.name);
  if (!p) return res.status(404).json({ success:false, error:'PROVIDER_NOT_FOUND' });
  res.json({ success:true, provider:{ name: p.name, category: p.category, categories: p.categories, enabled: p.enabled } });
});

function providerSupportsCategory(provider, category) {
  return (Array.isArray(provider.categories) ? provider.categories : [provider.category]).includes(category);
}

function sendStreamError(req, res, error) {
  const message = error && error.message ? error.message : 'Failed to fetch streams';
  const { provider = 'aggregate', type, tmdbId } = req.params;
  metrics.lastError = message;
  console.error(`[api] HTTP 500 fetching streams: provider=${provider} type=${type} tmdbId=${tmdbId} season=${req.query.season || '-'} episode=${req.query.episode || '-'}: ${message}`);
  res.status(500).json({ success:false, error:'INTERNAL_ERROR', message });
}

// Aggregate streams across all enabled providers
router.get('/api/streams/:type/:tmdbId', requireStreamToken, async (req,res) => {
  const { type, tmdbId } = req.params;
  if (!['movie','series','anime'].includes(type)) return res.status(400).json({ success:false, error:'INVALID_TYPE' });
  const category = type === 'anime' ? 'Anime' : 'MoviesTv';
  const season = req.query.season ? Number(req.query.season) : null;
  const episode = req.query.episode ? Number(req.query.episode) : null;
  try {
    metrics.streamRequests++;
    const tmdbType = type === 'movie' || (type === 'anime' && season === null && episode === null) ? 'movie' : 'tv';
    const imdbId = await resolveImdbId(tmdbType, tmdbId); if (imdbId) metrics.tmdbToImdbLookups++;
    const availableProviders = listProviders().filter(p => providerSupportsCategory(p, category)).map(p => p.name);
    const configuredProviders = config.defaultProviders.length ? config.defaultProviders : availableProviders;
    const categoryConfiguredProviders = configuredProviders.filter(name => availableProviders.includes(name));
    const selectedProviders = category === 'Anime' && categoryConfiguredProviders.length === 0
      ? availableProviders
      : categoryConfiguredProviders;
    const providerTimings = {};
    const results = await Promise.all(selectedProviders.map(async name => {
      const prov = getProvider(name);
      if (!prov || !prov.enabled || !providerSupportsCategory(prov, category)) return [];
      metrics.providerCalls[name] = (metrics.providerCalls[name]||0)+1;
      try {
        console.log(`[api] invoking provider ${name} for tmdbId=${tmdbId}`);
        const t0 = Date.now();
        const r = await prov.fetch({ tmdbId, type, season, episode, imdbId, filters:{ } });
        providerTimings[name] = Date.now()-t0;
        console.log(`[api] provider ${name} returned ${Array.isArray(r)?r.length:0} streams`);
        return r;
      } catch (e) {
        console.error(`[api] provider ${name} failed:`, e.message);
        providerTimings[name] = null;
        return [];
      }
    }));
    let streams = results.flat();
    streams = applyFilters(streams, 'aggregate', config.minQualities, config.excludeCodecs);
    metrics.streamsReturned += streams.length;
    if (config.enableProxy) {
      const serverUrl = `${req.protocol}://${req.get('host')}${MOUNT_PATH}`;
      streams = processStreamsForProxy(streams, serverUrl);
    }
    res.json({ success:true, tmdbId, imdbId, count: streams.length, providerTimings, streams });
  } catch (e) {
    sendStreamError(req, res, e);
  }
});

// Provider-specific streams
router.get('/api/streams/:provider/:type/:tmdbId', requireStreamToken, async (req,res) => {
  const { provider, type, tmdbId } = req.params;
  if (!['movie','series','anime'].includes(type)) return res.status(400).json({ success:false, error:'INVALID_TYPE' });
  const category = type === 'anime' ? 'Anime' : 'MoviesTv';
  const season = req.query.season ? Number(req.query.season) : null;
  const episode = req.query.episode ? Number(req.query.episode) : null;
  const prov = getProvider(provider);
  if (!prov) return res.status(404).json({ success:false, error:'PROVIDER_NOT_FOUND' });
  if (!providerSupportsCategory(prov, category)) return res.status(404).json({ success:false, error:'PROVIDER_NOT_IN_CATEGORY' });
  if (!prov.enabled) return res.status(503).json({ success:false, error:'PROVIDER_DISABLED' });
  try {
    metrics.streamRequests++;
    metrics.providerCalls[prov.name] = (metrics.providerCalls[prov.name]||0)+1;
    const tmdbType = type === 'movie' || (type === 'anime' && season === null && episode === null) ? 'movie' : 'tv';
    const imdbId = await resolveImdbId(tmdbType, tmdbId); if (imdbId) metrics.tmdbToImdbLookups++;
    const t0 = Date.now();
    let streams = await prov.fetch({ tmdbId, type, season, episode, imdbId, filters:{} });
    const providerTimings = { [prov.name]: Date.now()-t0 };
    streams = applyFilters(streams, prov.name, config.minQualities, config.excludeCodecs);
    metrics.streamsReturned += streams.length;
    if (config.enableProxy) {
      const serverUrl = `${req.protocol}://${req.get('host')}${MOUNT_PATH}`;
      streams = processStreamsForProxy(streams, serverUrl);
    }
    res.json({ success:true, provider: prov.name, tmdbId, imdbId, count: streams.length, providerTimings, streams });
  } catch (e) {
    sendStreamError(req, res, e);
  }
});

// --- Mount the router, then start listening ---
if (MOUNT_PATH) {
  // Canonicalize the bare prefix to a trailing slash so the browser always
  // resolves relative asset URLs and the client-side BASE the same way.
  // This must run before the router mount, otherwise the router's own '/'
  // handler would answer first and the browser would keep the slashless URL.
  app.use((req, res, next) => {
    if (req.path === MOUNT_PATH) return res.redirect(301, `${MOUNT_PATH}/`);
    return next();
  });
  app.use(MOUNT_PATH, router);
  app.use((req, res, next) => {
    if (req.path === MOUNT_PATH || req.path.startsWith(`${MOUNT_PATH}/`)) return next();
    // A 302 degrades a POST to a GET in most clients, which would break stale
    // cached clients posting to the unprefixed path. Forward them instead.
    // The router's own routes are registered WITHOUT the prefix (Express strips
    // it when mounting), and req.url is already prefix-free here, so hand it
    // over untouched rather than re-adding MOUNT_PATH.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return router(req, res, next);
    }
    return res.redirect(302, MOUNT_PATH + req.originalUrl);
  });
} else {
  app.use(router);
}

app.use(errorPages.notFound);
app.use(errorPages.onError);

const PORT = config.port;
const HOST = process.env.BIND_HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}${MOUNT_PATH}`;
  console.log(`KiduyuTvProviders listening on ${base}`);
  if (HOST !== 'localhost') {
    console.log(`Local access (if running on your machine): http://localhost:${PORT}${MOUNT_PATH}`);
  }
  console.log('Endpoints:');
  console.log(`  GET  ${MOUNT_PATH}/api/health`);
  console.log(`  GET  ${MOUNT_PATH}/api/metrics`);
  console.log(`  GET  ${MOUNT_PATH}/api/providers`);
  console.log(`  GET  ${MOUNT_PATH}/api/streams/:type/:id`);
  console.log(`  POST ${MOUNT_PATH}/api/streams/:type/:id`);
  if (!config.febboxCookies || config.febboxCookies.length === 0) {
    console.warn('[startup][warning] No FEBBOX_COOKIES configured. Showbox / PStream related streams may be unavailable. Set FEBBOX_COOKIES in your environment to enable these sources.');
  }
});

server.on('error', (err)=>{ console.error('[diagnostic] server error', err); });

// Close this application's resources before notifying its process supervisor.
const { resources, createShutdownManager } = require('./utils/appLifecycle');
shutdownManager = createShutdownManager(server, {
  resources,
  beforeExit(reason) {
    if (reason !== 'restart' || restartMode() !== 'passenger') return;
    const fs = require('fs');
    fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'tmp', 'restart.txt'), String(Date.now()));
  },
  exit(code, reason) {
    allowControlledExit = true;
    if (reason === 'restart') {
      const mode = restartMode();
      if (mode === 'launcher') return realProcessExit(75);
      if (mode === 'execve') {
        try {
          process.execve(process.execPath, [process.execPath, ...process.execArgv, ...process.argv.slice(1)], process.env);
        } catch (error) {
          console.error('[control] process replacement failed:', error.code);
          return realProcessExit(1);
        }
      }
    }
    realProcessExit(code);
  },
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    restartPending = true;
    shutdownManager.shutdown(signal);
  });
}
