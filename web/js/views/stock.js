/**
 * stock.js — 個股詳情（K 線圖 + 指標 + 基本面 + 評分解構 + 股息 + 資料驗證）
 */
import { defineComponent, ref, computed, watch, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtPrice, fmtPctRaw, fmtCompact, fmtNum, toneClass, scoreClass, fmtDate, fmtChg } from '../format.js';
import { CandleChart, RadarChart, LineChart, HBarChart, MonthlyBarChart, Sparkline, SellLadder } from '../components/charts.js';
import { BollingerChart, MaChart, VolumeChart, MacdChart, RsiChart, KdChart, ObvChart, MfiChart, AdxChart, CciChart, BiasChart, DrawdownChart, AtrChart, DonchianChart } from '../components/techChart.js';

const RANGES = [
  { id: '3mo', label: '3 個月' },
  { id: '6mo', label: '6 個月' },
  { id: '1y', label: '1 年' },
  { id: '3y', label: '3 年' },
  { id: '5y', label: '5 年' },
  { id: 'max', label: '上市至今' },
];

export const StockView = defineComponent({
  name: 'StockView',
  components: { CandleChart, RadarChart, LineChart, HBarChart, MonthlyBarChart, Sparkline, SellLadder, BollingerChart, MaChart, VolumeChart, MacdChart, RsiChart, KdChart, ObvChart, MfiChart, AdxChart, CciChart, BiasChart, DrawdownChart, AtrChart, DonchianChart },
  props: { code: { type: String, required: true } },
  setup(props, { emit }) {
    void emit;
    const data = ref(null);
    const loading = ref(false);
    const range = ref('3y');
    const error = ref(null);
    const chartTab = ref('bollinger');
    const chartMap = { bollinger: BollingerChart, ma: MaChart, volume: VolumeChart, macd: MacdChart, rsi: RsiChart, kd: KdChart, obv: ObvChart, mfi: MfiChart, adx: AdxChart, cci: CciChart, bias: BiasChart, atr: AtrChart, donchian: DonchianChart };
    /** 指標序列（後端已算好）與風險衍生資料 */
    const techSeries = computed(() => an.value?.indicators?.series ?? {});
    const riskData = computed(() => an.value?.risk ?? null);
    /** 依當前技術 Tab 精準派發 props，避免未聲明屬性漏寫到 SVG 根元素 */
    function chartProps() {
      const tab = chartTab.value;
      if (['kd', 'obv', 'mfi', 'adx', 'cci', 'bias', 'atr'].includes(tab)) {
        const base = { series: techSeries.value, height: 260 };
        if (tab === 'obv') base.divergences = divergencesData.value?.divergences ?? [];
        return base;
      }
      if (tab === 'drawdown') return { risk: riskData.value, height: 260 };
      if (tab === 'donchian') return { bars: data.value?.bars ?? [], height: 280 };
      return { bars: data.value?.bars ?? [], height: (tab === 'volume' || tab === 'rsi') ? 260 : 300 };
    }
    const showAddPos = ref(false);
    const newPos = ref({ qty: 1000, cost: '', date: new Date().toISOString().slice(0, 10), note: '' });

    /** 資料來源狀態：是否為即時（現場抓取） */
    const isLive = ref(false);
    const liveAt = ref(null);

    /** 深度分析（十大要素 + 綜合決策 + 技術指標快照） */
    const an = ref(null);
    const anLoading = ref(false);
    const anError = ref(null);
    const anTab = ref('verdict');

    async function load(opts = {}) {
      if (!props.code) return;
      loading.value = true;
      error.value = null;
      try {
        const resp = await api.stock(props.code, { range: range.value, live: opts.live || false });
        data.value = resp;
        isLive.value = !!resp.live;
        liveAt.value = resp.fetchedAt || resp.updatedAt || null;
      } catch (e) {
        error.value = e.message;
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    async function loadAnalysis(opts = {}) {
      if (!props.code) return;
      anLoading.value = true;
      anError.value = null;
      try {
        an.value = await api.analysis(props.code, { range: '3y', live: opts.live || false });
      } catch (e) {
        anError.value = e.message;
        an.value = null;
      } finally {
        anLoading.value = false;
      }
    }

    /** 即時股價：後台直連 Yahoo 重新抓取最新報價與 K 線 */
    async function refreshLive() {
      await withBusy(async () => {
        await Promise.all([load({ live: true }), loadAnalysis({ live: true })]);
        ui.notify('已自網路取得即時資料');
      }, '即時更新失敗');
    }

    /** 跳轉至「AI 報告」頁，針對本檔股票生成詳細文字分析報告 */
    function openReport() {
      location.hash = `#/report/${props.code}`;
    }

    watch(() => props.code, () => { load(); loadAnalysis(); });
    watch(range, load);
    onMounted(() => { load(); loadAnalysis(); });

    const m = computed(() => data.value?.metrics ?? {});
    const f = computed(() => data.value?.fundamentals ?? {});

    const radar = computed(() => {
      const dims = data.value?.score?.dimensions ?? {};
      const labels = {
        liquidity: '流動性', dividend: '殖利率', value: '估值', quality: '品質',
        risk: '風險', momentum: '動能', stability: '穩定度',
      };
      return Object.entries(dims).filter(([, v]) => v != null).map(([k, v]) => ({ label: labels[k] || k, value: v }));
    });

    const presetRows = computed(() => {
      const ps = data.value?.presetScores ?? {};
      return Object.entries(ps).map(([k, v]) => ({
        key: k,
        label: store.meta?.presets?.[k]?.label ?? k,
        value: v,
      }));
    });

    /** 十大要素評分雷達（0–10 分 → 0–100） */
    const factorRadar = computed(() => (factors.value || []).map((fa) => ({
      label: fa.factor,
      value: Math.max(0, Math.min(100, Math.round((fa.score / (fa.maxScore || 10)) * 100))),
    })));

    /** 三維決策雷達（技術／基本／風險，0–100） */
    const verdictRadar = computed(() => (verdict.value ? [
      { label: '技術面', value: verdict.value.techScore },
      { label: '基本面', value: verdict.value.fundScore },
      { label: '風險', value: verdict.value.riskScore },
    ] : []));

    /** 風險報酬衍生資料（後端 /analysis 已組裝） */
    const equity = computed(() => an.value?.equity ?? null);
    const heat = computed(() => an.value?.heat ?? null);
    /** 日收益率分佈（取百分比點便於閱讀） */
    const dailyHist = computed(() => (riskData.value?.dailyReturns?.values ?? []).map((v) => v * 100));
    /** 月度漲跌（標籤與報酬率） */
    const monthlyChart = computed(() => ({
      labels: riskData.value?.monthly?.labels ?? [],
      returns: riskData.value?.monthly?.returns ?? [],
    }));
    /** 個股 vs 基準 淨值疊加（LineChart 雙序列，皆歸一為 100） */
    const compareEquity = computed(() => {
      const eq = equity.value;
      if (!eq || !eq.dates || !eq.stock) return [];
      const benchName = market.value === 'us' ? 'S&P 500' : '恒生指數';
      return [
        { name: `${data.value?.symbol || props.code}（歸一 100）`, color: '#1f5eff', points: eq.dates.map((d, i) => ({ date: d, v: eq.stock[i] })) },
        { name: benchName, color: '#f59e0b', points: eq.dates.map((d, i) => ({ date: d, v: eq.benchmark[i] })) },
      ];
    });
    /** 相對強弱線（RS Line）：個股 ÷ 基準 的淨值比，重新基準為 100 */
    const rsData = computed(() => an.value?.rs ?? null);
    const rsSeries = computed(() => {
      const rs = rsData.value;
      if (!rs || !rs.dates || !rs.rs) return [];
      return [
        { name: 'RS 相對強弱（基準 100）', color: '#1f5eff', points: rs.dates.map((d, i) => ({ date: d, v: rs.rs[i] })) },
        { name: '基準 100', color: '#8b95a3', points: rs.dates.map((d) => ({ date: d, v: 100 })) },
      ];
    });
    /** 關注度等級 → 色調 class */
    const heatTone = computed(() => (heat.value ? (heat.value.attentionLevel === '高' ? 'up' : heat.value.attentionLevel === '低' ? 'down' : 'flat') : 'flat'));
    /** P1 · 三項新衍生資料（後端 /analysis 已組裝） */
    const sellLadder = computed(() => an.value?.ladder ?? null);
    const timeframes = computed(() => an.value?.timeframes ?? null);
    const divergencesData = computed(() => an.value?.divergences ?? null);
    /** P2 · 市況判定引擎 / 指標適用性路由 / 關鍵變量觸發台 */
    const regime = computed(() => an.value?.regime ?? null);
    const applicability = computed(() => an.value?.applicability ?? null);
    const triggers = computed(() => an.value?.triggers ?? null);
    /** 市況三態 → 色調 class（上升=up 紅 / 下跌=down 綠 / 震盪=flat 灰） */
    const regimeClass = (s) => (s === 'bull' ? 'up' : s === 'bear' ? 'down' : 'flat');
    /** 觸發台狀態 → 中文（供標籤顯示） */
    const triggerStateText = (s) => (s === 'triggered' ? '已觸發' : s === 'watch' ? '接近門檻' : s === 'pending' ? '待接入' : '正常');
    const tfRows = computed(() => (timeframes.value ? [timeframes.value.day, timeframes.value.week, timeframes.value.month].filter(Boolean) : []));
    /** 級別環境狀態 → 色調 class（多頭=up 紅 / 空頭=down 綠 / 盤整=flat） */
    const tfClass = (s) => (s === 'bull' ? 'up' : s === 'bear' ? 'down' : 'flat');
    const tfColor = (s) => (s === 'bull' ? '#d9333f' : s === 'bear' ? '#0f9960' : '#8b95a3');
    /** 出場階梯狀態 → 色調 class */
    const ladderClass = (s) => (s === 'holding' ? 'up' : (s === 'trim1' || s === 'trim2') ? 'warn' : 'down');
    const flowTone = computed(() => (heat.value ? (heat.value.capitalFlow.tone === 'up' ? 'accent' : heat.value.capitalFlow.tone === 'down' ? 'warn' : '') : ''));
    const flowText = computed(() => {
      if (!heat.value) return '';
      const d = heat.value.capitalFlow.direction;
      return d === 'inflow' ? '資金淨流入' : d === 'outflow' ? '資金淨流出' : '資金中性';
    });

    const equitySeries = computed(() => {
      const bars = data.value?.bars ?? [];
      if (bars.length < 2) return [];
      const base = bars[0].close;
      return [{ name: '股價（正規化 100）', color: '#1f5eff', points: bars.map((b) => ({ date: b.date, v: (b.close / base) * 100 })) }];
    });

    const divRows = computed(() => (data.value?.dividends ?? []).slice().reverse().slice(0, 12));

    async function addPosition() {
      try {
        await withBusy(() => api.portfolioAdd({ code: props.code, qty: Number(newPos.value.qty), cost: Number(newPos.value.cost || m.value.price || 0), date: newPos.value.date, note: newPos.value.note }), '新增持股失敗');
        ui.notify('已加入投資組合');
        showAddPos.value = false;
      } catch { /* handled */ }
    }

    async function addAlert() {
      try {
        await withBusy(() => api.alertAdd({ code: props.code, type: 'price_above', params: { threshold: Math.round((m.value.price || 0) * 1.1 * 100) / 100 } }), '新增警報失敗');
        ui.notify('已建立「股價突破 +10%」警報');
      } catch { /* handled */ }
    }

    const inWatch = computed(() => store.watchlist.includes(props.code));

    /** 市場判斷：代號含英文字母即視為美股，否則為港股 */
    const market = computed(() => (/[A-Za-z]/.test(props.code) ? 'us' : 'hk'));
    const benchLabel = computed(() => (market.value === 'us' ? 'Beta（對標普）' : 'Beta（對恒指）'));
    const factorsTitle = computed(() => (market.value === 'us' ? '美股十大要素評分' : '港股十大要素評分'));

    /** 技術指標最新值（十大訊號表用） */
    const indRows = computed(() => {
      const L = an.value?.indicators?.latest ?? {};
      const defs = [
        { k: 'rsi14', label: 'RSI(14)', fmt: (v) => v.toFixed(1) },
        { k: 'macd', label: 'MACD', fmt: (v) => v.toFixed(3) },
        { k: 'macdSignal', label: 'MACD 訊號線', fmt: (v) => v.toFixed(3) },
        { k: 'adx14', label: 'ADX(14)', fmt: (v) => v.toFixed(1) },
        { k: 'mfi14', label: 'MFI 資金流向', fmt: (v) => v.toFixed(1) },
        { k: 'cci14', label: 'CCI(14)', fmt: (v) => v.toFixed(1) },
        { k: 'willr14', label: '威廉指標 %R', fmt: (v) => v.toFixed(1) },
        { k: 'slowK', label: 'KD 隨機 K', fmt: (v) => v.toFixed(1) },
        { k: 'slowD', label: 'KD 隨機 D', fmt: (v) => v.toFixed(1) },
        { k: 'atrPct', label: 'ATR 佔股價', fmt: (v) => v.toFixed(2) + '%' },
        { k: 'bias24', label: '乖離率 BIAS(24)', fmt: (v) => v.toFixed(2) + '%' },
        { k: 'volRatio', label: '量能比（量/20日均量）', fmt: (v) => v.toFixed(2) },
        { k: 'position52w', label: '52 週相對位置', fmt: (v) => v.toFixed(1) + '%' },
      ];
      return defs.map((d) => ({ label: d.label, value: L[d.k] == null ? '—' : d.fmt(L[d.k]) }));
    });

    /** 均線階梯（價格 vs 各期均線） */
    const maRows = computed(() => {
      const L = an.value?.indicators?.latest ?? {};
      const px = L.close;
      return [5, 10, 20, 50, 60, 200].map((p) => {
        const v = L[`ma${p}`];
        return { label: `MA${p}`, value: v == null ? '—' : v.toFixed(2), diff: px != null && v != null ? ((px / v - 1) * 100) : null };
      });
    });

    const verdict = computed(() => an.value?.verdict ?? null);
    const factors = computed(() => an.value?.factors ?? []);
    const factorSummary = computed(() => an.value?.factorSummary ?? null);
    const layers = computed(() => an.value?.layers ?? []);
    const techSignals = computed(() => an.value?.indicators?.technical?.signals ?? []);

    const verdictTone = (v) => {
      const s = verdict.value?.verdict?.tone;
      if (s === 'up') return 'up';
      if (s === 'down') return 'down';
      return 'flat';
    };

    return {
      data, loading, range, error, chartTab, chartMap, chartProps, RANGES, m, f, radar, presetRows, factorRadar, verdictRadar, equitySeries, rsSeries, divRows,
      riskData, equity, heat, dailyHist, monthlyChart, compareEquity, heatTone, flowTone, flowText,
      sellLadder, timeframes, divergencesData, tfRows, tfClass, tfColor, ladderClass,
      regime, applicability, triggers, regimeClass, triggerStateText,
      showAddPos, newPos, addPosition, addAlert, inWatch, store,
      an, anLoading, anError, anTab, indRows, maRows, verdict, factors, factorSummary, layers, techSignals, verdictTone,
      isLive, liveAt, refreshLive, openReport,
      fmtPrice, fmtPctRaw, fmtCompact, fmtNum, toneClass, scoreClass, fmtDate, fmtChg,
      toggleWatch: () => store.toggleWatch(props.code),
      market, benchLabel, factorsTitle,
      ext: computed(() => (market.value === 'us'
        ? { yahoo: `https://finance.yahoo.com/quote/${props.code}` }
        : {
          aastocks: `https://www.aastocks.com/tc/stocks/quote/detailchart.aspx?symbol=${props.code}`,
          etnet: `https://www.etnet.com.hk/www/tc/stocks/realtime/quote.php?code=${props.code}`,
        })),
    };
  },
  template: `
  <div>
    <div v-if="loading && !data" class="card"><div class="empty">載入中…</div></div>
    <div v-else-if="error" class="card"><div class="empty">{{ error }}</div></div>

    <template v-if="data">
      <div class="card">
        <div class="detail-head">
          <div>
            <div class="detail-code">{{ data.code }} · {{ data.symbol }} <span class="tag">{{ data.currency }}</span><span class="tag" :class="market==='us' ? 'accent' : ''">{{ market==='us' ? '美股' : '港股' }}</span></div>
            <div class="detail-name">{{ data.zhName || data.name || '—' }}
              <span v-if="f.sector" class="tag accent" style="margin-left:8px">{{ f.sector }}</span>
              <span v-if="f.industry" class="tag" style="margin-left:4px">{{ f.industry }}</span>
            </div>
          </div>
          <div>
            <div class="detail-price" :class="toneClass(m.changePercent)">{{ fmtPrice(m.price) }}</div>
            <div class="detail-chg" :class="toneClass(m.changePercent)">
              {{ m.changePercent == null ? '—' : fmtChg(m.change) + ' (' + (m.changePercent > 0 ? '+' : '') + m.changePercent.toFixed(2) + '%)' }}
              <span class="small muted">更新 {{ (data.updatedAt || '').slice(0,16).replace('T',' ') }}</span>
              <span class="tag accent" v-if="isLive" title="本次資料由後台即時自網路抓取">即時資料 {{ (liveAt || '').slice(0,16).replace('T',' ') }}</span>
              <span class="tag" v-else title="顯示為快取資料，點擊『即時股價』可強制後台重抓">快取資料</span>
            </div>
          </div>
          <div class="spacer"></div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn sm" :class="{ accent: isLive }" @click="refreshLive" :disabled="loading">🔄 即時股價</button>
            <button class="btn sm" @click="openReport">📝 生成分析報告</button>
            <button class="btn sm" @click="toggleWatch">{{ inWatch ? '★ 已收藏' : '☆ 加入自選' }}</button>
            <button class="btn sm" @click="showAddPos = !showAddPos">加入組合</button>
            <button class="btn sm" @click="addAlert">設警報</button>
            <a v-if="market!=='us'" class="btn sm ghost" :href="ext.aastocks" target="_blank" rel="noopener">AAStocks</a>
            <a v-if="market!=='us'" class="btn sm ghost" :href="ext.etnet" target="_blank" rel="noopener">etnet</a>
            <a v-if="market==='us'" class="btn sm ghost" :href="ext.yahoo" target="_blank" rel="noopener">Yahoo</a>
          </div>
        </div>
        <div class="card-body" v-if="showAddPos" style="border-top:1px solid var(--border)">
          <div class="filters">
            <label class="field"><span>數量</span><input type="number" v-model.number="newPos.qty" /></label>
            <label class="field"><span>成本價</span><input type="number" step="0.01" v-model="newPos.cost" :placeholder="String(m.price || '')" /></label>
            <label class="field"><span>買入日</span><input type="date" v-model="newPos.date" /></label>
            <label class="field"><span>備註</span><input v-model="newPos.note" placeholder="選填" /></label>
            <button class="btn primary" @click="addPosition">儲存</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">K 線圖</div>
          <div class="spacer"></div>
          <div class="chips">
            <button v-for="r in RANGES" :key="r.id" class="chip" :class="{ active: range === r.id }" @click="range = r.id">{{ r.label }}</button>
          </div>
          <span class="muted small" v-if="range === 'max' && data.firstDate">上市日 {{ data.firstDate }}（全期歷史 K 線）</span>
        </div>
        <div class="card-body tight">
          <CandleChart :bars="data.bars" :height="400" v-if="data.bars?.length" />
          <div class="legend" style="padding:6px 8px">
            <span><i style="background:#f59e0b"></i>MA5</span><span><i style="background:#1f5eff"></i>MA20</span><span><i style="background:#9333ea"></i>MA60</span>
            <span class="muted">紅漲綠跌（港股慣例）</span>
          </div>
        </div>
      </div>

      <div class="card" v-if="data.bars?.length">
        <div class="card-head">
          <div class="card-title">技術指標圖表</div>
          <div class="card-sub">由 K 線即時計算，隨上方區間聯動</div>
          <div class="spacer"></div>
          <div class="chips">
            <button class="chip" :class="{ active: chartTab === 'bollinger' }" @click="chartTab = 'bollinger'">布林帶</button>
            <button class="chip" :class="{ active: chartTab === 'ma' }" @click="chartTab = 'ma'">移動平均</button>
            <button class="chip" :class="{ active: chartTab === 'volume' }" @click="chartTab = 'volume'">成交量</button>
            <button class="chip" :class="{ active: chartTab === 'macd' }" @click="chartTab = 'macd'">MACD</button>
            <button class="chip" :class="{ active: chartTab === 'rsi' }" @click="chartTab = 'rsi'">RSI</button>
            <button class="chip" :class="{ active: chartTab === 'kd' }" @click="chartTab = 'kd'">KD 隨機</button>
            <button class="chip" :class="{ active: chartTab === 'obv' }" @click="chartTab = 'obv'">OBV 能量潮</button>
            <button class="chip" :class="{ active: chartTab === 'mfi' }" @click="chartTab = 'mfi'">MFI 資金</button>
            <button class="chip" :class="{ active: chartTab === 'adx' }" @click="chartTab = 'adx'">ADX 趨勢</button>
            <button class="chip" :class="{ active: chartTab === 'cci' }" @click="chartTab = 'cci'">CCI</button>
            <button class="chip" :class="{ active: chartTab === 'bias' }" @click="chartTab = 'bias'">BIAS 乖離</button>
            <button class="chip" :class="{ active: chartTab === 'atr' }" @click="chartTab = 'atr'">ATR 波動</button>
            <button class="chip" :class="{ active: chartTab === 'donchian' }" @click="chartTab = 'donchian'">唐奇安通道</button>
          </div>
        </div>
        <div class="card-body tight">
          <component :is="chartMap[chartTab]" v-bind="chartProps()" />
        </div>
      </div>

      <div class="card" v-if="timeframes">
        <div class="card-head">
          <div class="card-title">多級別環境層（日／週／月）</div>
          <div class="card-sub">級別越高趨勢越可靠；各級方向不一致即「級別差」</div>
        </div>
        <div class="card-body">
          <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:10px">
            <div v-for="tf in tfRows" :key="tf.tf" style="flex:1; min-width:200px; border:1px solid var(--border); border-radius:10px; padding:10px 12px">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
                <b style="font-size:14px">{{ tf.tf }}線</b>
                <span class="tag" :class="tfClass(tf.state)">{{ tf.label }}</span>
              </div>
              <div style="display:flex; align-items:center; gap:10px">
                <Sparkline :values="tf.spark" :color="tfColor(tf.state)" :width="80" :height="26" />
                <div class="small muted" style="line-height:1.5">
                  收 <b class="mono">{{ fmtPrice(tf.close) }}</b><br>
                  MA20 <b class="mono">{{ fmtPrice(tf.ma20) }}</b> · 斜率 {{ tf.slope != null ? (tf.slope > 0 ? '+' : '') + tf.slope.toFixed(1) + '%' : '—' }}
                </div>
              </div>
            </div>
          </div>
          <div class="section-note">{{ timeframes.summary }}</div>
        </div>
      </div>

      <div class="card" v-if="regime">
        <div class="card-head">
          <div class="card-title">市況判定引擎（八維 → 三態）</div>
          <div class="card-sub">先判環境、再選工具：{{ regime.computed }}/{{ regime.total }} 維可即時計算，其餘待接入</div>
          <div class="spacer"></div>
          <span class="tag" :class="regimeClass(regime.regime)">{{ regime.label }}</span>
          <span class="tag">信心：{{ regime.confidenceLabel }}</span>
        </div>
        <div class="card-body">
          <div style="display:flex; gap:18px; align-items:center; flex-wrap:wrap; margin-bottom:12px">
            <div style="text-align:center; min-width:130px">
              <div class="mono" style="font-size:32px; font-weight:700" :class="regimeClass(regime.regime)">{{ regime.stateLabel }}市</div>
              <div class="small muted">連續 {{ regime.persistence.days }}/{{ regime.persistence.required }} 日維持</div>
            </div>
            <div style="flex:1; min-width:240px">
              <div class="small muted" style="margin-bottom:6px">八維投票（可算 {{ regime.computed }} 維，成立門檻 {{ regime.threshold }} 票）</div>
              <div style="display:flex; gap:10px; flex-wrap:wrap">
                <span class="tag up">上升 {{ regime.counts.bull }}</span>
                <span class="tag">震盪 {{ regime.counts.range }}</span>
                <span class="tag down">下跌 {{ regime.counts.bear }}</span>
              </div>
            </div>
          </div>
          <table class="data">
            <thead><tr><th class="txt">維度</th><th class="txt">判定</th><th class="txt">依據</th></tr></thead>
            <tbody>
              <tr v-for="d in regime.dims" :key="d.id">
                <td class="txt">{{ d.name }} <span class="tag mini" v-if="d.proxy">代理</span></td>
                <td class="txt">
                  <span class="tag" :class="regimeClass(d.state)" v-if="d.available">{{ d.stateLabel }}</span>
                  <span class="tag mini" v-else-if="d.pending">待接入</span>
                  <span class="tag mini" v-else>資料不足</span>
                </td>
                <td class="txt small">{{ d.display }}
                  <div class="muted" style="font-size:11px" v-if="d.reason">{{ d.reason }}</div>
                  <div class="muted" style="font-size:11px" v-else-if="d.note">{{ d.note }}</div>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="section-note">{{ regime.advice }}</div>
        </div>
      </div>

      <div class="card" v-if="applicability">
        <div class="card-head">
          <div class="card-title">指標適用性路由</div>
          <div class="card-sub">當前「{{ applicability.label }}」下，各指標該不該看</div>
        </div>
        <div class="card-body">
          <table class="data">
            <thead><tr><th class="txt">指標</th><th class="txt">效力</th><th class="txt">怎麼用</th></tr></thead>
            <tbody>
              <tr v-for="r in applicability.rows" :key="r.id">
                <td class="txt">{{ r.name }}</td>
                <td class="txt"><span class="tag" :class="r.cls">{{ r.icon }} {{ r.label }}</span></td>
                <td class="txt small">{{ r.hint }}</td>
              </tr>
            </tbody>
          </table>
          <div class="section-note">{{ applicability.summary }}</div>
        </div>
      </div>

      <div class="card" v-if="triggers">
        <div class="card-head">
          <div class="card-title">關鍵變量觸發台</div>
          <div class="card-sub">{{ triggers.counts.total - triggers.counts.pending }}/{{ triggers.counts.total }} 項可即時計算，其餘待接入外部數據</div>
          <div class="spacer"></div>
          <span class="tag down" v-if="triggers.counts.triggered">已觸發 {{ triggers.counts.triggered }}</span>
          <span class="tag warn" v-if="triggers.counts.watch">接近門檻 {{ triggers.counts.watch }}</span>
        </div>
        <div class="card-body">
          <table class="data">
            <thead><tr><th class="txt">變量</th><th class="txt">當前值</th><th class="txt">觸發線</th><th class="txt">狀態</th></tr></thead>
            <tbody>
              <tr v-for="t in triggers.rows" :key="t.id">
                <td class="txt">{{ t.name }}</td>
                <td class="txt">{{ t.value }}</td>
                <td class="txt small">{{ t.trigger }}</td>
                <td class="txt">
                  <span class="tag" :class="t.tone">{{ triggerStateText(t.state) }}</span>
                  <div class="muted" style="font-size:11px; margin-top:2px">{{ t.note }}</div>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="section-note">{{ triggers.summary }}</div>
        </div>
      </div>

      <div class="card" v-if="an">
        <div class="card-head">
          <div class="card-title">綜合決策摘要</div>
          <div class="card-sub">技術 40% ／ 基本面 40% ／ 風險 20%</div>
          <div class="spacer"></div>
          <span class="tag">信心指數：{{ verdict?.confidence ?? '—' }}</span>
          <span class="tag" v-if="verdict">資料完整度 {{ verdict.dataAvailability }}/7</span>
        </div>
        <div class="card-body">
          <div style="display:flex; gap:18px; align-items:center; flex-wrap:wrap">
            <div style="text-align:center; min-width:120px">
              <div class="mono" style="font-size:38px; font-weight:700" :class="verdictTone()">{{ verdict?.overall ?? '—' }}</div>
              <div class="tag" :class="verdictTone()">{{ verdict?.verdict?.label ?? '—' }}</div>
            </div>
            <div style="text-align:center">
              <RadarChart :items="verdictRadar" :size="200" />
              <div class="small muted">技術／基本／風險</div>
            </div>
            <div style="flex:1; min-width:280px">
              <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px">
                <div><div class="small muted">技術面</div><div class="mono" style="font-size:18px">{{ verdict?.techScore ?? '—' }}</div></div>
                <div><div class="small muted">基本面</div><div class="mono" style="font-size:18px">{{ verdict?.fundScore ?? '—' }}</div></div>
                <div><div class="small muted">風險分</div><div class="mono" style="font-size:18px">{{ verdict?.riskScore ?? '—' }}</div></div>
                <div><div class="small muted">風險等級</div><div style="font-size:18px">{{ verdict?.riskLevel ?? '—' }}</div></div>
                <div><div class="small muted">建議關注期</div><div style="font-size:18px">{{ verdict?.timeHorizon ?? '—' }}</div></div>
              </div>
              <div style="display:flex; gap:10px; flex-wrap:wrap">
                <span class="tag">支撐 {{ fmtPrice(verdict?.support) }}</span>
                <span class="tag">壓力 {{ fmtPrice(verdict?.resistance) }}</span>
                <span class="tag accent" v-if="verdict?.entryZone?.low != null">進場參考區間 {{ fmtPrice(verdict.entryZone.low) }} ~ {{ fmtPrice(verdict.entryZone.high) }}</span>
                <span class="tag warn" v-if="verdict?.stopLoss != null">參考止蝕 {{ fmtPrice(verdict.stopLoss) }}</span>
                <span class="tag" v-if="verdict?.takeProfit1 != null">目標一 {{ fmtPrice(verdict.takeProfit1) }}</span>
                <span class="tag" v-if="verdict?.takeProfit2 != null">目標二 {{ fmtPrice(verdict.takeProfit2) }}</span>
                <span class="tag" v-if="verdict?.riskReward != null">風險回報比 {{ verdict.riskReward }}</span>
              </div>
            </div>
          </div>

          <div class="grid cols-2" style="margin-top:14px">
            <div>
              <div class="small muted" style="margin-bottom:6px">支持因素</div>
              <ul class="small" style="margin:0 0 0 18px; padding:0">
                <li v-for="(b, i) in (verdict?.bullish || [])" :key="'b'+i" style="margin-bottom:4px">
                  <span class="tag">{{ b.source }}</span> {{ b.text }}
                </li>
                <li v-if="!(verdict?.bullish || []).length" class="muted">無明顯支持訊號</li>
              </ul>
            </div>
            <div>
              <div class="small muted" style="margin-bottom:6px">風險因素</div>
              <ul class="small" style="margin:0 0 0 18px; padding:0">
                <li v-for="(b, i) in (verdict?.bearish || [])" :key="'s'+i" style="margin-bottom:4px">
                  <span class="tag warn">{{ b.source }}</span> {{ b.text }}
                </li>
                <li v-if="!(verdict?.bearish || []).length" class="muted">無明顯風險訊號</li>
              </ul>
            </div>
          </div>
          <div class="section-note">{{ verdict?.note }}</div>
        </div>
      </div>
      <div class="card" v-else-if="anLoading">
        <div class="card-head"><div class="card-title">綜合決策摘要</div></div>
        <div class="card-body"><div class="empty">分析計算中…</div></div>
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title">關鍵指標</div><div class="card-sub">{{ data.bars.length }} 根日 K（{{ data.bars[0]?.date }} ~ {{ data.bars[data.bars.length-1]?.date }}）</div></div>
        <div class="card-body">
          <div class="kv">
            <div class="kv-item"><div class="kv-k">當日升跌</div><div class="kv-v" :class="toneClass(m.changePercent)">{{ m.change == null ? '—' : fmtChg(m.change) }} <span class="small muted">({{ m.changePercent == null ? '—' : (m.changePercent > 0 ? '+' : '') + m.changePercent.toFixed(2) + '%' }})</span></div></div>
            <div class="kv-item"><div class="kv-k">20 日均成交額</div><div class="kv-v">{{ fmtCompact(m.turnover20d) }}</div></div>
            <div class="kv-item"><div class="kv-k">殖利率（近 12 月）</div><div class="kv-v">{{ fmtPctRaw(m.dividendYieldTTM != null ? m.dividendYieldTTM*100 : null) }}</div></div>
            <div class="kv-item"><div class="kv-k">配息年數</div><div class="kv-v">{{ m.dividendYears ?? '—' }}</div></div>
            <div class="kv-item"><div class="kv-k">年化波動度</div><div class="kv-v">{{ fmtPctRaw(m.vol1y != null ? m.vol1y*100 : null, 1) }}</div></div>
            <div class="kv-item"><div class="kv-k">一年最大回撤</div><div class="kv-v down">{{ fmtPctRaw(m.mdd1y != null ? m.mdd1y*100 : null, 1) }}</div></div>
            <div class="kv-item"><div class="kv-k">夏普值（1 年）</div><div class="kv-v">{{ m.sharpe1y == null ? '—' : m.sharpe1y.toFixed(2) }}</div></div>
            <div class="kv-item"><div class="kv-k">{{ benchLabel }}</div><div class="kv-v">{{ m.beta1y == null ? '—' : m.beta1y.toFixed(2) }}</div></div>
            <div class="kv-item"><div class="kv-k">月度勝率</div><div class="kv-v">{{ fmtPctRaw(m.monthlyWinRate != null ? m.monthlyWinRate*100 : null, 0) }}</div></div>
            <div class="kv-item"><div class="kv-k">一年報酬</div><div class="kv-v" :class="toneClass(m.ret1y)">{{ fmtPctRaw(m.ret1y != null ? m.ret1y*100 : null, 1) }}</div></div>
            <div class="kv-item"><div class="kv-k">三個月報酬</div><div class="kv-v" :class="toneClass(m.ret3m)">{{ fmtPctRaw(m.ret3m != null ? m.ret3m*100 : null, 1) }}</div></div>
            <div class="kv-item"><div class="kv-k">RSI(14)</div><div class="kv-v">{{ m.rsi14 == null ? '—' : m.rsi14.toFixed(1) }}</div></div>
            <div class="kv-item"><div class="kv-k">52 週區間</div><div class="kv-v small">{{ fmtPrice(m.low52w) }} ~ {{ fmtPrice(m.high52w) }}</div></div>
          </div>
        </div>
      </div>

      <div class="card" v-if="riskData">
        <div class="card-head">
          <div class="card-title">風險報酬分佈</div>
          <div class="card-sub">回撤水線 · 日收益分佈 · 月度漲跌（近 250 交易日）</div>
        </div>
        <div class="card-body">
          <div class="grid cols-3">
            <div>
              <div class="small muted" style="margin-bottom:6px">最大回撤（水下曲線）</div>
              <DrawdownChart :risk="riskData" :height="240" v-if="riskData?.drawdown?.values?.length" />
              <div class="empty small" v-else>資料不足</div>
            </div>
            <div>
              <div class="small muted" style="margin-bottom:6px">日收益率分佈（%）</div>
              <HistChart :values="dailyHist" :center="true" :buckets="12" v-if="dailyHist.length" />
              <div class="empty small" v-else>資料不足</div>
            </div>
            <div>
              <div class="small muted" style="margin-bottom:6px">月度漲跌（紅漲綠跌）</div>
              <MonthlyBarChart :labels="monthlyChart.labels" :returns="monthlyChart.returns" v-if="monthlyChart.returns.length" />
              <div class="empty small" v-else>資料不足</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" v-if="equity">
        <div class="card-head">
          <div class="card-title">個股 vs 基準 淨值疊加</div>
          <div class="card-sub">同期歸一為 100，比較相對強弱</div>
        </div>
        <div class="card-body">
          <LineChart :series="compareEquity" :height="320" v-if="compareEquity.length" />
          <div class="empty small" v-else>基準資料不足，無法疊加</div>
          <div class="section-note">藍線為個股、橙線為{{ market==='us' ? 'S&P 500' : '恒生指數' }}；線在上方代表個股相對強於大盤。</div>
        </div>
      </div>

      <div class="card" v-if="rsSeries.length">
        <div class="card-head">
          <div class="card-title">相對強弱線（RS Line）vs 大盤</div>
          <div class="card-sub">個股淨值 ÷ 大盤淨值，重新基準為 100</div>
        </div>
        <div class="card-body">
          <LineChart :series="rsSeries" :height="320" />
          <div class="section-note">線在 100 上方＝個股同期跑贏大盤（數值越高越強勢）；跌破 100 代表落後。長期右上行是強勢股的重要特徵。</div>
        </div>
      </div>

      <div class="card" v-if="divergencesData">
        <div class="card-head">
          <div class="card-title">OBV 量價背離</div>
          <div class="card-sub">股價創高但 OBV 未跟 → 量能撤退（漲勢虛）；反向為底部背離</div>
        </div>
        <div class="card-body">
          <div v-if="!divergencesData.liquidEnough" class="section-note" style="margin-bottom:8px">⚠️ 日均成交額偏低，OBV 背離參考性弱（中小票易因單筆大單失真）。</div>
          <ul class="small" v-if="divergencesData.divergences.length" style="margin:0 0 0 18px; padding:0">
            <li v-for="(d,i) in divergencesData.divergences" :key="i" style="margin-bottom:6px">
              <span class="tag" :class="d.type==='bearish'?'down':'accent'">{{ d.label }}</span>
              {{ d.date0 }} → {{ d.date1 }}，股價 {{ fmtPrice(d.price0) }} → {{ fmtPrice(d.price1) }}，OBV 反向
            </li>
          </ul>
          <div class="empty small" v-else>近一年未發現明確量價背離（亦可在 OBV 圖查看標記）</div>
          <div class="section-note">{{ divergencesData.summary }}</div>
        </div>
      </div>

      <div class="card" v-if="heat">
        <div class="card-head"><div class="card-title">關注度與資金流向</div></div>
        <div class="card-body" style="display:flex; gap:18px; align-items:center; flex-wrap:wrap">
          <div style="text-align:center; min-width:110px">
            <div class="mono" style="font-size:36px; font-weight:700" :class="heatTone">{{ heat.attentionScore }}</div>
            <div class="tag" :class="heatTone === 'up' ? 'accent' : ''">關注度：{{ heat.attentionLevel }}</div>
          </div>
          <div style="flex:1; min-width:220px">
            <div class="small muted" style="margin-bottom:6px">資金流向</div>
            <span class="tag" :class="flowTone">{{ flowText }}</span>
            <div class="section-note" style="margin-top:10px">關注度由量能比與當日漲跌幅絕對值綜合估算；資金流向依 OBV 與 MFI 判斷，僅供參考。</div>
          </div>
        </div>
      </div>

      <div class="card" v-if="sellLadder">
        <div class="card-head">
          <div class="card-title">出場紀律階梯（賣出計畫）</div>
          <div class="card-sub">依文件：破 5 日減半、破 10 日續減、破 20 日清波段倉、破 60 日退場</div>
        </div>
        <div class="card-body">
          <div style="display:flex; gap:18px; align-items:center; flex-wrap:wrap; margin-bottom:10px">
            <span class="tag" :class="ladderClass(sellLadder.status)">{{ sellLadder.statusLabel }}</span>
            <div class="small muted" style="flex:1; min-width:240px">{{ sellLadder.statusNote }}</div>
          </div>
          <SellLadder :ladder="sellLadder" />
          <div class="legend" style="margin-top:6px">
            <span><i style="background:#0f9960"></i>均線站穩（持有）</span>
            <span><i style="background:#d9333f"></i>已跌破（執行減碼）</span>
            <span class="muted">綠色橫桿＝價格仍在均線上；紅色＝已跌破該均線</span>
          </div>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card" style="margin-top:0">
          <div class="card-head"><div class="card-title">評分解構</div>
            <div class="spacer"></div>
            <span class="score-pill" :class="scoreClass(data.score?.total)">{{ data.score?.total ?? '—' }}</span>
            <span class="tag">{{ data.grade?.label }}</span>
          </div>
          <div class="card-body" style="display:flex; gap:14px; align-items:center; flex-wrap:wrap">
            <RadarChart :items="radar" :size="260" />
            <div style="flex:1; min-width:200px">
              <div v-for="d in radar" :key="d.label" style="margin-bottom:7px">
                <div style="display:flex; justify-content:space-between; font-size:12px">
                  <span>{{ d.label }}</span><span class="mono">{{ d.value }}</span>
                </div>
                <div class="bar"><i :style="{ width: d.value + '%' }"></i></div>
              </div>
              <div class="section-note">覆蓋率 {{ data.score?.coverage ?? 0 }}%：缺資料的維度不計分，權重重新分配。</div>
            </div>
          </div>
          <div class="card-body" style="border-top:1px solid var(--border)">
            <div class="small muted" style="margin-bottom:6px">各策略評分</div>
            <HBarChart :items="presetRows.map(p => ({ label: p.label, value: p.value ?? 0 }))" />
          </div>
        </div>

        <div class="card" style="margin-top:0">
          <div class="card-head"><div class="card-title">基本面</div>
            <div class="card-sub" v-if="f.asOf">{{ (f.asOf || '').slice(0,10) }}</div>
            <div class="spacer"></div>
            <span v-if="!f.marketCap" class="tag warn">基本面資料未載入</span>
          </div>
          <div class="card-body">
            <div class="kv">
              <div class="kv-item"><div class="kv-k">市值</div><div class="kv-v">{{ fmtCompact(f.marketCap) }}</div></div>
              <div class="kv-item"><div class="kv-k">本益比 (TTM)</div><div class="kv-v">{{ f.trailingPE == null ? '—' : f.trailingPE.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">預估本益比</div><div class="kv-v">{{ f.forwardPE == null ? '—' : f.forwardPE.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">股價淨值比</div><div class="kv-v">{{ f.priceToBook == null ? '—' : f.priceToBook.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">ROE</div><div class="kv-v">{{ fmtPctRaw(f.returnOnEquity != null ? f.returnOnEquity*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">ROA</div><div class="kv-v">{{ fmtPctRaw(f.returnOnAssets != null ? f.returnOnAssets*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">淨利率</div><div class="kv-v">{{ fmtPctRaw(f.profitMargin != null ? f.profitMargin*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">毛利率</div><div class="kv-v">{{ fmtPctRaw(f.grossMargin != null ? f.grossMargin*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">營收成長</div><div class="kv-v" :class="toneClass(f.revenueGrowth)">{{ fmtPctRaw(f.revenueGrowth != null ? f.revenueGrowth*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">盈餘成長</div><div class="kv-v" :class="toneClass(f.earningsGrowth)">{{ fmtPctRaw(f.earningsGrowth != null ? f.earningsGrowth*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">Beta（5 年月）</div><div class="kv-v">{{ f.beta == null ? '—' : f.beta.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">每股淨值</div><div class="kv-v">{{ f.bookValue == null ? '—' : f.bookValue.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">負債權益比</div><div class="kv-v">{{ f.debtToEquity == null ? '—' : f.debtToEquity.toFixed(1) + '%' }}</div></div>
              <div class="kv-item"><div class="kv-k">流動比 / 速動比</div><div class="kv-v small">{{ f.currentRatio == null ? '—' : f.currentRatio.toFixed(2) }} / {{ f.quickRatio == null ? '—' : f.quickRatio.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">營運現金流</div><div class="kv-v">{{ fmtCompact(f.operatingCashflow) }}</div></div>
              <div class="kv-item"><div class="kv-k">自由現金流</div><div class="kv-v">{{ fmtCompact(f.freeCashflow) }}</div></div>
              <div class="kv-item"><div class="kv-k">EV / EBITDA</div><div class="kv-v">{{ f.enterpriseToEbitda == null ? '—' : f.enterpriseToEbitda.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">PEG 比率</div><div class="kv-v">{{ f.pegRatio == null ? '—' : f.pegRatio.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">股價營收比 (PS)</div><div class="kv-v">{{ f.priceToSales == null ? '—' : f.priceToSales.toFixed(2) }}</div></div>
              <div class="kv-item"><div class="kv-k">派息率</div><div class="kv-v">{{ fmtPctRaw(f.payoutRatio != null ? f.payoutRatio*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">5 年平均殖利率</div><div class="kv-v">{{ f.fiveYearAvgDividendYield == null ? '—' : f.fiveYearAvgDividendYield.toFixed(2) + '%' }}</div></div>
              <div class="kv-item"><div class="kv-k">機構持股</div><div class="kv-v">{{ fmtPctRaw(f.heldPercentInstitutions != null ? f.heldPercentInstitutions*100 : null, 1) }}</div></div>
              <div class="kv-item"><div class="kv-k">內部人持股</div><div class="kv-v">{{ fmtPctRaw(f.heldPercentInsiders != null ? f.heldPercentInsiders*100 : null, 2) }}</div></div>
            </div>
            <div class="section-note">來源：{{ f.source || '—' }}。數值經合理性驗證（超出區間者標記為缺值），僅供參考。</div>
          </div>
        </div>
      </div>

      <div class="card" v-if="factors.length">
        <div class="card-head">
          <div class="card-title">{{ factorsTitle }}</div>
          <div class="card-sub">每項 0–10 分，合計 {{ factorSummary?.total ?? 0 }} / 100</div>
          <div class="spacer"></div>
          <span class="score-pill" :class="scoreClass(factorSummary?.percent)">{{ factorSummary?.percent ?? 0 }}</span>
          <span class="tag">{{ factorSummary?.label }}</span>
        </div>
        <div class="card-body">
          <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap; margin-bottom:14px">
            <RadarChart :items="factorRadar" :size="240" />
            <div class="small muted" style="flex:1; min-width:200px">十大要素評分雷達（每項 0–10 分 ×10 轉為 0–100），面積越大代表綜合強度越高。</div>
          </div>
          <table class="data">
            <thead>
              <tr><th style="width:32px">#</th><th style="width:150px">要素</th><th style="width:110px">評分</th><th>觀察重點</th><th style="width:74px">評等</th></tr>
            </thead>
            <tbody>
              <tr v-for="fa in factors" :key="fa.no">
                <td class="mono muted">{{ fa.no }}</td>
                <td class="txt"><b>{{ fa.factor }}</b></td>
                <td>
                  <div style="display:flex; align-items:center; gap:6px">
                    <span class="mono">{{ fa.score }}</span>
                    <span class="bar" style="flex:1"><i :style="{ width: (fa.score / fa.maxScore * 100) + '%', background: fa.rating.tone === 'up' ? 'var(--up)' : fa.rating.tone === 'down' ? 'var(--down)' : 'var(--muted)' }"></i></span>
                  </div>
                </td>
                <td class="small muted txt">{{ (fa.signals || []).join('；') }}</td>
                <td><span class="tag" :class="fa.rating.tone === 'up' ? 'accent' : ''">{{ fa.rating.label }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card-body" style="border-top:1px solid var(--border)" v-if="layers.length">
          <div class="small muted" style="margin-bottom:6px">四層決策框架（自上而下）</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap">
            <span v-for="l in layers" :key="l.label" class="tag">{{ l.label }} <b class="mono">{{ l.percent }}%</b></span>
          </div>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card" style="margin-top:0" v-if="techSignals.length">
          <div class="card-head">
            <div class="card-title">技術面十大訊號</div>
            <div class="card-sub">加權總分 {{ an?.indicators?.technical?.score ?? '—' }} · {{ an?.indicators?.technical?.summary?.label ?? '' }}</div>
          </div>
          <div class="card-body tight">
            <table class="data">
              <thead><tr><th>項目</th><th style="width:56px">權重</th><th style="width:62px">貢獻</th><th>說明</th></tr></thead>
              <tbody>
                <tr v-for="s in techSignals" :key="s.key">
                  <td class="txt">{{ s.label }}</td>
                  <td class="mono muted">{{ (s.weight * 100).toFixed(0) }}%</td>
                  <td class="mono" :class="s.contribution > 0 ? 'up' : s.contribution < 0 ? 'down' : 'muted'">
                    {{ s.contribution > 0 ? '+' : '' }}{{ s.contribution.toFixed(2) }}
                  </td>
                  <td class="small muted txt">{{ s.remark }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card" style="margin-top:0" v-if="indRows.length">
          <div class="card-head"><div class="card-title">指標快照</div><div class="card-sub">{{ an?.asOf }}</div></div>
          <div class="card-body">
            <div class="kv">
              <div v-for="r in indRows" :key="r.label" class="kv-item">
                <div class="kv-k">{{ r.label }}</div><div class="kv-v mono">{{ r.value }}</div>
              </div>
            </div>
            <div style="margin-top:12px" v-if="maRows.length">
              <div class="small muted" style="margin-bottom:6px">均線階梯（括號為現價相對乖離）</div>
              <div style="display:flex; gap:6px; flex-wrap:wrap">
                <span v-for="r in maRows" :key="r.label" class="tag">
                  {{ r.label }} <b class="mono">{{ r.value }}</b>
                  <span v-if="r.diff != null" :class="r.diff >= 0 ? 'up' : 'down'">({{ r.diff > 0 ? '+' : '' }}{{ r.diff.toFixed(1) }}%)</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card" style="margin-top:0">
          <div class="card-head"><div class="card-title">股息紀錄</div><div class="card-sub">近 12 個月合計 {{ fmtNum(m.dividend12m) }} / 股</div></div>
          <div class="card-body tight">
            <table class="data">
              <thead><tr><th>除息日</th><th>每股股利</th><th>以現價計殖利率</th></tr></thead>
              <tbody>
                <tr v-for="d in divRows" :key="d.date">
                  <td class="txt">{{ d.date }}</td>
                  <td>{{ fmtNum(d.amount, 3) }}</td>
                  <td>{{ m.price ? (d.amount / m.price * 100).toFixed(2) + '%' : '—' }}</td>
                </tr>
                <tr v-if="!divRows.length"><td class="txt muted" colspan="3">查無股息紀錄</td></tr>
              </tbody>
            </table>
            <div v-if="(m.dividendNotes || []).length" style="padding:8px 10px; background:var(--warn-soft); border-top:1px solid var(--border)">
              <div class="small" style="color:var(--warn); font-weight:600; margin-bottom:4px">股息資料提醒</div>
              <ul class="small" style="margin:0 0 0 16px; padding:0; color:var(--text-2)">
                <li v-for="(n, i) in m.dividendNotes" :key="i">{{ n }}</li>
              </ul>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:0">
          <div class="card-head"><div class="card-title">資料品質與驗證</div></div>
          <div class="card-body">
            <div class="kv">
              <div class="kv-item"><div class="kv-k">資料來源</div><div class="kv-v small">{{ data.source }}</div></div>
              <div class="kv-item"><div class="kv-k">K 線筆數</div><div class="kv-v">{{ data.bars.length }}</div></div>
              <div class="kv-item"><div class="kv-k">最新交易日</div><div class="kv-v small">{{ data.bars[data.bars.length-1]?.date }}</div></div>
              <div class="kv-item"><div class="kv-k">驗證註記</div><div class="kv-v small">{{ data.issues?.length || 0 }} 則</div></div>
            </div>
            <ul v-if="data.issues?.length" class="small muted" style="margin:10px 0 0 18px; padding:0">
              <li v-for="(s,i) in data.issues" :key="i">{{ s }}</li>
            </ul>
            <div class="section-note">所有外部資料皆經清洗（剔除不完整 K 線、修正高低價、異常變動僅標記不刪除）後才進入指標計算。</div>
          </div>
        </div>
      </div>
    </template>
  </div>
  `,
});

export default StockView;
