const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const targets = [
  ['v8 chart 0700.HK','https://query1.finance.yahoo.com/v8/finance/chart/0700.HK?range=5d&interval=1d'],
  ['v8 chart AAPL','https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d'],
  ['v7 quote 0700.HK','https://query1.finance.yahoo.com/v7/finance/quote?symbols=0700.HK'],
  ['v10 quoteSummary','https://query1.finance.yahoo.com/v10/finance/quoteSummary/0700.HK?modules=price'],
  ['spark','https://query1.finance.yahoo.com/v7/finance/spark?symbols=0700.HK&range=1d&interval=5m'],
];
for (const [name,url] of targets){
  try{
    const r = await fetch(url,{headers:{'User-Agent':UA,Accept:'*/*'}});
    const t = await r.text();
    console.log(`\n=== ${name} -> HTTP ${r.status} (${t.length} bytes)`);
    console.log(t.slice(0,400));
  }catch(e){ console.log(`\n=== ${name} -> ERR ${e.message}`);}
}
