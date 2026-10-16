/** api.js — 前端對後端 REST 的封裝 */
import { reactive } from '../vendor/vue.esm-browser.prod.js';

async function req(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (body && body.error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export const api = {
  get: (path) => req(path),
  post: (path, data) => req(path, { method: 'POST', body: JSON.stringify(data || {}) }),
  put: (path, data) => req(path, { method: 'PUT', body: JSON.stringify(data || {}) }),
  del: (path) => req(path, { method: 'DELETE' }),

  health: () => req('/api/health'),
  meta: () => req('/api/meta'),
  pools: () => req('/api/pools'),
  freshness: () => req('/api/freshness'),
  dailyPicks: (pool = 'popular', limit = 20) => req(`/api/daily-picks?pool=${encodeURIComponent(pool)}&limit=${limit}`),
  news: (market = 'all', limit = 10) => req(`/api/news?market=${encodeURIComponent(market)}&limit=${limit}`),
  overview: () => req('/api/market/overview'),
  refresh: (body) => req('/api/refresh', { method: 'POST', body: JSON.stringify(body) }),
  refreshAll: (body) => req('/api/refresh-all', { method: 'POST', body: JSON.stringify(body || {}) }),
  job: (id) => req(`/api/refresh/${id}`),
  screen: (body) => req('/api/screen', { method: 'POST', body: JSON.stringify(body) }),
  stock: (code, { range = '3y', live = false } = {}) => {
    const q = new URLSearchParams({ range });
    if (live) q.set('live', '1');
    return req(`/api/stock/${code}?${q.toString()}`);
  },
  analysis: (code, { range = '1y', live = false } = {}) => {
    const q = new URLSearchParams({ range });
    if (live) q.set('live', '1');
    return req(`/api/stock/${code}/analysis?${q.toString()}`);
  },
  report: (code, { range = '3y', live = false } = {}) => {
    const q = new URLSearchParams({ range });
    if (live) q.set('live', '1');
    return req(`/api/stock/${code}/report?${q.toString()}`);
  },
  movers: (pool = 'popular', limit = 15) => req(`/api/movers?pool=${encodeURIComponent(pool)}&limit=${limit}`),
  signals: (pool = 'popular', limit = 20) => req(`/api/signals?pool=${encodeURIComponent(pool)}&limit=${limit}`),
  usMovers: () => req('/api/us-movers'),
  usMoversRefresh: () => req('/api/us-movers/refresh', { method: 'POST', body: JSON.stringify({}) }),
  usMoversJob: () => req('/api/us-movers/job'),
  compare: (codes, range = '1y', live = false) => req('/api/compare', { method: 'POST', body: JSON.stringify({ codes, range, live }) }),
  backtest: (body) => req('/api/backtest', { method: 'POST', body: JSON.stringify(body) }),
  portfolio: () => req('/api/portfolio'),
  portfolioAdd: (h) => req('/api/portfolio', { method: 'POST', body: JSON.stringify(h) }),
  portfolioUpdate: (id, patch) => req(`/api/portfolio/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  portfolioRemove: (id) => req(`/api/portfolio/${id}`, { method: 'DELETE' }),
  alerts: () => req('/api/alerts'),
  alertAdd: (r) => req('/api/alerts', { method: 'POST', body: JSON.stringify(r) }),
  alertUpdate: (id, patch) => req(`/api/alerts/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  alertRemove: (id) => req(`/api/alerts/${id}`, { method: 'DELETE' }),
  alertCheck: () => req('/api/alerts/check', { method: 'POST', body: JSON.stringify({}) }),
  alertLogClear: () => req('/api/alerts-log', { method: 'DELETE' }),
  watchlist: () => req('/api/watchlist'),
  watchlistAdd: (code) => req('/api/watchlist', { method: 'POST', body: JSON.stringify({ code }) }),
  watchlistRemove: (code) => req(`/api/watchlist/${code}`, { method: 'DELETE' }),
  search: (q) => req(`/api/search?q=${encodeURIComponent(q)}`),
  clearCache: (prefix) => req('/api/cache/clear', { method: 'POST', body: JSON.stringify({ prefix }) }),
};

/** 全域 UI 狀態（提示訊息、載入中） */
export const ui = reactive({
  toasts: [],
  busy: 0,
  notify(msg, kind = 'info') {
    const id = Math.random().toString(36).slice(2);
    ui.toasts.push({ id, msg, kind });
    setTimeout(() => {
      const i = ui.toasts.findIndex((t) => t.id === id);
      if (i >= 0) ui.toasts.splice(i, 1);
    }, 3600);
  },
  error(msg) { ui.notify(msg, 'err'); },
});

/** 包住非同步呼叫：自動顯示忙碌與錯誤 */
export async function withBusy(fn, errMsg = '操作失敗') {
  ui.busy++;
  try {
    return await fn();
  } catch (e) {
    ui.error(`${errMsg}：${e.message}`);
    throw e;
  } finally {
    ui.busy--;
  }
}

export default api;
