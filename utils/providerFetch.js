const REQUEST_TIMEOUT_MS = 30_000;
const { resources } = require('./appLifecycle');

// Keep the deadline active through body consumption, and preserve caller cancellation.
function fetch(url, options = {}) {
  const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = AbortSignal.any([resources.signal, deadline, ...(options.signal ? [options.signal] : [])]);
  const transport = globalThis.fetch || require('node-fetch');
  return transport(url, { ...options, signal });
}

module.exports = { fetch, REQUEST_TIMEOUT_MS };
