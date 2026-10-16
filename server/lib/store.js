/**
 * store.js — JSON 檔案讀寫（容錯版）。
 *
 * 過去 readJson/writeJson 在 universe.js、portfolio.js、alerts.js 各寫一份完全相同的實作，
 * 規則一改就要改三處。集中到這裡，讓儲存邏輯只有一份。
 */
import fs from 'node:fs';

/** 讀取 JSON；檔案不存在或損壞時回傳 fallback（不拋出） */
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 寫入 JSON（同步、格式化），回傳寫入的資料本身 */
export function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}

export default { readJson, writeJson };
