/**
 * factors.js — 港股「十大分析要素」評分模型。
 *
 * 移植自原 Python 版 analyse_hk_10_factors，並做三點改良：
 *   1. 資料缺失不給懲罰分（只記錄「數據不可用」），避免缺料被誤判為體質差
 *   2. 每個要素都回傳 signals（判斷依據），讓使用者能看到「為什麼給這個分數」
 *   3. 額外輸出四層決策框架的分層彙總
 *
 * 每項 0–10 分，合計 100 分。
 */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const money = (v) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}兆`;
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}億`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(2)}萬`;
  return `${sign}${abs.toFixed(0)}`;
};
const clamp = (v) => Math.max(0, Math.min(10, v));

function ratingOf(score) {
  if (score >= 8) return { label: '優秀', tone: 'up' };
  if (score >= 6) return { label: '良好', tone: 'up' };
  if (score >= 4) return { label: '中性', tone: 'flat' };
  if (score >= 2) return { label: '偏弱', tone: 'down' };
  return { label: '警示', tone: 'down' };
}

const SECTOR_ZH = {
  Technology: '科技', 'Consumer Cyclical': '消費週期', 'Consumer Defensive': '消費防守',
  'Communication Services': '通訊服務', Healthcare: '醫療保健', Industrials: '工業',
  'Financial Services': '金融服務', Utilities: '公用事業', 'Real Estate': '地產',
  'Basic Materials': '原材料', Energy: '能源',
};

const GROWTH_SECTORS = new Set(['Technology', 'Consumer Cyclical', 'Communication Services', 'Healthcare', 'Industrials']);
const DEFENSIVE_SECTORS = new Set(['Utilities', 'Consumer Defensive', 'Financial Services']);
const CYCLICAL_SECTORS = new Set(['Real Estate', 'Basic Materials', 'Energy']);

/**
 * @param {{metrics:object, fundamentals:object, indicators:object}} input
 * @returns {Array<{no:number,key:string,factor:string,short:string,score:number,maxScore:number,signals:string[],rating:object}>}
 */
export function analyseTenFactors({ metrics = {}, fundamentals = {}, indicators = null } = {}) {
  const L = indicators?.latest ?? {};
  const m = metrics;
  const f = fundamentals;
  const price = m.price ?? L.close ?? null;
  const factors = [];
  const add = (no, key, factor, short, score, signals) => {
    const s = clamp(Math.round(score * 10) / 10);
    factors.push({ no, key, factor, short, score: s, maxScore: 10, signals, rating: ratingOf(s) });
  };

  /* ── 1. 行業前景與政策環境 ───────────────────────────── */
  {
    const sector = f.sector ?? null;
    const industry = f.industry ?? null;
    const rg = num(f.revenueGrowth);
    const eg = num(f.earningsGrowth);
    const sig = [];
    let s = 5;
    if (sector) {
      sig.push(`行業：${sector}${SECTOR_ZH[sector] ? `（${SECTOR_ZH[sector]}）` : ''}${industry ? ` / ${industry}` : ''}`);
      if (GROWTH_SECTORS.has(sector)) { s = 7; sig.push('成長型行業，政策支持潛力較高'); }
      else if (DEFENSIVE_SECTORS.has(sector)) { s = 6; sig.push('防守型行業，收益與現金流相對穩定'); }
      else if (CYCLICAL_SECTORS.has(sector)) { s = 4; sig.push('強週期行業，需留意景氣循環位置'); }
      else sig.push('行業分類特殊，政策方向宜另行查證');
    } else {
      sig.push('行業資料不可用（未載入基本面）');
    }
    if (rg != null) {
      sig.push(`營收成長 ${pct(rg)}`);
      if (rg > 0.15) { s += 2; sig.push('營收成長強勁'); }
      else if (rg < -0.05) { s -= 2; sig.push('營收負成長，產業需求轉弱'); }
    }
    if (eg != null) sig.push(`盈餘成長 ${pct(eg)}`);
    add(1, 'industry', '行業前景與政策環境', '行業前景', s, sig);
  }

  /* ── 2. 公司商業模式 ─────────────────────────────────── */
  {
    const gm = num(f.grossMargin);
    const om = num(f.operatingMargin);
    const pm = num(m.profitMargin ?? f.profitMargin);
    const sig = [];
    let s = 5;
    if (gm != null) {
      if (gm > 0.5) { s += 2; sig.push(`毛利率 ${pct(gm)}，護城河較深`); }
      else if (gm > 0.3) { s += 1; sig.push(`毛利率 ${pct(gm)}`); }
      else { s -= 1; sig.push(`毛利率 ${pct(gm)}，競爭壓力較大`); }
    } else sig.push('毛利率資料不可用');
    if (om != null) {
      if (om > 0.2) { s += 2; sig.push(`營業利益率 ${pct(om)}，營運效率高`); }
      else if (om > 0.1) { s += 1; sig.push(`營業利益率 ${pct(om)}`); }
      else if (om < 0) { s -= 2; sig.push(`營業虧損 ${pct(om)}，商業模式存疑`); }
    } else sig.push('營業利益率資料不可用');
    if (pm != null) sig.push(`淨利率 ${pct(pm)}`);
    add(2, 'business', '公司商業模式', '商業模式', s, sig);
  }

  /* ── 3. 財務健康程度 ─────────────────────────────────── */
  {
    const d2e = num(f.debtToEquity);
    const cr = num(f.currentRatio);
    const qr = num(f.quickRatio);
    const cash = num(f.totalCash);
    const debt = num(f.totalDebt);
    const sig = [];
    let s = 5;
    if (d2e != null) {
      if (d2e < 30) { s += 2; sig.push(`負債比 ${d2e.toFixed(1)}%，財務穩健`); }
      else if (d2e < 80) { s += 1; sig.push(`負債比 ${d2e.toFixed(1)}%，尚可接受`); }
      else if (d2e < 150) { s -= 1; sig.push(`負債比 ${d2e.toFixed(1)}%，需持續觀察`); }
      else { s -= 3; sig.push(`負債比 ${d2e.toFixed(1)}%，財務槓桿偏高`); }
    } else sig.push('負債比資料不可用');
    if (cr != null) {
      if (cr > 2) { s += 2; sig.push(`流動比率 ${cr.toFixed(2)}，短期償債能力強`); }
      else if (cr > 1) { s += 1; sig.push(`流動比率 ${cr.toFixed(2)}`); }
      else { s -= 2; sig.push(`流動比率 ${cr.toFixed(2)}，短期流動性風險`); }
    } else sig.push('流動比率資料不可用');
    if (qr != null) sig.push(`速動比率 ${qr.toFixed(2)}`);
    if (cash != null && debt != null) {
      const net = cash - debt;
      sig.push(`現金 ${money(cash)} / 負債 ${money(debt)}，淨${net >= 0 ? '現金' : '負債'} ${money(Math.abs(net))}`);
    }
    add(3, 'financial', '財務健康程度', '財務健康', s, sig);
  }

  /* ── 4. 盈利能力與質素 ───────────────────────────────── */
  {
    const roe = num(m.roe ?? f.returnOnEquity);
    const roa = num(m.roa ?? f.returnOnAssets);
    const pm = num(m.profitMargin ?? f.profitMargin);
    const sig = [];
    let s = 5;
    if (roe != null) {
      if (roe > 0.2) { s += 3; sig.push(`ROE ${pct(roe)}，股東回報優秀`); }
      else if (roe > 0.12) { s += 2; sig.push(`ROE ${pct(roe)}，回報良好`); }
      else if (roe > 0.05) { s += 1; sig.push(`ROE ${pct(roe)}`); }
      else if (roe < 0) { s -= 3; sig.push(`ROE ${pct(roe)}，處於虧損`); }
      else sig.push(`ROE ${pct(roe)}偏低`);
    } else sig.push('ROE 資料不可用');
    if (roa != null) {
      sig.push(`ROA ${pct(roa)}`);
      if (roa > 0.1) { s += 1; sig.push('資產回報率高'); }
      else if (roa < 0) s -= 1;
    } else sig.push('ROA 資料不可用');
    if (pm != null) {
      if (pm > 0.15) sig.push(`淨利率 ${pct(pm)}，獲利體質佳`);
      else if (pm < 0) { s -= 1; sig.push(`淨虧損 ${pct(pm)}`); }
    }
    add(4, 'profitability', '盈利能力與質素', '盈利能力', s, sig);
  }

  /* ── 5. 現金流 ───────────────────────────────────────── */
  {
    const ocf = num(f.operatingCashflow);
    const fcf = num(f.freeCashflow);
    const mc = num(m.marketCap ?? f.marketCap);
    const sig = [];
    let s = 5;
    if (ocf != null) {
      sig.push(`營運現金流 ${money(ocf)}`);
      if (ocf > 0) { s += 2; sig.push('營運現金流為正，現金生成能力佳'); }
      else { s -= 2; sig.push('營運現金流為負，需留意現金消耗'); }
    } else sig.push('營運現金流資料不可用');
    if (fcf != null) {
      sig.push(`自由現金流 ${money(fcf)}`);
      if (fcf > 0) {
        s += 2;
        sig.push('自由現金流為正，具持續派息潛力');
        if (mc && mc > 0) {
          const y = fcf / mc;
          sig.push(`FCF 殖利率 ${pct(y, 2)}`);
          if (y > 0.05) { s += 1; sig.push('FCF 殖利率高，現金回報具吸引力'); }
        }
      } else { s -= 1; sig.push('自由現金流為負，留意資本支出壓力'); }
    } else sig.push('自由現金流資料不可用');
    add(5, 'cashflow', '現金流', '現金流', s, sig);
  }

  /* ── 6. 估值是否合理 ─────────────────────────────────── */
  {
    const pe = num(m.pe ?? f.trailingPE);
    const fpe = num(m.forwardPe ?? f.forwardPE);
    const pb = num(m.pb ?? f.priceToBook);
    const ev = num(f.enterpriseToEbitda);
    const peg = num(f.pegRatio);
    const ps = num(f.priceToSales);
    const sig = [];
    let s = 5;
    if (pe != null && pe > 0) {
      if (pe < 8) { s += 3; sig.push(`本益比 ${pe.toFixed(1)} 倍，評價偏低`); }
      else if (pe < 15) { s += 2; sig.push(`本益比 ${pe.toFixed(1)} 倍，相對合理`); }
      else if (pe < 25) { s += 1; sig.push(`本益比 ${pe.toFixed(1)} 倍`); }
      else if (pe < 40) { s -= 1; sig.push(`本益比 ${pe.toFixed(1)} 倍，評價偏高`); }
      else { s -= 2; sig.push(`本益比 ${pe.toFixed(1)} 倍，評價風險大`); }
    } else sig.push('本益比不可用或為負（虧損）');
    if (pb != null && pb > 0) {
      if (pb < 1) { s += 2; sig.push(`股價淨值比 ${pb.toFixed(2)} 倍，低於帳面值`); }
      else if (pb < 2) { s += 1; sig.push(`股價淨值比 ${pb.toFixed(2)} 倍`); }
      else if (pb > 5) { s -= 1; sig.push(`股價淨值比 ${pb.toFixed(2)} 倍，偏高`); }
    } else sig.push('股價淨值比資料不可用');
    if (fpe != null && fpe > 0) sig.push(`預估本益比 ${fpe.toFixed(1)} 倍`);
    if (ev != null && ev > 0) sig.push(`EV/EBITDA ${ev.toFixed(1)} 倍${ev < 12 ? '（合理）' : ev > 20 ? '（偏高）' : ''}`);
    if (peg != null && peg > 0) sig.push(`PEG ${peg.toFixed(2)}${peg < 1 ? '（成長被低估）' : peg > 2 ? '（成長溢價高）' : ''}`);
    if (ps != null && ps > 0) sig.push(`股價營收比 ${ps.toFixed(2)} 倍`);
    add(6, 'valuation', '估值是否合理', '估值', s, sig);
  }

  /* ── 7. 管理層與股東結構 ─────────────────────────────── */
  {
    const ins = num(f.heldPercentInsiders);
    const inst = num(f.heldPercentInstitutions);
    const sig = [];
    let s = 5;
    if (ins != null) {
      if (ins > 0.3) { s += 2; sig.push(`內部人／大股東持股 ${pct(ins)}，利益與股東一致`); }
      else if (ins > 0.1) { s += 1; sig.push(`內部人持股 ${pct(ins)}`); }
      else if (ins < 0.02) { s -= 1; sig.push(`內部人持股僅 ${pct(ins, 2)}，需留意`); }
      else sig.push(`內部人持股 ${pct(ins)}`);
    } else sig.push('內部人持股資料不可用');
    if (inst != null) {
      sig.push(`機構持股 ${pct(inst)}`);
      if (inst > 0.5) { s += 1; sig.push('機構認可度高'); }
    } else sig.push('機構持股資料不可用');
    sig.push('提醒：宜另行查核股權攤薄、關連交易與高層異動');
    add(7, 'governance', '管理層與股東結構', '管理層', s, sig);
  }

  /* ── 8. 股息政策 ─────────────────────────────────────── */
  {
    const dy = num(m.dividendYieldTTM);
    const dyn = num(f.dividendYield);
    const payout = num(f.payoutRatio);
    const y5 = num(f.fiveYearAvgDividendYield);
    const years = m.dividendYears ?? 0;
    const dividend = dy ?? dyn;
    const sig = [];
    let s = 5;
    if (dividend != null && dividend > 0) {
      if (dividend > 0.06) { s += 3; sig.push(`殖利率 ${pct(dividend, 2)}，高息防守性強`); }
      else if (dividend > 0.04) { s += 2; sig.push(`殖利率 ${pct(dividend, 2)}，配息良好`); }
      else if (dividend > 0.02) { s += 1; sig.push(`殖利率 ${pct(dividend, 2)}`); }
      else sig.push(`殖利率 ${pct(dividend, 2)}，偏低`);
      if (dividend === dy) sig.push('（以近 12 個月實際除息計算）');
    } else {
      s -= 1;
      sig.push('無股息紀錄或資料不可用');
    }
    if (years > 0) {
      sig.push(`近 ${years} 個年度有配息紀錄`);
      if (years >= 5) { s += 1; sig.push('配息連續性佳'); }
    }
    if (payout != null) {
      if (payout > 0.2 && payout < 0.7) { s += 1; sig.push(`派息率 ${pct(payout)}，具持續性`); }
      else if (payout > 1) { s -= 2; sig.push(`派息率 ${pct(payout)}，超過盈利，難以持續`); }
      else sig.push(`派息率 ${pct(payout)}`);
    }
    if (y5 != null) sig.push(`五年平均股息率 ${y5.toFixed(2)}%`);
    add(8, 'dividend', '股息政策', '股息', s, sig);
  }

  /* ── 9. 技術面與市場行為 ─────────────────────────────── */
  {
    const sig = [];
    let s = 5;
    if (L.date) {
      const ma20 = num(L.ma20);
      const ma50 = num(L.ma50);
      const r14 = num(L.rsi14);
      const a14 = num(L.adx14);
      if (price != null && ma20 && ma50) {
        if (price > ma20 && ma20 > ma50) { s += 2; sig.push('短中期均線多頭排列，趨勢向好'); }
        else if (price < ma20 && ma20 < ma50) { s -= 2; sig.push('均線空頭排列，趨勢偏淡'); }
        else sig.push('均線交錯，方向待確認');
      }
      if (r14 != null) {
        if (r14 < 30) { s += 2; sig.push(`RSI ${r14.toFixed(1)} 超賣，技術性反彈機會`); }
        else if (r14 > 70) { s -= 1; sig.push(`RSI ${r14.toFixed(1)} 超買，短線回檔風險`); }
        else sig.push(`RSI ${r14.toFixed(1)} 中性`);
      }
      if (a14 != null) sig.push(`ADX ${a14.toFixed(1)}，${a14 > 25 ? '趨勢明確' : '區間震盪'}`);
      if (L.volRatio) {
        sig.push(`量能 ${L.volRatio.toFixed(2)} 倍（對 20 日均量）`);
        if (L.volRatio > 1.5) sig.push('成交量放大，資金關注度升溫');
        else if (L.volRatio < 0.5) sig.push('成交量萎縮，市場關注度低');
      }
      if (L.position52w != null) {
        sig.push(`52 週相對位置 ${L.position52w.toFixed(0)}%`);
        if (L.position52w < 20) { s += 1; sig.push('接近 52 週低位，留意逆向機會與基本面是否惡化'); }
        else if (L.position52w > 80) { s -= 1; sig.push('接近 52 週高位，追高風險上升'); }
      }
      if (L.macd != null && L.macdSignal != null) {
        sig.push(L.macd > L.macdSignal ? 'MACD 金叉（短線動能轉強）' : 'MACD 死叉（短線動能轉弱）');
      }
    } else {
      sig.push('技術指標資料不足');
    }
    add(9, 'technical', '技術面與市場行為', '技術面', s, sig);
  }

  /* ── 10. 風險因素與最壞情境 ──────────────────────────── */
  {
    const beta = num(m.betaReported ?? f.beta ?? m.beta1y);
    const atrPct = num(m.atrPct ?? L.atrPct);
    const hi = num(m.high52w ?? L.high52w);
    const lo = num(m.low52w ?? L.low52w);
    const vol = num(m.vol1y);
    const sig = [];
    let s = 5; // 分數越高＝風險越低
    if (atrPct != null) {
      if (atrPct < 1.5) { s += 2; sig.push(`ATR 佔股價 ${atrPct.toFixed(2)}%，波動溫和`); }
      else if (atrPct < 3) { s += 1; sig.push(`ATR 佔股價 ${atrPct.toFixed(2)}%，波動中等`); }
      else { s -= 2; sig.push(`ATR 佔股價 ${atrPct.toFixed(2)}%，波動偏高`); }
    }
    if (beta != null) {
      if (beta < 0.6) { s += 2; sig.push(`Beta ${beta.toFixed(2)}，防守型`); }
      else if (beta < 1) { s += 1; sig.push(`Beta ${beta.toFixed(2)}，低於大市`); }
      else if (beta < 1.5) sig.push(`Beta ${beta.toFixed(2)}，與大市同步偏高`);
      else { s -= 2; sig.push(`Beta ${beta.toFixed(2)}，波動劇烈`); }
    } else sig.push('Beta 資料不可用');
    if (vol != null) sig.push(`年化波動度 ${pct(vol, 0)}`);
    if (m.mdd1y != null) sig.push(`一年最大回撤 ${pct(m.mdd1y, 1)}`);
    if (price != null && lo != null && lo > 0) {
      const downside = (price - lo) / price;
      sig.push(`若回跌至 52 週低點，潛在跌幅 ${pct(downside, 1)}`);
      if (downside > 0.5) { s -= 1; sig.push('下行空間大，需嚴設風險界線'); }
      else if (downside < 0.15) { s += 1; sig.push('距低點不遠，下行空間相對有限'); }
    }
    sig.push('提醒：應預設最壞情境（如獲利下修三成）並設定風險承受上限');
    add(10, 'risk', '風險因素與最壞情境', '風險', s, sig);
  }

  return factors;
}

/** 四層決策框架：把十大要素歸類成四個決策層次 */
export function fourLayerFramework(factors) {
  const byKey = Object.fromEntries(factors.map((f) => [f.key, f]));
  const defs = [
    { key: 'industry', label: '第一層：產業與政策', desc: '先看賽道是否值得投入', keys: ['industry'] },
    { key: 'fundamental', label: '第二層：基本面與財務', desc: '再看公司是否賺得到錢', keys: ['business', 'financial', 'profitability', 'cashflow'] },
    { key: 'valuation', label: '第三層：估值與回報', desc: '價格是否值得付出', keys: ['valuation', 'governance', 'dividend'] },
    { key: 'timing', label: '第四層：風險與進場時機', desc: '何時下手、承擔多少風險', keys: ['technical', 'risk'] },
  ];
  return defs.map((d) => {
    const list = d.keys.map((k) => byKey[k]).filter(Boolean);
    const score = list.reduce((s, f) => s + f.score, 0);
    const max = list.reduce((s, f) => s + f.maxScore, 0);
    const p = max ? (score / max) * 100 : 0;
    return {
      key: d.key, label: d.label, desc: d.desc, score: Math.round(score * 10) / 10, max, percent: Math.round(p * 10) / 10,
      tone: p >= 70 ? 'up' : p >= 45 ? 'flat' : 'down',
      keys: d.keys,
    };
  });
}

export function factorSummary(factors) {
  const total = factors.reduce((s, f) => s + f.score, 0);
  const max = factors.reduce((s, f) => s + f.maxScore, 0);
  const percent = max ? (total / max) * 100 : 0;
  let label = '高風險，暫不宜';
  let tone = 'down';
  if (percent >= 75) { label = '體質強健，值得追蹤'; tone = 'up'; }
  else if (percent >= 60) { label = '體質良好，值得留意'; tone = 'up'; }
  else if (percent >= 45) { label = '中性，需更多佐證'; tone = 'flat'; }
  else if (percent >= 30) { label = '偏弱，宜審慎'; tone = 'down'; }
  return {
    total: Math.round(total * 10) / 10,
    max,
    percent: Math.round(percent * 10) / 10,
    label, tone,
    strengths: [...factors].sort((a, b) => b.score - a.score).slice(0, 3),
    weaknesses: [...factors].sort((a, b) => a.score - b.score).slice(0, 3),
  };
}

export default { analyseTenFactors, fourLayerFramework, factorSummary };
