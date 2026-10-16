// 測試 00700 P4 前端渲染 — 排除 temp 文件依賴
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

  check('P4 估值分位帶卡片標題出現', html.includes('估值分位帶'));
  const hasValBand = html.includes('PE (TTM)') || html.includes('PB');
  check('P4 至少有一組估值帶出現', hasValBand);
  check('P4 分位百分比渲染', /分位<\/?(b|\/b|b>)?\s*>\s*\d/.test(html) || /\d+%/.test(html));
  check('P4 估值狀態標籤出現', /估值偏低|估值合理|估值偏高/.test(html));
  check('P4 RSI×估值 決策矩陣卡片標題出現', html.includes('RSI × 估值 決策矩陣'));
  check('P4 矩陣 RSI 三欄出現', html.includes('RSI 超賣') && html.includes('RSI 中性') && html.includes('RSI 超買'));
  check('P4 矩陣估值三列出現', html.includes('估值偏低') && html.includes('估值合理') && html.includes('估值偏高'));
  check('P4 矩陣四角標籤出現', html.includes('低估×超賣') || html.includes('低估×超買') || html.includes('偏高×超買'));
  check('P4 建議文字出現', html.includes('估值與技術皆中性') || html.includes('觀望為主'));
  check('P4 無 Vue 執行期錯誤', errors.filter((e) => !/jsdom|Not implemented/i.test(e)).length === 0, errors.slice(0, 2).join(' | '));
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
