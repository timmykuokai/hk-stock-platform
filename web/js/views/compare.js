/**
 * compare.js — 多股並排比較：把最多 8 檔股票的關鍵指標、十大要素與綜合決策放在同一張表裡對照。
 * 用途是「同產業選一檔」或「候選名單縮圈」，避免逐頁切換造成記憶落差。
 */
import { defineComponent, ref, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtNum, fmtCompact, fmtPct, fmtPctRaw, fmtPrice, toneClass, scoreClass, fmtChg } from '../format.js';

const DEFAULT_CODES = ['00700', '09988', '00005', '01299'];

export const CompareView = defineComponent({
  name: 'CompareView',
  setup(_props, { emit }) {
    const input = ref('');
    const codes = ref([...DEFAULT_CODES]);
    const range = ref('1y');
    const data = ref(null);
    const loading = ref(false);
    const tab = ref('metrics');

    async function load() {
      if (codes.value.length < 2) { ui.error('請至少輸入 2 檔股票'); return; }
      loading.value = true;
      try {
        data.value = await api.compare(codes.value, range.value);
        codes.value = data.value.codes ?? codes.value;
      } catch (e) {
        ui.error(`比較失敗：${e.message}`);
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    onMounted(load);

    function add() {
      const raw = (input.value || '').trim();
      if (!raw) return;
      // 支援「700,9988,5」或「00700 09988」多種輸入
      const parts = raw.split(/[\s,，、]+/).filter(Boolean);
      for (const p of parts) {
        const raw = p.replace(/\.HK$/i, '').toUpperCase();
        // 市場感知：港股（純數字）補零 5 碼；美股（含英字）大寫，BRK.B → BRK-B
        const c = /^\d+$/.test(raw)
          ? raw.padStart(5, '0')
          : (/^[A-Z][A-Z0-9.\-]{0,7}$/.test(raw) ? raw.replace(/\./g, '-') : null);
        if (c && !codes.value.includes(c)) codes.value.push(c);
      }
      input.value = '';
      if (codes.value.length > 8) codes.value = codes.value.slice(0, 8);
    }
    function removeStock(code) {
      if (codes.value.length <= 2) {
        ui.notify('比較清單至少需保留 2 檔股票');
        return;
      }
      // 即時移除：同時從 codes 與 data.rows 剔除，畫面以響應式方式立即更新（無須重新取數）
      codes.value = codes.value.filter((c) => c !== code);
      if (data.value?.rows) {
        data.value = { ...data.value, rows: data.value.rows.filter((r) => r.code !== code) };
      }
      ui.notify(`已從比較清單移除 ${code}`);
    }

    const rows = computed(() => data.value?.rows ?? []);
    const defs = computed(() => data.value?.metricDefs ?? []);

    /** 每個指標的「最佳值」標記：依指標方向決定越大越好或越小越好 */
    const best = computed(() => {
      const out = {};
      const HIGHER = new Set(['turnover20d', 'marketCap', 'roe', 'profitMargin', 'revenueGrowth', 'dividendYieldTTM', 'ret1y', 'sharpe1y', 'position52w', 'changePercent']);
      const LOWER = new Set(['pe', 'pb', 'vol1y', 'atrPct']);
      for (const d of defs.value) {
        const vals = rows.value.map((r) => r.metrics?.[d.key]).filter((v) => v != null && Number.isFinite(v));
        if (!vals.length) { out[d.key] = null; continue; }
        if (LOWER.has(d.key)) out[d.key] = Math.min(...vals);
        else if (HIGHER.has(d.key)) out[d.key] = Math.max(...vals);
        else out[d.key] = null;
      }
      return out;
    });

    function cell(row, key) {
      const v = row.metrics?.[key];
      if (v == null) return '—';
      const def = defs.value.find((d) => d.key === key);
      const f = def?.fmt;
      if (f === 'pct') return fmtPct(v);
      if (f === 'pctRaw') return fmtPctRaw(v);
      if (f === 'compact') return fmtCompact(v);
      return fmtNum(v, key === 'price' ? 2 : 2);
    }
    const isBest = (row, key) => best.value[key] != null && row.metrics?.[key] === best.value[key];

    const nameOf = (r) => r.zhName || r.name || r.code;
    const open = (code) => emit('open', code);

    /** 十大要素（與後端 factors.js 順序一致） */
    const FACTOR_LABELS = [
      '行業前景與政策環境', '公司商業模式', '財務健康程度', '盈利能力與質素', '現金流',
      '估值是否合理', '管理層與股東結構', '股息政策', '技術面與市場行為', '風險因素與最壞情境',
    ];
    const factorLabel = (n) => FACTOR_LABELS[n - 1] ?? `要素 ${n}`;
    const factorOf = (row, n) => (row.factors ?? []).find((x) => x.no === n) ?? null;
    const factorScore = (row, n) => { const f = factorOf(row, n); return f ? f.score : '—'; };
    const factorTone = (row, n) => factorOf(row, n)?.rating?.tone ?? 'flat';

    return {
      input, codes, range, data, loading, tab, rows, defs, best,
      add, removeStock, load, cell, isBest, nameOf, open,
      factorLabel, factorScore, factorTone,
      fmtNum, fmtCompact, fmtPct, fmtPctRaw, fmtPrice, toneClass, scoreClass, fmtChg,
      refresh: () => withBusy(load, '重新比較失敗'),
      addAllToWatch: () => { codes.value.forEach((c) => { if (!store.watchlist.includes(c)) store.toggleWatch(c); }); ui.notify('已加入自選'); },
    };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">多股比較</div>
        <div class="card-sub">最多 8 檔 · 同一時間區間同一口徑</div>
        <div class="spacer"></div>
        <select v-model="range" style="width:120px">
          <option value="6mo">6 個月</option>
          <option value="1y">1 年</option>
          <option value="3y">3 年</option>
        </select>
        <button class="btn sm" @click="refresh">重新比較</button>
      </div>
      <div class="card-body">
        <div class="filters">
          <label class="field" style="flex:2"><span>加入代號（可一次多筆，如 700 9988 5）</span>
            <input v-model="input" @keyup.enter="add(); load()" placeholder="例如：0700.HK 或 9988" />
          </label>
          <button class="btn primary" @click="add(); load()">加入並比較</button>
          <button class="btn sm ghost" @click="addAllToWatch">全部加入自選</button>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:10px">
          <span v-for="c in codes" :key="c" class="tag" style="font-size:12px">
            <b class="mono">{{ c }}</b>
            <button class="btn sm ghost danger" style="padding:0 4px; margin-left:4px" @click="removeStock(c)" :title="'從比較清單移除 ' + c">×</button>
          </span>
        </div>
      </div>
    </div>

    <div v-if="loading && !data" class="card"><div class="empty">比較計算中…</div></div>

    <template v-if="data">
      <div class="card" v-if="rows.length">
        <div class="card-head">
          <div class="card-title">綜合評比</div><div class="card-sub">依綜合決策總分排序</div>
          <div class="spacer"></div>
          <div class="chips">
            <button class="chip" :class="{ active: tab === 'metrics' }" @click="tab = 'metrics'">關鍵指標</button>
            <button class="chip" :class="{ active: tab === 'factors' }" @click="tab = 'factors'">十大要素</button>
            <button class="chip" :class="{ active: tab === 'levels' }" @click="tab = 'levels'">價位與進出場</button>
          </div>
        </div>
        <div class="card-body tight" style="overflow-x:auto">
          <!-- 綜合決策總覽 -->
          <table class="data" style="margin-bottom:14px">
            <thead>
              <tr>
                <th style="width:64px">代號</th><th style="min-width:120px">名稱</th>
                <th style="width:80px">現價</th><th style="width:80px">漲跌</th>
                <th style="width:80px">總分</th><th style="width:90px">結論</th>
                <th style="width:70px">技術</th><th style="width:70px">基本面</th>
                <th style="width:80px">風險</th><th style="width:70px">信心</th><th style="width:130px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.code" @click="open(r.code)" style="cursor:pointer">
                <td class="mono">{{ r.code }}</td>
                <td class="txt">{{ nameOf(r) }}</td>
                <td>{{ fmtPrice(r.metrics?.price) }}</td>
                <td :class="toneClass(r.metrics?.changePercent)">{{ r.metrics?.change == null ? fmtPctRaw(r.metrics?.changePercent, 2) : fmtChg(r.metrics?.change) + ' (' + fmtPctRaw(r.metrics?.changePercent, 2) + ')' }}</td>
                <td class="mono"><span class="score-pill" :class="scoreClass(r.summary?.overall)">{{ r.summary?.overall ?? '—' }}</span></td>
                <td><span class="tag">{{ r.summary?.verdict?.label ?? '—' }}</span></td>
                <td class="mono">{{ r.summary?.techScore ?? '—' }}</td>
                <td class="mono">{{ r.summary?.fundScore ?? '—' }}</td>
                <td>{{ r.summary?.riskLevel ?? '—' }}</td>
                <td>{{ r.summary?.confidence ?? '—' }}</td>
                <td style="white-space:nowrap">
                  <button class="btn sm ghost" @click.stop="open(r.code)">詳情</button>
                  <button class="btn sm ghost danger" @click.stop="removeStock(r.code)" :title="'從比較清單移除 ' + r.code + '（' + nameOf(r) + '）'">✕ {{ r.code }}</button>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 關鍵指標 -->
          <table class="data" v-if="tab === 'metrics'">
            <thead>
              <tr><th style="width:150px">指標</th><th v-for="r in rows" :key="r.code">{{ r.code }}<div class="small muted" style="font-weight:400">{{ nameOf(r) }}</div><button class="btn sm ghost danger" style="margin-top:2px; padding:0 6px" @click.stop="removeStock(r.code)" :title="'移除 ' + r.code">✕ {{ r.code }}</button></th></tr>
            </thead>
            <tbody>
              <tr v-for="d in defs" :key="d.key">
                <td class="txt muted">{{ d.label }}</td>
                <td v-for="r in rows" :key="r.code" class="mono" :class="{ 'up': isBest(r, d.key) }">
                  {{ cell(r, d.key) }}
                  <span v-if="isBest(r, d.key)" class="small">★</span>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 十大要素 -->
          <table class="data" v-else-if="tab === 'factors'">
            <thead>
              <tr><th style="width:150px">要素</th><th v-for="r in rows" :key="r.code">{{ r.code }}<div class="small muted" style="font-weight:400">{{ nameOf(r) }}</div><button class="btn sm ghost danger" style="margin-top:2px; padding:0 6px" @click.stop="removeStock(r.code)" :title="'移除 ' + r.code">✕ {{ r.code }}</button></th></tr>
            </thead>
            <tbody>
              <tr v-for="n in 10" :key="n">
                <td class="txt muted">{{ factorLabel(n) }}</td>
                <td v-for="r in rows" :key="r.code">
                  <span class="mono">{{ factorScore(r, n) }}</span>
                  <span class="bar" style="display:inline-block; width:52px; vertical-align:middle; margin-left:6px">
                    <i :style="{ width: (Number(factorScore(r, n)) || 0) * 10 + '%', background: factorTone(r, n) === 'up' ? 'var(--up)' : factorTone(r, n) === 'down' ? 'var(--down)' : 'var(--muted)' }"></i>
                  </span>
                </td>
              </tr>
              <tr>
                <td class="txt"><b>合計</b></td>
                <td v-for="r in rows" :key="r.code"><b class="mono">{{ r.summary?.fundamentalDetail?.total ?? '—' }}</b> <span class="small muted">/100</span></td>
              </tr>
              <tr>
                <td class="txt muted">評等</td>
                <td v-for="r in rows" :key="r.code"><span class="tag">{{ r.summary?.fundamentalDetail?.label ?? '—' }}</span></td>
              </tr>
            </tbody>
          </table>

          <!-- 價位 -->
          <table class="data" v-else>
            <thead>
              <tr><th style="width:150px">項目</th><th v-for="r in rows" :key="r.code">{{ r.code }}<div class="small muted" style="font-weight:400">{{ nameOf(r) }}</div><button class="btn sm ghost danger" style="margin-top:2px; padding:0 6px" @click.stop="removeStock(r.code)" :title="'移除 ' + r.code">✕ {{ r.code }}</button></th></tr>
            </thead>
            <tbody>
              <tr>
                <td class="txt muted">支撐</td>
                <td v-for="r in rows" :key="r.code" class="mono">{{ fmtPrice(r.summary?.support) }}</td>
              </tr>
              <tr>
                <td class="txt muted">壓力</td>
                <td v-for="r in rows" :key="r.code" class="mono">{{ fmtPrice(r.summary?.resistance) }}</td>
              </tr>
              <tr>
                <td class="txt muted">進場參考區間</td>
                <td v-for="r in rows" :key="r.code" class="mono">
                  {{ r.summary?.entryZone?.low == null ? '—' : fmtPrice(r.summary.entryZone.low) + ' ~ ' + fmtPrice(r.summary.entryZone.high) }}
                </td>
              </tr>
              <tr>
                <td class="txt muted">參考止蝕</td>
                <td v-for="r in rows" :key="r.code" class="mono down">{{ fmtPrice(r.summary?.stopLoss) }}</td>
              </tr>
              <tr>
                <td class="txt muted">目標一 / 二</td>
                <td v-for="r in rows" :key="r.code" class="mono">{{ fmtPrice(r.summary?.takeProfit1) }} / {{ fmtPrice(r.summary?.takeProfit2) }}</td>
              </tr>
              <tr>
                <td class="txt muted">風險回報比</td>
                <td v-for="r in rows" :key="r.code" class="mono">{{ r.summary?.riskReward ?? '—' }}</td>
              </tr>
              <tr>
                <td class="txt muted">建議關注期</td>
                <td v-for="r in rows" :key="r.code">{{ r.summary?.timeHorizon ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card-body" style="border-top:1px solid var(--border)">
          <div class="section-note">
            ★ 標記為該指標在此組中的相對最佳值（僅限「越大越好」或「越小越好」有明確方向的指標）；
            總分為量化模型輸出，<b>不構成投資建議</b>，請搭配自身風險承受度判斷。
          </div>
        </div>
      </div>

      <div class="card" v-if="data.failed?.length">
        <div class="card-head"><div class="card-title">取數失敗</div></div>
        <div class="card-body">
          <span v-for="f in data.failed" :key="f.code" class="tag warn" style="margin-right:6px">{{ f.code }}：{{ f.message }}</span>
        </div>
      </div>
    </template>
  </div>
  `,
});

export default CompareView;
