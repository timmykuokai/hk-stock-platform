/**
 * backtest.js — 自訂策略回測
 */
import { defineComponent, ref, reactive, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtPct, fmtNum, fmtCompact, toneClass, fmtDate } from '../format.js';
import { LineChart } from '../components/charts.js';

const PRESETS_BT = [
  { id: 'momentum-top10', label: '動能輪動 Top10（月）', cfg: { rankBy: 'momentum60', topN: 10, rebalance: 'monthly', filters: { minTurnover: 5e7 } } },
  { id: 'lowvol-top10', label: '低波動 Top10（月）', cfg: { rankBy: 'lowvol', topN: 10, rebalance: 'monthly', filters: { minTurnover: 5e7 } } },
  { id: 'dividend-top10', label: '高息 Top10（季）', cfg: { rankBy: 'dividendYield', topN: 10, rebalance: 'quarterly', filters: { minYield: 0.03 } } },
  { id: 'sharpe-top15', label: '夏普 Top15（季）', cfg: { rankBy: 'sharpe', topN: 15, rebalance: 'quarterly', filters: { maxVol: 0.5 } } },
];

export const BacktestView = defineComponent({
  name: 'BacktestView',
  components: { LineChart },
  setup() {
    const cfg = reactive({
      pool: 'popular',
      universeLimit: 80,
      start: defaultStart(),
      end: new Date().toISOString().slice(0, 10),
      rebalance: 'monthly',
      rankBy: 'momentum60',
      topN: 10,
      weightMode: 'equal',
      costBps: 15,
      range: '5y',
      filters: { minTurnover: 5e7, maxVol: null, minYield: null, aboveMa200: false },
    });
    const result = ref(null);
    const loading = ref(false);
    const rankers = computed(() => store.meta?.rankers ?? {});

    function defaultStart() {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 5);
      return d.toISOString().slice(0, 10);
    }

    async function run() {
      loading.value = true;
      try {
        const filters = {};
        if (cfg.filters.minTurnover) filters.minTurnover = Number(cfg.filters.minTurnover);
        if (cfg.filters.maxVol) filters.maxVol = Number(cfg.filters.maxVol);
        if (cfg.filters.minYield) filters.minYield = Number(cfg.filters.minYield);
        if (cfg.filters.aboveMa200) filters.aboveMa200 = true;
        result.value = await withBusy(() => api.backtest({
          pool: cfg.pool,
          universeLimit: cfg.universeLimit,
          start: cfg.start,
          end: cfg.end,
          rebalance: cfg.rebalance,
          rankBy: cfg.rankBy,
          topN: cfg.topN,
          weightMode: cfg.weightMode,
          costBps: cfg.costBps,
          range: cfg.range,
          filters,
        }), '回測失敗');
      } catch (e) {
        result.value = null;
      } finally {
        loading.value = false;
      }
    }

    function applyPreset(p) {
      Object.assign(cfg, p.cfg);
      cfg.filters = { minTurnover: null, maxVol: null, minYield: null, aboveMa200: false, ...(p.cfg.filters || {}) };
    }

    const series = computed(() => {
      if (!result.value) return [];
      const eq = result.value.equity ?? [];
      const bm = result.value.benchmark ?? [];
      return [
        { name: '策略', color: '#1f5eff', points: eq.map((p) => ({ date: p.date, v: p.v })) },
        { name: '基準（恒指）', color: '#8b95a3', points: bm.map((p) => ({ date: p.date, v: p.v })) },
      ];
    });

    const stats = computed(() => result.value?.stats ?? null);
    const lastReb = computed(() => (result.value?.rebalances ?? []).slice(-1)[0] ?? null);

    onMounted(() => { /* 不自動執行，避免長時間等待 */ });

    return { cfg, result, loading, rankers, series, stats, lastReb, run, applyPreset, PRESETS_BT, fmtPct, fmtNum, fmtCompact, toneClass, fmtDate };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head"><div class="card-title">策略設定</div>
        <div class="card-sub">指標只用再平衡日「當下可見」的資料計算，避免前視偏誤</div></div>
      <div class="card-body">
        <div class="chips" style="margin-bottom:12px">
          <button v-for="p in PRESETS_BT" :key="p.id" class="chip" @click="applyPreset(p)">{{ p.label }}</button>
        </div>
        <div class="filters">
          <label class="field"><span>候選池</span>
            <select v-model="cfg.pool">
              <option value="popular">熱門池</option>
              <option value="mainboard">主板（需已有快照）</option>
              <option value="watchlist">自選清單</option>
            </select>
          </label>
          <label class="field"><span>候選檔數上限</span><input type="number" v-model.number="cfg.universeLimit" min="5" max="600" style="width:90px" /></label>
          <label class="field"><span>起始日</span><input type="date" v-model="cfg.start" /></label>
          <label class="field"><span>結束日</span><input type="date" v-model="cfg.end" /></label>
          <label class="field"><span>再平衡</span>
            <select v-model="cfg.rebalance">
              <option value="monthly">每月</option>
              <option value="quarterly">每季</option>
              <option value="weekly">每週</option>
              <option value="buyhold">買入持有</option>
            </select>
          </label>
          <label class="field"><span>排名依據</span>
            <select v-model="cfg.rankBy">
              <option v-for="(label,k) in rankers" :key="k" :value="k">{{ label }}</option>
            </select>
          </label>
          <label class="field"><span>持股檔數</span><input type="number" v-model.number="cfg.topN" min="1" max="50" style="width:80px" /></label>
          <label class="field"><span>加權方式</span>
            <select v-model="cfg.weightMode">
              <option value="equal">等權</option>
              <option value="inverseVol">波動倒數</option>
            </select>
          </label>
          <label class="field"><span>單邊成本 (bps)</span><input type="number" v-model.number="cfg.costBps" min="0" max="200" style="width:80px" /></label>
        </div>

        <div class="filters" style="margin-top:12px">
          <label class="field"><span>最小 20 日均成交額</span><input type="number" v-model="cfg.filters.minTurnover" style="width:130px" /></label>
          <label class="field"><span>最大 60 日波動度（0.35=35%）</span><input type="number" step="0.01" v-model="cfg.filters.maxVol" style="width:110px" /></label>
          <label class="field"><span>最小殖利率（0.03=3%）</span><input type="number" step="0.005" v-model="cfg.filters.minYield" style="width:110px" /></label>
          <label class="field" style="flex-direction:row; align-items:center; gap:6px">
            <input type="checkbox" v-model="cfg.filters.aboveMa200" /> 僅站上 200 日均線
          </label>
          <div class="spacer"></div>
          <button class="btn primary" @click="run" :disabled="loading">{{ loading ? '回測中…' : '執行回測' }}</button>
        </div>
        <div class="section-note">首次執行會抓取候選池 5 年日 K（並寫入快取），約需數十秒；之後重跑同區間會快很多。</div>
      </div>
    </div>

    <div v-if="loading" class="card"><div class="empty">回測計算中，請稍候…</div></div>

    <template v-if="result && stats">
      <div class="card">
        <div class="card-head"><div class="card-title">績效摘要</div>
          <div class="spacer"></div>
          <span class="tag">{{ result.config.start }} ~ {{ result.config.end }}</span>
          <span class="tag accent">{{ result.config.rankerLabel }} · Top{{ result.config.topN }} · {{ result.config.rebalance }}</span>
          <span class="tag">候選 {{ result.config.universeSize }} 檔</span>
        </div>
        <div class="card-body">
          <div class="grid kpi">
            <div class="kpi"><div class="kpi-label">總報酬</div><div class="kpi-value" :class="toneClass(stats.totalReturn)">{{ fmtPct(stats.totalReturn, 1) }}</div><div class="kpi-sub">基準 {{ fmtPct(stats.benchTotalReturn, 1) }}</div></div>
            <div class="kpi"><div class="kpi-label">年化報酬</div><div class="kpi-value" :class="toneClass(stats.cagr)">{{ fmtPct(stats.cagr, 1) }}</div><div class="kpi-sub">基準 {{ fmtPct(stats.benchCagr, 1) }}</div></div>
            <div class="kpi"><div class="kpi-label">超額報酬</div><div class="kpi-value" :class="toneClass(stats.excessReturn)">{{ fmtPct(stats.excessReturn, 1) }}</div><div class="kpi-sub">相對恒指</div></div>
            <div class="kpi"><div class="kpi-label">年化波動</div><div class="kpi-value">{{ fmtPct(stats.volatility, 1) }}</div><div class="kpi-sub">夏普 {{ stats.sharpe == null ? '—' : stats.sharpe.toFixed(2) }}</div></div>
            <div class="kpi"><div class="kpi-label">最大回撤</div><div class="kpi-value down">{{ fmtPct(stats.maxDrawdown, 1) }}</div><div class="kpi-sub">基準 {{ fmtPct(stats.benchMaxDrawdown, 1) }}</div></div>
            <div class="kpi"><div class="kpi-label">月度勝率</div><div class="kpi-value">{{ fmtPct(stats.monthlyWinRate, 0) }}</div><div class="kpi-sub">週轉率 {{ result.annualTurnover == null ? '—' : (result.annualTurnover*100).toFixed(0) + '%/年' }}</div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">淨值曲線</div><div class="card-sub">起始 100</div></div>
        <div class="card-body"><LineChart :series="series" :height="320" :y-fmt="(v)=>v.toFixed(0)" /></div>
      </div>

      <div class="grid cols-2">
        <div class="card" style="margin-top:0">
          <div class="card-head"><div class="card-title">年度報酬</div></div>
          <div class="card-body tight">
            <table class="data">
              <thead><tr><th>年度</th><th>策略報酬</th></tr></thead>
              <tbody>
                <tr v-for="y in stats.yearly" :key="y.year">
                  <td class="txt">{{ y.year }}</td>
                  <td :class="toneClass(y.ret)">{{ fmtPct(y.ret, 1) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card" style="margin-top:0">
          <div class="card-head"><div class="card-title">最近一次再平衡持股</div>
            <div class="card-sub" v-if="lastReb">{{ lastReb.date }} · {{ lastReb.count }} 檔</div></div>
          <div class="card-body tight">
            <table class="data">
              <thead><tr><th>代號</th><th>權重</th><th>60日動能</th><th>波動</th><th>殖利率</th></tr></thead>
              <tbody>
                <tr v-for="h in (lastReb?.metrics || [])" :key="h.code">
                  <td class="txt"><b>{{ h.code }}</b></td>
                  <td>{{ ((lastReb.weights[h.code] || 0) * 100).toFixed(1) }}%</td>
                  <td :class="toneClass(h.ret60)">{{ fmtPct(h.ret60, 1) }}</td>
                  <td>{{ fmtPct(h.vol60, 1) }}</td>
                  <td>{{ fmtPct(h.divYield, 2) }}</td>
                </tr>
                <tr v-if="!lastReb"><td class="txt muted" colspan="5">尚無再平衡紀錄</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">再平衡紀錄</div><div class="card-sub">共 {{ result.rebalances.length }} 次</div></div>
        <div class="card-body tight scroll-x" style="max-height:300px; overflow-y:auto">
          <table class="data">
            <thead><tr><th>日期</th><th>檔數</th><th>持股</th></tr></thead>
            <tbody>
              <tr v-for="r in result.rebalances.slice().reverse().slice(0, 60)" :key="r.date">
                <td class="txt">{{ r.date }}</td>
                <td>{{ r.count }}</td>
                <td class="txt small">{{ r.codes.join('、') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
  `,
});

export default BacktestView;
