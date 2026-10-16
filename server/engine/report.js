/**
 * report.js — 個股「詳細文字分析報告」生成引擎。
 *
 * 在查詢指定股票的即時股價後，彙整三個層面的資訊並產出可讀的報告：
 *   1. 當前市場現況：近期價格走勢、成交量、關鍵財務指標
 *   2. 市場熱度與關注度：新聞曝光頻率、社群討論量（代理指標）、資金流向（代理指標）
 *   3. 綜合評估：買入 / 觀望 / 回避 的明確建議，含具體理由與主要風險
 *
 * 資料來源：Yahoo Finance（報價／K線／基本面）、etnet 二十大成交（交叉驗證）、
 *          平台聚合新聞（Yahoo HK/US RSS + AAStocks）。
 *
 * ⚠️ 關於「社群討論量」與「資金流向」：平台目前沒有直接的社群聲量或北水／資金流 API，
 *    報告中以「成交量比、成交額排名、etnet 上榜、價量關係」等可取得的交易動能作為
 *   代理指標，並於报告中明确标注，切勿等同於真實資金淨流向或社群聲量。
 *
 * ⚠️ 本模組輸出為量化觀察與資訊彙整，不是買賣指令。
 */
import { getBars, getQuote, getFundamentals, getBenchmark, getSnapshot, getTopTurnover } from '../data/marketData.js';
import { computeMetrics } from '../data/metrics.js';
import { computeIndicators } from './indicators.js';
import { analyseTenFactors, fourLayerFramework, factorSummary } from './factors.js';
import { buildVerdict } from './verdict.js';
import { getTopNews } from '../data/news.js';
import { detectMarket, normalizeCode } from '../data/providers/yahoo.js';
import { US_POPULAR } from '../data/usUniverse.js';
import { getUsMovers } from './usMovers.js';
import { marketProfile, benchmarkLabel } from '../lib/market.js';
import { Degrade } from '../lib/degrade.js';
import log from '../lib/logger.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pctStr = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const normCode = (c) => String(c || '').replace(/^0+/, '');

function compact(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e12) return `${s}${(a / 1e12).toFixed(2)}兆`;
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(2)}億`;
  if (a >= 1e4) return `${s}${(a / 1e4).toFixed(2)}萬`;
  return `${s}${a.toFixed(0)}`;
}
const tone = (v) => (v == null ? null : v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
const signed = (v, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);

/* 把評估整體分映射為「買入 / 觀望 / 回避」三檔明確建議 */
function verdictToAction(overall, confidence) {
  let action = '觀望';
  let actTone = 'flat';
  if (overall >= 60) { action = '買入'; actTone = 'up'; }
  else if (overall >= 45) { action = '觀望'; actTone = 'flat'; }
  else { action = '回避'; actTone = 'down'; }
  // 資料完整度低時，不直接給「買入」強建議，降一檔並提示
  if (confidence === '低' && action === '買入') { action = '觀望'; actTone = 'flat'; }
  return { action, actTone };
}

/* 從新聞聚合流中篩選與指定股票相關的報導 */
function matchNews(feed, code, zhName, enName) {
  const target = normCode(code);
  const kw = [zhName, enName].filter((x) => x && x.length >= 2);
  return (feed.items || []).filter((it) => {
    if ((it.related || []).some((rc) => normCode(rc) === target)) return true;
    const t = it.title || '';
    if (kw.some((k) => t.includes(k))) return true;
    // 代號直接出現（如 0700 / 00700）
    if (t.includes(code) || t.includes(target.padStart(4, '0')) || t.includes(target.padStart(5, '0'))) return true;
    return false;
  });
}

/**
 * 產生個股詳細文字分析報告。
 * @param {string} rawCode
 * @param {{range?:string, live?:boolean, market?:'hk'|'us'}} opts
 */
export async function buildReport(rawCode, { range = '3y', live = false, market } = {}) {
  const market0 = market || detectMarket(rawCode);
  const profile = marketProfile(market0); // 基準／標籤一律查市場設定表
  const code = normalizeCode(rawCode, market0);
  const usMeta = market0 === 'us' ? US_POPULAR.find((x) => x.code === code) : null;
  const dg = new Degrade('report');
  const [chart, quote, fund, bench] = await Promise.all([
    getBars(code, { range, force: live }),
    dg.run('即時報價', getQuote(code, { force: live }), null),
    dg.run('基本面', getFundamentals(code, { withZh: true, force: live, market: market0 }), null),
    dg.run(`基準指數 ${profile.benchmark}`, getBenchmark(profile.benchmark, range, { force: live }), []),
  ]);
  if (!chart?.bars?.length) {
    return { code, error: '查無資料（該代號可能非港股／美股，或 Yahoo 暫無資料）', generatedAt: new Date().toISOString() };
  }

  const metrics = computeMetrics({ bars: chart.bars, dividends: chart.dividends, fundamentals: fund, bench });
  const indicators = computeIndicators(chart.bars, { seriesLen: 0 });
  const factors = analyseTenFactors({ metrics, fundamentals: fund ?? {}, indicators });
  const fs = factorSummary(factors);
  const layers = fourLayerFramework(factors);
  const verdict = indicators?.latest ? buildVerdict({ metrics, fundamentals: fund ?? {}, indicators }) : null;

  const name = chart.name || fund?.shortName || usMeta?.name || null;
  const zhName = fund?.zhName || usMeta?.zh || null;
  const price = metrics.price;
  const change = metrics.change;
  const changePercent = metrics.changePercent;

  /* ---------------- 1. 市場現況 ---------------- */
  const marketSection = buildMarketSection(metrics, fund, indicators, { code, name, zhName, currency: chart.currency, price, change, changePercent, market: market0 });

  /* ---------------- 2. 市場熱度與關注度 ---------------- */
  const heat = await buildHeatSection({ code, zhName, enName: name, changePercent, live, market: market0 });

  /* ---------------- 3. 綜合評估 ---------------- */
  const assessment = buildAssessmentSection({
    metrics, factors, fs, verdict, code, name, zhName, price, changePercent,
  });

  return {
    code,
    symbol: chart.symbol,
    name: name || zhName || code,
    zhName,
    currency: chart.currency,
    price,
    change,
    changePercent,
    asOf: chart.bars[chart.bars.length - 1]?.date ?? null,
    source: chart.source,
    live: !!live,
    fetchedAt: chart.fetchedAt,
    generatedAt: new Date().toISOString(),
    market: market0,
    marketSection,
    heat,
    assessment,
    // 資料源降級明細（如報價／基本面／基準抓取失敗），供前端提示「部分資料可能不完整」
    _degraded: dg.degraded ? dg.items : undefined,
  };
}

/* ====================== 各段落生成 ====================== */

function buildMarketSection(m, f, indicators, ctx) {
  const L = indicators?.latest ?? {};
  const p = ctx.price;
  const ret1m = m.ret1m, ret3m = m.ret3m, ret6m = m.ret6m, ret1y = m.ret1y;
  const pos = m.position52w;

  // 價格走勢描述
  const trendBits = [];
  if (ret1y != null) trendBits.push(`一年報酬 ${signed(ret1y * 100, 1)}%`);
  if (ret6m != null) trendBits.push(`半年 ${signed(ret6m * 100, 1)}%`);
  if (ret3m != null) trendBits.push(`一季 ${signed(ret3m * 100, 1)}%`);
  if (ret1m != null) trendBits.push(`近月 ${signed(ret1m * 100, 1)}%`);
  const trendText = trendBits.length ? trendBits.join('、') : '近期報酬數據不足';

  let maText = '均線資料不足';
  if (p != null && L.ma20 != null && L.ma50 != null && L.ma200 != null) {
    if (p > L.ma20 && L.ma20 > L.ma50 && L.ma50 > L.ma200) maText = '股價站穩在 MA20／MA50／MA200 之上，短中長期均線多頭排列';
    else if (p < L.ma20 && L.ma20 < L.ma50 && L.ma50 < L.ma200) maText = '股價位於 MA20／MA50／MA200 之下，均線空頭排列';
    else maText = `股價 ${p > L.ma20 ? '高於' : '低於'} 月線、${p > L.ma50 ? '高於' : '低於'} 季線、${p > L.ma200 ? '高於' : '低於'} 年線，方向尚待確認`;
  }

  let posText = '';
  if (pos != null) {
    if (pos >= 80) posText = `目前處於 52 週相對高位（${pos.toFixed(0)}%），追高風險上升`;
    else if (pos <= 20) posText = `目前接近 52 週低位（${pos.toFixed(0)}%），具逆向關注價值但須確認基本面未惡化`;
    else posText = `52 週相對位置約 ${pos.toFixed(0)}%（區間 ${fmtP(m.low52w)} ~ ${fmtP(m.high52w)}）`;
  }

  const summary = [
    `現價 ${fmtP(p)}（${ctx.currency}），當日${ctx.change != null ? `升跌 ${signed(ctx.change)}（${signed(ctx.changePercent, 2)}%）` : '資料暫缺'}。`,
    `走勢方面：${trendText}。${maText}。${posText}。`,
    `成交量能：20 日均成交額約 ${compact(m.turnover20d)}，最新量能比 ${m.volRatio != null ? m.volRatio.toFixed(2) + ' 倍' : '—'}${m.volRatio != null ? (m.volRatio > 1.5 ? '，成交明顯放大、資金關注升溫' : m.volRatio < 0.5 ? '，成交萎縮、市場關注度低' : '') : ''}。`,
  ].join('');

  const keyTrend = [
    { label: '現價', value: fmtP(p), tone: null },
    { label: '當日升跌', value: `${signed(ctx.change)} (${signed(ctx.changePercent, 2)}%)`, tone: tone(ctx.changePercent) },
    { label: '近 1 月', value: pctStr(ret1m), tone: tone(ret1m) },
    { label: '近 3 月', value: pctStr(ret3m), tone: tone(ret3m) },
    { label: '近 6 月', value: pctStr(ret6m), tone: tone(ret6m) },
    { label: '近 1 年', value: pctStr(ret1y), tone: tone(ret1y) },
    { label: '52 週位置', value: pos != null ? `${pos.toFixed(0)}%` : '—', tone: null },
    { label: 'RSI(14)', value: m.rsi14 != null ? m.rsi14.toFixed(1) : '—', tone: m.rsi14 != null ? (m.rsi14 > 70 ? 'up' : m.rsi14 < 30 ? 'down' : null) : null },
  ];
  const keyVolume = [
    { label: '20日成交額', value: compact(m.turnover20d), tone: null },
    { label: '量能比', value: m.volRatio != null ? `${m.volRatio.toFixed(2)}x` : '—', tone: m.volRatio != null ? (m.volRatio > 1.5 ? 'up' : m.volRatio < 0.5 ? 'down' : null) : null },
    { label: '年化波動', value: pctStr(m.vol1y, 0), tone: null },
    { label: '1年最大回撤', value: pctStr(m.mdd1y, 1), tone: 'down' },
    { label: `Beta(對${benchmarkLabel(ctx.market)})`, value: m.beta1y != null ? m.beta1y.toFixed(2) : '—', tone: null },
  ];
  const fin = f || {};
  const keyFin = [
    { label: '市值', value: compact(m.marketCap ?? fin.marketCap), tone: null },
    { label: '本益比(TTM)', value: (m.pe ?? fin.trailingPE) != null ? (m.pe ?? fin.trailingPE).toFixed(2) : '—', tone: null },
    { label: '股價淨值比', value: (m.pb ?? fin.priceToBook) != null ? (m.pb ?? fin.priceToBook).toFixed(2) : '—', tone: null },
    { label: 'ROE', value: pctStr(m.roe ?? fin.returnOnEquity), tone: null },
    { label: '淨利率', value: pctStr(m.profitMargin ?? fin.profitMargin), tone: null },
    { label: '營收成長', value: pctStr(fin.revenueGrowth), tone: tone(fin.revenueGrowth) },
    { label: '盈餘成長', value: pctStr(fin.earningsGrowth), tone: tone(fin.earningsGrowth) },
    { label: '殖利率(近12月)', value: pctStr(m.dividendYieldTTM), tone: null },
    { label: '負債權益比', value: fin.debtToEquity != null ? `${fin.debtToEquity.toFixed(1)}%` : '—', tone: null },
  ].filter((x) => x.value !== '—' || x.label === '市值');

  return { summary, keyTrend, keyVolume, keyFin };
}

async function buildHeatSection({ code, zhName, enName, changePercent, live, market }) {
  const isUs = market === 'us';
  const feed = await getTopNews({ market: isUs ? 'us' : 'all', limit: 60, live }).catch(() => ({ items: [] }));
  const matched = matchNews(feed, code, zhName, enName).slice(0, 8);
  const newsCount = matched.length;

  let turnoverRank = null;
  let poolCount = 0;
  let onEtnet = false;

  if (!isUs) {
    // 港股：成交額排名來自熱門池快照；etnet 二十大成交交叉驗證
    const snap = getSnapshot('popular');
    if (snap?.items) {
      poolCount = snap.items.length;
      const sorted = [...snap.items].sort((a, b) => (b.metrics.turnover20d || 0) - (a.metrics.turnover20d || 0));
      const idx = sorted.findIndex((x) => x.code === code);
      if (idx >= 0) turnoverRank = idx + 1;
    }
    const etnet = await getTopTurnover({ force: live }).catch(() => null);
    if (etnet?.list) {
      onEtnet = etnet.list.some((it) => normCode(it.code || it.sym || '') === normCode(code));
    }
  } else {
    // 美股：成交額排名來自美股異動快照（若已建立）；etnet 僅涵蓋港股，不適用
    try {
      const us = getUsMovers();
      if (us.status === 'ok' && Array.isArray(us.turnover)) {
        const idx = us.turnover.findIndex((x) => x.code === code);
        if (idx >= 0) { turnoverRank = idx + 1; poolCount = us.universe; }
      }
    } catch (e) {
      log.debug('report', '美股快照尚未建立，熱度排名略過', e.message);
    }
  }

  // 關注度信號
  const signals = [];
  if (newsCount > 0) signals.push(`當日熱門要聞中出現 ${newsCount} 則與該股相關的報導`);
  if (turnoverRank != null) signals.push(isUs
    ? `成交額在美股池約 ${poolCount} 檔中排名第 ${turnoverRank}`
    : `成交額在熱門池約 ${poolCount} 檔中排名第 ${turnoverRank}`);
  if (onEtnet) signals.push('入列 etnet 二十大成交，獲市場實質交投關注');

  // 關注度代理評分（0–100）
  let att = 0;
  att += Math.min(newsCount, 5) * 8; // 新聞最多 40
  if (!isUs) {
    const snap = getSnapshot('popular');
    if (snap?.items) {
      const sm = snap.items.find((x) => x.code === code)?.metrics;
      if (sm?.volRatio != null) att += Math.min(Math.max(sm.volRatio, 0), 3) / 3 * 30; // 量能最多 30
      if (turnoverRank != null && poolCount > 1) {
        const ratio = 1 - (turnoverRank - 1) / (poolCount - 1);
        att += ratio * 30; // 排名最多 30
      }
    }
  } else if (turnoverRank != null && poolCount > 1) {
    // 美股無量能比，以成交額排名補權重
    const ratio = 1 - (turnoverRank - 1) / (poolCount - 1);
    att += ratio * 60;
  }
  att = Math.round(Math.min(att, 100));
  const attLevel = att >= 60 ? '高' : att >= 30 ? '中' : '低';

  // 資金流向（代理指標）：以已計算的當日升跌 + 快照量能比推論
  let flowDir = '中性（量價平淡）';
  let flowTone = 'flat';
  const cp = changePercent;
  const volRatio = !isUs ? (getSnapshot('popular')?.items?.find((x) => x.code === code)?.metrics?.volRatio ?? null) : null;
  if (cp != null) {
    if (cp > 0 && (volRatio == null || volRatio >= 1)) { flowDir = '偏多（價漲且量能不弱，買盤主導）'; flowTone = 'up'; }
    else if (cp > 0) { flowDir = '溫和偏多（價漲但量縮，續漲力道待觀察）'; flowTone = 'up'; }
    else if (cp < 0 && (volRatio == null || volRatio >= 1)) { flowDir = '偏空（價跌伴放量，賣壓湧現）'; flowTone = 'down'; }
    else if (cp < 0) { flowDir = '溫和偏空（價跌量縮，承接力道弱）'; flowTone = 'down'; }
  }

  const summary = [
    `新聞曝光：當日聚合要聞中偵測到 ${newsCount} 則與該股直接相關的報導${newsCount === 0 ? '，暫未進入熱門要聞榜，市場話題度偏低' : ''}。`,
    `關注度（代理指標）評級「${attLevel}」（綜合新聞曝光、成交額排名、量能比，滿分 100 得 ${att} 分）。`,
    `資金動能（代理指標）：${flowDir}。${onEtnet ? '該股入列 etnet 二十大成交，屬盤面實質交投焦點。' : ''}`,
    `⚠️ 說明：平台尚無社群聲量與逐筆資金流 API，上述「社群討論量」與「資金流向」係以成交量比、成交額排名、價量關係等交易動能代理推估，非真實資金淨流向或社群聲量，僅供參考。`,
  ].join('');

  return {
    summary,
    newsCount,
    newsItems: matched.map((it) => ({
      title: it.title, source: it.source, market: it.market,
      publishedAt: it.publishedAt, link: it.link,
    })),
    attentionLevel: attLevel,
    attentionScore: att,
    turnoverRank,
    poolCount,
    onEtnet,
    signals,
    market: isUs ? 'us' : 'hk',
    capitalFlow: { direction: flowDir, tone: flowTone },
  };
}

function buildAssessmentSection({ metrics, factors, fs, verdict, code, name, zhName, price, changePercent }) {
  if (!verdict) {
    return {
      available: false,
      note: '歷史資料不足（K 線少於 30 根），無法計算技術指標與綜合決策，建議改以更長區間查詢或暫不評估。',
    };
  }
  const overall = verdict.overall;
  const { action, actTone } = verdictToAction(overall, verdict.confidence);

  const headline = `綜合技術面（${verdict.techScore}）、基本面（${verdict.fundScore}）、風險（${verdict.riskScore}）三維度，整體評分 ${overall} 分，目前建議「${action}」。`;

  // 支持理由：多頭因素 + 強項要素
  const reasons = [];
  (verdict.bullish || []).forEach((b) => reasons.push(`【${b.source}】${b.text}`));
  (fs.strengths || []).slice(0, 3).forEach((s) => {
    if (s.rating.tone === 'up') reasons.push(`基本面強項：${s.factor}（${s.score}/10，${s.rating.label}）— ${(s.signals || []).slice(0, 1).join('')}`);
  });
  if (!reasons.length) reasons.push('目前未偵測到明顯的多頭支持訊號，宜保守看待。');

  // 主要風險：空頭因素 + 風險評級理由 + 弱項
  const risks = [];
  (verdict.bearish || []).forEach((b) => risks.push(`【${b.source}】${b.text}`));
  (verdict.riskReasons || []).slice(0, 3).forEach((r) => risks.push(`風險因子：${r}`));
  (fs.weaknesses || []).slice(0, 2).forEach((s) => {
    if (s.rating.tone === 'down') risks.push(`基本面弱項：${s.factor}（${s.score}/10，${s.rating.label}）— ${(s.signals || []).slice(0, 1).join('')}`);
  });
  if (verdict.confidence === '低') risks.push('基本面關鍵欄位缺漏較多，評估置信度偏低，結論僅供初步參考。');
  if (!risks.length) risks.push('未偵測到顯著風險訊號，但仍須留意大盤與產業系統性風險。');

  // 依 action 給出具體操作語境（非指令）
  let actionNote = '';
  if (action === '買入') actionNote = '若已納入研究範圍，可於風控許可下分批留意進場機會，並以支撐／停損區間控管風險。';
  else if (action === '觀望') actionNote = '建議暫不急於出手，持續追蹤價格對關鍵均線與量能的表態，待訊號更明朗再決定。';
  else actionNote = '目前多項條件偏弱，建議迴避或僅以極小部位觀察，避免承接未明確止穩的跌勢。';

  // 風險回報參考
  const refs = [];
  if (verdict.entryZone?.low != null) refs.push(`參考進場區間 ${fmtP(verdict.entryZone.low)} ~ ${fmtP(verdict.entryZone.high)}`);
  if (verdict.stopLoss != null) refs.push(`參考止蝕 ${fmtP(verdict.stopLoss)}`);
  if (verdict.takeProfit1 != null) refs.push(`目標一 ${fmtP(verdict.takeProfit1)}`);
  if (verdict.riskReward != null) refs.push(`風險回報比 ${verdict.riskReward}`);

  return {
    available: true,
    action,
    tone: actTone,
    overall,
    headline,
    reasons,
    risks,
    confidence: verdict.confidence,
    timeHorizon: verdict.timeHorizon,
    riskLevel: verdict.riskLevel,
    actionNote,
    refs,
    factorSummary: { total: fs.total, percent: fs.percent, label: fs.label },
    layers: (verdict.layers || []).map((l) => ({ label: l.label, percent: l.percent, tone: l.tone })),
    note: '本評估為量化模型輸出之觀察結果，非投資建議；請依自身風險承受度與其他資訊獨立判斷。',
  };
}

function fmtP(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= 100 ? v.toLocaleString('zh-HK', { maximumFractionDigits: 2 }) : v.toFixed(2);
}

export default { buildReport };
