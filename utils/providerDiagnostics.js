let sequence = 0;

function safeUrl(value) {
    try {
        const url = new URL(value);
        if (url.username || url.password) {
            url.username = '[redacted]';
            url.password = '[redacted]';
        }
        for (const key of [...url.searchParams.keys()]) {
            const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
            const sensitive = /^(?:apikey|key|token|accesstoken|refreshtoken|auth|authorization|password|passwd|secret|signature|sig|cookie|session|sessionid|vrf|jwt|credential|policy|keypairid)$/.test(normalized)
                || /^x(?:amz|goog).*(?:signature|credential|token|policy)$/.test(normalized);
            if (sensitive) url.searchParams.set(key, '[redacted]');
        }
        return url.toString();
    } catch (_) {
        return value;
    }
}

function safeText(value) {
    return String(value).replace(/https?:\/\/[^\s"<>]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/g, match =>
        /^https?:\/\//i.test(match) ? safeUrl(match) : '[redacted]');
}

// `redact: false` disables every redaction pass (URL credentials, sensitive
// query params, JWTs and secret-named fields). It exists for providers that
// are explicitly instrumented for local debugging, where the complete
// request URL is the whole point of the log line.
function createDiagnosticLogger(scope, { redact = true } = {}) {
    const id = `${scope}-${++sequence}`;
    return (event, fields = {}) => {
        const safeFields = redact
            ? Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
                /^(?:token|cookie|authorization|password|body|headers)$/i.test(key) ? '[redacted]'
                    : typeof value === 'string' ? safeText(value) : value
            ]))
            : fields;
        console.log(`[${id}][${new Date().toISOString()}] ${event} ${JSON.stringify(safeFields)}`);
    };
}

module.exports = { createDiagnosticLogger };
