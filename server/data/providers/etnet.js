/**
 * etnet.js — 經濟通（etnet）供應商：港股「20 大成交金額」即時榜
 * 用途：熱門度／成交量維度的外部交叉驗證（使用者慣用來源）。
 * 頁面為 server-rendered HTML table，並行解析後以數值區間驗證。
 */
import { getText, request } from '../../lib/http.js';
import { num } from '../../lib/validate.js';
import log from '../../lib/logger.js';

const TAG = 'etnet';
const TOP20_URL = 'https://www.etnet.com.hk/www/tc/stocks/realtime/top20.php';
export const QUOTE_URL = (code) => `https://www.etnet.com.hk/www/tc/stocks/realtime/quote.php?code=${code}`;

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

/** 解析成交二十大（以表頭關鍵字定位欄位，避免版面調整造成錯位） */
export async function fetchTopTurnover() {
  const html = await getText(TOP20_URL, { headers: { Accept: 'text/html' }, timeout: 20000 });
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);

  // 先找表頭
  let map = null;
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1]));
    if (cells.some((c) => c.includes('成交金額'))) {
      const at = (kw) => cells.findIndex((c) => c.includes(kw));
      map = {
        rank: at('排名') >= 0 ? at('排名') : 0,
        code: at('代號') >= 0 ? at('代號') : 1,
        name: at('名稱') >= 0 ? at('名稱') : 2,
        price: at('按盤價') >= 0 ? at('按盤價') : 3,
        change: at('變動率') >= 0 ? at('變動率') : 5,
        changeAbs: at('變動') >= 0 ? at('變動') : 4,
        high: at('最高價') >= 0 ? at('最高價') : 6,
        low: at('最低價') >= 0 ? at('最低價') : 7,
        amount: at('成交金額'),
        currency: at('貨幣') >= 0 ? at('貨幣') : cells.length - 1,
      };
      break;
    }
  }
  if (!map || map.amount < 0) throw new Error('找不到成交金額欄位，版面可能已調整');

  const out = [];
  for (const row of rows) {
    if (!/quote\.php\?code=/.test(row)) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (cells.length <= map.amount) continue;
    const code = cells[map.code];
    if (!/^\d{5}$/.test(code)) continue;
    const amountText = cells[map.amount] || '';
    const item = {
      rank: num(cells[map.rank]) ?? out.length + 1,
      code,
      name: cells[map.name],
      price: num(cells[map.price]),
      change: num(cells[map.changeAbs]),
      changePercent: num(cells[map.change]),
      high: num(cells[map.high]),
      low: num(cells[map.low]),
      amountRaw: amountText,
      amount: parseHkAmount(amountText),
      currency: cells[map.currency] || 'HKD',
    };
    // 驗證：價格需為正數，漲跌幅需在 ±30% 內
    if (!(item.price > 0)) continue;
    if (item.changePercent != null && Math.abs(item.changePercent) > 30) continue;
    out.push(item);
  }
  log.info(TAG, `etnet 成交榜解析：${out.length} 筆`);
  return { list: out, asOf: new Date().toISOString(), source: 'etnet 經濟通 20大成交' };
}

/** 港式金額字串轉數字（億/萬/千） */
export function parseHkAmount(text) {
  if (!text) return null;
  const t = text.replace(/,/g, '').trim();
  const m = /^(-?[\d.]+)\s*(億|萬|千|百)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = { 億: 1e8, 萬: 1e4, 千: 1e3, 百: 100 }[m[2]] ?? 1;
  return v * unit;
}

export async function ping() {
  const t0 = Date.now();
  try {
    const res = await request(TOP20_URL, { method: 'HEAD', timeout: 15000, retries: 0 });
    return { ok: res.status < 400, status: res.status, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, latencyMs: Date.now() - t0 };
  }
}

export const provider = { id: 'etnet', label: 'etnet 經濟通（成交榜）', ping, fetchTopTurnover };
export default provider;
