/**
 * marketData.js — 資料編排層：快取、批次、背景更新、指標計算與快照。
 * 上層（篩選／評分／回測／警示）只透過本模組取數，不直接打外部 API。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Cache, TTL, cached } from '../lib/cache.js';
import { mapLimit } from '../lib/http.js';
import log from '../lib/logger.js';
import { profileForCode } from '../lib/market.js';
import { Degrade } from '../lib/degrade.js';
import { PublicError } from '../lib/errors.js';
import { CACHE_DIR, SNAPSHOT_DIR, ensureDirs } from '../lib/paths.js';
import * as yahoo from './providers/yahoo.js';
import * as etnet from './providers/etnet.js';
import * as tencent from './providers/tencent.js';
import { computeMetrics } from './metrics.js';
import { getPool, alias, watchlist } from './universe.js';
import { INDICES } from './pools.js';

const TAG = 'market';
// 路徑改由 lib/paths.js 統一推導（不再依賴 process.cwd()），避免從別的目錄啟動時寫錯位置
ensureDirs();

export const cache = new Cache(CACHE_DIR, 1200);

const snapshotFile = (pool) => path.join(SNAPSHOT_DIR, `${pool}.json`);

/** 進度追蹤（背景工作） */
export const jobs = new Map(); // jobId -> {total, done, errors, startedAt, finishedAt, pool}

/**
 * 基本面欄位 schema 版本。
 * 當 provider 新增／改名欄位時遞增，讓舊快取自然失效，避免吃到缺少新欄位的舊物件。
 */
const FUND_SCHEMA = 2;

/* ---------------------------------- 基礎取數 --------------------------------- */

/**
 * 供應商容錯鏈：依序嘗試，第一個成功者即回傳，全部失敗才丟錯。
 *
 * 為什麼需要它：Yahoo Finance 自 2026-09 起對本機 IP 全面回傳 403，
 * 過去單一供應商的寫法會直接拋錯、只能吃過期快取，導致畫面股價錯誤。
 * 現在改為多源依序降級，任一家可用就能拿到正確即時資料。
 *
 * 順序策略：
 *   - 報價／指數：騰訊優先（即時、免鑰、含中文名），Yahoo 備援
 *   - K 線：Yahoo 優先（歷史較長，可達上市日），騰訊備援（約 640 根 ≈ 2.5 年）
 *
 * @param {string} label 用於日誌識別
 * @param {object[]} providers 供應商模組陣列（需有 provider.id）
 * @param {(p:object)=>Promise<any>} call 實際取數動作
 */
async function chainFetch(label, providers, call) {
  const errors = [];
  for (const p of providers) {
    const id = p.provider?.id || 'unknown';
    try {
      const value = await call(p);
      return { ...value, provider: id };
    } catch (e) {
      errors.push(`${id}: ${e.message}`);
      log.debug(TAG, `${label} 由 ${id} 取數失敗`, e.message);
    }
  }
  throw new Error(`${label} 取數失敗（${errors.join('；')}）`);
}

const keyOf = (code) => String(code ?? '').trim().toUpperCase();

export async function getBars(code, { range = '3y', interval = '1d', force = false } = {}) {
  // 騰訊僅提供日 K；分鐘／週線等仍只能走 Yahoo
  const providers = interval === '1d' ? [yahoo, tencent] : [yahoo];
  return cached(cache, `bars:${keyOf(code)}:${range}:${interval}`, TTL.bars, () =>
    chainFetch(`K線 ${code}`, providers, async (p) => {
      if (p === tencent) return tencent.fetchChart(code);
      const sym = yahoo.symbolFromCode(code);
      if (!sym) throw new Error(`無效代號：${code}`);
      // 「上市至今 (max)」：Yahoo range=max 會降採樣成月線，故改用 fetchChartMax 取完整日 K
      return range === 'max'
        ? yahoo.fetchChartMax(sym, { interval })
        : yahoo.fetchChart(sym, { range, interval });
    }), { force });
}

export async function getQuote(code, { force = false } = {}) {
  return cached(cache, `quote:${keyOf(code)}`, TTL.quote, () =>
    chainFetch(`報價 ${code}`, [tencent, yahoo], async (p) => {
      if (p === tencent) return tencent.fetchQuote(code);
      const sym = yahoo.symbolFromCode(code);
      if (!sym) throw new Error(`無效代號：${code}`);
      return yahoo.fetchQuote(sym);
    }), { force });
}

export async function getFundamentals(code, { withZh = false, force = false } = {}) {
  const res = await cached(cache, `fund${FUND_SCHEMA}:${keyOf(code)}`, TTL.fundamentals, () =>
    chainFetch(`基本面 ${code}`, [yahoo, tencent], async (p) => {
      if (p === tencent) return tencent.fetchFundamentals(code);
      const sym = yahoo.symbolFromCode(code);
      if (!sym) throw new Error(`無效代號：${code}`);
      return yahoo.fetchFundamentals(sym);
    }), { force });
  if (withZh && !res.zhName) {
    try {
      // 騰訊報價自帶中文名（一次請求即可），不再依賴 Yahoo 香港站頁面（目前 403）
      const zh = await cached(cache, `zhname:${keyOf(code)}`, 7 * 24 * 3600_000,
        async () => ({ zh: (await tencent.fetchQuote(code))?.name || null }), { force });
      res.zhName = zh.zh || null;
    } catch (e) {
      // 中文名抓不到不影響主流程，但必須留痕（過去空 catch 完全無跡可尋）
      log.debug(TAG, `${code} 中文名抓取失敗`, e.message);
      res.zhName = null;
    }
  }
  return res;
}

/** 基準指數（預設恒指）日報酬序列 */
export async function getBenchmark(symbol = '^HSI', range = '3y', { force = false, period1 } = {}) {
  // 「上市至今 (max)」：需與個股同為日線，否則 Beta 計算會因頻率錯置失真。
  // 優先使用個股上市日作為 period1（與個股區間完全一致、窗口最小、最不易被降採樣）；
  // 未提供時退回 1980 年起的日線，仍足以涵蓋尾部 1 年 Beta 所需的日報酬。
  const load = () => chainFetch(`基準 ${symbol}`, [tencent, yahoo], async (p) => {
    if (p === tencent) return tencent.fetchChart(symbol);
    if (range === 'max') {
      const p1 = period1 || Math.floor(new Date('1980-01-01T00:00:00Z').getTime() / 1000);
      return yahoo.fetchChart(symbol, { interval: '1d', period1: p1, period2: Math.ceil(Date.now() / 1000) });
    }
    return yahoo.fetchChart(symbol, { range });
  });
  const key = range === 'max' ? `bench:${symbol}:max:${period1 || 1980}` : `bench:${symbol}:${range}`;
  const r = await cached(cache, key, TTL.bars, load, { force });
  return r.bars;
}

/** 指數概況（恒指／國企／科指） */
export async function getIndices({ force = false } = {}) {
  const out = [];
  for (const idx of INDICES) {
    try {
      const q = await cached(cache, `quote:${idx.symbol}`, TTL.quote, () =>
        chainFetch(`指數 ${idx.symbol}`, [tencent, yahoo], async (p) =>
          (p === tencent ? tencent.fetchIndex(idx.symbol) : yahoo.fetchQuote(idx.symbol))), { force });
      out.push({
        ...idx,
        price: q.price, change: q.change, changePercent: q.changePercent,
        dayHigh: q.dayHigh, dayLow: q.dayLow, marketTime: q.marketTime, provider: q.provider,
      });
    } catch (e) {
      log.warn(TAG, `指數 ${idx.symbol} 取數失敗`, e.message);
      out.push({ ...idx, price: null, changePercent: null, error: e.message });
    }
  }
  return out;
}

/** etnet 成交榜（交叉驗證熱門度） */
export async function getTopTurnover({ force = false } = {}) {
  return cached(cache, 'etnet:top20', 5 * 60_000, () => etnet.fetchTopTurnover(), { force });
}

/* --------------------------------- 指標計算 ---------------------------------- */

export async function getMetrics(code, { range = '3y', withFundamentals = false, withZh = false, force = false } = {}) {
  const sym = yahoo.symbolFromCode(code);
  const profile = profileForCode(code); // 基準改查市場設定表（港股 ^HSI／美股 ^GSPC）
  const key = `metrics:${sym}:${range}:${withFundamentals ? 'f1' : 'f0'}`;
  return cached(cache, key, TTL.metrics, async () => {
    const dg = new Degrade(TAG);
    const [chart, bench, fund] = await Promise.all([
      getBars(code, { range, force }),
      dg.run(`基準指數 ${profile.benchmark}`, getBenchmark(profile.benchmark, range, { force }), []),
      withFundamentals
        ? dg.run('基本面', getFundamentals(code, { withZh, force, market: profile.market }), null)
        : Promise.resolve(null),
    ]);
    const metrics = computeMetrics({ bars: chart.bars, dividends: chart.dividends, fundamentals: fund, bench });
    return {
      code,
      symbol: sym,
      name: chart.name,
      zhName: fund?.zhName || null,
      currency: chart.currency,
      metrics,
      issues: chart.issues || [],
      source: chart.source,
      updatedAt: new Date().toISOString(),
      _degraded: dg.degraded ? dg.items : undefined,
    };
  });
}

/* ---------------------------------- 池快照 ----------------------------------- */

/**
 * 建立／更新池快照（可背景執行）
 * @param {string} pool
 * @param {{codes?:string[], range?:string, withFundamentals?:boolean, concurrency?:number, limit?:number}} opts
 */
export async function refreshPool(pool, opts = {}) {
  const { codes = [], range = '3y', withFundamentals = false, concurrency = 6, limit = 0 } = opts;
  const jobId = `${pool}:${Date.now()}`;
  const { items } = await getPool(pool, { codes });
  const list = limit > 0 ? items.slice(0, limit) : items;
  const job = {
    jobId, pool, total: list.length, done: 0, errors: [], startedAt: new Date().toISOString(), finishedAt: null,
  };
  jobs.set(jobId, job);

  // 基準指數依「每一檔標的所屬市場」取用（港股 ^HSI／美股 ^GSPC 各自對齊）。
  // 過去整池共用 ^HSI，一旦池內混入美股，Beta 等相對指標會全數錯置。
  const benchCache = new Map();
  const dg = new Degrade(TAG);
  const benchFor = async (code) => {
    const sym = profileForCode(code).benchmark;
    if (!benchCache.has(sym)) {
      benchCache.set(sym, await dg.run(`基準指數 ${sym}`, getBenchmark(sym, range), []));
    }
    return benchCache.get(sym);
  };

  const zhMap = alias.get();
  const results = [];

  await mapLimit(list, concurrency, async (item) => {
    try {
      const chart = await getBars(item.code, { range });
      const bench = await benchFor(item.code);
      const fund = withFundamentals ? await dg.run(`基本面 ${item.code}`, getFundamentals(item.code), null) : null;
      const metrics = computeMetrics({ bars: chart.bars, dividends: chart.dividends, fundamentals: fund, bench });
      if (metrics.insufficient) throw new Error('歷史資料不足（<30 根 K 線）');
      results.push({
        code: item.code,
        symbol: yahoo.symbolFromCode(item.code),
        name: chart.name,
        zhName: zhMap[item.code] || item.zh || null,
        enName: item.name || null,
        tag: item.tag || null,
        metrics,
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      job.errors.push({ code: item.code, message: e.message });
    } finally {
      job.done++;
    }
  });

  results.sort((a, b) => (b.metrics.turnover20d || 0) - (a.metrics.turnover20d || 0));
  const snapshot = {
    pool,
    range,
    withFundamentals,
    asOf: new Date().toISOString(),
    count: results.length,
    failed: job.errors.length,
    items: results,
  };
  fs.writeFileSync(snapshotFile(pool), JSON.stringify(snapshot));
  job.finishedAt = new Date().toISOString();
  log.info(TAG, `池 ${pool} 更新完成：${results.length} 成功 / ${job.errors.length} 失敗`);
  if (dg.degraded) {
    log.warn(TAG, `池 ${pool} 有 ${dg.items.length} 項資料降級（如：${dg.items.slice(0, 3).map((i) => i.label).join('、')}）`);
  }
  return snapshot;
}

/** 讀取快照（含新鮮度判讀） */
export function getSnapshot(pool = 'popular', maxAgeMin = 180) {
  try {
    const s = JSON.parse(fs.readFileSync(snapshotFile(pool), 'utf8'));
    const ageMin = (Date.now() - new Date(s.asOf).getTime()) / 60000;
    return { ...s, ageMinutes: Math.round(ageMin), fresh: ageMin <= maxAgeMin };
  } catch {
    return null;
  }
}

export function listSnapshots() {
  try {
    return fs.readdirSync(SNAPSHOT_DIR).map((f) => {
      const s = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8'));
      return { pool: s.pool, asOf: s.asOf, count: s.count, failed: s.failed };
    });
  } catch {
    return [];
  }
}

/* --------------------------------- 全量更新 ---------------------------------- */

/**
 * 立即更新所有資料（手動觸發）。
 * 重建熱門池快照、自選池（若有）、可選主板池，並強制重新抓取指數與 etnet 成交榜。
 * 以背景工作形式執行，回傳父 jobId 供前端輪詢進度。
 * @param {{withFundamentals?:boolean, concurrency?:number, includeMainboard?:boolean, mainboardLimit?:number}} opts
 */
export async function refreshAll(opts = {}) {
  const { withFundamentals = false, concurrency = 6, includeMainboard = false, mainboardLimit = 400 } = opts;
  const parentId = `all:${Date.now()}`;
  const parent = {
    jobId: parentId, pool: 'ALL', total: 0, done: 0, errors: [],
    startedAt: new Date().toISOString(), finishedAt: null, detail: {},
  };
  jobs.set(parentId, parent);

  const tasks = [{ pool: 'popular', opts: { withFundamentals, concurrency } }];
  const wl = watchlist.get();
  if (wl.length) tasks.push({ pool: 'watchlist', opts: { codes: wl, withFundamentals, concurrency } });
  if (includeMainboard) tasks.push({ pool: 'mainboard', opts: { limit: mainboardLimit, withFundamentals, concurrency } });

  for (const t of tasks) {
    try {
      const snap = await refreshPool(t.pool, t.opts);
      parent.detail[t.pool] = { ok: true, count: snap.count, failed: snap.failed, asOf: snap.asOf };
      parent.done += snap.count;
      parent.total += snap.count;
    } catch (e) {
      parent.detail[t.pool] = { ok: false, error: e.message };
      parent.errors.push({ pool: t.pool, message: e.message });
    }
  }
  // 強制刷新指數與 etnet 成交榜（下一次讀取即為最新）
  await Promise.allSettled([
    getIndices({ force: true }).catch(() => null),
    getTopTurnover({ force: true }).catch(() => null),
  ]);
  parent.finishedAt = new Date().toISOString();
  log.info(TAG, `全部資料更新完成：${parent.done} 成功 / ${parent.errors.length} 失敗`);
  return parent;
}

/* --------------------------------- 健康檢查 ---------------------------------- */

export async function health() {
  const [t, y, e] = await Promise.all([
    tencent.ping().catch((err) => ({ ok: false, error: err.message })),
    yahoo.ping().catch((err) => ({ ok: false, error: err.message })),
    etnet.ping().catch((err) => ({ ok: false, error: err.message })),
  ]);
  return {
    providers: [
      { id: 'tencent', label: '騰訊財經', role: '即時報價／日K線／指數（主源）', ...t },
      { id: 'yahoo', label: 'Yahoo Finance', role: '長歷史K線／基本面（備援）', ...y },
      { id: 'etnet', label: 'etnet 經濟通', role: '成交二十大（交叉驗證）', ...e },
    ],
    cache: cache.size(),
    cacheStats: cache.stats,
    snapshots: listSnapshots(),
    checkedAt: new Date().toISOString(),
  };
}

export { watchlist, alias, yahoo, tencent };
