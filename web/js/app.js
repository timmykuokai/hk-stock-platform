/**
 * app.js — 應用程式進入點：版面、導覽、路由、全域搜尋與提示
 */
import { createApp, ref, computed, watch, onMounted } from '../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from './api.js';
import { store } from './store.js';
import { fmtPctRaw, toneClass, fmtTime, fmtAge } from './format.js';
import DashboardView from './views/dashboard.js';
import ScreenerView from './views/screener.js';
import MoversView from './views/movers.js';
import CompareView from './views/compare.js';
import DailyPicksView from './views/dailyPicks.js';
import WatchlistView from './views/watchlist.js';
import NewsView from './views/news.js';
import StockView from './views/stock.js';
import ReportView from './views/report.js';
import UsMoversView from './views/usMovers.js';
import BacktestView from './views/backtest.js';
import PortfolioView from './views/portfolio.js';
import AlertsView from './views/alerts.js';
import SettingsView from './views/settings.js';

const NAV = [
  { id: 'dashboard', icon: '📊', label: '市場總覽' },
  { id: 'screener', icon: '🔍', label: '選股器' },
  { id: 'movers', icon: '⚡', label: '異動掃描' },
  { id: 'daily', icon: '🌟', label: '每日推介' },
  { id: 'news', icon: '📰', label: '即時新聞' },
  { id: 'report', icon: '📝', label: 'AI 報告' },
  { id: 'us-movers', icon: '🇺🇸', label: '美股異動' },
  { id: 'compare', icon: '🆚', label: '多股比較' },
  { id: 'watchlist', icon: '⭐', label: '自選股' },
  { id: 'backtest', icon: '🧪', label: '策略回測' },
  { id: 'portfolio', icon: '💼', label: '投資組合' },
  { id: 'alerts', icon: '🔔', label: '警報通知' },
  { id: 'settings', icon: '⚙️', label: '系統設定' },
];

const App = {
  components: {
    DashboardView, ScreenerView, MoversView, CompareView, DailyPicksView, WatchlistView, NewsView,
    StockView, ReportView, UsMoversView, BacktestView, PortfolioView, AlertsView, SettingsView,
  },
  setup() {
    const route = ref(parseHash());
    const query = ref('');
    const suggest = ref([]);
    const overview = computed(() => store.overview);

    // 字型設定（預設值，從 localStorage 讀取）
    const BASE_FONT_SIZE = 14; // 基準字體大小 (px)
    const FONT_SIZE_MIN = 12;
    const FONT_SIZE_MAX = 20;
    const FONT_STEP = 1;

    function loadSetting(key, defaultVal) {
      try {
        const v = localStorage.getItem(key);
        return v !== null ? JSON.parse(v) : defaultVal;
      } catch { return defaultVal; }
    }
    function saveSetting(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
    }

    const fontSizeStep = ref(Math.max(0, Math.round((loadSetting('fontSize', BASE_FONT_SIZE) - BASE_FONT_SIZE) / FONT_STEP)));
    const textColor = ref(loadSetting('textColor', '#1c2530'));

    const currentFontSize = computed(() => BASE_FONT_SIZE + fontSizeStep.value * FONT_STEP);

    function decreaseFont() {
      if (fontSizeStep.value > 0) {
        fontSizeStep.value--;
        saveSetting('fontSize', currentFontSize.value);
        document.documentElement.style.setProperty('--base-font-size', currentFontSize.value + 'px');
      }
    }
    function increaseFont() {
      if (fontSizeStep.value < (FONT_SIZE_MAX - BASE_FONT_SIZE) / FONT_STEP) {
        fontSizeStep.value++;
        saveSetting('fontSize', currentFontSize.value);
        document.documentElement.style.setProperty('--base-font-size', currentFontSize.value + 'px');
      }
    }
    function resetFont() {
      fontSizeStep.value = 0;
      saveSetting('fontSize', BASE_FONT_SIZE);
      document.documentElement.style.setProperty('--base-font-size', BASE_FONT_SIZE + 'px');
    }
    function changeTextColor(val) {
      textColor.value = val;
      saveSetting('textColor', val);
      document.documentElement.style.setProperty('--text', val);
    }
    function resetTextColor() {
      textColor.value = '#1c2530';
      saveSetting('textColor', textColor.value);
      document.documentElement.style.setProperty('--text', textColor.value);
    }

    // 資料新鮮度（最後更新時間）
    const primaryFresh = computed(() => store.freshness?.primary ?? null);
    const freshText = computed(() => (primaryFresh.value?.asOf ? fmtTime(primaryFresh.value.asOf) : '—'));
    const ageText = computed(() => fmtAge(primaryFresh.value?.ageMinutes ?? null));
    const stale = computed(() => (primaryFresh.value?.ageMinutes ?? 9999) > 180);
    const refreshData = () => store.refreshData();

    function parseHash() {
      const h = (location.hash || '#/dashboard').replace(/^#\/?/, '');
      const [view, param] = h.split('/');
      return { view: view || 'dashboard', param: param || null };
    }

    window.addEventListener('hashchange', () => { route.value = parseHash(); });

    function go(id) {
      location.hash = `#/${id}`;
    }
    function openStock(code) {
      location.hash = `#/stock/${code}`;
    }

    async function onQuery() {
      if (!query.value || query.value.length < 2) { suggest.value = []; return; }
      try {
        suggest.value = (await api.search(query.value)).items ?? [];
      } catch { suggest.value = []; }
    }
    function pick(s) {
      query.value = '';
      suggest.value = [];
      openStock(s.code);
    }

    const title = computed(() => {
      if (route.value.view === 'stock') return '個股詳情';
      return (NAV.find((n) => n.id === route.value.view) || NAV[0]).label;
    });

    onMounted(async () => {
      // 初始化字型設定（從 localStorage 讀取並套用）
      const savedFontSize = loadSetting('fontSize', BASE_FONT_SIZE);
      const savedTextColor = loadSetting('textColor', '#1c2530');
      document.documentElement.style.setProperty('--base-font-size', savedFontSize + 'px');
      document.documentElement.style.setProperty('--text', savedTextColor);
      // 同步 fontSizeStep 以反映已設定的字體大小
      fontSizeStep.value = Math.max(0, Math.round((savedFontSize - BASE_FONT_SIZE) / FONT_STEP));

      await store.init();
      setInterval(() => store.refreshOverview(), 5 * 60_000);
      setInterval(() => store.refreshFreshness(), 5 * 60_000);
    });

    return { NAV, route, go, openStock, query, suggest, onQuery, pick, overview, title, ui, store, fmtPctRaw, toneClass, fmtTime, fmtAge, withBusy,
      primaryFresh, freshText, ageText, stale, refreshData,
      fontSizeStep, currentFontSize, textColor, decreaseFont, increaseFont, resetFont, changeTextColor, resetTextColor };
  },
  template: `
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">HK</div>
        <div>
          <div class="brand-text">港股分析平台</div>
          <div class="brand-sub">篩選 · 評分 · 回測</div>
        </div>
      </div>
      <button v-for="n in NAV" :key="n.id" class="nav-item" :class="{ active: route.view === n.id }" @click="go(n.id)">
        <span class="nav-ico">{{ n.icon }}</span><span>{{ n.label }}</span>
      </button>
      <button class="nav-item" :class="{ active: route.view === 'stock' }" @click="go('screener')">
        <span class="nav-ico">📈</span><span>個股詳情</span>
      </button>
      <div class="sidebar-foot">
        資料更新：{{ freshText }}<br />
        資料：Yahoo Finance（行情／K線／基本面）<br />
        交叉驗證：etnet 二十大成交
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div v-for="i in (overview?.indices || [])" :key="i.code" class="index-chip">
          <span class="index-name">{{ i.zh || i.name }}</span>
          <span class="index-val" :class="toneClass(i.changePercent)">{{ i.price == null ? '—' : i.price.toLocaleString('zh-HK', {maximumFractionDigits:2}) }}</span>
          <span class="index-chg" :class="toneClass(i.changePercent)">{{ fmtPctRaw(i.changePercent) }}</span>
        </div>
        <div class="topbar-right">
          <div class="fresh-chip" :class="{ stale }" :title="'資料最後更新時間'">
            <span class="fresh-dot"></span>
            資料更新：<b>{{ freshText }}</b>
            <span class="fresh-age" v-if="primaryFresh">{{ ageText }}</span>
          </div>
          <button class="btn sm" @click="refreshData" :disabled="ui.busy">更新全部資料</button>
          <div style="position:relative">
            <input v-model="query" @input="onQuery" placeholder="搜尋代號／名稱" style="width:190px" />
            <div v-if="suggest.length" class="card" style="position:absolute; right:0; top:34px; width:280px; z-index:40; box-shadow:var(--shadow-lg)">
              <div v-for="s in suggest.slice(0,8)" :key="s.code" class="rule-row" style="cursor:pointer" @click="pick(s)">
                <b class="mono">{{ s.code }}</b>
                <span class="small muted">{{ s.zh || s.name }}</span>
                <span class="tag" :class="s.market==='us' ? 'accent' : ''">{{ s.market === 'us' ? '美股' : (s.board || '港股') }}</span>
              </div>
            </div>
          </div>
          <span v-if="ui.busy" class="tag accent">處理中…</span>
          <!-- 字型控制 -->
          <div class="font-controls" title="字型大小與顏色設定">
            <button class="btn sm font-btn" @click="decreaseFont" :title="'縮小字體 (目前 ' + currentFontSize + 'px)'">A-</button>
            <button class="btn sm font-btn" @click="increaseFont" :title="'放大字體 (目前 ' + currentFontSize + 'px)'">A+</button>
            <button class="btn sm font-btn" @click="resetFont" :title="'重置字體大小'">⟲</button>
            <input type="color" :value="textColor" @input="changeTextColor($event.target.value)" class="color-picker" title="選擇文字顏色" />
            <button class="btn sm font-btn" @click="resetTextColor" :title="'重置文字顏色'">↺</button>
          </div>
        </div>
      </header>

      <main class="content">
        <h2 style="margin:0 0 12px; font-size:17px">{{ title }}<span v-if="route.param" class="muted" style="font-weight:400"> · {{ route.param }}</span></h2>

        <DashboardView v-if="route.view === 'dashboard'" @open="openStock" />
        <ScreenerView v-else-if="route.view === 'screener'" @open="openStock" />
        <MoversView v-else-if="route.view === 'movers'" @open="openStock" />
        <DailyPicksView v-else-if="route.view === 'daily'" @open="openStock" />
        <CompareView v-else-if="route.view === 'compare'" @open="openStock" />
        <WatchlistView v-else-if="route.view === 'watchlist'" @open="openStock" />
        <NewsView v-else-if="route.view === 'news'" @open="openStock" />
        <ReportView v-else-if="route.view === 'report'" :code="route.param" @open="openStock" />
        <UsMoversView v-else-if="route.view === 'us-movers'" @open="openStock" />
        <StockView v-else-if="route.view === 'stock'" :code="route.param" @open="openStock" />
        <BacktestView v-else-if="route.view === 'backtest'" />
        <PortfolioView v-else-if="route.view === 'portfolio'" @open="openStock" />
        <AlertsView v-else-if="route.view === 'alerts'" />
        <SettingsView v-else-if="route.view === 'settings'" />

        <div class="section-note" style="margin-top:18px">
          ⚠️ 本平台之資料與分析結果僅供研究參考，不構成任何投資建議或個股推薦。投資有風險，決策請自行審慎評估。
        </div>
      </main>
    </div>

    <div class="toast-wrap">
      <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="{ err: t.kind === 'err' }">{{ t.msg }}</div>
    </div>
  </div>
  `,
};

createApp(App).mount('#app');
