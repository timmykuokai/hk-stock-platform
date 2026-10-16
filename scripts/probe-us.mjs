import https from 'node:https';

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://gu.qq.com/' } }, (r) => {
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => res(Buffer.concat(c)));
    }).on('error', rej);
  });
}

for (const q of ['usAAPL.OQ,usTSLA,usBRK.B,hk09988', 'usBRK-B,usGOOGL']) {
  const b = await get(`https://qt.gtimg.cn/q=${q}`);
  console.log(`\n=== ${q}`);
  console.log(new TextDecoder('gbk').decode(b).slice(0, 1200));
}
