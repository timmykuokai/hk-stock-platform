/**
 * metrics.js — 由乾淨 K 線計算「篩選與評分」所需的全部指標。
 * 純計算層：輸入已驗證的 bars + dividends + fundamentals，輸出指標物件（缺值為 null）。
 */
import {
  sma, ema, dailyReturns, annualVol, annualReturn, sharpe, maxDrawdown, rsi, atr,
  beta, monthlyReturns, periodReturn, TRADING_DAYS, macd, bollinger, bias as biasSeries,
} from '../lib/stats.js';

const DAYS = { m1: 21, m3: 63, m6: 126, y1: 252, y3: 756 };

function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

/**
 * @param {{bars:Array, dividends?:Array, fundamentals?:object, bench?:Array}} input
 */
export function computeMetrics({ bars, dividends = [], fundamentals = null, bench = [] }) {
  const n = bars.length;
  if (n < 30) return { insufficient: true, bars: n };

  const closes = bars.map((b) => b.close);
  const amounts = bars.map((b) => (b.amount != null ? b.amount : b.close * b.volume));
  const volumes = bars.map((b) => b.volume);
  const price = closes[n - 1];

  const ret = dailyReturns(closes);
  const win = (d) => (n > d ? { closes: closes.slice(-d), bars: bars.slice(-d) } : { closes, bars });

  const w1y = n >= DAYS.y1 ? win(DAYS.y1) : win(n);
  const w3m = n >= DAYS.m3 ? win(DAYS.m3) : win(n);
  const w6m = n >= DAYS.m6 ? win(DAYS.m6) : win(n);
  const w1m = win(DAYS.m1);

  const r1y = dailyReturns(w1y.closes);
  const r3m = dailyReturns(w3m.closes);

  // 流動性：近 20／60 日均成交額（HKD）
  const avg = (a, k) => {
    const s = a.slice(-k).filter((x) => Number.isFinite(x) && x > 0);
    return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null;
  };

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);
  const macdRes = macd(closes);
  const bb = bollinger(closes, 20, 2);

  // 股息：近 12 個月現金股利總額 / 現價
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const div12m = dividends.filter((d) => d.date >= cutoffStr).reduce((s, d) => s + d.amount, 0);
  const divYears = countDividendYears(dividends);
  const divGrowth = dividendGrowth(dividends);

  const mdd1y = maxDrawdown(w1y.closes);
  const mddAll = maxDrawdown(closes);
  const monthly = monthlyReturns(w1y.bars);

  const benchReturns = bench.length ? dailyReturns(bench.map((b) => b.close)) : [];

  const m = {
    // 價格
    price,
    previousClose: n > 1 ? closes[n - 2] : null,
    changePercent: n > 1 ? (closes[n - 1] / closes[n - 2] - 1) * 100 : null,
    // 當日升跌金額（最新收盤 − 前收，單位與股價相同，港股即港元）
    change: n > 1 ? price - closes[n - 2] : null,
    high52w: Math.max(...closes.slice(-DAYS.y1)),
    low52w: Math.min(...closes.slice(-DAYS.y1)),

    // 流動性
    turnover20d: avg(amounts, 20),
    turnover60d: avg(amounts, 60),
    volume20d: avg(volumes, 20),
    lastVolume: volumes[n - 1],

    // 波動度
    vol60d: annualVol(dailyReturns(win(60).closes)),
    vol1y: annualVol(r1y),
    atr14: atr(bars, 14),
    atrPct: atr(bars, 14) && price ? (atr(bars, 14) / price) * 100 : null,

    // 報酬
    ret1m: periodReturn(closes, DAYS.m1),
    ret3m: periodReturn(closes, DAYS.m3),
    ret6m: periodReturn(closes, DAYS.m6),
    ret1y: periodReturn(closes, DAYS.y1),
    ret3y: periodReturn(closes, DAYS.y3),
    cagr1y: annualReturn(w1y.closes),
    cagr3y: n >= DAYS.y3 ? annualReturn(closes.slice(-DAYS.y3)) : null,

    // 風險調整
    sharpe1y: sharpe(r1y),
    calmar: (() => {
      const ar = annualReturn(w1y.closes);
      return ar != null && mdd1y.mdd !== 0 ? ar / Math.abs(mdd1y.mdd) : null;
    })(),
    mdd1y: mdd1y.mdd,
    mddMax: mddAll.mdd,
    monthlyWinRate: monthly.positiveRatio,
    beta1y: benchReturns.length ? beta(r1y, benchReturns) : null,
    momentum3m: periodReturn(closes, DAYS.m3),
    // 穩定度：近 3 個月日報酬為正的比例
    stability: r3m.length ? r3m.filter((x) => x > 0).length / r3m.length : null,

    // 技術
    ma20: last(ma20), ma50: last(ma50), ma200: last(ma200),
    aboveMa200: ma200[n - 1] != null ? price > ma200[n - 1] : null,
    rsi14: rsi(closes, 14),
    ema20: last(ema(closes, 20)),

    // 短均線／量能／MACD（供技術面訊號與選股條件使用）
    ma5: last(sma(closes, 5)),
    aboveMa5: sma(closes, 5)[n - 1] != null ? price > sma(closes, 5)[n - 1] : null,
    aboveMa20: ma20[n - 1] != null ? price > ma20[n - 1] : null,
    aboveMa50: ma50[n - 1] != null ? price > ma50[n - 1] : null,
    volRatio: (() => {
      const a20 = avg(volumes, 20);
      return a20 ? volumes[n - 1] / a20 : null;
    })(),
    macd: last(macdRes.macd),
    macdSignal: last(macdRes.signal),
    macdHist: last(macdRes.hist),
    macdGolden: (() => {
      const a = last(macdRes.macd);
      const b = last(macdRes.signal);
      return a != null && b != null ? a > b : null;
    })(),
    bbUpper: last(bb.upper),
    bbLower: last(bb.lower),
    bbMiddle: last(bb.middle),
    bias6: last(biasSeries(closes, 6)),
    bias12: last(biasSeries(closes, 12)),
    bias24: last(biasSeries(closes, 24)),

    // 股息
    dividendYieldTTM: price > 0 && div12m > 0 ? div12m / price : null,
    dividend12m: div12m || null,
    dividendYears: divYears,
    dividendCagr: divGrowth,

    // 基本面（外部供應商，可能全為 null）
    pe: fundamentals?.trailingPE ?? null,
    forwardPe: fundamentals?.forwardPE ?? null,
    pb: fundamentals?.priceToBook ?? null,
    roe: fundamentals?.returnOnEquity ?? null,
    roa: fundamentals?.returnOnAssets ?? null,
    marketCap: fundamentals?.marketCap ?? null,
    profitMargin: fundamentals?.profitMargin ?? null,
    grossMargin: fundamentals?.grossMargin ?? null,
    revenueGrowth: fundamentals?.revenueGrowth ?? null,
    earningsGrowth: fundamentals?.earningsGrowth ?? null,
    dividendYieldReported: fundamentals?.dividendYield ?? null,
    betaReported: fundamentals?.beta ?? null,
    sector: fundamentals?.sector ?? null,
    industry: fundamentals?.industry ?? null,

    // 資料品質
    barsCount: n,
    firstDate: bars[0].date,
    lastDate: bars[n - 1].date,
    days: TRADING_DAYS,
  };

  // 52 週相對位置（0=最低，100=最高）
  const range = m.high52w - m.low52w;
  m.position52w = range > 0 ? ((price - m.low52w) / range) * 100 : null;
  // 距 52 週高點（現價 / 高點，越接近 1 代表越貼近高位）
  m.near52w = m.high52w ? price / m.high52w : null;

  // 資料合理性註記（異常高的殖利率通常來自一次性特別股息或除權資料，需人工查核）
  m.dividendNotes = buildDividendNotes(m, dividends, price);

  return m;
}

/**
 * 股息資料合理性檢查。
 * 港股常見「特別股息」或「以股代息」造成殖利率飆高，直接拿去排名會誤導，
 * 因此在這裡標記而非刪除（保留原值，讓使用者自行判斷）。
 */
function buildDividendNotes(m, dividends, price) {
  const notes = [];
  const dy = m.dividendYieldTTM;
  if (dy != null && dy > 0.12) {
    notes.push(`殖利率 ${(dy * 100).toFixed(1)}% 明顯偏高，可能內含一次性特別股息、以股代息或資料異常，建議查核公司公告後再解讀`);
  }
  if (price > 0 && dividends?.length) {
    const huge = dividends.filter((d) => d.amount / price > 0.08);
    if (huge.length) {
      notes.push(`近 12 個月有 ${huge.length} 筆單次派息超過股價 8%（${huge.map((d) => `${d.date.slice(0, 7)} ${d.amount.toFixed(3)}`).join('、')}），殖利率可能不可持續`);
    }
  }
  if (dy != null && dy > 0 && m.dividendYears === 1) {
    notes.push('僅有 1 個年度的配息紀錄，不足以判斷股息穩定性');
  }
  return notes;
}

/** 連續／累計配息年數 */
function countDividendYears(dividends) {
  if (!dividends.length) return 0;
  const years = new Set(dividends.map((d) => d.date.slice(0, 4)));
  return years.size;
}

/** 近 3 年股息年複合成長（資料不足回 null） */
function dividendGrowth(dividends) {
  if (dividends.length < 2) return null;
  const byYear = new Map();
  for (const d of dividends) byYear.set(d.date.slice(0, 4), (byYear.get(d.date.slice(0, 4)) || 0) + d.amount);
  const years = [...byYear.keys()].sort();
  if (years.length < 3) return null;
  const first = byYear.get(years[years.length - 3]);
  const lastV = byYear.get(years[years.length - 1]);
  if (!(first > 0) || !(lastV > 0)) return null;
  return (lastV / first) ** (1 / 2) - 1;
}

/** 指標的中英對照與分組（供 UI 產生篩選表單） */
export const METRIC_DEFS = [
  { key: 'turnover20d', label: '20日均成交額', group: '熱門度/成交量', unit: 'HKD', fmt: 'compact', dir: 1 },
  { key: 'turnover60d', label: '60日均成交額', group: '熱門度/成交量', unit: 'HKD', fmt: 'compact', dir: 1 },
  { key: 'volume20d', label: '20日均成交量', group: '熱門度/成交量', unit: '股', fmt: 'compact', dir: 1 },
  { key: 'price', label: '股價', group: '價格', unit: 'HKD', fmt: 'num', dir: 0 },
  { key: 'change', label: '當日升跌(金額)', group: '價格', unit: 'HKD', fmt: 'num', dir: 0 },
  { key: 'changePercent', label: '日漲跌幅', group: '價格', unit: '%', fmt: 'pct', dir: 0 },
  { key: 'position52w', label: '52週相對位置', group: '價格', unit: '', fmt: 'num', dir: 0 },
  { key: 'marketCap', label: '市值', group: '基本面', unit: 'HKD', fmt: 'compact', dir: 1 },
  { key: 'pe', label: '本益比(TTM)', group: '基本面', unit: '', fmt: 'num', dir: -1 },
  { key: 'pb', label: '股價淨值比', group: '基本面', unit: '', fmt: 'num', dir: -1 },
  { key: 'roe', label: '股東權益報酬率', group: '基本面', unit: '', fmt: 'pct', dir: 1 },
  { key: 'profitMargin', label: '淨利率', group: '基本面', unit: '', fmt: 'pct', dir: 1 },
  { key: 'revenueGrowth', label: '營收成長', group: '基本面', unit: '', fmt: 'pct', dir: 1 },
  { key: 'earningsGrowth', label: '盈餘成長', group: '基本面', unit: '', fmt: 'pct', dir: 1 },
  { key: 'dividendYieldTTM', label: '殖利率(近12月)', group: '殖利率', unit: '', fmt: 'pct', dir: 1 },
  { key: 'dividendYears', label: '配息年數', group: '殖利率', unit: '年', fmt: 'num', dir: 1 },
  { key: 'vol1y', label: '年化波動度(1年)', group: '波動度', unit: '', fmt: 'pct', dir: -1 },
  { key: 'vol60d', label: '年化波動度(60日)', group: '波動度', unit: '', fmt: 'pct', dir: -1 },
  { key: 'mdd1y', label: '一年最大回撤', group: '波動度', unit: '', fmt: 'pct', dir: 1 },
  { key: 'beta1y', label: 'Beta(對恒指)', group: '波動度', unit: '', fmt: 'num', dir: 0 },
  { key: 'ret1y', label: '一年報酬', group: '報酬', unit: '', fmt: 'pct', dir: 1 },
  { key: 'ret3m', label: '三個月報酬', group: '報酬', unit: '', fmt: 'pct', dir: 1 },
  { key: 'sharpe1y', label: '夏普值(1年)', group: '報酬穩定度', unit: '', fmt: 'num', dir: 1 },
  { key: 'monthlyWinRate', label: '月度勝率', group: '報酬穩定度', unit: '', fmt: 'pct', dir: 1 },
  { key: 'stability', label: '日勝率(3月)', group: '報酬穩定度', unit: '', fmt: 'pct', dir: 1 },
  { key: 'rsi14', label: 'RSI(14)', group: '技術', unit: '', fmt: 'num', dir: 0 },
  { key: 'aboveMa200', label: '站上年線', group: '技術', unit: '', fmt: 'bool', dir: 1 },
  { key: 'aboveMa20', label: '站上月線', group: '技術', unit: '', fmt: 'bool', dir: 1 },
  { key: 'aboveMa50', label: '站上季線', group: '技術', unit: '', fmt: 'bool', dir: 1 },
  { key: 'macdGolden', label: 'MACD 金叉', group: '技術', unit: '', fmt: 'bool', dir: 1 },
  { key: 'macdHist', label: 'MACD 柱', group: '技術', unit: '', fmt: 'num', dir: 1 },
  { key: 'volRatio', label: '量能比(20日)', group: '技術', unit: 'x', fmt: 'num', dir: 1 },
  { key: 'near52w', label: '距 52 週高點', group: '技術', unit: '%', fmt: 'pct', dir: 1 },
  { key: 'atrPct', label: 'ATR 佔股價', group: '技術', unit: '%', fmt: 'pct', dir: -1 },
];

export default { computeMetrics, METRIC_DEFS };
