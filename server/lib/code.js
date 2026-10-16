/**
 * code.js — 證券代號與市場判斷的單一來源。
 *
 * 放在 lib 層（而非 data/providers/yahoo.js），因為「代號正規化」是平台概念，
 * 不該綁死在單一供應商；yahoo.js 會從這裡 import 並 re-export 以維持既有引用。
 *
 * 規則：
 *   - 港股：純數字或帶 .HK 後綴 → 補零為 5 碼（700 → 00700）
 *   - 美股：含英文字母 → 大寫，且 BRK.B → BRK-B（AAPL → AAPL）
 */

/** 判斷代號所屬市場 */
export function detectMarket(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return 'hk';
  if (/\.HK$/i.test(c)) return 'hk';
  if (/^[0-9]+$/.test(c)) return 'hk';
  return 'us';
}

/** 依市場將任意輸入正規化為平台內部代號 */
export function normalizeCode(code, market) {
  const m = market || detectMarket(code);
  const c = String(code ?? '').trim().toUpperCase();
  if (m === 'hk') return c.replace(/\.HK$/i, '').padStart(5, '0');
  return c.replace(/\./g, '-');
}

/** 單參數便利版（自動偵測市場）：portfolio / alerts / universe 的 norm() */
export function norm(code) {
  return normalizeCode(code, detectMarket(code));
}

export const isUS = (code) => detectMarket(code) === 'us';
export const isHK = (code) => detectMarket(code) === 'hk';

export default { detectMarket, normalizeCode, norm, isUS, isHK };
