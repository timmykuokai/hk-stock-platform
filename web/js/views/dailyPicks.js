/**
 * dailyPicks.js — 每日穩健收息推介。
 * 調用 /api/daily-picks：從熱門池篩選「穩健、低波動、每年派息」的標的，
 * 給出穩健收息評分與入選理由，並可一鍵「更新資料」刷新快照時間。
 */
import { defineComponent, ref, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtPrice, fmtPctRaw, toneClass, scoreClass, fmtTime, fmtAge, fmtChg } from '../format.js';

export const DailyPicksView = defineComponent({
  name: 'DailyPicksView',
  setup(_props, { emit }) {
    const data = ref(null);
    const loading = ref(false);
    const pool = ref('popular');

    async function load() {
      loading.value = true;
      try {
        data.value = await api.dailyPicks(pool.value, 20);
      } catch (e) {
        ui.error(`每日推介載入失敗：${e.message}`);
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    async function refresh() {
      await withBusy(async () => {
        await store.refreshData();
        await load();
      }, '更新資料失敗');
    }

    onMounted(load);

    const rows = computed(() => data.value?.items ?? []);
    const ageMinutes = computed(() => {
      if (!data.value?.asOf) return null;
      return Math.round((Date.now() - new Date(data.value.asOf).getTime()) / 60000);
    });
    const ageText = computed(() => fmtAge(ageMinutes.value));

    const open = (code) => emit('open', code);
    const addWatch = (code) => store.toggleWatch(code);
    const inWatch = (code) => store.watchlist.includes(code);

    return {
      data, loading, pool, rows, ageText, open, addWatch, inWatch, refresh,
      fmtPrice, fmtPctRaw, toneClass, scoreClass, fmtTime, fmtChg,
    };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">🌟 每日穩健收息推介</div>
        <div class="card-sub" v-if="data">推介基準：{{ fmtTime(data.asOf) }}（{{ ageText }}）· 母體 {{ data.universe }} 檔</div>
        <div class="spacer"></div>
        <button class="btn sm" @click="refresh" :disabled="loading || ui.busy">更新資料</button>
      </div>
      <div class="card-body" style="padding-bottom:4px">
        <div class="small muted">入選條件：流動性 ≥ 5,000 萬、市值 ≥ 200 億、殖利率 3%–10%、年化波動 ≤ 30%、連續派息 ≥ 3 年、本益比 0–25 倍，並排除一次性特別股息造成的異常殖利率。</div>
        <div class="chips" style="margin-top:8px">
          <span class="chip" v-for="(v, k) in (data?.criteria || {})" :key="k">{{ k }}：{{ v }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">推介清單</div>
        <div class="card-sub">{{ rows.length }} 檔 · 按「穩健收息分」由高至低排序</div>
      </div>
      <div class="card-body tight">
        <div v-if="loading && !data" class="empty">載入中…</div>
        <table class="data" v-else>
          <thead>
            <tr>
              <th style="width:34px">#</th>
              <th>代號</th>
              <th>名稱</th>
              <th style="width:88px">現價</th>
              <th style="width:110px">漲跌幅</th>
              <th style="width:88px">殖利率</th>
              <th style="width:84px">年化波動</th>
              <th style="width:78px">派息年數</th>
              <th style="width:74px">本益比</th>
              <th style="width:104px">穩健收息分</th>
              <th>入選理由</th>
              <th style="width:60px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.code" @click="open(r.code)" style="cursor:pointer">
              <td class="mono muted">{{ i + 1 }}</td>
              <td class="mono">{{ r.code }}</td>
              <td class="txt">{{ r.name || r.enName || '—' }}</td>
              <td>{{ fmtPrice(r.price) }}</td>
              <td :class="toneClass(r.changePercent)">{{ r.changePercent == null ? '—' : fmtChg(r.change) + ' (' + (r.changePercent > 0 ? '+' : '') + r.changePercent.toFixed(2) + '%)' }}</td>
              <td :class="r.dividendYieldTTM != null ? 'up' : ''">{{ r.dividendYieldTTM == null ? '—' : (r.dividendYieldTTM * 100).toFixed(1) + '%' }}</td>
              <td>{{ r.vol1y == null ? '—' : (r.vol1y * 100).toFixed(0) + '%' }}</td>
              <td class="mono">{{ r.dividendYears ?? '—' }}</td>
              <td class="mono">{{ r.pe == null ? '—' : r.pe.toFixed(1) }}</td>
              <td><span class="score-pill" :class="scoreClass(r.incomeScore)">{{ r.incomeScore }}</span></td>
              <td class="txt small">{{ (r.reasons || []).join(' · ') }}</td>
              <td><button class="btn sm ghost" @click.stop="addWatch(r.code)">{{ inWatch(r.code) ? '★' : '☆' }}</button></td>
            </tr>
            <tr v-if="!loading && !rows.length"><td class="txt muted" :colspan="12">目前沒有符合「穩健低波動收息」條件的標的，可嘗試「更新資料」或放寬條件。</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border)">
        <div class="section-note">本推介為量化篩選結果，僅供研究參考，不構成任何投資建議或個股推薦。股息與波動會隨市況變化，請自行審慎評估。</div>
      </div>
    </div>
  </div>
  `,
});

export default DailyPicksView;
