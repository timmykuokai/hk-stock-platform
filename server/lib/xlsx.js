/**
 * xlsx.js — 極簡 XLSX（OOXML zip）讀取器，零依賴。
 * 只讀取第一個工作表的「儲存格文字」，足以解析港交所證券名單。
 * 用途：server/data/providers/hkex.js
 */
import zlib from 'node:zlib';

/** 讀取 zip 中央目錄，回傳 {name: Buffer} */
export function unzip(buf) {
  // 中央目錄記錄 signature: 0x02014b50
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/xlsx 檔案');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    // 讀 local header 取得真正資料起點
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    } catch {
      out[name] = Buffer.alloc(0);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// 命名空間前綴（x: / 無）通用化：把 <x:tag> 正規化為 <tag>
const NS = (tag) => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>`, 'g');

/** 解析 sharedStrings.xml -> string[] */
function parseSharedStrings(xml) {
  const list = [];
  const re = /<( ?\w+:)?si\b[^>]*>([\s\S]*?)<\/?( ?\w+:)?si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let s = m[2].replace(/<( ?\w+:)?t[^>]*>([\s\S]*?)<\/( ?\w+:)?t>/g, '$2');
    s = s.replace(/<[^>]+>/g, '');
    list.push(decodeXml(s));
  }
  return list;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** 欄位代號 A1 -> 欄索引 */
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * 解析第一個工作表，回傳列陣列（每列為字串陣列）
 * @param {Buffer} buf xlsx 檔
 * @param {string} [sheetName] 指定工作表（預設第一個）
 */
export function readSheet(buf, sheetName) {
  const files = unzip(buf);
  const names = Object.keys(files);
  const shared = names.find((n) => n === 'xl/sharedStrings.xml');
  const strings = shared ? parseSharedStrings(files[shared].toString('utf8')) : [];

  let target = sheetName
    ? names.find((n) => n === `xl/worksheets/${sheetName}.xml`)
    : names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if (!target) throw new Error('找不到工作表');
  const xml = files[target].toString('utf8');

  const rows = [];
  const rowRe = /<( ?\w+:)?row\b[^>]*>([\s\S]*?)<\/( ?\w+:)?row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<( ?\w+:)?c\b([^>]*)>([\s\S]*?)<\/( ?\w+:)?c>|<( ?\w+:)?c\b([^>]*)\/>/g;
    let cm;
    while ((cm = cellRe.exec(rm[2]))) {
      const attrs = cm[2] || cm[6] || '';
      const body = cm[3] || '';
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      const idx = refM ? colIndex(refM[1]) : cells.length;
      const tM = /t="([^"]+)"/.exec(attrs);
      const type = tM ? tM[1] : 'n';
      let value = '';
      const vM = /<( ?\w+:)?v>([\s\S]*?)<\/( ?\w+:)?v>/.exec(body);
      if (type === 's' && vM) value = strings[+vM[2]] ?? '';
      else if (type === 'inlineStr') {
        value = body.replace(/<( ?\w+:)?is>[\s\S]*?<\/( ?\w+:)?is>/, (s) =>
          s.replace(/<( ?\w+:)?t[^>]*>([\s\S]*?)<\/( ?\w+:)?t>/g, '$2').replace(/<[^>]+>/g, '')
        );
        value = decodeXml(value);
      } else if (vM) value = vM[2];
      cells[idx] = (value || '').trim();
    }
    rows.push(cells);
  }
  return rows;
}
