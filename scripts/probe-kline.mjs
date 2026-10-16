import zlib from 'node:zlib';
import https from 'node:https';
import http from 'node:http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function raw(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      method: 'GET', timeout: 20000,
      headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://gu.qq.com/', 'Accept-Encoding': 'gzip, deflate' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        } catch {}
        resolve({ status: res.statusCode, buf });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const targets = [
  ['HK 日K 前復權', 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk00700,day,,,60,qfq'],
  ['US 日K 前復權', 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=usAAPL,day,,,60,qfq'],
  ['HK 分時', 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=hk00700'],
];

for (const [name, url] of targets) {
  try {
    const r = await raw(url);
    const txt = r.buf.toString('utf8');
    console.log(`\n=== ${name} -> HTTP ${r.status} (${r.buf.length}B)`);
    console.log(txt.slice(0, 700));
    const j = JSON.parse(txt);
    console.log('--- keys:', Object.keys(j.data || {}));
  } catch (e) {
    console.log(`\n=== ${name} -> ERR ${e.message}`);
  }
}
