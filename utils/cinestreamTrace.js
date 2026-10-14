const { AsyncLocalStorage } = require('node:async_hooks');

function createCineStreamTrace({ logger = console, transport = (...args) => globalThis.fetch(...args) } = {}) {
  const scope = new AsyncLocalStorage();
  let sequence = 0;
  function log(event, details = {}, failed = false) {
    const context = scope.getStore();
    logger[failed ? 'warn' : 'log']('[CineStream] ' + event + ' ' + JSON.stringify({
      extractionId: context?.root.id || null, source: context?.source || 'catalog', ...details,
    }));
  }
  async function run(fn) {
    if (scope.getStore()) return fn();
    const root = { id: ++sequence, requests: 0 };
    const started = Date.now();
    return scope.run({ root, source: 'catalog' }, async () => {
      log('trace.start');
      try { return await fn(); }
      finally { log('trace.end', { requests: root.requests, elapsedMs: Date.now() - started }); }
    });
  }
  function source(name, fn) {
    return run(() => scope.run({ ...scope.getStore(), source: name }, async () => {
      const started = Date.now();
      log('source.start');
      try {
        const result = await fn();
        log('source.complete', { count: Array.isArray(result) ? result.length : null, elapsedMs: Date.now() - started });
        if (Array.isArray(result) && !result.length) log('source.empty');
        return result;
      } catch (error) {
        log('source.failed', { reason: error?.name === 'SyntaxError' ? 'INVALID_JSON' : 'UPSTREAM_OR_PARSE_ERROR', elapsedMs: Date.now() - started }, true);
        throw error;
      }
    }));
  }
  async function fetch(url, options = {}) {
    const context = scope.getStore();
    const requestId = context ? ++context.root.requests : null;
    const origin = new URL(url).origin;
    const started = Date.now();
    log('request.start', { requestId, origin, method: options.method || 'GET' });
    try {
      const response = await transport(url, options);
      log('request.response', { requestId, origin, status: response.status,
        server: response.headers.get('server'), cfRay: response.headers.get('cf-ray'),
        cfMitigated: response.headers.get('cf-mitigated'), contentType: response.headers.get('content-type'),
        elapsedMs: Date.now() - started }, !response.ok);
      return new Proxy(response, {
        get(target, property) {
          if (property === 'text' || property === 'json') return async () => {
            try {
              const value = await target[property]();
              log('response.parsed', { requestId, parser: property, characters: typeof value === 'string' ? value.length : undefined, elapsedMs: Date.now() - started });
              return value;
            } catch (error) {
              log('response.parse_failed', { requestId, parser: property }, true);
              throw error;
            }
          };
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    } catch (error) {
      log('request.failed', { requestId, origin, reason: /timeout|abort/i.test(error?.name || '') ? 'TIMEOUT_OR_ABORT' : 'NETWORK_ERROR', elapsedMs: Date.now() - started }, true);
      throw error;
    }
  }
  return { run, source, log, fetch };
}
module.exports = { createCineStreamTrace };
