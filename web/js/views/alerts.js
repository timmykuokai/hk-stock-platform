/**
 * alerts.js — 警報規則管理與觸發紀錄
 */
import { defineComponent, ref, reactive, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { fmtTime, fmtNum } from '../format.js';

export const AlertsView = defineComponent({
  name: 'AlertsView',
  setup() {
    const rules = ref([]);
    const log = ref([]);
    const types = ref([]);
    const form = reactive({ code: '', type: 'price_above', threshold: '', period: 50, note: '' });
    const checking = ref(false);
    const lastCheck = ref(null);

    async function load() {
      try {
        const r = await api.alerts();
        rules.value = r.rules || [];
        log.value = r.log || [];
        types.value = r.types || [];
      } catch (e) {
        ui.error(`載入失敗：${e.message}`);
      }
    }

    async function add() {
      if (!form.code) { ui.error('請輸入代號'); return; }
      const params = form.type === 'ma_below'
        ? { period: Number(form.period) }
        : { threshold: Number(form.threshold) };
      if (form.type !== 'ma_below' && !Number.isFinite(params.threshold)) { ui.error('請輸入有效門檻值'); return; }
      try {
        await withBusy(() => api.alertAdd({ code: String(form.code).trim(), type: form.type, params, note: form.note }), '新增失敗');
        form.threshold = ''; form.note = '';
        await load();
      } catch { /* handled */ }
    }

    async function toggle(r) {
      try { await api.alertUpdate(r.id, { enabled: !r.enabled }); await load(); } catch { /* ignore */ }
    }
    async function remove(id) {
      try { await api.alertRemove(id); await load(); } catch { /* ignore */ }
    }
    async function check() {
      checking.value = true;
      try {
        const r = await withBusy(() => api.alertCheck(), '檢查失敗');
        log.value = r.log || [];
        lastCheck.value = { checked: r.checked, triggered: r.triggered, at: new Date().toISOString() };
        if (r.triggered) ui.notify(`觸發 ${r.triggered} 則警報`);
        else ui.notify(`檢查完成，${r.checked} 條規則無觸發`);
      } catch { /* handled */ }
      finally { checking.value = false; }
    }
    async function clearLog() {
      try { const r = await api.alertLogClear(); log.value = r.log || []; } catch { /* ignore */ }
    }

    const typeLabel = (t) => (types.value.find((x) => x.type === t) || {}).label || t;
    const typeUnit = (t) => (types.value.find((x) => x.type === t) || {}).unit || '';
    const needsThreshold = computed(() => form.type !== 'ma_below');

    onMounted(load);

    return { rules, log, types, form, checking, lastCheck, add, toggle, remove, check, clearLog, typeLabel, typeUnit, needsThreshold, fmtTime, fmtNum };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head"><div class="card-title">新增警報規則</div>
        <div class="spacer"></div>
        <button class="btn primary sm" @click="check" :disabled="checking">{{ checking ? '檢查中…' : '立即檢查' }}</button>
      </div>
      <div class="card-body">
        <div class="filters">
          <label class="field"><span>代號</span><input v-model="form.code" placeholder="00700" style="width:110px" /></label>
          <label class="field"><span>規則類型</span>
            <select v-model="form.type" style="min-width:190px">
              <option v-for="t in types" :key="t.type" :value="t.type">{{ t.label }}<span v-if="t.unit">（{{ t.unit }}）</span></option>
            </select>
          </label>
          <label class="field" v-if="needsThreshold"><span>門檻值 {{ typeUnit(form.type) }}</span><input type="number" step="any" v-model="form.threshold" style="width:120px" /></label>
          <label class="field" v-else><span>均線期數</span>
            <select v-model.number="form.period"><option :value="20">20 日</option><option :value="50">50 日</option><option :value="200">200 日</option></select>
          </label>
          <label class="field"><span>備註</span><input v-model="form.note" placeholder="選填" /></label>
          <button class="btn primary" @click="add">建立</button>
        </div>
        <div class="section-note">
          檢查邏輯會同時讀取池快照指標與即時報價；價格類規則一定抓即時價，其餘優先用快取指標以節省請求。
          可在此頁手動觸發，或用系統排程定時呼叫 <span class="mono">POST /api/alerts/check</span>。
        </div>
        <div v-if="lastCheck" class="small muted" style="margin-top:6px">
          上次檢查：{{ fmtTime(lastCheck.at) }} · {{ lastCheck.checked }} 條規則 · 觸發 {{ lastCheck.triggered }} 則
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">規則清單</div><div class="card-sub">{{ rules.length }} 條</div></div>
      <div class="card-body tight">
        <div v-if="!rules.length" class="empty">尚未建立任何規則</div>
        <div v-for="r in rules" :key="r.id" class="rule-row">
          <span class="tag" :class="r.enabled ? 'accent' : ''">{{ r.enabled ? '啟用' : '停用' }}</span>
          <b class="mono">{{ r.code }}</b>
          <span>{{ typeLabel(r.type) }}</span>
          <span class="mono">{{ r.type === 'ma_below' ? (r.params.period + ' 日均線') : fmtNum(r.params.threshold, 3) }}</span>
          <span v-if="r.note" class="small muted">{{ r.note }}</span>
          <span v-if="r.lastTriggered" class="small muted">上次觸發 {{ fmtTime(r.lastTriggered) }}</span>
          <div class="spacer"></div>
          <button class="btn sm ghost" @click="toggle(r)">{{ r.enabled ? '停用' : '啟用' }}</button>
          <button class="btn sm ghost" @click="remove(r.id)">刪除</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">觸發紀錄</div><div class="spacer"></div><button class="btn sm ghost" @click="clearLog">清空</button></div>
      <div class="card-body tight">
        <div v-if="!log.length" class="empty">尚無觸發紀錄</div>
        <div v-for="(e,i) in log.slice(0,40)" :key="i" class="alert-item">
          <span class="alert-dot"></span>
          <div>
            <div><b class="mono">{{ e.code }}</b> · {{ typeLabel(e.type) }} <span class="small muted">{{ fmtTime(e.at) }}</span></div>
            <div class="small">{{ e.message }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
});

export default AlertsView;
