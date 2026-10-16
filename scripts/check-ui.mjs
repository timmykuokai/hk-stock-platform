/**
 * check-ui.mjs — 前端渲染驗證（無頭 DOM 環境）
 * 目的：在沒有真實瀏覽器的情況下，驗證 Vue 元件能否載入、模板是否合法、
 *       以及與後端 API 串接後能否成功渲染內容。
 * 用法：node scripts/check-ui.mjs [baseUrl]
 */
import { JSDOM } from 'jsdom';

const BASE = process.argv[2] || 'http://localhost:8787';

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>', {
  url: `${BASE}/`,
  pretendToBeVisual: true,
});

const { window } = dom;
// 全域注入，讓瀏覽器版 Vue 與前端程式碼可在 Node 執行
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

// Canvas 2D 假實作（K 線圖用）
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 800, height: 400 };
    if (k === 'measureText') return () => ({ width: 40 });
    return () => undefined;
  },
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

// fetch：把相對路徑補上 baseUrl
const nativeFetch = globalThis.fetch;
globalThis.fetch = (u, o) => nativeFetch(String(u).startsWith('http') ? u : `${BASE}${u}`, o);
window.fetch = globalThis.fetch;

const errors = [];
const warns = [];
const origError = console.error;
const origWarn = console.warn;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };
console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
window.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));

const results = [];
const check = (name, cond, extra = '') => results.push({ name, ok: !!cond, extra });

try {
  await import('../web/js/app.js');
  // 等待初始資料載入（store.init + 各 view 的 onMounted）
  await new Promise((r) => setTimeout(r, 6000));

  const appEl = document.getElementById('app');
  const html = appEl?.innerHTML ?? '';
  check('掛載成功', html.length > 500, `長度 ${html.length}`);
  check('側邊欄出現', html.includes('港股分析平台'));
  check('導覽含選股器', html.includes('選股器'));

  // 依序切換路由
  const routes = [
    ['#/screener', ['篩選條件', '執行篩選']],
    ['#/movers', ['異動掃描', '技術訊號快篩']],
    ['#/compare', ['多股比較', '綜合評比', '操作', '✕ 00700']],
    ['#/backtest', ['策略設定', '執行回測']],
    ['#/portfolio', ['組合概況', '新增持股']],
    ['#/alerts', ['警報規則', '立即檢查']],
    ['#/settings', ['資料源狀態', '快取']],
    ['#/stock/00700', ['K 線圖', '關鍵指標', '綜合決策摘要', '港股十大要素評分', '技術面十大訊號']],
    ['#/report/00700', ['個股詳細分析報告', '生成報告', '當前市場現況', '市場熱度與關注度', '綜合評估與操作建議']],
    ['#/us-movers', ['美股異動掃描', '成交額前 20', '升幅前 20', '跌幅前 20']],
  ];
  for (const [hash, expects] of routes) {
    window.location.hash = hash;
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await new Promise((r) => setTimeout(r, 5000));
    const h2 = document.getElementById('app')?.innerHTML ?? '';
    for (const e of expects) check(`${hash} 渲染「${e}」`, h2.includes(e), `內容長度 ${h2.length}`);
  }
  check('無 Vue 執行期錯誤', errors.filter((e) => !/jsdom|Not implemented/i.test(e)).length === 0,
    errors.slice(0, 3).join(' | '));

  // 互動測試：多股比較 — 點擊個股移除按鈕後即時從清單消失
  window.location.hash = '#/compare';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await new Promise((r) => setTimeout(r, 5000));
  const rmBtnsBefore = (document.getElementById('app')?.innerHTML.match(/✕\s*\d{5}/g) || []).length;
  const rmBtn = [...document.querySelectorAll('#app button')].find((b) => /✕\s*00700/.test(b.textContent));
  check('比較頁含個股移除按鈕', !!rmBtn, `移除按鈕數 ${rmBtnsBefore}`);
  if (rmBtn) {
    rmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));
    const afterHtml = document.getElementById('app')?.innerHTML ?? '';
    check('點擊移除後 00700 即時離開比較清單', !afterHtml.includes('✕ 00700'),
      `剩餘移除按鈕數 ${(afterHtml.match(/✕\s*\d{5}/g) || []).length}`);
  }
} catch (e) {
  check('載入前端程式', false, e.message);
}

console.error = origError;
console.warn = origWarn;

let pass = 0;
let fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log(`  ✓ ${r.name}`); } else { fail++; console.log(`  ✗ ${r.name} ${r.extra}`); }
}
if (errors.length) {
  console.log('\n--- 錯誤訊息（前 8 則）---');
  errors.filter((e) => !/jsdom|Not implemented/i.test(e)).slice(0, 8).forEach((e) => console.log('  !', e.slice(0, 300)));
}
if (warns.length) {
  console.log('\n--- 警告（前 5 則）---');
  warns.slice(0, 5).forEach((w) => console.log('  ~', w.slice(0, 200)));
}
console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
