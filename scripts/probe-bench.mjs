import https from 'node:https';
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/', 'Accept-Encoding': 'gzip' } }, (r) => {
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => {
        let b = Buffer.concat(c);
        const enc = String(r.headers['content-encoding'] || '');
        try { if (enc.includes('gzip')) b = zlib.gunzipSync(b); } catch {}
        res(b);
      });
    }).on('error', rej);
  });
}

const cands = ['usINX', 'usINX.OQ', 'us.INX', 'usSPY', 'usSPY.OQ', 'usDJI', 'usIXIC', 'usVOO'];
for (const c of cands) {
  for (const api of ['usfqkline', 'hkfqkline']) {
    try {
      const b = await get(`https://web.ifzq.gtimg.cn/appstock/app/${api}/get?param=${c},day,,,320,qfq`);
      const j = JSON.parse(b.toString('utf8'));
      const k = Object.keys(j.data || {})[0];
      const node = j.data?.[k];
      const arr = node?.qfqday || node?.day;
      if (arr?.length > 5) {
        console.log(`OK  ${api} ${c} -> ${arr.length} 根, 末=${JSON.stringify(arr[arr.length - 1]).slice(0, 80)}`);
      } else {
        console.log(`--  ${api} ${c} -> ${arr?.length ?? 0} 根`);
      }
    } catch (e) { console.log(`--  ${api} ${c} -> ERR`); }
  }
}
