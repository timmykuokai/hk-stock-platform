/**
 * enrich-names.mjs — 補齊中文名稱對照（Yahoo 香港站 title）
 * 把結果寫入 server/data/store/name-alias.json，之後池快照與搜尋都會用到。
 * 用法：node scripts/enrich-names.mjs [pool]
 */
import { popularList } from '../server/data/pools.js';
import { alias } from '../server/data/universe.js';
import * as yahoo from '../server/data/providers/yahoo.js';
import { mapLimit } from '../server/lib/http.js';

const pool = process.argv[2] || 'popular';
const items = pool === 'popular' ? popularList() : [];
const current = alias.get();
let ok = 0;
let skip = 0;
let fail = 0;

await mapLimit(items, 5, async (it) => {
  if (current[it.code]) { skip++; return; }
  const sym = yahoo.symbolFromCode(it.code);
  if (!sym) return;
  try {
    const zh = await yahoo.fetchChineseName(sym);
    if (zh && zh !== sym) {
      alias.put(it.code, zh);
      ok++;
    } else fail++;
  } catch {
    fail++;
  }
});

console.log(`中文名稱對照：新增 ${ok} 筆 / 跳過（已有）${skip} 筆 / 失敗 ${fail} 筆`);
console.log('寫入 server/data/store/name-alias.json');
