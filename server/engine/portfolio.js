/**
 * portfolio.js — 投資組合追蹤（成本／市値／損益／集中度／與基準比較）。
 */
import path from 'node:path';
import { norm } from '../lib/code.js';                 // 代號正規化單一來源
import { readJson, writeJson } from '../lib/store.js'; // JSON 讀寫單一來源
import { STORE_DIR, ensureDirs } from '../lib/paths.js';
import { PublicError } from '../lib/errors.js';

ensureDirs();
const FILE = path.join(STORE_DIR, 'portfolio.json');

export const holdings = {
  list: () => readJson(FILE, []),
  save: (list) => writeJson(FILE, list),
  add: (h) => {
    const list = holdings.list();
    const rec = {
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      code: norm(h.code),
      qty: Number(h.qty),
      cost: Number(h.cost),
      date: h.date || new Date().toISOString().slice(0, 10),
      note: h.note || '',
    };
    if (!(rec.qty > 0) || !(rec.cost >= 0)) throw new PublicError('數量與成本須為有效數字');
    list.push(rec);
    holdings.save(list);
    return rec;
  },
  update: (id, patch) => {
    const list = holdings.list();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    if (patch.code) list[i].code = norm(patch.code);
    holdings.save(list);
    return list[i];
  },
  remove: (id) => holdings.save(holdings.list().filter((x) => x.id !== id)),
};

/**
 * 計算組合現值
 * @param {Array} list holdings.list()
 * @param {Function} priceOf (code) => {price, changePercent, name}
 */
export function evaluate(list, priceOf, benchReturnSince) {
  const rows = [];
  let totalCost = 0;
  let totalValue = 0;
  let dayChangeValue = 0;

  for (const h of list) {
    const q = priceOf(h.code) || {};
    const price = q.price ?? null;
    const prev = q.previousClose ?? (price != null && q.changePercent != null ? price / (1 + q.changePercent / 100) : null);
    const value = price != null ? price * h.qty : null;
    const cost = h.cost * h.qty;
    const pnl = value != null ? value - cost : null;
    const pnlPct = value != null && cost > 0 ? pnl / cost : null;
    const dayPnl = value != null && prev != null ? (price - prev) * h.qty : null;
    totalCost += cost;
    if (value != null) totalValue += value;
    if (dayPnl != null) dayChangeValue += dayPnl;
    rows.push({
      ...h,
      name: q.name || q.zhName || null,
      price,
      changePercent: q.changePercent ?? null,
      change: q.change != null ? q.change : null,
      value,
      cost,
      buyPrice: h.cost,
      pnl,
      pnlPct,
      dayPnl,
      weight: null,
    });
  }
  for (const r of rows) r.weight = totalValue > 0 && r.value != null ? r.value / totalValue : null;

  const totalPnl = totalValue - totalCost;
  const byCode = new Map();
  for (const r of rows) byCode.set(r.code, (byCode.get(r.code) || 0) + (r.value || 0));
  const topWeight = totalValue > 0 ? Math.max(...[...byCode.values()].map((v) => v / totalValue)) : null;

  return {
    rows,
    summary: {
      totalCost,
      totalValue,
      totalPnl,
      totalPnlPct: totalCost > 0 ? totalPnl / totalCost : null,
      dayPnl: dayChangeValue,
      dayPnlPct: totalValue > 0 ? dayChangeValue / (totalValue - dayChangeValue) : null,
      positions: rows.length,
      topWeight,
      benchReturn: benchReturnSince ?? null,
      excess: benchReturnSince != null && totalCost > 0 ? totalPnl / totalCost - benchReturnSince : null,
      updatedAt: new Date().toISOString(),
    },
  };
}

export default { holdings, evaluate };
