/* SPDX-License-Identifier: GPL-3.0-only
 * Nuvio port of WioSinema/CineStream invokeVidcore.
 */
"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { createVidcoreSession } = require("../utils/vidcoreSession");
const sessions = new AsyncLocalStorage();
const fetch = (url, options, stage) => sessions.getStore()(url, options, stage);

const VIDCORE = "https://vidcore.io";
const DECRYPT = "https://enc-dec.app/api";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const LOG_TAG = "[WioSinema Vidcore]";

function log(message) {
  console.log(`${LOG_TAG} ${message}`);
}

function warn(message) {
  console.warn(`${LOG_TAG} WARN: ${message}`);
}

function logError(message) {
  console.error(`${LOG_TAG} ERROR: ${message}`);
}

function elapsed(startedAt) {
  return `${Date.now() - startedAt}ms`;
}

// Only log origins: signed tokens may also occur in URL paths.
function safeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch (_) {
    return "<unavailable URL>";
  }
}

function pageHeaders() {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
}

function ajaxHeaders(csrfToken) {
  const headers = {
    "User-Agent": UA,
    Referer: `${VIDCORE}/`,
    "X-Requested-With": "XMLHttpRequest",
  };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  return headers;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    warn(`${label}: response was not valid JSON (details redacted)`);
    return null;
  }
}

function resultOf(obj) {
  return obj && obj.result != null ? obj.result : null;
}

async function getText(url, headers, label) {
  const startedAt = Date.now();
  log(`${label}: GET ${safeUrl(url)}`);
  try {
    const response = await fetch(url, { headers }, label);
    const text = await response.text();
    log(
      `${label}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}; ${text.length} response characters (${elapsed(startedAt)})`,
    );
    if (!response.ok) warn(`${label}: request returned a non-success HTTP status`);
    return { ok: response.ok, status: response.status, text };
  } catch (err) {
    logError(`${label}: GET failed after ${elapsed(startedAt)}: request or response processing failed (details redacted)`);
    throw err;
  }
}

async function getJson(url, headers, label) {
  const response = await getText(url, headers, label);
  if (!response.ok) return null;
  const parsed = parseJson(response.text, label);
  if (parsed === null) throw new Error(`${label}: invalid JSON response`);
  return parsed;
}

async function post(url, payload, headers, label) {
  const startedAt = Date.now();
  const requestHeaders = Object.assign({}, headers || {});
  let body = null;
  if (payload != null) {
    requestHeaders["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }

  log(
    `${label}: POST ${safeUrl(url)}${body ? ` (JSON body: ${body.length} characters)` : " (no body)"}`,
  );
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: requestHeaders,
      body,
    }, label);
    const text = await response.text();
    log(
      `${label}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}; ${text.length} response characters (${elapsed(startedAt)})`,
    );
    if (!response.ok) warn(`${label}: request returned a non-success HTTP status`);
    return response.ok ? text : "";
  } catch (err) {
    logError(`${label}: POST failed after ${elapsed(startedAt)}: request or response processing failed (details redacted)`);
    throw err;
  }
}

function tokenFrom(text) {
  let match = /\\["](?:en|token)\\["]\s*:\s*\\["](.*?)\\["]/.exec(text || "");
  if (match) return match[1];
  match = /"(?:en|token)"\s*:\s*"(.*?)"/.exec(text || "");
  return match ? match[1] : null;
}

async function decrypt(text, label) {
  log(`${label}: submitting ${text.length} encrypted characters for decryption`);
  const response = await post(
    `${DECRYPT}/dec-vidcore`,
    { text },
    null,
    `${label} decrypt`,
  );
  if (!response) {
    warn(`${label}: decryption endpoint returned an empty response`);
    return null;
  }
  return parseJson(response, `${label} decrypt`);
}

async function resolveServer(server, streamBase, csrfToken, index, total) {
  if (!server || !server.data) {
    warn(`Server ${index + 1}/${total}  has no data field; skipping`);
    return [];
  }

  const startedAt = Date.now();
  const endpoint = `${streamBase.replace(/\/$/, "")}/${server.data}`;
  log(`Server ${index + 1}/${total} : resolving stream`);

  try {
    const encrypted = await post(
      endpoint,
      null,
      ajaxHeaders(csrfToken),
      `Server ${index + 1}/${total} stream request`,
    );
    if (!encrypted) {
      warn(`Server ${index + 1}/${total} : empty encrypted response`);
      return [];
    }

    const decoded = await decrypt(encrypted, `Server ${index + 1}/${total}`);
    const data = resultOf(decoded);
    if (!data || !data.url) {
      warn(`Server ${index + 1}/${total} : decrypted result has no stream URL`);
      return [];
    }

    const url = data.url;
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];
    const format = url.indexOf(".m3u8") >= 0 ? "m3u8" : "video";
    log(
      `Server ${index + 1}/${total} : stream resolved (${format}, ${tracks.length} subtitle track(s), ${safeUrl(url)}) in ${elapsed(startedAt)}`,
    );

    return [
      {
        name: "WioSinema • Vidcore",
        title: `Vidcore • ${server.name || "Server"}`,
        url,
        quality: 1080,
        provider: "wiosinema-vidcore",
        format,
        subtitles: tracks.map((track) => ({
          file: track.file,
          label: track.label || track.language,
        })),
        headers: { "User-Agent": UA, Referer: `${VIDCORE}/` },
      },
    ];
  } catch (err) {
    logError(
      `Server ${index + 1}/${total}  failed after ${elapsed(startedAt)}: request or response processing failed (details redacted)`,
    );
    return [];
  }
}

async function getVidcoreStreams(tmdbId, mediaType, season, episode) {
  const startedAt = Date.now();
  if (tmdbId == null) {
    warn("No TMDB ID supplied; returning no streams");
    return [];
  }

  const isTv = mediaType === "tv" && season != null && episode != null;
  const page = isTv
    ? `${VIDCORE}/tv/${encodeURIComponent(String(tmdbId))}/${encodeURIComponent(String(season))}/${encodeURIComponent(String(episode))}`
    : `${VIDCORE}/movie/${encodeURIComponent(String(tmdbId))}`;
  log(
    `Starting ${isTv ? "TV" : "movie"} lookup: TMDB ID ${tmdbId}` +
      (isTv ? `, season ${season}, episode ${episode}` : ""),
  );

  try {
    // Page -> content token
    const pageResponse = await getText(page, pageHeaders(), "Page");
    if (!pageResponse.ok) return [];
    const encrypted = tokenFrom(pageResponse.text);
    if (!encrypted) {
      throw new Error(`Could not extract token from Vidcore page (HTTP ${pageResponse.status})`);
    }
    log(`Page: content token extracted (${encrypted.length} characters; value redacted)`);

    // Stage 1 -> server-token request
    const stage1Url = `${DECRYPT}/enc-vidcore?text=${encodeURIComponent(encrypted)}&stage=1`;
    const stage1Json = await getJson(stage1Url, undefined, "Stage 1 decrypt request");
    const stage1 = resultOf(stage1Json);
    if (!stage1 || !stage1.stage1) {
      throw new Error("Invalid stage 1 response: result or handoff URL is missing");
    }
    log(`Stage 1: handoff URL received; CSRF token ${stage1.token ? "present" : "missing"}`);

    const stage1Text = await post(
      stage1.stage1,
      null,
      ajaxHeaders(stage1.token),
      "Stage 1 Vidcore handoff",
    );
    if (!stage1Text) throw new Error("Stage 1 Vidcore handoff returned an empty response");

    // Stage 2 -> server-list and stream endpoints
    const stage2Url = `${DECRYPT}/enc-vidcore?text=${encodeURIComponent(stage1Text)}&stage=2`;
    const stage2Json = await getJson(stage2Url, undefined, "Stage 2 decrypt request");
    const stage2 = resultOf(stage2Json);
    if (!stage2 || !stage2.servers || !stage2.stream) {
      throw new Error("Invalid stage 2 response: server-list or stream endpoint is missing");
    }
    log(
      `Stage 2: server-list and stream endpoints received; CSRF token ${stage2.token ? "present" : "missing"}`,
    );

    // Encrypted server list -> decrypted server array
    const serversEncrypted = await post(
      stage2.servers,
      null,
      ajaxHeaders(stage2.token),
      "Server list request",
    );
    if (!serversEncrypted) throw new Error("Server list request returned an empty response");
    const serversDecoded = await decrypt(serversEncrypted, "Server list");
    const servers = resultOf(serversDecoded);
    if (!Array.isArray(servers)) {
      throw new Error("Decrypted server list is not an array");
    }
    log(
      `Server list: ${servers.length} server(s) received`,
    );
    if (!servers.length) {
      log(`Finished with no servers in ${elapsed(startedAt)}`);
      return [];
    }

    // Resolve every server concurrently and remove duplicate stream URLs.
    const groups = await Promise.all(
      servers.map((server, index) =>
        resolveServer(server, stage2.stream, stage2.token, index, servers.length),
      ),
    );
    const streams = [];
    const seen = new Set();
    let duplicates = 0;
    groups.forEach((group) => {
      group.forEach((stream) => {
        if (!stream.url || seen.has(stream.url)) {
          if (stream.url) duplicates += 1;
          return;
        }
        seen.add(stream.url);
        streams.push(stream);
      });
    });

    log(
      `Finished in ${elapsed(startedAt)}: ${servers.length} server(s), ${streams.length} unique stream(s), ${duplicates} duplicate(s) removed`,
    );
    if (!streams.length) warn("No streams were resolved from any server");
    return streams;
  } catch (err) {
    logError(`Lookup failed after ${elapsed(startedAt)}: request or response processing failed (details redacted)`);

    return [];
  }
}

module.exports = {
  getVidcoreStreams: (...args) => sessions.run(createVidcoreSession(), () => getVidcoreStreams(...args)),
};
