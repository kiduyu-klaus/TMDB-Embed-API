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

const os = require('os');
const { existsSync } = require('fs');
const path = require('path');

let chromiumBinary = null;
let chromium = null;
let useServerlessChromium = false;
let useSystemChromium = false;

function findSystemChromium() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROMIUM_PATH,
    process.platform === 'win32' && process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.platform === 'win32' && process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    process.platform === 'win32' && process.env['PROGRAMFILES(X86)']
      ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      : null,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : null,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find(candidate => existsSync(candidate)) || null;
}

// ══════════════════════════════════════════════════════════════
// CHROMIUM LOADING
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Auto-detect serverless vs local environment ----
/**
 * Loads the appropriate Chromium binary and Playwright module.
 *
 * @description
 *   On Linux (serverless), uses @sparticuz/chromium for a lightweight
 *   headless browser. On other OS (local dev), falls back to the
 *   full Playwright package. This ensures the same code works in
 *   both environments without manual configuration.
 */
// NOTE: Chromium is lazy-loaded inside launchBrowser() to avoid
// crashing on unsupported platforms (e.g. Android) at require-time.
// The server starts fine without Playwright; it only fails when
// someone actually calls launchBrowser().

// ══════════════════════════════════════════════════════════════
// BROWSER LAUNCHER
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Stealth Playwright browser launch ----
/**
 * Launches a Chromium browser with anti-detection measures.
 *
 * @description
 *   Configures the browser with stealth flags to avoid detection
 *   by Cloudflare and other anti-bot systems. Automatically applies
 *   serverless optimizations when running in Vercel/Netlify/AWS.
 *
 * @returns {Promise<Browser>} Playwright Browser instance
 *
 * @tip The --disable-blink-features=AutomationControlled flag is
 *      critical for bypassing navigator.webdriver detection.
 *
 * @example
 *   const browser = await launchBrowser();
 *   const page = await browser.newPage();
 *   await page.goto('https://animepahe.ch');
 */
async function launchBrowser(options = {}) {
  // ---- Lazy-load Chromium if not already loaded ----
  if (!chromium) {
    try {
      chromiumBinary = require('@sparticuz/chromium');
      chromium = require('playwright-core').chromium;
      if (os.platform() === 'linux') useServerlessChromium = true;
    } catch (e) {
      try {
        chromium = require('playwright').chromium;
      } catch (e2) {
        try {
          chromium = require('playwright-core').chromium;
          useSystemChromium = true;
        } catch (e3) {
          throw new Error('[Browser] Playwright not available on this platform. Install playwright-core or use got-scraping only.');
        }
      }
    }
  }

  const isServerless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);

  // ---- Base Chrome flags for all environments ----
  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-infobars',
    '--disable-notifications',
    '--disable-offline-sync',
    '--disable-sync',
    '--disable-translate',
    '--no-first-run',
    '--no-zygote',
  ];

  // ---- Serverless-specific optimizations ----
  const serverlessArgs = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-domain-reliability',
    '--disable-component-extensions-with-background-pages',
    '--memory-pressure-off',
    '--max_old_space_size=4096',
  ];

  const headless = options.headless ?? (isServerless ? true : process.env.CHROME_HEADLESS === 'true');

  const launchOptions = {
    headless,
    args: isServerless ? [...baseArgs, ...serverlessArgs] : baseArgs,
    timeout: isServerless ? 30000 : 60000,
  };

  if (useSystemChromium && !useServerlessChromium) {
    const executablePath = findSystemChromium();
    if (!executablePath) {
      throw new Error('[Browser] Playwright Core needs an installed Chrome/Chromium binary; set CHROME_PATH to its executable.');
    }
    launchOptions.executablePath = executablePath;
  }

  // NOTE: Add user agent to launch args for extra realism
  launchOptions.args.push(
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // ---- FEATURE: Serverless Chromium binary path ----
  if (useServerlessChromium && chromiumBinary) {
    try {
      const executablePath = await chromiumBinary.executablePath();
      if (existsSync(executablePath)) {
        launchOptions.executablePath = executablePath;
        launchOptions.args = [...chromiumBinary.args, ...launchOptions.args];
      }
    } catch (error) {
      console.error('[Browser] Serverless Chromium setup error:', error.message);
    }
  }

  try {
    const browser = await chromium.launch(launchOptions);
    return browser;
  } catch (error) {
    // NOTE: Fallback with minimal args if full config fails
    console.error('[Browser] Launch failed, trying fallback:', error.message);
    const fallbackOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
    if (useSystemChromium) fallbackOptions.executablePath = findSystemChromium();
    if (useServerlessChromium && chromiumBinary) {
      try {
        fallbackOptions.executablePath = await chromiumBinary.executablePath();
      } catch (error) {
        console.warn('[Browser] Could not resolve fallback Chromium path:', error.message);
      }
    }
    return await chromium.launch(fallbackOptions);
  }
}

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════

module.exports = { launchBrowser };

// ══════════════════════════════════════════════════════════════ END: browser.js
