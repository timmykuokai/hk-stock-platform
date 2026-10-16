/**
 * portfolio.js — 投資組合追蹤
 */
import { defineComponent, ref, reactive, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { fmtPrice, fmtPctRaw, fmtPct, fmtCompact, toneClass, fmtNum, fmtChg } from '../format.js';

export const PortfolioView = defineComponent({
  name: 'PortfolioView',
  setup(_, { emit }) {
    void emit;
    const data = ref(null);
    const loading = ref(false);
    const form = reactive({ code: '', qty: 1000, cost: '', date: new Date().toISOString().slice(0, 10), note: '' });
    const editing = ref(null);
    const suggest = ref([]);

    async function load() {
      loading.value = true;
      try {
        data.value = await api.portfolio();
      } catch (e) {
        ui.error(`載入失敗：${e.message}`);
      } finally {
        loading.value = false;
      }
    }

    async function searchCode() {
      if (!form.code || form.code.length < 2) { suggest.value = []; return; }
      try {
        suggest.value = (await api.search(form.code)).items ?? [];
      } catch { suggest.value = []; }
    }

    async function add() {
      if (!form.code) { ui.error('請輸入代號'); return; }
      try {
        await withBusy(() => api.portfolioAdd({
          code: form.code, qty: Number(form.qty),
          cost: Number(form.cost || 0), date: form.date, note: form.note,
        }), '新增失敗');
        form.code = ''; form.cost = ''; form.note = ''; suggest.value = [];
        await load();
      } catch { /* handled */ }
    }

    async function saveEdit(row) {
      try {
        await withBusy(() => api.portfolioUpdate(row.id, { qty: Number(row.qty), cost: Number(row.cost), date: row.date, note: row.note }), '更新失敗');
        editing.value = null;
        await load();
      } catch { /* handled */ }
    }

    async function remove(id) {
      try {
        await withBusy(() => api.portfolioRemove(id), '刪除失敗');
        await load();
      } catch { /* handled */ }
    }

    const summary = computed(() => data.value?.summary ?? null);

    onMounted(load);

    return { data, loading, form, editing, suggest, summary, load, add, remove, saveEdit, searchCode,
      fmtPrice, fmtPctRaw, fmtPct, fmtCompact, toneClass, fmtNum, fmtChg };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">組合概況</div>
        <div class="spacer"></div>
        <button class="btn sm" @click="load" :disabled="loading">{{ loading ? '更新中…' : '重新估值' }}</button>
      </div>
      <div class="card-body" v-if="summary">
        <div class="grid kpi">
          <div class="kpi"><div class="kpi-label">總市值</div><div class="kpi-value">{{ fmtCompact(summary.totalValue) }}</div><div class="kpi-sub">成本 {{ fmtCompact(summary.totalCost) }}</div></div>
          <div class="kpi"><div class="kpi-label">未實現損益</div><div class="kpi-value" :class="toneClass(summary.totalPnl)">{{ fmtCompact(summary.totalPnl) }}</div><div class="kpi-sub" :class="toneClass(summary.totalPnlPct)">{{ fmtPct(summary.totalPnlPct, 2) }}</div></div>
          <div class="kpi"><div class="kpi-label">當日損益</div><div class="kpi-value" :class="toneClass(summary.dayPnl)">{{ fmtCompact(summary.dayPnl) }}</div><div class="kpi-sub" :class="toneClass(summary.dayPnlPct)">{{ fmtPct(summary.dayPnlPct, 2) }}</div></div>
          <div class="kpi"><div class="kpi-label">相對恒指</div><div class="kpi-value" :class="toneClass(summary.excess)">{{ fmtPct(summary.excess, 2) }}</div><div class="kpi-sub">恒指同期 {{ fmtPct(summary.benchReturn, 2) }}</div></div>
          <div class="kpi"><div class="kpi-label">持股檔數</div><div class="kpi-value">{{ summary.positions }}</div><div class="kpi-sub">最大單一部位 {{ fmtPct(summary.topWeight, 1) }}</div></div>
        </div>
      </div>
      <div class="empty" v-else>尚無持股，請於下方新增。</div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">新增持股</div></div>
      <div class="card-body">
        <div class="filters">
          <label class="field" style="position:relative">
            <span>代號</span>
            <input v-model="form.code" @input="searchCode" placeholder="00700" style="width:120px" />
            <div v-if="suggest.length" class="card" style="position:absolute; top:100%; left:0; z-index:30; width:260px; box-shadow:var(--shadow-lg)">
              <div v-for="s in suggest.slice(0,8)" :key="s.code" class="rule-row" style="cursor:pointer" @click="form.code = s.code; suggest = []">
                <b class="mono">{{ s.code }}</b> <span class="small muted">{{ s.zh || s.name }}</span>
              </div>
            </div>
          </label>
          <label class="field"><span>股數</span><input type="number" v-model.number="form.qty" style="width:110px" /></label>
          <label class="field"><span>成本價</span><input type="number" step="0.01" v-model="form.cost" style="width:110px" placeholder="留空以現價" /></label>
          <label class="field"><span>買入日</span><input type="date" v-model="form.date" /></label>
          <label class="field"><span>備註</span><input v-model="form.note" placeholder="選填" /></label>
          <button class="btn primary" @click="add">新增</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">持股明細</div><div class="card-sub">按現價即時估值</div></div>
      <div class="card-body tight">
        <table class="data">
          <thead>
            <tr><th>代號／名稱</th><th>股數</th><th>買入價</th><th>成本</th><th>現價</th><th>日漲跌</th><th>市值</th><th>損益</th><th>報酬率</th><th>權重</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="r in data?.rows || []" :key="r.id">
              <td class="txt">
                <b>{{ r.code }}</b> <span class="small muted">{{ r.zhName || r.name || '' }}</span>
                <div class="small muted">{{ r.date }} <span v-if="r.note">· {{ r.note }}</span></div>
              </td>
              <td v-if="editing === r.id"><input type="number" v-model.number="r.qty" style="width:80px" /></td><td v-else>{{ fmtNum(r.qty, 0) }}</td>
              <td>{{ fmtPrice(r.buyPrice) }}</td>
              <td v-if="editing === r.id"><input type="number" step="0.01" v-model="r.cost" style="width:80px" /></td><td v-else>{{ fmtPrice(r.cost) }}</td>
              <td>{{ fmtPrice(r.price) }}</td>
              <td :class="toneClass(r.changePercent)">{{ r.change == null ? fmtPctRaw(r.changePercent) : fmtChg(r.change) + ' (' + fmtPctRaw(r.changePercent) + ')' }}</td>
              <td>{{ fmtCompact(r.value) }}</td>
              <td :class="toneClass(r.pnl)">{{ fmtCompact(r.pnl) }}</td>
              <td :class="toneClass(r.pnlPct)">{{ fmtPct(r.pnlPct, 2) }}</td>
              <td>{{ fmtPct(r.weight, 1) }}</td>
              <td class="txt nowrap">
                <button v-if="editing === r.id" class="btn sm primary" @click="saveEdit(r)">儲存</button>
                <button v-else class="btn sm ghost" @click="editing = r.id">編輯</button>
                <button class="btn sm ghost" @click="remove(r.id)">刪除</button>
              </td>
            </tr>
            <tr v-if="!data?.rows?.length"><td class="txt muted" colspan="11">尚無持股</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  `,
});

export default PortfolioView;
