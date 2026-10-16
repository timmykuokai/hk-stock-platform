/**
 * settings.js — 系統設定：資料源健康、快取、快照、自選清單
 */
import { defineComponent, ref, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtTime, fmtCompact } from '../format.js';

export const SettingsView = defineComponent({
  name: 'SettingsView',
  setup() {
    const health = ref(null);
    const pools = ref([]);
    const jobs = ref(null);
    const newCode = ref('');

    async function load() {
      try {
        await store.refreshHealth();
        health.value = store.health;
        const p = await api.pools();
        pools.value = p.pools || [];
      } catch (e) {
        ui.error(`載入失敗：${e.message}`);
      }
    }

    async function refreshPool(pool, withFundamentals = false) {
      try {
        const r = await withBusy(() => api.refresh({ pool, withFundamentals }), '更新失敗');
        jobs.value = { jobId: r.jobId, total: r.total, done: 0, pool };
        poll();
      } catch { /* handled */ }
    }

    let timer = null;
    function poll() {
      clearInterval(timer);
      timer = setInterval(async () => {
        if (!jobs.value?.jobId) return;
        try {
          const j = await api.job(jobs.value.jobId);
          jobs.value = { ...j, pool: jobs.value.pool };
          if (j.finishedAt) { clearInterval(timer); jobs.value = null; await load(); }
        } catch { clearInterval(timer); jobs.value = null; }
      }, 1200);
    }

    async function clearCache(prefix) {
      try {
        await withBusy(() => api.clearCache(prefix), '清除失敗');
        ui.notify('快取已清除');
        await load();
      } catch { /* handled */ }
    }

    async function addWatch() {
      if (!newCode.value) return;
      try {
        await store.toggleWatch(String(newCode.value).trim());
        newCode.value = '';
      } catch { /* ignore */ }
    }

    const cache = computed(() => health.value?.cache ?? null);
    const providers = computed(() => health.value?.providers ?? []);

    onMounted(load);

    return { health, pools, jobs, cache, providers, refreshPool, clearCache, newCode, addWatch, store, fmtTime, fmtCompact };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head"><div class="card-title">資料源狀態</div>
        <div class="card-sub" v-if="health?.checkedAt">{{ fmtTime(health.checkedAt) }}</div>
        <div class="spacer"></div>
        <button class="btn sm" @click="load">重新檢測</button>
      </div>
      <div class="card-body tight">
        <table class="data">
          <thead><tr><th>來源</th><th>用途</th><th>狀態</th><th>HTTP</th><th>延遲</th></tr></thead>
          <tbody>
            <tr v-for="p in providers" :key="p.id">
              <td class="txt"><b>{{ p.label }}</b></td>
              <td class="txt small">{{ p.role }}</td>
              <td><span class="tag" :class="p.ok ? 'up' : 'down'">{{ p.ok ? '正常' : '異常' }}</span></td>
              <td>{{ p.status ?? '—' }}</td>
              <td>{{ p.latencyMs == null ? '—' : p.latencyMs + ' ms' }}</td>
            </tr>
            <tr v-if="!providers.length"><td class="txt muted" colspan="5">尚無檢測結果</td></tr>
          </tbody>
        </table>
        <div class="section-note">
          主要行情／K 線／股息／基本面欄位來自 Yahoo Finance（免金鑰）；etnet 二十大成交榜作為熱門度的外部交叉驗證。
          Finnhub 免費方案不開放港股行情（HTTP 403），故未作為預設來源。
        </div>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">快取</div><div class="card-sub">兩層：記憶體 + 磁碟</div></div>
        <div class="card-body">
          <div class="kv">
            <div class="kv-item"><div class="kv-k">磁碟檔案</div><div class="kv-v">{{ cache?.count ?? '—' }}</div></div>
            <div class="kv-item"><div class="kv-k">佔用空間</div><div class="kv-v">{{ cache ? (cache.bytes/1048576).toFixed(1) + ' MB' : '—' }}</div></div>
            <div class="kv-item"><div class="kv-k">記憶體筆數</div><div class="kv-v">{{ cache?.memory ?? '—' }}</div></div>
            <div class="kv-item"><div class="kv-k">命中 / 未命中</div><div class="kv-v small">{{ health?.cacheStats?.hit ?? 0 }} / {{ health?.cacheStats?.miss ?? 0 }}</div></div>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap">
            <button class="btn sm" @click="clearCache('')">全部清除</button>
            <button class="btn sm" @click="clearCache('bars')">清除 K 線</button>
            <button class="btn sm" @click="clearCache('fund')">清除基本面</button>
            <button class="btn sm" @click="clearCache('quote')">清除報價</button>
          </div>
          <div class="section-note">TTL：報價 1 分鐘、K 線 30 分鐘、基本面 12 小時、證券名單 7 天。來源失敗時自動降級使用最後一筆可用快取，並標記為過期資料。</div>
        </div>
      </div>

      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">池快照</div></div>
        <div class="card-body tight">
          <div v-for="p in pools" :key="p.pool" class="rule-row">
            <b>{{ p.label }}</b>
            <span class="small muted" v-if="p.snapshot">{{ p.snapshot.count }} 檔 · {{ fmtTime(p.snapshot.asOf) }} · {{ p.snapshot.ageMinutes }} 分鐘前</span>
            <span class="tag" :class="p.snapshot?.fresh ? 'up' : 'warn'" v-if="p.snapshot">{{ p.snapshot.fresh ? '新鮮' : '待更新' }}</span>
            <span class="small muted" v-else>尚未建立</span>
            <div class="spacer"></div>
            <button class="btn sm" @click="refreshPool(p.pool)">更新</button>
            <button class="btn sm" @click="refreshPool(p.pool, true)">更新（含基本面）</button>
          </div>
          <div v-if="jobs" style="padding:10px">
            <div class="progress"><i :style="{ width: (jobs.total ? jobs.done / jobs.total * 100 : 0) + '%' }"></i></div>
            <div class="small muted" style="margin-top:4px">{{ jobs.pool }}：{{ jobs.done }}/{{ jobs.total }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">自選清單</div><div class="card-sub">{{ store.watchlist.length }} 檔</div></div>
      <div class="card-body">
        <div class="filters">
          <input v-model="newCode" placeholder="輸入代號後按加入" style="width:150px" />
          <button class="btn" @click="addWatch">加入</button>
        </div>
        <div class="chips" style="margin-top:10px">
          <span v-for="c in store.watchlist" :key="c" class="chip" @click="store.toggleWatch(c)">{{ c }} ✕</span>
          <span v-if="!store.watchlist.length" class="small muted">清單為空</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">資料驗證機制</div></div>
      <div class="card-body">
        <ul class="small" style="margin:0 0 0 18px; padding:0; color:var(--text-2); line-height:1.9">
          <li>K 線清洗：剔除不完整／重複日期資料，修正未涵蓋開收盤的高低價，單日異常變動僅標記不刪除。</li>
          <li>基本面欄位：以合理性區間驗證（如殖利率 0–50%、ROE ±500%），超出者視為缺值，不臆測。</li>
          <li>百分比／金額統一轉為小數與絕對數值後才進入模型，避免單位錯誤。</li>
          <li>評分缺值處理：缺資料維度不計分，權重重分配並揭露覆蓋率。</li>
          <li>回測只用再平衡日之前的資料計算指標，避免前視偏誤。</li>
        </ul>
      </div>
    </div>
  </div>
  `,
});

export default SettingsView;
