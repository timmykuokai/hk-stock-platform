import https from 'node:https';
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function get(url, gbk = false) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/', 'Accept-Encoding': 'gzip' } }, (r) => {
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => {
        let b = Buffer.concat(c);
        const enc = String(r.headers['content-encoding'] || '');
        try { if (enc.includes('gzip')) b = zlib.gunzipSync(b); } catch {}
        res(gbk ? new TextDecoder('gbk').decode(b) : b.toString('utf8'));
      });
    }).on('error', rej);
  });
}

const t = [
  ['騰訊 HK 個股資料', 'https://web.ifzq.gtimg.cn/appstock/app/hkstock/info/get?code=hk00700', false],
  ['騰訊 finance', 'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/hkstock/getFinanceData?code=hk00700', false],
  ['騰訊 財務摘要', 'https://web.ifzq.gtimg.cn/appstock/app/HkFinance/getFinanceData?code=hk00700', false],
];
for (const [n, u, g] of t) {
  try {
    const r = await get(u, g);
    console.log(`\n=== ${n} (${r.length}B)\n${r.slice(0, 500)}`);
  } catch (e) { console.log(`\n=== ${n} ERR ${e.message}`); }
}
