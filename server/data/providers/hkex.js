/**
 * hkex.js — 香港交易所「證券名單」供應商（主板／GEM 全部證券代號）
 * 來源：ListOfSecurities.xlsx（港交所官方，每日更新），以內建 xlsx 讀取器解析。
 */
import { getBuffer, request } from '../../lib/http.js';
import { readSheet } from '../../lib/xlsx.js';
import log from '../../lib/logger.js';

const TAG = 'hkex';
export const LIST_URL =
  'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';

/** 下載並解析為股票清單 */
export async function fetchUniverse({ includeGem = false, includeReit = true } = {}) {
  const buf = await getBuffer(LIST_URL, { timeout: 40000, retries: 1 });
  if (buf.length < 200000) throw new Error('港交所名單檔案過小，疑似非預期回應');
  const rows = readSheet(buf);
  let headerIdx = rows.findIndex((r) => (r[0] || '').trim() === 'Stock Code');
  if (headerIdx < 0) headerIdx = 2;
  const out = [];
  const seen = new Set();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const code = (r[0] || '').trim();
    const name = (r[1] || '').trim();
    const category = (r[2] || '').trim();
    const sub = (r[3] || '').trim();
    if (!/^\d{4,5}$/.test(code)) continue;
    if (seen.has(code)) continue;
    const isEquity = category === 'Equity';
    const isReit = category === 'Real Estate Investment Trusts';
    if (!isEquity && !(includeReit && isReit)) continue;
    if (isEquity && !includeGem && /GEM/i.test(sub)) continue;
    seen.add(code);
    out.push({
      code,
      name: name.replace(/&amp;/g, '&'),
      category,
      subCategory: sub,
      board: /GEM/i.test(sub) ? 'GEM' : 'MainBoard',
      boardLot: Number(String(r[4] || '').replace(/,/g, '')) || null,
      isin: (r[5] || '').trim() || null,
    });
  }
  log.info(TAG, `證券名單解析完成：${out.length} 檔`);
  return { list: out, asOf: new Date().toISOString(), source: 'HKEX ListOfSecurities' };
}

export async function ping() {
  const t0 = Date.now();
  try {
    const res = await request(LIST_URL, { method: 'HEAD', timeout: 15000, retries: 0 });
    return { ok: res.status < 400, status: res.status, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, latencyMs: Date.now() - t0 };
  }
}

export const provider = { id: 'hkex', label: 'HKEX 證券名單', ping, fetchUniverse };
export default provider;
