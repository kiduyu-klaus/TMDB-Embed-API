const { spawn } = require('node:child_process');
const path = require('node:path');
const RESTART_EXIT_CODE = 75;

function launch(entry = path.join(__dirname, 'apiServer.js')) {
  let child;
  let stopping = false;
  let killTimer;
  function start() {
    child = spawn(process.execPath, [entry], {
      stdio: 'inherit', windowsHide: true,
      env: { ...process.env, KIDUYU_LAUNCHER: '1' },
    });
    child.once('error', error => {
      console.error('[launcher] failed to start server:', error.code);
      process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
      clearTimeout(killTimer);
      child = null;
      if (!stopping && code === RESTART_EXIT_CODE) {
        console.log('[launcher] previous server exited; starting replacement');
        start();
      } else {
        process.exitCode = stopping ? 0 : (code ?? (signal ? 1 : 0));
      }
    });
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    if (!child) return;
    child.kill('SIGTERM');
    killTimer = setTimeout(() => child?.kill('SIGKILL'), 6000);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  start();
}
if (require.main === module) launch();
module.exports = { launch, RESTART_EXIT_CODE };
