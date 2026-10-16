/**
 * yahoo.js — Yahoo Finance 供應商（港股主要結構化資料來源）
 *
 * 提供三類資料：
 *  1. chart   ：日／週 K 線 + 成交量 + 除息事件（v8 chart API，穩定免鑰）
 *  2. quote   ：即時／最新報價（取自 chart meta，避免 JS 渲染頁）
 *  3. fundamental：PE / PB / ROE / 殖利率 / 市值 / 毛利率 等（解析報價頁內嵌 JSON）
 *
 * 所有輸出都經 lib/validate.js 清洗，欄位缺失一律為 null（不猜值）。
 */
import { getJson, getTextRobust, request } from '../../lib/http.js';
import { cleanBars } from '../../lib/validate.js';
import log from '../../lib/logger.js';

const TAG = 'yahoo';
const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const QUOTE_PAGE = 'https://finance.yahoo.com/quote';
const HK_PAGE = 'https://hk.finance.yahoo.com/quote';

/**
 * 市場判斷與代號正規化的「權威實作」已移到 lib/code.js（平台概念，不綁定供應商）。
 * 這裡 import 後 re-export，讓既有 `yahoo.detectMarket(...)`、`import { normalizeCode } from '.../yahoo.js'`
 * 等寫法不必改動。
 */
import { detectMarket, normalizeCode } from '../../lib/code.js';
export { detectMarket, normalizeCode };

/** 港交所代號（000700 / 700）→ Yahoo 代碼（0700.HK）；美股代號（AAPL / BRK-B）原樣回傳 */
export function symbolFromCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (detectMarket(c) === 'hk') {
    const n = parseInt(c.replace(/\.HK$/i, ''), 10);
    if (!Number.isFinite(n)) return null;
    return `${String(n).padStart(4, '0')}.HK`;
  }
  if (!/[A-Z]/.test(c)) return null;
  return c.replace(/\./g, '-'); // BRK.B → BRK-B（Yahoo chart 相容格式）
}

/** Yahoo 代碼 → 平台內部代號（港股補零為 5 碼；美股原樣大寫） */
export function codeFromSymbol(sym) {
  const s = String(sym || '').toUpperCase();
  if (/\.HK$/i.test(s)) return s.replace(/\.HK$/i, '').padStart(5, '0');
  return s;
}

/**
 * 抓取 K 線
 * @param {string} sym 0700.HK
 * @param {{range?:string, interval?:string, period1?:number, period2?:number}} opts
 */
export async function fetchChart(sym, opts = {}) {
  const { range = '3y', interval = '1d', period1, period2 } = opts;
  const q = new URLSearchParams({ interval, events: 'div,split' });
  if (period1 && period2) {
    q.set('period1', String(period1));
    q.set('period2', String(period2));
  } else {
    q.set('range', range);
  }
  const url = `${CHART}/${encodeURIComponent(sym)}?${q.toString()}`;
  const json = await getJson(url);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo 無資料：${sym} ${json?.chart?.error?.description ?? ''}`);
  const meta = result.meta || {};
  const ts = result.timestamp || [];
  const q0 = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose;

  const raw = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open: q0.open?.[i],
    high: q0.high?.[i],
    low: q0.low?.[i],
    close: q0.close?.[i],
    volume: q0.volume?.[i],
    adjClose: adj?.[i],
  }));

  const { bars, issues } = cleanBars(raw);
  const dividends = Object.values(result.events?.dividends || {})
    .map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    symbol: sym,
    code: codeFromSymbol(sym),
    name: meta.longName || meta.shortName || null,
    currency: meta.currency || 'HKD',
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    meta: {
      regularMarketPrice: meta.regularMarketPrice ?? null,
      regularMarketTime: meta.regularMarketTime ?? null,
      previousClose: meta.chartPreviousClose ?? null,
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      dayVolume: meta.regularMarketVolume ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      changePercent: meta.regularMarketChangePercent ?? null,
    },
    bars,
    dividends,
    issues,
    source: 'Yahoo Finance chart API',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 抓取整段日 K 線（從該股上市日至今）。
 * Yahoo 的 range=max 會自動降採樣為月線，不適合日 K 用途；
 * 因此先以 range=max 探得上市日（首根 K 線日期），再以 period1 精確取回完整日 K。
 * @param {string} sym 0700.HK
 * @param {{interval?:string}} opts
 */
export async function fetchChartMax(sym, { interval = '1d' } = {}) {
  const probe = await fetchChart(sym, { range: 'max', interval });
  const firstDate = probe.bars[0]?.date;
  if (!firstDate) return probe;
  const period1 = Math.floor(new Date(`${firstDate}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.ceil(Date.now() / 1000);
  return fetchChart(sym, { interval, period1, period2 });
}

/** 最新報價（輕量：只取 5 日 K 線的 meta 與最後一根） */
export async function fetchQuote(sym) {
  const c = await fetchChart(sym, { range: '5d', interval: '1d' });
  const last = c.bars[c.bars.length - 1] || null;
  const prev = c.bars[c.bars.length - 2] || null;
  return {
    symbol: sym,
    code: c.code,
    name: c.name,
    currency: c.currency,
    price: c.meta.regularMarketPrice ?? last?.close ?? null,
    change: last && prev ? last.close - prev.close : null,
    changePercent: c.meta.changePercent ?? (last && prev ? (last.close / prev.close - 1) * 100 : null),
    open: last?.open ?? c.meta.regularMarketOpen ?? null,
    dayHigh: c.meta.dayHigh,
    dayLow: c.meta.dayLow,
    volume: c.meta.dayVolume ?? last?.volume ?? null,
    previousClose: c.meta.previousClose ?? prev?.close ?? null,
    fiftyTwoWeekHigh: c.meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: c.meta.fiftyTwoWeekLow,
    marketTime: c.meta.regularMarketTime ? new Date(c.meta.regularMarketTime * 1000).toISOString() : null,
    source: 'Yahoo Finance',
    fetchedAt: c.fetchedAt,
  };
}

const NUM_FIELDS = [
  'marketCap', 'enterpriseValue', 'trailingPE', 'forwardPE', 'priceToBook', 'bookValue',
  'returnOnEquity', 'returnOnAssets', 'trailingAnnualDividendYield', 'trailingAnnualDividendRate',
  'profitMargins', 'grossMargins', 'operatingMargins', 'revenueGrowth', 'earningsGrowth',
  'beta', 'epsTrailingTwelveMonths', 'floatShares', 'sharesOutstanding', 'totalCash', 'totalDebt',
  'currentRatio', 'quickRatio', 'totalRevenue', 'netIncomeToCommon', 'ebitda',
  'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'averageVolume', 'regularMarketVolume',
  // 十大要素模型所需：償債能力／現金流／治理／額外估值倍數
  'debtToEquity', 'payoutRatio', 'fiveYearAvgDividendYield', 'freeCashflow', 'operatingCashflow',
  'heldPercentInsiders', 'heldPercentInstitutions', 'enterpriseToEbitda', 'pegRatio',
  'priceToSalesTrailing12Months', 'forwardEps', 'grossProfits', 'revenuePerShare',
];
const STR_FIELDS = ['sector', 'industry', 'longName', 'shortName', 'currency', 'fullExchangeName'];
const NUMERIC_MAP = {
  marketCap: 'marketCap',
  trailingPE: 'trailingPE',
  forwardPE: 'forwardPE',
  priceToBook: 'priceToBook',
  bookValue: 'bookValue',
  returnOnEquity: 'returnOnEquity',
  returnOnAssets: 'returnOnAssets',
  trailingAnnualDividendYield: 'dividendYield',
  trailingAnnualDividendRate: 'dividendRateTTM',
  profitMargins: 'profitMargin',
  grossMargins: 'grossMargin',
  operatingMargins: 'operatingMargin',
  revenueGrowth: 'revenueGrowth',
  earningsGrowth: 'earningsGrowth',
  beta: 'beta',
  epsTrailingTwelveMonths: 'eps',
  enterpriseValue: 'enterpriseValue',
  floatShares: 'floatShares',
  sharesOutstanding: 'sharesOutstanding',
  totalCash: 'totalCash',
  totalDebt: 'totalDebt',
  currentRatio: 'currentRatio',
  quickRatio: 'quickRatio',
  totalRevenue: 'totalRevenue',
  netIncomeToCommon: 'netIncome',
  ebitda: 'ebitda',
  fiftyTwoWeekHigh: 'fiftyTwoWeekHigh',
  fiftyTwoWeekLow: 'fiftyTwoWeekLow',
  averageVolume: 'averageVolume',
  debtToEquity: 'debtToEquity',
  payoutRatio: 'payoutRatio',
  fiveYearAvgDividendYield: 'fiveYearAvgDividendYield',
  freeCashflow: 'freeCashflow',
  operatingCashflow: 'operatingCashflow',
  heldPercentInsiders: 'heldPercentInsiders',
  heldPercentInstitutions: 'heldPercentInstitutions',
  enterpriseToEbitda: 'enterpriseToEbitda',
  pegRatio: 'pegRatio',
  priceToSalesTrailing12Months: 'priceToSales',
  forwardEps: 'forwardEps',
  grossProfits: 'grossProfits',
  revenuePerShare: 'revenuePerShare',
  regularMarketVolume: 'regularMarketVolume',
};

function parseEmbeddedJson(html) {
  // 頁面內嵌 JSON 為雙重轉義，先正規化
  const norm = html.replace(/\\"/g, '"');
  const anchor = norm.search(/"marketCap":\{"raw"/);
  const start = anchor > 0 ? Math.max(0, anchor - 250000) : 0;
  const win = norm.slice(start, anchor > 0 ? anchor + 250000 : norm.length);
  const out = {};
  for (const f of NUM_FIELDS) {
    const re = new RegExp(`"${f}":\\{"raw":(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)`);
    const m = re.exec(win) || re.exec(norm);
    if (m) out[NUMERIC_MAP[f] || f] = Number(m[1]);
  }
  for (const f of STR_FIELDS) {
    const re = new RegExp(`"${f}":"([^"]*)"`);
    const m = re.exec(win) || re.exec(norm);
    if (m) out[f] = m[1];
  }
  return out;
}

/** 基本面（解析報價頁內嵌 JSON；抓不到回傳全 null，不臆測） */
export async function fetchFundamentals(sym) {
  const url = `${QUOTE_PAGE}/${encodeURIComponent(sym)}/`;
  const html = await getTextRobust(url, { headers: { Accept: 'text/html' }, timeout: 25000 });
  if (html.length < 50000) throw new Error('Yahoo 回傳疑似驗證頁，資料不可靠');
  const data = parseEmbeddedJson(html);
  const out = { symbol: sym, code: codeFromSymbol(sym), source: 'Yahoo Finance (quote page)', asOf: new Date().toISOString() };
  for (const k of Object.values(NUMERIC_MAP)) out[k] = k in data ? data[k] : null;
  out.sector = data.sector ?? null;
  out.industry = data.industry ?? null;
  out.name = data.longName || data.shortName || null;
  out.currency = data.currency ?? 'HKD';
  out.completeness = Object.values(out).filter((v) => typeof v === 'number').length;
  return out;
}

/** 中文名稱（Yahoo 香港站 title，快取 7 天等級，抓不到回 null） */
export async function fetchChineseName(sym) {
  const url = `${HK_PAGE}/${encodeURIComponent(sym)}/`;
  const html = await getTextRobust(url, { headers: { Accept: 'text/html' }, timeout: 25000 });
  const m = /<title>([^<]+)<\/title>/.exec(html);
  if (!m) return null;
  const name = m[1].replace(/\s*\(\d{4}\.HK\).*$/, '').replace(/\s*股價.*$/, '').trim();
  // 驗證：排除查無此股的通用頁標題
  if (!name) return null;
  if (/Yahoo|查詢|財經|首頁|瞭解/i.test(name)) return null;
  if (name.length > 16) return null;
  return name;
}

/** 健康檢查 */
export async function ping() {
  const t0 = Date.now();
  const res = await request(`${CHART}/0700.HK?range=1d&interval=1d`, { timeout: 10000, retries: 0 });
  return { ok: res.ok, status: res.status, latencyMs: Date.now() - t0 };
}

export const provider = {
  id: 'yahoo',
  label: 'Yahoo Finance',
  ping,
  fetchChart,
  fetchQuote,
  fetchFundamentals,
};

export default provider;
log.debug(TAG, 'yahoo provider 已載入');
