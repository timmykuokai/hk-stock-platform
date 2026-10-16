/**
 * usMovers.js — 美股異動掃描頁面。
 * 三個榜單：成交額前 20 / 升幅前 20 / 跌幅前 20，參考 AAStocks 美股頁佈局。
 * 資料來源：Yahoo Finance（平台既定），成交額 ≈ 股價 × 成交量（美元）。
 */
import { defineComponent, ref, computed, onMounted, onUnmounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { fmtPrice, fmtPctRaw, fmtCompact, toneClass, fmtChg, fmtTime, fmtAge } from '../format.js';

export const UsMoversView = defineComponent({
  name: 'UsMoversView',
  setup() {
    const data = ref(null);
    const loading = ref(false);
    const building = ref(false);
    const progress = ref(null); // {done,total}
    const tab = ref('turnover'); // turnover | gainers | losers
    let timer = null;

    const TABS = [
      { id: 'turnover', icon: '💵', label: '成交額前 20' },
      { id: 'gainers', icon: '🚀', label: '升幅前 20' },
      { id: 'losers', icon: '📉', label: '跌幅前 20' },
    ];

    function stopPolling() {
      if (timer) { clearInterval(timer); timer = null; }
      building.value = false;
    }

    async function pollJob() {
      try {
        const job = await api.usMoversJob().catch(() => null);
        if (job) progress.value = { done: job.done, total: job.total };
        if (job && job.finishedAt) {
          // 工作完成，再抓一次榜單
          stopPolling();
          await load(false);
        }
      } catch {
        /* 輪詢失敗忽略，繼續 */
      }
    }

    async function load(allowAutoBuild = true) {
      loading.value = true;
      try {
        const r = await api.usMovers();
        if (r.status === 'empty') {
          data.value = null;
          if (allowAutoBuild) {
            await doRefresh();
          } else {
            ui.error('美股快照尚無資料，請稍後再試');
          }
          return;
        }
        data.value = r;
      } catch (e) {
        ui.error(`美股異動讀取失敗：${e.message}`);
      } finally {
        loading.value = false;
      }
    }

    async function doRefresh() {
      stopPolling();
      building.value = true;
      progress.value = { done: 0, total: data.value?.universe ?? null };
      try {
        await api.usMoversRefresh();
      } catch (e) {
        ui.error(`美股資料更新失敗：${e.message}`);
        building.value = false;
        return;
      }
      timer = setInterval(pollJob, 3000);
    }

    const rows = computed(() => {
      if (!data.value) return [];
      return data.value[tab.value] || [];
    });

    const asOfText = computed(() => (data.value?.asOf ? fmtTime(data.value.asOf) : '—'));
    const ageText = computed(() => fmtAge(data.value?.ageMinutes ?? null));

    onMounted(load);
    onUnmounted(stopPolling);

    return {
      data, loading, building, progress, tab, TABS, rows, asOfText, ageText,
      fmtPrice, fmtPctRaw, fmtCompact, toneClass, fmtChg,
      refresh: () => withBusy(doRefresh, '美股資料更新失敗'),
      open: (code) => window.open(`https://finance.yahoo.com/quote/${code}`, '_blank'),
    };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">🇺🇸 美股異動掃描</div>
        <div class="card-sub" v-if="data">數據時間 {{ asOfText }}（{{ ageText }}）· 涵蓋 {{ data.count }} / {{ data.universe }} 檔 · 失败 {{ data.failed }}</div>
        <div class="spacer"></div>
        <button class="btn sm" :class="{ accent: building }" @click="refresh" :disabled="building || loading">
          <span v-if="building">更新中… {{ progress ? progress.done + '/' + progress.total : '' }}</span>
          <span v-else>🔄 更新資料</span>
        </button>
      </div>
      <div class="card-body" style="padding-bottom:4px">
        <div class="chips">
          <button v-for="t in TABS" :key="t.id" class="chip" :class="{ active: tab === t.id }" @click="tab = t.id">
            {{ t.icon }} {{ t.label }}
          </button>
        </div>
        <div class="small muted" style="margin-top:6px">
          參考 AAStocks 美股頁佈局 · 資料源 Yahoo Finance · 成交額 ≈ 股價 × 成交量（美元，約值）
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">{{ (TABS.find(t=>t.id===tab)||{}).label }}</div>
        <div class="card-sub">{{ rows.length }} 筆</div>
      </div>
      <div class="card-body tight">
        <div v-if="loading && !data" class="empty">載入中…</div>
        <div v-else-if="building" class="empty">
          正在從 Yahoo Finance 抓取美股報價並建立快照…（{{ progress ? progress.done + ' / ' + progress.total : '準備中' }}）
        </div>
        <div v-else-if="!data" class="empty">尚無美股快照資料，請按「更新資料」建立。</div>
        <table class="data" v-else>
          <thead>
            <tr>
              <th style="width:34px">#</th>
              <th>代號</th>
              <th>名稱</th>
              <th style="width:96px">現價 (USD)</th>
              <th style="width:150px">當日升跌</th>
              <th style="width:110px">成交量</th>
              <th style="width:120px">成交額 (約)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.code" @click="open(r.code)" style="cursor:pointer">
              <td class="mono muted">{{ r.rank }}</td>
              <td class="mono">{{ r.code }}</td>
              <td class="txt">
                <div class="zname">{{ r.zhName || r.name || r.code }}</div>
                <div class="zsub" v-if="r.zhName && r.name && r.name !== r.zhName">{{ r.name }}</div>
              </td>
              <td>{{ fmtPrice(r.price) }}</td>
              <td :class="toneClass(r.changePercent)">
                {{ fmtChg(r.change) }} ({{ r.changePercent == null ? '—' : (r.changePercent > 0 ? '+' : '') + r.changePercent.toFixed(2) + '%' }})
              </td>
              <td class="mono">{{ fmtCompact(r.volume) }}</td>
              <td class="mono">{{ fmtCompact(r.turnover) }}</td>
            </tr>
            <tr v-if="!rows.length"><td class="txt muted" :colspan="7">此榜單目前無符合標的</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border)">
        <div class="section-note">
          成交額為「股價 × 當日成交量」估算值（美元），僅供排序參考，非官方統計口徑；點擊任一列可於新分頁開啟 Yahoo Finance 個股頁。
        </div>
      </div>
    </div>
  </div>
  `,
});

export default UsMoversView;
