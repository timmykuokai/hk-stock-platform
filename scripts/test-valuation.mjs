// P4 估值引擎單測：buildValuationBands + buildRsiValuationMatrix
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildValuationBands, buildRsiValuationMatrix, valState } from '../server/engine/valuation.js';

/** 產生日K：closes 為 array；eps/bvps 固定 */
function makeBars(closes, eps = 5, bvps = 20) {
  return closes.map((c) => ({ close: c }));
}
const FUND = (eps, bvps, trailingPE, priceToBook) => ({ eps, bookValue: bvps, trailingPE, priceToBook });

test('valState 分類', () => {
  assert.equal(valState(10), 'cheap');
  assert.equal(valState(50), 'fair');
  assert.equal(valState(85), 'expensive');
  assert.equal(valState(null), 'unknown');
});

test('估值分位帶 · 當下處歷史低位 → 估值偏低', () => {
  const closes = Array.from({ length: 100 }, (_, i) => 100 + i); // 100..199 上升
  closes.push(50); // 最新收盤遠低於歷史 → 低分位
  const fund = FUND(5, 20, 10, 2.5);
  const v = buildValuationBands(fund, makeBars(closes));
  assert.ok(v.pe, '應有 PE 帶');
  assert.equal(v.pe.state, 'cheap');
  assert.ok(v.pe.percentile < 30, `百分位的 ${v.pe.percentile} 應 <30`);
  assert.ok(v.pe.bands && v.pe.bands.p50 > 0, '應有分位帶');
  assert.equal(v.primary, 'pe');
  assert.ok(v.window && v.window.bars === 101);
});

test('估值分位帶 · 當下處歷史高位 → 估值偏高', () => {
  const closes = Array.from({ length: 100 }, (_, i) => 100 + i);
  closes.push(400); // 最新遠高於歷史 → 高分位
  const fund = FUND(5, 20, 80, 20);
  const v = buildValuationBands(fund, makeBars(closes));
  assert.equal(v.pe.state, 'expensive');
  assert.ok(v.pe.percentile > 70, `百分位的 ${v.pe.percentile} 應 >70`);
});

test('估值分位帶 · 當下居中 → 估值合理', () => {
  const closes = Array.from({ length: 100 }, (_, i) => 100 + i); // 100..199
  closes.push(150); // 居中
  const fund = FUND(5, 20, 30, 7.5);
  const v = buildValuationBands(fund, makeBars(closes));
  assert.equal(v.pe.state, 'fair');
});

test('估值分位帶 · 無 EPS → 退為 PB 帶，primary=pb', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const fund = FUND(null, 20, null, 6); // 無 eps / trailingPE
  const v = buildValuationBands(fund, makeBars(closes));
  assert.equal(v.pe, null, '無 EPS 時 PE 帶應為 null');
  assert.ok(v.pb, '應有 PB 帶');
  assert.equal(v.primary, 'pb');
});

test('估值分位帶 · 兩者皆缺 → pe/pb 皆 null', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const v = buildValuationBands({}, makeBars(closes));
  assert.equal(v.pe, null);
  assert.equal(v.pb, null);
  assert.equal(v.primary, null);
});

test('RSI×估值 · 低估×超賣 → strong 且 active', () => {
  const m = buildRsiValuationMatrix(28, 'cheap', { primary: 'pe' });
  assert.equal(m.rsiCat, 'oversold');
  assert.equal(m.valuationState, 'cheap');
  assert.ok(m.active, '應有 active 格');
  assert.equal(m.active.tone, 'strong');
  assert.match(m.recommendation, /黃金交叉/);
});

test('RSI×估值 · 偏高×超買 → strong_sell 且 active', () => {
  const m = buildRsiValuationMatrix(78, 'expensive');
  assert.equal(m.rsiCat, 'overbought');
  assert.equal(m.active.tone, 'strong_sell');
  assert.match(m.recommendation, /估值透支/);
});

test('RSI×估值 · 中性 RSI 落在中性列', () => {
  const m = buildRsiValuationMatrix(50, 'fair');
  assert.equal(m.rsiCat, 'neutral');
  assert.equal(m.active.tone, 'neutral');
});

test('RSI×估值 · 估值資料不足 → 退為單列', () => {
  const m = buildRsiValuationMatrix(50, 'unknown');
  assert.equal(m.valuationState, 'unknown');
  assert.equal(m.valRows.length, 1);
  assert.equal(m.recommendation, '資料不足，無法判定');
});
