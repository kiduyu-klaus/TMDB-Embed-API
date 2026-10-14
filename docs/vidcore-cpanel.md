# Vidcore on cPanel

Deploy `providers/vidcore.js`, `utils/vidcoreSession.js`, and `utils/browser.js` together.
The legacy `tests/browser.js` now forwards to the production utility for existing scripts.
Vidcore navigates with Chromium, reads the document HTML (or rendered HTML when needed),
then makes API requests in the same isolated browser context, preserving its cookies.
Each extraction closes its context; the shared browser closes after 30 seconds idle.

In cPanel **Setup Node.js App → Edit → Environment variables**, persist:

```text
PLAYWRIGHT_BROWSERS_PATH=/home1/sflatran/pw-browsers
PW_CHROME_PATH=/home1/sflatran/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
```

The executable above matches the user's installed revision. Update it when reinstalling
Chromium. A shell `export` alone does not configure the Passenger application.
Restart the Node.js app after saving the environment variables and deploying files.

Activate the application's Node environment in cPanel Terminal before running checks.
Check the binary separately (these are separate commands):

```sh
BIN=/home1/sflatran/pw-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell
"$BIN" --version
ldd "$BIN" | grep 'not found'
```

No grep output means no missing libraries were reported; it does not prove browser launch.
The unsupported-OS warning means the downloaded Ubuntu build may still need system
libraries or a newer glibc. Your hosting administrator must supply those dependencies.

Actual launch check, from the project root:

```sh
node -e 'const b=require("./utils/browser");(async()=>{try{const browser=await b.acquireBrowser();console.log("Chromium launched:",browser.version());b.releaseBrowser();}finally{await b.closeSharedBrowser();}})().catch(e=>{console.error(e.message);process.exitCode=1})'
```

Request diagnostics include the stage, origin, status, server, cf-ray, cf-mitigated
and content-type; signed paths, query strings, cookies and response bodies are omitted.
Browser launch errors are categorized as CHROMIUM_NOT_INSTALLED,
CHROMIUM_SYSTEM_DEPENDENCIES, HOST_RESOURCE_LIMIT or BROWSER_REQUEST_FAILED.
Cross-origin browser requests may hide response headers; missing values are logged as null.

Chromium still needs free processes and memory. Creating additional Node applications
does not increase the cPanel account's resource allocation. A browser does not guarantee
access when the upstream rejects the server IP; a remaining HTTP 403 stays a failure.
