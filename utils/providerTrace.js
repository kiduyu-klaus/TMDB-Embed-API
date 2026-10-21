const { AsyncLocalStorage } = require('node:async_hooks');
const { createDiagnosticLogger } = require('./providerDiagnostics');

function createProviderTrace(name, options = {}) {
    const context = new AsyncLocalStorage();
    // Providers default to redacted output. Passing { redact: false } opts into
    // complete, unredacted URLs; PROVIDER_LOG_REDACT=1 forces redaction back on.
    const redact = process.env.PROVIDER_LOG_REDACT === '1' ? true : options.redact !== false;
    const log = (event, fields = {}) => context.getStore()?.log(event, fields);
    async function run(fn, args) {
        const state = { log: createDiagnosticLogger(name, { redact }), requests: 0 };
        return context.run(state, async () => {
            const started = Date.now();
            log('extract.start', { tmdbId: args[0], mediaType: args[1], season: args[2], episode: args[3] });
            try {
                const result = await fn();
                log('extract.complete', { streams: result?.length || 0, requests: state.requests, elapsedMs: Date.now() - started });
                return result;
            } catch (error) {
                log('extract.failed', { errorType: error.name, code: error.code, elapsedMs: Date.now() - started });
                throw error;
            } finally {
                log('extract.end', { elapsedMs: Date.now() - started });
            }
        });
    }
    async function fetch(url, options = {}) {
        const requestId = context.getStore() ? ++context.getStore().requests : 0;
        const started = Date.now();
        log('request.start', { requestId, url: String(url), method: options.method || 'GET' });
        try {
            const response = await require('./providerFetch').fetch(url, options);
            log('request.response', { requestId, url: response.url || String(url), status: response.status, ok: response.ok,
                elapsedMs: Date.now() - started, contentType: response.headers?.get('content-type') });
            return new Proxy(response, {
                get(target, key) {
                    if (key === 'text' || key === 'json') return async () => {
                        try {
                            const data = await target[key]();
                            log('response.parsed', { requestId, parser: key, characters: typeof data === 'string' ? data.length : undefined,
                                elapsedMs: Date.now() - started });
                            return data;
                        } catch (error) {
                            // JSON parse errors may contain response data; do not log that message.
                            log('response.parse.failed', { requestId, parser: key, errorType: error.name, elapsedMs: Date.now() - started });
                            throw error;
                        }
                    };
                    const value = Reflect.get(target, key, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
        } catch (error) {
            log('request.failed', { requestId, url: String(url), errorType: error.name, code: error.code, elapsedMs: Date.now() - started });
            throw error;
        }
    }
    return { log, run, fetch };
}

module.exports = { createProviderTrace };
