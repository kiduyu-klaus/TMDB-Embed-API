'use strict';

const { parentPort, workerData } = require('worker_threads');

(async () => {
  try {
    const encryptedValue = String(workerData.encryptedValue || '');
    if (!encryptedValue || encryptedValue.length > 256_000 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encryptedValue)) {
      throw new Error('Invalid encrypted payload');
    }
    const encoded = encryptedValue.replace(/-/g, '+').replace(/_/g, '/');
    const encrypted = Buffer.from(encoded, 'base64');
    if (!encrypted.length || encrypted.length > 256_000) throw new Error('Invalid encrypted payload size');

    const wasmBytes = Uint8Array.from(workerData.wasmBytes || []);
    if (!wasmBytes.length || wasmBytes.length > 1_000_000) throw new Error('Invalid decoder size');
    const module = await WebAssembly.compile(wasmBytes);
    if (WebAssembly.Module.imports(module).length) throw new Error('Decoder imports are not allowed');
    const instance = await WebAssembly.instantiate(module, {});
    const { memory, alloc, decrypt } = instance.exports;
    if (!(memory instanceof WebAssembly.Memory) || typeof alloc !== 'function' || typeof decrypt !== 'function') {
      throw new Error('Decoder exports are invalid');
    }

    const inputPointer = alloc(encrypted.length);
    if (!Number.isInteger(inputPointer) || inputPointer < 0 || inputPointer + encrypted.length > memory.buffer.byteLength) {
      throw new Error('Decoder input range is invalid');
    }
    new Uint8Array(memory.buffer, inputPointer, encrypted.length).set(encrypted);
    const outputLength = decrypt(inputPointer, encrypted.length);
    const outputPointer = inputPointer + 12;
    if (!Number.isInteger(outputLength) || outputLength < 0 || outputLength > 256_000
        || outputPointer + outputLength > memory.buffer.byteLength) {
      throw new Error('Decoder output range is invalid');
    }
    const value = new TextDecoder().decode(new Uint8Array(memory.buffer, outputPointer, outputLength));
    parentPort.postMessage({ ok: true, value });
  } catch {
    parentPort.postMessage({ ok: false });
  }
})();
