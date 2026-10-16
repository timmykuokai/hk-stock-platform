/**
 * check-p3.mjs — P3 功能前端渲染驗證（基本面資格 Gate / 財報窗口 / 倉位矩陣）
 * 用法：node scripts/check-p3.mjs [baseUrl] [code]
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

  // 1. 基本面資格紅綠燈
  check('P3 基本面資格紅綠燈卡片出現', html.includes('基本面資格紅綠燈'));
  for (const g of ['獲利能力 ROE', '成長性 營收成長', '估值 PE', '估值 PB', '獲利品質 毛利率', '財務結構 負債權益比', '現金流 經營現金流']) {
    check(`P3 門檻「${g}」已渲染`, html.includes(g));
  }
  check('P3 門檻狀態標籤出現（合格/偏弱/不合格/無資料）', /合格|偏弱|不合格|無資料/.test(html));

  // 2. 財報窗口 · 減權期
  check('P3 財報窗口卡片出現', html.includes('財報窗口'));
  check('P3 預估公告日欄位出現', html.includes('預估公告日') && html.includes('距離業績'));
  check('P3 精確日標示待接入', html.includes('待接入（Yahoo calendar'));
  check('P3 減權期說明出現', html.includes('減權') || html.includes('業績'));

  // 3. 倉位建議矩陣
  check('P3 倉位建議矩陣卡片出現', html.includes('倉位建議矩陣'));
  for (const r of ['進攻市況', '均衡市況', '防守市況']) {
    check(`P3 市況行「${r}」已渲染`, html.includes(r));
  }
  check('P3 倉位區間欄位出現', html.includes('倉位區間') && /60–80%|40–60%|20–40%/.test(html));
  check('P3 策略欄位出現', html.includes('順勢加碼') || html.includes('現金為王') || html.includes('高拋低吸'));

  check('P3 無 Vue 執行期錯誤', errors.filter((e) => !/jsdom|Not implemented/i.test(e)).length === 0,
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
console.log(`\nP3 結果：${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
