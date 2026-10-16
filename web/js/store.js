/** store.js — 前端共用狀態（元資料、大盤概況、自選清單、系統健康） */
import { reactive } from '../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from './api.js';

export const store = reactive({
  meta: null,
  overview: null,
  watchlist: [],
  health: null,
  freshness: null,
  ready: false,

  async init() {
    try {
      store.meta = await api.meta();
    } catch (e) {
      console.warn('meta 載入失敗', e);
    }
    try {
      store.watchlist = (await api.watchlist()).codes || [];
    } catch { /* ignore */ }
    store.refreshOverview();
    store.refreshFreshness();
    store.ready = true;
  },

  async refreshOverview() {
    try {
      store.overview = await api.overview();
    } catch { /* ignore */ }
  },

  /** 拉取各池最後更新時間（資料新鮮度） */
  async refreshFreshness() {
    try {
      store.freshness = await api.freshness();
    } catch { /* ignore */ }
  },

  /**
   * 立即更新「所有資料」：重建熱門池＋自選池快照，並強制刷新指數與成交榜。
   * 透過 /api/refresh-all 在背景執行，前端輪詢進度，完成後刷新新鮮度與大盤概況。
   * 用於頂欄「更新全部資料」按鈕與每日推介頁的重新整理。
   */
  async refreshData(opts = {}) {
    ui.busy++;
    try {
      const r = await api.refreshAll(typeof opts === 'string' ? { pool: opts } : opts);
      if (r?.jobId) {
        for (let i = 0; i < 180; i++) {
          await new Promise((res) => setTimeout(res, 2000));
          const job = await api.job(r.jobId).catch(() => null);
          if (job?.finishedAt) break;
        }
      }
      await store.refreshFreshness();
      await store.refreshOverview();
      ui.notify('全部資料已更新');
    } catch (e) {
      ui.error(`更新資料失敗：${e.message}`);
    } finally {
      ui.busy--;
    }
  },

  async refreshHealth() {
    try {
      store.health = await api.health();
    } catch (e) {
      store.health = { error: e.message };
    }
  },

  async toggleWatch(code) {
    try {
      if (store.watchlist.includes(code)) {
        store.watchlist = (await api.watchlistRemove(code)).codes;
      } else {
        store.watchlist = (await api.watchlistAdd(code)).codes;
      }
    } catch (e) {
      /* ignore */
    }
  },

  metricDef(key) {
    return store.meta?.metricDefs?.find((m) => m.key === key) || { key, label: key, fmt: 'num' };
  },
});

export { withBusy };
export default store;
