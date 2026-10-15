function createResources() {
  const controller = new AbortController();
  const workers = new Set();
  const children = new Set();
  let shutdownPromise;
  function trackWorker(worker) {
    workers.add(worker);
    worker.once('exit', () => workers.delete(worker));
    if (controller.signal.aborted) worker.terminate().catch(() => {});
    return worker;
  }
  function trackChild(child) {
    children.add(child);
    child.once('exit', () => children.delete(child));
    if (controller.signal.aborted) child.kill('SIGKILL');
    return child;
  }
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    controller.abort(new Error('Server shutting down'));
    shutdownPromise = Promise.allSettled([
      ...Array.from(workers, worker => worker.terminate()),
      ...Array.from(children, child => new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      })),
    ]);
    return shutdownPromise;
  }
  return { signal: controller.signal, trackWorker, trackChild, shutdown };
}

function createShutdownManager(server, {
  resources, beforeExit = () => {}, exit = code => process.exit(code),
  logger = console, timeoutMs = 5000, drainMs = 250,
} = {}) {
  const sockets = new Set();
  let pending;
  let stopping = false;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (stopping) socket.destroy();
  });
  function shutdown(reason = 'shutdown') {
    if (pending) return pending;
    stopping = true;
    pending = (async () => {
      logger.log('[control] shutdown.start', { reason, connections: sockets.size });
      let finished = false;
      function finish(forced) {
        if (finished) return;
        finished = true;
        for (const socket of sockets) socket.destroy();
        try { beforeExit(reason); }
        catch (error) { logger.warn('[control] restart notification failed:', error.message); }
        logger.log('[control] shutdown.complete', { reason, forced });
        exit(0, reason);
      }
      // Keep this timer referenced: hung requests or cleanup must not block exit.
      let deadline;
      const expired = new Promise(resolve => {
        deadline = setTimeout(() => { finish(true); resolve(); }, timeoutMs);
      });
      const drain = setTimeout(() => {
        server.closeAllConnections?.();
        for (const socket of sockets) socket.destroy();
      }, drainMs);
      const closed = new Promise(resolve => server.close(resolve));
      server.closeIdleConnections?.();
      try {
        await Promise.race([Promise.allSettled([closed, resources?.shutdown()]), expired]);
        finish(false);
      } finally {
        clearTimeout(deadline);
        clearTimeout(drain);
      }
    })();
    return pending;
  }
  return { shutdown, get stopping() { return stopping; } };
}

const resources = createResources();
module.exports = { resources, createResources, createShutdownManager };
