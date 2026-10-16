/**
 * backtest.js — 自訂策略回測引擎。
 *
 * 流程：
 *  1. 載入候選池與基準的日 K（含股息）
 *  2. 以基準交易日為行事曆，建立 date→index 對照
 *  3. 於每個再平衡日（月／季／週／買入持有）用「當下可見」的資料計算排名指標
 *  4. 取前 N 名等權（或波動倒數加權）持有至下次再平衡，扣交易成本
 *  5. 產出淨值曲線、績效指標與每次再平衡的持股明細
 * 注意：所有指標只用「再平衡日當天之前」的資料，避免前視偏誤（look-ahead bias）。
 */
import { annualVol, maxDrawdown, mean, stdev, dailyReturns } from '../lib/stats.js';
import { scoreAll } from './score.js';
import log from '../lib/logger.js';
import { PublicError } from '../lib/errors.js';

const RANKERS = {
  momentum60: { label: '60日動能', fn: (m) => m.ret60 },
  momentum120: { label: '120日動能', fn: (m) => m.ret120 },
  lowvol: { label: '低波動（60日）', fn: (m) => (m.vol60 == null ? null : -m.vol60) },
  sharpe: { label: '夏普值（252日）', fn: (m) => m.sharpe },
  dividendYield: { label: '殖利率（近12月）', fn: (m) => m.divYield },
  composite: { label: '綜合（動能+低波動+殖利率）', fn: (m) => m.composite },
  quality: { label: '品質（ROE+淨利率）', fn: (m) => m.quality },
};

/** 於指定日期截止的資料上計算追蹤指標 */
function trailingMetrics(series, idx, dividends) {
  const { closes, amounts, volumes, dates } = series;
  const price = closes[idx];
  if (!(price > 0)) return null;
  const at = (k) => (idx - k >= 0 ? closes[idx - k] : null);
  const ret = (k) => (at(k) ? price / at(k) - 1 : null);

  // 60 日年化波動
  const win = closes.slice(Math.max(0, idx - 60), idx + 1);
  const r = dailyReturns(win);
  const vol60 = r.length > 10 ? stdev(r) * Math.sqrt(252) : null;

  const w252 = closes.slice(Math.max(0, idx - 252), idx + 1);
  const r252 = dailyReturns(w252);
  const vol252 = r252.length > 30 ? stdev(r252) * Math.sqrt(252) : null;
  const sharpe = vol252 ? (mean(r252) * 252 - 0.02) / vol252 : null;

  // 近 20 日均成交額
  const amt = amounts.slice(Math.max(0, idx - 20), idx + 1).filter((x) => x > 0);
  const turnover20 = amt.length ? amt.reduce((a, b) => a + b, 0) / amt.length : null;

  // 近 12 個月現金股利
  const cur = dates[idx];
  const cut = shiftYear(cur, -1);
  let div = 0;
  for (const d of dividends) if (d.date > cut && d.date <= cur) div += d.amount;
  const divYield = div > 0 ? div / price : 0;

  // 年線
  const ma200 = idx >= 200 ? mean(closes.slice(idx - 199, idx + 1)) : null;

  const ret60 = ret(60);
  const ret120 = ret(120);
  const composite =
    (ret60 != null ? norm(ret60, -0.3, 0.3) : 0.5) * 0.4 +
    (vol60 != null ? 1 - norm(vol60, 0.1, 0.8) : 0.5) * 0.35 +
    norm(divYield, 0, 0.08) * 0.25;

  return {
    price, ret60, ret120, vol60, vol252, sharpe, turnover20, divYield, ma200,
    aboveMa200: ma200 != null ? price > ma200 : null,
    composite,
    quality: null,
  };
}

const norm = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
const shiftYear = (d, n) => {
  const dt = new Date(d);
  dt.setFullYear(dt.getFullYear() + n);
  return dt.toISOString().slice(0, 10);
};

/**
 * @param {object} cfg 策略設定
 * @param {{loadBars:Function, loadBenchmark:Function}} io 資料載入器（由 route 注入，利於測試）
 */
export async function backtest(cfg, io) {
  const {
    codes = [],
    start = '2021-01-01',
    end = new Date().toISOString().slice(0, 10),
    rebalance = 'monthly',
    rankBy = 'momentum60',
    topN = 10,
    filters = {},
    costBps = 15,
    weightMode = 'equal',
    benchSymbol = '^HSI',
  } = cfg;

  const ranker = RANKERS[rankBy] ?? RANKERS.momentum60;

  // 1. 載入資料
  const raw = await Promise.all(
    codes.map(async (code) => {
      try {
        const chart = await io.loadBars(code);
        return { code, chart };
      } catch (e) {
        // 單檔取數失敗不中斷回測，但必須留痕（過去空 catch 讓失敗標的無聲消失）
        log.debug('backtest', `候選 ${code} K 線載入失敗，已排除`, e.message);
        return null;
      }
    })
  );
  const universe = raw.filter(Boolean);
  if (!universe.length) throw new Error('候選池無可用資料');

  const benchRaw = await io.loadBenchmark(benchSymbol).catch(() => null);
  const benchBars = Array.isArray(benchRaw) ? benchRaw : (benchRaw?.bars ?? []);
  if (!benchBars.length) throw new Error('基準指數資料載入失敗');

  // 2. 行事曆（以基準交易日為準，且落在回測區間）
  const calendar = benchBars.filter((b) => b.date >= start && b.date <= end).map((b) => b.date);
  if (calendar.length < 60) throw new PublicError('回測區間過短（需 ≥60 個交易日）');
  const dateIdx = new Map(calendar.map((d, i) => [d, i]));
  void dateIdx;

  // 3. 每檔對齊到行事曆（前值填補）
  const series = new Map();
  for (const { code, chart } of universe) {
    const map = new Map(chart.bars.map((b) => [b.date, b]));
    const closes = [];
    const amounts = [];
    const volumes = [];
    let last = null;
    let valid = false;
    for (const d of calendar) {
      const b = map.get(d) || last;
      if (!b) { closes.push(NaN); amounts.push(0); volumes.push(0); continue; }
      last = b;
      closes.push(b.close);
      amounts.push(b.amount != null ? b.amount : b.close * b.volume);
      volumes.push(b.volume);
      valid = true;
    }
    if (!valid) continue;
    series.set(code, { closes, amounts, volumes, dates: calendar, dividends: chart.dividends || [] });
  }

  // 4. 再平衡日
  const rebDates = pickRebalanceDates(calendar, rebalance);

  // 5. 模擬
  const benchCloses = benchBars.filter((b) => b.date >= start && b.date <= end).map((b) => b.close);
  const equity = [100];
  const benchEquity = [100];
  const dailyRet = [];
  const holdingsLog = [];
  let holdings = new Map(); // code -> weight
  let nextReb = 0;
  let turnoverTotal = 0;
  const costRate = costBps / 10000;

  const runRebalance = (i) => {
    const cands = [];
    for (const [code, s] of series) {
      const m = trailingMetrics(s, i, s.dividends);
      if (!m) continue;
      if (filters.minTurnover && !(m.turnover20 >= filters.minTurnover)) continue;
      if (filters.maxVol && !(m.vol60 != null && m.vol60 <= filters.maxVol)) continue;
      if (filters.minYield && !(m.divYield >= filters.minYield)) continue;
      if (filters.aboveMa200 && !m.aboveMa200) continue;
      if (filters.minPrice && !(m.price >= filters.minPrice)) continue;
      const k = ranker.fn(m);
      if (k == null || !Number.isFinite(k)) continue;
      cands.push({ code, key: k, m });
    }
    cands.sort((a, b) => b.key - a.key);
    const picked = cands.slice(0, topN);
    const w = new Map();
    if (weightMode === 'inverseVol') {
      let inv = 0;
      for (const p of picked) {
        const v = Math.max(p.m.vol60 ?? 0.3, 0.05);
        p.inv = 1 / v;
        inv += p.inv;
      }
      for (const p of picked) w.set(p.code, p.inv / inv);
    } else {
      for (const p of picked) w.set(p.code, 1 / picked.length);
    }
    // 週轉率（買賣各計一次變動）
    let turnover = 0;
    for (const [c, ww] of w) turnover += Math.abs(ww - (holdings.get(c) ?? 0));
    for (const [c, ww] of holdings) if (!w.has(c)) turnover += ww;
    turnoverTotal += turnover;
    holdings = w;
    holdingsLog.push({
      date: calendar[i],
      count: picked.length,
      codes: picked.map((p) => p.code),
      weights: Object.fromEntries([...w].map(([c, x]) => [c, Math.round(x * 10000) / 10000])),
      metrics: picked.map((p) => ({ code: p.code, rankKey: Math.round(p.key * 10000) / 10000, ...roundM(p.m) })),
    });
    return turnover * costRate;
  };

  let pendingCost = 0;
  for (let i = 1; i < calendar.length; i++) {
    if (nextReb < rebDates.length && rebDates[nextReb] === i) {
      pendingCost = runRebalance(i - 1 >= 0 ? i - 1 : i);
      nextReb++;
    }
    let r = 0;
    if (holdings.size) {
      for (const [code, w] of holdings) {
        const s = series.get(code);
        if (!s) continue;
        const prev = s.closes[i - 1];
        const cur = s.closes[i];
        if (Number.isFinite(prev) && Number.isFinite(cur) && prev > 0) r += w * (cur / prev - 1);
      }
    }
    r -= pendingCost;
    pendingCost = 0;
    dailyRet.push(r);
    equity.push(equity[equity.length - 1] * (1 + r));
    const bp = benchCloses[i - 1];
    const bc = benchCloses[i];
    benchEquity.push(benchEquity[benchEquity.length - 1] * (Number.isFinite(bp) && bp > 0 ? bc / bp : 1));
  }

  // 6. 績效
  const stats = summarize(equity, benchEquity, calendar, dailyRet);
  return {
    config: { start, end, rebalance, rankBy: rankBy, rankerLabel: ranker.label, topN, filters, costBps, weightMode, benchSymbol, universeSize: series.size },
    equity: downsample(equity, calendar),
    benchmark: downsample(benchEquity, calendar),
    stats,
    rebalances: holdingsLog,
    annualTurnover: holdingsLog.length ? turnoverTotal / ((calendar.length / 252) || 1) : 0,
  };
}

function roundM(m) {
  return {
    price: m.price, ret60: r4(m.ret60), vol60: r4(m.vol60), divYield: r4(m.divYield),
    turnover20: Math.round(m.turnover20 || 0),
  };
}
const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

function pickRebalanceDates(calendar, mode) {
  const out = [];
  if (mode === 'buyhold') return [0];
  for (let i = 1; i < calendar.length; i++) {
    const prev = calendar[i - 1];
    const cur = calendar[i];
    if (mode === 'monthly' && cur.slice(0, 7) !== prev.slice(0, 7)) out.push(i);
    if (mode === 'weekly') {
      const w1 = weekOf(prev);
      const w2 = weekOf(cur);
      if (w2 !== w1) out.push(i);
    }
    if (mode === 'quarterly') {
      const q1 = `${prev.slice(0, 4)}-${Math.floor((+prev.slice(5, 7) - 1) / 3)}`;
      const q2 = `${cur.slice(0, 4)}-${Math.floor((+cur.slice(5, 7) - 1) / 3)}`;
      if (q1 !== q2) out.push(i);
    }
  }
  if (!out.length) out.push(0);
  return out;
}

function weekOf(d) {
  const dt = new Date(d);
  const t = new Date(dt.valueOf());
  const day = (dt.getDay() + 6) % 7;
  t.setDate(t.getDate() - day);
  return t.toISOString().slice(0, 10);
}

function summarize(equity, benchEquity, calendar, dailyRet) {
  const n = equity.length;
  const years = (n - 1) / 252;
  const total = equity[n - 1] / equity[0] - 1;
  const benchTotal = benchEquity[n - 1] / benchEquity[0] - 1;
  const cagr = (equity[n - 1] / equity[0]) ** (1 / years) - 1;
  const benchCagr = (benchEquity[n - 1] / benchEquity[0]) ** (1 / years) - 1;
  const vol = annualVol(dailyRet);
  const sharpe = vol ? (mean(dailyRet) * 252 - 0.02) / vol : null;
  const mdd = maxDrawdown(equity).mdd;
  const benchMdd = maxDrawdown(benchEquity).mdd;

  // 月度勝率與年度報酬
  const byMonth = new Map();
  for (let i = 0; i < n; i++) byMonth.set(calendar[i]?.slice(0, 7) ?? '', equity[i]);
  const months = [...byMonth.entries()];
  let win = 0;
  for (let i = 1; i < months.length; i++) if (months[i][1] >= months[i - 1][1]) win++;
  const monthlyWin = months.length > 1 ? win / (months.length - 1) : null;

  const byYear = new Map();
  for (let i = 0; i < n; i++) byYear.set(calendar[i]?.slice(0, 4) ?? '', equity[i]);
  const yearsList = [...byYear.entries()];
  const yearly = [];
  for (let i = 1; i < yearsList.length; i++) {
    yearly.push({ year: yearsList[i][0], ret: yearsList[i][1] / yearsList[i - 1][1] - 1 });
  }
  if (yearsList.length) yearly.unshift({ year: yearsList[0][0], ret: yearsList[0][1] / 100 - 1 });

  // 相對基準的超額
  const excess = [];
  for (let i = 0; i < n; i++) excess.push(equity[i] / benchEquity[i]);

  return {
    totalReturn: total,
    benchTotalReturn: benchTotal,
    cagr,
    benchCagr,
    excessReturn: total - benchTotal,
    volatility: vol,
    sharpe,
    maxDrawdown: mdd,
    benchMaxDrawdown: benchMdd,
    calmar: mdd ? cagr / Math.abs(mdd) : null,
    monthlyWinRate: monthlyWin,
    yearly,
    finalEquity: equity[n - 1],
    benchFinalEquity: benchEquity[n - 1],
    days: n,
    years,
  };
}

function downsample(arr, calendar) {
  const step = Math.max(1, Math.ceil(arr.length / 800));
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push({ date: calendar[i] ?? null, v: Math.round(arr[i] * 100) / 100 });
  if (out[out.length - 1]?.date !== calendar[calendar.length - 1]) {
    out.push({ date: calendar[calendar.length - 1], v: Math.round(arr[arr.length - 1] * 100) / 100 });
  }
  return out;
}

export { RANKERS };
export default { backtest, RANKERS };
