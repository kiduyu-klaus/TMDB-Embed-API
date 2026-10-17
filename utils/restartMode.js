function restartMode(proc = process, passenger = global.PhusionPassenger) {
  if (proc.env.KIDUYU_LAUNCHER === '1') return 'launcher';
  if (passenger || proc.env.APP_RESTART_MODE === 'passenger' || proc.env.PASSENGER_APP_ENV) return 'passenger';
  if (proc.env.APP_RESTART_MODE === 'supervisor') return 'supervisor';
  if (proc.platform === 'linux' && typeof proc.execve === 'function') return 'execve';
  return 'unavailable';
}
module.exports = { restartMode };
