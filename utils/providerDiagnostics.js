let sequence = 0;

function safeText(value) {
    return String(value).replace(/https?:\/\/[^\s"<>]+|eyJ[\w-]+\.[\w-]+\.[\w-]+/g, match =>
        /^https?:\/\//i.test(match) ? match : '[redacted]');
}

function createDiagnosticLogger(scope) {
    const id = `${scope}-${++sequence}`;
    return (event, fields = {}) => {
        const safeFields = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
            /^(?:token|cookie|authorization|password|body|headers)$/i.test(key) ? '[redacted]'
                : typeof value === 'string' ? safeText(value) : value
        ]));
        console.log(`[${id}][${new Date().toISOString()}] ${event} ${JSON.stringify(safeFields)}`);
    };
}

module.exports = { createDiagnosticLogger };
