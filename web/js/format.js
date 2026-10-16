/** format.js — 顯示格式化工具（港台慣例：紅漲綠跌） */

export function fmtNum(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('zh-HK', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('zh-HK');
}

/** 港式金額：億 / 萬 */
export function fmtCompact(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(digits)} 兆`;
  if (a >= 1e8) return `${(v / 1e8).toFixed(digits)} 億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(a >= 1e6 ? 0 : 1)} 萬`;
  return fmtNum(v, 0);
}

export function fmtPct(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtPctRaw(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${Number(v).toFixed(digits)}%`;
}

export function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}

export function fmtDate(s) {
  if (!s) return '—';
  return String(s).slice(0, 10);
}

/** 由分鐘數轉成「X 分鐘前／X 小時前」的人類可讀文字 */
export function fmtAge(min) {
  if (min == null || !Number.isFinite(min)) return '—';
  if (min < 1) return '剛更新';
  if (min < 60) return `${Math.round(min)} 分鐘前`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h} 小時${m ? m + '分' : ''}前`;
}

export function fmtTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-HK', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 依漲跌回傳樣式 class（0 為中性） */
export function toneClass(v) {
  if (v == null || !Number.isFinite(v)) return 'muted';
  if (v > 0) return 'up';
  if (v < 0) return 'down';
  return 'muted';
}

export function signed(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${Number(v).toFixed(digits)}`;
}

/** 當日升跌金額（帶正負號，單位與股價相同；紅漲綠跌由呼叫端 toneClass 控制） */
export function fmtChg(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${Number(v).toLocaleString('zh-HK', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}

/** 依 metric 定義格式化 */
export function fmtMetric(key, v) {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  const money = ['turnover20d', 'turnover60d', 'marketCap'];
  const priceLike = ['price', 'ma20', 'ma50', 'ma200', 'previousClose', 'high52w', 'low52w'];
  const pctLike = ['dividendYieldTTM', 'dividendYieldReported', 'vol1y', 'vol60d', 'mdd1y', 'mddMax', 'ret1y', 'ret3m', 'ret6m', 'ret1m', 'roe', 'roa', 'profitMargin', 'grossMargin', 'revenueGrowth', 'earningsGrowth', 'monthlyWinRate', 'stability', 'dividendCagr'];
  if (money.includes(key)) return fmtCompact(v);
  if (priceLike.includes(key)) return fmtPrice(v);
  if (pctLike.includes(key)) return fmtPct(v);
  if (key === 'volume20d' || key === 'lastVolume') return fmtCompact(v, 1);
  return fmtNum(v, 2);
}

export function scoreClass(s) {
  if (s == null) return 'score-s3';
  if (s >= 80) return 'score-s5';
  if (s >= 65) return 'score-s4';
  if (s >= 50) return 'score-s3';
  if (s >= 35) return 'score-s2';
  return 'score-s1';
}

export default { fmtNum, fmtInt, fmtCompact, fmtPct, fmtPctRaw, fmtPrice, fmtDate, fmtTime, toneClass, signed, fmtChg, fmtMetric, scoreClass };
