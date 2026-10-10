require('dotenv').config();
const axios = require('axios');

const KEY = process.env.OPEN_SUBTITLES_API_KEY;
const SUBTITLE_ID = 12004658;   // the id from your curl
const FILE_ID = 12883653;       // attributes.files[0].file_id

const agents = [
  ['empty', ''],
  ['TemporaryUserAgent', 'TemporaryUserAgent'],
  ['OpenSubtitles.com/1.0', 'OpenSubtitles.com/1.0 (https://opensubtitles.com)'],
  ['Name v1 (url)', 'MySubtitleClient v1.0.0 (https://example.com)'],
  ['Name v1 (mailto)', 'MySubtitleClient v1.0.0 (mailto:me@example.com)'],
  ['browser Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
  ['curl default', 'curl/8.0.1']
];

const base = () => ({ Accept: 'application/json', 'Content-Type': 'application/json', 'Api-Key': KEY });

(async () => {
  for (const [label, ua] of agents) {
    const headers = base();
    if (ua) headers['User-Agent'] = ua; // omit entirely when empty, like curl does
    try {
      const r = await axios.post('https://api.opensubtitles.com/api/v1/download', {
        headers, data: { file_id: SUBTITLE_ID }, timeout: 15000
      });
      console.log(`OK    ${label.padEnd(22)} -> ${String(r.data?.link).slice(0, 55)}... | remaining=${r.data?.remaining}`);
    } catch (e) {
      const body = e.response?.data ? JSON.stringify(e.response.data).slice(0, 60) : e.message;
      console.log(`FAIL  ${label.padEnd(22)} -> HTTP ${e.response?.status} ${body}`);
    }
  }
})();