const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogBuffer, installConsoleLogCapture } = require('../utils/consoleLogs');

test('captures console levels and formats parameters while preserving the original console call', () => {
  const buffer = createLogBuffer();
  const written = [];
  const fakeConsole = {
    log(...args) { written.push(['log', ...args]); },
    warn(...args) { written.push(['warn', ...args]); }
  };

  assert.equal(installConsoleLogCapture(fakeConsole, buffer), true);
  fakeConsole.log('connected to %s', 'service');
  fakeConsole.warn('retry %d', 2);

  const result = buffer.read();
  assert.equal(written.length, 2);
  assert.equal(result.entries[0].level, 'log');
  assert.equal(result.entries[0].message, 'connected to service');
  assert.equal(result.entries[1].level, 'warn');
  assert.equal(result.entries[1].message, 'retry 2');
  assert.equal(result.cursor, 2);
});

test('uses incremental cursors and reports entries dropped from the retention buffer', () => {
  const buffer = createLogBuffer({ maxEntries: 2, maxBytes: 10_000 });
  buffer.append('info', 'first');
  buffer.append('error', 'second');
  buffer.append('debug', 'third');

  const initial = buffer.read();
  assert.deepEqual(initial.entries.map(entry => entry.id), [2, 3]);
  assert.equal(initial.droppedEntries, 1);
  assert.equal(initial.missedCount, 1);
  assert.equal(initial.truncated, true);

  const next = buffer.read(2);
  assert.deepEqual(next.entries.map(entry => entry.id), [3]);
  assert.equal(next.missedCount, 0);
  assert.equal(next.truncated, false);
});
