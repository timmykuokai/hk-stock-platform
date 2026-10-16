import fs from 'fs';
const s = fs.readFileSync('web/js/views/stock.js', 'utf8');
const m = s.match(/template:\s*`([\s\S]*?)`\s*\n?\}\)/);
if (!m) { console.log('NO TEMPLATE FOUND'); process.exit(1); }
const t = m[1];
const o = (t.match(/<div/g) || []).length;
const c = (t.match(/<\/div>/g) || []).length;
console.log('div open', o, 'close', c, o === c ? 'BALANCED' : 'MISMATCH');
// quick check for the new P3 cards presence
for (const id of ['fundamentalGate', 'earningsWindow', 'positionMatrix', 'gateClass', 'windowStateText']) {
  console.log(id, s.includes(id) ? 'present' : 'MISSING');
}
