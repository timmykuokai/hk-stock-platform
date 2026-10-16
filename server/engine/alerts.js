/**
 * alerts.js — 警報規則引擎（純邏輯 + 檔案儲存）。
 * 規則類型：
 *   price_above / price_below      ：股價突破
 *   change_pct                     ：單日漲跌幅絕對值超過
 *   yield_above                    ：殖利率高於
 *   vol_above                      ：年化波動度高於
 *   turnover_above                 ：20日均成交額高於
 *   score_below / score_above      ：評分門檻
 *   rsi_above / rsi_below          ：RSI 門檻
 *   ma_below                       ：跌破指定均線（20/50/200）
 *   drawdown_below                 ：一年回撤超過
 */
import path from 'node:path';
import { norm } from '../lib/code.js';                 // 代號正規化單一來源
import { readJson, writeJson } from '../lib/store.js'; // JSON 讀寫單一來源
import { STORE_DIR, ensureDirs } from '../lib/paths.js';

ensureDirs();
const RULES_FILE = path.join(STORE_DIR, 'alerts.json');
const LOG_FILE = path.join(STORE_DIR, 'alerts-log.json');

export const RULE_TYPES = [
  { type: 'price_above', label: '股價突破（高於）', params: ['threshold'], unit: 'HKD' },
  { type: 'price_below', label: '股價跌破（低於）', params: ['threshold'], unit: 'HKD' },
  { type: 'change_pct', label: '單日漲跌幅超過', params: ['threshold'], unit: '%(絕對值)' },
  { type: 'yield_above', label: '殖利率高於', params: ['threshold'], unit: '%' },
  { type: 'vol_above', label: '年化波動度高於', params: ['threshold'], unit: '%' },
  { type: 'turnover_above', label: '20日均成交額高於', params: ['threshold'], unit: 'HKD' },
  { type: 'score_below', label: '評分低於', params: ['threshold'], unit: '分' },
  { type: 'score_above', label: '評分高於', params: ['threshold'], unit: '分' },
  { type: 'rsi_above', label: 'RSI 高於', params: ['threshold'], unit: '' },
  { type: 'rsi_below', label: 'RSI 低於', params: ['threshold'], unit: '' },
  { type: 'ma_below', label: '跌破均線', params: ['period'], unit: '日' },
  { type: 'drawdown_below', label: '一年回撤超過', params: ['threshold'], unit: '%' },
];

export const rules = {
  list: () => readJson(RULES_FILE, []),
  save: (list) => writeJson(RULES_FILE, list),
  add: (rule) => {
    const list = rules.list();
    const r = {
      id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastTriggered: null,
      ...rule,
    };
    if (r.code) r.code = norm(r.code);
    list.push(r);
    rules.save(list);
    return r;
  },
  update: (id, patch) => {
    const list = rules.list();
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    if (patch.code) list[i].code = norm(patch.code);
    rules.save(list);
    return list[i];
  },
  remove: (id) => rules.save(rules.list().filter((r) => r.id !== id)),
};

export const alertLog = {
  list: () => readJson(LOG_FILE, []),
  push: (events) => {
    const list = rules.list();
    const log = alertLog.list();
    for (const e of events) {
      const r = list.find((x) => x.id === e.ruleId);
      if (r) { r.lastTriggered = e.at; }
    }
    rules.save(list);
    const merged = [...events, ...log].slice(0, 300);
    writeJson(LOG_FILE, merged);
    return merged;
  },
  clear: () => writeJson(LOG_FILE, []),
};

/**
 * 評估單一規則
 * @param {object} rule
 * @param {{metrics?:object, quote?:object, score?:number}} data
 * @returns {null|{message:string, value:number|null}}
 */
export function evaluateRule(rule, data) {
  const m = data.metrics || {};
  const q = data.quote || {};
  const price = q.price ?? m.price ?? null;
  const p = rule.params || {};
  const th = Number(p.threshold ?? p.value);

  switch (rule.type) {
    case 'price_above':
      return price != null && price > th ? { message: `股價 ${fmt(price)} 高於 ${fmt(th)}`, value: price } : null;
    case 'price_below':
      return price != null && price < th ? { message: `股價 ${fmt(price)} 低於 ${fmt(th)}`, value: price } : null;
    case 'change_pct': {
      const c = Math.abs(q.changePercent ?? m.changePercent ?? 0);
      return c > th ? { message: `單日變動 ${c.toFixed(2)}% 超過 ${th}%`, value: c } : null;
    }
    case 'yield_above': {
      const y = m.dividendYieldTTM != null ? m.dividendYieldTTM * 100 : null;
      return y != null && y > th ? { message: `殖利率 ${y.toFixed(2)}% 高於 ${th}%`, value: y } : null;
    }
    case 'vol_above': {
      const v = m.vol1y != null ? m.vol1y * 100 : null;
      return v != null && v > th ? { message: `年化波動度 ${v.toFixed(1)}% 高於 ${th}%`, value: v } : null;
    }
    case 'turnover_above': {
      const t = m.turnover20d;
      return t != null && t > th ? { message: `20日均成交額 ${compact(t)} 高於 ${compact(th)}`, value: t } : null;
    }
    case 'score_below':
      return data.score != null && data.score < th ? { message: `評分 ${data.score} 低於 ${th}`, value: data.score } : null;
    case 'score_above':
      return data.score != null && data.score > th ? { message: `評分 ${data.score} 高於 ${th}`, value: data.score } : null;
    case 'rsi_above':
      return m.rsi14 != null && m.rsi14 > th ? { message: `RSI ${m.rsi14.toFixed(1)} 高於 ${th}`, value: m.rsi14 } : null;
    case 'rsi_below':
      return m.rsi14 != null && m.rsi14 < th ? { message: `RSI ${m.rsi14.toFixed(1)} 低於 ${th}`, value: m.rsi14 } : null;
    case 'ma_below': {
      const period = Number(p.period || 50);
      const ma = m[`ma${period}`];
      return price != null && ma != null && price < ma
        ? { message: `股價 ${fmt(price)} 跌破 ${period} 日均線 ${fmt(ma)}`, value: price }
        : null;
    }
    case 'drawdown_below': {
      const d = m.mdd1y != null ? Math.abs(m.mdd1y) * 100 : null;
      return d != null && d > th ? { message: `一年最大回撤 ${d.toFixed(1)}% 超過 ${th}%`, value: d } : null;
    }
    default:
      return null;
  }
}

const fmt = (v) => (v == null ? '-' : Number(v).toLocaleString('zh-HK', { maximumFractionDigits: 3 }));
export function compact(v) {
  if (v == null) return '-';
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)} 億`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)} 萬`;
  return `${Math.round(v)}`;
}

export default { rules, alertLog, evaluateRule, RULE_TYPES, compact };
