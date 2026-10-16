/**
 * screener.js — 多維度選股頁面
 * 左：池 + 策略模板 + 篩選條件 + 評分策略；右：結果表 + 評分分佈 + 散點圖
 */
import { defineComponent, ref, reactive, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtMetric, fmtPrice, fmtPctRaw, fmtCompact, scoreClass, toneClass, fmtChg } from '../format.js';
import { ScatterChart, HistChart, Sparkline } from '../components/charts.js';

export const ScreenerView = defineComponent({
  name: 'ScreenerView',
  components: { ScatterChart, HistChart, Sparkline },
  setup() {
    const pool = ref('popular');
    const preset = ref('balanced');
    const sortBy = ref('score');
    const sortDir = ref('desc');
    const limit = ref(60);
    const customCodes = ref('');
    const filters = ref([]);
    const result = ref(null);
    const loading = ref(false);
    const job = ref(null);
    const autoRefresh = ref(true);

    const newFilter = reactive({ key: 'turnover20d', op: 'gte', value: '', value2: '' });

    const metricDefs = computed(() => store.meta?.metricDefs ?? []);
    const presets = computed(() => store.meta?.presets ?? {});
    const templates = computed(() => store.meta?.templates ?? []);

    const grouped = computed(() => {
      const g = {};
      for (const d of metricDefs.value) (g[d.group] ||= []).push(d);
      return g;
    });

    function addFilter() {
      const v = Number(newFilter.value);
      if (!Number.isFinite(v) && newFilter.op !== 'between') { ui.error('請輸入有效數值'); return; }
      const f = { key: newFilter.key, op: newFilter.op, value: v };
      if (newFilter.op === 'between') f.value2 = Number(newFilter.value2);
      filters.value.push(f);
      newFilter.value = '';
      newFilter.value2 = '';
    }
    const removeFilter = (i) => filters.value.splice(i, 1);

    function applyTemplate(t) {
      filters.value = JSON.parse(JSON.stringify(t.filters));
      preset.value = t.preset;
      run();
    }

    async function run() {
      loading.value = true;
      try {
        const codes = pool.value === 'custom'
          ? customCodes.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
          : [];
        result.value = await api.screen({
          pool: pool.value,
          codes,
          filters: filters.value,
          preset: preset.value,
          sortBy: sortBy.value,
          sortDir: sortDir.value,
          limit: limit.value,
          autoRefresh: autoRefresh.value,
        });
      } catch (e) {
        result.value = null;
      } finally {
        loading.value = false;
      }
    }

    async function refreshData() {
      const codes = pool.value === 'custom'
        ? customCodes.value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
        : [];
      const r = await withBusy(() => api.refresh({ pool: pool.value, codes, withFundamentals: true }), '更新資料失敗');
      job.value = { jobId: r.jobId, total: r.total, done: 0 };
      poll();
    }

    let timer = null;
    function poll() {
      clearInterval(timer);
      timer = setInterval(async () => {
        if (!job.value?.jobId) return;
        try {
          const j = await api.job(job.value.jobId);
          job.value = j;
          if (j.finishedAt) {
            clearInterval(timer);
            job.value = null;
            await run();
          }
        } catch {
          clearInterval(timer);
        }
      }, 1200);
    }

    function sortByKey(key) {
      if (sortBy.value === key) sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
      else { sortBy.value = key; sortDir.value = 'desc'; }
      run();
    }

    const scatterPoints = computed(() => (result.value?.items ?? []).map((it) => ({
      x: it.metrics.vol1y, y: it.metrics.ret1y, r: it.metrics.marketCap || 0,
      score: it.score?.total ?? 0, code: it.code, name: it.zhName || it.name,
    })));
    const histValues = computed(() => (result.value?.items ?? []).map((it) => it.score?.total).filter((v) => v != null));

    const sparkValues = (it) => (it.metrics ? [it.metrics.ret1m, it.metrics.ret3m, it.metrics.ret6m, it.metrics.ret1y].filter(Number.isFinite) : []);

    onMounted(() => { if (!result.value) run(); });

    return {
      pool, preset, sortBy, sortDir, limit, customCodes, filters, newFilter, result, loading, job, autoRefresh,
      metricDefs, presets, templates, grouped, addFilter, removeFilter, applyTemplate, run, refreshData, sortByKey,
      scatterPoints, histValues, sparkValues, store, fmtMetric, fmtPrice, fmtPctRaw, fmtCompact, scoreClass, toneClass, fmtChg,
      fmt: (k, v) => fmtMetric(k, v),
    };
  },
  template: `
  <div>
    <div class="split">
      <!-- 篩選面板 -->
      <div class="card">
        <div class="card-head"><div class="card-title">篩選條件</div><div class="spacer"></div>
          <button class="btn sm" @click="filters = []">清空</button>
        </div>
        <div class="card-body">
          <label class="field" style="margin-bottom:10px">
            <span>掃描範圍</span>
            <select v-model="pool">
              <option value="popular">熱門池（大型股／指數成份）</option>
              <option value="watchlist">自選清單</option>
              <option value="mainboard">主板全部（較慢）</option>
              <option value="custom">自訂代號</option>
            </select>
          </label>
          <label class="field" v-if="pool === 'custom'" style="margin-bottom:10px">
            <span>代號（逗號或空白分隔）</span>
            <input v-model="customCodes" placeholder="00700, 09988, 01299" />
          </label>

          <div class="field" style="margin-bottom:10px">
            <span style="margin-bottom:4px">快速策略</span>
            <div class="chips">
              <button v-for="t in templates" :key="t.id" class="chip" @click="applyTemplate(t)" :title="t.desc">{{ t.label }}</button>
            </div>
          </div>

          <div class="field" style="margin-bottom:10px">
            <span style="margin-bottom:4px">評分策略</span>
            <select v-model="preset" style="width:100%">
              <option v-for="(p,k) in presets" :key="k" :value="k">{{ p.label }}</option>
            </select>
          </div>

          <div class="field">
            <span style="margin-bottom:4px">條件</span>
            <div class="filter-row" style="margin-bottom:6px; flex-wrap:wrap">
              <select v-model="newFilter.key" style="min-width:130px">
                <optgroup v-for="(list, g) in grouped" :key="g" :label="g">
                  <option v-for="d in list" :key="d.key" :value="d.key">{{ d.label }}</option>
                </optgroup>
              </select>
              <select v-model="newFilter.op">
                <option value="gte">≥</option>
                <option value="lte">≤</option>
                <option value="gt">&gt;</option>
                <option value="lt">&lt;</option>
                <option value="between">介於</option>
              </select>
              <input v-model="newFilter.value" style="width:88px" placeholder="值" />
              <input v-if="newFilter.op === 'between'" v-model="newFilter.value2" style="width:88px" placeholder="上限" />
              <button class="btn sm primary" @click="addFilter">新增</button>
            </div>
            <div v-if="!filters.length" class="small muted">尚未設定條件，將列出池中全部標的並依評分排序。</div>
            <div v-for="(f,i) in filters" :key="i" class="filter-row" style="margin-bottom:5px">
              <span style="min-width:110px">{{ (metricDefs.find(m=>m.key===f.key)||{}).label || f.key }}</span>
              <span class="mono">{{ {gte:'≥',lte:'≤',gt:'>',lt:'<',between:'介於'}[f.op] }}</span>
              <span class="mono">{{ fmt(f.key, f.value) }}</span>
              <span v-if="f.op==='between'" class="mono">~ {{ fmt(f.key, f.value2) }}</span>
              <div class="spacer"></div>
              <button class="btn sm ghost" @click="removeFilter(i)">✕</button>
            </div>
          </div>

          <div class="field" style="margin-top:12px">
            <span>顯示筆數</span>
            <input type="number" v-model.number="limit" min="5" max="500" />
          </div>
          <label class="small muted" style="display:flex;gap:6px;align-items:center;margin-top:8px">
            <input type="checkbox" v-model="autoRefresh" /> 無快照時自動更新資料
          </label>

          <div style="display:flex; gap:8px; margin-top:12px">
            <button class="btn primary" style="flex:1" @click="run" :disabled="loading">{{ loading ? '篩選中…' : '執行篩選' }}</button>
            <button class="btn" @click="refreshData" :disabled="!!job">更新資料</button>
          </div>
          <div v-if="job" style="margin-top:10px">
            <div class="progress"><i :style="{ width: (job.total ? (job.done / job.total * 100) : 0) + '%' }"></i></div>
            <div class="small muted" style="margin-top:4px">更新中 {{ job.done }}/{{ job.total }}</div>
          </div>
        </div>
      </div>

      <!-- 結果 -->
      <div>
        <div class="card">
          <div class="card-head">
            <div class="card-title">篩選結果</div>
            <span v-if="result" class="tag">{{ result.count }} 檔 / 母體 {{ result.universe }}</span>
            <span v-if="result?.asOf" class="card-sub">資料時間 {{ result.asOf.slice(0,16).replace('T',' ') }}</span>
            <div class="spacer"></div>
            <span v-if="result?.failed" class="tag warn">取樣失敗 {{ result.failed }} 檔</span>
          </div>
          <div class="card-body tight">
            <div v-if="!result && loading" class="empty">篩選中…</div>
            <div v-else-if="result && !result.items.length" class="empty">沒有符合條件的標的，試著放寬條件。</div>
            <div v-else-if="result" class="scroll-x" style="max-height:640px; overflow-y:auto">
              <table class="data">
                <thead>
                  <tr>
                    <th @click="sortByKey('code')">代號／名稱</th>
                    <th @click="sortByKey('score')">評分</th>
                    <th @click="sortByKey('price')">股價</th>
                    <th @click="sortByKey('changePercent')">日漲跌</th>
                    <th @click="sortByKey('turnover20d')">20日均額</th>
                    <th @click="sortByKey('dividendYieldTTM')">殖利率</th>
                    <th @click="sortByKey('vol1y')">波動度</th>
                    <th @click="sortByKey('pe')">PE</th>
                    <th @click="sortByKey('roe')">ROE</th>
                    <th @click="sortByKey('ret1y')">1年報酬</th>
                    <th @click="sortByKey('sharpe1y')">夏普</th>
                    <th>走勢</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="it in result.items" :key="it.code" class="clickable" @click="$emit('open', it.code)">
                    <td class="txt">
                      <div style="font-weight:600">{{ it.code }}</div>
                      <div class="small muted">{{ it.zhName || it.name || '' }} <span v-if="it.tag" class="tag" style="margin-left:4px">{{ it.tag }}</span></div>
                    </td>
                    <td><span class="score-pill" :class="scoreClass(it.score?.total)">{{ it.score?.total ?? '—' }}</span></td>
                    <td>{{ fmtPrice(it.metrics.price) }}</td>
                    <td :class="toneClass(it.metrics.changePercent)">{{ it.metrics.change == null ? fmtPctRaw(it.metrics.changePercent) : fmtChg(it.metrics.change) + ' (' + fmtPctRaw(it.metrics.changePercent) + ')' }}</td>
                    <td>{{ fmtCompact(it.metrics.turnover20d) }}</td>
                    <td>
                      {{ fmtPctRaw(it.metrics.dividendYieldTTM != null ? it.metrics.dividendYieldTTM*100 : null) }}
                      <span v-if="it.metrics.dividendYieldTTM > 0.12" class="tag warn" title="殖利率異常偏高，可能含一次性特別股息，請查核">!</span>
                    </td>
                    <td>{{ fmtPctRaw(it.metrics.vol1y != null ? it.metrics.vol1y*100 : null, 1) }}</td>
                    <td>{{ fmt('pe', it.metrics.pe) }}</td>
                    <td>{{ fmtPctRaw(it.metrics.roe != null ? it.metrics.roe*100 : null, 1) }}</td>
                    <td :class="toneClass(it.metrics.ret1y)">{{ fmtPctRaw(it.metrics.ret1y != null ? it.metrics.ret1y*100 : null, 1) }}</td>
                    <td>{{ it.metrics.sharpe1y == null ? '—' : it.metrics.sharpe1y.toFixed(2) }}</td>
                    <td><Sparkline :values="sparkValues(it)" :color="(it.metrics.ret1y||0) >= 0 ? '#d9333f' : '#0f9960'" /></td>
                    <td class="txt">
                      <button class="btn sm ghost" @click.stop="$emit('open', it.code)">詳情</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="grid cols-2" style="margin-top:14px" v-if="result?.items?.length">
          <div class="card" style="margin-top:0">
            <div class="card-head"><div class="card-title">風險 × 報酬分佈</div><div class="card-sub">X：年化波動度、Y：一年報酬</div></div>
            <div class="card-body"><ScatterChart :points="scatterPoints" /></div>
          </div>
          <div class="card" style="margin-top:0">
            <div class="card-head"><div class="card-title">評分分佈</div><div class="card-sub">依目前評分策略</div></div>
            <div class="card-body"><HistChart :values="histValues" /></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
});

export default ScreenerView;
