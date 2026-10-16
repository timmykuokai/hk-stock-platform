/**
 * check-p4.mjs — P4 功能前端渲染驗證（估值分位帶 + RSI×估值 決策矩陣）
 * 用法：node scripts/check-p4.mjs [baseUrl] [code]
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

  // 1. 估值分位帶
  check('P4 估值分位帶卡片標題出現', html.includes('估值分位帶'));
  // PE/PB 任一出現即可（個別股票可能缺 EPS/BVPS，退為另一種帶）
  const hasValBand = html.includes('PE (TTM)') || html.includes('PB');
  check('P4 至少有一組估值帶（PE 或 PB）出現', hasValBand);
  check('P4 分位百分比渲染', /分位<\/?(b|\/b|b>)?\s*>\s*\d/.test(html) || /分位 <b>\d+/.test(html) || /\d+%/.test(html));
  check('P4 分位帶刻度 0/25/50/75/100 出現', html.includes('0') && html.includes('100') && (html.includes('25') || html.includes('75')));
  check('P4 分位帶數值（10分位/中位/90分位）出現', html.includes('10分位') && html.includes('中位') && html.includes('90分位'));
  check('P4 估值狀態標籤（估值偏低/合理/偏高）出現', /估值偏低|估值合理|估值偏高/.test(html));

  // 2. RSI×估值 決策矩陣
  check('P4 RSI×估值 決策矩陣卡片標題出現', html.includes('RSI × 估值 決策矩陣'));
  check('P4 矩陣欄位（RSI 超賣/中性/超買）出現', html.includes('RSI 超賣') && html.includes('RSI 中性') && html.includes('RSI 超買'));
  check('P4 矩陣估值列（估值偏低/合理/偏高）出現', html.includes('估值偏低') && html.includes('估值合理') && html.includes('估值偏高'));
  check('P4 矩陣四角標籤（低估×超賣 等）出現', html.includes('低估×超賣') || html.includes('低估×超買') || html.includes('偏高×超買'));
  check('P4 矩陣當前建議文字出現', html.includes('黃金交叉') || html.includes('估值透支') || html.includes('估值與技術皆中性') || html.includes('觀望為主'));

  check('P4 無 Vue 執行期錯誤', errors.filter((e) => !/jsdom|Not implemented/i.test(e)).length === 0,
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
console.log(`\nP4 結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
