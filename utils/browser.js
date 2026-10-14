/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AnimePaheAPI — browser.js
 * Repository: https://github.com/Shineii86/AnimePaheAPI
 *
 * @description
 *   Playwright browser launcher with stealth capabilities.
 *   Automatically selects @sparticuz/chromium for serverless
 *   environments (Vercel/Netlify/AWS Lambda) and regular
 *   Playwright for local development.
 *
 * @exports
 *   launchBrowser
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

// Must be set BEFORE playwright is required.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(path.join(os.homedir(), "pw-browsers"))) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.homedir(), "pw-browsers");
}
const BROWSERS_DIR = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), "pw-browsers");
const IDLE_MS = Number(process.env.PW_IDLE_MS || 30000);

let chromiumLib = null;
function getChromiumLib() {
  if (!chromiumLib) {
    try {
      chromiumLib = require("playwright").chromium;
    } catch {
      chromiumLib = require("playwright-core").chromium;
    }
  }
  return chromiumLib;
}

function latestDir(prefix) {
  try {
    const rev = (d) => parseInt(d.split("-").pop(), 10) || 0;
    return (
      fs
        .readdirSync(BROWSERS_DIR)
        .filter((d) => d.startsWith(prefix + "-"))
        .sort((a, b) => rev(a) - rev(b))
        .pop() || null
    );
  } catch {
    return null;
  }
}

// Prefers the lighter headless shell, then full Chromium.
function findChromiumExecutable() {
  const override = process.env.PW_CHROME_PATH || process.env.CHROME_PATH;
  if (override && fs.existsSync(override)) return override;
  const candidates = [
    ["chromium_headless_shell", "chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chromium", "chrome-linux64", "chrome"],
  ];
  for (const [prefix, sub, bin] of candidates) {
    const dir = latestDir(prefix);
    if (!dir) continue;
    const exe = path.join(BROWSERS_DIR, dir, sub, bin);
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-zygote",
  "--renderer-process-limit=1",
  "--disable-blink-features=AutomationControlled",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-sync",
  "--mute-audio",
  "--no-first-run",
];

// Drop-in for the old launchBrowser(): returns a fresh Browser the caller must close.
async function launchBrowser(options = {}) {
  const executablePath = findChromiumExecutable();
  if (!executablePath) {
    console.warn(
      `[Browser] No Chromium found under ${BROWSERS_DIR}; relying on Playwright's default lookup`,
    );
  }
  const launchOptions = {
    headless: options.headless ?? true,
    args: [...BASE_ARGS, ...(options.args || [])],
    timeout: options.timeout || 60000,
  };
  if (executablePath) launchOptions.executablePath = executablePath;

  const proxy =
    options.proxy ||
    (process.env.PW_PROXY
      ? {
          server: process.env.PW_PROXY,
          ...(process.env.PW_PROXY_USER
            ? { username: process.env.PW_PROXY_USER, password: process.env.PW_PROXY_PASS || "" }
            : {}),
        }
      : undefined);
  if (proxy) launchOptions.proxy = proxy;

  return getChromiumLib().launch(launchOptions);
}

// ---- Shared browser (ref-counted, closes itself when idle) ----
let sharedPromise = null;
let sharedBrowser = null;
let refs = 0;
let idleTimer = null;

async function acquireBrowser() {
  clearTimeout(idleTimer);
  if (!sharedPromise) {
    sharedPromise = launchBrowser()
      .then((b) => {
        sharedBrowser = b;
        b.on("disconnected", () => {
          if (sharedBrowser === b) {
            sharedBrowser = null;
            sharedPromise = null;
            refs = 0;
          }
        });
        return b;
      })
      .catch((err) => {
        sharedPromise = null;
        throw err;
      });
  }
  const browser = await sharedPromise;
  refs += 1;
  return browser;
}

async function closeSharedBrowser() {
  clearTimeout(idleTimer);
  const p = sharedPromise;
  sharedPromise = null;
  sharedBrowser = null;
  refs = 0;
  if (p) {
    try {
      await (await p).close();
    } catch {
      // The browser may already have disconnected.
    }
  }
}

function releaseBrowser() {
  refs = Math.max(0, refs - 1);
  if (refs === 0) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(closeSharedBrowser, IDLE_MS);
    if (idleTimer.unref) idleTimer.unref();
  }
}

// Playwright owns the browser subprocess; per-request contexts and idle cleanup
// handle normal release (Playwright Browser has no process() method).

module.exports = {
  launchBrowser,
  acquireBrowser,
  releaseBrowser,
  closeSharedBrowser,
  findChromiumExecutable,
};
