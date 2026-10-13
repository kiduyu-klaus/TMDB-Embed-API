// Only this module is bundled. Node/native providers stay on the backend.
function failure(status, error, message) {
  return Response.json({ success: false, error, message }, {
    status, headers: { 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const mount = '/' + (env.MOUNT_PATH || 'kiduyuTv_providers').replace(/^\/+|\/+$/g, '');
    let backend;
    try {
      backend = new URL(env.BACKEND_URL);
      if (backend.protocol !== 'https:' || backend.username || backend.password ||
          backend.search || backend.hash || backend.host === incoming.host ||
          backend.pathname.replace(/\/+$/, '') !== mount) throw new Error('Invalid backend');
    } catch {
      return failure(503, 'BACKEND_NOT_CONFIGURED',
        'Set BACKEND_URL to the public HTTPS Node.js backend URL, including the matching mount path.');
    }
    if (incoming.pathname === '/' || incoming.pathname === mount) {
      return Response.redirect(new URL(mount + '/', incoming.origin), 307);
    }
    if (incoming.pathname !== '/favicon.ico' && !incoming.pathname.startsWith(mount + '/')) {
      return failure(404, 'NOT_FOUND', 'Unknown application path.');
    }
    const target = new URL(backend.origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('forwarded');
    headers.set('X-Forwarded-Host', incoming.host);
    headers.set('X-Forwarded-Proto', incoming.protocol.slice(0, -1));
    headers.delete('X-Forwarded-For');
    if (request.headers.get('CF-Connecting-IP')) {
      headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP'));
    }
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual'
      });
      const responseHeaders = new Headers(upstream.headers);
      const location = responseHeaders.get('location');
      if (location) {
        const redirect = new URL(location, target);
        if (redirect.origin === backend.origin) {
          redirect.protocol = incoming.protocol;
          redirect.host = incoming.host;
          responseHeaders.set('location', redirect.href);
        }
      }
      // Host-only cookies belong to the Worker hostname. Preserve separate cookies.
      responseHeaders.delete('set-cookie');
      for (const cookie of upstream.headers.getSetCookie()) {
        responseHeaders.append('set-cookie', cookie.replace(/;\s*Domain=[^;]*/gi, ''));
      }
      responseHeaders.set('Cache-Control', 'no-store');
      if (upstream.status >= 500) {
        console.error('backend.response.error', { status: upstream.status });
      }
      return new Response(upstream.body, {
        status: upstream.status, statusText: upstream.statusText, headers: responseHeaders
      });
    } catch {
      // Never log URLs, request headers or bodies: they may contain stream tokens.
      console.error('backend.request.failed');
      return failure(502, 'BACKEND_UNREACHABLE', 'The Node.js backend could not be reached.');
    }
  }
};
