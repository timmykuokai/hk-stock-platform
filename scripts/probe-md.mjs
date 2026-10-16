import * as md from '../server/data/marketData.js';

md.cache.clear();
console.log('快取已清空\n');

for (const code of ['00700', '09988', 'AAPL']) {
  const q = await md.getQuote(code);
  console.log(`[報價] ${code} ${q.name} = ${q.price} ${q.currency} (${q.changePercent}%) 源=${q.provider} 時間=${q.marketTime}`);
}

for (const code of ['00700', 'AAPL']) {
  const c = await md.getBars(code, { range: '1y' });
  console.log(`\n[K線] ${code} ${c.bars.length} 根, 末=${JSON.stringify(c.bars[c.bars.length - 1])} 源=${c.provider}`);
}

const bench = await md.getBenchmark('^HSI', '1y');
console.log(`\n[基準] 恒指 ${bench.length} 根, 末=${JSON.stringify(bench[bench.length - 1])}`);

const idx = await md.getIndices();
console.log('\n[指數]', idx.map((i) => `${i.zh}=${i.price}(${i.changePercent}%)/${i.provider}`).join('  '));

const m = await md.getMetrics('00700', { range: '1y', withFundamentals: true, withZh: true });
console.log(`\n[指標] 00700 源=${m.source} 名稱=${m.name} 中文=${m.zhName} 均價20=${m.metrics?.ma20?.toFixed?.(2)} 年化報酬=${m.metrics?.annualReturn?.toFixed?.(2)}`);
console.log('      降級:', JSON.stringify(m._degraded || '無'));

console.log('\n[健康]', JSON.stringify((await md.health()).providers, null, 1));
