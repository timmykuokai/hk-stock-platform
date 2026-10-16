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
  ['US K with .OQ', 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=usAAPL.OQ,day,,,320,qfq'],
  ['US K noqfq', 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=usAAPL,day,,,320,'],
  ['US K usAAPL.OQ plain', 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=usAAPL.OQ,day,2026-01-01,2026-09-28,320,qfq'],
  ['HK batch quote', 'https://qt.gtimg.cn/q=hk00700,hk00001,hk09988'],
  ['HK K 320', 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk00700,day,,,320,qfq'],
];

for (const [name, url] of targets) {
  try {
    const r = await raw(url);
    const isGbk = url.includes('qt.gtimg.cn');
    const txt = isGbk ? r.buf.toString('utf8') : r.buf.toString('utf8');
    console.log(`\n=== ${name} -> HTTP ${r.status} (${r.buf.length}B)`);
    console.log(txt.slice(0, 450));
    if (!isGbk) {
      const j = JSON.parse(txt);
      const k = Object.keys(j.data || {})[0];
      const node = j.data[k];
      console.log('  node keys:', Object.keys(node));
      for (const kk of Object.keys(node)) {
        if (Array.isArray(node[kk])) console.log(`  ${kk}: ${node[kk].length} 根, 首=${JSON.stringify(node[kk][0])}, 末=${JSON.stringify(node[kk][node[kk].length-1])}`);
      }
    }
  } catch (e) {
    console.log(`\n=== ${name} -> ERR ${e.message}`);
  }
}
