/**
 * check-p2.mjs — P2 功能前端渲染驗證（市況判定引擎 / 指標適用性路由 / 關鍵變量觸發台）
 * 用法：node scripts/check-p2.mjs [baseUrl] [code]
 * 依賴：後端需在 baseUrl 運作（預設 http://localhost:8787）
 */
import { JSDOM } from 'jsdom';

const BASE = process.argv[2] || 'http://localhost:8787';
const CODE = process.argv[3] || '00700';

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>', {
  url: `${BASE}/`,
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true, writable: true });
global.location = window.location;
global.HTMLElement = window.HTMLElement;
global.SVGElement = window.SVGElement;
global.Element = window.Element;
global.Node = window.Node;
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.getComputedStyle = window.getComputedStyle.bind(window);
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.localStorage = window.localStorage;

const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 800, height: 400 };
    if (k === 'measureText') return () => ({ width: 40 });
    return () => undefined;
  },
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

const nativeFetch = globalThis.fetch;
globalThis.fetch = (u, o) => nativeFetch(String(u).startsWith('http') ? u : `${BASE}${u}`, o);
window.fetch = globalThis.fetch;

const errors = [];
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };
window.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));

const results = [];
const check = (name, cond, extra = '') => results.push({ name, ok: !!cond, extra });

try {
  await import('../web/js/app.js');
  await new Promise((r) => setTimeout(r, 6000));

  window.location.hash = `#/stock/${CODE}`;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await new Promise((r) => setTimeout(r, 7000));

  const html = document.getElementById('app')?.innerHTML ?? '';

  // 1. 市況判定引擎（八維）
  check('P2 市況判定引擎卡片出現', html.includes('市況判定引擎'));
  check('P2 八維投票區出現', /八維投票/.test(html));
  check('P2 三態標籤出現（上升/震盪/下跌）', /上升\s*\d/.test(html) && /震盪\s*\d/.test(html) && /下跌\s*\d/.test(html));
  for (const dim of ['恒指 vs 60 日線', '5/20/60 均線排列', 'ADX(14)', '布林帶寬', '成交額水位', '回踩行為']) {
    check(`P2 維度「${dim}」已渲染`, html.includes(dim));
  }
  check('P2 待接入維度已標示', html.includes('待接入'));
  check('P2 代理維度已標示', html.includes('代理'));

  // 2. 指標適用性路由
  check('P2 指標適用性路由卡片出現', html.includes('指標適用性路由'));
  for (const ind of ['均線 MA / EMA', 'MACD', 'RSI', 'KD 隨機指數', '布林通道', 'ADX 趨勢強度', 'OBV / 量能', 'CCI', '乖離率 BIAS', '唐奇安通道']) {
    check(`P2 指標「${ind}」已渲染`, html.includes(ind));
  }
  check('P2 效力標籤出現（有效/中性/失效）', /有效/.test(html) && /中性/.test(html) && /失效/.test(html));

  // 3. 關鍵變量觸發台
  check('P2 關鍵變量觸發台卡片出現', html.includes('關鍵變量觸發台'));
  for (const v of ['恒指 vs 60 日線', '大市成交額水位', '沽空佔比', '52 週新高／新低家數比', '布林帶寬分位', 'MACD 柱', 'OBV vs 20 日均線', 'EPS 斜率', '個股日線 vs 60 日線', '財報窗口']) {
    check(`P2 變量「${v}」已渲染`, html.includes(v));
  }
  check('P2 觸發狀態標籤出現', /已觸發|接近門檻|正常/.test(html));

  check('P2 無 Vue 執行期錯誤', errors.filter((e) => !/jsdom|Not implemented/i.test(e)).length === 0,
    errors.slice(0, 2).join(' | '));
} catch (e) {
  check('載入前端程式', false, e.message);
}

console.error = origError;
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); } else { fail++; console.log(`  ✗ ${r.name} ${r.extra}`); }
}
if (errors.length) {
  console.log('\n--- 錯誤（前 5 則）---');
  errors.filter((e) => !/jsdom|Not implemented/i.test(e)).slice(0, 5).forEach((e) => console.log('  !', e.slice(0, 250)));
}
console.log(`\nP2 結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
