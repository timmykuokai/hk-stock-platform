/**
 * http.js — 統一的外部請求層：逾時、重試、指數退避、UA 偽裝、並發節流。
 * 所有資料供應商都必須透過這裡發請求，方便統一治理與觀測。
 */
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import log from './logger.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** 並發節流器 */
export function createLimiter(max = 8) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job.fn().finally(() => { active--; next(); });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({
        fn: () => fn().then(resolve, reject),
      });
      next();
    });
}

/**
 * 具重試的 fetch
 * @param {string} url
 * @param {{timeout?:number, retries?:number, headers?:object, accept?:string}} opts
 */
export async function request(url, opts = {}) {
  const { timeout = 15000, retries = 2, headers = {}, method = 'GET', body } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = Math.min(4000, 300 * 2 ** (attempt - 1)) + Math.random() * 200;
      await sleep(wait);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        body,
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8', ...headers },
      });
      clearTimeout(timer);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new HttpError(res.status, url, text.slice(0, 300));
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) break;
    }
  }
  throw lastErr;
}

export async function getJson(url, opts = {}) {
  const res = await request(url, { headers: { Accept: 'application/json' }, ...opts });
  return res.json();
}

export async function getText(url, opts = {}) {
  const res = await request(url, opts);
  return res.text();
}

export async function getBuffer(url, opts = {}) {
  const res = await request(url, opts);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/** 並行 map，保留順序，可限制並發 */
export async function mapLimit(items, limit, fn) {
  const run = createLimiter(limit);
  return Promise.all(items.map((it, i) => run(() => fn(it, i))));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 以 node:http(s) 直接抓取文字（用於 header 特別大的網頁，如 Yahoo 報價頁）。
 * fetch/undici 對回應標頭大小有嚴格上限，會丟 UND_ERR_HEADERS_OVERFLOW，故保留此通道。
 */
export function requestRaw(url, opts = {}) {
  const { timeout = 25000, headers = {}, maxRedirects = 5, maxHeaderSize = 262144 } = opts;
  return new Promise((resolve, reject) => {
    const run = (u, depth) => {
      const lib = u.startsWith('https') ? https : http;
      let req;
      try {
        req = lib.request(u, {
          method: 'GET',
          timeout,
          maxHeaderSize,
          headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            ...headers,
          },
        }, (res) => {
          const { statusCode, headers: h } = res;
          if (statusCode >= 300 && statusCode < 400 && h.location && depth < maxRedirects) {
            res.resume();
            run(new URL(h.location, u).toString(), depth + 1);
            return;
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let buf = Buffer.concat(chunks);
            const enc = String(h['content-encoding'] || '').toLowerCase();
            try {
              if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
              else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
              else if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf);
            } catch { /* 保持原樣 */ }
            resolve({ status: statusCode, headers: h, body: buf.toString('utf8') });
          });
        });
      } catch (e) {
        reject(e);
        return;
      }
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('請求逾時')));
      req.end();
    };
    run(url, 0);
  });
}

/** 抓取文字，失敗時改用 raw 通道（自動處理大標頭） */
export async function getTextRobust(url, opts = {}) {
  try {
    return await getText(url, opts);
  } catch (e) {
    const msg = String(e?.cause?.code || e.message || '');
    if (!msg.includes('HEADERS_OVERFLOW')) throw e;
    log.debug('http', '改用 raw 通道抓取（標頭過大）', url);
    const r = await requestRaw(url, opts);
    if (r.status >= 400) throw new Error(`HTTP ${r.status} ${url}`);
    return r.body;
  }
}
