/**
 * portfolio.js — 投資組合追蹤
 */
import { defineComponent, ref, reactive, computed, onMounted, watch } from '../../vendor/vue.esm-browser.prod.js';
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
    const stockInfo = ref(null);  // 存储股票实时价格信息
    const fetchingInfo = ref(false);  // 是否正在获取价格信息

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
      if (!form.code || form.code.length < 2) {
        suggest.value = [];
        return;
      }
      try {
        suggest.value = (await api.search(form.code)).items ?? [];
      } catch {
        suggest.value = [];
      }
    }

    // 获取股票实时价格信息
    async function fetchStockInfo(code) {
      if (!code || code.length < 3) {
        stockInfo.value = null;
        return;
      }
      fetchingInfo.value = true;
      try {
        const result = await api.stock(code, { range: '1y' });
        if (result && result.quote) {
          stockInfo.value = {
            code: result.code,
            name: result.zhName || result.name,
            currency: result.quote.currency || 'HKD',
            price: result.quote.price,
            change: result.quote.change,
            changePercent: result.quote.changePercent,
            pe: result.quote.pe,
            marketCap: result.quote.marketCap,
            high52w: result.quote.fiftyTwoWeekHigh,
            low52w: result.quote.fiftyTwoWeekLow,
          };
        } else {
          stockInfo.value = null;
        }
      } catch (e) {
        console.warn('获取股票信息失败:', e.message);
        stockInfo.value = null;
      } finally {
        fetchingInfo.value = false;
      }
    }

    // 监听代码输入完成，获取股票信息
    watch(() => form.code, (newCode) => {
      if (newCode && newCode.length >= 4) {
        fetchStockInfo(newCode);
      } else {
        stockInfo.value = null;
      }
    });

    // 从搜索结果中选择时，也获取股票信息
    async function selectSuggestion(s) {
      form.code = s.code;
      suggest.value = [];
      await fetchStockInfo(s.code);
    }

    // 一键填入成本价
    function fillCost() {
      if (stockInfo.value && stockInfo.value.price) {
        form.cost = stockInfo.value.price.toFixed(2);
        ui.notify('已填入现價', 'success');
      }
    }

    async function add() {
      if (!form.code) { ui.error('請輸入代號'); return; }
      try {
        await withBusy(() => api.portfolioAdd({
          code: form.code, qty: Number(form.qty),
          cost: Number(form.cost || 0), date: form.date, note: form.note,
        }), '新增失敗');
        form.code = ''; form.cost = ''; form.note = ''; stockInfo.value = null; suggest.value = [];
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

    return { data, loading, form, editing, suggest, stockInfo, fetchingInfo, summary, load, add, remove, saveEdit, searchCode, selectSuggestion, fillCost,
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
            <input v-model="form.code" @input="searchCode" placeholder="輸入代號如00700" style="width:120px" />
            <div v-if="suggest.length" class="card" style="position:absolute; top:100%; left:0; z-index:30; width:260px; box-shadow:var(--shadow-lg)">
              <div v-for="s in suggest.slice(0,8)" :key="s.code" class="rule-row" style="cursor:pointer; padding:8px;" @click="selectSuggestion(s)">
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

        <!-- 股票價格預覽 -->
        <div v-if="stockInfo || fetchingInfo" class="stock-info-preview" style="margin-top:16px; padding:12px; background:#f8f9fa; border-radius:6px; border:1px solid #e9ecef;">
          <div v-if="fetchingInfo" class="text-center muted" style="padding:12px;">
            <span class="spinner-border spinner-border-sm" role="status"></span> 正在獲取價格資訊...
          </div>
          <div v-else-if="stockInfo" class="row">
            <div class="col-md-4">
              <div class="stock-info-item">
                <span class="muted small">股票名稱</span>
                <div class="fw-bold">{{ stockInfo.name }}</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="stock-info-item">
                <span class="muted small">貨幣</span>
                <div>{{ stockInfo.currency }}</div>
              </div>
            </div>
            <div class="col-md-4">
              <div class="stock-info-item">
                <span class="muted small">最新股價</span>
                <div class="fw-bold fs-5">{{ fmtPrice(stockInfo.price) }}</div>
              </div>
            </div>
            <div class="col-md-3">
              <div class="stock-info-item">
                <span class="muted small">當日漲跌</span>
                <div :class="toneClass(stockInfo.changePercent) + ' fw-bold'">
                  {{ fmtChg(stockInfo.change) }} ({{ fmtPctRaw(stockInfo.changePercent) }})
                </div>
              </div>
            </div>
            <div class="col-md-3">
              <div class="stock-info-item">
                <span class="muted small">市盈率 PE</span>
                <div>{{ stockInfo.pe ? stockInfo.pe.toFixed(2) : '—' }}</div>
              </div>
            </div>
            <div class="col-md-3">
              <div class="stock-info-item">
                <span class="muted small">52週最高</span>
                <div>{{ fmtPrice(stockInfo.high52w) }}</div>
              </div>
            </div>
            <div class="col-md-3">
              <div class="stock-info-item">
                <span class="muted small">52週最低</span>
                <div>{{ fmtPrice(stockInfo.low52w) }}</div>
              </div>
            </div>
            <div class="col-12 mt-2">
              <button class="btn btn-sm btn-outline-primary" @click="fillCost" :disabled="!stockInfo || !stockInfo.price">
                ⚡ 一鍵填入成本價
              </button>
              <span class="small muted ms-2">點擊將最新股價填入成本價欄位</span>
            </div>
          </div>
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
