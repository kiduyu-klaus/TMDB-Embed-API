"use strict";

const { CookieJar } = require("tough-cookie");
const nodeFetch = require("node-fetch");

// A new instance belongs to one extraction, including its parallel server requests.
function createVidcoreSession({ fetch = nodeFetch, logger = console } = {}) {
  const jar = new CookieJar();
  let sequence = 0;
  return async function request(url, options = {}, stage = "request") {
    const requestId = ++sequence;
    const started = Date.now();
    let current = new URL(url);
    let method = options.method || "GET";
    let body = options.body;
    const headers = new nodeFetch.Headers(options.headers);
    try {
      for (let hop = 0; hop <= 10; hop++) {
        // Recompute on every hop: cookies must obey domain, path, expiry and Secure.
        headers.delete("cookie");
        const cookie = await jar.getCookieString(current.href);
        if (cookie) headers.set("cookie", cookie);
        const response = await fetch(current.href, {
          ...options, method, body, headers, redirect: "manual", timeout: 15000,
        });
        const details = {
          stage, requestId, hop, method, origin: current.origin,
          status: response.status,
          server: response.headers.get("server"),
          "cf-ray": response.headers.get("cf-ray"),
          "cf-mitigated": response.headers.get("cf-mitigated"),
          "content-type": response.headers.get("content-type"),
          elapsedMs: Date.now() - started,
        };
        logger[response.status >= 400 ? "warn" : "log"](
          "[Vidcore] request.response " + JSON.stringify(details),
        );
        for (const value of response.headers.raw()["set-cookie"] || []) {
          await jar.setCookie(value, current.href, { ignoreError: true });
        }
        const location = response.headers.get("location");
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
        if (response.body && response.body.destroy) response.body.destroy();
        if (hop === 10) throw new Error("Redirect limit");
        const next = new URL(location, current);
        if (!['http:', 'https:'].includes(next.protocol) ||
            (current.protocol === 'https:' && next.protocol !== 'https:')) {
          throw new Error("Unsafe redirect");
        }
        if (next.origin !== current.origin) {
          for (const name of ["authorization", "proxy-authorization", "x-csrf-token", "referer", "origin"]) headers.delete(name);
        }
        if ((response.status === 303 && method !== "HEAD") ||
            ([301, 302].includes(response.status) && method === "POST")) {
          method = "GET";
          body = undefined;
          headers.delete("content-type");
          headers.delete("content-length");
        }
        current = next;
      }
    } catch (_) {
      logger.warn("[Vidcore] request.failed " + JSON.stringify({
        stage, requestId, origin: current.origin, elapsedMs: Date.now() - started,
      }));
      // Fetch error messages can contain the complete signed request URL.
      throw new Error("Vidcore request failed; see redacted request diagnostics");
    }
  };
}

module.exports = { createVidcoreSession };
