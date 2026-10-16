import zlib from 'node:zlib';
import https from 'node:https';
import http from 'node:http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function raw(url, opts = {}) {
  const { timeout = 15000, headers = {} } = opts;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, {
      method: 'GET', timeout,
      headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8', 'Accept-Encoding': 'gzip, deflate', ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
          else if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, buf });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// 簡易 GBK → UTF-8（Node 22 有 TextDecoder('gbk')? 測試）
function decode(buf, hint) {
  if (hint === 'gbk') {
    try { return new TextDecoder('gbk').decode(buf); } catch { /* fallback */ }
    try { return new TextDecoder('gb18030').decode(buf); } catch {}
    return buf.toString('latin1');
  }
  return buf.toString('utf8');
}

const targets = [
  ['騰訊 hk00700', 'https://qt.gtimg.cn/q=hk00700', 'gbk'],
  ['騰訊 usAAPL', 'https://qt.gtimg.cn/q=usAAPL', 'gbk'],
  ['新浪 rt_hk00700', 'https://hq.sinajs.cn/list=rt_hk00700', 'gbk'],
  ['新浪 gb_aapl', 'https://hq.sinajs.cn/list=gb_aapl', 'gbk'],
  ['stooq 0700.hk', 'https://stooq.com/q/d/l/?s=0700.hk&i=d', 'utf8'],
  ['stooq aapl.us', 'https://stooq.com/q/d/l/?s=aapl.us&i=d', 'utf8'],
  ['etnet quote', 'https://www.etnet.com.hk/www/eng/stocks/realtime/quote.php?code=700', 'utf8'],
  ['aastocks', 'https://www.aastocks.com/tc/stocks/quote/detail-quote.aspx?symbol=00700', 'utf8'],
];

for (const [name, url, enc] of targets) {
  try {
    const r = await raw(url, { headers: { Referer: url } });
    const txt = decode(r.buf, enc);
    console.log(`\n=== ${name} -> HTTP ${r.status} (${r.buf.length}B)`);
    console.log(txt.slice(0, 500).replace(/\r?\n/g, ' | '));
  } catch (e) {
    console.log(`\n=== ${name} -> ERR ${e.message}`);
  }
}
