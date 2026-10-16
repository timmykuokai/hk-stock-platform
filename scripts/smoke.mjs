/**
 * smoke.mjs — 端對端冒煙測試：驗證各 API 是否正常回傳且資料合理。
 * 用法：node scripts/smoke.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:8787';
let pass = 0;
let fail = 0;

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body };
}
async function post(path, data) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body };
}

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const section = (t) => console.log(`\n▶ ${t}`);

(async () => {
  section('系統');
  const h = await get('/api/health');
  check('health 200', h.status === 200);
  check('供應商皆正常', (h.body.providers || []).every((p) => p.ok), JSON.stringify(h.body.providers));
  const meta = await get('/api/meta');
  check('meta 含指標定義', (meta.body.metricDefs || []).length > 10);
  check('meta 含策略模板', (meta.body.templates || []).length >= 4);

  section('篩選');
  const scr = await post('/api/screen', { pool: 'popular', filters: [], preset: 'balanced', limit: 5 });
  check('screen 200', scr.status === 200, JSON.stringify(scr.body).slice(0, 200));
  check('回傳標的', (scr.body.items || []).length === 5);
  const it0 = (scr.body.items || [])[0];
  check('含評分', it0?.score?.total != null);
  check('含成交額', it0?.metrics?.turnover20d > 0);
  check('含波動度', it0?.metrics?.vol1y != null);

  const tpl = (meta.body.templates || [])[0];
  const s2 = await post('/api/screen', { pool: 'popular', filters: tpl.filters, preset: tpl.preset, limit: 20 });
  check(`模板「${tpl.label}」可執行`, s2.status === 200 && Array.isArray(s2.body.items), JSON.stringify(s2.body).slice(0, 160));

  section('大盤');
  const ov = await get('/api/market/overview');
  check('指數有值', (ov.body.indices || []).some((i) => i.price != null), JSON.stringify(ov.body.indices));
  check('成交排行有資料', (ov.body.topTurnover || []).length > 0);
  check('etnet 交叉驗證榜', (ov.body.etnetTop || []).length > 0);

  section('個股');
  const st = await get('/api/stock/00700');
  check('stock 200', st.status === 200, JSON.stringify(st.body).slice(0, 200));
  check('K 線筆數充足', (st.body.bars || []).length > 200, `${(st.body.bars || []).length}`);
  check('指標完整', st.body.metrics?.vol1y != null && st.body.metrics?.turnover20d > 0);
  check('基本面有值', st.body.fundamentals?.marketCap > 0, JSON.stringify(st.body.fundamentals || {}).slice(0, 160));
  check('評分解構存在', st.body.score?.dimensions != null);

  section('投資組合');
  const p0 = await get('/api/portfolio');
  check('portfolio 200', p0.status === 200);
  const add = await post('/api/portfolio', { code: '00700', qty: 100, cost: 300, date: '2025-01-02' });
  check('新增持股', add.status === 200 && !!add.body.id, JSON.stringify(add.body).slice(0, 160));
  const p1 = await get('/api/portfolio');
  check('估值有市值', p1.body.summary?.totalValue > 0, JSON.stringify(p1.body.summary));
  if (add.body?.id) await fetch(`${BASE}/api/portfolio/${add.body.id}`, { method: 'DELETE' });
  const p2 = await get('/api/portfolio');
  check('刪除生效', (p2.body.rows || []).length === (p0.body.rows || []).length);

  section('警報');
  const a0 = await get('/api/alerts');
  check('alerts 200', a0.status === 200);
  const ar = await post('/api/alerts', { code: '00700', type: 'price_below', params: { threshold: 99999 } });
  check('新增規則', ar.status === 200 && !!ar.body.id);
  const ck = await post('/api/alerts/check', {});
  check('檢查執行', ck.status === 200 && ck.body.checked >= 1, JSON.stringify(ck.body).slice(0, 200));
  check('規則觸發', (ck.body.events || []).length >= 1);
  if (ar.body?.id) await fetch(`${BASE}/api/alerts/${ar.body.id}`, { method: 'DELETE' });
  await fetch(`${BASE}/api/alerts-log`, { method: 'DELETE' });

  section('回測');
  const bt = await post('/api/backtest', {
    pool: 'popular', universeLimit: 30, start: '2022-01-01', end: new Date().toISOString().slice(0, 10),
    rebalance: 'quarterly', rankBy: 'momentum60', topN: 5, costBps: 15, filters: { minTurnover: 5e7 },
  });
  check('backtest 200', bt.status === 200, JSON.stringify(bt.body).slice(0, 300));
  check('淨值曲線有資料', (bt.body.equity || []).length > 50, `${(bt.body.equity || []).length}`);
  check('績效指標完整', bt.body.stats?.cagr != null && bt.body.stats?.maxDrawdown != null);
  check('再平衡紀錄', (bt.body.rebalances || []).length > 0);

  section('深度分析（十大要素 + 綜合決策）');
  const an = await get('/api/stock/00700/analysis?range=1y');
  check('analysis 200', an.status === 200, JSON.stringify(an.body).slice(0, 200));
  check('技術指標快照', an.body.indicators?.latest?.rsi14 != null && an.body.indicators?.latest?.macd != null);
  check('十大要素齊全', (an.body.factors || []).length === 10);
  check('要素分數合理', (an.body.factors || []).every((f) => f.score >= 0 && f.score <= f.maxScore));
  check('技術面十大訊號', (an.body.indicators?.technical?.signals || []).length === 10);
  check('綜合決策總分', an.body.verdict?.overall >= 0 && an.body.verdict?.overall <= 100, `${an.body.verdict?.overall}`);
  check('價位階梯完整', an.body.verdict?.stopLoss != null && an.body.verdict?.takeProfit1 != null && an.body.verdict?.entryZone?.low != null);
  check('多空因素', (an.body.verdict?.bullish || []).length >= 1 && (an.body.verdict?.bearish || []).length >= 1);
  check('四層框架', (an.body.layers || []).length === 4);
  check('基本面欄位擴充', an.body.hasFundamentals && an.body.metrics != null);

  section('異動掃描');
  const mv = await get('/api/movers?pool=popular&limit=10');
  check('movers 200', mv.status === 200, JSON.stringify(mv.body).slice(0, 200));
  check('六種視角齊全', ['gainers', 'losers', 'value', 'surge', 'high52', 'hot'].every((k) => Array.isArray(mv.body[k])));
  check('漲幅榜有資料', (mv.body.gainers || []).length > 0);
  check('跌幅榜有資料', (mv.body.losers || []).length > 0);
  check('成交額榜有序', (mv.body.value || []).length > 1
    && (mv.body.value[0].turnover20d ?? 0) >= (mv.body.value[1].turnover20d ?? 0));
  const sg = await get('/api/signals?pool=popular&limit=20');
  check('signals 200', sg.status === 200);
  check('訊號含標籤', (sg.body.items || []).every((s) => (s.tags || []).length >= 1));

  section('多股比較');
  const cp = await post('/api/compare', { codes: ['00700', '09988', '00005'], range: '1y' });
  check('compare 200', cp.status === 200, JSON.stringify(cp.body).slice(0, 200));
  check('回傳全部標的', (cp.body.rows || []).length === 3, `${(cp.body.rows || []).length}`);
  check('每檔含十大要素', (cp.body.rows || []).every((r) => (r.factors || []).length === 10));
  check('每檔含決策摘要', (cp.body.rows || []).every((r) => r.summary?.overall != null));
  check('指標定義回傳', (cp.body.metricDefs || []).length >= 10);
  check('依總分排序', (cp.body.rows || []).length > 1
    && (cp.body.rows[0].summary?.overall ?? 0) >= (cp.body.rows[1].summary?.overall ?? 0));

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒煙測試執行失敗：', e);
  process.exit(1);
});
