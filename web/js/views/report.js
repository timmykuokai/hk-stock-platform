/**
 * report.js — 個股詳細文字分析報告頁面。
 * 輸入代號（或從個股頁跳轉）後，呈現「市場現況 → 市場熱度與關注度 → 綜合評估」三段式報告。
 */
import { defineComponent, ref, computed, watch, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { fmtPrice, fmtPctRaw, fmtCompact, toneClass, fmtChg } from '../format.js';

const RANGES = [
  { id: '6mo', label: '6 個月' },
  { id: '1y', label: '1 年' },
  { id: '3y', label: '3 年' },
  { id: '5y', label: '5 年' },
  { id: 'max', label: '上市至今' },
];

export const ReportView = defineComponent({
  name: 'ReportView',
  props: { code: { type: String, default: null } },
  setup(props) {
    const inputCode = ref(props.code || '');
    const range = ref('3y');
    const live = ref(false);
    const report = ref(null);
    const loading = ref(false);
    const error = ref(null);

    async function generate() {
      const code = (inputCode.value || '').trim();
      if (!code) { ui.error('請輸入股票代號'); return; }
      await withBusy(async () => {
        loading.value = true;
        error.value = null;
        report.value = null;
        try {
          report.value = await api.report(code, { range: range.value, live: live.value });
        } catch (e) {
          error.value = e.message;
        } finally {
          loading.value = false;
        }
      }, '產生報告失敗');
    }

    watch(() => props.code, (c) => {
      if (c) { inputCode.value = c; generate(); }
    });
    onMounted(() => { if (props.code) { inputCode.value = props.code; generate(); } });

    const market = computed(() => report.value?.market ?? null);
    const heat = computed(() => report.value?.heat ?? null);
    const assessment = computed(() => report.value?.assessment ?? null);

    const actionClass = (t) => (t === 'up' ? 'up' : t === 'down' ? 'down' : 'flat');

    return {
      inputCode, range, live, report, loading, error, RANGES, generate, market, heat, assessment,
      fmtPrice, fmtPctRaw, fmtCompact, toneClass, fmtChg, actionClass,
      ext: computed(() => props.code
        ? { aastocks: `https://www.aastocks.com/tc/stocks/quote/detailchart.aspx?symbol=${props.code}` }
        : null),
    };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">📝 個股詳細分析報告</div>
        <div class="card-sub">即時股價查詢後，自動彙整市場現況、熱度關注度與買入評估</div>
      </div>
      <div class="card-body">
        <div class="filters">
          <label class="field"><span>股票代號</span>
            <input v-model="inputCode" placeholder="如 00700（港股）或 AAPL（美股）" @keyup.enter="generate" style="width:200px" />
          </label>
          <label class="field"><span>區間</span>
            <select v-model="range" style="width:110px">
              <option v-for="r in RANGES" :key="r.id" :value="r.id">{{ r.label }}</option>
            </select>
          </label>
          <label class="field" style="flex-direction:row; align-items:center; gap:6px">
            <input type="checkbox" v-model="live" /> 即時資料
          </label>
          <button class="btn primary" @click="generate" :disabled="loading">生成報告</button>
        </div>
        <div class="section-note" style="margin-top:10px">
          報告涵蓋：① 當前市場現況（價格走勢／成交量／關鍵財務）　② 市場熱度與關注度（新聞曝光／關注度代理／資金動能代理）　③ 綜合評估（買入／觀望／回避＋理由＋風險）。
        </div>
      </div>
    </div>

    <div v-if="loading && !report" class="card"><div class="empty">報告生成中…（即時模式會重新抓取股價與新聞）</div></div>
    <div v-else-if="error" class="card"><div class="empty">{{ error }}</div></div>

    <template v-if="report">
      <!-- 標頭 -->
      <div class="card">
        <div class="detail-head">
          <div>
            <div class="detail-code">{{ report.code }} <span class="tag">{{ report.currency }}</span>
              <span class="tag" :class="report.market==='us' ? 'accent' : ''">{{ report.market==='us' ? '美股' : '港股' }}</span>
              <span v-if="report.live" class="tag accent" title="本次資料由後台即時自網路抓取">即時資料</span>
              <span v-else class="tag">快取資料</span>
            </div>
            <div class="detail-name">{{ report.zhName || report.name || '—' }}</div>
          </div>
          <div>
            <div class="detail-price" :class="toneClass(report.changePercent)">{{ fmtPrice(report.price) }}</div>
            <div class="detail-chg" :class="toneClass(report.changePercent)">
              {{ report.change == null ? '—' : fmtChg(report.change) + ' (' + (report.changePercent > 0 ? '+' : '') + report.changePercent.toFixed(2) + '%)' }}
              <span class="small muted">截至 {{ report.asOf }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 1. 市場現況 -->
      <div class="card" v-if="market">
        <div class="card-head"><div class="card-title">一、當前市場現況</div>
          <div class="card-sub">價格走勢 · 成交量 · 關鍵財務指標</div></div>
        <div class="card-body">
          <p class="report-prose">{{ market.summary }}</p>
          <div class="grid cols-3" style="margin-top:10px">
            <div>
              <div class="small muted" style="margin-bottom:6px">價格走勢</div>
              <table class="data compact">
                <tbody>
                  <tr v-for="(k,i) in market.keyTrend" :key="'t'+i">
                    <td class="txt">{{ k.label }}</td>
                    <td class="mono" :class="k.tone ? actionClass(k.tone) : ''">{{ k.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <div class="small muted" style="margin-bottom:6px">成交量與波動</div>
              <table class="data compact">
                <tbody>
                  <tr v-for="(k,i) in market.keyVolume" :key="'v'+i">
                    <td class="txt">{{ k.label }}</td>
                    <td class="mono" :class="k.tone ? actionClass(k.tone) : ''">{{ k.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <div class="small muted" style="margin-bottom:6px">關鍵財務指標</div>
              <table class="data compact">
                <tbody>
                  <tr v-for="(k,i) in market.keyFin" :key="'f'+i">
                    <td class="txt">{{ k.label }}</td>
                    <td class="mono">{{ k.value }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. 熱度與關注度 -->
      <div class="card" v-if="heat">
        <div class="card-head"><div class="card-title">二、市場熱度與關注度</div>
          <div class="card-sub">新聞曝光 · 關注度代理 · 資金動能代理</div></div>
        <div class="card-body">
          <p class="report-prose">{{ heat.summary }}</p>
          <div class="grid cols-3" style="margin-top:10px">
            <div class="kv-item"><div class="kv-k">新聞曝光（當日）</div><div class="kv-v" :class="heat.newsCount>0 ? 'up' : ''">{{ heat.newsCount }} 則</div></div>
            <div class="kv-item"><div class="kv-k">關注度（代理）</div><div class="kv-v">{{ heat.attentionLevel }}（{{ heat.attentionScore }}/100）</div></div>
            <div class="kv-item"><div class="kv-k">資金動能（代理）</div><div class="kv-v" :class="heat.capitalFlow.tone ? actionClass(heat.capitalFlow.tone) : ''">{{ heat.capitalFlow.direction }}</div></div>
          </div>
          <div v-if="heat.signals.length" style="margin-top:10px">
            <div class="small muted" style="margin-bottom:4px">關注度信號</div>
            <ul class="small" style="margin:0 0 0 18px; padding:0">
              <li v-for="(s,i) in heat.signals" :key="i">{{ s }}</li>
            </ul>
          </div>
          <div v-if="heat.newsItems.length" style="margin-top:12px">
            <div class="small muted" style="margin-bottom:6px">相關新聞（來自聚合要聞）</div>
            <div v-for="(n,i) in heat.newsItems" :key="i" class="news-row">
              <span class="tag mkt-{{ n.market }}">{{ n.market === 'hk' ? '港股' : n.market === 'us' ? '美股' : '環球' }}</span>
              <a :href="n.link" target="_blank" rel="noopener" class="news-title">{{ n.title }}</a>
              <span class="small muted">· {{ n.source }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. 綜合評估 -->
      <div class="card" v-if="assessment">
        <div class="card-head"><div class="card-title">三、綜合評估與操作建議</div>
          <div class="card-sub">買入 / 觀望 / 回避 的明確評估</div></div>
        <div class="card-body" v-if="assessment.available">
          <div style="display:flex; gap:18px; align-items:center; flex-wrap:wrap">
            <div style="text-align:center; min-width:140px">
              <div class="mono" style="font-size:40px; font-weight:700" :class="actionClass(assessment.tone)">{{ assessment.action }}</div>
              <div class="tag" :class="actionClass(assessment.tone)">整體評分 {{ assessment.overall }}</div>
            </div>
            <div style="flex:1; min-width:280px">
              <p class="report-prose" style="margin-top:0">{{ assessment.headline }}</p>
              <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:6px">
                <span class="tag">信心指數：{{ assessment.confidence }}</span>
                <span class="tag">風險等級：{{ assessment.riskLevel }}</span>
                <span class="tag">建議關注期：{{ assessment.timeHorizon }}</span>
                <span class="tag" v-for="(r,i) in assessment.refs" :key="'r'+i">{{ r }}</span>
              </div>
            </div>
          </div>

          <div class="grid cols-2" style="margin-top:14px">
            <div>
              <div class="small muted" style="margin-bottom:6px">建議理由（為何 {{ assessment.action }}）</div>
              <ul class="small" style="margin:0 0 0 18px; padding:0">
                <li v-for="(r,i) in assessment.reasons" :key="'rs'+i" style="margin-bottom:6px">{{ r }}</li>
              </ul>
            </div>
            <div>
              <div class="small muted" style="margin-bottom:6px">主要風險</div>
              <ul class="small" style="margin:0 0 0 18px; padding:0">
                <li v-for="(r,i) in assessment.risks" :key="'rk'+i" style="margin-bottom:6px">{{ r }}</li>
              </ul>
            </div>
          </div>

          <div style="margin-top:12px; padding:10px 12px; background:var(--up-soft); border-radius:8px" v-if="assessment.actionNote">
            <b>具體操作語境：</b>{{ assessment.actionNote }}
          </div>

          <div v-if="assessment.layers?.length" style="margin-top:12px">
            <div class="small muted" style="margin-bottom:6px">四層決策框架</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <span v-for="l in assessment.layers" :key="l.label" class="tag">{{ l.label }} <b class="mono">{{ l.percent }}%</b></span>
            </div>
          </div>

          <div class="section-note">{{ assessment.note }}</div>
        </div>
        <div class="card-body" v-else>
          <div class="empty">{{ assessment.note }}</div>
        </div>
      </div>
    </template>
  </div>
  `,
});

export default ReportView;
