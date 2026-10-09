const util = require('util');

const MAX_ENTRIES = 10_000;
const MAX_BYTES = 8 * 1024 * 1024;
const capturedTargets = new WeakSet();

function createLogBuffer({ maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES } = {}) {
    const entries = [];
    let nextId = 1;
    let currentBytes = 0;
    let droppedEntries = 0;

    function append(level, message) {
        const entry = {
            id: nextId++,
            timestamp: new Date().toISOString(),
            level,
            message: String(message)
        };
        const size = Buffer.byteLength(entry.message, 'utf8') + 64;
        entries.push(entry);
        currentBytes += size;

        while (entries.length > 1 && (entries.length > maxEntries || currentBytes > maxBytes)) {
            const removed = entries.shift();
            currentBytes -= Buffer.byteLength(removed.message, 'utf8') + 64;
            droppedEntries += 1;
        }
        return entry;
    }

    function read(since = 0) {
        const parsed = Number(since);
        const cursor = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
        const oldestId = entries.length ? entries[0].id : nextId;
        const missedCount = Math.max(0, oldestId - cursor - 1);
        return {
            entries: entries.filter(entry => entry.id > cursor),
            cursor: nextId - 1,
            oldestId,
            totalEntries: nextId - 1,
            retainedEntries: entries.length,
            droppedEntries,
            missedCount,
            truncated: missedCount > 0
        };
    }

    return { append, read };
}

const consoleLogBuffer = createLogBuffer();

function formatConsoleEntry(method, args) {
    if (method === 'dir') {
        return util.inspect(args[0], { ...(args[1] || {}), colors: false });
    }
    if (method === 'trace') {
        return `${util.format(...args)}\n${new Error().stack || ''}`;
    }
    if (method === 'table') {
        return util.inspect(args[0], { colors: false, depth: 5 });
    }
    return util.format(...args);
}

function installConsoleLogCapture(target = console, buffer = consoleLogBuffer) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function') || capturedTargets.has(target)) {
        return false;
    }
    capturedTargets.add(target);

    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table']) {
        if (typeof target[method] !== 'function') continue;
        const original = target[method];
        target[method] = function (...args) {
            buffer.append(method, formatConsoleEntry(method, args));
            return original.apply(this, args);
        };
    }

    return true;
}

function getConsoleLogs(since = 0) {
    return consoleLogBuffer.read(since);
}

module.exports = { createLogBuffer, installConsoleLogCapture, getConsoleLogs };
