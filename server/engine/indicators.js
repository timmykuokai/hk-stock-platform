/**
 * indicators.js — 技術分析編排層。
 *
 * 本模組只做「組裝與判讀」：純數學放在 lib/stats.js，這裡負責
 *   1. 一次算完全部指標，避免重複遍歷
 *   2. 取出最新值快照（缺值一律 null，不猜值）
 *   3. 產生技術面十大加權訊號（供綜合決策部門使用）
 *   4. 輸出繪圖需要的序列（截斷至保留長度，避免回傳過大）
 */
import {
  sma, ema, macd, bollinger, obv, mfi, adx, cci, willr, stoch, bias, atr, atrSeries, rsi, supportResistance, mean,
} from '../lib/stats.js';

/** 取陣列最後一個非 null 值 */
function last(arr) {
  if (!arr || !arr.length) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/**
 * 計算全部技術指標
 * @param {Array<{date,open,high,low,close,volume}>} bars 已清洗的日 K
 * @param {{seriesLen?:number, lookback?:number}} opts
 */
export function computeIndicators(bars, opts = {}) {
  const { seriesLen = 250, lookback = 20 } = opts;
  if (!bars || bars.length < 30) return null;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume || 0);
  const n = bars.length;
  const price = closes[n - 1];

  // ── 一次算完 ─────────────────────────────────────────────
  const ma5 = sma(closes, 5);
  const ma6 = sma(closes, 6);
  const ma10 = sma(closes, 10);
  const ma12 = sma(closes, 12);
  const ma20 = sma(closes, 20);
  const ma24 = sma(closes, 24);
  const ma50 = sma(closes, 50);
  const ma60 = sma(closes, 60);
  const ma200 = sma(closes, 200);
  const ema20 = ema(closes, 20);
  const rsiArr = (() => {
    const full = new Array(n).fill(null);
    for (let i = 30; i < n; i++) full[i] = rsi(closes.slice(0, i + 1), 14);
    return full;
  })();
  const { macd: macdLine, signal: macdSignal, hist: macdHist } = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const atr14 = atr(bars, 14);
  const atrArr = atrSeries(bars, 14);
  const obvArr = obv(closes, volumes);
  const obvMa20 = sma(obvArr, 20);
  const mfiArr = mfi(bars, 14);
  const adxArr = adx(bars, 14);
  const cciArr = cci(bars, 14);
  const willrArr = willr(bars, 14);
  const { slowK, slowD } = stoch(bars, 14, 3, 3);
  const bias6 = bias(closes, 6);
  const bias12 = bias(closes, 12);
  const bias24 = bias(closes, 24);
  const volMa20 = sma(volumes, 20);
  const { support, resistance } = supportResistance(bars, lookback);

  const lastVolume = volumes[n - 1];
  const volMa = last(volMa20);
  const high52w = Math.max(...closes.slice(-252));
  const low52w = Math.min(...closes.slice(-252));

  const latest = {
    date: bars[n - 1].date,
    close: price,
    ma5: last(ma5), ma6: last(ma6), ma10: last(ma10), ma12: last(ma12),
    ma20: last(ma20), ma24: last(ma24), ma50: last(ma50), ma60: last(ma60), ma200: last(ma200),
    ema20: last(ema20),
    rsi14: last(rsiArr),
    macd: last(macdLine), macdSignal: last(macdSignal), macdHist: last(macdHist),
    bbUpper: last(bb.upper), bbMiddle: last(bb.middle), bbLower: last(bb.lower),
    bbPercent: (() => {
      const u = last(bb.upper);
      const l = last(bb.lower);
      return u != null && l != null && u > l ? ((price - l) / (u - l)) * 100 : null;
    })(),
    atr14,
    atrPct: atr14 && price ? (atr14 / price) * 100 : null,
    obv: last(obvArr), obvMa20: last(obvMa20),
    mfi14: last(mfiArr),
    adx14: last(adxArr),
    cci14: last(cciArr),
    willr14: last(willrArr),
    slowK: last(slowK), slowD: last(slowD),
    bias6: last(bias6), bias12: last(bias12), bias24: last(bias24),
    volume: lastVolume, volumeMa20: volMa,
    volRatio: volMa ? lastVolume / volMa : null,
    support, resistance,
    positionInRange: support != null && resistance != null && resistance > support
      ? ((price - support) / (resistance - support)) * 100 : null,
    high52w, low52w,
    position52w: high52w > low52w ? ((price - low52w) / (high52w - low52w)) * 100 : null,
  };

  const technical = technicalSignals(latest);

  // ── 繪圖序列（截斷長度） ──────────────────────────────────
  const from = Math.max(0, n - seriesLen);
  const cut = (a) => (Array.isArray(a) ? a.slice(from).map((v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null)) : null);
  const series = {
    dates: bars.slice(from).map((b) => b.date),
    close: cut(closes),
    ma5: cut(ma5), ma20: cut(ma20), ma60: cut(ma60), ma200: cut(ma200),
    bbUpper: cut(bb.upper), bbLower: cut(bb.lower),
    rsi: cut(rsiArr),
    macd: cut(macdLine), macdSignal: cut(macdSignal), macdHist: cut(macdHist),
    mfi: cut(mfiArr), adx: cut(adxArr),
    obv: cut(obvArr), obvMa20: cut(obvMa20),
    slowK: cut(slowK), slowD: cut(slowD),
    cci: cut(cciArr),
    atr14: cut(atrArr),
    bias6: cut(bias6), bias12: cut(bias12), bias24: cut(bias24),
    volume: cut(volumes), volumeMa20: cut(volMa20),
  };

  return { latest, technical, series, barsUsed: n };
}

/**
 * 技術面十大加權訊號（原碼 generate_trading_recommendation 的移植）
 * 每項回傳 raw 分數（-100~100 區間的加權前貢獻）與中文說明
 */
export function technicalSignals(L) {
  const signals = [];
  const push = (key, label, weight, raw, remark) => signals.push({
    key, label, weight, raw, contribution: r2(raw * weight), remark,
  });

  // 1. RSI (20%)
  const r = L.rsi14 ?? 50;
  if (r < 30) push('rsi', 'RSI(14)', 0.20, 25, `RSI 超賣（${r.toFixed(1)}），技術面偏多`);
  else if (r < 40) push('rsi', 'RSI(14)', 0.20, 20, `RSI 接近超賣（${r.toFixed(1)}），偏多`);
  else if (r > 70) push('rsi', 'RSI(14)', 0.20, -25, `RSI 超買（${r.toFixed(1)}），回檔風險`);
  else if (r > 60) push('rsi', 'RSI(14)', 0.20, -20, `RSI 接近超買（${r.toFixed(1)}），偏空`);
  else push('rsi', 'RSI(14)', 0.20, 0, `RSI 中性（${r.toFixed(1)}）`);

  // 2. MFI (10%)
  const m = L.mfi14 ?? 50;
  if (m < 20) push('mfi', 'MFI 資金流向', 0.10, 15, `MFI 超賣（${m.toFixed(1)}），資金流出已鈍化`);
  else if (m < 30) push('mfi', 'MFI 資金流向', 0.10, 10, `MFI 偏低（${m.toFixed(1)}）`);
  else if (m > 80) push('mfi', 'MFI 資金流向', 0.10, -15, `MFI 超買（${m.toFixed(1)}），資金過熱`);
  else if (m > 70) push('mfi', 'MFI 資金流向', 0.10, -10, `MFI 偏高（${m.toFixed(1)}）`);
  else push('mfi', 'MFI 資金流向', 0.10, 0, `MFI 中性（${m.toFixed(1)}）`);

  // 3. 均線排列 (15%)
  const { close: p, ma5, ma20, ma50, ma200 } = L;
  if (p > ma5 && ma5 > ma20 && ma20 > ma50 && ma50 > ma200) push('ma', '均線排列', 0.15, 25, '價 > MA5 > MA20 > MA50 > MA200，多頭排列');
  else if (p > ma20 && ma20 > ma50) push('ma', '均線排列', 0.15, 20, '價 > MA20 > MA50，上升趨勢');
  else if (p < ma5 && ma5 < ma20 && ma20 < ma50 && ma50 < ma200) push('ma', '均線排列', 0.15, -25, '價 < MA5 < MA20 < MA50 < MA200，空頭排列');
  else if (p < ma20 && ma20 < ma50) push('ma', '均線排列', 0.15, -20, '價 < MA20 < MA50，下降趨勢');
  else push('ma', '均線排列', 0.15, 0, '均線交錯，方向未明');

  // 4. 支撐壓力位置 (10%)
  if (L.positionInRange != null) {
    const pos = L.positionInRange;
    if (pos < 30) push('sr', '支撐壓力位置', 0.10, 15, `接近支撐 ${r2(L.support)}（區間 ${pos.toFixed(0)}%）`);
    else if (pos > 70) push('sr', '支撐壓力位置', 0.10, -15, `接近壓力 ${r2(L.resistance)}（區間 ${pos.toFixed(0)}%）`);
    else push('sr', '支撐壓力位置', 0.10, 0, `價格位於區間中部（${pos.toFixed(0)}%）`);
  } else push('sr', '支撐壓力位置', 0.10, 0, '支撐壓力資料不足');

  // 5. MACD (10%)
  const { macd: mac, macdSignal: sig } = L;
  if (mac != null && sig != null) {
    if (mac > sig && mac > 0) push('macd', 'MACD', 0.10, 15, 'MACD 金叉且在零軸上方，偏多');
    else if (mac > sig) push('macd', 'MACD', 0.10, 10, 'MACD 金叉，短線轉強');
    else if (mac < sig && mac < 0) push('macd', 'MACD', 0.10, -15, 'MACD 死叉且在零軸下方，偏空');
    else push('macd', 'MACD', 0.10, -10, 'MACD 死叉，短線轉弱');
  } else push('macd', 'MACD', 0.10, 0, 'MACD 資料不足');

  // 6. 成交量 (10%) — 量能確認方向（方向由前五項累計決定）
  const partial = signals.reduce((s, x) => s + x.contribution, 0);
  const vr = L.volRatio ?? 1;
  if (vr >= 1.5) {
    const s = partial > 0 ? 10 : -10;
    push('volume', '成交量', 0.10, s, `量能放大至 20 日均量 ${vr.toFixed(2)} 倍，${s > 0 ? '確認走勢' : '助跌'}`);
  } else push('volume', '成交量', 0.10, 0, `量能 ${vr.toFixed(2)} 倍，屬正常水準`);

  // 7. OBV (10%)
  if (L.obv != null && L.obvMa20 != null && L.obvMa20 !== 0) {
    const ratio = L.obv / L.obvMa20;
    if (ratio > 1.02) push('obv', 'OBV 能量潮', 0.10, 10, 'OBV 站上均線，量能支持上升');
    else if (ratio < 0.98) push('obv', 'OBV 能量潮', 0.10, -10, 'OBV 落於均線下，量能偏弱');
    else push('obv', 'OBV 能量潮', 0.10, 0, 'OBV 與均線持平');
  } else push('obv', 'OBV 能量潮', 0.10, 0, 'OBV 資料不足');

  // 8. KD 隨機指標 (5%)
  const k = L.slowK ?? 50;
  const d = L.slowD ?? 50;
  if (k < 20 && d < 20) push('stoch', 'KD 隨機指標', 0.05, 5, `K${k.toFixed(1)} / D${d.toFixed(1)} 超賣`);
  else if (k > 80 && d > 80) push('stoch', 'KD 隨機指標', 0.05, -5, `K${k.toFixed(1)} / D${d.toFixed(1)} 超買`);
  else push('stoch', 'KD 隨機指標', 0.05, 0, `K${k.toFixed(1)} / D${d.toFixed(1)} 中性`);

  // 9. ADX (5%) — 趨勢強度放大器
  const a = L.adx14 ?? 20;
  const dir = signals.reduce((s, x) => s + x.contribution, 0) >= 0 ? 5 : -5;
  if (a > 25) push('adx', 'ADX 趨勢強度', 0.05, dir, `ADX ${a.toFixed(1)}，趨勢明確（${dir > 0 ? '多' : '空'}方力道較強）`);
  else push('adx', 'ADX 趨勢強度', 0.05, 0, `ADX ${a.toFixed(1)}，盤整格局`);

  // 10. BIAS 乖離率 (5%)
  const b = ((L.bias6 ?? 0) + (L.bias12 ?? 0) + (L.bias24 ?? 0)) / 3;
  if (b < -10) push('bias', 'BIAS 乖離率', 0.05, 5, `平均乖離 ${b.toFixed(1)}%，偏離下緣`);
  else if (b > 10) push('bias', 'BIAS 乖離率', 0.05, -5, `平均乖離 ${b.toFixed(1)}%，過熱`);
  else push('bias', 'BIAS 乖離率', 0.05, 0, `平均乖離 ${b.toFixed(1)}%，中性`);

  const raw = signals.reduce((s, x) => s + x.contribution, 0); // 約 -100 ~ 100
  const score = (Math.max(-100, Math.min(100, raw)) + 100) / 2; // 映射至 0–100
  return {
    raw: r2(raw),
    score: Math.round(score * 10) / 10,
    signals,
    summary: describeTechnical(score),
  };
}

function describeTechnical(score) {
  if (score >= 62.5) return { label: '技術面強勢', tone: 'up' };
  if (score >= 53.75) return { label: '技術面偏多', tone: 'up' };
  if (score >= 42.5) return { label: '技術面中立', tone: 'flat' };
  if (score >= 37.5) return { label: '技術面偏弱', tone: 'down' };
  return { label: '技術面弱勢', tone: 'down' };
}

/** 支撐壓力：回傳含緩衝區的量級（供前端畫階梯圖） */
export function priceLadder(L) {
  const p = L.close;
  const atrV = L.atr14 ?? p * 0.02;
  if (L.support != null && L.resistance != null && p > 0) {
    return {
      support: r2(L.support),
      resistance: r2(L.resistance),
      entryLow: r2(Math.min(L.support, p * 0.97)),
      entryHigh: r2(Math.min(L.support + atrV, p * 0.99)),
      stopLoss: r2(Math.max(L.support - atrV * 1.5, L.support * 0.95)),
      takeProfit1: r2(L.resistance),
      takeProfit2: r2(L.resistance + atrV),
      basis: 'support_resistance',
    };
  }
  if (L.bbLower != null && L.bbUpper != null) {
    return {
      support: r2(L.bbLower),
      resistance: r2(L.bbUpper),
      entryLow: r2(L.bbLower),
      entryHigh: r2(Math.min(L.bbLower + atrV, p)),
      stopLoss: r2(L.bbLower - atrV),
      takeProfit1: r2(p * 1.08),
      takeProfit2: r2(p * 1.15),
      basis: 'bollinger',
    };
  }
  return {
    support: null, resistance: null,
    entryLow: r2(p * 0.94), entryHigh: r2(p * 0.98),
    stopLoss: r2(p * 0.90), takeProfit1: r2(p * 1.06), takeProfit2: r2(p * 1.12),
    basis: 'percent',
  };
}

export { supportResistance, mean };
export default { computeIndicators, technicalSignals, priceLadder };
