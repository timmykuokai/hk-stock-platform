/**
 * regime.js — P2 · 市況判定引擎（八維 → 三態）+ 指標適用性路由 + 關鍵變量觸發台
 *
 * 來源：圓桌報告 §02 八維市況判定表、市況×指標適用性對照表、§04 關鍵變量觀察台。
 * 設計原則（與 P1 相同）：全部基於現有已算好的日 K／指標序列，**零外部依賴**；
 * 需要外部市場數據的維度（廣度、南向資金）標為 `pending`，前端顯示「待接入」而非硬塞假值。
 *
 *   buildRegime        → 八維判定，輸出 {regime,label,confidence,dims[],counts,persistence,advice}
 *   buildApplicability → 依市況路由指標效力（10 指標 × 3 市況，靜態查表）
 *   buildTriggers      → 關鍵變量觸發台（10 變量，可算 6 個，其餘標待接入）
 */
import { sma, adx, bollinger, obv, percentileRank } from '../lib/stats.js';

const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

const BULL = 'bull', RANGE = 'range', BEAR = 'bear';
const STATE_LABEL = { bull: '上升', range: '震盪', bear: '下跌' };

/* ------------------------------ P2-1 · 市況判定引擎（八維） ------------------------------ */

const DIM_META = [
  { id: 'benchMa60', name: '① 恒指 vs 60 日線', group: 'market' },
  { id: 'maStack', name: '② 5/20/60 均線排列', group: 'stock' },
  { id: 'adxTrend', name: '③ ADX(14) 趨勢強度', group: 'stock' },
  { id: 'bbWidth', name: '④ 布林帶寬分位', group: 'stock' },
  { id: 'turnover', name: '⑤ 成交額水位', group: 'stock' },
  { id: 'breadth', name: '⑥ 52 週新高／新低家數比', group: 'pending' },
  { id: 'southbound', name: '⑦ 南向資金／流動性', group: 'pending' },
  { id: 'pullback', name: '⑧ 個股回踩行為', group: 'stock' },
];

const PENDING_REASON = {
  breadth: '需全市場廣度數據（etnet 市場總覽 / HKEX 統計）',
  southbound: '需滬深港通南向資金淨流入，暫無免費穩定來源',
};

/**
 * 八維市況判定。
 * 規則（文件）：≥5 維落同一欄且連續 5 個交易日維持 → 市況成立。
 * 實作調整：可算維度僅 6 個（⑥⑦ 待接入），門檻改為 max(4, ceil(可算維度 × 0.6))。
 *
 * @param {object} p
 * @param {Array<{date,open,high,low,close,volume,amount?}>} p.bars 個股日 K
 * @param {Array<{date,close}>} [p.bench] 基準指數（恒指）日 K
 * @param {{close?:number,ma20?:number,ma60?:number}} [p.latest] 指標最新快照（僅用於顯示）
 * @returns {object|null}
 */
export function buildRegime({ bars, bench, latest } = {}) {
  if (!bars || bars.length < 60) return null;

  const closes = bars.map((b) => b.close);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume || 0);
  const amounts = bars.map((b) => (b.amount != null ? b.amount : (b.close || 0) * (b.volume || 0)));
  const n = closes.length;

  const ma5 = sma(closes, 5);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  const adxArr = adx(bars, 14);
  const bb = bollinger(closes, 20, 2);
  const obvArr = obv(closes, volumes);
  const obvMa20 = sma(obvArr, 20);
  const amt20 = sma(amounts, 20);
  const amt60 = sma(amounts, 60);

  // 布林帶寬序列：(upper − lower) / mid × 100
  const bw = closes.map((_, i) => {
    const u = bb.upper?.[i], l = bb.lower?.[i], m = ma20[i];
    return u != null && l != null && m != null && m > 0 ? ((u - l) / m) * 100 : null;
  });

  // 基準（恒指）序列
  const bCloses = (bench || []).map((b) => b && b.close).filter((v) => Number.isFinite(v) && v > 0);
  const bMa60 = bCloses.length >= 60 ? sma(bCloses, 60) : null;
  const bN = bCloses.length;

  /** 帶寬分位（取最近 252 個有效值為母體） */
  const bwPercentile = (i) => {
    const v = bw[i];
    if (v == null) return null;
    const from = Math.max(0, i - 251);
    const pool = bw.slice(from, i + 1).filter((x) => Number.isFinite(x));
    if (pool.length < 30) return null;
    return Math.round(percentileRank(pool, v)); // percentileRank 已回傳 0–100
  };

  /**
   * 回踩行為：近 60 日
   *  - holds  ：盤中跌破 MA20 但收在月線上（回踩守住）
   *  - breaks ：收盤跌破 MA20（破位）
   *  - cross  ：收盤價穿越 MA20 的次數（來回穿越＝震盪特徵）
   */
  const pullbackStats = (i) => {
    const from = Math.max(0, i - 59);
    let holds = 0, breaks = 0, cross = 0, prevSide = null;
    for (let k = from; k <= i; k++) {
      const m = ma20[k];
      if (m == null || lows[k] == null || closes[k] == null) continue;
      if (closes[k] < m) { breaks++; if (prevSide === 'above') cross++; prevSide = 'below'; }
      else { if (lows[k] <= m) holds++; if (prevSide === 'below') cross++; prevSide = 'above'; }
    }
    return { holds, breaks, cross };
  };

  /** 單一維度在「k 個交易日前」的狀態（k=0 為最新） */
  const dimAt = (id, k) => {
    switch (id) {
      case 'benchMa60': {
        if (!bMa60 || bN < 60) return null;
        const i = bN - 1 - k;
        if (i < 0 || bMa60[i] == null) return null;
        const dev = (bCloses[i] / bMa60[i] - 1) * 100;
        const state = dev > 1 ? BULL : dev < -1 ? BEAR : RANGE;
        return { state, value: r2(dev), display: `恒指 ${r1(bCloses[i])} · MA60 ${r1(bMa60[i])}（${dev > 0 ? '+' : ''}${r2(dev)}%）` };
      }
      case 'maStack': {
        const i = n - 1 - k;
        if (i < 0 || ma5[i] == null || ma20[i] == null || ma60[i] == null) return null;
        const a = ma5[i], b = ma20[i], c = ma60[i];
        // 需有實質間距（各級 >0.5%）才算排列成立，避免均線糾結時被微小差值誤判
        const state = a > b * 1.005 && b > c * 1.005 ? BULL : a < b * 0.995 && b < c * 0.995 ? BEAR : RANGE;
        return { state, value: null, display: `MA5 ${r1(a)} / MA20 ${r1(b)} / MA60 ${r1(c)}` };
      }
      case 'adxTrend': {
        const i = n - 1 - k;
        const a = adxArr?.[i];
        if (a == null || ma20[i] == null) return null;
        // ADX<25 視為無明確趨勢（盤整）；≥25 才由價格與 MA20 的關係定方向
        const state = a < 25 ? RANGE : closes[i] >= ma20[i] ? BULL : BEAR;
        return { state, value: r1(a), display: `ADX ${r1(a)}${a < 25 ? '（無明確趨勢）' : ''}` };
      }
      case 'bbWidth': {
        const i = n - 1 - k;
        const v = bw[i];
        if (v == null) return null;
        const pct = bwPercentile(i);
        if (pct == null) return null;
        const state = pct < 25 ? RANGE : pct > 75 ? (closes[i] >= ma20[i] ? BULL : BEAR) : RANGE;
        return { state, value: pct, display: `帶寬 ${r2(v)}%（近一年 ${pct} 分位）` };
      }
      case 'turnover': {
        const i = n - 1 - k;
        const a = amt20?.[i], b = amt60?.[i];
        if (a == null || b == null || b <= 0) return null;
        const ratio = a / b;
        // 放量＝趨勢市（方向看價格 vs MA20）；縮量＝盤整
        const state = ratio >= 1.15 ? (closes[i] >= ma20[i] ? BULL : BEAR) : RANGE;
        return { state, value: r2(ratio), display: `20/60 日均成交額比 ${r2(ratio)}` };
      }
      case 'pullback': {
        const i = n - 1 - k;
        if (ma20[i] == null || closes[i] == null) return null;
        const { holds, breaks, cross } = pullbackStats(i);
        const above = closes[i] >= ma20[i];
        // 反覆上上下下穿越月線（≥6 次）＝震盪特徵；其餘依現價在月線哪一側定趨勢
        const state = cross >= 6 ? RANGE : above ? BULL : BEAR;
        return {
          state, value: `${holds}/${breaks}`,
          display: `回踩守住 ${holds} 次 / 收破 MA20 ${breaks} 次 / 穿越 ${cross} 次`,
        };
      }
      default:
        return null;
    }
  };

  const dims = DIM_META.map((meta) => {
    if (meta.group === 'pending') {
      return {
        ...meta, state: null, value: null, display: '—',
        available: false, pending: true, reason: PENDING_REASON[meta.id],
      };
    }
    const cur = dimAt(meta.id, 0);
    if (!cur) {
      return { ...meta, state: null, value: null, display: '—', available: false, pending: false, reason: '資料不足（需 ≥60 根日 K）' };
    }
    // 連續維持天數：往回逐日比對，直到狀態改變或達 5 日
    let streak = 1;
    for (let k = 1; k <= 4; k++) {
      const prev = dimAt(meta.id, k);
      if (!prev || prev.state !== cur.state) break;
      streak++;
    }
    return {
      ...meta,
      state: cur.state,
      stateLabel: STATE_LABEL[cur.state],
      value: cur.value,
      display: cur.display,
      available: true,
      pending: false,
      streak,
      proxy: meta.id === 'turnover' ? true : undefined,
      note: meta.id === 'turnover'
        ? '原設計為「全市場成交額水位」（需市場總覽）；此處以個股 20/60 日均成交額比代理，反映個股資金活躍度而非大市水位。'
        : meta.id === 'benchMa60'
          ? '以恒生指數為大市代理。'
          : undefined,
    };
  });

  const avail = dims.filter((d) => d.available);
  const counts = {
    bull: avail.filter((d) => d.state === BULL).length,
    range: avail.filter((d) => d.state === RANGE).length,
    bear: avail.filter((d) => d.state === BEAR).length,
  };
  const computed = avail.length;
  const threshold = Math.max(4, Math.ceil(computed * 0.6));

  // 主導狀態：取票數最高；平手時偏向盤整（較保守）
  let regime = RANGE;
  const maxCount = Math.max(counts.bull, counts.range, counts.bear);
  const winners = [BULL, RANGE, BEAR].filter((s) => counts[s] === maxCount);
  if (winners.length === 1) regime = winners[0];
  else if (winners.includes(RANGE)) regime = RANGE;
  else regime = winners[0];

  // 整體維持天數：以「主導狀態」在過去 5 日的得票是否持續過門檻衡量
  let maintained = 0;
  for (let k = 0; k < 5; k++) {
    const snapshot = avail.map((d) => dimAt(d.id, k)?.state).filter(Boolean);
    if (snapshot.length < computed) break;
    const c = snapshot.filter((s) => s === regime).length;
    if (c >= threshold) maintained++;
    else break;
  }

  const meetsThreshold = counts[regime] >= threshold;
  const confidence = meetsThreshold && maintained >= 5 ? 'high'
    : meetsThreshold || maintained >= 3 ? 'medium' : 'low';
  const confidenceLabel = { high: '高', medium: '中', low: '低' }[confidence];

  const advice = {
    bull: '上升市況：順勢而為，以趨勢指標（均線／MACD／ADX／唐奇安）為主；回踩不破月線視為加碼點。擺盪指標在單邊市會超買鈍化，勿單憑 RSI／KD 超買就減倉。',
    range: '震盪市況：高抛低吸，以擺盪指標（RSI／KD／布林／CCI／乖離率）為主；趨勢指標反覆假突破，突破訊號須有量能確認才可跟進。',
    bear: '下跌市況：防守優先，反彈視為減碼機會；均線空頭排列下任何買訊都應縮倉位、縮短持有期，並以 ATR 放寬止蝕避免被震出。',
  }[regime];

  return {
    regime,
    label: `${STATE_LABEL[regime]}市況`,
    stateLabel: STATE_LABEL[regime],
    confidence,
    confidenceLabel,
    counts,
    computed,
    total: DIM_META.length,
    threshold,
    meetsThreshold,
    persistence: { days: maintained, required: 5 },
    dims,
    advice,
    asOf: bars[n - 1]?.date ?? latest?.date ?? null,
    price: latest?.close ?? closes[n - 1] ?? null,
  };
}

/* ------------------------------ P2-2 · 指標適用性路由 ------------------------------ */

/**
 * 市況 × 指標適用性對照（圓桌報告表 B）。
 * level：effective 有效（🔴）／ neutral 中性（🟡）／ invalid 失效（🟢）
 */
const APPLICABILITY_MATRIX = [
  {
    id: 'ma', name: '均線 MA / EMA',
    hints: { bull: '多頭排列為主要持股依據，回踩月線不破即可續抱。', range: '均線糾結、反覆穿越，訊號雜訊高。', bear: '空頭排列為主要減碼依據，反彈至季線不過即減。' },
    levels: { bull: 'effective', range: 'neutral', bear: 'effective' },
  },
  {
    id: 'macd', name: 'MACD',
    hints: { bull: '金叉與柱體放大可靠，為加碼確認鍵。', range: '頻繁假金叉／假死叉，參考價值低。', bear: '死叉與柱體轉負可靠，反彈結束的確認訊號。' },
    levels: { bull: 'effective', range: 'invalid', bear: 'effective' },
  },
  {
    id: 'rsi', name: 'RSI 相對強弱',
    hints: { bull: '單邊市超買會長期鈍化，超買不等於該賣。', range: '超買超賣區間反轉有效，是核心工具。', bear: '超賣會長期鈍化，超賣不等於該買（越跌越便宜是陷阱）。' },
    levels: { bull: 'invalid', range: 'effective', bear: 'invalid' },
  },
  {
    id: 'kd', name: 'KD 隨機指數',
    hints: { bull: '高位鈍化，僅作短線節奏參考。', range: '低位金叉／高位死叉有效。', bear: '低位鈍化，勿視為落底。' },
    levels: { bull: 'neutral', range: 'effective', bear: 'neutral' },
  },
  {
    id: 'boll', name: '布林通道',
    hints: { bull: '沿上軌上行屬強勢，觸上軌不必然回檔。', range: '上下軌間來回，觸軌反轉是主要操作依據。', bear: '沿下軌下行屬弱勢，觸下軌不必然反彈。' },
    levels: { bull: 'neutral', range: 'effective', bear: 'neutral' },
  },
  {
    id: 'adx', name: 'ADX 趨勢強度',
    hints: { bull: 'ADX 上升確認趨勢強度，與均線共振。', range: 'ADX 低於 20 本就代表無趨勢，無需參考。', bear: 'ADX 上升確認下跌趨勢強度。' },
    levels: { bull: 'effective', range: 'invalid', bear: 'effective' },
  },
  {
    id: 'obv', name: 'OBV / 量能',
    hints: { bull: '量價同步為真突破；背離為出場警訊。', range: '量能萎縮，背離訊號雜訊多。', bear: '量退背離可提前預示反彈乏力。' },
    levels: { bull: 'effective', range: 'neutral', bear: 'effective' },
  },
  {
    id: 'cci', name: 'CCI 通道指數',
    hints: { bull: '極端值鈍化，僅作動能參考。', range: '±100 區間來回有效。', bear: '極端值鈍化。' },
    levels: { bull: 'neutral', range: 'effective', bear: 'neutral' },
  },
  {
    id: 'bias', name: '乖離率 BIAS',
    hints: { bull: '正乖離可長期擴大，勿過早逆勢。', range: '乖離回歸中線是核心邏輯。', bear: '負乖離可長期擴大。' },
    levels: { bull: 'neutral', range: 'effective', bear: 'neutral' },
  },
  {
    id: 'donchian', name: '唐奇安通道（突破）',
    hints: { bull: '突破 20 日高點是主要加碼訊號（海龜法）。', range: '假突破頻繁，容易兩面挨巴掌。', bear: '跌破 20 日低點是主要停損訊號。' },
    levels: { bull: 'effective', range: 'invalid', bear: 'effective' },
  },
];

const LEVEL_LABEL = { effective: '有效', neutral: '中性', invalid: '失效' };
const LEVEL_CLASS = { effective: 'up', neutral: 'flat', invalid: 'down' };
const LEVEL_ICON = { effective: '🔴', neutral: '🟡', invalid: '🟢' };

/**
 * 依市況產出指標適用性清單。
 * @param {string} regime 'bull' | 'range' | 'bear'
 */
export function buildApplicability(regime) {
  const r = [BULL, RANGE, BEAR].includes(regime) ? regime : RANGE;
  const rows = APPLICABILITY_MATRIX.map((m) => {
    const level = m.levels[r];
    return {
      id: m.id, name: m.name, level,
      label: LEVEL_LABEL[level],
      cls: LEVEL_CLASS[level],
      icon: LEVEL_ICON[level],
      hint: m.hints[r],
    };
  });
  const eff = rows.filter((x) => x.level === 'effective');
  const inv = rows.filter((x) => x.level === 'invalid');
  return {
    regime: r,
    label: `${STATE_LABEL[r]}市況`,
    rows,
    summary: `當前「${STATE_LABEL[r]}市況」下，優先採信 ${eff.map((x) => x.name).join('、')}；${inv.length ? `暫勿單獨依賴 ${inv.map((x) => x.name).join('、')}。` : '無明顯失效指標。'}`,
  };
}

/* ------------------------------ P2-3 · 關鍵變量觸發台 ------------------------------ */

/**
 * 關鍵變量觸發台（圓桌報告 §04a，10 變量）。
 * 可算 6 個（恒指vs60日線、布林帶寬、MACD柱、OBV、個股日線vs60日線、財報窗口）；
 * 其餘 4 個（大市成交額、沽空佔比、新高新低比、EPS斜率）標為待接入。
 *
 * @param {object} p
 * @param {Array} p.bars 個股日 K
 * @param {object} p.latest 指標最新快照
 * @param {Array} [p.bench] 恒指日 K
 */
export function buildTriggers({ bars, latest, bench } = {}) {
  const rows = [];
  const push = (r) => rows.push({ state: 'normal', tone: 'flat', ...r });

  const closes = (bars || []).map((b) => b.close);
  const n = closes.length;
  const L = latest || {};

  // ① 恒指 vs 60 日線
  const bCloses = (bench || []).map((b) => b && b.close).filter((v) => Number.isFinite(v) && v > 0);
  if (bCloses.length >= 60) {
    const m = sma(bCloses, 60);
    const i = bCloses.length - 1;
    const dev = (bCloses[i] / m[i] - 1) * 100;
    push({
      id: 'hsi60', name: '恒指 vs 60 日線', trigger: '跌破 −2%（轉弱）／站上 +2%（轉強）',
      value: `${dev > 0 ? '+' : ''}${r2(dev)}%`,
      state: dev < -2 ? 'triggered' : dev < 0 ? 'watch' : 'normal',
      tone: dev < -2 ? 'down' : dev < 0 ? 'warn' : 'up',
      note: `恒指 ${r1(bCloses[i])} vs MA60 ${r1(m[i])}`,
    });
  } else {
    push({ id: 'hsi60', name: '恒指 vs 60 日線', trigger: '跌破 −2%', value: '—', state: 'pending', tone: 'flat', note: '基準指數資料不足（需 ≥60 根）' });
  }

  // ② 大市成交額（待接入）
  push({ id: 'mktTurnover', name: '大市成交額水位', trigger: '連續 3 日低於 20 日均量 7 成', value: '—', state: 'pending', tone: 'flat', pending: true, note: '需全市場成交額（etnet 市場總覽 / HKEX）' });

  // ③ 沽空佔比（待接入）
  push({ id: 'shortRatio', name: '沽空佔比', trigger: '沽空比率 > 15%', value: '—', state: 'pending', tone: 'flat', pending: true, note: '需 etnet 沽空數據（ci_act_sell）' });

  // ④ 52 週新高／新低家數比（待接入）
  push({ id: 'breadth', name: '52 週新高／新低家數比', trigger: '新低家數 > 新高家數（連續 5 日）', value: '—', state: 'pending', tone: 'flat', pending: true, note: '需全市場廣度統計' });

  // ⑤ 布林帶寬分位
  if (n >= 60) {
    const bb = bollinger(closes, 20, 2);
    const ma20 = sma(closes, 20);
    const bwArr = closes.map((_, i) => {
      const u = bb.upper?.[i], l = bb.lower?.[i], m = ma20[i];
      return u != null && l != null && m > 0 ? ((u - l) / m) * 100 : null;
    });
    const v = bwArr[n - 1];
    const pool = bwArr.slice(Math.max(0, n - 252)).filter((x) => Number.isFinite(x));
    if (v != null && pool.length >= 30) {
      const pct = Math.round(percentileRank(pool, v));
      push({
        id: 'bbWidth', name: '布林帶寬分位', trigger: '< 20 分位（擠壓待變盤）／> 80 分位（趨勢末端）',
        value: `${pct} 分位（帶寬 ${r2(v)}%）`,
        state: pct < 20 || pct > 80 ? 'watch' : 'normal',
        tone: pct < 20 || pct > 80 ? 'warn' : 'flat',
        note: pct < 20 ? '帶寬擠壓，變盤機率升高（方向未定）' : pct > 80 ? '帶寬極度擴張，波動已大，留意趨勢末端' : '波動處於常態區間',
      });
    } else {
      push({ id: 'bbWidth', name: '布林帶寬分位', trigger: '< 20 / > 80 分位', value: '—', state: 'pending', tone: 'flat', note: '資料不足' });
    }
  }

  // ⑥ MACD 柱
  if (L.macdHist != null) {
    const h = L.macdHist;
    push({
      id: 'macdHist', name: 'MACD 柱（動能）', trigger: '柱體由正轉負／連續 3 日縮小',
      value: `${h > 0 ? '+' : ''}${r2(h)}`,
      state: h < 0 ? 'triggered' : 'normal',
      tone: h < 0 ? 'down' : 'up',
      note: h < 0 ? '柱體翻負，空頭動能主導' : '柱體為正，多頭動能維持',
    });
  } else {
    push({ id: 'macdHist', name: 'MACD 柱（動能）', trigger: '柱體由正轉負', value: '—', state: 'pending', tone: 'flat', note: '資料不足' });
  }

  // ⑦ OBV vs MA20
  if (L.obv != null && L.obvMa20 != null && L.obvMa20 !== 0) {
    const ratio = L.obv / L.obvMa20;
    push({
      id: 'obv', name: 'OBV vs 20 日均線', trigger: '跌破 0.98（量能撤退）',
      value: r2(ratio),
      state: ratio < 0.98 ? 'triggered' : ratio > 1.02 ? 'normal' : 'normal',
      tone: ratio < 0.98 ? 'down' : ratio > 1.02 ? 'up' : 'flat',
      note: ratio < 0.98 ? 'OBV 低於均線，資金淨流出' : ratio > 1.02 ? 'OBV 高於均線，資金淨流入' : '量能中性',
    });
  } else {
    push({ id: 'obv', name: 'OBV vs 20 日均線', trigger: '跌破 0.98', value: '—', state: 'pending', tone: 'flat', note: '資料不足' });
  }

  // ⑧ EPS 斜率（待接入）
  push({ id: 'epsSlope', name: 'EPS 斜率（基本面）', trigger: 'EPS(TTM) 連續兩季下彎', value: '—', state: 'pending', tone: 'flat', pending: true, note: '需財報歷史序列（P4 估值分位帶一併解鎖）' });

  // ⑨ 個股日線 vs 60 日線
  if (closes[n - 1] != null && L.ma60 != null && L.ma60 > 0) {
    const dev = (closes[n - 1] / L.ma60 - 1) * 100;
    push({
      id: 'px60', name: '個股日線 vs 60 日線', trigger: '跌破 −5%（長線轉弱）',
      value: `${dev > 0 ? '+' : ''}${r2(dev)}%`,
      state: dev < -5 ? 'triggered' : dev < 0 ? 'watch' : 'normal',
      tone: dev < -5 ? 'down' : dev < 0 ? 'warn' : 'up',
      note: `現價 ${r1(closes[n - 1])} vs MA60 ${r1(L.ma60)}`,
    });
  } else {
    push({ id: 'px60', name: '個股日線 vs 60 日線', trigger: '跌破 −5%', value: '—', state: 'pending', tone: 'flat', note: '資料不足' });
  }

  // ⑩ 財報窗口（港股全年業績集中 3 月、中期業績集中 8 月）
  const asOf = L.date || bars?.[n - 1]?.date;
  if (asOf) {
    const month = Number(String(asOf).slice(5, 7));
    const inWindow = month === 3 || month === 8;
    push({
      id: 'earnings', name: '財報窗口', trigger: '3 月（全年業績）／8 月（中期業績）',
      value: inWindow ? `${month} 月（業績密集期）` : `${month} 月（非密集期）`,
      state: inWindow ? 'watch' : 'normal',
      tone: inWindow ? 'warn' : 'flat',
      note: inWindow ? '業績公布密集期，建議減權或等公布後再布局，避免業績落差風險。' : '非業績密集期，無額外窗口風險。',
    });
  } else {
    push({ id: 'earnings', name: '財報窗口', trigger: '3 月 / 8 月', value: '—', state: 'pending', tone: 'flat', note: '資料不足' });
  }

  const triggered = rows.filter((r) => r.state === 'triggered').length;
  const watch = rows.filter((r) => r.state === 'watch').length;
  const pending = rows.filter((r) => r.state === 'pending').length;
  return {
    rows,
    counts: { triggered, watch, pending, total: rows.length },
    summary: triggered
      ? `已觸發 ${triggered} 項警戒線（另有 ${watch} 項接近門檻），建議重新評估部位。`
      : watch
        ? `無項目觸發，但有 ${watch} 項接近門檻，持續觀察。`
        : '所有可算變量皆在常態區間。',
  };
}
