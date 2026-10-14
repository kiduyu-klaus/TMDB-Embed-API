const fs = require('fs');
const path = require('path');
const { createDiagnosticLogger } = require('./providerDiagnostics');

function prepareWindowsLibrary(log) {
    if (process.platform !== 'win32') return;
    const libs = path.resolve(path.dirname(require.resolve('curl-cffi')), '../libs');
    if (!fs.existsSync(libs)) return;
    // curl-cffi 0.1.50 expects bin/, while current Windows release archives use lib/.
    for (const entry of fs.readdirSync(libs, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.includes('-win32_')) continue;
        const source = path.join(libs, entry.name, 'lib', 'libcurl-impersonate.dll');
        const destination = path.join(libs, entry.name, 'bin', 'libcurl-impersonate.dll');
        if (!fs.existsSync(destination) && fs.existsSync(source)) {
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(source, destination);
            log('native.library.layout.repaired', { release: entry.name });
        }
    }
}

// Adapter for provider code using Axios-shaped responses, backed by curl-impersonate.
function createCurlClient({ log = createDiagnosticLogger('CurlCffi') } = {}) {
    log('native.init.start', { platform: process.platform, arch: process.arch, node: process.version, profile: 'chrome136' });
    let CurlSession;
    try {
        prepareWindowsLibrary(log);
        ({ CurlSession } = require('curl-cffi'));
    } catch (error) {
        log('native.init.failed', { code: error.code, message: error.message });
        throw error;
    }
    class LimitedSession extends CurlSession {
        prepareOptions(options) {
            const prepared = super.prepareOptions(options);
            // Keep the already-encoded URL intact; the package re-encodes parsed parameters.
            prepared.url = options.url;
            prepared.params = undefined;
            return prepared;
        }
        async send(curl, options) {
            // Use the numeric native option; 0.1.50 forwards curlOptions keys as strings.
            curl.setOption(114, options.maxContentLength || 8 * 1024 * 1024);
            return super.send(curl, options);
        }
    }
    const session = new LimitedSession({ impersonate: 'chrome136', verify: true, timeout: 30000 });
    log('session.open', { profile: 'chrome136', verifyTLS: true });
    let requestSequence = 0;
    async function request(method, url, data, options = {}) {
        const requestId = ++requestSequence;
        const started = Date.now();
        log('request.start', { requestId, method, url, timeoutMs: options.timeout || 30000, responseType: options.responseType || 'auto', hasBody: data != null });
        try {
        const target = new URL(url);
        for (const [key, value] of Object.entries(options.params || {})) {
            if (value != null) target.searchParams.set(key, String(value));
        }
        const response = await session.request({
            method, url: target.href, data, headers: options.headers,
            timeout: options.timeout || 30000, allowRedirects: true,
            maxRedirects: options.maxRedirects ?? 5,
            maxContentLength: options.maxContentLength
        });
        const headers = Object.fromEntries(Object.entries(response.headers.toObject()).map(([key, value]) => [key.toLowerCase(), value]));
        const body = options.responseType === 'arraybuffer' ? response.dataRaw
            : options.responseType === 'text' ? response.text : response.data;
        const result = { status: response.status, headers, data: body };
        log('request.response', { requestId, method, url: response.url || target.href, status: result.status,
            elapsedMs: Date.now() - started, bytes: response.dataRaw?.length,
            contentType: headers['content-type'], redirects: response.redirects || 0,
            server: headers.server, cfRay: headers['cf-ray'],
            cfMitigated: headers['cf-mitigated'],
            challenge: headers['cf-mitigated'] === 'challenge' });
        const valid = options.validateStatus || (status => status >= 200 && status < 300);
        if (!valid(result.status)) {
            const error = new Error(`HTTP ${result.status} from ${new URL(url).hostname}`);
            error.response = result;
            error.config = { url };
            throw error;
        }
        return result;
        } catch (error) {
            log('request.failed', { requestId, method, url, elapsedMs: Date.now() - started,
                status: error.response?.status, code: error.code, message: error.message });
            throw error;
        }
    }
    return {
        get: (url, options) => request('GET', url, undefined, options),
        post: (url, data, options) => request('POST', url, data, options),
        close: () => { session.close(); log('session.close', { requests: requestSequence }); }
    };
}

module.exports = { createCurlClient };
