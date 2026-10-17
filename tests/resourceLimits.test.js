const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGate } = require('../utils/resourceLimits');

test('burst work never exceeds concurrency and queue limits', async () => {
  const gate = createGate({ limit: 2, maxQueue: 2 });
  const first = await gate.acquire();
  const second = await gate.acquire();
  const third = gate.acquire();
  const fourth = gate.acquire();
  await assert.rejects(gate.acquire(), /capacity/);
  assert.deepEqual(gate.stats(), { active: 2, queued: 2, limit: 2, maxQueue: 2 });
  first(); first(); // Releasing twice must not grant extra slots.
  const releaseThird = await third;
  assert.equal(gate.stats().active, 2);
  second();
  const releaseFourth = await fourth;
  releaseThird(); releaseFourth();
  assert.equal(gate.stats().active, 0);
});

test('expired queued work never starts later', async () => {
  const gate = createGate({ limit: 1, maxQueue: 1, waitMs: 10 });
  const release = await gate.acquire();
  await assert.rejects(gate.acquire(), /timed out/);
  assert.equal(gate.stats().queued, 0);
  release();
  assert.equal(gate.stats().active, 0);
});

test('shutdown rejects queued and future jobs', async () => {
  const controller = new AbortController();
  const gate = createGate({ limit: 1, maxQueue: 1, signal: controller.signal });
  const release = await gate.acquire();
  const waiting = gate.acquire();
  controller.abort();
  await assert.rejects(waiting, /shutting down/);
  await assert.rejects(gate.acquire(), /shutting down/);
  release();
  assert.equal(gate.stats().queued, 0);
});
