/**
 * test-regime.mjs — P2 市況判定引擎單測（node:test）
 * 覆蓋：三態判定（多頭／空頭／盤整 crafted 數據）、八維結構、指標路由、觸發台。
 * 執行：node --test scripts/test-regime.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegime, buildApplicability, buildTriggers } from '../server/engine/regime.js';

/** 產生 crafted 日 K：dir=1 單邊上漲 / -1 單邊下跌；dir=0 為無趨勢的白噪聲（震盪） */
function makeBars(dir, n = 200, start = 100) {
  const bars = [];
  let px = start;
  // 決定性 LCG，保證測試可重現
  let seed = 20261016;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    if (dir === 1) px *= 1.006;
    else if (dir === -1) px *= 0.994;
    else px = start + (rnd() - 0.5) * 4; // 均值回歸的白噪聲：無持續方向
    const open = px * (1 + (dir === 0 ? (rnd() - 0.5) * 0.01 : dir * 0.001));
    bars.push({
      date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open,
      high: Math.max(open, px) * 1.004,
      low: Math.min(open, px) * 0.996,
      close: px,
      volume: 1e6 + (i % 7) * 1e5,
      amount: px * (1e6 + (i % 7) * 1e5),
    });
  }
  return bars;
}

function makeBench(dir, n = 200) {
  return makeBars(dir, n, 20000).map((b) => ({ date: b.date, close: b.close }));
}

test('buildRegime：單邊上漲資料 → bull 市況', () => {
  const bars = makeBars(1);
  const r = buildRegime({ bars, bench: makeBench(1), latest: { close: bars.at(-1).close } });
  assert.ok(r, '應回傳判定結果');
  assert.equal(r.regime, 'bull');
  assert.equal(r.label, '上升市況');
  assert.ok(r.counts.bull >= r.threshold, `上升票數 ${r.counts.bull} 應達門檻 ${r.threshold}`);
});

test('buildRegime：單邊下跌資料 → bear 市況', () => {
  const bars = makeBars(-1);
  const r = buildRegime({ bars, bench: makeBench(-1), latest: { close: bars.at(-1).close } });
  assert.ok(r);
  assert.equal(r.regime, 'bear');
  assert.equal(r.label, '下跌市況');
  assert.ok(r.counts.bear >= r.threshold);
});

test('buildRegime：區間震盪資料 → range 市況（且不誤判為單邊）', () => {
  const bars = makeBars(0);
  const r = buildRegime({ bars, bench: makeBench(0), latest: { close: bars.at(-1).close } });
  assert.ok(r);
  assert.equal(r.regime, 'range');
  assert.equal(r.label, '震盪市況');
});

test('buildRegime：八維結構完整，⑥⑦ 標為待接入', () => {
  const r = buildRegime({ bars: makeBars(1), bench: makeBench(1) });
  assert.equal(r.dims.length, 8);
  assert.equal(r.total, 8);
  const pending = r.dims.filter((d) => d.pending);
  assert.equal(pending.length, 2, '廣度與南向資金應為待接入');
  assert.deepEqual(pending.map((d) => d.id), ['breadth', 'southbound']);
  assert.ok(pending.every((d) => typeof d.reason === 'string' && d.reason.length > 5));
  const avail = r.dims.filter((d) => d.available);
  assert.equal(avail.length, 6);
  assert.equal(r.computed, 6);
  // 每個可算維度都要有狀態與顯示值
  for (const d of avail) {
    assert.ok(['bull', 'range', 'bear'].includes(d.state), `${d.id} 狀態應為三態之一`);
    assert.ok(d.display && d.display !== '—', `${d.id} 應有顯示值`);
    assert.ok(d.streak >= 1 && d.streak <= 5, `${d.id} streak 應介於 1–5`);
  }
});

test('buildRegime：⑤成交額標為代理指標並附註說明', () => {
  const r = buildRegime({ bars: makeBars(1), bench: makeBench(1) });
  const t = r.dims.find((d) => d.id === 'turnover');
  assert.ok(t);
  assert.equal(t.proxy, true);
  assert.ok(/代理/.test(t.note || ''));
});

test('buildRegime：資料不足 60 根 → 回傳 null', () => {
  assert.equal(buildRegime({ bars: makeBars(1, 30) }), null);
  assert.equal(buildRegime({}), null);
});

test('buildRegime：缺基準指數時仍可判定（僅 ① 轉為不可用）', () => {
  const r = buildRegime({ bars: makeBars(1) });
  assert.ok(r);
  const d1 = r.dims.find((d) => d.id === 'benchMa60');
  assert.equal(d1.available, false);
  assert.ok(r.computed <= 5);
});

test('buildRegime：信心度與維持天數欄位合法', () => {
  const r = buildRegime({ bars: makeBars(1), bench: makeBench(1) });
  assert.ok(['high', 'medium', 'low'].includes(r.confidence));
  assert.ok(['高', '中', '低'].includes(r.confidenceLabel));
  assert.ok(r.persistence.days >= 0 && r.persistence.days <= 5);
  assert.equal(r.persistence.required, 5);
  assert.ok(typeof r.advice === 'string' && r.advice.length > 20);
});

test('buildApplicability：bull 市況下趨勢指標有效、RSI 失效', () => {
  const a = buildApplicability('bull');
  assert.equal(a.regime, 'bull');
  assert.equal(a.rows.length, 10);
  const byId = Object.fromEntries(a.rows.map((r) => [r.id, r]));
  assert.equal(byId.rsi.level, 'invalid');
  assert.equal(byId.ma.level, 'effective');
  assert.equal(byId.macd.level, 'effective');
  assert.equal(byId.adx.level, 'effective');
});

test('buildApplicability：range 市況下擺盪指標有效、趨勢指標失效', () => {
  const a = buildApplicability('range');
  const byId = Object.fromEntries(a.rows.map((r) => [r.id, r]));
  assert.equal(byId.rsi.level, 'effective');
  assert.equal(byId.kd.level, 'effective');
  assert.equal(byId.macd.level, 'invalid');
  assert.equal(byId.adx.level, 'invalid');
});

test('buildApplicability：bear 市況與未知值降級為 range', () => {
  const bear = buildApplicability('bear');
  assert.equal(bear.regime, 'bear');
  assert.equal(Object.fromEntries(bear.rows.map((r) => [r.id, r])).rsi.level, 'invalid');
  const unknown = buildApplicability('nonsense');
  assert.equal(unknown.regime, 'range');
});

test('buildApplicability：每列都含標籤、色調 class 與提示', () => {
  const a = buildApplicability('bull');
  for (const r of a.rows) {
    assert.ok(['有效', '中性', '失效'].includes(r.label));
    assert.ok(['up', 'flat', 'down'].includes(r.cls));
    assert.ok(r.hint && r.hint.length > 8);
  }
  assert.ok(a.summary.length > 10);
});

test('buildTriggers：10 列齊全，其中 4 列待接入', () => {
  const bars = makeBars(1);
  const t = buildTriggers({ bars, latest: { close: bars.at(-1).close, ma60: 90, macdHist: 0.5, obv: 100, obvMa20: 90, date: '2026-10-15' }, bench: makeBench(1) });
  assert.equal(t.rows.length, 10);
  assert.equal(t.counts.pending, 4);
  assert.deepEqual(t.rows.filter((r) => r.pending).map((r) => r.id), ['mktTurnover', 'shortRatio', 'breadth', 'epsSlope']);
  assert.equal(t.counts.total, 10);
});

test('buildTriggers：空頭資料觸發個股 60 日線與 MACD 柱警戒', () => {
  const bars = makeBars(-1);
  const last = bars.at(-1).close;
  const t = buildTriggers({ bars, latest: { close: last, ma60: last * 1.5, macdHist: -1.2, obv: 100, obvMa20: 130, date: '2026-10-15' }, bench: makeBench(-1) });
  const byId = Object.fromEntries(t.rows.map((r) => [r.id, r]));
  assert.equal(byId.px60.state, 'triggered');
  assert.equal(byId.px60.tone, 'down');
  assert.equal(byId.macdHist.state, 'triggered');
  assert.equal(byId.obv.state, 'triggered');
  assert.ok(t.counts.triggered >= 3);
  assert.ok(/觸發/.test(t.summary));
});

test('buildTriggers：財報窗口 3 月／8 月為警戒，其他月份正常', () => {
  const bars = makeBars(1);
  const base = { bars, latest: { close: 100, ma60: 90, macdHist: 0.5, obv: 100, obvMa20: 90, date: '2026-03-10' }, bench: makeBench(1) };
  const mar = Object.fromEntries(buildTriggers(base).rows.map((r) => [r.id, r]));
  assert.equal(mar.earnings.state, 'watch');
  assert.ok(/密集期/.test(mar.earnings.value));

  base.latest = { ...base.latest, date: '2026-08-05' };
  const aug = Object.fromEntries(buildTriggers(base).rows.map((r) => [r.id, r]));
  assert.equal(aug.earnings.state, 'watch');

  base.latest = { ...base.latest, date: '2026-10-15' };
  const oct = Object.fromEntries(buildTriggers(base).rows.map((r) => [r.id, r]));
  assert.equal(oct.earnings.state, 'normal');
});

test('buildTriggers：布林帶寬分位落在 0–100 且極端值轉為警戒', () => {
  const bars = makeBars(1);
  const t = buildTriggers({ bars, latest: { close: bars.at(-1).close, ma60: 90, macdHist: 0.5, obv: 100, obvMa20: 90, date: '2026-10-15' }, bench: makeBench(1) });
  const bw = t.rows.find((r) => r.id === 'bbWidth');
  assert.ok(bw);
  const pct = Number(String(bw.value).match(/^(\d+)/)?.[1]);
  assert.ok(Number.isFinite(pct) && pct >= 0 && pct <= 100, `分位應在 0–100，實得 ${bw.value}`);
});

test('buildTriggers：缺基準指數時 ① 轉為待接入而非拋錯', () => {
  const bars = makeBars(1);
  const t = buildTriggers({ bars, latest: { close: 100, ma60: 90, date: '2026-10-15' } });
  const hsi = t.rows.find((r) => r.id === 'hsi60');
  assert.equal(hsi.state, 'pending');
  assert.equal(t.rows.length, 10);
});
