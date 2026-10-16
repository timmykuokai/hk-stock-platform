/**
 * check-p1.mjs — P1 功能前端渲染驗證（多級別環境層 / OBV 背離 / 出場紀律階梯）
 * 用法：node scripts/check-p1.mjs [baseUrl]
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

  // 1. 多級別環境層
  check('P1 多級別環境層卡片出現', html.includes('多級別環境層'));
  check('P1 多級別環境層含日/週/月三級', /日線/.test(html) && /週線/.test(html) && /月線/.test(html));
  check('P1 多級別環境層渲染級別差摘要', /級別差/.test(html));

  // 2. OBV 量價背離
  check('P1 OBV 量價背離卡片出現', html.includes('OBV 量價背離'));
  const divBlock = html.slice(html.indexOf('OBV 量價背離'), html.indexOf('OBV 量價背離') + 3000);
  check('P1 背離區塊有內容（列表或空狀態）',
    /背離/.test(divBlock) && (divBlock.includes('未發現明確量價背離') || /top_div|背離<|\/span>/.test(divBlock)));

  // 3. 出場紀律階梯
  check('P1 出場紀律階梯卡片出現', html.includes('出場紀律階梯'));
  check('P1 階梯含四級均線', /MA5|5 日|5日/.test(html) && /MA60|60 日|60日/.test(html));
  const svgCount = (html.match(/<svg/g) || []).length;
  check('P1 階梯 SVG 已渲染', svgCount >= 3, `SVG 數量 ${svgCount}`);

  check('P1 無 Vue 執行期錯誤', errors.filter((e) => !/jsdom|Not implemented/i.test(e)).length === 0,
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
console.log(`\nP1 結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
