// HTTP helpers using Cloudflare DoH, verified TLS and the original Host/SNI.
import https from 'node:https';
import http from 'node:http';
import { isIP } from 'node:net';
import { resolveDoh } from './dns-resolver.mjs';

const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
let requestSequence = 0;

function requestStream(parsed, address, init) {
  const started = Date.now();
  console.log(`[DNS HTTP #${init.logId}] ${init.method} ${parsed.origin} via ${address.address} IPv${address.family}`);
  return new Promise((resolve, reject) => {
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    const headers = new Headers(init.headers);
    headers.set('host', parsed.host);
    if (!headers.has('accept')) headers.set('accept', '*/*');
    if (!headers.has('accept-encoding')) headers.set('accept-encoding', 'identity');
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: init.method,
      headers: Object.fromEntries(headers),
      // Keep the hostname for certificate verification; connect via DoH IP.
      lookup: (_host, options, callback) => options?.all
        ? callback(null, [address])
        : callback(null, address.address, address.family),
      servername: isIP(hostname) ? '' : hostname,
      rejectUnauthorized: true,
      signal: init.signal,
    }, res => {
      console.log(`[DNS HTTP #${init.logId}] HTTP ${res.statusCode}; headers received in ${Date.now() - started}ms`);
      res.on('error', error => console.warn(`[DNS HTTP #${init.logId}] Response stream failed: ${error.code || error.name}`));
      resolve({ statusCode: res.statusCode, headers: res.headers, stream: res });
    });
    req.setTimeout(30000, () => {
      console.warn(`[DNS HTTP #${init.logId}] Request idle timeout after 30000ms`);
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', error => {
      console.warn(`[DNS HTTP #${init.logId}] Request failed: ${error.code || error.name}; ${Date.now() - started}ms`);
      reject(error);
    });
    req.end(init.body);
  });
}

async function requestWithRetry(parsed, init) {
  let lastError;
  for (const refresh of [false, true]) {
    if (refresh) console.log(`[DNS HTTP #${init.logId}] Retrying with refreshed DNS for ${parsed.hostname}`);
    const addresses = await resolveDoh(parsed.hostname, { signal: init.signal, refresh });
    for (const address of addresses) {
      init.signal?.throwIfAborted();
      try { return await requestStream(parsed, address, init); }
      catch (err) {
        init.signal?.throwIfAborted();
        lastError = err;
        console.warn(`[DNS HTTP #${init.logId}] Address ${address.address} failed; trying remaining candidates`);
      }
    }
  }
  throw lastError;
}

/** Returns { statusCode, headers, stream, url }; stream is a Node Readable.
 * Supports replayable bodies: UTF-8 strings, URLSearchParams, ArrayBuffer,
 * Buffer and typed arrays. AbortSignal stays active during stream consumption.
 */
export async function dnsFetchStream(url, init = {}) {
  let current = new URL(url);
  const options = { ...init, logId: ++requestSequence, method: (init.method || 'GET').toUpperCase(), headers: new Headers(init.headers) };
  if (typeof options.body === 'string') options.body = Buffer.from(options.body, 'utf8');
  else if (options.body instanceof URLSearchParams) {
    if (!options.headers.has('content-type')) options.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
    options.body = Buffer.from(options.body.toString());
  } else if (options.body instanceof ArrayBuffer) options.body = Buffer.from(options.body);
  else if (ArrayBuffer.isView(options.body)) options.body = Buffer.from(options.body.buffer, options.body.byteOffset, options.body.byteLength);
  else if (options.body != null) throw new TypeError('Unsupported request body');
  if (['GET', 'HEAD'].includes(options.method) && options.body != null) throw new TypeError('GET/HEAD cannot have a body');

  for (let count = 0; ; count++) {
    options.signal?.throwIfAborted();
    if (!['http:', 'https:'].includes(current.protocol)) throw new TypeError('Only HTTP(S) URLs are supported');
    if (current.username || current.password) throw new TypeError('URL credentials are not supported');
    const result = await requestWithRetry(current, options);
    const location = result.headers.location;
    if (!REDIRECTS.has(result.statusCode) || !location || options.redirect === 'manual') {
      return { ...result, url: current.toString() };
    }
    result.stream.destroy();
    if (options.redirect === 'error') throw new Error('Redirect disallowed');
    if (count >= MAX_REDIRECTS) throw new Error(`Too many redirects for ${url}`);
    const next = new URL(location, current);
    console.log(`[DNS HTTP #${options.logId}] Redirect ${count + 1}/${MAX_REDIRECTS}: HTTP ${result.statusCode}, ${current.origin} -> ${next.origin}`);
    if (next.origin !== current.origin) {
      for (const header of ['authorization', 'proxy-authorization', 'cookie', 'cookie2']) options.headers.delete(header);
    }
    if ((result.statusCode === 303 && options.method !== 'HEAD') ||
        ([301, 302].includes(result.statusCode) && options.method === 'POST')) {
      options.method = 'GET';
      options.body = undefined;
      for (const header of ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location', 'transfer-encoding']) options.headers.delete(header);
    }
    current = next;
  }
}

/** Buffered variant. Use dnsFetchStream for large responses. */
export async function dnsFetch(url, init = {}) {
  const started = Date.now();
  const result = await dnsFetchStream(url, init);
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(chunk);
  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    if (key === 'transfer-encoding') continue;
    if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  headers.set('x-final-url', result.url);
  const noBody = init.method?.toUpperCase() === 'HEAD' || [204, 205, 304].includes(result.statusCode);
  console.log(`[DNS HTTP] Buffered ${chunks.reduce((total, chunk) => total + chunk.length, 0)} bytes from ${new URL(result.url).origin}; ${Date.now() - started}ms`);
  return new Response(noBody ? null : Buffer.concat(chunks), { status: result.statusCode, headers });
}
