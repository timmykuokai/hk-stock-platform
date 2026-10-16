import * as tx from '../server/data/providers/tencent.js';

console.log('符號對照：', ['00700', '700', '09988', 'AAPL', 'BRK-B', 'TSLA', '^HSI', '^GSPC']
  .map((c) => `${c}→${tx.quoteSymbol(c)}/${tx.klineSymbol(c)}`).join('  '));

for (const code of ['00700', '09988', 'AAPL', 'TSLA', 'BRK-B']) {
  const q = await tx.fetchQuote(code);
  console.log(`\n[報價] ${code} → ${q.name}(${q.symbol}) 現價=${q.price} ${q.currency} 升跌=${q.change}(${q.changePercent}%) 高/低=${q.dayHigh}/${q.dayLow}`);
  console.log(`        市值=${(q.marketCap / 1e8).toFixed(0)}億 PE=${q.pe} 52週=${q.fiftyTwoWeekLow}~${q.fiftyTwoWeekHigh} 時間=${q.marketTime}`);
}

for (const code of ['00700', 'AAPL']) {
  const c = await tx.fetchChart(code);
  const last = c.bars[c.bars.length - 1];
  console.log(`\n[K線] ${code} → ${c.name} ${c.bars.length} 根, 末=${JSON.stringify(last)}, 源=${c.source}`);
  console.log(`      meta=${JSON.stringify(c.meta)}`);
}

for (const s of ['^HSI', '^GSPC', '^HSCE']) {
  const q = await tx.fetchIndex(s);
  console.log(`\n[指數] ${s} → ${q.name} ${q.price} (${q.changePercent}%) @${q.marketTime}`);
}

console.log('\n[ping]', JSON.stringify(await tx.ping()));
