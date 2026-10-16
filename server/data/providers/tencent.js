/**
 * tencent.js — 騰訊財經（qt.gtimg.cn / web.ifzq.gtimg.cn）供應商
 *
 * 存在的理由：Yahoo Finance 自 2026-09 起對本機 IP 全面回傳 403，
 * 導致平台只能吃到過期快取、股價顯示錯誤。騰訊財經提供免鑰、穩定、
 * 含中文名稱的即時報價與日 K 線，因此作為「即時行情主源」。
 *
 * 提供的資料：
 *  1. fetchQuote ：即時報價（現價／升跌／開高低／成交量額／PE／市值／52 週高低／中文名）
 *  2. fetchChart ：日 K 線（前復權，最長約 640 根 ≈ 2.5 年）
 *  3. fetchIndex ：指數（恒指／國企／科指／標普／道指／納指）
 *
 * 注意：回應為 GBK 編碼，需以 TextDecoder('gbk') 解碼。
 */
import { getBuffer, request } from '../../lib/http.js';
import { detectMarket, normalizeCode } from '../../lib/code.js';
import { cleanBars } from '../../lib/validate.js';
import log from '../../lib/logger.js';

const TAG = 'tencent';
const QUOTE_API = 'https://qt.gtimg.cn/q=';
const KLINE_HK = 'https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get';
const KLINE_US = 'https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get';

/** 騰訊指數代號對照（平台／Yahoo 符號 → 騰訊符號） */
export const INDEX_MAP = {
  '^HSI': 'hkHSI',
  '^HSCE': 'hkHSCEI',
  '^HSTECH': 'hkHSTECH',
  '^GSPC': 'usINX',
  '^DJI': 'usDJI',
  '^IXIC': 'usIXIC',
};

const gbkDecoder = new TextDecoder('gbk');
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 把「無時區」的當地時間字串轉成正確的 UTC 時間。
 * 港股以 Asia/Hong_Kong、美股以 America/New_York 解析，並自動處理夏令時間，
 * 避免直接用伺服器時區（GMT+8）解讀美股收盤時間而產生 12 小時誤差。
 * @param {string} text 'YYYY/MM/DD HH:mm:ss'
 * @param {string} timeZone IANA 時區
 */
function zonedToIso(text, timeZone) {
  if (!text) return null;
  const naive = text.trim().replace(/\//g, '-').replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(naive)) return null;
  const full = naive.length === 16 ? `${naive}:00` : naive;
  const asUTC = new Date(`${full}Z`);
  if (Number.isNaN(asUTC.getTime())) return null;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(
      dtf.formatToParts(asUTC).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]),
    );
    const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return new Date(asUTC.getTime() - (asTz - asUTC.getTime())).toISOString();
  } catch {
    return new Date(`${full}Z`).toISOString();
  }
}

/**
 * 平台代號 → 騰訊報價符號
 * 港股 00700 → hk00700；美股 AAPL → usAAPL、BRK-B → usBRK.B
 * @param {string} code
 */
export function quoteSymbol(code) {
  const raw = String(code ?? '').trim().toUpperCase();
  if (INDEX_MAP[raw]) return INDEX_MAP[raw];
  // 指數裸代號（HSI / HSTECH）
  if (/^(HSI|HSCEI|HSTECH)$/.test(raw)) return `hk${raw}`;
  if (/^(INX|DJI|IXIC)$/.test(raw)) return `us${raw}`;
  const m = detectMarket(raw);
  if (m === 'hk') return `hk${raw.replace(/\.HK$/i, '').padStart(5, '0')}`;
  // 騰訊美股用點號（BRK.B），平台內部用連字號（BRK-B）
  return `us${raw.replace(/-/g, '.')}`;
}

/**
 * 平台代號 → 騰訊 K 線符號
 * 美股 K 線 API 需帶交易所後綴才會回傳完整 qfqday（usAAPL → usAAPL.OQ）
 * @param {string} code
 */
export function klineSymbol(code, suffix = '.OQ') {
  const q = quoteSymbol(code);
  if (!q.startsWith('us')) return q;
  if (/\.(OQ|N|A|P)$/.test(q)) return q;
  return `${q}${suffix}`;
}

/** 騰訊符號 → 平台代號 */
export function codeFromSymbol(sym) {
  const s = String(sym ?? '').toUpperCase();
  let body = s;
  if (body.startsWith('HK')) body = body.slice(2);
  else if (body.startsWith('US')) body = body.slice(2);
  body = body.replace(/\.(OQ|N|A|P)$/, '');
  if (/^\d+$/.test(body)) return body.padStart(5, '0');
  return body.replace(/\./g, '-');
}

/* --------------------------------- 報價解析 --------------------------------- */

/**
 * 解析單行報價
 * 港股與美股欄位位置不同（美股幣種在 index 35，港股在尾段），分開處理。
 */
export function parseQuoteLine(line) {
  const m = /^v_([A-Za-z0-9._-]+)="([\s\S]*)";?\s*$/.exec(String(line).trim());
  if (!m) return null;
  const symbol = m[1];
  const f = m[2].split('~');
  if (f.length < 40) return null;

  const isUs = symbol.toUpperCase().startsWith('US');
  const marketTime = zonedToIso(f[30], isUs ? 'America/New_York' : 'Asia/Hong_Kong');

  const currency = isUs
    ? (/^[A-Z]{3}$/.test(f[35] || '') ? f[35] : 'USD')
    : f.slice(-6).find((x) => /^[A-Z]{3}$/.test(x)) || 'HKD';

  // 市值欄位單位為「億」，換算回元
  const marketCap = num(f[44]) != null ? num(f[44]) * 1e8 : null;
  const floatMarketCap = num(f[45]) != null ? num(f[45]) * 1e8 : null;

  return {
    symbol,
    code: codeFromSymbol(symbol),
    name: f[1] || null,            // 中文名稱（騰訊自帶，免額外查詢）
    nameEn: f[46] || null,
    currency,
    price: num(f[3]),
    previousClose: num(f[4]),
    open: num(f[5]),
    volume: num(f[36]) ?? num(f[6]),
    turnover: num(f[37]),
    change: num(f[31]),
    changePercent: num(f[32]),
    dayHigh: num(f[33]),
    dayLow: num(f[34]),
    fiftyTwoWeekHigh: num(f[48]),
    fiftyTwoWeekLow: num(f[49]),
    pe: num(f[39]),
    marketCap,
    floatMarketCap,
    marketTime,
    source: '騰訊財經',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 即時報價（可批次）
 * @param {string|string[]} code 平台代號
 * @returns {Promise<object|object[]>}
 */
export async function fetchQuote(code) {
  const list = Array.isArray(code) ? code : [code];
  const syms = list.map(quoteSymbol);
  const url = `${QUOTE_API}${syms.join(',')}`;
  const buf = await getBuffer(url, { timeout: 15000, retries: 1, headers: { Referer: 'https://gu.qq.com/' } });
  const text = gbkDecoder.decode(buf);
  const out = [];
  for (const line of text.split('\n')) {
    const q = parseQuoteLine(line);
    if (q && q.price != null) out.push(q);
  }
  if (!out.length) throw new Error(`騰訊未回傳有效報價：${syms.join(',')}`);
  if (!Array.isArray(code)) {
    const hit = out.find((q) => q.symbol.toUpperCase() === syms[0].toUpperCase()) || out[0];
    if (!hit) throw new Error(`騰訊查無此代號：${code}`);
    return hit;
  }
  return out;
}

/** 指數報價（輸入 Yahoo 風格符號如 ^HSI） */
export async function fetchIndex(symbol) {
  return fetchQuote(symbol);
}

/* ---------------------------------- K 線 ----------------------------------- */

const KLINE_ROWS = 640; // 騰訊單次上限（實測 2000 也只回 640）

/**
 * 日 K 線
 * @param {string} code 平台代號
 * @param {{limit?:number}} opts
 */
export async function fetchChart(code, { limit = KLINE_ROWS } = {}) {
  // 以 quoteSymbol 結果判斷市場（指數符號如 ^GSPC 會先被對照成 usINX），
  // 不能直接用 detectMarket('^GSPC')——它不含數字會被誤判為美股以外的規則。
  const q = quoteSymbol(code);
  const isUs = q.startsWith('us');
  const base = isUs ? KLINE_US : KLINE_HK;
  // 美股需嘗試後綴，否則只會回傳 1 根
  const candidates = isUs ? [klineSymbol(code, '.OQ'), klineSymbol(code, '.N'), q] : [q];

  let lastErr;
  for (const sym of candidates) {
    try {
      const url = `${base}?param=${sym},day,,,${limit},qfq`;
      const json = await getJson(url);
      const node = json?.data?.[sym] || Object.values(json?.data || {})[0];
      const rows = node?.qfqday || node?.day;
      if (!Array.isArray(rows) || rows.length < 2) {
        lastErr = new Error(`騰訊 K 線資料不足：${sym}（${rows?.length ?? 0} 根）`);
        continue;
      }
      const qt = node?.qt?.[sym] ? parseQuoteLine(`v_${sym}="${node.qt[sym].join('~')}";`) : null;
      const raw = rows.map((r) => ({
        date: r[0],
        open: Number(r[1]),
        close: Number(r[2]),
        high: Number(r[3]),
        low: Number(r[4]),
        volume: Number(r[5]),
      }));
      const { bars, issues } = cleanBars(raw);
      const last = bars[bars.length - 1] || null;
      return {
        symbol: sym,
        code: codeFromSymbol(sym),
        name: qt?.name || null,
        currency: qt?.currency || (isUs ? 'USD' : 'HKD'),
        exchange: null,
        meta: {
          regularMarketPrice: qt?.price ?? last?.close ?? null,
          regularMarketTime: qt?.marketTime ? Math.floor(new Date(qt.marketTime).getTime() / 1000) : null,
          previousClose: qt?.previousClose ?? null,
          dayHigh: qt?.dayHigh ?? last?.high ?? null,
          dayLow: qt?.dayLow ?? last?.low ?? null,
          dayVolume: qt?.volume ?? last?.volume ?? null,
          fiftyTwoWeekHigh: qt?.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow: qt?.fiftyTwoWeekLow ?? null,
          changePercent: qt?.changePercent ?? null,
        },
        bars,
        dividends: [],
        issues,
        source: '騰訊財經（前復權日 K）',
        fetchedAt: new Date().toISOString(),
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`騰訊 K 線取數失敗：${code}`);
}

async function getJson(url) {
  const buf = await getBuffer(url, { timeout: 20000, retries: 1, headers: { Referer: 'https://gu.qq.com/' } });
  return JSON.parse(buf.toString('utf8'));
}

/* --------------------------------- 基本面 ---------------------------------- */

/**
 * 基本面（由報價欄位推導，屬於「輕量版」）
 * 騰訊未開放免費財報 API，故僅回填已驗證欄位，其餘維持 null（不臆測）。
 */
export async function fetchFundamentals(code) {
  const q = await fetchQuote(code);
  const out = {
    symbol: q.symbol,
    code: q.code,
    name: q.nameEn || q.name,
    zhName: q.name,
    currency: q.currency,
    marketCap: q.marketCap,
    trailingPE: q.pe,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow,
    sector: null,
    industry: null,
    trailingAnnualDividendYield: null,
    priceToBook: null,
    returnOnEquity: null,
    grossMargin: null,
    profitMargin: null,
    beta: null,
    eps: null,
    revenueGrowth: null,
    earningsGrowth: null,
    source: '騰訊財經（報價推導，欄位較少）',
    asOf: new Date().toISOString(),
    completeness: 0,
    _partial: true,
  };
  out.completeness = Object.values(out).filter((v) => typeof v === 'number' && v !== null).length;
  return out;
}

/* -------------------------------- 健康檢查 --------------------------------- */

export async function ping() {
  const t0 = Date.now();
  try {
    const res = await request(`${QUOTE_API}hk00700`, { timeout: 10000, retries: 0, headers: { Referer: 'https://gu.qq.com/' } });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, latencyMs: Date.now() - t0 };
  }
}

export const provider = {
  id: 'tencent',
  label: '騰訊財經',
  ping,
  fetchChart,
  fetchQuote,
  fetchFundamentals,
};

export default provider;
log.debug(TAG, 'tencent provider 已載入');
