import https from 'node:https';
import { isIP } from 'node:net';

const cache = new Map();

// Direct IP bootstrap avoids depending on system DNS for the DoH service.
async function query(hostname, family, signal, refresh) {
  signal?.throwIfAborted();
  const key = `${hostname}:${family}`;
  const cached = cache.get(key);
  if (!refresh && cached?.expires > Date.now()) {
    console.log(`[DNS] Cache hit ${hostname} IPv${family}: ${cached.records.length} address(es)`);
    return cached.records;
  }
  const started = Date.now();
  console.log(`[DNS] Query ${hostname} IPv${family}${refresh ? ' (refresh)' : ''}`);
  return new Promise((resolve, reject) => {
    const type = family === 6 ? 28 : 1;
    const req = https.get({
      hostname: '1.1.1.1',
      servername: 'cloudflare-dns.com',
      path: `/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      headers: { host: 'cloudflare-dns.com', accept: 'application/dns-json' },
      signal,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('error', reject);
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error(`DoH HTTP ${res.statusCode}`);
          const data = JSON.parse(body);
          if (data.Status !== 0) throw new Error(`DoH DNS status ${data.Status}`);
          const answers = (data.Answer || []).filter(a => a.type === type && isIP(a.data) === family);
          const records = answers.map(a => ({ address: a.data, family }));
          const ttl = Math.min(300, ...answers.map(a => Math.max(0, Number(a.TTL) || 0)));
          if (records.length) cache.set(key, { records, expires: Date.now() + ttl * 1000 });
          console.log(`[DNS] Resolved ${hostname} IPv${family}: ${records.map(r => r.address).join(', ') || 'no records'}; TTL=${records.length ? ttl : 0}s; ${Date.now() - started}ms`);
          resolve(records);
        } catch (err) { reject(err); }
      });
    });
    const timer = setTimeout(() => {
      console.warn(`[DNS] Timeout ${hostname} IPv${family} after 8000ms`);
      req.destroy(new Error('DoH timeout'));
    }, 8000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
  }).catch(error => {
    console.warn(`[DNS] Query failed ${hostname} IPv${family}: ${error.code || error.name}; ${Date.now() - started}ms`);
    throw error;
  });
}

export async function resolveDoh(hostname, { family = 0, signal, refresh = false } = {}) {
  signal?.throwIfAborted();
  const host = hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(host);
  if (literalFamily) {
    if (family && family !== literalFamily) throw new Error('IP address family mismatch');
    console.log(`[DNS] IP literal ${host}; lookup skipped`);
    return [{ address: host, family: literalFamily }];
  }
  const families = family ? [family] : [4, 6];
  const results = await Promise.allSettled(families.map(f => query(host, f, signal, refresh)));
  signal?.throwIfAborted();
  const records = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  if (!records.length) throw results.find(r => r.status === 'rejected')?.reason || new Error(`DoH: no addresses for ${host}`);
  return records;
}
