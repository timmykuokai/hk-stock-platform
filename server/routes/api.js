/**
 * api.js — REST 路由層。所有端點只做：參數驗證 → 呼叫編排層／引擎 → 組裝回應。
 */
import express from 'express';
import fs from 'node:fs';
import {
  getBars, getQuote, getFundamentals, getMetrics, getIndices, getTopTurnover,
  getSnapshot, refreshPool, refreshAll, jobs, health, getBenchmark, cache, watchlist, alias,
} from '../data/marketData.js';
import { getPool, resolveName } from '../data/universe.js';
import { METRIC_DEFS } from '../data/metrics.js';
import { screen, TEMPLATES } from '../engine/screener.js';
import { scoreAll, PRESETS, DIMENSIONS, grade } from '../engine/score.js';
import { backtest, RANKERS } from '../engine/backtest.js';
import { rules, alertLog, evaluateRule, RULE_TYPES, compact } from '../engine/alerts.js';
import { holdings, evaluate } from '../engine/portfolio.js';
import { POOL_META, INDICES as IDX_DEFS } from '../data/pools.js';
import { scanMovers, scanSignals, VIEWS as MOVER_VIEWS } from '../engine/movers.js';
import { computeIndicators } from '../engine/indicators.js';
import { getTopNews } from '../data/news.js';
import { buildVerdict } from '../engine/verdict.js';
import { buildReport } from '../engine/report.js';
import { getUsMovers, refreshUs, getUsJob } from '../engine/usMovers.js';
import { detectMarket, normalizeCode } from '../data/providers/yahoo.js';
import { US_POPULAR } from '../data/usUniverse.js';
import { analyseTenFactors, fourLayerFramework, factorSummary } from '../engine/factors.js';
import { marketProfile } from '../lib/market.js';
import { Degrade } from '../lib/degrade.js';
import log from '../lib/logger.js';

const router = express.Router();
const TAG = 'api';

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 後端簡易金額格式化（僅供 API 回傳文字用） */
function compactHKD(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)} 兆`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(0)} 億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(0)} 萬`;
  return String(Math.round(v));
}

/* --------------------------------- 系統 ---------------------------------- */

router.get('/health', asyncHandler(async (req, res) => {
  res.json(await health());
}));

/* ------------------------------ 資料新鮮度 -------------------------------- */

/** 各池最後更新時間（asOf）與新鮮度，供前端顯示「資料更新時間」 */
router.get('/freshness', (req, res) => {
  const poolsInfo = Object.keys(POOL_META).map((p) => {
    const s = getSnapshot(p);
    return {
      pool: p,
      label: POOL_META[p].label,
      asOf: s?.asOf ?? null,
      count: s?.count ?? 0,
      failed: s?.failed ?? null,
      ageMinutes: s?.ageMinutes ?? null,
      fresh: s?.fresh ?? false,
    };
  });
  const primary = poolsInfo.find((x) => x.pool === 'popular') || poolsInfo[0] || null;
  res.json({ primary, pools: poolsInfo, generatedAt: new Date().toISOString() });
});

router.get('/meta', (req, res) => {
  res.json({
    pools: Object.values(POOL_META),
    presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, weights: v.weights }])),
    dimensions: Object.fromEntries(Object.entries(DIMENSIONS).map(([k, v]) => [k, { label: v.label, metrics: v.metrics.map(([m]) => m) }])),
    metricDefs: METRIC_DEFS,
    templates: TEMPLATES,
    rankers: Object.fromEntries(Object.entries(RANKERS).map(([k, v]) => [k, v.label])),
    ruleTypes: RULE_TYPES,
    indices: IDX_DEFS,
    moverViews: MOVER_VIEWS,
    tenFactors: [
      { no: 1, key: 'industry', factor: '行業前景與政策環境' },
      { no: 2, key: 'business', factor: '公司商業模式' },
      { no: 3, key: 'financial', factor: '財務健康程度' },
      { no: 4, key: 'profitability', factor: '盈利能力與質素' },
      { no: 5, key: 'cashflow', factor: '現金流' },
      { no: 6, key: 'valuation', factor: '估值是否合理' },
      { no: 7, key: 'governance', factor: '管理層與股東結構' },
      { no: 8, key: 'dividend', factor: '股息政策' },
      { no: 9, key: 'technical', factor: '技術面與市場行為' },
      { no: 10, key: 'risk', factor: '風險因素與最壞情境' },
    ],
  });
});

/* ---------------------- 個股深度分析（十大要素 + 綜合決策） ------------------- */

/**
 * GET /api/stock/:code/analysis
 * 一次回傳：技術指標快照 + 技術面十大訊號 + 十大要素評分 + 四層框架 + 綜合決策摘要
 */
router.get('/stock/:code/analysis', asyncHandler(async (req, res) => {
  const market = detectMarket(req.params.code);
  const code = normalizeCode(req.params.code, market);
  const usMeta = market === 'us' ? US_POPULAR.find((x) => x.code === code) : null;
  const profile = marketProfile(market); // 基準指數改查市場設定表，不再散落三元判斷
  const range = req.query.range || '1y';
  const withSeries = req.query.series !== '0';
  const live = req.query.live === '1' || req.query.live === 'true';
  const dg = new Degrade(TAG);
  const [chart, fund] = await Promise.all([
    getBars(code, { range, force: live }),
    dg.run('基本面', getFundamentals(code, { withZh: true, force: live, market }), null),
  ]);
  if (!chart?.bars?.length) return res.status(404).json({ error: '查無資料' });

  const bench = await dg.run(`基準指數 ${profile.benchmark}`, getBenchmark(profile.benchmark, range, { force: live }), []);
  const { computeMetrics } = await import('../data/metrics.js');
  const { buildRisk, buildEquity, buildAttentionLite, buildRelativeStrength, buildSellLadder, buildTimeframes, detectDivergence } = await import('../engine/chartData.js');
  const { buildRegime, buildApplicability, buildTriggers } = await import('../engine/regime.js');
  const { buildFundamentalGate, buildEarningsWindow, buildPositionMatrix } = await import('../engine/fundamental.js');
  const { buildValuationBands, buildRsiValuationMatrix } = await import('../engine/valuation.js');
  const metrics = computeMetrics({ bars: chart.bars, dividends: chart.dividends, fundamentals: fund, bench });
  const indicators = computeIndicators(chart.bars, { seriesLen: withSeries ? 250 : 0 });
  if (!indicators) return res.status(400).json({ error: '歷史資料不足，無法計算技術指標（需 ≥30 根日 K）' });

  const factors = analyseTenFactors({ metrics, fundamentals: fund ?? {}, indicators });
  const verdict = buildVerdict({ metrics, fundamentals: fund ?? {}, indicators });

  // 圖表衍生資料（失敗絕不阻塞主分析響應）
  let risk = null, equity = null, heat = null, rs = null, ladder = null, timeframes = null, divergences = null;
  let regime = null, applicability = null, triggers = null;
  let fundamentalGate = null, earningsWindow = null, positionMatrix = null;
  let valuationBands = null, rsiValuation = null;
  try {
    risk = buildRisk(indicators.series, chart.bars);
    equity = buildEquity(indicators.series, bench);
    rs = buildRelativeStrength(equity);
    heat = buildAttentionLite(indicators.latest, metrics.changePercent);
    ladder = buildSellLadder(indicators.latest);
    timeframes = buildTimeframes(chart.bars);
    divergences = detectDivergence(indicators.series, { turnover20d: metrics.turnover20d });
    // P2 · 市況判定引擎 → 指標適用性路由 / 關鍵變量觸發台
    regime = buildRegime({ bars: chart.bars, bench, latest: indicators.latest });
    applicability = buildApplicability(regime?.regime);
    triggers = buildTriggers({ bars: chart.bars, latest: indicators.latest, bench });
    // P3 · 基本面引擎 → 資格 Gate / 財報窗口 / 倉位矩陣
    fundamentalGate = buildFundamentalGate(fund, metrics);
    earningsWindow = buildEarningsWindow();
    positionMatrix = buildPositionMatrix(regime?.regime);
    // P4 · 估值引擎 → PE/PB 分位帶 + RSI×估值 決策矩陣
    valuationBands = buildValuationBands(fund, chart.bars);
    const vState = valuationBands.pe?.state || valuationBands.pb?.state || 'unknown';
    rsiValuation = buildRsiValuationMatrix(indicators.latest.rsi14, vState, { primary: valuationBands.primary });
  } catch (e) {
    log.warn(TAG, '圖表衍生資料組裝失敗', e.message);
  }

  res.json({
    code,
    symbol: chart.symbol,
    name: chart.name,
    zhName: fund?.zhName || usMeta?.zh || null,
    market,
    currency: chart.currency,
    price: metrics.price,
    change: metrics.change,
    changePercent: metrics.changePercent,
    asOf: indicators.latest.date,
    source: chart.source,
    updatedAt: chart.fetchedAt,
    live: !!live,
    fetchedAt: chart.fetchedAt,
    hasFundamentals: !!fund?.marketCap,
    indicators,
    factors,
    factorSummary: factorSummary(factors),
    layers: fourLayerFramework(factors),
    verdict,
    metrics,
    risk,
    equity,
    rs,
    heat,
    ladder,
    timeframes,
    divergences,
    regime,
    applicability,
    triggers,
    fundamentalGate,
    earningsWindow,
    positionMatrix,
    valuationBands,
    rsiValuation,
    _degraded: dg.degraded ? dg.items : undefined,
  });
}));

/* ----------------- 個股詳細文字分析報告（市場現況＋熱度＋綜合評估） ----------------- */

/**
 * GET /api/stock/:code/report
 * 查詢指定股票即時股價後，產出涵蓋「市場現況、市場熱度與關注度、綜合評估（買入/觀望/回避）」
 * 的詳細文字分析報告。live=1 時強制即時抓取報價／K線／基本面／新聞。
 */
router.get('/stock/:code/report', asyncHandler(async (req, res) => {
  const market = detectMarket(req.params.code);
  const code = normalizeCode(req.params.code, market);
  const range = req.query.range || '3y';
  const live = req.query.live === '1' || req.query.live === 'true';
  const report = await buildReport(code, { range, live, market });
  if (report.error) return res.status(404).json(report);
  res.json(report);
}));

/* ------------------------------ 異動掃描 ---------------------------------- */

router.get('/movers', asyncHandler(async (req, res) => {
  const pool = req.query.pool || 'popular';
  const limit = Math.min(50, Number(req.query.limit) || 15);
  let snap = getSnapshot(pool);
  if (!snap && req.query.autoRefresh !== '0') snap = await refreshPool(pool);
  if (!snap) return res.status(404).json({ error: '尚無池快照，請先更新資料' });
  res.json({ ...scanMovers(snap.items, { limit }), pool, asOf: snap.asOf, universe: snap.count });
}));

router.get('/signals', asyncHandler(async (req, res) => {
  const pool = req.query.pool || 'popular';
  const limit = Math.min(60, Number(req.query.limit) || 20);
  const snap = getSnapshot(pool);
  if (!snap) return res.status(404).json({ error: '尚無池快照，請先更新資料' });
  res.json({ items: scanSignals(snap.items, { limit }), pool, asOf: snap.asOf });
}));

/* ----------------------- 每日穩健收息推介 ----------------------- */

/**
 * GET /api/daily-picks
 * 從熱門池篩選「穩健、低波動、每年派息」的標的，給出穩健收息評分與入選理由。
 * 入選門檻：流動性 ≥ 5,000 萬、市值 ≥ 200 億、殖利率 3%–10%、年化波動 ≤ 30%、
 * 連續派息 ≥ 3 年、本益比 0–25 倍，並排除一次性特別股息造成的異常殖利率。
 */
router.get('/daily-picks', asyncHandler(async (req, res) => {
  const pool = req.query.pool || 'popular';
  const limit = Math.min(30, Number(req.query.limit) || 20);
  let snap = getSnapshot(pool);
  if (!snap && req.query.autoRefresh !== '0') snap = await refreshPool(pool);
  if (!snap) return res.status(404).json({ error: '尚無池快照，請先更新資料' });

  const allScored = scoreAll(snap.items, 'dividend');
  const picked = allScored.filter((it) => {
    const m = it.metrics || {};
    if (!(m.turnover20d >= 5e7)) return false;                 // 流動性門檻
    if (!(m.marketCap >= 2e10)) return false;                  // 大型股較穩健
    const dy = m.dividendYieldTTM;
    if (!(dy >= 0.03 && dy <= 0.10)) return false;             // 殖利率 3%–10%（排除過高特別息）
    if (!(m.vol1y != null && m.vol1y <= 0.30)) return false;   // 年化波動 ≤ 30%
    if (!(m.dividendYears >= 3)) return false;                 // 連續派息 ≥ 3 年
    if (m.pe != null && (m.pe <= 0 || m.pe > 25)) return false; // 合理估值
    const notes = m.dividendNotes || [];
    if (notes.some((n) => /偏高|一次性|單次派息|不可持續/.test(n))) return false; // 排除異常殖利率
    return true;
  });

  const items = picked.map((it) => {
    const m = it.metrics;
    const reasons = [];
    if (m.dividendYieldTTM != null) reasons.push(`殖利率 ${(m.dividendYieldTTM * 100).toFixed(1)}%`);
    if (m.vol1y != null) reasons.push(`年化波動 ${(m.vol1y * 100).toFixed(0)}%`);
    if (m.dividendYears != null) reasons.push(`連續 ${m.dividendYears} 年派息`);
    if (m.marketCap != null) reasons.push(`市值 ${compactHKD(m.marketCap)}`);
    if (m.pe != null) reasons.push(`本益比 ${m.pe.toFixed(1)} 倍`);
    if (m.sharpe1y != null && m.sharpe1y > 0) reasons.push(`夏普 ${m.sharpe1y.toFixed(2)}`);

    // 穩健收息綜合分（0–100）：殖利率 35% + 低波動 25% + 配息穩定 20% + 平台評分 20%
    const yld = Math.min((m.dividendYieldTTM || 0) / 0.06, 1);
    const lowVol = 1 - Math.min((m.vol1y || 0.3) / 0.30, 1);
    const cons = Math.min((m.dividendYears || 0) / 10, 1);
    const plat = Math.min((it.score?.total ?? 0) / 100, 1);
    const incomeScore = Math.round((yld * 0.35 + lowVol * 0.25 + cons * 0.20 + plat * 0.20) * 100);
    return {
      code: it.code,
      name: it.zhName || it.name,
      enName: it.name,
      price: m.price,
      change: m.change,
      changePercent: m.changePercent,
      dividendYieldTTM: m.dividendYieldTTM,
      dividendYears: m.dividendYears,
      vol1y: m.vol1y,
      marketCap: m.marketCap,
      pe: m.pe,
      sharpe1y: m.sharpe1y,
      mdd1y: m.mdd1y,
      score: it.score?.total ?? null,
      incomeScore,
      reasons,
    };
  }).sort((a, b) => b.incomeScore - a.incomeScore).slice(0, limit);

  res.json({
    items,
    asOf: snap.asOf,
    pool,
    universe: snap.count,
    generatedAt: new Date().toISOString(),
    criteria: {
      turnover20d: '≥ 5,000 萬',
      marketCap: '≥ 200 億',
      dividendYieldTTM: '3%–10%',
      vol1y: '≤ 30%',
      dividendYears: '≥ 3 年',
      pe: '0–25 倍',
    },
  });
}));

/* ------------------------------ 即時新聞 ---------------------------------- */

router.get('/news', asyncHandler(async (req, res) => {
  const market = ['all', 'hk', 'us'].includes(req.query.market) ? req.query.market : 'all';
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
  const live = req.query.live === '1' || req.query.live === 'true';
  const data = await getTopNews({ market, limit, live });
  res.json(data);
}));

/* ------------------------------ 多股比較 ---------------------------------- */

const COMPARE_DEFS = [
  { key: 'price', label: '股價' },
  { key: 'changePercent', label: '日漲跌幅', fmt: 'pctRaw' },
  { key: 'turnover20d', label: '20日均成交額', fmt: 'compact' },
  { key: 'marketCap', label: '市值', fmt: 'compact' },
  { key: 'pe', label: '本益比(TTM)' },
  { key: 'pb', label: '股價淨值比' },
  { key: 'roe', label: 'ROE', fmt: 'pct' },
  { key: 'profitMargin', label: '淨利率', fmt: 'pct' },
  { key: 'revenueGrowth', label: '營收成長', fmt: 'pct' },
  { key: 'dividendYieldTTM', label: '殖利率(近12月)', fmt: 'pct' },
  { key: 'vol1y', label: '年化波動度', fmt: 'pct' },
  { key: 'ret1y', label: '一年報酬', fmt: 'pct' },
  { key: 'sharpe1y', label: '夏普值' },
  { key: 'mdd1y', label: '一年最大回撤', fmt: 'pct' },
  { key: 'rsi14', label: 'RSI(14)' },
  { key: 'atrPct', label: 'ATR 佔股價', fmt: 'pctRaw' },
  { key: 'position52w', label: '52週相對位置' },
];

router.post('/compare', asyncHandler(async (req, res) => {
  const codes = [...new Set((req.body?.codes ?? []).map((c) => normalizeCode(c, detectMarket(c))))].slice(0, 8);
  if (codes.length < 2) return res.status(400).json({ error: '請提供至少 2 檔股票' });
  const range = req.body?.range || '1y';
  const live = req.body?.live === true || req.body?.live === '1';
  // 若含美股，基準改用 S&P 500（港股母體與美股波動結構不同，混合時仍為近似；
  // 精確做法應逐檔套用各自市場基準，屬 P1 待辦，見 lib/market.js 的 marketProfile）
  const anyUs = codes.some((c) => detectMarket(c) === 'us');
  const dg = new Degrade(TAG);
  const bench = await dg.run(
    `基準指數 ${marketProfile(anyUs ? 'us' : 'hk').benchmark}`,
    getBenchmark(marketProfile(anyUs ? 'us' : 'hk').benchmark, range, { force: live }),
    [],
  );
  const { computeMetrics } = await import('../data/metrics.js');

  const rows = [];
  const failed = [];
  await Promise.all(codes.map(async (code) => {
    try {
      const chart = await getBars(code, { range, force: live });
      const fund = await dg.run(`基本面 ${code}`, getFundamentals(code, { withZh: true, force: live, market: detectMarket(code) }), null);
      const metrics = computeMetrics({ bars: chart.bars, dividends: chart.dividends, fundamentals: fund, bench });
      const indicators = computeIndicators(chart.bars, { seriesLen: 0 });
      const factors = indicators ? analyseTenFactors({ metrics, fundamentals: fund ?? {}, indicators }) : [];
      rows.push({
        code,
        name: chart.name,
        zhName: fund?.zhName ?? null,
        metrics,
        factors,
        summary: indicators ? buildVerdict({ metrics, fundamentals: fund ?? {}, indicators }) : null,
      });
    } catch (e) {
      failed.push({ code, message: e.message });
    }
  }));

  rows.sort((a, b) => (a.summary?.overall ?? 0) - (b.summary?.overall ?? 0)).reverse();
  res.json({
    codes: rows.map((r) => r.code),
    metricDefs: COMPARE_DEFS,
    rows,
    failed,
    asOf: new Date().toISOString(),
    range,
    _degraded: dg.degraded ? dg.items : undefined,
  });
}));

/* -------------------------------- 標的與池 -------------------------------- */

router.get('/pools', asyncHandler(async (req, res) => {
  const snapshots = [];
  for (const p of Object.keys(POOL_META)) {
    const s = getSnapshot(p);
    snapshots.push({ pool: p, label: POOL_META[p].label, snapshot: s ? { asOf: s.asOf, count: s.count, failed: s.failed, ageMinutes: s.ageMinutes, fresh: s.fresh } : null });
  }
  const wl = watchlist.get();
  res.json({ pools: snapshots, watchlist: wl, jobs: [...jobs.values()].slice(-5) });
}));

/** 觸發池更新（背景執行） */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { pool = 'popular', codes = [], withFundamentals = false, limit = 0, range = '3y' } = req.body || {};
  refreshPool(pool, { codes, withFundamentals, limit, range })
    .catch((e) => log.error(TAG, 'refresh 失敗', e.message));
  const job = [...jobs.values()].slice(-1)[0];
  res.json({ started: true, jobId: job?.jobId ?? null, pool, total: job?.total ?? null });
}));

router.get('/refresh/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '找不到工作' });
  res.json(job);
});

/** 立即更新所有資料（熱門池＋自選池＋可選主板，並強制刷新指數與 etnet） */
router.post('/refresh-all', asyncHandler(async (req, res) => {
  const { withFundamentals = false, includeMainboard = false, mainboardLimit = 400 } = req.body || {};
  refreshAll({ withFundamentals, includeMainboard, mainboardLimit })
    .catch((e) => log.error(TAG, 'refresh-all 失敗', e.message));
  const job = [...jobs.values()].slice(-1)[0];
  res.json({ started: true, jobId: job?.jobId ?? null, pool: 'ALL' });
}));

router.get('/snapshot', (req, res) => {
  const pool = req.query.pool || 'popular';
  const s = getSnapshot(pool);
  if (!s) return res.status(404).json({ error: '尚無快照，請先執行 /api/refresh', pool });
  res.json({ ...s, items: s.items.map(({ metrics, ...rest }) => ({ ...rest, metrics })) });
});

/* --------------------------------- 美股異動 --------------------------------- */
/**
 * GET /api/us-movers — 讀取美股成交額前 20 / 升幅前 20 / 跌幅前 20。
 * 若尚無快照回傳 status='empty'，前端應調 POST /api/us-movers/refresh 建立。
 */
router.get('/us-movers', (req, res) => {
  res.json(getUsMovers());
});

/** POST /api/us-movers/refresh — 背景重建美股快照 */
router.post('/us-movers/refresh', asyncHandler(async (req, res) => {
  const r = refreshUs();
  res.json({ started: true, ...r });
}));

/** GET /api/us-movers/job — 背景工作進度（供輪詢） */
router.get('/us-movers/job', (req, res) => {
  const job = getUsJob();
  if (!job) return res.status(404).json({ error: '無進行中的美股快照工作' });
  res.json(job);
});

/* --------------------------------- 篩選 ---------------------------------- */

router.post('/screen', asyncHandler(async (req, res) => {
  const {
    pool = 'popular', codes = [], filters = [], preset = 'balanced',
    sortBy = 'score', sortDir = 'desc', limit = 50, autoRefresh = true, withFundamentals = false,
  } = req.body || {};

  let snap = getSnapshot(pool);
  if (!snap && autoRefresh) {
    log.info(TAG, `池 ${pool} 無快照，自動建立`);
    snap = await refreshPool(pool, { codes, withFundamentals });
  }
  if (!snap) return res.status(404).json({ error: '無可用池資料' });

  const result = screen(snap.items, { filters, preset, sortBy, sortDir, limit });
  res.json({
    ...result,
    asOf: snap.asOf,
    pool,
    ageMinutes: snap.ageMinutes ?? null,
    universe: snap.count,
    failed: snap.failed,
  });
}));

/* -------------------------------- 個股詳情 -------------------------------- */

router.get('/stock/:code', asyncHandler(async (req, res) => {
  const market = detectMarket(req.params.code);
  const code = normalizeCode(req.params.code, market);
  const usMeta = market === 'us' ? US_POPULAR.find((x) => x.code === code) : null;
  const profile = marketProfile(market);
  const range = req.query.range || '3y';
  const withFundamentals = req.query.fundamentals !== '0';
  const live = req.query.live === '1' || req.query.live === 'true';
  const dg = new Degrade(TAG);
  const [chart, quote, fund, poolSnap, nameInfo] = await Promise.all([
    getBars(code, { range, force: live }),
    dg.run('即時報價', getQuote(code, { force: live }), null),
    withFundamentals
      ? dg.run('基本面', getFundamentals(code, { withZh: true, force: live, market }), null)
      : null,
    Promise.resolve(getSnapshot('popular')),
    resolveName(code),
  ]);
  if (!chart?.bars?.length) return res.status(404).json({ error: '查無資料' });

  const bench = await dg.run(
    `基準指數 ${profile.benchmark}`,
    getBenchmark(
      profile.benchmark,
      range,
      {
        force: live,
        // 「上市至今」時，基準同步從個股上市日取日線，確保 Beta 計算頻率一致
        period1: range === 'max' && chart.bars[0]?.date
          ? Math.floor(new Date(`${chart.bars[0].date}T00:00:00Z`).getTime() / 1000)
          : undefined,
      },
    ),
    [],
  );
  const { computeMetrics } = await import('../data/metrics.js');
  const metrics = computeMetrics({ bars: chart.bars, dividends: chart.dividends, fundamentals: fund, bench });

  // 評分：港股納入熱門池母體比較；美股不適用港股母體評分（跨市場比較失真），改為 null
  let scored = null;
  let presetScores = {};
  if (market === 'hk') {
    const item = { code, metrics };
    const base = (poolSnap?.items ?? []).filter((x) => x.code !== code).slice(0, 300);
    scored = scoreAll([...base, item], 'balanced').filter((x) => x.code === code).pop();

    // 各策略分數（對同一母體計算）
    for (const p of Object.keys(PRESETS)) {
      const hit = scoreAll([...base, item], p).filter((x) => x.code === code).pop();
      if (hit) presetScores[p] = hit.score.total;
    }
  }

  // K 線回傳筆數：一般區間上限 1500 根（約 6 年日 K，足以涵蓋 5 年選項）；
  // 「上市至今 (max)」則回傳全部，確保能一路顯示到該股上市日。
  const MAX_BARS = 1500;
  res.json({
    code,
    symbol: chart.symbol,
    market,
    name: chart.name || usMeta?.name || nameInfo.en,
    zhName: fund?.zhName || usMeta?.zh || nameInfo.zh || null,
    currency: chart.currency,
    quote,
    metrics,
    fundamentals: fund,
    dividends: chart.dividends,
    firstDate: chart.bars[0]?.date ?? null,
    lastDate: chart.bars[chart.bars.length - 1]?.date ?? null,
    bars: range === 'max'
      ? chart.bars
      : (() => {
          // 騰訊來源回傳全期日 K 時，依選定區間（含新增 3mo）精確截取，避免 K 線顯示全歷史
          const RANGE_DAYS = { '3mo': 92, '6mo': 183, '1y': 365, '3y': 1096, '5y': 1826 };
          const days = RANGE_DAYS[range];
          if (!days) return chart.bars.slice(-MAX_BARS);
          const last = chart.bars[chart.bars.length - 1]?.date;
          if (!last) return chart.bars.slice(-MAX_BARS);
          const cutoff = new Date(last);
          cutoff.setDate(cutoff.getDate() - days);
          const ct = cutoff.toISOString().slice(0, 10);
          const f = chart.bars.filter((b) => b.date >= ct);
          return f.length >= 2 ? f : chart.bars.slice(-MAX_BARS);
        })(),
    issues: chart.issues,
    score: scored?.score ?? null,
    grade: grade(scored?.score?.total ?? null),
    presetScores,
    source: chart.source,
    updatedAt: chart.fetchedAt,
    live: !!live,
    fetchedAt: chart.fetchedAt,
    _degraded: dg.degraded ? dg.items : undefined,
  });
}));

/* --------------------------------- 大盤 ---------------------------------- */

router.get('/market/overview', asyncHandler(async (req, res) => {
  const snap = getSnapshot('popular');
  const dg = new Degrade(TAG);
  const [indices, top] = await Promise.all([
    getIndices(),
    dg.run('etnet 成交二十大', getTopTurnover(), null),
  ]);
  const items = snap?.items ?? [];
  const advancers = items.filter((x) => (x.metrics.changePercent ?? 0) > 0).length;
  const decliners = items.filter((x) => (x.metrics.changePercent ?? 0) < 0).length;
  const byTurnover = [...items].sort((a, b) => (b.metrics.turnover20d || 0) - (a.metrics.turnover20d || 0)).slice(0, 10)
    .map((x) => ({ code: x.code, name: x.zhName || x.name, turnover: x.metrics.turnover20d, change: x.metrics.change, changePercent: x.metrics.changePercent, price: x.metrics.price, score: x.score?.total ?? null }));
  const gainers = [...items].sort((a, b) => (b.metrics.ret1m ?? -9) - (a.metrics.ret1m ?? -9)).slice(0, 10)
    .map((x) => ({ code: x.code, name: x.zhName || x.name, ret1m: x.metrics.ret1m, price: x.metrics.price, change: x.metrics.change, changePercent: x.metrics.changePercent }));
  const losers = [...items].sort((a, b) => (a.metrics.ret1m ?? 9) - (b.metrics.ret1m ?? 9)).slice(0, 10)
    .map((x) => ({ code: x.code, name: x.zhName || x.name, ret1m: x.metrics.ret1m, price: x.metrics.price, change: x.metrics.change, changePercent: x.metrics.changePercent }));
  const highYield = [...items].filter((x) => x.metrics.dividendYieldTTM).sort((a, b) => b.metrics.dividendYieldTTM - a.metrics.dividendYieldTTM).slice(0, 10)
    .map((x) => ({ code: x.code, name: x.zhName || x.name, yield: x.metrics.dividendYieldTTM, price: x.metrics.price, change: x.metrics.change, changePercent: x.metrics.changePercent }));

  res.json({
    indices,
    breadth: { advancers, decliners, unchanged: items.length - advancers - decliners, universe: items.length },
    topTurnover: byTurnover,
    gainers,
    losers,
    highYield,
    etnetTop: top?.list?.slice(0, 10) ?? [],
    etnetAsOf: top?.asOf ?? null,
    snapshotAsOf: snap?.asOf ?? null,
    _degraded: dg.degraded ? dg.items : undefined,
  });
}));

/* --------------------------------- 回測 ---------------------------------- */

router.post('/backtest', asyncHandler(async (req, res) => {
  const cfg = req.body || {};
  const pool = cfg.pool || 'popular';
  let codes = cfg.codes || [];
  if (!codes.length) {
    const snap = getSnapshot(pool);
    if (!snap) return res.status(400).json({ error: '尚無池快照，請先更新資料' });
    codes = snap.items.map((x) => x.code);
    if (cfg.universeLimit) codes = codes.slice(0, cfg.universeLimit);
  }
  const result = await backtest({ ...cfg, codes }, {
    loadBars: (code) => getBars(code, { range: cfg.range || '5y' }),
    loadBenchmark: (sym) => getBenchmark(sym, cfg.range || '5y'),
  });
  res.json(result);
}));

/* -------------------------------- 投資組合 -------------------------------- */

router.get('/portfolio', asyncHandler(async (req, res) => {
  const list = holdings.list();
  const prices = new Map();
  for (const h of [...new Set(list.map((x) => x.code))]) {
    try {
      const q = await getQuote(h);
      prices.set(h, { price: q.price, changePercent: q.changePercent, change: q.change, previousClose: q.previousClose, name: q.name });
    } catch (e) {
      log.warn(TAG, `持股 ${h} 取價失敗（該筆損益將顯示為 —）`, e.message);
      prices.set(h, {});
    }
  }
  const snap = getSnapshot('popular');
  const zh = alias.get();
  for (const [code, v] of prices) {
    const hit = snap?.items.find((x) => x.code === code);
    v.name = v.name || hit?.name || null;
    v.zhName = zh[code] || hit?.zhName || null;
  }
  // 基準報酬：以最早買入日至今的恒指報酬
  let benchReturn = null;
  if (list.length) {
    try {
      const first = list.map((x) => x.date).sort()[0];
      const bench = await getBenchmark(marketProfile('hk').benchmark, '5y');
      const bars = bench.filter((b) => b.date >= first);
      if (bars.length > 1) benchReturn = bars[bars.length - 1].close / bars[0].close - 1;
    } catch (e) {
      log.debug(TAG, '組合基準報酬計算略過', e.message);
    }
  }
  res.json(evaluate(list, (code) => prices.get(code) || {}, benchReturn));
}));

router.post('/portfolio', (req, res) => {
  try {
    res.json(holdings.add(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
router.put('/portfolio/:id', (req, res) => {
  const r = holdings.update(req.params.id, req.body || {});
  if (!r) return res.status(404).json({ error: '找不到持股' });
  res.json(r);
});
router.delete('/portfolio/:id', (req, res) => res.json({ ok: true, list: holdings.remove(req.params.id) }));

/* --------------------------------- 警報 ---------------------------------- */

router.get('/alerts', (req, res) => res.json({ rules: rules.list(), log: alertLog.list().slice(0, 60), types: RULE_TYPES }));
router.post('/alerts', (req, res) => res.json(rules.add(req.body || {})));
router.put('/alerts/:id', (req, res) => {
  const r = rules.update(req.params.id, req.body || {});
  if (!r) return res.status(404).json({ error: '找不到規則' });
  res.json(r);
});
router.delete('/alerts/:id', (req, res) => res.json({ ok: true, list: rules.remove(req.params.id) }));
router.delete('/alerts-log', (req, res) => res.json({ ok: true, log: alertLog.clear() }));

/** 執行一次警報檢查 */
router.post('/alerts/check', asyncHandler(async (req, res) => {
  const list = rules.list().filter((r) => r.enabled);
  const snap = getSnapshot('popular');
  const events = [];
  for (const rule of list) {
    let data = { metrics: null, quote: null, score: null };
    if (snap) {
      const hit = snap.items.find((x) => x.code === rule.code);
      if (hit) data = { metrics: hit.metrics, score: hit.score?.total ?? null };
    }
    if (rule.type === 'price_above' || rule.type === 'price_below' || rule.type === 'change_pct') {
      try { data.quote = await getQuote(rule.code); } catch (e) { log.debug(TAG, `警示 ${rule.code} 報價失敗`, e.message); }
    }
    if (!data.metrics && !data.quote) {
      try { data.metrics = (await getMetrics(rule.code, { range: '1y' })).metrics; } catch (e) { log.debug(TAG, `警示 ${rule.code} 指標失敗`, e.message); }
    }
    const hit = evaluateRule(rule, data);
    if (hit) {
      events.push({
        ruleId: rule.id, code: rule.code, type: rule.type,
        message: hit.message, value: hit.value, at: new Date().toISOString(),
      });
    }
  }
  const logList = alertLog.push(events);
  res.json({ checked: list.length, triggered: events.length, events, log: logList.slice(0, 60) });
}));

/* -------------------------------- 自選清單 -------------------------------- */

router.get('/watchlist', (req, res) => res.json({ codes: watchlist.get() }));
router.post('/watchlist', (req, res) => res.json({ codes: watchlist.add((req.body || {}).code) }));
router.delete('/watchlist/:code', (req, res) => res.json({ codes: watchlist.remove(req.params.code) }));

/* --------------------------------- 其他 ---------------------------------- */

router.get('/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  const { getUniverse } = await import('../data/universe.js');
  const uni = await getUniverse().catch(() => null);
  const zh = alias.get();
  const list = uni?.list ?? [];
  const hkItems = list
    .filter((s) => s.code.includes(q) || s.name.toLowerCase().includes(q.toLowerCase()) || (zh[s.code] || '').includes(q))
    .slice(0, 16)
    .map((s) => ({ code: s.code, name: s.name, zh: zh[s.code] || null, board: s.board, market: 'hk' }));
  // 美股：自行維護的熱門池（含中文名），可搜代號／英文名／中文名
  const usItems = US_POPULAR
    .filter((s) => s.code.toLowerCase().includes(q.toLowerCase()) || (s.name || '').toLowerCase().includes(q.toLowerCase()) || (s.zh || '').includes(q))
    .slice(0, 8)
    .map((s) => ({ code: s.code, name: s.name, zh: s.zh || null, board: s.tag || null, market: 'us' }));
  const items = [...hkItems, ...usItems].slice(0, 20);
  res.json({ items });
}));

router.post('/cache/clear', (req, res) => {
  const prefix = (req.body || {}).prefix || '';
  cache.clear(prefix);
  res.json({ ok: true, size: cache.size() });
});

router.get('/metrics/:code', asyncHandler(async (req, res) => {
  const market = detectMarket(req.params.code);
  const r = await getMetrics(normalizeCode(req.params.code, market), { range: req.query.range || '3y', withFundamentals: req.query.fundamentals === '1' });
  res.json(r);
}));

export default router;
export { compact };
