/**
 * stats.js — 技術／風險指標純函數庫（無副作用，便於單元測試）。
 * 所有函式輸入皆為 number[]（由外部先做資料驗證）。
 */

export const TRADING_DAYS = 252;

/** 簡單移動平均 */
export function sma(arr, period) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指數移動平均 */
export function ema(arr, period) {
  const k = 2 / (period + 1);
  const out = new Array(arr.length).fill(null);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    prev = prev === null ? arr[i] : arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 日報酬率序列（長度 n-1） */
export function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) r.push(closes[i] / prev - 1);
  }
  return r;
}

/** 平均數 */
export function mean(a) {
  if (!a.length) return 0;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

/** 標準差（樣本） */
export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}

/** 年化波動度 */
export function annualVol(returns, periods = TRADING_DAYS) {
  if (returns.length < 5) return null;
  return stdev(returns) * Math.sqrt(periods);
}

/** 年化報酬（CAGR，依實際交易日估算年數） */
export function annualReturn(closes, periods = TRADING_DAYS) {
  if (closes.length < 2 || closes[0] <= 0) return null;
  const years = (closes.length - 1) / periods;
  if (years <= 0) return null;
  return (closes[closes.length - 1] / closes[0]) ** (1 / years) - 1;
}

/** 夏普值（rf 為年化無風險利率） */
export function sharpe(returns, rf = 0.02, periods = TRADING_DAYS) {
  const vol = annualVol(returns, periods);
  if (!vol) return null;
  const ar = annualReturn([1, ...returns.map((r, i) => (i === 0 ? 1 + r : 0))], periods); // 佔位，避免誤用
  void ar;
  const avgDaily = mean(returns);
  const excess = avgDaily * periods - rf;
  return excess / vol;
}

/** 最大回撤（回傳負值比例） */
export function maxDrawdown(closes) {
  let peak = closes[0] ?? 0;
  let mdd = 0;
  let peakIdx = 0;
  let troughIdx = 0;
  let curPeakIdx = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) { peak = closes[i]; curPeakIdx = i; }
    const dd = closes[i] / peak - 1;
    if (dd < mdd) { mdd = dd; peakIdx = curPeakIdx; troughIdx = i; }
  }
  return { mdd, peakIdx, troughIdx };
}

/** 回撤序列（用於繪圖） */
export function drawdownSeries(closes) {
  let peak = closes[0] ?? 0;
  return closes.map((c) => {
    if (c > peak) peak = c;
    return peak > 0 ? c / peak - 1 : 0;
  });
}

/** 卡瑪比率（年化報酬 / 最大回撤絕對值） */
export function calmar(closes, periods = TRADING_DAYS) {
  const ar = annualReturn(closes, periods);
  const { mdd } = maxDrawdown(closes);
  if (ar == null || mdd === 0) return null;
  return ar / Math.abs(mdd);
}

/** RSI (Wilder) */
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  const rs = ag / al;
  return 100 - 100 / (1 + rs);
}

/** ATR（真實波幅均值） */
export function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return mean(trs.slice(-period));
}

/** ATR 時間序列（Wilder 平滑），與 bars 同長度，前 warm-up 段為 null。供波動率走勢圖使用。 */
export function atrSeries(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return out;
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let prev = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) prev = mean(tr.slice(0, period));
    else prev = (prev * (period - 1) + tr[i]) / period;
    out[i + 1] = prev;
  }
  return out;
}

/** Beta：個股 vs 基準（同期日報酬） */
export function beta(stockReturns, benchReturns) {
  const n = Math.min(stockReturns.length, benchReturns.length);
  if (n < 30) return null;
  const s = stockReturns.slice(-n);
  const b = benchReturns.slice(-n);
  const ms = mean(s);
  const mb = mean(b);
  let cov = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (s[i] - ms) * (b[i] - mb);
    vb += (b[i] - mb) ** 2;
  }
  if (vb === 0) return null;
  return cov / vb;
}

/** 月度報酬（依日期分組，取每月最後一筆） */
export function monthlyReturns(bars) {
  const byMonth = new Map();
  for (const b of bars) {
    const key = b.date.slice(0, 7);
    byMonth.set(key, b.close);
  }
  const keys = [...byMonth.keys()];
  const values = [...byMonth.values()];
  const rets = [];
  const labels = [];
  for (let i = 1; i < values.length; i++) {
    rets.push(values[i] / values[i - 1] - 1);
    labels.push(keys[i]);
  }
  return {
    returns: rets,
    labels,
    positiveRatio: rets.length ? rets.filter((r) => r > 0).length / rets.length : null,
  };
}

/** 區間報酬率 */
export function periodReturn(closes, days) {
  if (closes.length < days + 1) return null;
  return closes[closes.length - 1] / closes[closes.length - 1 - days] - 1;
}

/** 百分位排名：值在陣列中的相對位置（0–100，越大越好由呼叫端決定） */
export function percentileRank(values, v) {
  if (!values.length) return 50;
  let below = 0;
  let equal = 0;
  for (const x of values) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return ((below + equal / 2) / values.length) * 100;
}

/**
 * MACD（指數平滑異同移動平均）
 * @returns {{macd:number[], signal:number[], hist:number[]}}
 */
export function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const ef = ema(closes, fastPeriod);
  const es = ema(closes, slowPeriod);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const valid = line.filter((x) => x != null);
  if (!valid.length) return { macd: line, signal: line.map(() => null), hist: line.map(() => null) };
  const sig = ema(valid, signalPeriod);
  const pad = line.length - valid.length;
  const signal = new Array(line.length).fill(null);
  for (let i = 0; i < sig.length; i++) signal[pad + i] = sig[i];
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { macd: line, signal, hist };
}

/** 布林通道 */
export function bollinger(closes, period = 20, mult = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const sd = stdev(closes.slice(i - period + 1, i + 1));
    upper[i] = middle[i] + mult * sd;
    lower[i] = middle[i] - mult * sd;
  }
  return { upper, middle, lower };
}

/** OBV 能量潮 */
export function obv(closes, volumes) {
  const out = [];
  let cur = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i > 0) {
      if (closes[i] > closes[i - 1]) cur += volumes[i] || 0;
      else if (closes[i] < closes[i - 1]) cur -= volumes[i] || 0;
    }
    out.push(cur);
  }
  return out;
}

/** MFI 資金流向指標（典型價格加權） */
export function mfi(bars, period = 14) {
  const n = bars.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  const flow = tp.map((t, i) => t * (bars[i].volume || 0));
  for (let i = period; i < n; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (flow[j] > flow[j - 1]) pos += flow[j];
      else neg += flow[j];
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

/** ADX（Wilder 平滑，含 +DI/-DI） */
export function adx(bars, period = 14) {
  const n = bars.length;
  const out = new Array(n).fill(null);
  if (n < period * 2 + 2) return out;
  const tr = [];
  const pdm = [];
  const ndm = [];
  for (let i = 1; i < n; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    const ph = bars[i - 1].high;
    const pl = bars[i - 1].low;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    const up = h - ph;
    const dn = pl - l;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  let atrS = 0;
  let sp = 0;
  let sn = 0;
  const dx = [];
  for (let i = 0; i < tr.length; i++) {
    if (i === period - 1) {
      atrS = tr.slice(0, period).reduce((a, b) => a + b, 0);
      sp = pdm.slice(0, period).reduce((a, b) => a + b, 0);
      sn = ndm.slice(0, period).reduce((a, b) => a + b, 0);
    } else if (i >= period) {
      atrS = atrS - atrS / period + tr[i];
      sp = sp - sp / period + pdm[i];
      sn = sn - sn / period + ndm[i];
    } else continue;
    const pdi = atrS ? (100 * sp) / atrS : 0;
    const ndi = atrS ? (100 * sn) / atrS : 0;
    dx.push({ idx: i + 1, v: pdi + ndi === 0 ? 0 : (100 * Math.abs(pdi - ndi)) / (pdi + ndi) });
  }
  if (dx.length < period) return out;
  let sum = dx.slice(0, period).reduce((a, b) => a + b.v, 0);
  out[dx[period - 1].idx] = sum / period;
  for (let k = period; k < dx.length; k++) {
    const prev = out[dx[k - 1].idx];
    out[dx[k].idx] = (prev * (period - 1) + dx[k].v) / period;
  }
  return out;
}

/** CCI 順勢指標 */
export function cci(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  const tp = bars.map((b) => (b.high + b.low + b.close) / 3);
  for (let i = period - 1; i < bars.length; i++) {
    const slice = tp.slice(i - period + 1, i + 1);
    const ma = mean(slice);
    let md = 0;
    for (const v of slice) md += Math.abs(v - ma);
    md /= period;
    out[i] = md === 0 ? 0 : (tp[i] - ma) / (0.015 * md);
  }
  return out;
}

/** Williams %R */
export function willr(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const hh = Math.max(...slice.map((b) => b.high));
    const ll = Math.min(...slice.map((b) => b.low));
    out[i] = hh === ll ? 0 : ((hh - bars[i].close) / (hh - ll)) * -100;
  }
  return out;
}

/** 隨機指標 Slow K / D */
export function stoch(bars, kPeriod = 14, kSlow = 3, dPeriod = 3) {
  const fastK = new Array(bars.length).fill(null);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const slice = bars.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...slice.map((b) => b.high));
    const ll = Math.min(...slice.map((b) => b.low));
    fastK[i] = hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100;
  }
  const slowK = sma(fastK, kSlow);
  const slowD = sma(slowK, dPeriod);
  return { slowK, slowD };
}

/** 乖離率序列（%） */
export function bias(closes, period) {
  const ma = sma(closes, period);
  return closes.map((c, i) => (ma[i] ? ((c - ma[i]) / ma[i]) * 100 : null));
}

/** 支撐／壓力（近 n 根 K 線的極值） */
export function supportResistance(bars, lookback = 20) {
  if (!bars.length) return { support: null, resistance: null };
  const slice = bars.slice(-lookback);
  return {
    support: Math.min(...slice.map((b) => b.low)),
    resistance: Math.max(...slice.map((b) => b.high)),
  };
}

/** 線性內插標準化（0–100），自動處理「越小越好」 */
export function normalize(value, min, max, invert = false) {
  if (value == null || !Number.isFinite(value)) return null;
  if (max === min) return 50;
  let t = (value - min) / (max - min);
  t = Math.max(0, Math.min(1, t));
  return (invert ? 1 - t : t) * 100;
}
