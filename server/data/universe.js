/**
 * universe.js — 標的宇宙管理：證券名單、股票池、自選清單、名稱對照。
 */
import path from 'node:path';
import { Cache, TTL, cached } from '../lib/cache.js';
import log from '../lib/logger.js';
import * as hkex from './providers/hkex.js';
import { popularList } from './pools.js';
import { norm } from '../lib/code.js';          // 代號正規化單一來源（港股補零／美股大寫）
import { readJson, writeJson } from '../lib/store.js'; // JSON 讀寫單一來源
import { STORE_DIR, CACHE_DIR, ensureDirs } from '../lib/paths.js';

const TAG = 'universe';
ensureDirs();

export const cache = new Cache(CACHE_DIR, 400);

const WATCHLIST_FILE = path.join(STORE_DIR, 'watchlist.json');
const ALIAS_FILE = path.join(STORE_DIR, 'name-alias.json');

/** 自選清單 */
export const watchlist = {
  get: () => readJson(WATCHLIST_FILE, { codes: [] }).codes,
  set: (codes) => writeJson(WATCHLIST_FILE, { codes: [...new Set(codes.map((c) => norm(c)))] }).codes,
  add: (code) => {
    const c = norm(code);
    const list = watchlist.get();
    if (!list.includes(c)) list.push(c);
    return watchlist.set(list);
  },
  remove: (code) => watchlist.set(watchlist.get().filter((c) => c !== norm(code))),
};

/** 名稱對照（使用者可覆寫，或由外部來源補齊） */
export const alias = {
  get: () => readJson(ALIAS_FILE, {}),
  set: (map) => writeJson(ALIAS_FILE, map),
  put: (code, zh) => {
    const m = alias.get();
    m[norm(code)] = zh;
    return alias.set(m);
  },
};

/** 完整證券名單（7 天快取） */
export async function getUniverse({ force = false } = {}) {
  return cached(cache, 'universe:all', TTL.universe, async () => {
    const { list, asOf, source } = await hkex.fetchUniverse();
    return { list, asOf, source, count: list.length };
  }, { force });
}

/** 依池別取得標的清單 */
export async function getPool(pool = 'popular', { codes = [], force = false } = {}) {
  if (pool === 'popular') {
    const list = popularList();
    return { pool, items: list.map((x) => ({ code: x.code, zh: x.zh || null, tag: x.tag })), count: list.length };
  }
  if (pool === 'watchlist') {
    const wl = watchlist.get();
    const zh = alias.get();
    return { pool, items: wl.map((c) => ({ code: c, zh: zh[c] || null, tag: '自選' })), count: wl.length };
  }
  if (pool === 'custom') {
    const zh = alias.get();
    return {
      pool,
      items: codes.map((raw) => {
        const c = norm(raw);
        return { code: c, zh: zh[c] || null, tag: '自訂' };
      }),
      count: codes.length,
    };
  }
  const uni = await getUniverse({ force });
  const zh = alias.get();
  return {
    pool,
    items: uni.list.map((s) => ({ code: s.code, zh: zh[s.code] || null, tag: s.subCategory || s.category, name: s.name })),
    count: uni.list.length,
    asOf: uni.asOf,
  };
}

/** 單一代號查名稱（先查別名，再查名單） */
export async function resolveName(code) {
  const c = norm(code);
  const zh = alias.get()[c];
  if (zh) return { code: c, zh, en: null };
  try {
    const uni = await getUniverse();
    const hit = uni.list.find((x) => x.code === c);
    return { code: c, zh: null, en: hit?.name ?? null };
  } catch (e) {
    log.warn(TAG, '名稱解析失敗', e.message);
    return { code: c, zh: null, en: null };
  }
}
