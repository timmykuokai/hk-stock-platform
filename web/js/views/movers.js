/**
 * movers.js — 異動掃描：把整個池快照換成六種視角，快速回答「市場今天發生什麼事」。
 * 概念移植自原 Python 版的熱門股掃描（gainers / losers / 成交額 / 量能 / 逼近新高 / 熱門組合），
 * 另加技術訊號快篩（MACD 金叉死叉、RSI 超買超賣、量能爆發…）。
 */
import { defineComponent, ref, computed, onMounted, watch } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtPrice, fmtPctRaw, fmtCompact, fmtNum, toneClass, fmtChg } from '../format.js';

export const MoversView = defineComponent({
  name: 'MoversView',
  setup(_props, { emit }) {
    const data = ref(null);
    const signals = ref([]);
    const loading = ref(false);
    const pool = ref('popular');
    const view = ref('gainers');
    const limit = ref(15);
    const pools = computed(() => store.meta?.pools ?? []);

    async function load() {
      loading.value = true;
      try {
        const [mv, sg] = await Promise.all([
          api.movers(pool.value, limit.value),
          api.signals(pool.value, 24).catch(() => ({ items: [] })),
        ]);
        data.value = mv;
        signals.value = sg.items ?? [];
      } catch (e) {
        ui.error(`異動掃描失敗：${e.message}`);
        data.value = null;
      } finally {
        loading.value = false;
      }
    }

    onMounted(load);
    watch([pool, limit], load);

    const views = computed(() => data.value?.views ?? []);
    const rows = computed(() => data.value?.[view.value] ?? []);

    const viewMeta = computed(() => views.value.find((v) => v.id === view.value) ?? null);

    /** 依視角決定要顯示哪些欄位 */
    const columns = computed(() => {
      const base = [
        { key: 'code', label: '代號', fmt: (r) => r.code, cls: 'mono' },
        { key: 'name', label: '名稱', fmt: (r) => r.name || r.enName || '—', cls: 'txt' },
        { key: 'price', label: '現價', fmt: (r) => fmtPrice(r.price) },
        { key: 'changePercent', label: '漲跌幅', fmt: (r) => (r.changePercent == null ? '—' : fmtChg(r.change) + ' (' + (r.changePercent > 0 ? '+' : '') + r.changePercent.toFixed(2) + '%)'), tone: 'changePercent' },
      ];
      const extra = {
        gainers: [], losers: [],
        value: [{ key: 'turnover20d', label: '20 日均成交額', fmt: (r) => fmtCompact(r.turnover20d) }],
        surge: [{ key: 'volRatio', label: '量能比', fmt: (r) => (r.volRatio == null ? '—' : r.volRatio.toFixed(2) + 'x') }],
        high52: [{ key: 'near52w', label: '距 52 週高', fmt: (r) => (r.near52w == null ? '—' : (r.near52w * 100).toFixed(1) + '%') }],
        hot: [
          { key: 'volRatio', label: '量能比', fmt: (r) => (r.volRatio == null ? '—' : r.volRatio.toFixed(2) + 'x') },
          { key: 'turnover20d', label: '20 日均成交額', fmt: (r) => fmtCompact(r.turnover20d) },
        ],
      }[view.value] ?? [];
      return [
        ...base,
        ...extra,
        { key: 'rsi14', label: 'RSI(14)', fmt: (r) => (r.rsi14 == null ? '—' : r.rsi14.toFixed(1)) },
        { key: 'ret1m', label: '近月報酬', fmt: (r) => fmtPctRaw(r.ret1m != null ? r.ret1m * 100 : null, 1), tone: 'ret1m' },
        { key: 'score', label: '平台評分', fmt: (r) => (r.score == null ? '—' : r.score.toFixed(1)) },
      ];
    });

    const open = (code) => emit('open', code);

    return {
      data, signals, loading, pool, view, limit, pools, views, rows, viewMeta, columns, open,
      fmtPrice, fmtPctRaw, fmtCompact, fmtNum, toneClass, fmtChg,
      refresh: () => withBusy(load, '重新掃描失敗'),
      addWatch: (code) => store.toggleWatch(code),
      inWatch: (code) => store.watchlist.includes(code),
    };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">異動掃描</div>
        <div class="card-sub" v-if="data">池：{{ data.pool }} · {{ data.universe }} 檔 · 快照 {{ (data.asOf || '').slice(0,16).replace('T',' ') }}</div>
        <div class="spacer"></div>
        <select v-model="pool" style="width:150px">
          <option v-for="p in pools" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
        <select v-model.number="limit" style="width:96px">
          <option :value="10">前 10</option>
          <option :value="15">前 15</option>
          <option :value="25">前 25</option>
          <option :value="40">前 40</option>
        </select>
        <button class="btn sm" @click="refresh">重新掃描</button>
      </div>
      <div class="card-body" style="padding-bottom:4px">
        <div class="chips">
          <button v-for="v in views" :key="v.id" class="chip" :class="{ active: view === v.id }" @click="view = v.id">
            {{ v.icon }} {{ v.label }}
          </button>
        </div>
        <div class="small muted" style="margin-top:6px" v-if="viewMeta">{{ viewMeta.desc }}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">{{ viewMeta?.label || '' }}排行</div><div class="card-sub">{{ rows.length }} 筆</div></div>
      <div class="card-body tight">
        <div v-if="loading && !data" class="empty">掃描中…</div>
        <table class="data" v-else>
          <thead>
            <tr>
              <th style="width:34px">#</th>
              <th v-for="c in columns" :key="c.key">{{ c.label }}</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.code" @click="open(r.code)" style="cursor:pointer">
              <td class="mono muted">{{ i + 1 }}</td>
              <td v-for="c in columns" :key="c.key" :class="[c.cls, c.tone ? toneClass(r[c.tone]) : '']">{{ c.fmt(r) }}</td>
              <td>
                <button class="btn sm ghost" @click.stop="addWatch(r.code)">{{ inWatch(r.code) ? '★' : '☆' }}</button>
              </td>
            </tr>
            <tr v-if="!loading && !rows.length"><td class="txt muted" :colspan="columns.length + 2">此視角目前無符合標的</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">技術訊號快篩</div>
        <div class="card-sub">MACD 金叉／死叉、RSI 超買超賣、量能 ≥2 倍、逼近 52 週高、深度修正</div>
      </div>
      <div class="card-body tight">
        <table class="data" v-if="signals.length">
          <thead>
            <tr><th style="width:64px">代號</th><th>名稱</th><th style="width:88px">現價</th><th style="width:88px">漲跌幅</th><th>觸發訊號</th><th style="width:70px">RSI</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in signals" :key="s.code" @click="open(s.code)" style="cursor:pointer">
              <td class="mono">{{ s.code }}</td>
              <td class="txt">{{ s.name || s.enName || '—' }}</td>
              <td>{{ fmtPrice(s.price) }}</td>
              <td :class="toneClass(s.changePercent)">{{ s.changePercent == null ? '—' : fmtChg(s.change) + ' (' + (s.changePercent > 0 ? '+' : '') + s.changePercent.toFixed(2) + '%)' }}</td>
              <td class="txt">
                <span v-for="t in s.tags" :key="t" class="tag" style="margin-right:4px">{{ t }}</span>
              </td>
              <td class="mono">{{ s.rsi14 == null ? '—' : s.rsi14.toFixed(1) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">目前無標的觸發技術訊號</div>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border)">
        <div class="section-note">
          掃描來源為池快照已計算完成的指標，口徑與選股器一致；點擊任一列可開啟個股詳情。
        </div>
      </div>
    </div>
  </div>
  `,
});

export default MoversView;
