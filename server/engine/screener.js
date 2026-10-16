/**
 * screener.js — 多維度篩選引擎。
 * 條件格式：{ key, op, value, value2? }
 *   op: gt | gte | lt | lte | eq | between | top
 * 特殊：{ key:'tag', op:'in', value:[...] } 用於產業／標籤篩選
 */
import { scoreAll } from './score.js';

const OPS = {
  gt: (v, a) => v > a,
  gte: (v, a) => v >= a,
  lt: (v, a) => v < a,
  lte: (v, a) => v <= a,
  eq: (v, a) => Math.abs(v - a) < 1e-9,
  between: (v, a, b) => v >= a && v <= b,
};

/** 布林指標（aboveMa200）轉數值 */
const asNumber = (v) => (v === true ? 1 : v === false ? 0 : v);

/**
 * @param {Array} items 池快照項目（含 metrics）
 * @param {{filters?:Array, preset?:string, sortBy?:string, sortDir?:string, limit?:number}} opts
 */
export function screen(items, opts = {}) {
  const { filters = [], preset = 'balanced', sortBy = 'score', sortDir = 'desc', limit = 0, requireFundamentals = false } = opts;

  let out = items.slice();

  for (const f of filters) {
    if (!f || !f.key) continue;
    const { key, op, value, value2 } = f;
    if (op === 'in' && Array.isArray(value)) {
      out = out.filter((it) => value.includes(it.tag));
      continue;
    }
    const fn = OPS[op] || OPS.gte;
    const a = Number(value);
    const b = Number(value2);
    out = out.filter((it) => {
      const v = key === 'score' ? it.score?.total : asNumber(it.metrics?.[key]);
      if (v == null || !Number.isFinite(v)) return false; // 缺資料視為不符合（嚴格）
      if (op === 'between') return fn(v, a, b);
      if (!Number.isFinite(a)) return false;
      return fn(v, a);
    });
  }

  if (requireFundamentals) out = out.filter((it) => it.metrics?.pe != null || it.metrics?.marketCap != null);

  const scored = scoreAll(out, preset);

  scored.sort((x, y) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const vx = sortBy === 'score' ? x.score?.total : asNumber(x.metrics?.[sortBy]);
    const vy = sortBy === 'score' ? y.score?.total : asNumber(y.metrics?.[sortBy]);
    if (vx == null && vy == null) return 0;
    if (vx == null) return 1;
    if (vy == null) return -1;
    return (vx - vy) * dir;
  });

  const limited = limit > 0 ? scored.slice(0, limit) : scored;
  return {
    count: limited.length,
    totalBeforeFilter: items.length,
    preset,
    sortBy,
    sortDir,
    items: limited,
  };
}

/** 預設策略模板（一鍵套用） */
export const TEMPLATES = [
  {
    id: 'high-yield-stable',
    label: '高息穩健（收息族）',
    desc: '日均成交額 > 2,000 萬、殖利率 > 4%、一年波動度 < 35%、配息 ≥ 3 年',
    preset: 'dividend',
    filters: [
      { key: 'turnover20d', op: 'gte', value: 2e7 },
      { key: 'dividendYieldTTM', op: 'gte', value: 0.04 },
      { key: 'vol1y', op: 'lte', value: 0.35 },
      { key: 'dividendYears', op: 'gte', value: 3 },
    ],
  },
  {
    id: 'liquid-momentum',
    label: '高成交動能股',
    desc: '日均成交額 > 1 億、三個月報酬 > 5%、站上年線、RSI < 80',
    preset: 'momentum',
    filters: [
      { key: 'turnover20d', op: 'gte', value: 1e8 },
      { key: 'ret3m', op: 'gte', value: 0.05 },
      { key: 'aboveMa200', op: 'gte', value: 1 },
      { key: 'rsi14', op: 'lte', value: 80 },
    ],
  },
  {
    id: 'value-blue-chip',
    label: '大型價值股',
    desc: '市值 > 200 億、本益比 5–20 倍、ROE > 10%',
    preset: 'value',
    filters: [
      { key: 'marketCap', op: 'gte', value: 2e10 },
      { key: 'pe', op: 'between', value: 5, value2: 20 },
      { key: 'roe', op: 'gte', value: 0.1 },
    ],
  },
  {
    id: 'low-vol-core',
    label: '低波動核心持股',
    desc: '日均成交額 > 5,000 萬、一年波動度 < 25%、夏普值 > 0.5',
    preset: 'defensive',
    filters: [
      { key: 'turnover20d', op: 'gte', value: 5e7 },
      { key: 'vol1y', op: 'lte', value: 0.25 },
      { key: 'sharpe1y', op: 'gte', value: 0.5 },
    ],
  },
  {
    id: 'tech-breakout',
    label: '技術轉強股',
    desc: 'MACD 金叉、站上月線與季線、RSI 45–70（避免追高）、量能 > 1.2 倍',
    preset: 'momentum',
    filters: [
      { key: 'turnover20d', op: 'gte', value: 3e7 },
      { key: 'macdGolden', op: 'gte', value: 1 },
      { key: 'aboveMa20', op: 'gte', value: 1 },
      { key: 'aboveMa50', op: 'gte', value: 1 },
      { key: 'rsi14', op: 'between', value: 45, value2: 70 },
      { key: 'volRatio', op: 'gte', value: 1.2 },
    ],
  },
  {
    id: 'oversold-rebound',
    label: '超跌反彈候選',
    desc: 'RSI < 35、距 52 週高點 > 20%、仍維持基本流動性',
    preset: 'value',
    filters: [
      { key: 'turnover20d', op: 'gte', value: 3e7 },
      { key: 'rsi14', op: 'lte', value: 35 },
      { key: 'near52w', op: 'lte', value: 0.8 },
    ],
  },
];

export default { screen, TEMPLATES };
