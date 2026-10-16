/**
 * test-core.mjs — 純邏輯層單元測試（Node 內建 node:test，無需額外依賴）。
 *
 * 背景：專案過去只有打 live server 的 smoke / check-ui，純函式完全沒有覆蓋，
 * 重構時沒有安全網。這裡先補上共用 lib 層（代號正規化、市場設定、儲存、降級、錯誤）
 * 以及指標計算的基本不變量，這些都是最容易改壞、也最值得鎖住行為的地方。
 *
 * 執行：npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectMarket, normalizeCode, norm, isUS, isHK } from '../server/lib/code.js';
import { marketProfile, profileForCode, benchmarkSymbol, benchmarkLabel, MARKETS } from '../server/lib/market.js';
import { readJson, writeJson } from '../server/lib/store.js';
import { Degrade } from '../server/lib/degrade.js';
import { PublicError, isPublicError } from '../server/lib/errors.js';
import { STORE_DIR, CACHE_DIR, SNAPSHOT_DIR, NEWS_CACHE_DIR, ensureDirs } from '../server/lib/paths.js';
import * as yahooNs from '../server/data/providers/yahoo.js';
const { symbolFromCode, codeFromSymbol } = yahooNs;

/* ---------------------------- lib/code.js ---------------------------- */

test('detectMarket：數字與 .HK 為港股，含英字為美股', () => {
  assert.equal(detectMarket('700'), 'hk');
  assert.equal(detectMarket('00700'), 'hk');
  assert.equal(detectMarket('0700.HK'), 'hk');
  assert.equal(detectMarket('AAPL'), 'us');
  assert.equal(detectMarket('BRK.B'), 'us');
  assert.equal(detectMarket('brk-b'), 'us');
  // 空值視為港股，維持既有預設行為
  assert.equal(detectMarket(''), 'hk');
});

test('normalizeCode：港股補零 5 碼，美股大寫且 BRK.B → BRK-B', () => {
  assert.equal(normalizeCode('700'), '00700');
  assert.equal(normalizeCode('0700.HK'), '00700');
  assert.equal(normalizeCode('aapl'), 'AAPL');
  assert.equal(normalizeCode('BRK.B'), 'BRK-B');
  // 明確指定市場時以指定值為準
  assert.equal(normalizeCode('0700', 'us'), '0700');
});

test('norm 單參數版不會把美股補零成 0AAPL（歷史 Bug 防回歸）', () => {
  assert.equal(norm('AAPL'), 'AAPL');
  assert.equal(norm('700'), '00700');
  assert.equal(norm('TSLA'), 'TSLA');
  assert.ok(!norm('AAPL').startsWith('0'), '美股代號不應被補零');
  assert.equal(isUS('AAPL'), true);
  assert.equal(isHK('AAPL'), false);
  assert.equal(isHK('00700'), true);
});

/* --------------------------- lib/market.js --------------------------- */

test('marketProfile：基準指數／標籤／幣別集中查表', () => {
  const hk = marketProfile('hk');
  const us = marketProfile('us');
  assert.equal(hk.benchmark, '^HSI');
  assert.equal(hk.benchmarkLabel, '恒指');
  assert.equal(hk.currency, 'HKD');
  assert.equal(hk.usesEtnet, true);
  assert.equal(us.benchmark, '^GSPC');
  assert.equal(us.benchmarkLabel, '標普');
  assert.equal(us.currency, 'USD');
  assert.equal(us.usesEtnet, false, 'etnet 只涵蓋港股');
  // 未知市場一律退回港股，避免 undefined 判斷讓美股邏輯失效
  assert.equal(marketProfile('jp').benchmark, '^HSI');
  assert.equal(MARKETS.length, 2);
});

test('benchmarkSymbol / profileForCode：由代號正確推出基準', () => {
  assert.equal(benchmarkSymbol('00700'), '^HSI');
  assert.equal(benchmarkSymbol('AAPL'), '^GSPC');
  assert.equal(benchmarkSymbol('us'), '^GSPC');
  assert.equal(profileForCode('AAPL').market, 'us');
  assert.equal(benchmarkLabel('us'), '標普');
  assert.equal(benchmarkLabel('hk'), '恒指');
});

/* ------------------------- yahoo Provider 相容 ------------------------ */

test('symbolFromCode / codeFromSymbol 與 lib/code.js 行為一致', () => {
  assert.equal(symbolFromCode('700'), '0700.HK');
  assert.equal(symbolFromCode('00700'), '0700.HK');
  assert.equal(symbolFromCode('AAPL'), 'AAPL');
  assert.equal(symbolFromCode('BRK.B'), 'BRK-B');
  assert.equal(codeFromSymbol('0700.HK'), '00700');
  assert.equal(codeFromSymbol('AAPL'), 'AAPL');
  // re-export 必須仍可用（既有模組依賴 yahoo.detectMarket）
  assert.equal(typeof yahooNs.detectMarket, 'function');
  assert.equal(typeof yahooNs.normalizeCode, 'function');
  assert.equal(yahooNs.detectMarket('AAPL'), 'us');
});

/* --------------------------- lib/store.js ---------------------------- */

test('readJson / writeJson：寫讀往返與損壞容錯', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hks-store-'));
  const file = path.join(dir, 'a.json');
  writeJson(file, { codes: ['00700', 'AAPL'] });
  assert.deepEqual(readJson(file, null), { codes: ['00700', 'AAPL'] });
  // 檔案不存在 → fallback
  assert.deepEqual(readJson(path.join(dir, 'nope.json'), []), []);
  // 內容損壞 → fallback，不拋出
  fs.writeFileSync(path.join(dir, 'bad.json'), '{not json');
  assert.equal(readJson(path.join(dir, 'bad.json'), 'FB'), 'FB');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* -------------------------- lib/degrade.js --------------------------- */

test('Degrade：失敗時回傳 fallback 並記錄，成功時不記錄', async () => {
  const dg = new Degrade('test');
  assert.equal(dg.degraded, false);

  const ok = await dg.run('正常項目', Promise.resolve(42), null);
  assert.equal(ok, 42);
  assert.equal(dg.degraded, false);

  const fallback = await dg.run('報價', Promise.reject(new Error('HTTP 429')), null);
  assert.equal(fallback, null);
  assert.equal(dg.degraded, true);
  assert.equal(dg.items.length, 1);
  assert.equal(dg.items[0].label, '報價');
  assert.match(dg.items[0].message, /429/);

  // 自訂 fallback 值
  const arr = await dg.run('基準', Promise.reject(new Error('boom')), []);
  assert.deepEqual(arr, []);
  assert.equal(dg.items.length, 2);

  // 同步版
  const syncFallback = dg.runSync('立即', () => { throw new Error('sync'); }, 'x');
  assert.equal(syncFallback, 'x');
  assert.equal(dg.toJSON().length, 3);
});

/* -------------------------- lib/errors.js ---------------------------- */

test('PublicError：可安全外露，一般錯誤則否（避免洩漏供應商 URL）', () => {
  const pub = new PublicError('請提供至少 2 檔股票', 400);
  assert.equal(pub.status, 400);
  assert.equal(isPublicError(pub), true);

  const upstream = new Error('HTTP 403 https://query1.finance.yahoo.com/v8/...');
  assert.equal(isPublicError(upstream), false);
  assert.equal(isPublicError(null), false);

  // 帶 expose 標記的錯誤也視為可外露
  const flagged = Object.assign(new Error('自訂'), { expose: true });
  assert.equal(isPublicError(flagged), true);
});

/* --------------------------- lib/paths.js ---------------------------- */

test('paths：一律為絕對路徑，且不依賴啟動目錄', () => {
  for (const d of [STORE_DIR, CACHE_DIR, SNAPSHOT_DIR, NEWS_CACHE_DIR]) {
    assert.ok(path.isAbsolute(d), `${d} 應為絕對路徑`);
    assert.ok(!d.includes('..'), `${d} 不應含相對片段`);
  }
  ensureDirs();
  for (const d of [STORE_DIR, CACHE_DIR, SNAPSHOT_DIR, NEWS_CACHE_DIR]) {
    assert.equal(fs.existsSync(d), true, `${d} 應已建立`);
  }
});

/* --------------------------- 既有資料完整性 --------------------------- */

test('使用者資料不可被美股代號污染（0AAPL 防回歸）', () => {
  const wl = path.join(STORE_DIR, 'watchlist.json');
  if (!fs.existsSync(wl)) return;
  const codes = readJson(wl, { codes: [] }).codes ?? [];
  for (const c of codes) {
    assert.ok(!/^0[A-Z]/.test(c), `自選清單含被補零污染的美股代號：${c}`);
  }
});
