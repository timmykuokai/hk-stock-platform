/**
 * movers.js — 異動掃描引擎。
 *
 * 概念移植自原 Python 版 display_hot_stocks_scan：把整個池的快照換成五種視角，
 * 讓使用者在同一個畫面看到「市場今天發生什麼事」。
 * 資料來源是池快照已算好的 metrics，不額外打外部 API（快、且口徑一致）。
 */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 掃描視角定義（回傳給前端產生頁籤） */
export const VIEWS = [
  { id: 'gainers', label: '今日漲幅', icon: '🚀', sortKey: 'changePercent', desc: '單日漲跌幅排行（>0）' },
  { id: 'losers', label: '今日跌幅', icon: '📉', sortKey: 'changePercent', desc: '單日跌幅排行（<0）' },
  { id: 'value', label: '成交額', icon: '💰', sortKey: 'turnover20d', desc: '20 日均成交額排行' },
  { id: 'surge', label: '量能爆發', icon: '🔥', sortKey: 'volRatio', desc: '最新成交量 / 20 日均量' },
  { id: 'high52', label: '逼近新高', icon: '🏔️', sortKey: 'near52w', desc: '現價距 52 週高點比例' },
  { id: 'hot', label: '熱門組合', icon: '💥', sortKey: 'changePercent', desc: '量能 ≥1.5 倍且漲幅 ≥2%' },
];

function row(it) {
  const m = it.metrics ?? {};
  return {
    code: it.code,
    name: it.zhName || it.name || null,
    enName: it.name || null,
    price: num(m.price),
    changePercent: num(m.changePercent),
    change: num(m.change),
    turnover20d: num(m.turnover20d),
    volRatio: num(m.volRatio),
    near52w: num(m.near52w),
    rsi14: num(m.rsi14),
    macdGolden: m.macdGolden ?? null,
    ret1m: num(m.ret1m),
    score: it.score?.total ?? null,
  };
}

/**
 * @param {Array} items 池快照項目
 * @param {{limit?:number}} opts
 */
export function scanMovers(items, { limit = 15 } = {}) {
  const rows = items.map(row);
  const take = (arr, desc = true) => [...arr].sort((a, b) => (desc ? b.v - a.v : a.v - b.v))
    .filter((x) => Number.isFinite(x.v)).slice(0, limit).map((x) => x.row);

  const wrap = (arr, key, desc = true) => take(arr.filter((r) => r[key] != null).map((r) => ({ row: r, v: r[key] })), desc);

  const list = rows;
  const hot = rows.filter((r) => (r.volRatio ?? 0) >= 1.5 && (r.changePercent ?? -99) >= 2);

  return {
    gainers: wrap(list.filter((r) => (r.changePercent ?? 0) > 0), 'changePercent', true),
    losers: wrap(list.filter((r) => (r.changePercent ?? 0) < 0), 'changePercent', false),
    value: wrap(list, 'turnover20d', true),
    surge: wrap(list, 'volRatio', true),
    high52: wrap(list, 'near52w', true),
    hot: wrap(hot, 'changePercent', true),
    universe: list.length,
    views: VIEWS,
  };
}

/**
 * 技術面訊號快篩：直接從池快照挑出符合經典技術條件的標的
 * @param {Array} items
 */
export function scanSignals(items, { limit = 20 } = {}) {
  const rows = items.map(row);
  const out = [];
  for (const r of rows) {
    const tags = [];
    if (r.macdGolden === true) tags.push('MACD 金叉');
    else if (r.macdGolden === false) tags.push('MACD 死叉');
    if (r.rsi14 != null && r.rsi14 < 30) tags.push('RSI 超賣');
    if (r.rsi14 != null && r.rsi14 > 70) tags.push('RSI 超買');
    if (r.volRatio != null && r.volRatio >= 2) tags.push('量能 ≥2 倍');
    if (r.near52w != null && r.near52w >= 0.97) tags.push('逼近 52 週高');
    if (r.near52w != null && r.near52w <= 0.55) tags.push('深度修正');
    if (!tags.length) continue;
    out.push({ ...r, tags });
  }
  out.sort((a, b) => (b.volRatio ?? 0) - (a.volRatio ?? 0));
  return out.slice(0, limit);
}

export default { scanMovers, scanSignals, VIEWS };
