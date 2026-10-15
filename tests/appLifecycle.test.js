const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const { createResources, createShutdownManager } = require('../utils/appLifecycle');
const logger = { log() {}, warn() {} };

test('restart closes sockets and ends real workers and child processes before exit', async t => {
  const resources = createResources();
  const worker = resources.trackWorker(new Worker('setInterval(() => {}, 1000)', { eval: true }));
  const child = resources.trackChild(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
  const server = http.createServer(() => {});
  const events = [];
  const manager = createShutdownManager(server, {
    resources, logger, drainMs: 10,
    beforeExit: () => events.push('marker'),
    exit: () => {
      assert.equal(worker.threadId, -1);
      assert.ok(child.exitCode !== null || child.signalCode);
      assert.equal(resources.signal.aborted, true);
      assert.equal(server.listening, false);
      events.push('exit');
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const socket = net.connect(server.address().port, '127.0.0.1');
  socket.on('error', () => {});
  await once(socket, 'connect');
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
  t.after(() => { socket.destroy(); server.close(); worker.terminate(); if (child.exitCode === null) child.kill('SIGKILL'); });
  const first = manager.shutdown('restart');
  assert.equal(manager.shutdown('restart'), first);
  await first;
  assert.deepEqual(events, ['marker', 'exit']);
});

test('hung cleanup is bounded and notifies the supervisor only once', async () => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const calls = [];
  const manager = createShutdownManager(server, {
    resources: { shutdown: () => new Promise(() => {}) }, logger,
    timeoutMs: 25, drainMs: 5,
    beforeExit: () => calls.push('marker'), exit: () => calls.push('exit'),
  });
  await manager.shutdown('restart');
  await manager.shutdown('restart');
  assert.deepEqual(calls, ['marker', 'exit']);
});
