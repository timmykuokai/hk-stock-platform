/**
 * P3 單測：基本面引擎（Gate / 財報窗口 / 倉位矩陣）
 * 純函式測試，不依賴網路。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFundamentalGate, buildEarningsWindow, buildPositionMatrix } from '../server/engine/fundamental.js';

// ───────── 1. 基本面 Gate ─────────
test('Gate · 全綠 → 資格通過', () => {
  const fund = { debtToEquity: 0.5, operatingCashflow: 1e9 };
  const metrics = { pe: 12, pb: 1.5, roe: 0.15, grossMargin: 0.40, revenueGrowth: 0.10 };
  const g = buildFundamentalGate(fund, metrics);
  assert.equal(g.status, 'pass');
  assert.equal(g.label, '資格通過');
  assert.equal(g.counts.pass, 7);
  assert.equal(g.counts.fail, 0);
});

test('Gate · 分數欄位正確轉百分比顯示', () => {
  const g = buildFundamentalGate({}, { roe: 0.15, grossMargin: 0.42, revenueGrowth: 0.08 });
  const roe = g.checks.find((c) => c.id === 'roe');
  const gross = g.checks.find((c) => c.id === 'gross');
  assert.equal(roe.display, '15.0%');
  assert.equal(roe.state, 'pass');
  assert.equal(gross.display, '42.0%');
});

test('Gate · 全紅 → 資格不合格', () => {
  const fund = { debtToEquity: 3.0, operatingCashflow: -1e9 };
  const metrics = { pe: 55, pb: 8, roe: -0.05, grossMargin: 0.05, revenueGrowth: -0.10 };
  const g = buildFundamentalGate(fund, metrics);
  assert.equal(g.status, 'fail');
  assert.ok(g.counts.fail >= 2);
});

test('Gate · 1 項未達 → 有疑慮', () => {
  const fund = { debtToEquity: 3.0, operatingCashflow: 1e9 }; // d2e 紅
  const metrics = { pe: 12, pb: 1.5, roe: 0.15, grossMargin: 0.40, revenueGrowth: 0.10 };
  const g = buildFundamentalGate(fund, metrics);
  assert.equal(g.status, 'watch');
  assert.equal(g.counts.fail, 1);
});

test('Gate · Yahoo 以百分比回傳 D/E 自動正規化（38.59 → 0.39x 合格）', () => {
  const g = buildFundamentalGate({ debtToEquity: 38.59, operatingCashflow: 1e9 },
    { pe: 14.9, pb: 2.82, roe: 0.199, grossMargin: 0.567, revenueGrowth: 0.11 });
  const d2e = g.checks.find((c) => c.id === 'd2e');
  assert.equal(d2e.display, '0.39x'); // 38.59% 視為 0.3859 倍
  assert.equal(d2e.state, 'pass');
});

test('Gate · 缺太多欄位 → 資料不足', () => {
  const g = buildFundamentalGate({}, {});
  assert.equal(g.status, 'data');
  assert.equal(g.label, '資料不足');
});

test('Gate · 偏高 PE/PB 但非失控 → 警告不致命', () => {
  const g = buildFundamentalGate({ debtToEquity: 0.5, operatingCashflow: 1e9 },
    { pe: 32, pb: 5, roe: 0.15, grossMargin: 0.40, revenueGrowth: 0.10 });
  const pe = g.checks.find((c) => c.id === 'pe');
  const pb = g.checks.find((c) => c.id === 'pb');
  assert.equal(pe.state, 'warn');
  assert.equal(pb.state, 'warn');
  // 沒有 fail → 仍通過
  assert.equal(g.status, 'pass');
});

// ───────── 2. 財報窗口 ─────────
test('窗口 · 10 月 → 下次為次年 3 月年報', () => {
  const w = buildEarningsWindow(new Date(2026, 9, 16).getTime());
  assert.equal(w.periodType, '年報');
  assert.equal(w.estimatedDate, '2027-03-31');
  assert.equal(w.status, 'normal');
  assert.ok(w.daysToReport > 100);
  assert.equal(w.preciseDate, null);
  assert.match(w.preciseSource, /待接入/);
});

test('窗口 · 2 月 → 下次為當年 3 月年報', () => {
  const w = buildEarningsWindow(new Date(2026, 1, 15).getTime());
  assert.equal(w.periodType, '年報');
  assert.equal(w.estimatedDate, '2026-03-31');
});

test('窗口 · 4 月 → 下次為當年 8 月中報', () => {
  const w = buildEarningsWindow(new Date(2026, 3, 10).getTime());
  assert.equal(w.periodType, '中報');
  assert.equal(w.estimatedDate, '2026-08-31');
});

test('窗口 · 業績前 21 日內 → 減權期', () => {
  const w = buildEarningsWindow(new Date(2026, 2, 20).getTime()); // 3/20
  assert.equal(w.status, 'reduce');
  assert.match(w.statusLabel, /減權/);
});

test('窗口 · 業績後 7 日內 → 剛公佈', () => {
  const w = buildEarningsWindow(new Date(2026, 3, 5).getTime()); // 4/5，3/31 公佈後 5 日
  assert.equal(w.status, 'just_reported');
});

// ───────── 3. 倉位矩陣 ─────────
test('矩陣 · bull 高亮進攻行', () => {
  const m = buildPositionMatrix('bull');
  assert.equal(m.current, 'bull');
  assert.equal(m.rows[0].active, true);
  assert.equal(m.rows[1].active, false);
  assert.equal(m.rows[0].regimeLabel, '進攻市況');
});

test('矩陣 · 預設值 range（含無效輸入）', () => {
  assert.equal(buildPositionMatrix(undefined).current, 'range');
  assert.equal(buildPositionMatrix('xyz').current, 'range');
  const r = buildPositionMatrix('bear');
  assert.equal(r.current, 'bear');
  assert.equal(r.rows[2].active, true);
  assert.equal(r.rows[2].positionRange, '20–40%');
});

test('矩陣 · 三行皆含完整欄位', () => {
  const m = buildPositionMatrix('range');
  for (const row of m.rows) {
    assert.ok(row.positionRange && row.holdPeriod && row.stopWidth && row.portions && row.strategy);
  }
});
