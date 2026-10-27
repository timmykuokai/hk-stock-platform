/**
 * techChart.js — 技術指標圖表（零外部依賴，純 SVG）
 *   BollingerChart : 布林帶（中軌 MA20 ± 2σ，含價格線與帶狀區）
 *   MaChart        : 移動平均線（MA5/10/20/60 疊加股價）
 *   VolumeChart    : 成交量（紅漲綠跌，港股慣例）
 *   MacdChart      : MACD（DIF/DEA 線＋柱狀圖）
 *   RsiChart       : RSI(14) 與 70/30 超買超賣帶
 * 所有序列皆由傳入的 bars（OHLCV）即時計算，後端無需改動。
 */
import { defineComponent, computed, ref } from '../../vendor/vue.esm-browser.prod.js';
import { fmtPrice } from '../format.js';
import { getChartInfo } from './chartInfo.js';

const UP = '#d9333f';     // 漲：紅
const DOWN = '#0f9960';   // 跌：綠

/* --------------------------- 指標計算工具 --------------------------- */

function sma(values, p) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= p) sum -= values[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

function ema(values, p) {
  const out = new Array(values.length);
  const k = 2 / (p + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    prev = prev == null ? values[i] : values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function stddev(closes, mid, p) {
  const out = new Array(closes.length).fill(null);
  for (let i = p - 1; i < closes.length; i++) {
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) { const d = closes[j] - mid[i]; s += d * d; }
    out[i] = Math.sqrt(s / p);
  }
  return out;
}

function rsi(closes, p = 14) {
  const out = new Array(closes.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const gain = Math.max(0, ch), loss = Math.max(0, -ch);
    if (i <= p) {
      g += gain; l += loss;
      if (i === p) { g /= p; l /= p; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    } else {
      g = (g * (p - 1) + gain) / p; l = (l * (p - 1) + loss) / p;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return out;
}

/* --------------------------- 座標與路徑工具 --------------------------- */

function geom(dates, seriesValues, height, opts = {}) {
  // 響應式寬度：預設 900，可透過 opts.width 覆蓋（單位：px）
  const W = opts.width ?? 900;
  // 確保左邊距足夠容納標籤文字（最大約 44px for "10000"）
  const padL = Math.max(opts.padL ?? 48, 44);
  const padR = opts.padR ?? 12;
  const padT = opts.padT ?? 10;
  const padB = opts.padB ?? 24;
  const h = height - padT - padB;
  const w = W - padL - padR;
  const flat = seriesValues.flat().filter((v) => v != null && Number.isFinite(v));
  if (!flat.length) return null;
  let lo = opts.min != null ? opts.min : Math.min(...flat);
  let hi = opts.max != null ? opts.max : Math.max(...flat);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const n = dates.length;
  // xOf：0 ~ w 映射到 data index
  const xOf = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * w);
  // yOf：0 ~ h 映射到 value（y 軸反轉）
  const yOf = (v) => padT + ((hi - v) / (hi - lo)) * h;
  // 數值刻度（5 等分）
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    v: lo + (hi - lo) * (1 - t),
    y: padT + t * h
  }));
  // 底部日期標籤（均勻取樣）
  const xLabels = [];
  const step = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += step) {
    xLabels.push({
      x: xOf(i),
      t: (dates[i] || '').slice(2, 10)
    });
  }
  return { W, padL, padT, padR, padB, w, h, xOf, yOf, ticks, xLabels, H: height };
}

function linePath(arr, g) {
  let d = '', started = false;
  arr.forEach((v, i) => {
    if (v == null) { started = false; return; }
    const x = g.xOf(i).toFixed(1), y = g.yOf(v).toFixed(1);
    d += `${started ? 'L' : 'M'}${x},${y} `;
    started = true;
  });
  return d.trim();
}

function bandPath(up, lo, g) {
  let top = '', bot = '', started = false;
  up.forEach((v, i) => { if (v == null) return; top += `${started ? 'L' : 'M'}${g.xOf(i).toFixed(1)},${g.yOf(v).toFixed(1)} `; started = true; });
  for (let i = lo.length - 1; i >= 0; i--) { const v = lo[i]; if (v == null) continue; bot += `L${g.xOf(i).toFixed(1)},${g.yOf(v).toFixed(1)} `; }
  return (top + bot + 'Z').trim();
}

function histBars(arr, g) {
  const zero = g.yOf(0);
  const bw = Math.max(1, (g.w / Math.max(1, arr.length)) * 0.62);
  return arr.map((v, i) => {
    if (v == null) return null;
    const x = g.xOf(i) - bw / 2;
    const y = g.yOf(v);
    return { x, y: Math.min(y, zero), h: Math.abs(y - zero), bw, color: v >= 0 ? UP : DOWN };
  }).filter(Boolean);
}

/* ------------------------------ 布林帶 ------------------------------ */

export const BollingerChart = defineComponent({
  name: 'BollingerChart',
  props: { bars: { type: Array, default: () => [] }, height: { type: Number, default: 300 } },
  setup(props) {
    const box = computed(() => {
      const bars = props.bars;
      if (bars.length < 20) return null;
      const c = bars.map((b) => b.close);
      const d = bars.map((b) => b.date);
      const mid = sma(c, 20);
      const sd = stddev(c, mid, 20);
      const upper = mid.map((m, i) => (m == null ? null : m + 2 * sd[i]));
      const lower = mid.map((m, i) => (m == null ? null : m - 2 * sd[i]));
      const g = geom(d, [c, upper, lower, mid], props.height);
      if (!g) return null;
      return {
        ...g,
        band: bandPath(upper, lower, g),
        priceP: linePath(c, g),
        upperP: linePath(upper, g),
        midP: linePath(mid, g),
        lowerP: linePath(lower, g),
      };
    });
    const showInfo = ref(false);
    const info = getChartInfo('bollinger');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ fmtPrice(t.v) }}</text>
        <path v-if="box.band" :d="box.band" fill="#1f5eff" fill-opacity="0.08" stroke="none" />
        <path :d="box.lowerP" fill="none" stroke="#9333ea" stroke-width="1.3" />
        <path :d="box.upperP" fill="none" stroke="#9333ea" stroke-width="1.3" />
        <path :d="box.midP" fill="none" stroke="#f59e0b" stroke-width="1.3" stroke-dasharray="4 3" />
        <path :d="box.priceP" fill="none" stroke="#1f2937" stroke-width="1.6" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px">
      <span><i style="background:#1f2937"></i>收盤價</span>
      <span><i style="background:#f59e0b"></i>中軌 MA20</span>
      <span><i style="background:#9333ea"></i>上下軌 ±2σ</span>
      <span class="muted">價格觸及上軌偏熱、下軌偏冷</span>
    </div>
    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ 移動平均 ------------------------------ */

export const MaChart = defineComponent({
  name: 'MaChart',
  props: { bars: { type: Array, default: () => [] }, height: { type: Number, default: 300 } },
  setup(props) {
    const periods = [5, 10, 20, 60];
    const colors = ['#f59e0b', '#1f5eff', '#9333ea', '#0891b2'];
    const box = computed(() => {
      const bars = props.bars;
      if (bars.length < 60) return null;
      const c = bars.map((b) => b.close);
      const d = bars.map((b) => b.date);
      const mas = periods.map((p) => sma(c, p));
      const g = geom(d, [c, ...mas], props.height);
      if (!g) return null;
      return {
        ...g,
        priceP: linePath(c, g),
        maPaths: mas.map((m) => linePath(m, g)),
      };
    });
    const showInfo = ref(false);
    const info = getChartInfo('ma');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ fmtPrice(t.v) }}</text>
        <path v-for="(p,i) in box.maPaths" :key="'m'+i" :d="p" fill="none" :stroke="colors[i]" stroke-width="1.4" />
        <path :d="box.priceP" fill="none" stroke="#1f2937" stroke-width="1.6" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px">
      <span><i style="background:#1f2937"></i>收盤價</span>
      <span v-for="(p,i) in periods" :key="p"><i :style="{background:colors[i]}"></i>MA{{p}}</span>
      <span class="muted">多條均線多頭排列＝偏強</span>
    </div>
  `,
});

/* ------------------------------ 成交量 ------------------------------ */

export const VolumeChart = defineComponent({
  name: 'VolumeChart',
  props: { bars: { type: Array, default: () => [] }, height: { type: Number, default: 260 } },
  setup(props) {
    const box = computed(() => {
      const bars = props.bars;
      if (!bars.length) return null;
      const d = bars.map((b) => b.date);
      const v = bars.map((b) => b.volume);
      const max = Math.max(...v);
      const g = geom(d, [v], props.height, { padL: 56 });
      if (!g) return null;
      const cw = Math.max(1, (g.w / bars.length) * 0.62);
      const barsRect = bars.map((b, i) => {
        const x = g.xOf(i) - cw / 2;
        const y = g.yOf(b.volume);
        const zero = g.yOf(0);
        return { x, y: Math.min(y, zero), h: Math.max(1, Math.abs(y - zero)), bw: cw, color: b.close >= b.open ? UP : DOWN };
      });
      return { ...g, barsRect, max };
    });
    const showInfo = ref(false);
    const info = getChartInfo('volume');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ fmtCompact(t.v) }}</text>
        <rect v-for="(r,i) in box.barsRect" :key="i" :x="r.x" :y="r.y" :width="r.bw" :height="r.h" :fill="r.color" fill-opacity="0.7" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px">
      <span><i :style="{background:UP}"></i>上漲日成交量</span>
      <span><i :style="{background:DOWN}"></i>下跌日成交量</span>
      <span class="muted">放量突破／縮量盤整為常見訊號</span>
    </div>
    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ MACD ------------------------------ */

export const MacdChart = defineComponent({
  name: 'MacdChart',
  props: { bars: { type: Array, default: () => [] }, height: { type: Number, default: 300 } },
  setup(props) {
    const box = computed(() => {
      const bars = props.bars;
      if (bars.length < 35) return null;
      const c = bars.map((b) => b.close);
      const d = bars.map((b) => b.date);
      const e12 = ema(c, 12), e26 = ema(c, 26);
      const dif = c.map((_, i) => e12[i] - e26[i]);
      const dea = ema(dif, 9);
      const hist = dif.map((v, i) => v - dea[i]);
      const g = geom(d, [dif, dea, hist], props.height, { min: 0, padL: 48 });
      if (!g) return null;
      return {
        ...g,
        bars: histBars(hist, g),
        difP: linePath(dif, g),
        deaP: linePath(dea, g),
      };
    });
    const showInfo = ref(false);
    const info = getChartInfo('macd');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ fmt2(t.v) }}</text>
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(0)" :y2="box.yOf(0)" stroke="#cdd3dc" stroke-width="1" />
        <rect v-for="(r,i) in box.bars" :key="'b'+i" :x="r.x" :y="r.y" :width="r.bw" :height="r.h" :fill="r.color" />
        <path :d="box.difP" fill="none" stroke="#1f5eff" stroke-width="1.5" />
        <path :d="box.deaP" fill="none" stroke="#f59e0b" stroke-width="1.5" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px">
      <span><i style="background:#1f5eff"></i>DIF 快線</span>
      <span><i style="background:#f59e0b"></i>DEA 慢線</span>
      <span><i style="background:#d9333f"></i>柱狀體（紅正綠負）</span>
      <span class="muted">DIF 上穿 DEA 為黃金交叉</span>
    </div>
  `,
});

/* ------------------------------ RSI ------------------------------ */

export const RsiChart = defineComponent({
  name: 'RsiChart',
  props: { bars: { type: Array, default: () => [] }, height: { type: Number, default: 260 } },
  setup(props) {
    const box = computed(() => {
      const bars = props.bars;
      if (bars.length < 15) return null;
      const c = bars.map((b) => b.close);
      const d = bars.map((b) => b.date);
      const r = rsi(c, 14);
      const g = geom(d, [r], props.height, { min: 0, max: 100, padL: 40 });
      if (!g) return null;
      return { ...g, rsiP: linePath(r, g) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('rsi');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(0) }}</text>
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(70)" :y2="box.yOf(70)" stroke="#d9333f" stroke-width="1" stroke-dasharray="5 4" opacity="0.7" />
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(30)" :y2="box.yOf(30)" stroke="#0f9960" stroke-width="1" stroke-dasharray="5 4" opacity="0.7" />
        <text :x="box.padL+4" :y="box.yOf(70)-4" font-size="10" fill="#d9333f">超買 70</text>
        <text :x="box.padL+4" :y="box.yOf(30)+12" font-size="10" fill="#0f9960">超賣 30</text>
        <path :d="box.rsiP" fill="none" stroke="#7c3aed" stroke-width="1.6" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px">
      <span><i style="background:#7c3aed"></i>RSI(14)</span>
      <span class="muted">超過 70 偏熱、低於 30 偏冷，背離常為轉折先兆</span>
    </div>
  `,
});

/* ------------------------------ KD 隨機指標 ------------------------------ */

export const KdChart = defineComponent({
  name: 'KdChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const box = computed(() => {
      const s = props.series || {};
      const d = s.dates || [];
      const k = s.slowK || [];
      const dd = s.slowD || [];
      if (d.length < 5 || (!k.length && !dd.length)) return null;
      const g = geom(d, [k, dd], props.height, { min: 0, max: 100, padL: 40 });
      if (!g) return null;
      return { ...g, kP: linePath(k, g), dP: linePath(dd, g) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('kd');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(0) }}</text>
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(80)" :y2="box.yOf(80)" stroke="#d9333f" stroke-dasharray="5 4" opacity="0.7" />
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(20)" :y2="box.yOf(20)" stroke="#0f9960" stroke-dasharray="5 4" opacity="0.7" />
        <path :d="box.dP" fill="none" stroke="#f59e0b" stroke-width="1.5" />
        <path :d="box.kP" fill="none" stroke="#1f5eff" stroke-width="1.5" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#1f5eff"></i>K</span><span><i style="background:#f59e0b"></i>D</span><span class="muted">80 超買／20 超賣，低位黃金交叉偏多</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ OBV 能量潮 ------------------------------ */

export const ObvChart = defineComponent({
  name: 'ObvChart',
  props: {
    series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null },
    divergences: { type: Array, default: () => [] }, height: { type: Number, default: 260 },
  },
  setup(props) {
        const box = computed(() => {
      const s = props.series || {};
      const d = s.dates || [];
      const v = s.obv || [];
      const ma = s.obvMa20 || [];
      if (d.length < 5 || !v.length) return null;
      const g = geom(d, [v, ma], props.height, { padL: 56 });
      if (!g) return null;
      const markers = (props.divergences || []).map((div) => {
        const i1 = d.indexOf(div.date1);
        if (i1 < 0 || v[i1] == null) return null;
        const i0 = d.indexOf(div.date0);
        return {
          type: div.type,
          color: div.type === 'bearish' ? '#d9333f' : '#0f9960',
          x1: g.xOf(i1), y1: g.yOf(v[i1]),
          x0: i0 >= 0 && v[i0] != null ? g.xOf(i0) : null,
          y0: i0 >= 0 && v[i0] != null ? g.yOf(v[i0]) : null,
          label: div.type === 'bearish' ? '背離↓' : '背離↑',
        };
      }).filter(Boolean);
      return { ...g, vP: linePath(v, g), maP: linePath(ma, g), markers };
    });
    const showInfo = ref(false);
    const info = getChartInfo('obv');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(0) }}</text>
        <path :d="box.vP" fill="none" stroke="#1f5eff" stroke-width="1.5" />
        <path :d="box.maP" fill="none" stroke="#f59e0b" stroke-width="1.4" stroke-dasharray="4 3" />
        <g v-for="(m,i) in box.markers" :key="'m'+i">
          <line v-if="m.x0 != null" :x1="m.x0" :y1="m.y0" :x2="m.x1" :y2="m.y1" :stroke="m.color" stroke-width="1" stroke-dasharray="3 3" opacity="0.7" />
          <circle :cx="m.x1" :cy="m.y1" r="4.5" :fill="m.color" />
          <text :x="m.x1" :y="m.y1 - 8" text-anchor="middle" font-size="10" :fill="m.color">{{ m.label }}</text>
        </g>
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#1f5eff"></i>OBV</span><span><i style="background:#f59e0b"></i>20 日均線</span><span><i style="background:#d9333f"></i>量退背離</span><span><i style="background:#0f9960"></i>底背離</span><span class="muted">價創高而 OBV 不創高＝量能撤退出貨</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ MFI 資金流向 ------------------------------ */

export const MfiChart = defineComponent({
  name: 'MfiChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const box = computed(() => {
      const s = props.series || {};
      const d = s.dates || [];
      const v = s.mfi || [];
      if (d.length < 5 || !v.length) return null;
      const g = geom(d, [v], props.height, { min: 0, max: 100, padL: 40 });
      if (!g) return null;
      return { ...g, vP: linePath(v, g) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('mfi');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(0) }}</text>
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(80)" :y2="box.yOf(80)" stroke="#d9333f" stroke-dasharray="5 4" opacity="0.7" />
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(20)" :y2="box.yOf(20)" stroke="#0f9960" stroke-dasharray="5 4" opacity="0.7" />
        <path :d="box.vP" fill="none" stroke="#7c3aed" stroke-width="1.6" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#7c3aed"></i>MFI(14)</span><span class="muted">80 超買／20 超賣，資金流向過熱或枯竭</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ ADX 趨勢強度 ------------------------------ */

export const AdxChart = defineComponent({
  name: 'AdxChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const box = computed(() => {
      const s = props.series || {};
      const d = s.dates || [];
      const v = s.adx || [];
      if (d.length < 5 || !v.length) return null;
      const g = geom(d, [v], props.height, { padL: 40 });
      if (!g) return null;
      return { ...g, vP: linePath(v, g), refY: g.yOf(25) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('adx');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(0) }}</text>
        <line :x1="box.padL" :x2="box.W-12" :y1="box.refY" :y2="box.refY" stroke="#d97706" stroke-dasharray="5 4" opacity="0.7" />
        <path :d="box.vP" fill="none" stroke="#1f5eff" stroke-width="1.6" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#1f5eff"></i>ADX(14)</span><span class="muted">＞25 趨勢明確，＜20 盤整（只看強度，不判多空）</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ CCI 順勢指標 ------------------------------ */

export const CciChart = defineComponent({
  name: 'CciChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const box = computed(() => {
      const s = props.series || {};
      const d = s.dates || [];
      const v = s.cci || [];
      if (d.length < 5 || !v.length) return null;
      const g = geom(d, [v], props.height, { padL: 48 });
      if (!g) return null;
      return { ...g, vP: linePath(v, g), upY: g.yOf(100), dnY: g.yOf(-100) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('cci');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(0) }}</text>
        <line :x1="box.padL" :x2="box.W-12" :y1="box.upY" :y2="box.upY" stroke="#d9333f" stroke-dasharray="5 4" opacity="0.6" />
        <line :x1="box.padL" :x2="box.W-12" :y1="box.dnY" :y2="box.dnY" stroke="#0f9960" stroke-dasharray="5 4" opacity="0.6" />
        <path :d="box.vP" fill="none" stroke="#9333ea" stroke-width="1.6" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#9333ea"></i>CCI(14)</span><span class="muted">＋100 超買／－100 超賣，突破常為趨勢啟動</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ BIAS 乖離率 ------------------------------ */

export const BiasChart = defineComponent({
  name: 'BiasChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const box = computed(() => {
      const s = props.series || {};
      const d = s.dates || [];
      const b6 = s.bias6 || [], b12 = s.bias12 || [], b24 = s.bias24 || [];
      if (d.length < 5 || (!b6.length && !b12.length && !b24.length)) return null;
      const g = geom(d, [b6, b12, b24], props.height, { padL: 48 });
      if (!g) return null;
      return { ...g, p6: linePath(b6, g), p12: linePath(b12, g), p24: linePath(b24, g) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('bias');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(0) }}</text>
        <line :x1="box.padL" :x2="box.W-12" :y1="box.yOf(0)" :y2="box.yOf(0)" stroke="#cdd3dc" stroke-width="1" />
        <path :d="box.p6" fill="none" stroke="#f59e0b" stroke-width="1.4" />
        <path :d="box.p12" fill="none" stroke="#1f5eff" stroke-width="1.4" />
        <path :d="box.p24" fill="none" stroke="#9333ea" stroke-width="1.4" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#f59e0b"></i>BIAS(6)</span><span><i style="background:#1f5eff"></i>BIAS(12)</span><span><i style="background:#9333ea"></i>BIAS(24)</span><span class="muted">正乖離過大易回檔，負乖離過大易反彈</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ 回撤水下曲線 ------------------------------ */

export const DrawdownChart = defineComponent({
  name: 'DrawdownChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const box = computed(() => {
      const dd = (props.risk && props.risk.drawdown) || { dates: [], values: [] };
      const d = dd.dates || [];
      const v = dd.values || [];
      if (d.length < 2 || !v.length) return null;
      const g = geom(d, [v], props.height, { min: -1, max: 0, padL: 44 });
      if (!g) return null;
      let area = 'M' + g.padL.toFixed(1) + ',' + g.yOf(0).toFixed(1) + ' ';
      v.forEach((val, i) => { area += 'L' + g.xOf(i).toFixed(1) + ',' + g.yOf(val == null ? 0 : val).toFixed(1) + ' '; });
      area += 'L' + g.xOf(v.length - 1).toFixed(1) + ',' + g.yOf(0).toFixed(1) + ' Z';
      return { ...g, area, lineP: linePath(v, g) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('drawdown');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ (t.v * 100).toFixed(0) }}%</text>
        <path :d="box.area" fill="#d9333f" fill-opacity="0.15" stroke="none" />
        <path :d="box.lineP" fill="none" stroke="#d9333f" stroke-width="1.5" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#d9333f"></i>回撤（水下曲線）</span><span class="muted">0% 為歷史高點，向下為最大回撤，越深風險越大</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ ATR 平均真實波幅 ------------------------------ */

export const AtrChart = defineComponent({
  name: 'AtrChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const box = computed(() => {
      const s = props.series || {};
      const d = s.dates || [];
      const atr = s.atr14 || [];
      if (d.length < 5 || !atr.length) return null;
      const close = s.close || [];
      const g = geom(d, [atr], props.height, { min: 0, padL: 52 });
      if (!g) return null;
      let lastAtr = null, i0 = -1;
      for (let i = atr.length - 1; i >= 0; i--) { if (atr[i] != null) { lastAtr = atr[i]; i0 = i; break; } }
      const lastClose = i0 >= 0 ? (close[i0] ?? null) : null;
      const pct = lastAtr != null && lastClose ? (lastAtr / lastClose) * 100 : null;
      return { ...g, atrP: linePath(atr, g), lastAtr, pct };
    });
    const showInfo = ref(false);
    const info = getChartInfo('atr');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(2) }}</text>
        <path :d="box.atrP" fill="none" stroke="#0ea5e9" stroke-width="1.6" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
        <text :x="box.padL+4" :y="box.padT+14" font-size="11" fill="#0ea5e9">ATR(14) = {{ box.lastAtr != null ? box.lastAtr.toFixed(2) : '—' }}<tspan v-if="box.pct != null">（{{ box.pct.toFixed(1) }}%）</tspan></text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#0ea5e9"></i>ATR 平均真實波幅</span><span class="muted">波動越大數值越高，常作停損與部位規模參考</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

/* ------------------------------ 唐奇安通道（海龜通道） ------------------------------ */

export const DonchianChart = defineComponent({
  name: 'DonchianChart',
  props: { series: { type: Object, default: () => ({}) }, bars: { type: Array, default: () => [] }, risk: { type: Object, default: null }, height: { type: Number, default: 260 } },
  setup(props) {
        const P = 20;
    const box = computed(() => {
      const bars = props.bars;
      if (!bars || bars.length < P + 1) return null;
      const d = bars.map((b) => b.date);
      const hi = bars.map((b) => b.high);
      const lo = bars.map((b) => b.low);
      const close = bars.map((b) => b.close);
      const up = new Array(bars.length).fill(null);
      const dn = new Array(bars.length).fill(null);
      for (let i = P - 1; i < bars.length; i++) {
        let h = -Infinity, l = Infinity;
        for (let j = i - P + 1; j <= i; j++) { if (hi[j] > h) h = hi[j]; if (lo[j] < l) l = lo[j]; }
        up[i] = h; dn[i] = l;
      }
      const g = geom(d, [close, up, dn], props.height, { padL: 52 });
      if (!g) return null;
      return { ...g, upP: linePath(up, g), dnP: linePath(dn, g), closeP: linePath(close, g), band: bandPath(up, dn, g) };
    });
    const showInfo = ref(false);
    const info = getChartInfo('donchian');
    
    const signalClass = (s) => {
      if (!s) return '';
      if (s.includes('超买') || s.includes('强势') || s.includes('买入') || s.includes('向上') || s.includes('偏强')) return 'up';
      if (s.includes('超卖') || s.includes('弱势') || s.includes('卖出') || s.includes('向下') || s.includes('偏弱')) return 'down';
      if (s.includes('警示') || s.includes('预警') || s.includes('减弱') || s.includes('衰竭')) return 'warn';
      return '';
    };
    return { box, info, signalClass, fmtPrice };
    
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g>
        <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="box.W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
        <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ t.v.toFixed(2) }}</text>
        <path :d="box.band" fill="#1f5eff" fill-opacity="0.08" stroke="none" />
        <path :d="box.upP" fill="none" stroke="#d9333f" stroke-width="1.2" stroke-dasharray="4 3" />
        <path :d="box.dnP" fill="none" stroke="#0f9960" stroke-width="1.2" stroke-dasharray="4 3" />
        <path :d="box.closeP" fill="none" stroke="#1f5eff" stroke-width="1.4" />
        <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
      </g>
    </svg>
    <div class="legend" style="margin-top:6px"><span><i style="background:#1f5eff"></i>收盤</span><span><i style="background:#d9333f"></i>20 日高</span><span><i style="background:#0f9960"></i>20 日低</span><span class="muted">突破上軌偏強、跌破下軌偏弱（海龜通道）</span></div>

    <!-- 圖表解讀面板 -->
    <details v-if="info" :open="false" class="chart-info-panel">
      <summary class="chart-info-summary">📊 圖表解讀說明</summary>
      <div class="chart-info-content">
        <div class="chart-info-desc">{{ info.desc }}</div>
        <div class="chart-info-section">
          <strong>圖例：</strong>
          <ul class="chart-legend-list">
            <li v-for="(item, i) in info.legend" :key="i">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.label }}</span>
              <span class="muted">— {{ item.desc }}</span>
            </li>
          </ul>
        </div>
        <div class="chart-info-section">
          <strong>數值範圍解讀：</strong>
          <table class="data interpretation-table">
            <thead><tr><th>數值範圍/狀態</th><th>信號</th><th>建議操作</th></tr></thead>
            <tbody>
              <tr v-for="(item, i) in info.interpretation" :key="i">
                <td>{{ item.range }}</td>
                <td><span :class="signalClass(item.signal)">{{ item.signal }}</span></td>
                <td>{{ item.action }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="chart-info-note"><strong>使用建議：</strong>{{ info.usage }}</div>
      </div>
    </details>
  `,
});

export default { BollingerChart, MaChart, VolumeChart, MacdChart, RsiChart, KdChart, ObvChart, MfiChart, AdxChart, CciChart, BiasChart, DrawdownChart, AtrChart, DonchianChart };
