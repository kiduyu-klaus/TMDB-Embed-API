require('dotenv').config();
const axios = require('axios');

const HEADERS = {
  'User-Agent': 'TMDBEmbedApi:v1.0.0 (https://github.com/Inside4ndroid)',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'Api-Key': process.env.OPEN_SUBTITLES_API_KEY
};

(async () => {
  const search = await axios.get('https://api.opensubtitles.com/api/v1/subtitles', {
    params: { tmdb_id: '550' }, headers: HEADERS, timeout: 15000
  });
  const row = search.data.data[0].attributes;
  const filesId = row.files?.[0]?.file_id;
  const subId = row.subtitle_id;
  console.log('files[0].file_id =', filesId, '| subtitle_id =', subId);

  for (const [label, id] of [['files[0].file_id', filesId], ['subtitle_id', subId]]) {
    try {
      const r = await axios.post('https://api.opensubtitles.com/api/v1/download', {
        headers: HEADERS, data: { file_id: id }, timeout: 15000
      });
      console.log(`\n${label} -> OK`, JSON.stringify(r.data).slice(0, 180));
    } catch (e) {
      const body = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.log(`\n${label} -> HTTP ${e.response?.status}`, body.slice(0, 300));
    }
  }
})();