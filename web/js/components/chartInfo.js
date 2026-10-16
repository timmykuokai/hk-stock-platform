/**
 * chartInfo.js — 技术图表解读说明数据
 * 为每个图表提供：说明、图例、数值范围解读
 */

export const chartInfo = {
  bollinger: {
    name: '布林带（Bollinger Bands）',
    desc: '由中轨（MA20）和上下轨（±2标准差）组成的通道，用于判断价格波动区间和超买超卖状态。',
    legend: [
      { color: '#1f2937', label: '收盘价', desc: '实际交易价格' },
      { color: '#f59e0b', label: '中轨 MA20', desc: '20日简单移动平均线，代表中期趋势' },
      { color: '#9333ea', label: '上轨 / 下轨', desc: '中轨 ± 2倍标准差，衡量价格波动范围' },
    ],
    interpretation: [
      { range: '价格触及上轨', signal: '偏热/超买信号', action: '可能面临回调压力，不宜追高' },
      { range: '价格触及下轨', signal: '偏冷/超卖信号', action: '可能出现反弹，关注支撑' },
      { range: '带宽收窄', signal: '波动率下降', action: '可能即将突破，关注方向选择' },
      { range: '带宽扩大', signal: '波动率上升', action: '趋势加速或剧烈震荡，注意风险' },
      { range: '价格在中轨上方', signal: '偏强', action: '中期趋势偏多' },
      { range: '价格在中轨下方', signal: '偏弱', action: '中期趋势偏空' },
    ],
    usage: '主要用来判断价格是否处于极端位置，以及波动率变化。单独使用易受震荡干扰，建议结合其他指标。',
  },
  ma: {
    name: '移动平均线（Moving Averages）',
    desc: '多条均线叠加显示，用于识别趋势方向和支撑阻力位。',
    legend: [
      { color: '#1f2937', label: '收盘价', desc: '当前交易价格' },
      { color: '#f59e0b', label: 'MA5', desc: '5日均线，短期趋势' },
      { color: '#1f5eff', label: 'MA20', desc: '20日均线，中期趋势' },
      { color: '#9333ea', label: 'MA60', desc: '60日均线，长期趋势' },
    ],
    interpretation: [
      { range: '价格 > MA5 > MA20 > MA60', signal: '多头排列', action: '强势上涨趋势，持有为主' },
      { range: '价格 < MA5 < MA20 < MA60', signal: '空头排列', action: '弱势下跌趋势，谨慎观望' },
      { range: '短期均线上穿长期均线', signal: '金叉（买入信号）', action: '可能迎来上涨，关注确认' },
      { range: '短期均线下穿长期均线', signal: '死叉（卖出信号）', action: '可能转跌，考虑减仓' },
      { range: '价格在均线上方', signal: '偏强', action: '均线提供支撑' },
      { range: '价格在均线下方', signal: '偏弱', action: '均线形成压力' },
      { range: '均线纠缠交错', signal: '无明确趋势', action: '震荡市，降低仓位' },
    ],
    usage: '均线系统适合判断中长期趋势，但存在滞后性。短期均线更敏感，长期均线更稳定。',
  },
  volume: {
    name: '成交量（Volume）',
    desc: '显示每日交易数量，红涨绿跌配色，反映市场参与热度。',
    legend: [
      { color: '#d9333f', label: '阳线成交量', desc: '当日收盘价高于开盘价时的成交量' },
      { color: '#0f9960', label: '阴线成交量', desc: '当日收盘价低于开盘价时的成交量' },
    ],
    interpretation: [
      { range: '量增价涨', signal: '健康上涨', action: '上涨得到资金支持，可持续性强' },
      { range: '量增价跌', signal: '警示信号', action: '大量抛压，下跌可能加速' },
      { range: '量缩价涨', signal: '上涨乏力', action: '缺乏新增资金，可能见顶' },
      { range: '量缩价跌', signal: '抛压减轻', action: '下跌动能减弱，可能企稳' },
      { range: '巨量（远超均量）', signal: '异常活跃', action: '关注是否有利好/利空，警惕反转' },
      { range: '地量（远低于均量）', signal: '成交清淡', action: '市场观望情绪浓厚' },
    ],
    usage: '成交量是价格的先行指标，"量在价先"。放量往往预示趋势变化，缩量则可能延续或终结。',
  },
  macd: {
    name: 'MACD（指数平滑异同移动平均线）',
    desc: '由 DIF 线、DEA 线和柱状图组成，用于判断趋势强弱和买卖时机。',
    legend: [
      { color: '#1f5eff', label: 'DIF 快线', desc: 'EMA12 - EMA26，对价格变化更敏感' },
      { color: '#f59e0b', label: 'DEA 慢线', desc: 'DIF 的 9 日 EMA，平滑后的趋势线' },
      { color: '#d9333f', label: '柱状图（正）', desc: 'DIF > DEA，多头动能' },
      { color: '#0f9960', label: '柱状图（负）', desc: 'DIF < DEA，空头动能' },
    ],
    interpretation: [
      { range: 'DIF 上穿 DEA', signal: '黄金交叉', action: '买入信号，短期转强' },
      { range: 'DIF 下穿 DEA', signal: '死亡交叉', action: '卖出信号，短期转弱' },
      { range: '柱状图由负转正', signal: '动能转多', action: '下跌趋势可能结束' },
      { range: '柱状图由正转负', signal: '动能转空', action: '上涨趋势可能结束' },
      { range: '柱状图持续放大', signal: '趋势加强', action: '当前方向动能充沛' },
      { range: '柱状图持续缩小', signal: '趋势减弱', action: '可能即将反转' },
      { range: '零轴上方', signal: '多头市场', action: '偏多操作为主' },
      { range: '零轴下方', signal: '空头市场', action: '偏空操作为主' },
    ],
    usage: 'MACD 是趋势跟踪动量指标，适合判断趋势强度和转折点。在震荡市中易产生假信号。',
  },
  rsi: {
    name: 'RSI（相对强弱指数）',
    desc: '衡量价格变动速度和幅度的震荡指标，范围 0-100，用于判断超买超卖。',
    legend: [
      { color: '#7c3aed', label: 'RSI(14) 线', desc: '14日相对强弱指数' },
      { color: '#d9333f', label: '超买线 70', desc: '超过此值可能超买' },
      { color: '#0f9960', label: '超卖线 30', desc: '低于此值可能超卖' },
    ],
    interpretation: [
      { range: 'RSI > 70', signal: '超买区域', action: '短期涨幅过大，可能回调，不宜追高' },
      { range: 'RSI 60-70', signal: '偏强', action: '上升趋势强劲，但接近超买' },
      { range: 'RSI 40-60', signal: '中性', action: '多空平衡，观望为主' },
      { range: 'RSI 30-40', signal: '偏弱', action: '下降趋势，等待企稳信号' },
      { range: 'RSI < 30', signal: '超卖区域', action: '短期跌幅过大，可能反弹，关注低吸机会' },
      { range: 'RSI 顶背离（价升指降）', signal: '预警信号', action: '上涨动能不足，可能见顶' },
      { range: 'RSI 底背离（价降指升）', signal: '预警信号', action: '下跌动能减弱，可能见底' },
    ],
    usage: 'RSI 最适合震荡市判断顶底，但在强势趋势中可能长时间停留在超买/超卖区。',
  },
  kd: {
    name: 'KD 随机指标',
    desc: '由 K 线（快线）和 D 线（慢线）组成，比 RSI 更敏感，用于判断短期买卖时机。',
    legend: [
      { color: '#1f5eff', label: 'K 线（快线）', desc: '对价格变化反应较快' },
      { color: '#f59e0b', label: 'D 线（慢线）', desc: 'K 线的平滑，反应较缓' },
    ],
    interpretation: [
      { range: 'K > 80 且 D > 80', signal: '严重超买', action: '高度警惕回调风险' },
      { range: 'K < 20 且 D < 20', signal: '严重超卖', action: '可能迎来反弹' },
      { range: 'K 上穿 D（低位）', signal: '金叉买入', action: '短期转强信号' },
      { range: 'K 下穿 D（高位）', signal: '死叉卖出', action: '短期转弱信号' },
      { range: 'K/D 在 50 附近', signal: '中性', action: '趋势不明，观望' },
    ],
    usage: 'KD 指标灵敏但噪音多，适合短线操作。配合 RSI 或趋势指标使用效果更佳。',
  },
  obv: {
    name: 'OBV 能量潮',
    desc: '通过成交量变化推测资金流向，辅助判断价格趋势的真实性和持续性。',
    legend: [
      { color: '#1f5eff', label: 'OBV 线', desc: '累积成交量指标' },
      { color: '#f59e0b', label: 'OBV 均线（MA20）', desc: 'OBV 的 20 日移动平均' },
    ],
    interpretation: [
      { range: 'OBV 上升 + 价格上升', signal: '量价配合', action: '上涨趋势健康，可持续' },
      { range: 'OBV 下降 + 价格下降', signal: '量价配合', action: '下跌趋势健康，可能继续' },
      { range: 'OBV 上升 + 价格横盘/下降', signal: '潜在底部', action: '资金在流入，关注突破机会' },
      { range: 'OBV 下降 + 价格横盘/上升', signal: '潜在顶部', action: '资金在流出，警惕反转' },
      { range: 'OBV 突破前高', signal: '强势信号', action: '资金支持充分，可跟进' },
      { range: 'OBV 跌破前低', signal: '弱势信号', action: '资金撤离，注意风险' },
    ],
    usage: 'OBV 是先行指标，常能提前预示价格转折。配合价格背驰分析效果显著。',
  },
  mfi: {
    name: 'MFI 资金流量指数',
    desc: '结合价格和成交量的 RSI 变体，范围 0-100，综合考虑买卖力量。',
    legend: [
      { color: '#7c3aed', label: 'MFI 线', desc: '资金流量指数' },
      { color: '#d9333f', label: '超买线 80', desc: '资金过度涌入，警惕回调' },
      { color: '#0f9960', label: '超卖线 20', desc: '资金过度流出，关注反弹' },
    ],
    interpretation: [
      { range: 'MFI > 80', signal: '超买', action: '资金过度涌入，可能过热' },
      { range: 'MFI 60-80', signal: '偏强', action: '资金流入明显，趋势向上' },
      { range: 'MFI 40-60', signal: '中性', action: '多空平衡，震荡市' },
      { range: 'MFI 20-40', signal: '偏弱', action: '资金流出，趋势向下' },
      { range: 'MFI < 20', signal: '超卖', action: '资金过度流出，可能见底' },
      { range: 'MFI 顶背离', signal: '预警', action: '价格上涨但资金流出，警惕反转' },
      { range: 'MFI 底背离', signal: '预警', action: '价格下跌但资金流入，关注反弹' },
    ],
    usage: 'MFI 比 RSI 加入了成交量因素，信号更可靠。适合判断资金流向和趋势强度。',
  },
  adx: {
    name: 'ADX 趋势强度指数',
    desc: '衡量趋势强度而非方向，数值越高表示趋势越强。辅助判断是否适合趋势策略。',
    legend: [
      { color: '#1f5eff', label: 'ADX(14) 线', desc: '趋势强度指标' },
      { color: '#d97706', label: '参考线 25', desc: '强趋势与弱趋势的分界' },
    ],
    interpretation: [
      { range: 'ADX > 50', signal: '强趋势', action: '趋势明确，适合趋势跟踪策略' },
      { range: 'ADX 25-50', signal: '中等趋势', action: '有一定趋势性，可适度操作' },
      { range: 'ADX < 25', signal: '弱趋势/盘整', action: '无明显趋势，宜用震荡策略' },
      { range: 'ADX 上升', signal: '趋势加强', action: '当前方向动能增强' },
      { range: 'ADX 下降', signal: '趋势减弱', action: '可能进入盘整，降低仓位' },
      { range: 'ADX 从低位回升突破 25', signal: '趋势启动', action: '关注新趋势形成' },
    ],
    usage: 'ADX 只告诉你"有多强的趋势"，不告诉你"趋势方向"。需配合其他指标判断多空。',
  },
  cci: {
    name: 'CCI 顺势指标',
    desc: '衡量价格偏离统计平均值的程度，无固定边界，用于判断超买超卖和趋势反转。',
    legend: [
      { color: '#1f5eff', label: 'CCI 线', desc: '顺势指标' },
      { color: '#d9333f', label: '参考线 +100', desc: '超买区域边界' },
      { color: '#0f9960', label: '参考线 -100', desc: '超卖区域边界' },
    ],
    interpretation: [
      { range: 'CCI > +100', signal: '超买/强势', action: '价格异常偏高，警惕回调' },
      { range: 'CCI 0 到 +100', signal: '偏强', action: '上升趋势中，可持有' },
      { range: 'CCI -100 到 0', signal: '偏弱', action: '下降趋势中，谨慎操作' },
      { range: 'CCI < -100', signal: '超卖/弱势', action: '价格异常偏低，关注反弹' },
      { range: 'CCI 上穿 +100', signal: '强势启动', action: '可能开启单边上涨' },
      { range: 'CCI 下穿 -100', signal: '弱势启动', action: '可能开启单边下跌' },
      { range: 'CCI 从高位回落', signal: '动能衰减', action: '上涨可能终结' },
    ],
    usage: 'CCI 无固定边界，极端值参考意义大于绝对值。适合判断趋势启动和反转点。',
  },
  bias: {
    name: 'BIAS 乖离率',
    desc: '衡量收盘价与移动平均线的偏离程度，用于判断价格是否过度偏离趋势。',
    legend: [
      { color: '#1f5eff', label: 'BIAS(6)', desc: '短期乖离率' },
      { color: '#f59e0b', label: 'BIAS(12)', desc: '中期乖离率' },
      { color: '#9333ea', label: 'BIAS(24)', desc: '长期乖离率' },
    ],
    interpretation: [
      { range: 'BIAS 显著为正', signal: '超买', action: '价格远离均线，可能回调' },
      { range: 'BIAS 显著为负', signal: '超卖', action: '价格远低于均线，可能反弹' },
      { range: 'BIAS 接近零', signal: '中性', action: '价格在均线附近，趋势不明' },
      { range: '短期 BIAS > 长期 BIAS', signal: '短期强势', action: '近期动能较强' },
      { range: '短期 BIAS < 长期 BIAS', signal: '短期弱势', action: '近期动能较弱' },
    ],
    usage: '乖离率适合判断价格偏离程度，但不指示趋势方向。极端值出现时关注回归。',
  },
  atr: {
    name: 'ATR 平均真实波幅',
    desc: '衡量价格波动幅度，用于设置止损位和评估风险水平，不指示方向。',
    legend: [
      { color: '#0ea5e9', label: 'ATR(14) 线', desc: '14日平均真实波幅' },
    ],
    interpretation: [
      { range: 'ATR 上升', signal: '波动加大', action: '风险增加，调整止损幅度' },
      { range: 'ATR 下降', signal: '波动收敛', action: '风险降低，市场趋于平静' },
      { range: 'ATR 处于高位', signal: '高波动', action: '适合短线交易，风险控制优先' },
      { range: 'ATR 处于低位', signal: '低波动', action: '可能即将突破，关注方向' },
      { range: 'ATR 突然 spike', signal: '异常波动', action: '可能有重要消息，警惕' },
    ],
    usage: 'ATR 是风险管理工具而非趋势工具。常用于计算止损距离（如 2×ATR）。',
  },
  drawdown: {
    name: '回撤曲线',
    desc: '显示投资组合从历史高点回落的最大幅度，衡量投资风险和恢复能力。',
    legend: [
      { color: '#d9333f', label: '回撤曲线', desc: '当前回撤幅度（0%=-最高点，向下为负）' },
    ],
    interpretation: [
      { range: '回撤 = 0%', signal: '创历史新高', action: '当前处于最佳持仓状态' },
      { range: '回撤 < 10%', signal: '轻度回撤', action: '风险可控，正常波动' },
      { range: '回撤 10-20%', signal: '中度回撤', action: '需关注，检查持仓逻辑' },
      { range: '回撤 > 20%', signal: '深度回撤', action: '风险较高，考虑减仓' },
      { range: '回撤持续扩大', signal: '趋势走弱', action: '可能进入下行趋势' },
      { range: '回撤从低点回升', signal: '恢复中', action: '下跌动能减弱' },
    ],
    usage: '回撤是衡量风险的核心指标。最大回撤超过 30% 的股票需要特别谨慎。',
  },
  donchian: {
    name: '唐奇安通道',
    desc: '显示一段时间内的最高价和最低价通道，用于判断突破和趋势延续。',
    legend: [
      { color: '#1f2937', label: '收盘价', desc: '实际交易价格' },
      { color: '#1f5eff', label: '上轨', desc: 'N 日最高价，突破信号' },
      { color: '#0f9960', label: '下轨', desc: 'N 日最低价，支撑信号' },
    ],
    interpretation: [
      { range: '价格突破上轨', signal: '向上突破', action: '可能开启上涨趋势，可跟进' },
      { range: '价格跌破下轨', signal: '向下突破', action: '可能开启下跌趋势，减仓' },
      { range: '价格在上轨附近', signal: '强势', action: '接近阻力，关注突破' },
      { range: '价格在下轨附近', signal: '弱势', action: '接近支撑，关注反弹' },
      { range: '通道收窄', signal: '即将突破', action: '波动率下降，关注方向选择' },
      { range: '通道扩大', signal: '趋势加速', action: '波动加大，趋势确立' },
    ],
    usage: '唐奇安通道是经典的突破策略工具，适合捕捉趋势启动点。',
  },
};

/** 获取指定图表的说明数据 */
export function getChartInfo(chartName) {
  return chartInfo[chartName] || null;
}

/** 图例颜色映射（与各图表组件保持一致） */
export const COLORS = {
  up: '#d9333f',       // 涨：红
  down: '#0f9960',     // 跌：绿
  accent: '#1f5eff',   // 强调：蓝
  warn: '#f59e0b',     // 警告：橙
  purple: '#9333ea',   // 紫色
  dark: '#1f2937',     // 深色
  cyan: '#0ea5e9',     // 青色
  rsi: '#7c3aed',      // RSI 紫
};
