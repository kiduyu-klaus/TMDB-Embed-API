# cPanel resource limits

Each Node.js instance admits at most four concurrent provider calls. Up to 64
calls can wait, for at most 30 seconds; overflow and expired calls are logged
and return no streams through the existing registry error handling. Slots stay
occupied until work actually finishes, including subtitle enrichment.

Shutdown rejects queued provider work. No remaining provider creates decoder worker threads.

The current provider code does not spawn child processes. No process watcher or
browser launcher is installed by the app. Limits are per Node process, not per
cPanel account; Passenger controls how many Node instances run. Ask the host to
limit Passenger instances for this app if the account remains constrained.
Node itself uses runtime threads, and individual providers can still make
multiple concurrent HTTP requests within one provider call.

Use cPanel's application manager to run the app; do not start duplicate
`npm start` instances in additional terminals. Existing orphan processes from
older deployments are not reclaimed by these limits.

`npm start` uses one launcher plus one server process. It never overlaps server
children during restart. cPanel should start `apiServer.js` directly through
Passenger, avoiding the additional launcher. The launcher handles stop signals
and does not automatically respawn on crashes.
