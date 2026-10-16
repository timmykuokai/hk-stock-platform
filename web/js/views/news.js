/**
 * news.js — 即時新聞（當日熱門十大要聞）。
 * 調用 /api/news：聚合 Yahoo HK / Yahoo US / AAStocks 三源，
 * 依市場（港股 / 美股 / 環球）分類並按時間排序，提供 tab 切換與「立即更新」(live)。
 */
import { defineComponent, ref, computed, onMounted } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { fmtTime, fmtAge } from '../format.js';

const MKT_LABEL = { hk: '港股', us: '美股', global: '環球' };

export const NewsView = defineComponent({
  name: 'NewsView',
  setup(_props, { emit }) {
    const data = ref(null);
    const loading = ref(false);
    const market = ref('all');

    async function load(live = false) {
      loading.value = true;
      try {
        data.value = await api.news(market.value, 10, live);
      } catch (e) {
        ui.error(`新聞載入失敗：${e.message}`);
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    async function refresh() {
      await withBusy(async () => {
        await load(true);
      }, '更新新聞失敗');
    }

    const items = computed(() => data.value?.items ?? []);
    const ageText = computed(() => fmtAge(data.value?.asOf ? Math.round((Date.now() - new Date(data.value.asOf).getTime()) / 60000) : null));

    function ageOf(it) {
      if (!it.publishedAt) return '熱門';
      const mins = Math.round((Date.now() - it.publishedAt) / 60000);
      return fmtAge(mins);
    }

    const open = (code) => emit('open', code);
    const setMarket = (m) => { market.value = m; load(); };

    onMounted(() => load());

    return {
      data, loading, market, items, ageText, ageOf, open, setMarket, refresh, MKT_LABEL,
    };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">📰 即時新聞 · 當日熱門十大要聞</div>
        <div class="card-sub" v-if="data">更新 {{ fmtTime(data.asOf) }}（{{ ageText }}）· 來源：{{ (data.sources || []).join(' / ') || '—' }}</div>
        <div class="spacer"></div>
        <button class="btn sm" @click="refresh" :disabled="loading || ui.busy">立即更新</button>
      </div>
      <div class="card-body" style="padding-bottom:10px">
        <div class="chips">
          <span class="chip" :class="{ active: market === 'all' }" @click="setMarket('all')">全部</span>
          <span class="chip" :class="{ active: market === 'hk' }" @click="setMarket('hk')">港股要聞</span>
          <span class="chip" :class="{ active: market === 'us' }" @click="setMarket('us')">美股要聞</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">要聞清單</div>
        <div class="card-sub">{{ items.length }} 則 · 依時間排序</div>
      </div>
      <div class="card-body">
        <div v-if="loading && !data" class="empty">載入中…</div>
        <div v-else-if="!items.length" class="empty muted">暫無新聞，請稍後再試或按「立即更新」。</div>
        <div v-for="n in items" :key="n.rank + n.title" class="news-card">
          <div class="news-rank">{{ n.rank }}</div>
          <div class="news-main">
            <div class="news-tags">
              <span class="tag" :class="'mkt-' + n.market">{{ MKT_LABEL[n.market] || '環球' }}</span>
              <span class="tag ghost">{{ n.source }}</span>
            </div>
            <a class="news-title" :href="n.link" target="_blank" rel="noopener">{{ n.title }}</a>
            <div v-if="n.summary" class="news-sum">{{ n.summary }}</div>
            <div class="news-foot">
              <span class="small muted">{{ ageOf(n) }}</span>
              <span v-for="c in (n.related || [])" :key="c" class="tag mini" @click="open(c)">{{ c }} ↗</span>
            </div>
          </div>
        </div>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border)">
        <div class="section-note">新聞內容擷取自公開來源（Yahoo Finance HK / Yahoo Finance US / AAStocks），僅供研究參考，不構成任何投資建議。請以原始媒體報導為準。</div>
      </div>
    </div>
  </div>
  `,
});

export default NewsView;
