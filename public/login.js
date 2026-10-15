/* eslint-env browser */
(function(){
  const $ = sel => document.querySelector(sel);
  // Support hosting under a sub-path (e.g. /kiduyuTv_providers). The prefix is
  // whatever directory the page itself was served from, so this works whether
  // or not MOUNT_PATH is configured on the server.
  // Support hosting under a sub-path (e.g. /kiduyuTv_providers). Strip a
  // trailing slash and any page filename, but never strip a bare mount segment
  // (e.g. "/kiduyuTv_providers" with no trailing slash is a valid page URL).
  const BASE = window.location.pathname.replace(/\/+$/, '').replace(/\/[^/]*\.[^/]*$/, '');
  const U = p => BASE + p;
  let loginInProgress = false;
  async function checkSession(){
    try {
      const r = await fetch(U('/auth/session'));
      const j = await r.json();
      if (j.authenticated && !loginInProgress) {
        window.location.href = U('/config.html');
      }
    } catch(e) { /* ignore */ }
  }

  async function login(username, password){
    if (loginInProgress) return false;
    loginInProgress = true;
    $('#loginBtn').disabled = true;
    const status = $('#status');
    status.textContent = 'Authenticating...';
    status.className = 'status';
    try {
      const r = await fetch(U('/auth/login'), { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ username, password }) });
      const j = await r.json();
      if (!j.success) {
        if (j.error === 'LOCKED' || j.error === 'TOO_MANY_ATTEMPTS') {
          showLockout(j.retryAfter);
          status.textContent = 'Locked due to excessive attempts';
        } else if (j.error === 'INVALID_CREDENTIALS') {
          status.textContent = 'Invalid credentials';
          if (typeof j.remaining === 'number') {
            status.textContent += ` (${j.remaining} attempts left)`;
          }
        } else {
          status.textContent = j.error || 'Login failed';
        }
        status.classList.add('error');
        return false;
      }
      status.textContent = 'Success! Redirecting...';
      status.classList.add('success');
      setTimeout(()=>{ window.location.href = U('/config.html'); }, 400);
      return true;
    } catch (e) {
      status.textContent = 'Network error'+(e.message ? `: ${e.message}` : '');
      console.log('[login] network error', e);
      status.classList.add('error');
      return false;
    } finally {
      loginInProgress = false;
      $('#loginBtn').disabled = false;
    }
  }

  // Lockout handling
  let lockoutTimer = null;
  function showLockout(retryAfterSeconds){
    if (!retryAfterSeconds || retryAfterSeconds <= 0) return;
    const banner = $('#lockoutBanner');
    const countdownEl = $('#lockoutCountdown');
    banner.style.display = 'block';
    const end = Date.now() + (retryAfterSeconds * 1000);
    if (lockoutTimer) clearInterval(lockoutTimer);
    lockoutTimer = setInterval(()=>{
      const remain = end - Date.now();
      if (remain <= 0){
        clearInterval(lockoutTimer);
        banner.style.display = 'none';
        countdownEl.textContent = '00:00';
        return;
      }
      const sec = Math.ceil(remain/1000);
      const m = String(Math.floor(sec/60)).padStart(2,'0');
      const s = String(sec%60).padStart(2,'0');
      countdownEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Flash messaging based on query params
    const params = new URLSearchParams(location.search);
    const status = $('#status');
    if(params.has('loggedOut')) { status.textContent = 'Logged out successfully'; status.classList.add('success'); }
    else if(params.has('expired')) { status.textContent = 'Session expired. Please login again.'; status.classList.add('error'); }
    if(params.has('loggedOut') || params.has('expired')) {
      // Remove params from URL without reloading
      history.replaceState(null,'', location.pathname);
    }
    checkSession();
    $('#loginForm').addEventListener('submit', e => {
      e.preventDefault();
      const u = $('#username').value.trim();
      const p = $('#password').value;
      if (!u || !p) return;
      login(u,p);
    });
  });
})();
