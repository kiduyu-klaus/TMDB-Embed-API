const fs = require('node:fs');
const path = require('node:path');
const { ProxyAgent, fetch: undiciFetch } = require('undici');

const PROXY_LIST_PATH = path.join(__dirname, 'vidfast-proxies.json');
const PREFERRED_PROXY = 'http://4.144.146.21:80';
const PROXY_PROBE_URL = 'https://httpbin.org/ip';
const PROXY_PROBE_TIMEOUT_MS = 2500;
const PROXY_PROBE_LIMIT = 100;

const isValidProxyUrl = value => {
    if (typeof value !== 'string') return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' && !!url.hostname && !!url.port &&
            !url.username && !url.password && url.pathname === '/' &&
            !url.search && !url.hash;
    } catch {
        return false;
    }
};

const readProxyCandidates = () => {
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(PROXY_LIST_PATH, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('Shared VidFast proxy list is missing; download it from the Outbound connection panel');
        }
        throw new Error(`Unable to read shared VidFast proxy list: ${error.message}`);
    }
    if (!payload || !Array.isArray(payload.proxies)) {
        throw new Error('Shared VidFast proxy list has an invalid JSON format');
    }
    return payload.proxies
        .filter(proxy =>
            proxy && proxy.alive === true && proxy.ssl === true &&
            proxy.protocol === 'http' && proxy.anonymity !== 'transparent' &&
            isValidProxyUrl(proxy.proxy)
        )
        .sort((a, b) =>
            (Number(b.uptime) || 0) - (Number(a.uptime) || 0) ||
            (Number(a.timeout) || Infinity) - (Number(b.timeout) || Infinity)
        )
        .slice(0, PROXY_PROBE_LIMIT);
};

const withHardTimeout = async (factory, timeoutMs, label) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${label} timeout`)), timeoutMs);
    try {
        return await factory(controller.signal);
    } finally {
        clearTimeout(timer);
    }
};

function createProviderProxy({ provider, config, settingKey, tracedFetch, log, bypassOrigins = [] }) {
    let proxyAgent = null;
    let proxyUrl = '';
    let proxySelection = null;
    const bypass = new Set(bypassOrigins.map(origin => new URL(origin).origin));
    const logEvent = typeof log === 'function' ? log : (event, data) =>
        console.info(`[${provider}][Proxy] ${event}`, data);

    async function selectProxy() {
        const probe = async (candidateUrl, label) => {
            const agent = new ProxyAgent({ uri: candidateUrl, connectTimeout: PROXY_PROBE_TIMEOUT_MS });
            try {
                logEvent('proxy.probe.start', { proxy: candidateUrl, label, url: PROXY_PROBE_URL });
                const response = await withHardTimeout(
                    signal => undiciFetch(PROXY_PROBE_URL, { dispatcher: agent, signal }),
                    PROXY_PROBE_TIMEOUT_MS,
                    `${provider} proxy probe ${label}`
                );
                logEvent('proxy.probe.response', { proxy: candidateUrl, label, status: response.status });
                const result = await response.json();
                if (response.ok && typeof result.origin === 'string' && result.origin.trim()) {
                    proxyAgent = agent;
                    proxyUrl = candidateUrl;
                    logEvent('proxy.selected', { proxy: candidateUrl, label });
                    return agent;
                }
            } catch (error) {
                logEvent('proxy.probe.failed', { proxy: candidateUrl, label, error: error.code || error.name });
            }
            try {
                await agent.close();
            } catch (error) {
                logEvent('proxy.close.failed', { proxy: candidateUrl, error: error.message });
            }
            return null;
        };

        const preferredAgent = await probe(PREFERRED_PROXY, 'preferred');
        if (preferredAgent) return preferredAgent;

        const candidates = readProxyCandidates();
        logEvent('proxy.preferred.unavailable', { fallbackCandidates: candidates.length });
        for (const [index, candidate] of candidates.entries()) {
            const agent = await probe(candidate.proxy, `shared-list-${index + 1}`);
            if (agent) return agent;
        }
        throw new Error(`No working ${provider} proxy found after checking preferred proxy and ${candidates.length} shared-list candidates`);
    }

    function getProxyAgent() {
        if (proxyAgent) return Promise.resolve(proxyAgent);
        if (!proxySelection) {
            proxySelection = selectProxy().finally(() => {
                proxySelection = null;
            });
        }
        return proxySelection;
    }

    async function fetch(input, options = {}) {
        const requestUrl = input && typeof input === 'object' && typeof input.url === 'string'
            ? input.url
            : String(input);
        if (config[settingKey] !== true || bypass.has(new URL(requestUrl).origin)) {
            return tracedFetch(input, options);
        }
        const dispatcher = await getProxyAgent();
        return tracedFetch(input, { ...options, dispatcher });
    }

    function getStatus() {
        return {
            enabled: config[settingKey] === true,
            selectedProxy: proxyUrl || null,
            listAvailable: fs.existsSync(PROXY_LIST_PATH),
            probeLimit: PROXY_PROBE_LIMIT,
            preferredProxy: PREFERRED_PROXY,
            sharedList: 'utils/vidfast-proxies.json'
        };
    }

    return { fetch, getStatus };
}

module.exports = { createProviderProxy };
