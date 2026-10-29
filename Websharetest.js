
/**
 * test-moviebox.js
 *
 * Usage:
 *   node test-moviebox.js
 *   node test-moviebox.js movie
 *   node test-moviebox.js tv
 *
 * Requirements:
 *   Node.js 20+
 *   npm install @webshare-proxy/sdk undici
 *   ./moviebox.js
 *
 * Set WEBSHARE_API_KEY and TMDB_API_KEY in your environment.
 */

"use strict";

const path = require("path");
const { Webshare, buildProxyUrl } = require("@webshare-proxy/sdk");
const { ProxyAgent, setGlobalDispatcher } = require("undici");

/* ------------------------------------------------------------------ */
/* 0. Configuration                                                    */
/* ------------------------------------------------------------------ */


const TMDB_API_KEY = process.env.TMDB_API_KEY || "9de3de623b579f6e127c6ec603b9f74d";

if (!TMDB_API_KEY) {
    console.error("Missing TMDB_API_KEY environment variable.");
    process.exit(1);
}

globalThis.SCRAPER_SETTINGS = {
    subtitles: true,
    all_audio_tracks: true,
    hardsub_tracks: true,
    debug_logs: true,
    res_2160p: true,
    res_1440p: true,
    res_1080p: true,
    res_720p: true,
    res_480p: true,
    res_360p: true,
};

let proxyAgent;

/* ------------------------------------------------------------------ */
/* 1. Initialize Webshare before loading the provider                  */
/* ------------------------------------------------------------------ */

async function setupWebshareProxy() {
    const apiKey = process.env.WEBSHARE_API_KEY || "p9tqto1eer7qqg7m2io08i7crofjbfys4orvgote";

    if (!apiKey) {
        throw new Error(
            "Missing WEBSHARE_API_KEY environment variable."
        );
    }

    const client = new Webshare({ apiKey: apiKey });

    // Find a valid proxy from your account.
    const page = await client.proxies.list({ mode: "direct" });

    const proxy = page.results.find((item) => item.valid);

    if (!proxy) {
        throw new Error("No valid Webshare proxy found.");
    }

    const proxyUrl = buildProxyUrl({
        mode: "direct",
        username: proxy.username,
        password: proxy.password,
        proxyAddress: proxy.proxy_address,
        port: proxy.port,
    });

    // Install the proxy as Node's global Undici dispatcher.
    // Node's built-in fetch uses this dispatcher.
    proxyAgent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(proxyAgent);

    console.log("\nWebshare proxy initialized");
    console.log(
        `Proxy server: ${proxy.proxy_address}:${proxy.port}`
    );

    // Confirm that the public IP is coming through the proxy.
    const response = await fetch("https://ipv4.webshare.io/", {
        signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
        throw new Error(
            `Proxy verification failed: HTTP ${response.status}`
        );
    }

    const publicIp = (await response.text()).trim();

    console.log("Proxy public IP:", publicIp);
    console.log("Global fetch proxy: enabled\n");
}

/* ------------------------------------------------------------------ */
/* 2. Shim the TMDB key module before loading moviebox.js              */
/* ------------------------------------------------------------------ */

function prepareTmdbShim() {
    try {
        const providerPath = require.resolve("./providers/moviebox.js");
        const providerDir = path.dirname(providerPath);

        const tmdbKeyPath = require.resolve(
            "../utils/tmdbKey",
            { paths: [providerDir] }
        );

        require.cache[tmdbKeyPath] = {
            id: tmdbKeyPath,
            filename: tmdbKeyPath,
            loaded: true,
            exports: {
                getTmdbApiKey: () => TMDB_API_KEY,
            },
        };
    } catch (error) {
        globalThis.TMDB_API_KEY = TMDB_API_KEY;

        console.warn(
            "TMDB module shim warning:",
            error.message
        );
    }
}

/* ------------------------------------------------------------------ */
/* 3. Load the provider only after configuring the proxy              */
/* ------------------------------------------------------------------ */

let provider;
let getStreams;
let onSettings;

function loadProvider() {
    prepareTmdbShim();

    
    provider = require("./providers/moviebox.js");

    ({ getStreams, onSettings } = provider);

    if (typeof getStreams !== "function") {
        throw new Error(
            "moviebox.js does not export getStreams."
        );
    }
}

/* ------------------------------------------------------------------ */
/* 4. Console formatting                                               */
/* ------------------------------------------------------------------ */

const COLORS = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
};

function c(color, value) {
    return `${COLORS[color] || ""}${value}${COLORS.reset}`;
}

function hr(char = "─", width = 78) {
    return char.repeat(width);
}

function truncate(value, max) {
    const string = String(value == null ? "" : value);
    return string.length > max
        ? string.slice(0, max - 1) + "…"
        : string;
}

function maskHeadersForPrint(headers) {
    if (!headers || typeof headers !== "object") {
        return headers;
    }

    const output = {};

    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();

        const sensitive =
            lower === "authorization" ||
            lower === "cookie" ||
            lower.includes("token") ||
            lower.includes("sign") ||
            lower.includes("key");

        output[key] = sensitive ? "***" : value;
    }

    return output;
}

/* ------------------------------------------------------------------ */
/* 5. Print stream results                                             */
/* ------------------------------------------------------------------ */

function printStreams(streams) {
    const byLanguage = new Map();

    for (const stream of streams) {
        const language = stream.language || "Unknown";

        if (!byLanguage.has(language)) {
            byLanguage.set(language, []);
        }

        byLanguage.get(language).push(stream);
    }

    const rows = [];

    for (const [language, list] of byLanguage) {
        for (const stream of list) {
            rows.push({
                lang: language,
                name: stream.name,
                quality: stream.quality,
                format: stream.format,
                subs: Array.isArray(stream.subtitles)
                    ? stream.subtitles.length
                    : 0,
                url: stream.url,
            });
        }
    }

    const columns = [
        ["LANG", 14],
        ["QUALITY", 8],
        ["FORMAT", 6],
        ["SUBS", 5],
        ["NAME", 34],
        ["URL", 60],
    ];

    const header = columns
        .map(([name, width]) => name.padEnd(width))
        .join(" ");

    console.log(c("cyan", header));
    console.log(c("dim", hr("-", header.length)));

    for (const row of rows) {
        console.log([
            truncate(row.lang, 14).padEnd(14),
            truncate(row.quality || "-", 8).padEnd(8),
            truncate(row.format || "-", 6).padEnd(6),
            String(row.subs).padEnd(5),
            truncate(row.name, 34).padEnd(34),
            truncate(row.url, 60).padEnd(60),
        ].join(" "));
    }

    const sample = streams[0];

    console.log(
        "\n" + c("magenta", "Sample stream object:")
    );

    console.log(
        JSON.stringify(
            {
                ...sample,
                url: truncate(sample.url, 120),
                headers: maskHeadersForPrint(sample.headers),
                subtitles: (sample.subtitles || []).slice(0, 3),
            },
            null,
            2
        )
    );

    if ((sample.subtitles || []).length > 3) {
        console.log(
            c(
                "dim",
                `...and ${sample.subtitles.length - 3} more subtitles`
            )
        );
    }

    const subtitleLanguages = new Set();

    for (const stream of streams) {
        for (const subtitle of stream.subtitles || []) {
            if (subtitle && subtitle.language) {
                subtitleLanguages.add(subtitle.language);
            }
        }
    }

    if (subtitleLanguages.size) {
        console.log(
            c(
                "dim",
                "Subtitle languages: " +
                    [...subtitleLanguages].sort().join(", ")
            )
        );
    }
}

/* ------------------------------------------------------------------ */
/* 6. Run a movie or TV test                                           */
/* ------------------------------------------------------------------ */

async function runCase(
    label,
    tmdbId,
    mediaType,
    season,
    episode
) {
    console.log("\n" + hr("═"));
    console.log(c("bold", `▶ ${label}`));

    console.log(
        c(
            "dim",
            `  tmdbId=${tmdbId} mediaType=${mediaType}` +
                (season != null
                    ? ` season=${season} episode=${episode}`
                    : "")
        )
    );

    console.log(hr("═"));

    const started = Date.now();
    let streams = [];

    try {
        streams = await getStreams(
            tmdbId,
            mediaType,
            season,
            episode
        );

        const elapsed = Date.now() - started;

        if (!Array.isArray(streams)) {
            console.log(
                c("red", "Provider returned a non-array result.")
            );

            return {
                ok: false,
                streams: [],
                elapsed,
                error: new Error("Non-array result"),
            };
        }

        if (streams.length === 0) {
            console.log(
                c(
                    "yellow",
                    `⚠ No streams returned after ${elapsed}ms`
                )
            );

            return {
                ok: false,
                streams,
                elapsed,
                error: null,
            };
        }

        console.log(
            c(
                "green",
                `✔ ${streams.length} stream(s) in ${elapsed}ms`
            )
        );

        printStreams(streams);

        return {
            ok: true,
            streams,
            elapsed,
            error: null,
        };
    } catch (error) {
        const elapsed = Date.now() - started;

        console.log(
            c("red", `✖ Failed after ${elapsed}ms: ${error.message}`)
        );

        if (error.stack) {
            console.log(c("dim", error.stack));
        }

        return {
            ok: false,
            streams: [],
            elapsed,
            error,
        };
    }
}

/* ------------------------------------------------------------------ */
/* 7. Test provider settings                                           */
/* ------------------------------------------------------------------ */

async function checkSettings() {
    console.log("\n" + hr("═"));
    console.log(c("bold", "▶ onSettings()"));
    console.log(hr("═"));

    try {
        if (typeof onSettings !== "function") {
            console.log(
                c("yellow", "onSettings() is not exported.")
            );
            return false;
        }

        const layout = await onSettings();

        if (!Array.isArray(layout)) {
            console.log(
                c("red", "onSettings() did not return an array.")
            );
            return false;
        }

        const toggles = layout.filter(
            (item) => item && item.type === "toggle"
        ).length;

        console.log(
            c(
                "green",
                `✔ ${layout.length} layout item(s), ${toggles} toggle(s)`
            )
        );

        return true;
    } catch (error) {
        console.log(
            c("red", `✖ onSettings() failed: ${error.message}`)
        );

        return false;
    }
}

/* ------------------------------------------------------------------ */
/* 8. Main                                                             */
/* ------------------------------------------------------------------ */

async function main() {
    // Do this first: no provider requests should start before setup.
    await setupWebshareProxy();

    // Load provider only after installing the global dispatcher.
    loadProvider();

    const arg = (process.argv[2] || "all").toLowerCase();

    if (!["all", "movie", "tv"].includes(arg)) {
        throw new Error(
            "Usage: node test-moviebox.js [all|movie|tv]"
        );
    }

    const wantsMovie = arg === "all" || arg === "movie";
    const wantsTv = arg === "all" || arg === "tv";

    console.log(c("bold", "\nMovieBox provider test harness"));
    console.log(
        c("dim", `Node ${process.version} | ${process.cwd()}`)
    );

    await checkSettings();

    const results = [];

    if (wantsMovie) {
        results.push(
            await runCase(
                "Fight Club (movie, TMDB 550)",
                550,
                "movie",
                null,
                null
            )
        );
    }

    if (wantsTv) {
        results.push(
            await runCase(
                "Supernatural S02E04 (TV, TMDB 1622)",
                1622,
                "tv",
                2,
                4
            )
        );
    }

    console.log("\n" + hr("═"));
    console.log(c("bold", "Summary"));
    console.log(hr("═"));

    let anyPass = false;

    for (const result of results) {
        if (result.ok) anyPass = true;

        const status = result.ok
            ? c("green", "PASS")
            : c("red", "FAIL");

        console.log(
            `${status} streams=${String(result.streams.length).padStart(3)}` +
            ` elapsed=${String(result.elapsed).padStart(5)}ms` +
            (result.error
                ? ` error=${result.error.message}`
                : "")
        );
    }

    console.log(
        c(
            "dim",
            "\nFAIL can mean zero streams, a provider error, or a network problem."
        )
    );

    if (proxyAgent) {
        await proxyAgent.close();
    }

    process.exitCode = anyPass ? 0 : 1;
}

main().catch(async (error) => {
    console.error("\nHarness crashed:", error.message);

    if (proxyAgent) {
        try {
            await proxyAgent.close();
        } catch {}
    }

    process.exitCode = 2;
});
