/**
 * charts.js — 輕量圖表元件（零外部依賴）
 *  CandleChart  : Canvas K 線 + 成交量 + 均線 + 十字游標（仿 AAStocks 詳細圖表）
 *  LineChart    : SVG 多序列折線（淨值曲線）
 *  ScatterChart : SVG 風險報酬散點
 *  HistChart    : SVG 直方圖（評分分佈）
 *  RadarChart   : SVG 雷達圖（評分維度）
 *  Sparkline    : SVG 迷你走勢
 */
import { defineComponent, ref, onMounted, onBeforeUnmount, watch, computed, nextTick } from '../../vendor/vue.esm-browser.prod.js';
import { fmtPrice, fmtCompact, fmtPct, fmtDate } from '../format.js';

const UP = '#d9333f';     // 漲：紅
const DOWN = '#0f9960';   // 跌：綠

/* --------------------------------- K 線圖 --------------------------------- */

export const CandleChart = defineComponent({
  name: 'CandleChart',
  props: {
    bars: { type: Array, default: () => [] },
    height: { type: Number, default: 380 },
    maPeriods: { type: Array, default: () => [5, 20, 60] },
    showVolume: { type: Boolean, default: true },
  },
  setup(props) {
    const host = ref(null);
    const canvas = ref(null);
    const tip = ref({ show: false, x: 0, y: 0, text: '' });
    let ctx = null;
    let geom = null;

    const ma = (period) => {
      const out = [];
      let sum = 0;
      for (let i = 0; i < props.bars.length; i++) {
        sum += props.bars[i].close;
        if (i >= period) sum -= props.bars[i - period].close;
        out.push(i >= period - 1 ? sum / period : null);
      }
      return out;
    };

    const draw = () => {
      const el = canvas.value;
      const wrap = host.value;
      if (!el || !wrap) return;
      const bars = props.bars;
      if (!bars.length) return;

      const dpr = window.devicePixelRatio || 1;
      const W = wrap.clientWidth || 800;
      const H = props.height;
      el.width = W * dpr;
      el.height = H * dpr;
      el.style.width = `${W}px`;
      el.style.height = `${H}px`;
      ctx = el.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const padL = 8;
      const padR = 62;
      const padT = 10;
      const padB = 22;
      const volH = props.showVolume ? Math.round((H - padT - padB) * 0.24) : 0;
      const priceH = H - padT - padB - volH;
      const plotW = W - padL - padR;
      const n = bars.length;
      const cw = Math.max(1.2, plotW / n);
      const bw = Math.max(1, Math.floor(cw * 0.68));

      let hi = -Infinity;
      let lo = Infinity;
      let maxVol = 0;
      for (const b of bars) {
        if (b.high > hi) hi = b.high;
        if (b.low < lo) lo = b.low;
        if (b.volume > maxVol) maxVol = b.volume;
      }
      const mas = props.maPeriods.map((p) => ({ p, data: ma(p) }));
      for (const m of mas) for (const v of m.data) if (v != null) { if (v > hi) hi = v; if (v < lo) lo = v; }
      const pad = (hi - lo) * 0.06 || hi * 0.02;
      hi += pad;
      lo -= pad;

      const xOf = (i) => padL + i * cw + cw / 2;
      const yOf = (v) => padT + ((hi - v) / (hi - lo)) * priceH;
      const yVol = (v) => padT + priceH + 6 + (1 - v / (maxVol || 1)) * (volH - 8);

      // 格線與座標標籤
      ctx.font = '11px -apple-system, "PingFang TC", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#eceef2';
      ctx.fillStyle = '#8b95a3';
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const v = lo + ((hi - lo) * g) / 4;
        const y = yOf(v);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
        ctx.fillText(v.toFixed(v > 100 ? 0 : 2), padL + plotW + 6, y);
      }
      // 日期標籤
      ctx.textAlign = 'center';
      const step = Math.max(1, Math.floor(n / 7));
      for (let i = 0; i < n; i += step) {
        ctx.fillText(bars[i].date.slice(2, 10).replace(/-/g, '/'), xOf(i), H - padB + 10);
      }
      ctx.textAlign = 'left';

      // 成交量
      if (props.showVolume) {
        for (let i = 0; i < n; i++) {
          const b = bars[i];
          const up = b.close >= b.open;
          ctx.fillStyle = up ? 'rgba(217,51,63,.45)' : 'rgba(15,153,96,.45)';
          const y = yVol(b.volume);
          ctx.fillRect(xOf(i) - bw / 2, y, bw, Math.max(1, padT + priceH + 6 + (volH - 8) - y));
        }
      }

      // K 線
      for (let i = 0; i < n; i++) {
        const b = bars[i];
        const up = b.close >= b.open;
        const color = up ? UP : DOWN;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1;
        const x = xOf(i);
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, yOf(b.high));
        ctx.lineTo(Math.round(x) + 0.5, yOf(b.low));
        ctx.stroke();
        const y1 = yOf(Math.max(b.open, b.close));
        const y2 = yOf(Math.min(b.open, b.close));
        ctx.fillRect(Math.round(x - bw / 2), Math.round(y1), bw, Math.max(1, Math.round(y2 - y1)));
      }

      // 均線
      const maColors = ['#f59e0b', '#1f5eff', '#9333ea', '#0891b2'];
      mas.forEach((m, k) => {
        ctx.strokeStyle = maColors[k % maColors.length];
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i++) {
          const v = m.data[i];
          if (v == null) continue;
          const x = xOf(i);
          const y = yOf(v);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      geom = { padL, padT, plotW, priceH, cw, n, hi, lo, H, W, volH };
    };

    const onMove = (e) => {
      if (!geom) return;
      const rect = canvas.value.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const i = Math.round((x - geom.padL - geom.cw / 2) / geom.cw);
      const bar = props.bars[Math.max(0, Math.min(geom.n - 1, i))];
      if (!bar) return;
      tip.value = {
        show: true,
        x: Math.min(geom.W - 150, x + 12),
        y: Math.max(6, y - 10),
        text: `${bar.date}  開 ${fmtPrice(bar.open)} 高 ${fmtPrice(bar.high)} 低 ${fmtPrice(bar.low)} 收 ${fmtPrice(bar.close)}  量 ${fmtCompact(bar.volume, 1)}`,
      };
    };
    const onLeave = () => { tip.value.show = false; };

    onMounted(() => { nextTick(draw); window.addEventListener('resize', draw); });
    onBeforeUnmount(() => window.removeEventListener('resize', draw));
    watch(() => [props.bars, props.height], () => nextTick(draw));

    return { host, canvas, tip, onMove, onLeave };
  },
  template: `
    <div class="chart-wrap" ref="host">
      <canvas ref="canvas" class="canvas-host" @mousemove="onMove" @mouseleave="onLeave"></canvas>
      <div v-if="tip.show" class="tooltip-chart" :style="{ left: tip.x + 'px', top: tip.y + 'px' }">{{ tip.text }}</div>
    </div>
  `,
});

/* --------------------------------- 折線圖 --------------------------------- */

export const LineChart = defineComponent({
  name: 'LineChart',
  props: {
    series: { type: Array, default: () => [] }, // [{name,color,points:[{date,v}]}]
    height: { type: Number, default: 300 },
    yFmt: { type: Function, default: (v) => v.toFixed(0) },
  },
  setup(props) {
    const W = 900;
    const H = computed(() => props.height);
    const box = computed(() => {
      const all = props.series.flatMap((s) => s.points.map((p) => p.v)).filter(Number.isFinite);
      if (!all.length) return null;
      const min = Math.min(...all);
      const max = Math.max(...all);
      const pad = (max - min) * 0.08 || 1;
      const lo = min - pad;
      const hi = max + pad;
      const padL = 54;
      const padR = 12;
      const padT = 12;
      const padB = 26;
      const w = W - padL - padR;
      const h = H.value - padT - padB;
      const dates = props.series[0]?.points.map((p) => p.date) ?? [];
      const n = Math.max(dates.length, 1);
      const xOf = (i) => padL + (i / Math.max(1, n - 1)) * w;
      const yOf = (v) => padT + ((hi - v) / (hi - lo)) * h;
      const paths = props.series.map((s) => {
        const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
        return { name: s.name, color: s.color, d };
      });
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ v: lo + (hi - lo) * (1 - t), y: padT + t * h }));
      const xLabels = [];
      const step = Math.max(1, Math.floor(n / 6));
      for (let i = 0; i < n; i += step) xLabels.push({ x: xOf(i), t: dates[i]?.slice(2, 10) ?? '' });
      return { padL, padT, w, h, paths, ticks, xLabels, W, H: H.value, lo, hi };
    });
    return { box, W, yFmt: () => props.yFmt };
  },
  template: `
    <div>
      <svg v-if="box" :viewBox="'0 0 ' + W + ' ' + box.H" preserveAspectRatio="none" style="width:100%;height:auto;display:block">
        <g>
          <line v-for="(t,i) in box.ticks" :key="'t'+i" :x1="box.padL" :x2="W-12" :y1="t.y" :y2="t.y" stroke="#eceef2" />
          <text v-for="(t,i) in box.ticks" :key="'tl'+i" :x="box.padL-8" :y="t.y+4" text-anchor="end" font-size="11" fill="#8b95a3">{{ yFmt()(t.v) }}</text>
          <path v-for="(p,i) in box.paths" :key="'p'+i" :d="p.d" fill="none" :stroke="p.color" stroke-width="1.8" stroke-linejoin="round" />
          <text v-for="(x,i) in box.xLabels" :key="'x'+i" :x="x.x" :y="box.H-8" text-anchor="middle" font-size="11" fill="#8b95a3">{{ x.t }}</text>
        </g>
      </svg>
      <div class="legend" style="margin-top:6px">
        <span v-for="(s,i) in series" :key="'l'+i"><i :style="{ background: s.color }"></i>{{ s.name }}</span>
      </div>
    </div>
  `,
});

/* -------------------------------- 散點圖 --------------------------------- */

export const ScatterChart = defineComponent({
  name: 'ScatterChart',
  props: {
    points: { type: Array, default: () => [] }, // {x:vol, y:ret, r:marketCap, score, code, name}
    height: { type: Number, default: 320 },
  },
  setup(props) {
    const W = 620;
    const box = computed(() => {
      const pts = props.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!pts.length) return null;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const yMin = Math.min(...ys);
      const yMax = Math.max(...ys);
      const padL = 46;
      const padB = 30;
      const padT = 12;
      const padR = 14;
      const h = props.height - padT - padB;
      const w = W - padL - padR;
      const xOf = (v) => padL + ((v - xMin) / (xMax - xMin || 1)) * w;
      const yOf = (v) => padT + ((yMax - v) / (yMax - yMin || 1)) * h;
      const maxR = Math.max(...pts.map((p) => p.r || 0)) || 1;
      const dots = pts.map((p) => ({
        cx: xOf(p.x), cy: yOf(p.y),
        r: 2.5 + Math.sqrt((p.r || 0) / maxR) * 7,
        color: p.score >= 70 ? UP : p.score >= 50 ? '#f59e0b' : DOWN,
        code: p.code, name: p.name, score: p.score,
        tip: `${p.code} ${p.name || ''}｜波動 ${fmtPct(p.x, 0)}／報酬 ${fmtPct(p.y, 0)}／評分 ${p.score ?? '—'}`,
      }));
      return { w, h, padL, padT, dots, xTicks: [xMin, (xMin + xMax) / 2, xMax].map((v) => ({ v, x: xOf(v) })), yTicks: [yMax, (yMin + yMax) / 2, yMin].map((v) => ({ v, y: yOf(v) })), H: props.height, W };
    });
    return { box, W, fmtPct };
  },
  template: `
    <div>
      <svg v-if="box" :viewBox="'0 0 ' + W + ' ' + box.H" style="width:100%;height:auto;display:block">
        <line v-for="(t,i) in box.xTicks" :key="'gx'+i" :x1="t.x" :x2="t.x" :y1="box.padT" :y2="box.padT+box.h" stroke="#f0f2f5" />
        <line v-for="(t,i) in box.yTicks" :key="'gy'+i" :x1="box.padL" :x2="W-14" :y1="t.y" :y2="t.y" stroke="#f0f2f5" />
        <text v-for="(t,i) in box.xTicks" :key="'xl'+i" :x="t.x" :y="box.H-10" text-anchor="middle" font-size="10.5" fill="#8b95a3">{{ fmtPct(t.v,0) }}</text>
        <text v-for="(t,i) in box.yTicks" :key="'yl'+i" :x="box.padL-6" :y="t.y+4" text-anchor="end" font-size="10.5" fill="#8b95a3">{{ fmtPct(t.v,0) }}</text>
        <circle v-for="(d,i) in box.dots" :key="'d'+i" :cx="d.cx" :cy="d.cy" :r="d.r" :fill="d.color" fill-opacity="0.55" :stroke="d.color" stroke-width="0.8">
          <title>{{ d.tip }}</title>
        </circle>
        <text :x="W/2" :y="box.H-1" text-anchor="middle" font-size="10.5" fill="#8b95a3">年化波動度 →</text>
      </svg>
      <div class="legend"><span><i :style="{background:UP}"></i>評分 ≥70</span><span><i style="background:#f59e0b"></i>50–70</span><span><i :style="{background:DOWN}"></i>&lt;50</span><span class="muted">圓點大小＝市值</span></div>
    </div>
  `,
});

/* -------------------------------- 直方圖 --------------------------------- */

export const HistChart = defineComponent({
  name: 'HistChart',
  props: {
    values: { type: Array, default: () => [] },
    height: { type: Number, default: 200 },
    buckets: { type: Number, default: 10 },
    center: { type: Boolean, default: false }, // center=true → 以資料 min/max 自適應，紅漲綠跌
  },
  setup(props) {
    const W = 560;
    const box = computed(() => {
      const vals = props.values.filter((v) => v != null && Number.isFinite(v));
      if (!vals.length) return null;
      const n = props.buckets;
      let lo, hi;
      if (props.center) {
        lo = Math.min(...vals); hi = Math.max(...vals);
        if (hi - lo < 1e-9) hi = lo + 1;
      } else {
        lo = 0; hi = 100;
      }
      const span = hi - lo;
      const counts = new Array(n).fill(0);
      for (const v of vals) {
        const i = Math.min(n - 1, Math.max(0, Math.floor(((v - lo) / span) * n)));
        counts[i]++;
      }
      const max = Math.max(...counts) || 1;
      const padL = 30;
      const padB = 24;
      const padT = 10;
      const h = props.height - padT - padB;
      const w = W - padL - 10;
      const bw = w / n;
      const midOf = (i) => lo + ((i + 0.5) / n) * span;
      return {
        bars: counts.map((c, i) => {
          const m = midOf(i);
          return {
            x: padL + i * bw + 1.5,
            w: bw - 3,
            y: padT + h - (c / max) * h,
            h: Math.max(1, (c / max) * h),
            c,
            label: props.center ? (Math.abs(m) < 0.11 ? m.toFixed(2) : m.toFixed(1)) : `${i * (100 / n)}–${(i + 1) * (100 / n)}`,
            color: props.center ? (m >= 0 ? UP : DOWN) : '#1f5eff',
          };
        }),
        H: props.height, W, max, padL,
      };
    });
    return { box, W, UP, DOWN };
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <g v-for="(b,i) in box.bars" :key="i">
        <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2" :fill="b.color" fill-opacity="0.72" />
        <text :x="b.x + b.w/2" :y="b.y - 3" text-anchor="middle" font-size="10" fill="#5a6472">{{ b.c }}</text>
        <text :x="b.x + b.w/2" :y="box.H - 8" text-anchor="middle" font-size="9.5" fill="#8b95a3">{{ b.label }}</text>
      </g>
    </svg>
  `,
});

/* ----------------------------- 橫向條形圖 ----------------------------- */

export const HBarChart = defineComponent({
  name: 'HBarChart',
  props: {
    items: { type: Array, default: () => [] }, // [{label, value(0-100), color?}]
    height: { type: Number, default: null },
  },
  setup(props) {
    const rows = computed(() => (props.items || []).map((it) => ({
      label: it.label,
      value: Number(it.value) || 0,
      color: it.color || (it.value >= 70 ? UP : it.value >= 50 ? '#f59e0b' : DOWN),
    })));
    return { rows, UP, DOWN };
  },
  template: `
    <div style="display:flex; flex-direction:column; gap:6px">
      <div v-for="(r,i) in rows" :key="i" style="display:flex; align-items:center; gap:8px; font-size:12px">
        <div style="width:92px; flex:none; text-align:right; color:#5a6472; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" :title="r.label">{{ r.label }}</div>
        <div style="flex:1; height:10px; background:#eef1f5; border-radius:6px; overflow:hidden">
          <i :style="{ display:'block', height:'100%', width: Math.max(2, Math.min(100, r.value)) + '%', background: r.color }"></i>
        </div>
        <div style="width:30px; flex:none; text-align:right; color:#1f2937">{{ Math.round(r.value) }}</div>
      </div>
    </div>
  `,
});

/* -------------------------------- 雷達圖 --------------------------------- */

export const RadarChart = defineComponent({
  name: 'RadarChart',
  props: { items: { type: Array, default: () => [] }, size: { type: Number, default: 260 } }, // [{label, value(0-100)}]
  setup(props) {
    const box = computed(() => {
      const items = props.items.filter((x) => x.value != null);
      const k = items.length;
      if (k < 3) return null;
      const cx = props.size / 2;
      const cy = props.size / 2;
      const R = props.size / 2 - 34;
      const rings = [0.25, 0.5, 0.75, 1];
      const axis = items.map((it, i) => {
        const a = (Math.PI * 2 * i) / k - Math.PI / 2;
        return {
          x2: cx + Math.cos(a) * R,
          y2: cy + Math.sin(a) * R,
          lx: cx + Math.cos(a) * (R + 20),
          ly: cy + Math.sin(a) * (R + 14),
          label: it.label,
          value: it.value,
          anchor: Math.abs(Math.cos(a)) < 0.25 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end',
        };
      });
      const poly = items.map((it, i) => {
        const a = (Math.PI * 2 * i) / k - Math.PI / 2;
        const r = (Math.max(0, Math.min(100, it.value)) / 100) * R;
        return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
      }).join(' ');
      return { cx, cy, R, rings: rings.map((t) => t), axis, poly, size: props.size };
    });
    return { box };
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + box.size + ' ' + box.size" :style="{ width: box.size + 'px', height: box.size + 'px' }">
      <circle v-for="(r,i) in box.rings" :key="'r'+i" :cx="box.cx" :cy="box.cy" :r="box.R*r" fill="none" stroke="#eceef2" />
      <line v-for="(a,i) in box.axis" :key="'a'+i" :x1="box.cx" :y1="box.cy" :x2="a.x2" :y2="a.y2" stroke="#eceef2" />
      <polygon :points="box.poly" fill="#1f5eff" fill-opacity="0.22" stroke="#1f5eff" stroke-width="1.6" />
      <g v-for="(a,i) in box.axis" :key="'l'+i">
        <text :x="a.lx" :y="a.ly" :text-anchor="a.anchor" font-size="10.5" fill="#5a6472">{{ a.label }}</text>
      </g>
    </svg>
  `,
});

/* -------------------------------- 迷你線 --------------------------------- */

export const Sparkline = defineComponent({
  name: 'Sparkline',
  props: { values: { type: Array, default: () => [] }, width: { type: Number, default: 70 }, height: { type: Number, default: 20 }, color: { type: String, default: '#1f5eff' } },
  setup(props) {
    const path = computed(() => {
      const v = props.values.filter(Number.isFinite);
      if (v.length < 2) return '';
      const min = Math.min(...v);
      const max = Math.max(...v);
      const h = props.height - 2;
      return v.map((x, i) => {
        const px = (i / (v.length - 1)) * props.width;
        const py = 1 + h - ((x - min) / (max - min || 1)) * h;
        return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
      }).join(' ');
    });
    return { path };
  },
  template: `<svg :width="width" :height="height" style="vertical-align:middle"><path :d="path" fill="none" :stroke="color" stroke-width="1.3" /></svg>`,
});

/* ----------------------------- 月度漲跌柱狀圖 ----------------------------- */

export const MonthlyBarChart = defineComponent({
  name: 'MonthlyBarChart',
  props: { labels: { type: Array, default: () => [] }, returns: { type: Array, default: () => [] }, height: { type: Number, default: 220 } },
  setup(props) {
    const W = 900;
    const box = computed(() => {
      const rets = (props.returns || []).filter((v) => v != null && Number.isFinite(v));
      if (!rets.length) return null;
      const labels = props.labels || [];
      const n = rets.length;
      const max = Math.max(...rets.map((v) => Math.abs(v)), 0.01);
      const padL = 8, padR = 8, padT = 14, padB = 28;
      const h = props.height - padT - padB;
      const w = W - padL - padR;
      const bw = (w / n) * 0.7;
      const zero = padT + h / 2;
      const bars = rets.map((v, i) => {
        const x = padL + (i + 0.5) * (w / n) - bw / 2;
        const y = v >= 0 ? zero - (v / max) * (h / 2) : zero;
        const bh = Math.max(1, (Math.abs(v) / max) * (h / 2));
        return { x, y, w: bw, h: bh, color: v >= 0 ? UP : DOWN, label: labels[i] || '', v };
      });
      return { bars, H: props.height, W, padL, padR, zero };
    });
    return { box, W };
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <line :x1="box.padL" :x2="W-box.padR" :y1="box.zero" :y2="box.zero" stroke="#cdd3dc" stroke-width="1" />
      <g v-for="(b,i) in box.bars" :key="i">
        <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" :fill="b.color" fill-opacity="0.8" />
        <text v-if="i % 3 === 0" :x="b.x + b.w/2" :y="box.H - 10" text-anchor="middle" font-size="9.5" fill="#8b95a3">{{ b.label.slice(2) }}</text>
      </g>
    </svg>
  `,
});

/* ----------------------------- 賣出紀律階梯 ----------------------------- */

export const SellLadder = defineComponent({
  name: 'SellLadder',
  props: { ladder: { type: Object, default: null }, height: { type: Number, default: 220 } },
  setup(props) {
    const W = 680;
    const box = computed(() => {
      const L = props.ladder;
      if (!L || !L.steps || !L.steps.length) return null;
      const n = L.steps.length;
      const padT = 24, padB = 12;
      const h = props.height - padT - padB;
      const stepH = h / n;
      const railL = 92, railR = W - 16;
      const rungs = L.steps.map((s, i) => {
        const y = padT + stepH * (i + 0.5);
        const intact = !!s.intact;
        return {
          i, y,
          color: intact ? '#0f9960' : '#d9333f', // 站穩綠 / 跌破紅
          label: 'MA' + s.period,
          ma: s.ma != null ? s.ma.toFixed(2) : '—',
          diff: s.diffPct != null ? (s.diffPct > 0 ? '+' : '') + s.diffPct.toFixed(1) + '%' : '—',
          diffColor: s.diffPct == null ? '#8b95a3' : (s.diffPct >= 0 ? '#d9333f' : '#0f9960'),
          action: s.action,
          intact,
        };
      });
      return { W, H: props.height, railL, railR, padT, rungs, price: L.price != null ? L.price.toFixed(2) : '—' };
    });
    return { box, W };
  },
  template: `
    <svg v-if="box" :viewBox="'0 0 ' + W + ' ' + box.H" style="width:100%;height:auto;display:block">
      <line :x1="box.railL" :x2="box.railL" :y1="box.padT" :y2="box.H - 12" stroke="#cdd3dc" stroke-width="3" stroke-linecap="round" />
      <line :x1="box.railR" :x2="box.railR" :y1="box.padT" :y2="box.H - 12" stroke="#cdd3dc" stroke-width="3" stroke-linecap="round" />
      <text :x="box.railL - 8" :y="14" text-anchor="end" font-size="11" fill="#5a6472">現價</text>
      <text :x="box.railR" :y="14" text-anchor="end" font-size="13" font-weight="700" fill="#1f2937">{{ box.price }}</text>
      <g v-for="r in box.rungs" :key="r.i">
        <line :x1="box.railL" :x2="box.railR" :y1="r.y" :y2="r.y" :stroke="r.color" stroke-width="5" stroke-linecap="round" />
        <text :x="box.railL - 8" :y="r.y + 4" text-anchor="end" font-size="12" font-weight="600" :fill="r.color">{{ r.label }}</text>
        <text :x="(box.railL + box.railR) / 2 - 64" :y="r.y + 4" text-anchor="middle" font-size="11" fill="#5a6472">{{ r.ma }} <tspan :fill="r.diffColor">{{ r.diff }}</tspan></text>
        <text :x="box.railR - 6" :y="r.y + 4" text-anchor="end" font-size="11" :fill="r.intact ? '#0f9960' : '#d9333f'">{{ r.intact ? '站穩' : r.action }}</text>
      </g>
    </svg>
  `,
});

export default { CandleChart, LineChart, ScatterChart, HistChart, RadarChart, HBarChart, MonthlyBarChart, Sparkline, SellLadder };
