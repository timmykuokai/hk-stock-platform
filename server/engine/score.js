/**
 * score.js — 多維度評分模型。
 * 方法：先在各維度內做「百分位排名」（0–100，方向已校正），再依策略權重加總。
 * 缺值處理：該維度不計分，權重重新正規化，並回傳覆蓋率（coverage）供使用者判讀可信度。
 */

/** 維度定義：metric 鍵 + 方向（1 越大越好 / -1 越小越好）+ 維度內權重 */
export const DIMENSIONS = {
  liquidity: { label: '流動性／熱門度', metrics: [['turnover20d', 1, 0.6], ['volume20d', 1, 0.4]] },
  dividend: { label: '殖利率與配息', metrics: [['dividendYieldTTM', 1, 0.7], ['dividendYears', 1, 0.3]] },
  value: { label: '估值', metrics: [['pe', -1, 0.6], ['pb', -1, 0.4]] },
  quality: { label: '基本面品質', metrics: [['roe', 1, 0.6], ['profitMargin', 1, 0.4]] },
  risk: { label: '風險控制', metrics: [['vol1y', -1, 0.6], ['mdd1y', 1, 0.4]] },
  momentum: { label: '動能', metrics: [['ret3m', 1, 0.5], ['ret6m', 1, 0.3], ['aboveMa200', 1, 0.2]] },
  stability: { label: '報酬穩定度', metrics: [['sharpe1y', 1, 0.5], ['monthlyWinRate', 1, 0.3], ['stability', 1, 0.2]] },
};

/** 預設權重組合 */
export const PRESETS = {
  balanced: { label: '均衡型', weights: { liquidity: 0.15, dividend: 0.1, value: 0.15, quality: 0.15, risk: 0.15, momentum: 0.15, stability: 0.15 } },
  dividend: { label: '穩健收息', weights: { liquidity: 0.15, dividend: 0.35, value: 0.1, quality: 0.2, risk: 0.15, momentum: 0.0, stability: 0.05 } },
  momentum: { label: '成長動能', weights: { liquidity: 0.15, dividend: 0.0, value: 0.05, quality: 0.1, risk: 0.1, momentum: 0.45, stability: 0.15 } },
  defensive: { label: '低波動防禦', weights: { liquidity: 0.15, dividend: 0.15, value: 0.1, quality: 0.15, risk: 0.3, momentum: 0.05, stability: 0.1 } },
  value: { label: '價值型', weights: { liquidity: 0.1, dividend: 0.15, value: 0.35, quality: 0.25, risk: 0.15, momentum: 0.0, stability: 0.0 } },
};

/** 百分位排名（含方向校正）；值缺則 null */
function rank(values, v, dir) {
  if (v == null || !Number.isFinite(v)) return null;
  const arr = values.filter((x) => Number.isFinite(x));
  if (arr.length < 2) return 50;
  arr.sort((a, b) => a - b);
  // 二分搜尋位置
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  const pct = (lo / (arr.length - 1)) * 100;
  return dir === -1 ? 100 - pct : pct;
}

/**
 * 對整個池計算評分
 * @param {Array<{code:string,metrics:object}>} items
 * @param {string|object} preset preset 名稱或自訂 {weights}
 * @returns {Array} 含 score 物件的原陣列副本
 */
export function scoreAll(items, preset = 'balanced') {
  const presetDef = typeof preset === 'string' ? PRESETS[preset] ?? PRESETS.balanced : { label: '自訂', weights: preset.weights ?? PRESETS.balanced.weights };
  const weights = presetDef.weights;

  // 收集各 metric 的母體值
  const pools = {};
  for (const [dim, def] of Object.entries(DIMENSIONS)) {
    void dim;
    for (const [key] of def.metrics) {
      if (!pools[key]) pools[key] = items.map((it) => it.metrics?.[key]).filter((x) => x != null && Number.isFinite(x));
    }
  }

  return items.map((it) => {
    const dims = {};
    let sum = 0;
    let wsum = 0;
    let covered = 0;
    let totalWeighted = 0;
    for (const [dim, def] of Object.entries(DIMENSIONS)) {
      const w = weights[dim] ?? 0;
      if (w <= 0) { dims[dim] = null; continue; }
      let dSum = 0;
      let dW = 0;
      for (const [key, dir, mw] of def.metrics) {
        const r = rank(pools[key], it.metrics?.[key], dir);
        if (r == null) continue;
        dSum += r * mw;
        dW += mw;
      }
      if (dW === 0) { dims[dim] = null; continue; }
      const dimScore = dSum / dW;
      dims[dim] = Math.round(dimScore * 10) / 10;
      sum += dimScore * w;
      wsum += w;
      covered += 1;
      totalWeighted += w;
    }
    // 各維度已為 0–100 的百分位分數，加權平均後即為 0–100 總分
    const score = wsum > 0 ? sum / wsum : null;
    return {
      ...it,
      score: {
        preset: typeof preset === 'string' ? preset : 'custom',
        presetLabel: presetDef.label,
        total: score == null ? null : Math.round(score * 10) / 10,
        dimensions: dims,
        coverage: totalWeighted > 0 ? Math.round((wsum / Object.values(weights).reduce((a, b) => a + b, 0)) * 100) : 0,
        weights,
      },
    };
  });
}

/** 評分等級標籤 */
export function grade(score) {
  if (score == null) return { label: '資料不足', tone: 'muted' };
  if (score >= 80) return { label: '強勢', tone: 'up' };
  if (score >= 65) return { label: '偏好', tone: 'up' };
  if (score >= 50) return { label: '中性', tone: 'flat' };
  if (score >= 35) return { label: '偏弱', tone: 'down' };
  return { label: '弱勢', tone: 'down' };
}

export default { scoreAll, PRESETS, DIMENSIONS, grade };
