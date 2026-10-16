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

console.log('=== 指數報價 hkHSI / usINX / usDJI');
console.log(new TextDecoder('gbk').decode(await get('https://qt.gtimg.cn/q=hkHSI,hkHSCEI,usINX,usDJI,usIXIC')).slice(0, 900));

for (const [n, p] of [
  ['恆指 K', 'hkHSI,day,,,320,qfq'],
  ['標普 K', 'usINX.OQ,day,,,320,qfq'],
  ['港股長歷史 2000根', 'hk00700,day,,,2000,qfq'],
]) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/${p.startsWith('hk') ? 'hkfqkline' : 'usfqkline'}/get?param=${p}`;
  try {
    const b = await get(url);
    const j = JSON.parse(b.toString('utf8'));
    const k = Object.keys(j.data || {})[0];
    const node = j.data?.[k];
    const arr = node?.qfqday || node?.day;
    console.log(`\n=== ${n} -> keys=${Object.keys(node || {})} 根數=${arr?.length}`);
    if (arr?.length) console.log('  首:', JSON.stringify(arr[0]), '\n  末:', JSON.stringify(arr[arr.length - 1]));
  } catch (e) { console.log(`\n=== ${n} -> ERR ${e.message}`); }
}
