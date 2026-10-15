const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

test('successful login does not schedule a process restart', () => {
  const source = fs.readFileSync(path.join(__dirname, '../apiServer.js'), 'utf8');
  const route = source.slice(source.indexOf("router.post('/auth/login'"), source.indexOf("router.post('/auth/logout'"));
  let handler;
  let restarts = 0;
  let valid = true;
  vm.runInNewContext(route, {
    router: { post: (_url, fn) => { handler = fn; } },
    getClientIp: () => 'test', canAttempt: () => ({ allowed: true }),
    authenticate: () => valid, recordLoginSuccess() {}, issueSession: () => 'test-session',
    scheduleRestart: () => { restarts++; }, instanceId: 'old-process',
    recordLoginFailure: () => ({ count: 1 }), MAX_ATTEMPTS_WINDOW: 5,
  });
  function response() {
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.status = code => { res.code = code; return res; };
    res.json = body => { res.body = body; return res; };
    return res;
  }
  const success = response();
  handler({ body: { username: 'test', password: 'test' } }, success);
  assert.equal(success.body.success, true);
  assert.equal(success.body.username, 'test');
  assert.equal(success.body.restarting, undefined);
  assert.equal(restarts, 0);
  success.emit('finish');
  assert.equal(restarts, 0);
  valid = false;
  const failure = response();
  handler({ body: { username: 'test', password: 'wrong' } }, failure);
  failure.emit('finish');
  assert.equal(failure.code, 401);
  assert.equal(restarts, 0);
});

test('session remains valid after reloading auth with the persisted secret', () => {
  const source = fs.readFileSync(path.join(__dirname, '../utils/auth.js'), 'utf8');
  let saved;
  const storage = {
    writeFileSync(_file, value, options) {
      assert.equal(options.mode, 0o600);
      if (saved) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      saved = value;
    },
    readFileSync: () => saved,
  };
  function load() {
    const context = {
      module: { exports: {} }, __dirname: '/test', Buffer, console,
      process: { env: {}, cwd: () => '/test' },
      require: name => name === 'fs' ? storage : require(name),
    };
    vm.runInNewContext(source, context);
    return context.module.exports;
  }
  const token = load().issueSession('tester');
  assert.equal(load().getSession({ headers: { cookie: 'session=' + token } }).u, 'tester');
});
