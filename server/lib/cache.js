/**
 * cache.js — 兩層快取（記憶體 L1 + 磁碟 L2），具 TTL、版本命名空間與命中統計。
 * 設計目標：外部 API 呼叫最小化 + 服務重啟後仍可離線讀取。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import log from './logger.js';

const TAG = 'cache';

export class Cache {
  /**
   * @param {string} dir 磁碟快取目錄
   * @param {number} maxMemory 記憶體最多保留筆數
   */
  constructor(dir, maxMemory = 800) {
    this.dir = dir;
    this.maxMemory = maxMemory;
    this.mem = new Map(); // key -> {value, expires, ns}
    this.stats = { hit: 0, miss: 0, stale: 0, write: 0, diskRead: 0 };
    fs.mkdirSync(dir, { recursive: true });
  }

  _file(key) {
    const h = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
    const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
    return path.join(this.dir, `${safe}.${h}.json`);
  }

  /** 讀取（不過期檢查以外，另可要求新鮮度） */
  get(key) {
    const now = Date.now();
    const m = this.mem.get(key);
    if (m && m.expires > now) {
      this.stats.hit++;
      return { value: m.value, age: now - m.storedAt, source: 'memory' };
    }
    const f = this._file(key);
    try {
      const raw = fs.readFileSync(f, 'utf8');
      const rec = JSON.parse(raw);
      this.stats.diskRead++;
      // 回寫 L1
      this.mem.set(key, { value: rec.value, expires: rec.expires, storedAt: rec.storedAt });
      const fresh = rec.expires > now;
      if (fresh) this.stats.hit++;
      else this.stats.stale++;
      return { value: rec.value, age: now - rec.storedAt, source: 'disk', stale: !fresh };
    } catch {
      this.stats.miss++;
      return { value: undefined, source: 'miss' };
    }
  }

  /** 取得「可用」值：新鮮直接用；過期則回傳 stale 值供降級（不自動刷新） */
  getUsable(key) {
    const r = this.get(key);
    if (r.value === undefined) return r;
    return r;
  }

  set(key, value, ttlMs) {
    const now = Date.now();
    const expires = now + ttlMs;
    this.mem.set(key, { value, expires, storedAt: now });
    if (this.mem.size > this.maxMemory) {
      // 簡單 FIFO 淘汰
      const firstKey = this.mem.keys().next().value;
      this.mem.delete(firstKey);
    }
    try {
      fs.writeFileSync(this._file(key), JSON.stringify({ value, expires, storedAt: now }));
      this.stats.write++;
    } catch (e) {
      log.warn(TAG, '磁碟快取寫入失敗', e.message);
    }
    return value;
  }

  /** 直讀磁碟（不論是否過期） */
  peek(key) {
    try {
      const rec = JSON.parse(fs.readFileSync(this._file(key), 'utf8'));
      return rec;
    } catch (e) {
      log.debug(TAG, `peek 讀不到：${key}`, e.message);
      return null;
    }
  }

  clear(prefix = '') {
    for (const k of [...this.mem.keys()]) if (k.startsWith(prefix)) this.mem.delete(k);
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!prefix || f.startsWith(prefix.replace(/[^a-zA-Z0-9._-]/g, '_'))) {
          fs.unlinkSync(path.join(this.dir, f));
        }
      }
    } catch (e) {
      log.warn(TAG, '清除磁碟快取失敗', e.message);
    }
  }

  size() {
    let bytes = 0;
    let count = 0;
    try {
      for (const f of fs.readdirSync(this.dir)) {
        const st = fs.statSync(path.join(this.dir, f));
        bytes += st.size;
        count++;
      }
    } catch { /* ignore */ }
    return { count, bytes, memory: this.mem.size };
  }
}

/** 常用 TTL（毫秒） */
export const TTL = {
  quote: 60_000,            // 即時報價：1 分鐘
  bars: 30 * 60_000,        // 歷史 K 線：30 分鐘（收盤後可自動延長）
  fundamentals: 12 * 3600_000, // 基本面：12 小時
  universe: 7 * 24 * 3600_000, // 證券名單：7 天
  metrics: 30 * 60_000,
};

/**
 * 記憶化包裝：先查快取，未命中或過期才執行 loader。
 * 若 loader 失敗且存在過期資料，回傳過期資料並標記 stale（降級可用）。
 */
export async function cached(cache, key, ttl, loader, opts = {}) {
  const { force = false, allowStale = true } = opts;
  if (!force) {
    const hit = cache.get(key);
    if (hit.value !== undefined && !hit.stale) {
      return { ...hit.value, _cache: { hit: true, source: hit.source, age: hit.age } };
    }
    if (hit.value !== undefined && hit.stale && allowStale) {
      // 先回傳舊值（快速），背景刷新
      refreshBackground(cache, key, ttl, loader);
      return { ...hit.value, _cache: { hit: true, source: hit.source, age: hit.age, stale: true } };
    }
  }
  try {
    const value = await loader();
    cache.set(key, value, ttl);
    return { ...value, _cache: { hit: false, source: 'network', age: 0 } };
  } catch (err) {
    const rec = cache.peek(key);
    if (rec) {
      log.warn(TAG, `loader 失敗，降級使用快取：${key}`, err.message);
      return { ...rec.value, _cache: { hit: true, source: 'disk', stale: true, error: err.message } };
    }
    throw err;
  }
}

function refreshBackground(cache, key, ttl, loader) {
  loader()
    .then((v) => cache.set(key, v, ttl))
    .catch((e) => log.debug(TAG, `背景刷新失敗（下次請求再試）：${key}`, e.message));
}
