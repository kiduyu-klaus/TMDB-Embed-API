const { resources } = require('./appLifecycle');

function createGate({ limit, maxQueue, waitMs = 30000, signal }) {
  let active = 0;
  const queue = [];
  function permit() {
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      const next = queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(permit());
      }
    };
  }
  function acquire() {
    if (signal?.aborted) return Promise.reject(new Error('Server shutting down'));
    if (active < limit) return Promise.resolve(permit());
    if (queue.length >= maxQueue) return Promise.reject(new Error('Provider capacity reached; retry later'));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      entry.timer = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error('Provider queue wait timed out'));
      }, waitMs);
      queue.push(entry);
    });
  }
  signal?.addEventListener('abort', () => {
    for (const entry of queue.splice(0)) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Server shutting down'));
    }
  }, { once: true });
  return { acquire, stats: () => ({ active, queued: queue.length, limit, maxQueue }) };
}

// Shared across requests in this Node process; excess work is bounded, not spawned.
const providerGate = createGate({ limit: 4, maxQueue: 64, signal: resources.signal });
module.exports = { createGate, providerGate };
