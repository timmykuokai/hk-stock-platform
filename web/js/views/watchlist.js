/**
 * watchlist.js — 自選股（我最關注）。
 * 列出已加入自選的代號，並即時抓取每檔的價格、殖利率、波動度與平台評分；
 * 與每日推介、選股器、個股頁的「☆」按鈕互通。
 */
import { defineComponent, ref, computed, onMounted, watch } from '../../vendor/vue.esm-browser.prod.js';
import { api, ui, withBusy } from '../api.js';
import { store } from '../store.js';
import { fmtPrice, fmtPctRaw, toneClass, scoreClass, fmtChg } from '../format.js';

export const WatchlistView = defineComponent({
  name: 'WatchlistView',
  setup(_props, { emit }) {
    const rows = ref([]);
    const loading = ref(false);

    async function load() {
      const codes = [...store.watchlist].slice(0, 60);
      if (!codes.length) { rows.value = []; return; }
      loading.value = true;
      try {
        const arr = await Promise.all(codes.map(async (code) => {
          try {
            const d = await api.stock(code);
            const m = d.metrics || {};
            return {
              code,
              name: d.zhName || d.name || null,
              price: m.price,
              change: m.change,
              changePercent: m.changePercent,
              dividendYieldTTM: m.dividendYieldTTM,
              vol1y: m.vol1y,
              score: d.score?.total ?? null,
              grade: d.grade ?? null,
              ok: true,
            };
          } catch {
            return { code, name: null, ok: false };
          }
        }));
        rows.value = arr;
      } catch (e) {
        ui.error(`自選股載入失敗：${e.message}`);
      } finally {
        loading.value = false;
      }
    }

    async function remove(code) {
      await withBusy(async () => {
        store.watchlist = (await api.watchlistRemove(code)).codes;
        await load();
      }, '移除失敗');
    }

    onMounted(load);
    watch(() => store.watchlist.length, load);

    const open = (code) => emit('open', code);

    return { rows, loading, open, remove, fmtPrice, fmtPctRaw, toneClass, scoreClass, fmtChg };
  },
  template: `
  <div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">⭐ 自選股（我最關注）</div>
        <div class="card-sub">{{ rows.length }} 檔 · 與每日推介／選股器／個股頁的 ☆ 按鈕互通</div>
      </div>
      <div class="card-body tight">
        <div v-if="loading && !rows.length" class="empty">載入中…</div>
        <table class="data" v-else-if="rows.length">
          <thead>
            <tr>
              <th style="width:34px">#</th>
              <th>代號</th>
              <th>名稱</th>
              <th style="width:88px">現價</th>
              <th style="width:88px">漲跌幅</th>
              <th style="width:88px">殖利率</th>
              <th style="width:84px">年化波動</th>
              <th style="width:104px">平台評分</th>
              <th style="width:60px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="r.code" @click="open(r.code)" style="cursor:pointer">
              <td class="mono muted">{{ i + 1 }}</td>
              <td class="mono">{{ r.code }}</td>
              <td class="txt">{{ r.name || '查無名稱' }}</td>
              <td>{{ r.price == null ? '—' : fmtPrice(r.price) }}</td>
              <td :class="toneClass(r.changePercent)">{{ r.changePercent == null ? '—' : fmtChg(r.change) + ' (' + (r.changePercent > 0 ? '+' : '') + r.changePercent.toFixed(2) + '%)' }}</td>
              <td :class="r.dividendYieldTTM != null ? 'up' : ''">{{ r.dividendYieldTTM == null ? '—' : (r.dividendYieldTTM * 100).toFixed(1) + '%' }}</td>
              <td>{{ r.vol1y == null ? '—' : (r.vol1y * 100).toFixed(0) + '%' }}</td>
              <td><span class="score-pill" :class="scoreClass(r.score)">{{ r.score == null ? '—' : r.score }}</span></td>
              <td><button class="btn sm ghost" @click.stop="remove(r.code)">移除</button></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">
          自選清單目前是空的。在「每日推介」「選股器」或「個股詳情」點擊 <b>☆</b> 即可加入關注。
        </div>
      </div>
    </div>
  </div>
  `,
});

export default WatchlistView;
