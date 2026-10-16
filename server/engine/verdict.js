/**
 * verdict.js — 綜合決策引擎。
 *
 * 把三個互相獨立的評分來源合成一個可讀的決策摘要：
 *   1. 技術面（0–100）：由 indicators.technical 的十大加權訊號映射而來
 *   2. 基本面（0–100）：十大要素評分總和
 *   3. 風險（0–100）：ATR%、Beta、52 週位置、本益比四項加總後映射
 *
 * 並產出：信心指數、支撐壓力、建議關注價位（買入區間／風險界線／目標價）、
 * 風險回報比、多空因素、建議持有期、四層決策框架。
 *
 * ⚠️ 本模組輸出的是「量化觀察結果」，不是買賣指令。
 */
import { analyseTenFactors, fourLayerFramework, factorSummary } from './factors.js';
import { priceLadder } from './indicators.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

/** 風險評級：分數越高＝風險越低 */
export function computeRiskScore({ metrics = {}, fundamentals = {}, indicators = null } = {}) {
  const L = indicators?.latest ?? {};
  const m = metrics;
  const f = fundamentals;
  let score = 0;
  const reasons = [];

  const atrPct = num(m.atrPct ?? L.atrPct);
  if (atrPct != null) {
    if (atrPct > 3) { score += 30; reasons.push(`高波動（ATR 佔股價 ${atrPct.toFixed(2)}%）`); }
    else if (atrPct > 2) { score += 20; reasons.push(`中等波動（ATR 佔股價 ${atrPct.toFixed(2)}%）`); }
    else { score += 10; reasons.push(`低波動（ATR 佔股價 ${atrPct.toFixed(2)}%）`); }
  } else reasons.push('ATR 資料不可用');

  const beta = num(m.betaReported ?? f.beta ?? m.beta1y);
  if (beta != null) {
    if (beta > 1.2) { score += 30; reasons.push(`高系統風險（Beta ${beta.toFixed(2)}）`); }
    else if (beta > 0.8) { score += 20; reasons.push(`中等系統風險（Beta ${beta.toFixed(2)}）`); }
    else { score += 10; reasons.push(`低系統風險（Beta ${beta.toFixed(2)}）`); }
  } else reasons.push('Beta 資料不可用');

  const hi = num(m.high52w ?? L.high52w);
  const lo = num(m.low52w ?? L.low52w);
  const price = num(m.price ?? L.close);
  if (price != null && hi != null && lo != null && hi > 0 && price > 0) {
    const hd = ((hi - price) / hi) * 100;
    const ld = ((price - lo) / price) * 100;
    if (hd < 5 || ld < 5) { score += 30; reasons.push(`接近 52 週極端價（距高 ${hd.toFixed(1)}% / 距低 ${ld.toFixed(1)}%）`); }
    else if (hd < 10 || ld < 10) { score += 20; reasons.push(`接近 52 週高低點（距高 ${hd.toFixed(1)}% / 距低 ${ld.toFixed(1)}%）`); }
    else { score += 10; reasons.push(`遠離 52 週極端價（距高 ${hd.toFixed(1)}% / 距低 ${ld.toFixed(1)}%）`); }
  } else reasons.push('52 週高低點資料不可用');

  const pe = num(m.pe ?? f.trailingPE);
  if (pe != null && pe > 0) {
    if (pe > 30) { score += 20; reasons.push(`本益比 ${pe.toFixed(1)} 倍，評價風險較高`); }
    else if (pe > 20) { score += 15; reasons.push(`本益比 ${pe.toFixed(1)} 倍`); }
    else { score += 5; reasons.push(`本益比 ${pe.toFixed(1)} 倍，評價風險較低`); }
  } else reasons.push('本益比不可用或為負');

  let level = '低風險';
  let score100 = 85;
  if (score >= 80) { level = '高風險'; score100 = 15; }
  else if (score >= 60) { level = '中高風險'; score100 = 35; }
  else if (score >= 40) { level = '中風險'; score100 = 55; }
  else if (score >= 20) { level = '中低風險'; score100 = 70; }

  return { level, raw: score, score: score100, reasons };
}

/**
 * 產生綜合決策摘要
 * @param {{metrics:object, fundamentals:object, indicators:object}} input
 */
export function buildVerdict({ metrics = {}, fundamentals = {}, indicators = null } = {}) {
  if (!indicators?.latest) return null;
  const L = indicators.latest;
  const price = num(metrics.price) ?? L.close;

  const techScore = indicators.technical?.score ?? 50;
  const factors = analyseTenFactors({ metrics, fundamentals, indicators });
  const fundSummary = factorSummary(factors);
  const fundScore = fundSummary.percent; // 0–100
  const risk = computeRiskScore({ metrics, fundamentals, indicators });

  const overall = Math.round((techScore * 0.4 + fundScore * 0.4 + risk.score * 0.2) * 10) / 10;

  let verdict = '中性觀望';
  let tone = 'flat';
  if (overall >= 75) { verdict = '條件強勢'; tone = 'up'; }
  else if (overall >= 60) { verdict = '條件偏好'; tone = 'up'; }
  else if (overall >= 45) { verdict = '中性觀望'; tone = 'flat'; }
  else if (overall >= 30) { verdict = '條件偏弱'; tone = 'down'; }
  else { verdict = '條件弱勢'; tone = 'down'; }

  // 信心指數：關鍵欄位齊全度
  const keys = [metrics.pe, metrics.pb ?? fundamentals?.priceToBook, fundamentals?.returnOnEquity,
    metrics.dividendYieldTTM, fundamentals?.beta, fundamentals?.operatingCashflow, fundamentals?.freeCashflow];
  const available = keys.filter((v) => v != null && Number.isFinite(v)).length;
  const confidence = available >= 5 ? '高' : available >= 3 ? '中' : '低';

  const ladder = priceLadder(L);
  // 風險回報比以「進場區間中值」為基準，才符合實際可執行的部位成本；
  // 若現價已低於進場區間（例如已回落至支撐），則改用現價計算。
  const entryRef = ladder.entryLow != null && ladder.entryHigh != null
    ? (price != null && price < ladder.entryLow ? price : (ladder.entryLow + ladder.entryHigh) / 2)
    : price;
  const riskReward = entryRef && ladder.stopLoss && ladder.takeProfit1 && entryRef > ladder.stopLoss
    ? Math.round(((ladder.takeProfit1 - entryRef) / (entryRef - ladder.stopLoss)) * 100) / 100
    : null;

  // 多空因素
  const bullish = [];
  const bearish = [];
  for (const s of indicators.technical.signals) {
    if (s.contribution >= 1.2 && bullish.length < 3) bullish.push({ source: '技術面', text: s.remark });
    if (s.contribution <= -1.2 && bearish.length < 3) bearish.push({ source: '技術面', text: s.remark });
  }
  for (const f of fundSummary.strengths) {
    if (bullish.length < 4 && f.rating.tone === 'up') {
      bullish.push({ source: f.factor, text: `${f.factor} ${f.score}/10（${f.rating.label}）：${f.signals[0] ?? ''}` });
    }
  }
  for (const f of fundSummary.weaknesses) {
    if (bearish.length < 4 && f.rating.tone === 'down') {
      bearish.push({ source: f.factor, text: `${f.factor} ${f.score}/10（${f.rating.label}）：${f.signals[0] ?? ''}` });
    }
  }

  const adx = num(L.adx14) ?? 20;
  const timeHorizon = adx > 30 ? '短期（1–3 個月）' : adx > 20 ? '中期（3–12 個月）' : '長期（1 年以上）';

  return {
    overall,
    verdict: { label: verdict, tone },
    techScore: Math.round(techScore * 10) / 10,
    fundScore: Math.round(fundScore * 10) / 10,
    riskScore: risk.score,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    confidence,
    dataAvailability: available,
    price,
    support: r2(L.support),
    resistance: r2(L.resistance),
    entryZone: { low: ladder.entryLow, high: ladder.entryHigh, basis: ladder.basis },
    entryRef: r2(entryRef),
    stopLoss: ladder.stopLoss,
    takeProfit1: ladder.takeProfit1,
    takeProfit2: ladder.takeProfit2,
    riskReward,
    bullish,
    bearish,
    timeHorizon,
    technicalDetail: indicators.technical,
    fundamentalDetail: fundSummary,
    layers: fourLayerFramework(factors),
    weights: { technical: 0.4, fundamental: 0.4, risk: 0.2 },
    note: '本摘要為量化模型輸出之觀察結果，非投資建議；請搭配自身風險承受度與其他資訊獨立判斷。',
  };
}

export default { buildVerdict, computeRiskScore };
