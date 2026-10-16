// P4 估值引擎
// 兩個純函式，零外部依賴、可單測：
//   buildValuationBands   —— PE/PB 歷史分位帶（近似法）
//   buildRsiValuationMatrix —— RSI × 估值 決策矩陣（擴充原 2×2 極端格為 3×3）
//
// 資料缺口說明（對應圓桌報告「建議 6 / 7」）：
//   現有 Yahoo 僅提供「當下 PE/PB/EPS/BVPS 快照」，無歷史 EPS/PE 序列。
//   報告第 106 行允許降級處理：「先以當下 PE 快照 vs 歷史區間近似」。
//   本模組採用該許可：以最新 TTM 的 EPS / 每股帳面值 反推歷史 PE/PB，
//   實質等價於「股價自身歷史分位」，誠實標註 proxy。

import { percentileRank } from '../lib/stats.js';

const TRADING_DAYS = 252;

const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const round4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

/** 百分位（0–100，1 位小數）；樣本不足回傳 null */
function pctOf(pool, v) {
  if (!pool || pool.length < 2 || v == null) return null;
  return Math.round(percentileRank(pool, v) * 10) / 10;
}

/** 10/25/50/75/90 分位帶 */
function bands(pool) {
  if (!pool || pool.length < 2) return null;
  const s = [...pool].sort((a, b) => a - b);
  const q = (p) => {
    const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
    return s[idx];
  };
  return { p10: round4(q(10)), p25: round4(q(25)), p50: round4(q(50)), p75: round4(q(75)), p90: round4(q(90)) };
}

/** 估值狀態：偏低 / 合理 / 偏高 */
export function valState(pct) {
  if (pct == null) return 'unknown';
  if (pct < 30) return 'cheap';
  if (pct > 70) return 'expensive';
  return 'fair';
}

export function stateLabel(s) {
  return s === 'cheap' ? '估值偏低' : s === 'expensive' ? '估值偏高' : s === 'fair' ? '估值合理' : '資料不足';
}

/**
 * 建構 PE/PB 歷史分位帶。
 * @param {object} fund 原始基本面（含 eps、bookValue、trailingPE、priceToBook）
 * @param {Array<{close:number}>} bars 價格序列（chart.bars）
 * @returns {object}
 */
export function buildValuationBands(fund = {}, bars = []) {
  const eps = fund && fund.eps != null ? Number(fund.eps) : null;
  const bvps = fund && fund.bookValue != null ? Number(fund.bookValue) : null;

  const closes = (bars || [])
    .map((b) => (b && b.close != null ? Number(b.close) : null))
    .filter((v) => v != null && Number.isFinite(v));
  const n = closes.length;
  const closeNow = n ? closes[n - 1] : null;

  // 反推歷史 PE/PB：價格 ÷ 最新 TTM 的 EPS/BVPS（近似法）
  const peHist = eps > 0 ? closes.map((c) => c / eps) : null;
  const pbHist = bvps > 0 ? closes.map((c) => c / bvps) : null;

  // 當下估值（與分位帶同尺度 = 收盤 ÷ 最新 EPS/BVPS，確保分位可比）
  const curPE = eps > 0 && closeNow != null ? closeNow / eps : null;
  const curPB = bvps > 0 && closeNow != null ? closeNow / bvps : null;

  const pe = peHist
    ? {
        current: round2(curPE),
        reported: fund.trailingPE != null ? round2(Number(fund.trailingPE)) : null,
        percentile: pctOf(peHist, curPE),
        bands: bands(peHist),
        state: valState(pctOf(peHist, curPE)),
        proxy: true,
      }
    : null;

  const pb = pbHist
    ? {
        current: round4(curPB),
        reported: fund.priceToBook != null ? round4(Number(fund.priceToBook)) : null,
        percentile: pctOf(pbHist, curPB),
        bands: bands(pbHist),
        state: valState(pctOf(pbHist, curPB)),
        proxy: true,
      }
    : null;

  const windowYears = n ? Math.round((n / TRADING_DAYS) * 10) / 10 : null;

  return {
    pe,
    pb,
    window: n ? { bars: n, years: windowYears } : null,
    primary: pe ? 'pe' : pb ? 'pb' : null,
    note: '以最新 TTM 的 EPS / 每股帳面值 反推歷史 PE/PB 分位（近似法）；分位越高代表相對自身歷史越貴。',
  };
}

/** 估值軸短標籤 */
const VAL_TAG = { cheap: '低估', fair: '合理', expensive: '偏高' };
/** RSI 軸短標籤 */
const RSI_TAG = { oversold: '超賣', neutral: '中性', overbought: '超買' };

/** 四角 + 中性格語義（tone: strong=偏多 / watch=觀望 / caution=留意 / neutral=中性 / strong_sell=偏空） */
const SEM = {
  'cheap|oversold': { tone: 'strong', text: '黃金交叉區：估值便宜 + 技術超賣，潛在強力買點，優先關注' },
  'cheap|neutral': { tone: 'watch', text: '估值便宜但技術未發力，可分批布局、等待催化' },
  'cheap|overbought': { tone: 'caution', text: '估值修復中：便宜但已漲，追價需謹慎、設好停利' },
  'fair|oversold': { tone: 'watch', text: '估值合理 + 技術超賣，反彈可參與但非低估紅利' },
  'fair|neutral': { tone: 'neutral', text: '估值與技術皆中性，觀望為主、順勢操作' },
  'fair|overbought': { tone: 'caution', text: '估值合理但已超買，短線過熱、不宜追高' },
  'expensive|oversold': { tone: 'caution', text: '弱反彈：估值偏貴但技術反彈，減倉反彈而非加碼' },
  'expensive|neutral': { tone: 'watch', text: '估值偏貴且技術中性，持有需控倉、留意轉弱' },
  'expensive|overbought': { tone: 'strong_sell', text: '估值透支：貴且超買，減碼 / 避險信號' },
};

/**
 * 建構 RSI × 估值 決策矩陣（3×3，擴充原 2×2 極端格）。
 * @param {number} rsi 最新 RSI(14)
 * @param {string} valuationState 估值狀態 cheap/fair/expensive/unknown
 * @returns {object}
 */
export function buildRsiValuationMatrix(rsi, valuationState, opts = {}) {
  const r = rsi != null && Number.isFinite(Number(rsi)) ? Number(rsi) : 50;
  const vState = valuationState || 'unknown';

  const rsiCat = r < 35 ? 'oversold' : r > 65 ? 'overbought' : 'neutral';

  const rsiCols = [
    { key: 'oversold', label: 'RSI 超賣 (<35)' },
    { key: 'neutral', label: 'RSI 中性 (35–65)' },
    { key: 'overbought', label: 'RSI 超買 (>65)' },
  ];
  // unknown 時退化为單列，避免空白格誤導
  const valRows =
    vState === 'unknown'
      ? [{ key: 'unknown', label: '估值資料不足' }]
      : [
          { key: 'cheap', label: '估值偏低 (<30%)' },
          { key: 'fair', label: '估值合理 (30–70%)' },
          { key: 'expensive', label: '估值偏高 (>70%)' },
        ];

  let active = null;
  const cells = valRows.map((row) => ({
    valKey: row.key,
    valLabel: row.label,
    rsi: rsiCols.map((col) => {
      const k = `${row.key}|${col.key}`;
      const s = SEM[k] || { tone: 'neutral', text: '' };
      const isActive = row.key === vState && col.key === rsiCat;
      const label = `${VAL_TAG[row.key] || '—'}×${RSI_TAG[col.key]}`;
      if (isActive) active = { ...s, label, rsiKey: col.key, valKey: row.key, text: s.text };
      return { rsiKey: col.key, rsiLabel: col.label, tone: s.tone, text: s.text, active: isActive, label };
    }),
  }));

  return {
    rsi: Math.round(r * 10) / 10,
    rsiCat,
    valuationState: vState,
    rsiCols,
    valRows,
    cells,
    active: vState === 'unknown' ? null : active,
    recommendation: vState === 'unknown' ? '資料不足，無法判定' : active ? active.text : '資料不足，無法判定',
    note:
      `估值軸取自 ${opts.primary === 'pb' ? 'PB' : 'PE'} 分位` +
      (vState === 'unknown' ? '（PE/PB 資料不足）' : '') +
      '；RSI 取最新 RSI(14)。矩陣擴充原 2×2 極端格，加入中性格以利判讀。',
  };
}
