# Cloudflare deployment

This Worker forwards the site and API to the existing Node.js server. All providers,
authentication, configuration, logs and restarts continue to run there. Keep that
server online; deployment does not move native curl or browser providers into Workers.
Upstream hosting limits and provider failures still apply.

In Cloudflare Workers Builds, use:

| Setting | Value |
| --- | --- |
| Project name | `kiduyutv-providers` |
| Advanced settings → Root directory | `cloudflare` |
| Build command | leave empty |
| Deploy command | `npm run deploy` |
| Preview command | `npm run preview` |

The separate package installs only Wrangler, avoiding native provider installation
on the build machine. Do not configure a static assets directory: the backend must
authenticate access to config.html.

`BACKEND_URL` is configured in `wrangler.toml` as
`https://secondbanklabs.com/kiduyuTv_providers`. Redeploy to apply it.
If an existing Worker secret is also named `BACKEND_URL`, remove that secret before
deploying so it does not conflict with the configured variable.
Use the backend's real publicly reachable HTTPS hostname, not localhost or the
Worker's own hostname. The backend and Worker must use the same mount path.
An absent or invalid backend setting returns a clear 503 configuration error.

Open `https://<worker-host>/kiduyuTv_providers/`. Existing login and stream tokens
remain managed by the backend. Validate `/kiduyuTv_providers/api/health`, sign-in,
and an authenticated stream endpoint after deployment.

Local checks from this folder: `npm ci`, `npm test`, `npm run check`.
For a local Worker, put `BACKEND_URL="https://backend.example.com/kiduyuTv_providers"`
in a root `.dev.vars` file and run `npx wrangler dev --config ../wrangler.toml`.
