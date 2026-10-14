"use strict";
const axios = require("axios");
const browserPool = require("./browser");

const DIRECT_HOSTS = new Set(["enc-dec.app"]);
const NAV_TIMEOUT_MS = Number(process.env.VIDCORE_NAV_TIMEOUT_MS || 30000);
const REQ_TIMEOUT_MS = 15000;
const SESSION_MAX_MS = Number(process.env.VIDCORE_SESSION_MAX_MS || 90000);
const BLOCKED_TYPES = new Set(["image", "media", "font", "stylesheet"]);
// Headers a page-context fetch() is not allowed to set (browser controls them).
const FORBIDDEN = new Set([
  "user-agent",
  "referer",
  "host",
  "origin",
  "cookie",
  "content-length",
  "accept-encoding",
  "connection",
]);

function makeResponse(status, statusText, text, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText || "",
    text: async () => text,
    headers,
  };
}

function createVidcoreSession({ acquireBrowser = browserPool.acquireBrowser,
  releaseBrowser = browserPool.releaseBrowser, http = axios, logger = console, proxy = null } = {}) {
  let context = null;
  let page = null;
  let acquired = false;
  let closed = false;
  let ready = null;
  let requestId = 0;
  let proxyable403Count = 0;

  async function init() {
    logger.log('[Vidcore] browser.acquire.start');
    const browser = await acquireBrowser();
    acquired = true;
    logger.log('[Vidcore] browser.acquire.complete ' + JSON.stringify({ version: browser.version() }));
    // Headless builds advertise "HeadlessChrome"; present a normal Chrome UA of the same major version.
    const major = String(browser.version()).split(".")[0];
    const contextOptions = {
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
      locale: "en-US",
      viewport: { width: 1366, height: 768 },
    };
    const proxyServer = typeof proxy === "string" ? proxy : proxy && proxy.server;
    if (proxyServer) {
      contextOptions.proxy = { server: proxyServer };
      logger.log('[Vidcore] context.proxy.enabled ' + JSON.stringify({ source: proxy.source || "configured" }));
    }
    context = await browser.newContext(contextOptions);
    // Cookie seen in the browser capture; harmless if the site doesn't need it.
    await context.addCookies([
      { name: "perf_dv6Tr4n", value: "1", domain: "vidcore.io", path: "/" },
    ]);
    await context.addInitScript(() => {
      const nav = globalThis.navigator;
      if (nav) {
        Object.defineProperty(nav, "webdriver", { get: () => false });
      }
    });
    await context.route("**/*", (route) =>
      BLOCKED_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue(),
    );
    page = await context.newPage();
    logger.log('[Vidcore] browser.context.ready');
  }

  async function directFetch(url, options) {
    const res = await http.request({
      url,
      method: (options.method || "GET").toUpperCase(),
      headers: options.headers,
      data: options.body ?? undefined,
      timeout: REQ_TIMEOUT_MS,
      responseType: "text",
      transformResponse: (d) => d,
      validateStatus: () => true,
    });
    return makeResponse(res.status, res.statusText, String(res.data ?? ""), res.headers);
  }

  async function navigate(url) {
    logger.log('[Vidcore] page.navigation.start');
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    if (!res) throw new Error("navigation returned no response");
    let text;
    try {
      text = await res.text(); // raw document body, as the server sent it
    } catch {
      logger.log('[Vidcore] page.html.rendered_fallback');
      text = await page.content();
    }
    // Scripts can add the content token to the rendered DOM after navigation.
    if (res.ok() && !/"(?:en|token)"|\\"(?:en|token)\\"/.test(text)) {
      try {
        await page.waitForFunction(() => /"(?:en|token)"|\\"(?:en|token)\\"/.test(globalThis.document.documentElement.innerHTML),
          null, { timeout: 5000 });
      } catch {
        // A normal page without a token is reported by the provider parser.
      }
      const rendered = await page.content();
      if (rendered) text = rendered;
      logger.log('[Vidcore] page.html.rendered ' + JSON.stringify({ characters: text.length }));
    }
    return makeResponse(res.status(), res.statusText(), text, await res.allHeaders());
  }

  async function pageFetch(url, options) {
    const headers = {};
    for (const [k, v] of Object.entries(options.headers || {})) {
      if (!FORBIDDEN.has(k.toLowerCase())) headers[k] = v;
    }
    const referrer =
      (options.headers && (options.headers.Referer || options.headers.referer)) || undefined;
    const out = await page.evaluate(
      async ({ url, method, headers, body, referrer, timeoutMs }) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const init = { method, headers, body, credentials: "include", signal: ctl.signal };
          if (referrer) init.referrer = referrer;
          const r = await fetch(url, init);
          return { status: r.status, statusText: r.statusText, text: await r.text(),
            headers: Object.fromEntries(["server", "cf-ray", "cf-mitigated", "content-type"].map(k => [k, r.headers.get(k)])) };
        } finally {
          clearTimeout(timer);
        }
      },
      {
        url,
        method: (options.method || "GET").toUpperCase(),
        headers,
        body: options.body ?? null,
        referrer,
        timeoutMs: REQ_TIMEOUT_MS,
      },
    );
    return makeResponse(out.status, out.statusText, out.text, out.headers);
  }

  async function contextFetch(url, options) {
    const res = await context.request.fetch(url, {
      method: (options.method || "GET").toUpperCase(),
      headers: options.headers,
      data: options.body ?? undefined,
      timeout: REQ_TIMEOUT_MS,
      failOnStatusCode: false,
    });
    try {
      return makeResponse(res.status(), res.statusText(), await res.text(), res.headers());
    } finally {
      await res.dispose();
    }
  }

  async function dispatch(url, options = {}, stage = "") {
    if (closed) throw new Error("Vidcore session is closed");
    const host = new URL(url).hostname;
    if (DIRECT_HOSTS.has(host)) return directFetch(url, options);

    if (!ready) ready = init();
    await ready;
    if (closed) throw new Error("Vidcore session is closed");

    if (stage === "Page") return navigate(url);
    try {
      return await pageFetch(url, options);
    } catch (err) {
      // CORS / network failure inside the page -> use the context's request API instead.
      if (/Failed to fetch|NetworkError|Load failed/i.test(String(err && err.message))) {
        logger.log('[Vidcore] request.context_fallback ' + JSON.stringify({ stage }));
        return contextFetch(url, options);
      }
      throw err;
    }
  }

  async function sessionFetch(url, options = {}, stage = "request") {
    const id = ++requestId;
    const started = Date.now();
    const origin = new URL(url).origin;
    logger.log('[Vidcore] request.start ' + JSON.stringify({ stage, requestId: id, origin, method: options.method || 'GET' }));
    try {
      const response = await dispatch(url, options, stage);
      if (response.status === 403 && new URL(url).hostname !== "enc-dec.app") proxyable403Count += 1;
      const headers = response.headers || {};
      logger[response.ok ? "log" : "warn"]("[Vidcore] request.response " + JSON.stringify({
        stage, requestId: id, origin, status: response.status,
        server: headers.server || null, "cf-ray": headers["cf-ray"] || null,
        "cf-mitigated": headers["cf-mitigated"] || null,
        "content-type": headers["content-type"] || null, elapsedMs: Date.now() - started,
      }));
      return response;
    } catch (error) {
      const message = String(error.message || "");
      const reason = /Executable doesn't exist|executable.*exist/i.test(message) ? "CHROMIUM_NOT_INSTALLED"
        : /shared libraries|GLIBC_|Host system is missing dependencies/i.test(message) ? "CHROMIUM_SYSTEM_DEPENDENCIES"
          : /pthread_create|Resource temporarily unavailable|Cannot fork/i.test(message) ? "HOST_RESOURCE_LIMIT"
            : /timeout|timed out/i.test(message) ? "TIMEOUT" : "BROWSER_REQUEST_FAILED";
      logger.warn("[Vidcore] request.failed " + JSON.stringify({ stage, requestId: id, origin, reason, elapsedMs: Date.now() - started }));
      throw new Error(`Vidcore ${reason}; see redacted diagnostics`);
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(watchdog);
    if (ready) {
      try {
        await ready;
      } catch {
        // Ignore initialization failures while closing the session.
      }
    }
    try {
      if (context) await context.close();
    } catch {
      // Ignore browser teardown issues during shutdown.
    }
    if (acquired) releaseBrowser();
    logger.log('[Vidcore] session.closed ' + JSON.stringify({ requests: requestId, browserAcquired: acquired }));
  }

  // Safety net: never leave a context/Chromium running if a lookup hangs.
  const watchdog = setTimeout(() => {
    close();
  }, SESSION_MAX_MS);
  if (watchdog.unref) watchdog.unref();

  sessionFetch.close = close;
  sessionFetch.hadProxyable403 = () => proxyable403Count > 0;
  return sessionFetch;
}

module.exports = { createVidcoreSession };

