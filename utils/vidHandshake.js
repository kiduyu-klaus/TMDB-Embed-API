const axios = require('axios');

function bridgeResult(data, stage) {
    if (!data || data.status !== 200 || !data.result) {
        throw new Error(`${stage} failed: ${data?.error || data?.status || 'invalid bridge response'}`);
    }
    return data.result;
}

async function getVidServerParts(encryptUrl, pageToken, headers, timeout) {
    const first = await axios.get(encryptUrl, { params: { text: pageToken, stage: 1 }, timeout });
    const stage1 = bridgeResult(first.data, 'Stage 1');
    if (!stage1.stage1) throw new Error('Stage 1 is missing its URL');
    const handshake = await axios.post(stage1.stage1, null, {
        headers: { ...headers, 'X-CSRF-Token': stage1.token || '' }, timeout,
        responseType: 'text'
    });
    const second = await axios.get(encryptUrl, {
        params: { text: handshake.data, stage: 2 }, timeout
    });
    const parts = bridgeResult(second.data, 'Stage 2');
    if (!parts.servers || !parts.stream) throw new Error('Stage 2 is missing server URLs');
    return parts;
}

module.exports = { getVidServerParts };
