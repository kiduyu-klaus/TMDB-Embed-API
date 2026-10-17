const { test } = require('node:test');
const assert = require('node:assert/strict');
const { restartMode } = require('../utils/restartMode');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('restart selects the owning supervisor before process replacement', () => {
  const proc = { env: {}, platform: 'linux', execve() {} };
  assert.equal(restartMode(proc, null), 'execve');
  assert.equal(restartMode(proc, {}), 'passenger');
  proc.env.KIDUYU_LAUNCHER = '1';
  assert.equal(restartMode(proc, {}), 'launcher');
  assert.equal(restartMode({ env: {}, platform: 'win32' }, null), 'unavailable');
  assert.equal(restartMode({ env: { APP_RESTART_MODE: 'supervisor' } }, null), 'supervisor');
});

test('launcher restarts only after old child exits and stops after a normal exit', { timeout: 10000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiduyu-launcher-test-'));
  const fixture = path.join(dir, 'child.js');
  const state = path.join(dir, 'state.json');
  fs.writeFileSync(fixture, `
    const fs=require('fs'), path=require('path');
    const file=path.join(__dirname,'state.json');
    const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
    if(previous){
      let alive=false;try{process.kill(previous.pid,0);alive=true;}catch{}
      fs.writeFileSync(file,JSON.stringify({runs:previous.runs+1,overlap:alive}));
      process.exit(0);
    }
    fs.writeFileSync(file,JSON.stringify({runs:1,pid:process.pid}));
    process.exit(75);
  `);
  const launcher = path.resolve(__dirname, '../serverLauncher.js');
  const child = spawn(process.execPath, ['-e', 'require(process.argv[1]).launch(process.argv[2])', launcher, fixture], { stdio: 'ignore' });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
    for (const file of [fixture, state]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(state)), { runs: 2, overlap: false });
});
