/**
 * validate.js — 資料驗證與清洗。
 * 原則：外部資料一律不可信；驗證失敗的欄位標記為 null 並寫入 issues，
 * 讓上層能決定「降級使用」或「拒絕」，而不是讓髒資料流進模型。
 */

/** 轉數字，失敗回 null */
export function num(v, { min = -Infinity, max = Infinity } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,%\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/** 百分比字串（"5.20%"）轉 0.052 */
export function pct(v) {
  const n = num(v);
  return n === null ? null : n / 100;
}

/**
 * 清洗 K 線：剔除無效與異常資料
 * @returns {{bars:Array, issues:string[]}}
 */
export function cleanBars(bars) {
  const issues = [];
  const out = [];
  let droppedNull = 0;
  let droppedDup = 0;
  let fixed = 0;
  const seen = new Set();

  for (const b of bars) {
    if (!b || !b.date || seen.has(b.date)) { droppedDup++; continue; }
    const o = num(b.open, { min: 0 });
    const h = num(b.high, { min: 0 });
    const l = num(b.low, { min: 0 });
    const c = num(b.close, { min: 0 });
    const v = num(b.volume, { min: 0 });
    if (o === null || h === null || l === null || c === null || c <= 0) { droppedNull++; continue; }
    let [hh, ll] = [h, l];
    // 修正：高低價未涵蓋開收盤
    if (hh < Math.max(o, c) || ll > Math.min(o, c)) {
      hh = Math.max(hh, o, c);
      ll = Math.min(ll, o, c);
      if (ll <= 0) ll = Math.min(o, c, hh);
      fixed++;
    }
    seen.add(b.date);
    out.push({
      date: b.date,
      open: o,
      high: hh,
      low: ll,
      close: c,
      volume: v ?? 0,
      amount: num(b.amount, { min: 0 }),
    });
  }

  out.sort((a, b) => (a.date < b.date ? -1 : 1));

  // 異常單日跳空（> 60%）僅標記，不刪除（可能是合股／除權）
  for (let i = 1; i < out.length; i++) {
    const r = out[i].close / out[i - 1].close - 1;
    if (Math.abs(r) > 0.6) issues.push(`異常單日變動 ${out[i].date}: ${(r * 100).toFixed(1)}%`);
  }

  if (droppedNull) issues.push(`剔除 ${droppedNull} 筆不完整 K 線`);
  if (droppedDup) issues.push(`剔除 ${droppedDup} 筆重複日期`);
  if (fixed) issues.push(`修正 ${fixed} 筆高低價不合理的 K 線`);
  return { bars: out, issues };
}

/** 基本面欄位合理性驗證（港股實務區間） */
export function cleanFundamentals(raw) {
  const f = {};
  const issues = [];
  const rules = {
    marketCap: [0, 1e14],
    trailingPE: [-1000, 5000],
    forwardPE: [-1000, 5000],
    priceToBook: [-100, 1000],
    dividendYield: [0, 0.5],
    returnOnEquity: [-5, 5],
    profitMargin: [-5, 5],
    revenueGrowth: [-5, 20],
    earningsGrowth: [-5, 50],
    beta: [-5, 10],
    eps: [-1000, 5000],
  };
  for (const [k, [min, max]] of Object.entries(rules)) {
    const v = num(raw?.[k], { min, max });
    if (raw?.[k] != null && v === null) issues.push(`${k} 超出合理區間：${raw[k]}`);
    f[k] = v;
  }
  f.name = typeof raw?.name === 'string' ? raw.name : null;
  f.sector = typeof raw?.sector === 'string' ? raw.sector : null;
  f.industry = typeof raw?.industry === 'string' ? raw.industry : null;
  f.currency = typeof raw?.currency === 'string' ? raw.currency : null;
  f.source = raw?.source ?? null;
  f.asOf = raw?.asOf ?? null;
  f.issues = issues;
  return f;
}

/** 簡易 schema 驗證（物件必填鍵檢查） */
export function hasKeys(obj, keys) {
  return keys.every((k) => obj && obj[k] !== undefined && obj[k] !== null);
}
