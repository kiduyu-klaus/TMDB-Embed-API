const cheerio = require('cheerio');
const tmdb = require('../utils/tmdb');
const { scoreCandidate } = require('../utils/titleMatch');
const path = require('path');
const { Worker } = require('worker_threads');
const { resources } = require('../utils/appLifecycle');

const BASE_URL = 'https://ww1.goojara.to';
const BASE_HOST = new URL(BASE_URL).host;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS_IN_PARALLEL = 6;
const SEARCH_FIELDS = { z: 'Mwxxa3Vnaw', x: 'b3716e05ff' };
const LULUVDO_HOSTS = new Set(['luluvdo.com', 'www.luluvdo.com', 'luluvido.com', 'www.luluvido.com']);
const DOOD_HOSTS = new Set(['dood.watch', 'www.dood.watch']);
const VIDSRC_HOSTS = new Set(['vidsrc.sh', 'www.vidsrc.sh']);
const VIDSRC_PLAYER_HOSTS = new Set(['stellarconductornexus.com']);
const VIDSRC_DATA_HOSTS = new Set(['data.vidsrc.sh']);
const MAX_VIDSRC_WASM_BYTES = 1_000_000;
const MAX_VIDSRC_STREAM_DATA_BYTES = 256_000;
const VIDSRC_DECRYPT_TIMEOUT_MS = 2_000;

function isSiteUrl(value, base = BASE_URL) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && url.host === BASE_HOST ? url : null;
  } catch {
    return null;
  }
}

function parseSearchResults(html, base = BASE_URL) {
  const $ = cheerio.load(html || '');
  return $('li a').toArray().map((anchor) => {
    const title = $(anchor).text().replace(/\s+/g, ' ').trim();
    const url = isSiteUrl($(anchor).attr('href'), base);
    return title && url ? { title, url: url.href } : null;
  }).filter(Boolean);
}

function extractYear(value) {
  const match = String(value || '').match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function selectSearchResult(details, mediaType, results) {
  const title = mediaType === 'movie' ? details.title : details.name;
  if (!title || !results.length) return null;
  const query = {
    title,
    originalTitle: mediaType === 'movie' ? details.original_title : details.original_name,
    year: extractYear(mediaType === 'movie' ? details.release_date : details.first_air_date),
    type: mediaType === 'tv' ? 'series' : 'movie',
  };
  const ranked = results.map((result) => {
    const candidate = {
      title: result.title,
      year: extractYear(result.title),
      type: query.type,
    };
    return { result, score: scoreCandidate(query, candidate).score };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  return best && best.score >= 0.58 ? best.result : null;
}

function parseEpisodeUrl(html, episode, seasonUrl) {
  const $ = cheerio.load(html || '');
  let result = null;
  $('div.seho').each((_, element) => {
    if (result) return;
    const numberText = $(element).find('span.sea').first().text();
    const episodeNumber = Number((numberText.match(/\d+/) || [])[0]);
    if (episodeNumber !== Number(episode)) return;
    const href = $(element).find('a[href]').first().attr('href');
    const url = href && isSiteUrl(href, seasonUrl);
    if (url) result = url.href;
  });
  return result;
}

function parseServerLinks(html, pageUrl) {
  const $ = cheerio.load(html || '');
  return $('#drl a[href]').toArray().map((anchor, index) => {
    const label = $(anchor).text().replace(/\s+/g, ' ').trim() || `Server ${index + 1}`;
    let url;
    try {
      url = new URL($(anchor).attr('href'), pageUrl);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:') return null;
    return { label, url: url.href };
  }).filter(Boolean);
}

function extractQuality(label) {
  const text = String(label || '');
  if (/\b4k\b|2160p|3840x2160/i.test(text)) return '4K';
  const dimensions = text.match(/\b\d{3,4}x(1440|1080|720|576|480|360)\b/i);
  if (dimensions) return `${dimensions[1]}p`;
  const match = text.match(/\b(1080|720|576|480|360)p\b/i);
  return match ? `${match[1]}p` : 'Auto';
}

function extractPlaybackHeaders(source, fallback = {}) {
  const candidates = [
    source && source.headers,
    source && source.requestHeaders,
    source && source.httpHeaders,
    source && source.behaviorHints && source.behaviorHints.proxyHeaders && source.behaviorHints.proxyHeaders.request,
  ];
  const headers = { ...fallback };
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    for (const [name, value] of Object.entries(candidate)) {
      if (typeof value === 'string' && value.trim() && !/[\r\n]/.test(name + value)) headers[name] = value;
    }
  }
  return headers;
}

function skipWhitespace(source, position) {
  while (/\s/.test(source[position] || '')) position += 1;
  return position;
}

// Read JavaScript string literals as data; never evaluate the page's script.
function readJsStringLiteral(source, position) {
  const quote = source[position];
  if (quote !== '"' && quote !== "'") return null;
  let value = '';
  for (let index = position + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return { value, position: index + 1 };
    if (character !== '\\') {
      if (character === '\n' || character === '\r') return null;
      value += character;
      continue;
    }
    const escaped = source[++index];
    if (escaped == null) return null;
    if (escaped === 'n') value += '\n';
    else if (escaped === 'r') value += '\r';
    else if (escaped === 't') value += '\t';
    else if (escaped === 'b') value += '\b';
    else if (escaped === 'f') value += '\f';
    else if (escaped === 'v') value += '\v';
    else if (escaped === '0') value += '\0';
    else if (escaped === '\n') { /* JavaScript line continuation. */ }
    else if (escaped === '\r') {
      if (source[index + 1] === '\n') index += 1;
    } else if (escaped === 'x') {
      const hex = source.slice(index + 1, index + 3);
      if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
      value += String.fromCharCode(parseInt(hex, 16));
      index += 2;
    } else if (escaped === 'u') {
      if (source[index + 1] === '{') {
        const end = source.indexOf('}', index + 2);
        if (end < 0) return null;
        const hex = source.slice(index + 2, end);
        if (!/^[0-9a-f]+$/i.test(hex)) return null;
        value += String.fromCodePoint(parseInt(hex, 16));
        index = end;
      } else {
        const hex = source.slice(index + 1, index + 5);
        if (!/^[0-9a-f]{4}$/i.test(hex)) return null;
        value += String.fromCharCode(parseInt(hex, 16));
        index += 4;
      }
    } else value += escaped;
  }
  return null;
}

function readPackerNumber(source, position) {
  const match = /^\s*(\d+)\s*,/.exec(source.slice(position));
  return match ? { value: Number(match[1]), position: position + match[0].length } : null;
}

function unpackPackedPlayerScript(script) {
  const source = String(script || '');
  if (source.length > 100_000) return null;
  const signature = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{/.exec(source);
  if (!signature) return null;
  const invocationPattern = /\}\s*\(/g;
  invocationPattern.lastIndex = signature.index + signature[0].length;
  const invocation = invocationPattern.exec(source);
  if (!invocation) return null;

  let position = invocation.index + invocation[0].length;
  const payload = readJsStringLiteral(source, position);
  if (!payload) return null;
  position = skipWhitespace(source, payload.position);
  if (source[position] !== ',') return null;
  position += 1;
  const base = readPackerNumber(source, position);
  if (!base || base.value < 2 || base.value > 36) return null;
  const count = readPackerNumber(source, base.position);
  if (!count || count.value < 1 || count.value > 1000) return null;
  const dictionary = readJsStringLiteral(source, count.position);
  if (!dictionary) return null;
  position = skipWhitespace(source, dictionary.position);
  const splitCall = /^\.split\s*\(/.exec(source.slice(position));
  if (!splitCall) return null;
  position += splitCall[0].length;
  const delimiter = readJsStringLiteral(source, skipWhitespace(source, position));
  if (!delimiter || delimiter.value !== '|') return null;

  const words = dictionary.value.split('|');
  let decoded = payload.value;
  for (let index = count.value - 1; index >= 0; index -= 1) {
    if (words[index]) {
      const token = index.toString(base.value);
      decoded = decoded.replace(new RegExp(`\\b${token}\\b`, 'g'), () => words[index]);
    }
  }
  return decoded;
}

function extractPackedMediaUrls(scripts) {
  const blocks = Array.isArray(scripts) ? scripts : [String(scripts || '')];
  const found = new Set();
  for (const block of blocks) {
    const decoded = unpackPackedPlayerScript(block);
    if (!decoded) continue;
    const normalized = decoded.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&');
    const matches = normalized.match(/https?:\/\/[^\s"'`<>\\]+/g) || [];
    for (const match of matches) {
      try {
        const url = new URL(match.replace(/[),;]+$/, ''));
        if (url.protocol === 'https:' && /\.(?:m3u8|mp4|mpd)$/i.test(url.pathname)) found.add(url.href);
      } catch { /* Ignore malformed or non-absolute player values. */ }
    }
  }
  return [...found];
}

function parseInlineObject(source, name) {
  const match = String(source || '').match(new RegExp(`(?:window\\.)?${name}\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*;`));
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function hasNoSuchFileNotice(html) {
  const $ = cheerio.load(html || '');
  return $('div.alert.alert-danger').toArray().some(element =>
    /\bno\s+such\s+file\b/i.test($(element).text())
  );
}

function isExcludedStreamUrl(value) {
  try {
    const host = new URL(value).hostname;
    return ['dood.watch', 'dood.re', 'vidsrc.me'].some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return true; }
}

function isEmbedLikeStreamUrl(value) {
  try {
    const url = new URL(value);
    if (VIDSRC_HOSTS.has(url.hostname) || VIDSRC_PLAYER_HOSTS.has(url.hostname)) return true;
    return /(?:^|\/)embed(?:\/|$)/i.test(url.pathname) || /(?:^|\/)player(?:\/|$)/i.test(url.pathname);
  } catch {
    return true;
  }
}

function extractDirectMediaUrls(html, pageUrl) {
  const $ = cheerio.load(html || '');
  const candidates = $('video[src], video source[src], source[src]')
    .toArray().map(element => $(element).attr('src')).filter(Boolean);
  const scripts = $('script:not([src])').toArray().map(element => $(element).html() || '');
  const scriptText = scripts.join('\n').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  candidates.push(...(scriptText.match(/(?:https?:\/\/|\/\/)[^\s"'<>\\]+/g) || []));
  candidates.push(...extractPackedMediaUrls(scripts));
  const unique = new Set();
  return candidates.flatMap(candidate => {
    try {
      const url = new URL(candidate, pageUrl);
      if (url.protocol !== 'https:' || !/\.(?:m3u8|mp4|mpd|webm)(?:$)/i.test(url.pathname)) return [];
      if (unique.has(url.href)) return [];
      unique.add(url.href);
      return [url.href];
    } catch { return []; }
  });
}

function toHttpsUrl(value, base) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function sourceUrlFromText(text, base) {
  const match = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  return match ? toHttpsUrl(match[0].replace(/[),;]+$/, ''), base) : null;
}

async function resolveWootlySources(playerUrl, cookieJar) {
  const landingUrl = toHttpsUrl(playerUrl);
  if (!landingUrl || !['www.wootly.ch', 'wootly.ch'].includes(landingUrl.hostname)
      || landingUrl.pathname !== '/' || !landingUrl.searchParams.get('v')) return [];
  const landingPage = await requestText(landingUrl.href, cookieJar, { redirect: 'manual' });
  const $landing = cheerio.load(landingPage.text);
  const iframeHref = $landing('iframe[src]').first().attr('src');
  const iframeUrl = iframeHref && toHttpsUrl(iframeHref, landingUrl.href);
  if (!iframeUrl || iframeUrl.hostname !== 'web.wootly.ch' || !iframeUrl.pathname.startsWith('/e/')) return [];

  const gatePage = await requestText(iframeUrl.href, cookieJar, {
    redirect: 'manual',
    headers: { Referer: landingUrl.href },
  });
  const $gate = cheerio.load(gatePage.text);
  const form = new URLSearchParams();
  $gate('#jgb input').each((_, element) => {
    const name = $gate(element).attr('name');
    if (name) form.append(name, $gate(element).attr('value') || '');
  });
  if (!form.has('qdfx')) return [];
  const playerResponse = await request(iframeUrl.href, cookieJar, {
    method: 'POST',
    redirect: 'manual',
    headers: { Referer: iframeUrl.href, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!playerResponse.ok) return [];
  const playerHtml = await playerResponse.text();
  const $player = cheerio.load(playerHtml);
  const playerScripts = $player('script:not([src])').toArray().map(element => $player(element).html() || '');
  const inline = playerScripts.join('\n');
  const videoId = inline.match(/\bvd\s*=\s*["']([^"']+)["']/)?.[1];
  const token = inline.match(/\btk\s*=\s*["']([^"']+)["']/)?.[1];
  if (!videoId || !token) return [];

  const grabUrl = new URL('/grabm', iframeUrl.origin);
  grabUrl.searchParams.set('t', token);
  grabUrl.searchParams.set('id', videoId);
  const grabResponse = await request(grabUrl.href, cookieJar, {
    redirect: 'manual',
    headers: { Referer: iframeUrl.href },
  });
  let sourceUrl;
  const grabLocation = grabResponse.headers && grabResponse.headers.get('location');
  if (grabLocation) sourceUrl = toHttpsUrl(grabLocation, grabUrl.href);
  else if (grabResponse.ok) sourceUrl = sourceUrlFromText(await grabResponse.text(), grabUrl.href);
  if (!sourceUrl) return [];

  if (sourceUrl.hostname === 'web.wootly.ch' && sourceUrl.pathname === '/source') {
    const sourceResponse = await request(sourceUrl.href, cookieJar, {
      redirect: 'manual',
      headers: { Referer: iframeUrl.href },
    });
    const location = sourceResponse.headers && sourceResponse.headers.get('location');
    if (location) sourceUrl = toHttpsUrl(location, sourceUrl.href);
    else if (sourceResponse.ok) sourceUrl = sourceUrlFromText(await sourceResponse.text(), sourceUrl.href);
    else return [];
  }
  return sourceUrl ? [{
    url: sourceUrl.href,
    quality: extractQuality(sourceUrl.pathname),
    headers: { Referer: iframeUrl.href, 'User-Agent': USER_AGENT },
  }] : [];
}

async function resolveLuluvdoSources(downloadUrl, cookieJar) {
  const pageUrl = toHttpsUrl(downloadUrl);
  if (!pageUrl || !LULUVDO_HOSTS.has(pageUrl.hostname)) return [];
  const pathMatch = pageUrl.pathname.match(/^\/(?:(d|e)\/)?([a-z0-9_-]+)\/?$/i);
  if (!pathMatch) return [];
  const route = (pathMatch[1] || '').toLowerCase();
  const fileId = pathMatch[2];
  let downloadText = '';
  let embedUrl;
  if (route !== 'e') {
    const downloadPage = await requestText(pageUrl.href, cookieJar, { redirect: 'manual' });
    downloadText = cheerio.load(downloadPage.text)('title').text();
    if (hasNoSuchFileNotice(downloadPage.text)) {
      console.warn('[Goojara] Luluvdo link skipped: No such file');
      return [];
    }
    const $download = cheerio.load(downloadPage.text);
    const iframeHref = $download('iframe[src]').toArray().map(element => $download(element).attr('src')).find((href) => {
      const candidate = href && toHttpsUrl(href, pageUrl.href);
      return candidate && ['luluvido.com', 'www.luluvido.com'].includes(candidate.hostname)
        && candidate.pathname === `/e/${fileId}`;
    });
    embedUrl = iframeHref ? toHttpsUrl(iframeHref, pageUrl.href) : new URL(`/e/${fileId}`, 'https://luluvido.com');
  } else {
    embedUrl = new URL(pageUrl.href);
  }
  if (!['luluvido.com', 'www.luluvido.com'].includes(embedUrl.hostname) || embedUrl.pathname !== `/e/${fileId}`) return [];

  const playerPage = await requestText(embedUrl.href, cookieJar, {
    redirect: 'manual',
    headers: { Referer: pageUrl.href },
  });
  if (hasNoSuchFileNotice(playerPage.text)) {
    console.warn('[Goojara] Luluvdo player skipped: No such file');
    return [];
  }
  const $player = cheerio.load(playerPage.text);
  const mediaUrls = extractDirectMediaUrls(playerPage.text, embedUrl.href);
  const metadata = `${downloadText} ${$player('title').text()}`;
  return mediaUrls.map(url => ({
    url,
    quality: extractQuality(metadata),
    headers: { Referer: embedUrl.href, 'User-Agent': USER_AGENT },
  }));
}

async function resolveDoodSources(downloadUrl, cookieJar) {
  const pageUrl = toHttpsUrl(downloadUrl);
  if (!pageUrl || !DOOD_HOSTS.has(pageUrl.hostname) || !/^\/(?:d|e)\/[a-z0-9_-]+\/?$/i.test(pageUrl.pathname)) return [];
  const downloadPage = await requestText(pageUrl.href, cookieJar, {
    headers: { Referer: `${BASE_URL}/` },
  });
  const $download = cheerio.load(downloadPage.text);
  const pageText = $download('body').text().replace(/\s+/g, ' ');
  if (hasNoSuchFileNotice(downloadPage.text) || /(?:video|file).{0,80}(?:not found|no longer available)/i.test(pageText)) return [];

  let mediaUrls = extractDirectMediaUrls(downloadPage.text, downloadPage.response.url || pageUrl.href);
  if (!mediaUrls.length) {
    const iframeHref = $download('iframe[src]').first().attr('src');
    const iframeUrl = iframeHref && toHttpsUrl(iframeHref, pageUrl.href);
    if (iframeUrl && DOOD_HOSTS.has(iframeUrl.hostname)) {
      const playerPage = await requestText(iframeUrl.href, cookieJar, { headers: { Referer: pageUrl.href } });
      const $player = cheerio.load(playerPage.text);
      const playerText = $player('body').text().replace(/\s+/g, ' ');
      if (hasNoSuchFileNotice(playerPage.text) || /(?:video|file).{0,80}(?:not found|no longer available)/i.test(playerText)) return [];
      mediaUrls = extractDirectMediaUrls(playerPage.text, playerPage.response.url || iframeUrl.href);
    }
  }
  return mediaUrls.map(url => ({
    url,
    quality: extractQuality(url),
    headers: { Referer: pageUrl.href, 'User-Agent': USER_AGENT },
  }));
}

async function fetchVidSrcWasm(descriptor, playerUrl, cookieJar) {
  if (descriptor && typeof descriptor.wasm_url === 'string') {
    const wasmUrl = toHttpsUrl(descriptor.wasm_url, playerUrl.href);
    if (!wasmUrl || !VIDSRC_DATA_HOSTS.has(wasmUrl.hostname) || wasmUrl.pathname !== '/wasm.php') return null;
    const response = await request(wasmUrl.href, cookieJar, {
      headers: { Referer: playerUrl.href, Accept: 'application/wasm' },
    });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MAX_VIDSRC_WASM_BYTES ? bytes : null;
  }
  if (descriptor && typeof descriptor.wasm === 'string' && descriptor.wasm.length <= MAX_VIDSRC_WASM_BYTES * 2) {
    const encoded = descriptor.wasm.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Buffer.from(encoded, 'base64');
    return bytes.length > 0 && bytes.length <= MAX_VIDSRC_WASM_BYTES ? bytes : null;
  }
  return null;
}

async function decryptVidSrcStreamUrls(encryptedValue, wasmBytes) {
  if (typeof encryptedValue !== 'string' || encryptedValue.length > MAX_VIDSRC_STREAM_DATA_BYTES) return [];
  const module = await WebAssembly.compile(wasmBytes);
  if (WebAssembly.Module.imports(module).length) return [];
  const exportNames = new Set(WebAssembly.Module.exports(module).map(item => item.name));
  if (!['memory', 'alloc', 'decrypt'].every(name => exportNames.has(name))) return [];

  const worker = resources.trackWorker(new Worker(path.join(__dirname, '../utils/vidsrcDecoderWorker.js'), {
    workerData: { encryptedValue, wasmBytes },
    resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 },
  }));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('VidSrc decoder timed out')), VIDSRC_DECRYPT_TIMEOUT_MS);
    worker.once('message', result => {
      if (result && result.ok && typeof result.value === 'string') {
        finish(resolve, result.value.split('\n').filter(Boolean));
      } else {
        finish(reject, new Error('VidSrc decoder returned an invalid result'));
      }
    });
    worker.once('error', () => finish(reject, new Error('VidSrc decoder worker failed')));
    worker.once('exit', code => {
      if (!settled && code !== 0) finish(reject, new Error('VidSrc decoder worker exited unexpectedly'));
    });
  });
}

function isPublicStreamHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') || host === 'localhost' || /(?:^|\.)(?:localhost|local|internal)$/.test(host) || host.includes(':')) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return true;
  const [first, second] = ipv4.slice(1).map(Number);
  return first < 224 && first !== 0 && first !== 10 && first !== 127
    && !(first === 100 && second >= 64 && second <= 127)
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && second === 168);
}

function parseVidSrcToken(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 4096) return '';
  if (value[0] !== '{' && value[0] !== '[') return value;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const token = parsed.token || parsed.data || parsed.string || parsed.result;
      return typeof token === 'string' ? token : '';
    }
  } catch {
    return value;
  }
  return '';
}

async function fetchVidSrcToken(streamUrl, playerUrl, cookieJar) {
  if (!isPublicStreamHostname(streamUrl.hostname) || streamUrl.port) return '';
  const tokenUrl = new URL('/generate.php', streamUrl.origin);
  try {
    const response = await requestText(tokenUrl.href, cookieJar, { headers: { Referer: playerUrl.href } });
    return parseVidSrcToken(response.text);
  } catch {
    return '';
  }
}

function applyVidSrcToken(url, token) {
  if (!token) return url;
  if (url.includes('__TOKEN__')) return url.split('__TOKEN__').join(token);
  const tokenizedUrl = new URL(url);
  tokenizedUrl.searchParams.set('token', token);
  return tokenizedUrl.href;
}

async function resolveVidSrcSources(embedUrlValue, cookieJar) {
  const embedUrl = toHttpsUrl(embedUrlValue);
  if (!embedUrl || !VIDSRC_HOSTS.has(embedUrl.hostname) || !/^\/embed\/(?:tv|movie)\/?$/i.test(embedUrl.pathname)) return [];

  const embedPage = await requestText(embedUrl.href, cookieJar, { headers: { Referer: `${BASE_URL}/` } });
  const $embed = cheerio.load(embedPage.text);
  const apiHref = $embed('#player_iframe').attr('data-api');
  const apiUrl = apiHref && toHttpsUrl(apiHref, embedUrl.href);
  if (!apiUrl || !VIDSRC_HOSTS.has(apiUrl.hostname) || apiUrl.pathname !== '/vs_src.php') return [];

  const apiResponse = await requestText(apiUrl.href, cookieJar, {
    headers: { Referer: embedUrl.href, Accept: 'application/json' },
  });
  let sourcePageData;
  try { sourcePageData = JSON.parse(apiResponse.text); } catch { return []; }
  const shellUrl = toHttpsUrl(sourcePageData && sourcePageData.src);
  if (!shellUrl || !VIDSRC_PLAYER_HOSTS.has(shellUrl.hostname)) return [];

  const shellPage = await requestText(shellUrl.href, cookieJar, { headers: { Referer: embedUrl.href } });
  const shellConfig = parseInlineObject(shellPage.text, 'CFG');
  const playerUrl = shellConfig && toHttpsUrl(shellConfig.playerUrl, shellUrl.href);
  if (!playerUrl || !VIDSRC_PLAYER_HOSTS.has(playerUrl.hostname) || !playerUrl.pathname.startsWith('/embed/player/')) return [];

  const playerPage = await requestText(playerUrl.href, cookieJar, { headers: { Referer: shellUrl.href } });
  const playerConfig = parseInlineObject(playerPage.text, 'CONFIG');
  if (!playerConfig) return [];
  const sourcesUrl = toHttpsUrl(playerConfig.api || playerConfig.streamBase, playerUrl.href);
  if (!sourcesUrl || !VIDSRC_DATA_HOSTS.has(sourcesUrl.hostname) || sourcesUrl.pathname !== '/api.php') return [];
  if (playerConfig.mediaType === 'tv') {
    const season = Number(playerConfig.season);
    const episode = Number(playerConfig.episode);
    if (Number.isInteger(season) && season > 0 && Number.isInteger(episode) && episode > 0) {
      sourcesUrl.searchParams.set('season', String(season));
      sourcesUrl.searchParams.set('episode', String(episode));
    }
  }
  if (!sourcesUrl.searchParams.has('stream_urls')) {
    sourcesUrl.search = `${sourcesUrl.search}${sourcesUrl.search ? '&' : '?'}stream_urls`;
  }
  if (typeof playerConfig.apiToken === 'string' && playerConfig.apiToken) {
    sourcesUrl.searchParams.set('api_token', playerConfig.apiToken);
  }
  const sourcesResponse = await requestText(sourcesUrl.href, cookieJar, {
    headers: { Referer: playerUrl.href, Accept: 'application/json' },
  });
  let payload;
  try { payload = JSON.parse(sourcesResponse.text); } catch { return []; }
  const rawStreamUrls = payload && payload.data && payload.data.stream_urls;
  let streamUrls = Array.isArray(rawStreamUrls) ? rawStreamUrls : [];
  if (typeof rawStreamUrls === 'string' && payload.vs) {
    const wasmBytes = await fetchVidSrcWasm(payload.vs, playerUrl, cookieJar);
    if (wasmBytes) streamUrls = await decryptVidSrcStreamUrls(rawStreamUrls, wasmBytes);
  }
  const sourceEntries = [];
  const seenSourceUrls = new Set();
  for (const value of streamUrls) {
    const rawUrl = typeof value === 'string' ? value : value && (value.url || value.file || value.src || value.stream_url);
    const url = toHttpsUrl(rawUrl);
    if (!url || seenSourceUrls.has(url.href)) continue;
    seenSourceUrls.add(url.href);
    sourceEntries.push({ url, source: value });
  }
  const tokenPromises = new Map();
  return Promise.all(sourceEntries.map(async ({ url, source }) => {
    let resolvedUrl = url.href;
    if (payload.vs) {
      const sourceUrl = new URL(url.href);
      if (!tokenPromises.has(sourceUrl.origin)) {
        tokenPromises.set(sourceUrl.origin, fetchVidSrcToken(sourceUrl, playerUrl, cookieJar));
      }
      const token = await tokenPromises.get(sourceUrl.origin);
      if (token) resolvedUrl = applyVidSrcToken(url.href, token);
    }
    return {
      url: resolvedUrl,
      quality: extractQuality(resolvedUrl),
      headers: extractPlaybackHeaders(source, { Referer: playerUrl.href, 'User-Agent': USER_AGENT }),
    };
  }));
}

function isResolvedPlayerHost(value) {
  try {
    const host = new URL(value).hostname;
    return LULUVDO_HOSTS.has(host) || DOOD_HOSTS.has(host) || VIDSRC_HOSTS.has(host);
  } catch { return false; }
}

async function resolvePlayerSources(playerUrl, cookieJar) {
  try {
    const url = new URL(playerUrl);
    if (['www.wootly.ch', 'wootly.ch'].includes(url.hostname)) return await resolveWootlySources(url.href, cookieJar);
    if (LULUVDO_HOSTS.has(url.hostname)) {
      return await resolveLuluvdoSources(url.href, cookieJar);
    }
    if (DOOD_HOSTS.has(url.hostname)) return await resolveDoodSources(url.href, cookieJar);
    if (VIDSRC_HOSTS.has(url.hostname)) return await resolveVidSrcSources(url.href, cookieJar);
  } catch (error) {
    console.warn(`[Goojara] direct source extraction failed: ${error.message || error.name || 'Error'}`);
  }
  return [];
}

function setCookiesFromHeaders(headers, cookieJar) {
  if (!headers) return;
  let values = [];
  if (typeof headers.getSetCookie === 'function') values = headers.getSetCookie();
  if (!values.length && typeof headers.raw === 'function') {
    const raw = headers.raw();
    values = raw['set-cookie'] || raw['Set-Cookie'] || [];
  }
  if (!values.length && typeof headers.get === 'function') {
    const value = headers.get('set-cookie');
    if (value) values = [value];
  }
  for (const line of values) {
    const pair = String(line).split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator > 0) cookieJar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function getCookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function requestHeaders(url, cookieJar, customHeaders = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    Referer: `${BASE_URL}/`,
    ...customHeaders,
  };
  const target = new URL(url);
  if (target.host === BASE_HOST) {
    const cookie = getCookieHeader(cookieJar);
    if (cookie) headers.Cookie = [headers.Cookie, cookie].filter(Boolean).join('; ');
  } else {
    delete headers.Cookie;
    delete headers.cookie;
  }
  return headers;
}

async function fetchWithTimeout(url, options) {
  const fetcher = globalThis.fetch || require('node-fetch');
  const requestOptions = { ...options };
  let timeout;
  if (typeof AbortController === 'function') {
    const controller = new AbortController();
    requestOptions.signal = controller.signal;
    timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  } else {
    requestOptions.timeout = REQUEST_TIMEOUT_MS;
  }
  try {
    return await fetcher(url, requestOptions);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function request(url, cookieJar, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: requestHeaders(url, cookieJar, options.headers || {}),
  });
  setCookiesFromHeaders(response.headers, cookieJar);
  return response;
}

async function requestText(url, cookieJar, options = {}) {
  const response = await request(url, cookieJar, options);
  if (!response.ok) throw new Error(`Goojara page returned HTTP ${response.status}`);
  return { response, text: await response.text() };
}

function addChallengeCookie(html, cookieJar) {
  const match = String(html || '').match(/\b_3chk\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/);
  if (match) cookieJar.set(match[1], match[2]);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function resolveServer(server, index, cookieJar, title) {
  try {
    let streamUrl = server.url;
    const sourceUrl = new URL(server.url);
    if (sourceUrl.host === BASE_HOST) {
      const response = await request(server.url, cookieJar, {
        redirect: 'manual',
        headers: { Referer: `${BASE_URL}/` },
      });
      const location = response.headers && response.headers.get('location');
      if (!location) {
        console.warn(`[Goojara] ${server.label} redirect returned HTTP ${response.status} without a destination`);
        return [];
      }
      let resolved;
      try {
        resolved = new URL(location, server.url);
      } catch {
        return [];
      }
      if (resolved.protocol !== 'https:') return [];
      streamUrl = resolved.href;
    }
    let sources = [];
    try {
      sources = await resolvePlayerSources(streamUrl, cookieJar);
    } catch (error) {
      console.warn(`[Goojara] ${server.label} direct source lookup failed: ${error.name || 'Error'}`);
    }
    if (!sources.length && (isResolvedPlayerHost(streamUrl) || isExcludedStreamUrl(streamUrl))) return [];
    if (!sources.length) {
      sources = [{
        url: streamUrl,
        quality: extractQuality(server.label),
        headers: { Referer: `${BASE_URL}/`, 'User-Agent': USER_AGENT },
      }];
    }
    return sources.filter(source => !isExcludedStreamUrl(source.url) && !isEmbedLikeStreamUrl(source.url)).map(source => ({
      name: 'Goojara',
      title: `${title} - ${server.label}`,
      url: source.url,
      quality: source.quality || extractQuality(`${server.label} ${source.url}`),
      headers: extractPlaybackHeaders(source, { Referer: `${BASE_URL}/`, 'User-Agent': USER_AGENT }),
      subtitles: [],
      server: server.label,
      sourceIndex: index,
    }));
  } catch (error) {
    console.warn(`[Goojara] ${server.label} redirect failed: ${error.name || 'Error'}`);
    return [];
  }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const cookieJar = new Map();
  try {
    if (!['movie', 'tv'].includes(mediaType)) return [];
    const seasonNumber = Number(season);
    const episodeNumber = Number(episode);
    if (mediaType === 'tv' && (!Number.isInteger(seasonNumber) || seasonNumber < 1 || !Number.isInteger(episodeNumber) || episodeNumber < 1)) {
      console.warn('[Goojara] TV streams require positive season and episode numbers');
      return [];
    }

    const details = await tmdb.getDetails(mediaType, tmdbId);
    if (!details) return [];
    const title = mediaType === 'movie' ? details.title : details.name;
    const originalTitle = mediaType === 'movie' ? details.original_title : details.original_name;
    if (!title) return [];

    // Goojara issues a per-session cookie from its homepage; no copied upstream cookie is needed.
    const home = await request(`${BASE_URL}/`, cookieJar);
    if (!home.ok) throw new Error(`Goojara homepage returned HTTP ${home.status}`);
    await home.text();

    const searchTitle = title;
    const searchBody = new URLSearchParams({ ...SEARCH_FIELDS, q: searchTitle }).toString();
    const searchResponse = await request(`${BASE_URL}/xmre.php`, cookieJar, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: searchBody,
    });
    if (!searchResponse.ok) throw new Error(`Goojara search returned HTTP ${searchResponse.status}`);
    let results = parseSearchResults(await searchResponse.text());
    let matched = selectSearchResult(details, mediaType, results);

    if (!matched && originalTitle && originalTitle !== title) {
      const originalBody = new URLSearchParams({ ...SEARCH_FIELDS, q: originalTitle }).toString();
      const originalResponse = await request(`${BASE_URL}/xmre.php`, cookieJar, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: originalBody,
      });
      if (originalResponse.ok) {
        results = parseSearchResults(await originalResponse.text());
        matched = selectSearchResult({ ...details, title: originalTitle, name: originalTitle }, mediaType, results);
      }
    }

    if (!matched) {
      console.log(`[Goojara] No reliable match for ${title} among ${results.length} search results`);
      return [];
    }
    console.log(`[Goojara] Selected ${matched.title} for TMDB ${mediaType} ${tmdbId}`);

    const matchPage = await requestText(matched.url, cookieJar);
    const $match = cheerio.load(matchPage.text);
    const showHref = $match('div.snfo h1 a').attr('href');
    const showUrl = (showHref && isSiteUrl(showHref, matched.url)) || isSiteUrl(matched.url);
    if (!showUrl) return [];

    const showPage = await requestText(showUrl.href, cookieJar);
    let targetUrl = showUrl.href;
    if (mediaType === 'tv') {
      const $show = cheerio.load(showPage.text);
      const seasonHref = $show('#sesh a.ste').first().attr('href');
      const seasonUrl = seasonHref && isSiteUrl(seasonHref, showUrl.href);
      if (!seasonUrl) {
        console.log(`[Goojara] No season list found for ${matched.title}`);
        return [];
      }
      const totalSeasons = Number(seasonUrl.searchParams.get('s')) || 0;
      if (totalSeasons && seasonNumber > totalSeasons) return [];
      seasonUrl.searchParams.set('s', String(seasonNumber));
      const seasonPage = await requestText(seasonUrl.href, cookieJar);
      targetUrl = parseEpisodeUrl(seasonPage.text, episodeNumber, seasonUrl.href);
      if (!targetUrl) {
        console.log(`[Goojara] Episode S${seasonNumber}E${episodeNumber} not found for ${matched.title}`);
        return [];
      }
    }

    const playerPage = await requestText(targetUrl, cookieJar, { headers: { Referer: showUrl.href } });
    addChallengeCookie(playerPage.text, cookieJar);
    const serverLinks = parseServerLinks(playerPage.text, targetUrl);
    if (!serverLinks.length) {
      console.log(`[Goojara] No player servers found for ${matched.title}`);
      return [];
    }
    console.log(`[Goojara] Resolving ${serverLinks.length} server link(s) for ${matched.title}`);
    const streams = await mapLimit(serverLinks, MAX_REDIRECTS_IN_PARALLEL,
      (server, index) => resolveServer(server, index, cookieJar, matched.title));
    return streams.flat().filter(Boolean);
  } catch (error) {
    console.error('[Goojara] Stream lookup failed:', error.message);
    return [];
  }
}

module.exports = {
  getStreams,
  parseSearchResults,
  selectSearchResult,
  parseEpisodeUrl,
  parseServerLinks,
  extractQuality,
  extractPlaybackHeaders,
  isEmbedLikeStreamUrl,
  resolveServer,
};
