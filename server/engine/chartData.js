/**
 * chartData.js — 組裝前端圖表所需的衍生序列（純函數，無副作用）。
 *
 * 把後端已算好的指標序列，轉成前端圖表可直接消費的結構：
 *   buildRisk      → 回撤 / 日收益分佈 / 月度漲跌
 *   buildEquity    → 個股 vs 基準 淨值疊加（日期內連接對齊、首雙有效點歸一）
 *   buildAttentionLite → 關注度 / 資金流向（輕量版，不抓新聞）
 */
import { drawdownSeries, dailyReturns, monthlyReturns, sma } from '../lib/stats.js';

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** 風險 / 報酬分佈圖資料 */
export function buildRisk(series, bars) {
  const close = (series && series.close) || [];
  const dates = (series && series.dates) || [];
  if (!close.length) return { drawdown: { dates: [], values: [] }, dailyReturns: { dates: [], values: [] }, monthly: { labels: [], returns: [] } };
  const dd = drawdownSeries(close);
  const dr = dailyReturns(close);
  const monthly = monthlyReturns(bars || []);
  return {
    drawdown: { dates: dates.slice(), values: dd },
    dailyReturns: { dates: dates.slice(1), values: dr },
    monthly: {
      labels: (monthly.labels || []).slice(-36),
      returns: (monthly.returns || []).slice(-36),
    },
  };
}

/** 個股 vs 基準 淨值疊加（皆歸一為首個雙有效點 = 100） */
export function buildEquity(series, bench) {
  const dates = (series && series.dates) || [];
  const close = (series && series.close) || [];
  if (!dates.length || !close.length) return null;
  const bMap = new Map();
  (bench || []).forEach((b) => { if (b && b.date != null) bMap.set(b.date, b.close); });
  const benchV = dates.map((d) => {
    const c = bMap.get(d);
    return c != null && c > 0 ? c : null;
  });
  let base = -1;
  for (let i = 0; i < dates.length; i++) {
    if (close[i] != null && close[i] > 0 && benchV[i] != null) { base = i; break; }
  }
  if (base < 0) return null;
  const stock = close.map((c, i) => (c != null && c > 0 ? (c / close[base]) * 100 : null));
  const benchS = benchV.map((c, i) => (c != null ? (c / benchV[base]) * 100 : null));
  return { dates, stock, benchmark: benchS };
}

/**
 * 相對強弱線（RS Line）：個股 ÷ 基準 的淨值比，重新基準化為首點 = 100。
 * >100 代表個股同期跑贏大盤，<100 則落後——選股核心指標（如 IBD RS）。
 * @param {{dates:string[], stock:number[], benchmark:number[]}} equity buildEquity 輸出
 */
export function buildRelativeStrength(equity) {
  if (!equity || !equity.stock || !equity.benchmark || !equity.dates) return null;
  const { dates, stock, benchmark } = equity;
  const raw = dates.map((_, i) => (stock[i] != null && benchmark[i] != null && benchmark[i] > 0 ? stock[i] / benchmark[i] : null));
  let base = -1;
  for (let i = 0; i < raw.length; i++) { if (raw[i] != null) { base = i; break; } }
  if (base < 0) return null;
  const baseV = raw[base];
  const rs = raw.map((v) => (v != null ? (v / baseV) * 100 : null));
  return { dates, rs };
}

/**
 * 輕量關注度 / 資金流向（不抓新聞，避免拖慢分析接口）。
 * @param {{volRatio?:number,obv?:number,obvMa20?:number,mfi14?:number}} latest 指標最新快照
 * @param {number} [changePercent] 當日漲跌幅（來自 metrics）
 */
export function buildAttentionLite(latest, changePercent) {
  if (!latest) return null;
  const volRatio = latest.volRatio ?? 1;
  const chg = Math.abs(changePercent ?? 0);
  // 關注度：量能比（最高 40）+ 漲跌幅絕對值（最高 60）
  const attentionScore = Math.max(0, Math.min(100, Math.round(Math.min(40, (volRatio - 1) * 25) + Math.min(60, chg * 3))));
  const attentionLevel = attentionScore >= 70 ? '高' : attentionScore >= 40 ? '中' : '低';

  let direction = 'neutral';
  let tone = 'flat';
  if (latest.obv != null && latest.obvMa20 != null && latest.obvMa20 !== 0) {
    const ratio = latest.obv / latest.obvMa20;
    if (ratio > 1.02) { direction = 'inflow'; tone = 'up'; }
    else if (ratio < 0.98) { direction = 'outflow'; tone = 'down'; }
  }
  if (direction === 'neutral' && latest.mfi14 != null) {
    if (latest.mfi14 > 55) { direction = 'inflow'; tone = 'up'; }
    else if (latest.mfi14 < 45) { direction = 'outflow'; tone = 'down'; }
  }
  return { attentionScore, attentionLevel, capitalFlow: { direction, tone } };
}

/* ------------------------------ P1 · 賣出紀律階梯 ------------------------------ */

/**
 * 賣出紀律階梯（5/10/20/60 日線）：把「價格相對各條均線的位置」轉成出場計畫。
 * 文件邏輯：收破 5 日減半、破 10 日續減、破 20 日清波段倉、破 60 日全面退場。
 * @param {{close:number,ma5?:number,ma10?:number,ma20?:number,ma60?:number}} latest 指標最新快照
 */
export function buildSellLadder(latest) {
  if (!latest || latest.close == null) return null;
  const px = latest.close;
  const defs = [
    { period: 5,  ma: latest.ma5,  action: '減半（降為半倉）' },
    { period: 10, ma: latest.ma10, action: '續減（再降一截）' },
    { period: 20, ma: latest.ma20, action: '清波段倉（離場觀望）' },
    { period: 60, ma: latest.ma60, action: '全面退場（長線已破）' },
  ];
  const steps = defs.map((d) => {
    const below = d.ma != null && px < d.ma;
    const diffPct = d.ma != null ? (px / d.ma - 1) * 100 : null;
    return { ...d, below, diffPct, intact: d.ma != null && !below };
  });
  // 狀態：從最短均線向上判斷，第一條被跌破的決定階梯層級
  let status = 'holding', statusLabel = '持有（滿倉）';
  let statusNote = '股價站穩全部均線之上，多頭排列未破，按原計畫持有。';
  if (steps[0].below && !steps[1].below) {
    status = 'trim1'; statusLabel = '減半'; statusNote = '已跌破 MA5，短期轉弱，先減半觀察。';
  } else if (steps[1].below && !steps[2].below) {
    status = 'trim2'; statusLabel = '續減'; statusNote = '已跌破 MA10，順勢再降一截部位。';
  } else if (steps[2].below && !steps[3].below) {
    status = 'exit_swing'; statusLabel = '清波段倉'; statusNote = '已跌破 MA20（月線），波段多單應離場。';
  } else if (steps[3].below) {
    status = 'full_exit'; statusLabel = '全面退場'; statusNote = '已跌破 MA60（季線），長線趨勢轉弱，全面退場。';
  }
  return { price: px, steps, status, statusLabel, statusNote };
}

/* ------------------------------ P1 · 多級別環境層 ------------------------------ */

/** 把日 K 聚合成週線 / 月線（依本地日期分組，避免 UTC 時區偏移） */
function aggregateBars(bars, period) {
  const groups = new Map();
  for (const b of bars) {
    const [Y, M, D] = b.date.split('-').map(Number);
    const dt = new Date(Y, M - 1, D);
    let key;
    if (period === 'week') {
      const day = (dt.getDay() + 6) % 7; // 0 = 週一
      const monday = new Date(dt); monday.setDate(dt.getDate() - day);
      key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    } else {
      key = `${Y}-${String(M).padStart(2, '0')}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const out = [];
  for (const g of groups.values()) {
    const sorted = g.slice().sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      date: sorted[sorted.length - 1].date,
      open: sorted[0].open,
      high: Math.max(...sorted.map((x) => x.high)),
      low: Math.min(...sorted.map((x) => x.low)),
      close: sorted[sorted.length - 1].close,
      volume: sorted.reduce((s, x) => s + (x.volume || 0), 0),
    });
  }
  return out;
}

/** 對一組 OHLC 計算環境狀態（多頭 / 空頭 / 盤整） */
function timeframeState(agg, slopePeriod) {
  const closes = agg.map((b) => b.close);
  const n = closes.length;
  if (n < 20) return null;
  const ma20 = sma(closes, 20);
  const ma60 = n >= 60 ? sma(closes, 60) : null;
  const last = n - 1;
  const close = closes[last];
  const m20 = ma20[last];
  const m20Prev = ma20[Math.max(0, last - slopePeriod)];
  if (m20 == null || close == null || m20Prev == null) return null;
  const rising = m20 >= m20Prev;
  let state = 'range', label = '盤整';
  if (close > m20 && rising) { state = 'bull'; label = '多頭'; }
  else if (close < m20 && !rising) { state = 'bear'; label = '空頭'; }
  const slope = m20Prev ? ((m20 / m20Prev - 1) * 100) : null;
  const changePct = closes.length > 1 ? (close / closes[0] - 1) * 100 : null;
  return {
    close,
    ma20: r2(m20),
    ma60: ma60 ? r2(ma60[last]) : null,
    slope: slope != null ? Math.round(slope * 100) / 100 : null,
    changePct: changePct != null ? Math.round(changePct * 100) / 100 : null,
    state, label,
  };
}

/**
 * 多級別環境層：日 / 週 / 月 三級趨勢狀態 + 級別差提示。
 * 文件核心洞見：日線背離兌現不代表中期反轉，要看週線環境層。
 * @param {Array<{date,open,high,low,close,volume}>} bars 日 K（建議 ≥ 1 年）
 */
export function buildTimeframes(bars) {
  if (!bars || bars.length < 60) return null;
  const wk = aggregateBars(bars, 'week');
  const mo = aggregateBars(bars, 'month');
  const day = timeframeState(bars, 20);
  const week = timeframeState(wk, 8);
  const month = timeframeState(mo, 6);
  if (!day && !week && !month) return null;
  const spark = (arr, n) => (arr ? arr.slice(-n).map((b) => b.close) : []);
  const dayTf = day ? { ...day, tf: '日', spark: spark(bars, 60) } : null;
  const weekTf = week ? { ...week, tf: '週', spark: spark(wk, 52) } : null;
  const monthTf = month ? { ...month, tf: '月', spark: spark(mo, 36) } : null;
  const states = [dayTf, weekTf, monthTf].filter(Boolean).map((t) => t.state);
  const bull = states.filter((s) => s === 'bull').length;
  const bear = states.filter((s) => s === 'bear').length;
  let summary, bias;
  if (bull === states.length && states.length) { summary = '三級多頭共振（日／週／月同步多頭，趨勢最強）'; bias = 'bull'; }
  else if (bear === states.length && states.length) { summary = '三級空頭共振（日／週／月同步空頭，避險為上）'; bias = 'bear'; }
  else if (new Set(states).size > 1) { summary = '級別差：各級方向不一致，短線訊號不等於中期反轉（以週／月線為主）'; bias = bull > bear ? 'bull' : bear > bull ? 'bear' : 'flat'; }
  else { summary = '三級方向一致，但目前處盤整（均線走平、價格未脫離糾結區）'; bias = 'flat'; }
  return { day: dayTf, week: weekTf, month: monthTf, summary, bias, mismatch: new Set(states).size > 1 };
}

/* ------------------------------ P1 · OBV × 價格背離 ------------------------------ */

/**
 * OBV × 價格 背離自動偵測。
 *  - 空頭背離（bearish）：價格創高但 OBV 未創高 → 量能撤退，漲勢虛。
 *  - 多頭背離（bullish）：價格創低但 OBV 未創低 → 量能進場，底部醞釀。
 * 報告提醒：僅對日均成交額億元級標的適用（中小票 OBV 易被單筆大單扭曲）。
 * @param {{dates:string[],close:number[],obv:number[]}} series 後端已算序列
 * @param {{turnover20d?:number}} [opts] turnover20d 為 20 日均成交額（HKD），用於流動性閘門
 */
export function detectDivergence(series, opts = {}) {
  const close = (series && series.close) || [];
  const obv = (series && series.obv) || [];
  const dates = (series && series.dates) || [];
  const turnover20d = opts.turnover20d;
  const liquidEnough = turnover20d == null ? true : turnover20d >= 1e8;
  if (close.length < 60) return { liquidEnough, divergences: [], summary: '資料不足以偵測背離' };
  const W = 10; // 峰谷判斷窗口
  const pivots = [];
  for (let i = W; i < close.length - W; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - W; j <= i + W; j++) {
      if (j === i) continue;
      if (close[j] > close[i]) isHigh = false;
      if (close[j] < close[i]) isLow = false;
    }
    if (isHigh) pivots.push({ i, type: 'high' });
    else if (isLow) pivots.push({ i, type: 'low' });
  }
  const found = [];
  // 同型態樞軸兩兩比較（高低點各自成列，避免中間異型樞軸漏接）
  const highs = pivots.filter((p) => p.type === 'high');
  const lows = pivots.filter((p) => p.type === 'low');
  const scan = (list, type) => {
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1], b = list[k];
      const priceA = close[a.i], priceB = close[b.i];
      const obvA = obv[a.i], obvB = obv[b.i];
      if (obvA == null || obvB == null) continue;
      if (type === 'high' && priceB > priceA && obvB < obvA) {
        found.push({ type: 'bearish', date0: dates[a.i], date1: dates[b.i], price0: r2(priceA), price1: r2(priceB) });
      } else if (type === 'low' && priceB < priceA && obvB > obvA) {
        found.push({ type: 'bullish', date0: dates[a.i], date1: dates[b.i], price0: r2(priceA), price1: r2(priceB) });
      }
    }
  };
  scan(highs, 'high');
  scan(lows, 'low');
  const divergences = found.slice(-4).map((d) => ({
    ...d,
    label: d.type === 'bearish' ? '量退背離' : '底背離',
  }));
  const summary = liquidEnough
    ? (divergences.length ? `偵測到 ${divergences.length} 處量價背離（見下方與 OBV 圖標記）` : '近一年未發現明確量價背離')
    : '成交額偏低，OBV 背離參考性弱（中小票易受單筆大單扭曲）';
  return { liquidEnough, divergences, summary };
}
