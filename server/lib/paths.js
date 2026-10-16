/**
 * paths.js — 專案路徑的單一來源。
 *
 * 過去 8 個模組各自用 `process.cwd()` 拼資料路徑（server/data/store ...），
 * 一旦從別的目錄啟動服務，資料就會寫到錯的地方、且讀不到既有資料。
 * 這裡一律以 import.meta.url 推導專案根，與啟動目錄無關。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url)); // <root>/server/lib
export const SERVER_DIR = path.resolve(LIB_DIR, '..');        // <root>/server
export const ROOT = path.resolve(SERVER_DIR, '..');           // <root>
export const WEB_DIR = path.join(ROOT, 'web');
export const VENDOR_DIR = path.join(WEB_DIR, 'vendor');
export const DATA_DIR = path.join(SERVER_DIR, 'data');
export const STORE_DIR = path.join(DATA_DIR, 'store');
export const CACHE_DIR = path.join(DATA_DIR, '.cache');
export const SNAPSHOT_DIR = path.join(STORE_DIR, 'snapshots');
export const NEWS_CACHE_DIR = path.join(STORE_DIR, 'news-cache');

/** 確保常用目錄存在（模組載入時呼叫一次即可） */
export function ensureDirs() {
  for (const d of [DATA_DIR, STORE_DIR, CACHE_DIR, SNAPSHOT_DIR, NEWS_CACHE_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export default {
  ROOT, SERVER_DIR, WEB_DIR, VENDOR_DIR, DATA_DIR, STORE_DIR, CACHE_DIR, SNAPSHOT_DIR, NEWS_CACHE_DIR, ensureDirs,
};
