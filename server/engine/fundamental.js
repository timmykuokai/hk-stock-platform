/**
 * P3 · 基本面引擎
 * 三個純函式（不碰網路、不依賴外部源，便於單測）：
 *   - buildFundamentalGate : 進場前的「資格紅綠燈」（PE/PB/ROE/毛利率/營收成長/負債權益比/經營現金流）
 *   - buildEarningsWindow  : 港股「3 月年報 / 8 月中報」財報窗口 + 業績前減權期（精確日標待接入）
 *   - buildPositionMatrix  : 三市況應對框架（倉位區間/持股週期/止蝕寬鬆度）靜態矩陣，高亮當前市況
 *
 * 資料來源：Yahoo Finance quote page 擷取的基本面快照（見 server/data/providers/yahoo.js NUMERIC_MAP）。
 * 注意：Yahoo 回傳的 margin / roe / growth 為「分數」（0.15 = 15%），PE/PB 為倍數，debtToEquity 為倍數。
 */

// ───────────────────────────────────────────────────────────
// 工具：把分數轉百分比顯示
// ───────────────────────────────────────────────────────────
function pctOf(frac) {
  return frac == null ? null : frac * 100;
}

// ───────────────────────────────────────────────────────────
// 1. 基本面資格 Gate（紅綠燈）
// ───────────────────────────────────────────────────────────
/**
 * @param {object|null} fund      原始基本面（Yahoo 快照，含 debtToEquity / operatingCashflow 等）
 * @param {object} metrics        computeMetrics 輸出（含 pe/pb/roe/grossMargin/revenueGrowth）
 * @returns {{status:string,label:string,summary:string,counts:object,checks:Array}}
 */
export function buildFundamentalGate(fund = {}, metrics = {}) {
  const pe = metrics.pe ?? null;
  const pb = metrics.pb ?? null;
  const roe = metrics.roe ?? null;          // 分數
  const gross = metrics.grossMargin ?? null; // 分數
  const revG = metrics.revenueGrowth ?? null; // 分數
  const d2eRaw = fund?.debtToEquity ?? null;  // Yahoo 有時以「百分比」回傳（如 38.59 = 38.59%）
  const d2e = d2eRaw == null ? null : (d2eRaw > 10 ? d2eRaw / 100 : d2eRaw);
  const ocf = fund?.operatingCashflow ?? null; // 絕對金額

  const roePct = pctOf(roe);
  const grossPct = pctOf(gross);
  const revGPct = pctOf(revG);

  /** 產生一項檢查，null 值 → 無資料(none) */
  const chk = (id, label, value, display, stateFn) => {
    if (value == null) return { id, label, value: null, display: '—', state: 'none' };
    const state = stateFn();
    return { id, label, value, display, state };
  };

  const checks = [
    chk('roe', '獲利能力 ROE', roe, roePct == null ? '—' : `${roePct.toFixed(1)}%`,
      () => (roe >= 0.10 ? 'pass' : roe >= 0 ? 'warn' : 'fail')),
    chk('rev', '成長性 營收成長', revG, revGPct == null ? '—' : `${revGPct >= 0 ? '+' : ''}${revGPct.toFixed(1)}%`,
      () => (revG >= 0.05 ? 'pass' : revG >= 0 ? 'warn' : 'fail')),
    chk('pe', '估值 PE', pe, pe == null ? '—' : `${pe.toFixed(1)}x`,
      () => (pe > 0 && pe <= 25 ? 'pass' : pe > 25 && pe <= 40 ? 'warn' : 'fail')),
    chk('pb', '估值 PB', pb, pb == null ? '—' : `${pb.toFixed(2)}x`,
      () => (pb > 0 && pb <= 3 ? 'pass' : pb > 3 && pb <= 6 ? 'warn' : 'fail')),
    chk('gross', '獲利品質 毛利率', gross, grossPct == null ? '—' : `${grossPct.toFixed(1)}%`,
      () => (gross >= 0.30 ? 'pass' : gross >= 0.15 ? 'warn' : 'fail')),
    chk('d2e', '財務結構 負債權益比', d2e, d2e == null ? '—' : `${d2e.toFixed(2)}x`,
      () => (d2e <= 0.8 ? 'pass' : d2e <= 2.0 ? 'warn' : 'fail')),
    chk('ocf', '現金流 經營現金流', ocf, ocf == null ? '—' : (ocf > 0 ? '為正' : '為負/零'),
      () => (ocf > 0 ? 'pass' : 'fail')),
  ];

  const counts = {
    pass: checks.filter((c) => c.state === 'pass').length,
    warn: checks.filter((c) => c.state === 'warn').length,
    fail: checks.filter((c) => c.state === 'fail').length,
    none: checks.filter((c) => c.state === 'none').length,
  };

  let status, label, summary;
  if (counts.none >= 4) {
    status = 'data'; label = '資料不足';
    summary = 'Yahoo 未提供足夠基本面欄位（個股可能無覆蓋），無法判定資格，請改用其他方式盡調。';
  } else if (counts.fail === 0) {
    status = 'pass'; label = '資格通過';
    summary = '各項基本面門檻均通過，可作為進場候選；仍須配合技術面與市況。';
  } else if (counts.fail === 1) {
    status = 'watch'; label = '有疑慮';
    summary = `有 1 項未達門檻（${counts.warn} 項偏弱），可小注或待其改善後再考慮。`;
  } else {
    status = 'fail'; label = '資格不合格';
    summary = `${counts.fail} 項基本面未達門檻，建議回避或僅題材短打。`;
  }

  return { status, label, summary, counts, checks };
}

// ───────────────────────────────────────────────────────────
// 2. 財報窗口（港股 3 月年報 / 8 月中報 + 業績前減權期）
// ───────────────────────────────────────────────────────────
const DAY = 86400000;

/**
 * @param {number} [now=Date.now()] 可注入時間，便於單測
 * @returns {object}
 */
export function buildEarningsWindow(now = Date.now()) {
  const y = new Date(now).getFullYear();

  // 候選公告期：前一年~次年 的 3/31(年報) 與 8/31(中報)
  const raw = [];
  for (const yy of [y - 1, y, y + 1]) {
    raw.push({ date: Date.UTC(yy, 2, 31), type: '年報' });
    raw.push({ date: Date.UTC(yy, 7, 31), type: '中報' });
  }
  const all = raw.sort((a, b) => a.date - b.date);

  // 最近一次（<= now）與下一次（>= now）
  const next = all.find((c) => c.date >= now) || all[all.length - 1];
  const last = [...all].reverse().find((c) => c.date <= now) || all[0];

  const daysToReport = Math.ceil((next.date - now) / DAY);
  const reduceStart = next.date - 21 * DAY;   // 業績前 21 日開始減權
  const justEnd = last.date + 7 * DAY;        // 最近一次業績後 7 日內視為剛公佈

  let status, statusLabel;
  if (now <= justEnd && now >= last.date) {
    status = 'just_reported';
    statusLabel = '剛公佈（業績不確定性消除，可重新評估）';
  } else if (now >= reduceStart && now < next.date) {
    status = 'reduce';
    statusLabel = '業績前減權期（建議減權 1–2 週，避免業績地雷）';
  } else {
    status = 'normal';
    statusLabel = `距離下次業績約 ${daysToReport} 天`;
  }

  return {
    estimatedDate: new Date(next.date).toISOString().slice(0, 10),
    periodType: next.type,
    preciseDate: null,
    preciseSource: '待接入（Yahoo calendar / HKEX 披露易）',
    daysToReport,
    status,
    statusLabel,
    windowNote: '港股年報集中 3 月、中報集中 8 月（預估公告期，非精確公告日）。',
  };
}

// ───────────────────────────────────────────────────────────
// 3. 倉位建議矩陣（三市況應對框架 · 靜態版）
// ───────────────────────────────────────────────────────────
const MATRIX_ROWS = [
  {
    key: 'bull', regimeLabel: '進攻市況',
    positionRange: '60–80%', holdPeriod: '數週～數月（中期）',
    stopWidth: '較寬 8–10%', portions: '3–4 份',
    strategy: '順勢加碼，強者恆強',
  },
  {
    key: 'range', regimeLabel: '均衡市況',
    positionRange: '40–60%', holdPeriod: '數日～數週（短中期）',
    stopWidth: '中等 5–7%', portions: '2–3 份',
    strategy: '區間操作，高拋低吸',
  },
  {
    key: 'bear', regimeLabel: '防守市況',
    positionRange: '20–40%', holdPeriod: '數日（極短）',
    stopWidth: '緊 3–5%', portions: '1–2 份',
    strategy: '現金為王，只做最強',
  },
];

/**
 * @param {string} [regimeKey] 'bull' | 'range' | 'bear'
 * @returns {{rows:Array,current:string,note:string}}
 */
export function buildPositionMatrix(regimeKey) {
  const current = ['bull', 'range', 'bear'].includes(regimeKey) ? regimeKey : 'range';
  const rows = MATRIX_ROWS.map((r) => ({ ...r, active: r.key === current }));
  return {
    rows,
    current,
    note: '倉位區間 / 持股週期 / 止蝕寬鬆度為靜態「三市況應對框架」（不依賴估值）。份數的微調（估值分位聯動）留待 P4。',
  };
}
