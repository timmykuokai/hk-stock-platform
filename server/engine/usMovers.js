/**
 * usMovers.js — 美股異動掃描引擎。
 *
 * 概念：參考 AAStocks 美股頁（https://www.aastocks.com/tc/usq/default.aspx）展示的
 * 「成交額排行 / 升幅榜 / 跌幅榜」，但資料源改用平台既定的 Yahoo Finance v8 chart，
 * 以一份自行維護的美股主流股＋ETF 池（server/data/usUniverse.js）做快照掃描。
 *
 * 計算：
 *   - 成交額（約） = 最新股價 × 當日成交量（股）
 *   - 升跌幅 = Yahoo 即時 changePercent（與港股口徑一致：紅漲綠跌）
 *
 * 設計：快照寫入 server/data/store/us-movers.json，背景重建，前端輪詢。
 */
import fs from 'node:fs';
import path from 'node:path';
import { mapLimit } from '../lib/http.js';
import log from '../lib/logger.js';
import { STORE_DIR, ensureDirs } from '../lib/paths.js';
import * as yahoo from '../data/providers/yahoo.js';
import { US_POPULAR } from '../data/usUniverse.js';

const TAG = 'us-movers';
ensureDirs();
const SNAPSHOT_FILE = path.join(STORE_DIR, 'us-movers.json');

const CONCURRENCY = 10;
const MAX_AGE_MIN = 15;
const TOP_N = 20;

/** 代號 → 中文名 對照表（供舊快照補齊 zhName） */
const ZH_MAP = new Map(US_POPULAR.map((x) => [x.code, x.zh || null]));

/** 當前背景工作（供輪詢進度） */
let currentJob = null;

function readSnapshot() {
  try {
    const s = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    const ageMin = (Date.now() - new Date(s.asOf).getTime()) / 60000;
    return { ...s, ageMinutes: Math.round(ageMin), fresh: ageMin <= MAX_AGE_MIN };
  } catch (e) {
    // 尚未建立快照／檔案損壞皆為可預期狀態（前端會引導重建），僅 debug 留痕
    log.debug(TAG, '讀取美股快照失敗（尚未建立或檔案損壞）', e.message);
    return null;
  }
}

function rank(items, key, desc) {
  return [...items]
    .filter((x) => x[key] != null && Number.isFinite(x[key]))
    .sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key]))
    .slice(0, TOP_N)
    .map((x, i) => ({ rank: i + 1, ...x }));
}

/** 為榜單項目補齊中文名（舊快照若缺 zhName，從 universe 對照表取） */
function withZh(x) {
  if (x.zhName) return x;
  const zh = ZH_MAP.get(x.code);
  return zh ? { ...x, zhName: zh } : x;
}

/**
 * 建立／重建美股快照（背景執行）。
 * @returns {Promise<object>} 快照
 */
export async function buildUsSnapshot() {
  const jobId = `us:${Date.now()}`;
  const job = {
    jobId, pool: 'us-popular', total: US_POPULAR.length, done: 0, errors: 0,
    startedAt: new Date().toISOString(), finishedAt: null,
  };
  currentJob = job;

  // 重建前先移除舊快照，避免前端讀到陳舊榜單（檔案不存在屬正常，僅 debug 留痕）
  try { fs.unlinkSync(SNAPSHOT_FILE); } catch (e) { log.debug(TAG, '舊美股快照不存在，無需刪除', e.message); }

  const results = [];
  await mapLimit(US_POPULAR, CONCURRENCY, async (item) => {
    try {
      const q = await yahoo.fetchQuote(item.code);
      if (!q || q.price == null) {
        job.errors++;
        return;
      }
      const volume = q.volume ?? null;
      const turnover = (q.price != null && volume != null && volume > 0) ? q.price * volume : null;
      results.push({
        code: item.code,
        name: q.name || item.name || item.code,
        zhName: item.zh || null,
        tag: item.tag || null,
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
        volume,
        turnover,
        currency: q.currency || 'USD',
        marketTime: q.marketTime || null,
      });
    } catch (e) {
      job.errors++;
      log.warn(TAG, `美股 ${item.code} 取數失敗`, e.message);
    } finally {
      job.done++;
    }
  });

  job.finishedAt = new Date().toISOString();
  const snapshot = {
    pool: 'us-popular',
    asOf: job.finishedAt,
    count: results.length,
    failed: job.errors,
    universe: US_POPULAR.length,
    items: results,
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot));
  log.info(TAG, `美股池更新完成：${results.length} 成功 / ${job.errors} 失敗`);
  return snapshot;
}

/**
 * 讀取美股異動榜。
 * 若尚無快照，回傳 status='empty'，前端應觸發 /api/us-movers/refresh。
 */
export function getUsMovers() {
  const snap = readSnapshot();
  if (!snap) {
    return { status: 'empty', message: '尚未建立美股快照，請按「更新資料」後重試。' };
  }
  return {
    status: 'ok',
    asOf: snap.asOf,
    ageMinutes: snap.ageMinutes,
    fresh: snap.fresh,
    count: snap.count,
    universe: snap.universe,
    failed: snap.failed,
    gainers: rank(snap.items, 'changePercent', true).map(withZh),
    losers: rank(snap.items, 'changePercent', false).map(withZh),
    turnover: rank(snap.items, 'turnover', true).map(withZh),
  };
}

/** 觸發背景重建，回傳 jobId 供輪詢 */
export function refreshUs() {
  const jobId = `us:${Date.now()}`;
  // 立即啟動背景重建（不阻塞請求）
  buildUsSnapshot()
    .catch((e) => { log.error(TAG, '美股快照重建失敗', e.message); if (currentJob) currentJob.error = e.message; });
  return { jobId, status: 'building', total: US_POPULAR.length };
}

/** 查詢背景工作進度 */
export function getUsJob() {
  if (!currentJob) return null;
  return {
    jobId: currentJob.jobId,
    done: currentJob.done,
    total: currentJob.total,
    errors: currentJob.errors,
    finishedAt: currentJob.finishedAt,
    error: currentJob.error || null,
  };
}

export default { buildUsSnapshot, getUsMovers, refreshUs, getUsJob };
