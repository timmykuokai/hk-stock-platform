/**
 * dashboard.js — 市場總覽儀表板
 */
import { defineComponent, ref, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui } from '../api.js';
import { store } from '../store.js';
import { fmtPrice, fmtPctRaw, fmtCompact, toneClass, scoreClass, fmtTime, fmtAge, fmtChg } from '../format.js';
import { ScatterChart, HistChart } from '../components/charts.js';

export const DashboardView = defineComponent({
  name: 'DashboardView',
  components: { ScatterChart, HistChart },
  setup(_, { emit }) {
    void emit;
    const data = ref(null);
    const screenData = ref(null);
    const news = ref(null);
    const loading = ref(false);

    async function load() {
      loading.value = true;
      try {
        await store.refreshOverview();
        data.value = store.overview;
        screenData.value = await api.screen({ pool: 'popular', filters: [], preset: 'balanced', sortBy: 'score', limit: 200 });
        news.value = await api.news('all', 5).catch(() => null);
      } catch (e) {
        ui.error(`載入失敗：${e.message}`);
      } finally {
        loading.value = false;
      }
    }

    const idx = computed(() => data.value?.indices ?? []);
    const breadth = computed(() => data.value?.breadth ?? null);
    const scatter = computed(() => (screenData.value?.items ?? []).map((it) => ({
      x: it.metrics.vol1y, y: it.metrics.ret1y, r: it.metrics.marketCap || 0,
      score: it.score?.total ?? 0, code: it.code, name: it.zhName || it.name,
    })));
    const hist = computed(() => (screenData.value?.items ?? []).map((it) => it.score?.total).filter((v) => v != null));
    const topScored = computed(() => (screenData.value?.items ?? []).slice(0, 12));
    const newsItems = computed(() => news.value?.items ?? []);
    const mktLabel = (m) => ({ hk: '港股', us: '美股', global: '環球' }[m] || '環球');
    const newsAge = (it) => (it.publishedAt ? fmtAge(Math.round((Date.now() - it.publishedAt) / 60000)) : '熱門');

    onMounted(load);

    return { data, loading, idx, breadth, scatter, hist, topScored, newsItems, mktLabel, newsAge, load, fmtPrice, fmtPctRaw, fmtCompact, toneClass, scoreClass, fmtTime, fmtAge, fmtChg, store };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">市場總覽</div>
        <div class="card-sub" v-if="data?.snapshotAsOf">池資料 {{ fmtTime(data.snapshotAsOf) }}</div>
        <div class="spacer"></div>
        <button class="btn sm" @click="load" :disabled="loading">{{ loading ? '更新中…' : '重新整理' }}</button>
      </div>
      <div class="card-body">
        <div class="grid kpi">
          <div class="kpi" v-for="i in idx" :key="i.code">
            <div class="kpi-label">{{ i.zh || i.name }}</div>
            <div class="kpi-value" :class="toneClass(i.changePercent)">{{ i.price == null ? '—' : i.price.toLocaleString('zh-HK', {maximumFractionDigits:2}) }}</div>
            <div class="kpi-sub" :class="toneClass(i.changePercent)">{{ i.change == null ? fmtPctRaw(i.changePercent) : fmtChg(i.change) + ' (' + fmtPctRaw(i.changePercent) + ')' }}</div>
          </div>
          <div class="kpi" v-if="breadth">
            <div class="kpi-label">池內漲跌家數</div>
            <div class="kpi-value"><span class="up">{{ breadth.advancers }}</span> / <span class="down">{{ breadth.decliners }}</span></div>
            <div class="kpi-sub">母體 {{ breadth.universe }} 檔</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:14px">
      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">成交金額排行</div><div class="card-sub">20 日均成交額</div></div>
        <div class="card-body tight">
          <table class="data">
            <thead><tr><th>代號／名稱</th><th>成交額</th><th>股價</th><th>日漲跌</th><th>評分</th></tr></thead>
            <tbody>
              <tr v-for="r in data?.topTurnover || []" :key="r.code" class="clickable" @click="$emit('open', r.code)">
                <td class="txt"><b>{{ r.code }}</b> <span class="small muted">{{ r.name || '' }}</span></td>
                <td>{{ fmtCompact(r.turnover) }}</td>
                <td>{{ fmtPrice(r.price) }}</td>
                <td :class="toneClass(r.changePercent)">{{ r.change == null ? fmtPctRaw(r.changePercent) : fmtChg(r.change) + ' (' + fmtPctRaw(r.changePercent) + ')' }}</td>
                <td><span class="score-pill" :class="scoreClass(r.score)">{{ r.score ?? '—' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">評分領先</div><div class="card-sub">均衡型評分前 12 名</div></div>
        <div class="card-body tight">
          <table class="data">
            <thead><tr><th>代號／名稱</th><th>評分</th><th>股價</th><th>殖利率</th><th>波動度</th></tr></thead>
            <tbody>
              <tr v-for="it in topScored" :key="it.code" class="clickable" @click="$emit('open', it.code)">
                <td class="txt"><b>{{ it.code }}</b> <span class="small muted">{{ it.zhName || it.name || '' }}</span></td>
                <td><span class="score-pill" :class="scoreClass(it.score?.total)">{{ it.score?.total ?? '—' }}</span></td>
                <td>{{ fmtPrice(it.metrics.price) }}</td>
                <td>{{ fmtPctRaw(it.metrics.dividendYieldTTM != null ? it.metrics.dividendYieldTTM*100 : null) }}</td>
                <td>{{ fmtPctRaw(it.metrics.vol1y != null ? it.metrics.vol1y*100 : null, 1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="grid cols-3" style="margin-top:14px">
      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">一月漲幅</div></div>
        <div class="card-body tight">
          <table class="data">
            <thead><tr><th>代號</th><th>名稱</th><th>報酬</th></tr></thead>
            <tbody>
              <tr v-for="r in data?.gainers || []" :key="r.code" class="clickable" @click="$emit('open', r.code)">
                <td class="txt"><b>{{ r.code }}</b></td><td class="txt small">{{ r.name }}</td>
                <td class="up">{{ fmtPctRaw(r.ret1m != null ? r.ret1m*100 : null, 1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">一月跌幅</div></div>
        <div class="card-body tight">
          <table class="data">
            <thead><tr><th>代號</th><th>名稱</th><th>報酬</th></tr></thead>
            <tbody>
              <tr v-for="r in data?.losers || []" :key="r.code" class="clickable" @click="$emit('open', r.code)">
                <td class="txt"><b>{{ r.code }}</b></td><td class="txt small">{{ r.name }}</td>
                <td class="down">{{ fmtPctRaw(r.ret1m != null ? r.ret1m*100 : null, 1) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">高殖利率</div></div>
        <div class="card-body tight">
          <table class="data">
            <thead><tr><th>代號</th><th>名稱</th><th>殖利率</th></tr></thead>
            <tbody>
              <tr v-for="r in data?.highYield || []" :key="r.code" class="clickable" @click="$emit('open', r.code)">
                <td class="txt"><b>{{ r.code }}</b></td><td class="txt small">{{ r.name }}</td>
                <td class="up">{{ fmtPctRaw(r.yield != null ? r.yield*100 : null) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:14px">
      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">風險 × 報酬</div><div class="card-sub">熱門池（圓點大小＝市值）</div></div>
        <div class="card-body"><ScatterChart :points="scatter" /></div>
      </div>
      <div class="card" style="margin-top:0">
        <div class="card-head"><div class="card-title">評分分佈</div><div class="card-sub">均衡型</div></div>
        <div class="card-body"><HistChart :values="hist" /></div>
      </div>
    </div>

    <div class="card" v-if="data?.etnetTop?.length">
      <div class="card-head"><div class="card-title">etnet 二十大成交（外部交叉驗證）</div>
        <div class="card-sub" v-if="data.etnetAsOf">{{ fmtTime(data.etnetAsOf) }}</div></div>
      <div class="card-body tight">
        <table class="data">
          <thead><tr><th>#</th><th>代號／名稱</th><th>按盤價</th><th>變動</th><th>變動率</th><th>成交金額</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in data.etnetTop" :key="r.code">
              <td class="txt">{{ r.rank }}</td>
              <td class="txt"><b>{{ r.code }}</b> {{ r.name }}</td>
              <td>{{ fmtPrice(r.price) }}</td>
              <td :class="toneClass(r.change)">{{ r.change == null ? '—' : (r.change>0?'+':'') + r.change }}</td>
              <td :class="toneClass(r.changePercent)">{{ fmtPctRaw(r.changePercent) }}</td>
              <td>{{ r.amountRaw || '—' }}</td>
              <td class="txt"><a class="btn sm ghost" target="_blank" rel="noopener" :href="'https://www.etnet.com.hk/www/tc/stocks/realtime/quote.php?code=' + r.code">etnet</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div class="card-title">📰 今日要聞</div>
        <div class="card-sub" v-if="news?.asOf">更新 {{ fmtTime(news.asOf) }}</div>
        <div class="spacer"></div>
        <a class="btn sm ghost" href="#/news">查看全部</a>
      </div>
      <div class="card-body tight">
        <div v-if="!newsItems.length" class="empty muted">暫無新聞。</div>
        <div v-for="n in newsItems" :key="n.rank + n.title" class="news-row">
          <span class="tag mini" :class="'mkt-' + n.market">{{ mktLabel(n.market) }}</span>
          <a class="news-row-title" :href="n.link" target="_blank" rel="noopener">{{ n.title }}</a>
          <span class="small muted news-row-meta">{{ n.source }} · {{ newsAge(n) }}</span>
        </div>
      </div>
    </div>
  </div>
  `,
});

export default DashboardView;
