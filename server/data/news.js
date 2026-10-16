/**
 * news.js — 即時新聞聚合（港股／美股／環球要聞）
 *
 * 資料來源（依可用度自動降級）：
 *   1. Yahoo Finance HK RSS   https://hk.finance.yahoo.com/news/rssindex/   （港股＋環球，繁中）
 *   2. Yahoo Finance US RSS   https://finance.yahoo.com/news/rssindex/       （美股，英文）
 *   3. AAStocks 熱門新聞      https://www.aastocks.com/tc/stocks/news/aafn/popular-news （港股標題，繁中）
 *
 * 全部走專案統一的 getTextRobust（自動處理大標頭 / 重試 / UA 偽裝）。
 * 輸出：經去重、依市場分類（hk/us/global）、按時間排序的 top N 要聞。
 */
import { getTextRobust } from '../lib/http.js';
import { Cache } from '../lib/cache.js';
import log from '../lib/logger.js';
import { NEWS_CACHE_DIR, ensureDirs } from '../lib/paths.js';

const TAG = 'news';
const NEWS_TTL = 15 * 60_000; // 15 分鐘
const FEED_KEY = 'feed:v2';

ensureDirs();
const cache = new Cache(NEWS_CACHE_DIR, 96);

const SOURCE_HK = 'Yahoo HK';
const SOURCE_US = 'Yahoo US';
const SOURCE_AA = 'AAStocks';

const FEEDS = [
  { name: SOURCE_HK, fetch: fetchYahooHk },
  { name: SOURCE_US, fetch: fetchYahooUs },
  { name: SOURCE_AA, fetch: fetchAastocks },
];

/* --------------------------- HTML / XML 工具 --------------------------- */
function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

function stripTags(s) {
  if (!s) return '';
  return decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function normTitle(t) {
  return (t || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/* --------------------------- RSS 解析（Yahoo） --------------------------- */
function parseRss(xml, defaultMarket) {
  if (!xml) return [];
  const items = [];
  const blockRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = blockRe.exec(xml))) {
    const b = m[1];
    const pick = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(b);
      return r ? r[1] : '';
    };
    const title = decodeEntities(pick('title'));
    if (!title) continue;
    const link = pick('link').trim();
    const pub = parseDate(pick('pubDate'));
    const source = decodeEntities(pick('source')) || null;
    const summary = stripTags(pick('description')).slice(0, 160);
    const media = /<media:content[^>]*url="([^"]+)"/.exec(b);
    items.push({
      title,
      link,
      publishedAt: pub,
      source: source || 'Yahoo',
      summary,
      image: media ? media[1] : null,
      defaultMarket,
    });
  }
  return items;
}

/* --------------------------- AAStocks 解析 --------------------------- */
function parseAastocks(html) {
  if (!html) return [];
  const items = [];
  const re = /<a[^>]+href="(\/tc\/stocks\/news\/aafn-con\/[^"]+)"[^>]*>([^<]{6,140})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const title = decodeEntities(m[2]).trim();
    if (!title || title.length < 6) continue;
    items.push({
      title,
      link: 'https://www.aastocks.com' + m[1],
      publishedAt: null,
      source: SOURCE_AA,
      summary: '',
      image: null,
      defaultMarket: 'hk',
    });
  }
  return items;
}

/* --------------------------- 市場分類 --------------------------- */
const HK_KW = ['港股', '恒指', '恒生', '港交所', '北水', '騰訊', '美團', '小米', '阿里', '友邦', '滙豐', '中移動', '領展', '內房', '內銀', 'h股', '中資', '本港', '香港', '建滔', '玖紙', '大行', '業績', '習特會', '習近平', '北証', '港股通', '藍籌'];
const US_KW = ['美股', '納指', '納斯達克', '道指', '道瓊', '標普', '標準普爾', '華爾街', '聯儲', '聯準會', '蘋果', '特斯拉', '英偉達', '微軟', '亞馬遜', '谷歌', 'meta', 'fed', 'trump', '特朗普', '輝達', '標指', '納指'];

function classifyMarket(title, fallback) {
  const t = (title || '').toLowerCase();
  if (US_KW.some((k) => t.includes(k.toLowerCase()))) return 'us';
  if (HK_KW.some((k) => t.includes(k.toLowerCase()))) return 'hk';
  return fallback || 'global';
}

/* 常見個股關鍵字 → 代號（僅作「相關個股」提示，不影響排序） */
const NAME_TO_CODE = {
  騰訊: '0700', 美團: '3690', 阿里巴巴: '9988', 阿里: '9988', 小米: '1810',
  比亞迪: '1211', 港交所: '0388', 友邦: '1299', 滙豐: '0005', 中移動: '0941',
  領展: '0823', 建滔: '0148', 玖紙: '2689', 蘋果: 'AAPL', 特斯拉: 'TSLA',
  英偉達: 'NVDA', 微軟: 'MSFT', 亞馬遜: 'AMZN', 谷歌: 'GOOGL',
};
function relatedCodes(title) {
  const out = [];
  for (const [name, code] of Object.entries(NAME_TO_CODE)) {
    if (title && title.includes(name) && !out.includes(code)) out.push(code);
  }
  return out.slice(0, 4);
}

/* --------------------------- 抓取 --------------------------- */
async function fetchYahooHk() {
  const xml = await getTextRobust('https://hk.finance.yahoo.com/news/rssindex/', { timeout: 15000 });
  return parseRss(xml, 'hk');
}
async function fetchYahooUs() {
  const xml = await getTextRobust('https://finance.yahoo.com/news/rssindex/', { timeout: 15000 });
  return parseRss(xml, 'us');
}
async function fetchAastocks() {
  const html = await getTextRobust('https://www.aastocks.com/tc/stocks/news/aafn/popular-news', { timeout: 15000 });
  return parseAastocks(html);
}

/* --------------------------- 組裝 --------------------------- */
async function buildFeed() {
  const results = await Promise.allSettled(FEEDS.map((f) => f.fetch()));
  const all = [];
  const sources = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length) {
      all.push(...r.value);
      if (!sources.includes(FEEDS[i].name)) sources.push(FEEDS[i].name);
    } else if (r.status === 'rejected') {
      // 改用 logger：過去直接 console.warn 不受 LOG_LEVEL 控制，tag 格式也與其他模組不一致
      log.warn(TAG, `${FEEDS[i].name} 抓取失敗`, r.reason?.message || String(r.reason));
    }
  });

  const now = Date.now();
  let undatedIdx = 0;
  for (const it of all) {
    it.market = classifyMarket(it.title, it.defaultMarket);
    if (it.publishedAt) {
      it.effectiveTime = it.publishedAt;
    } else {
      undatedIdx += 1;
      // 熱門新聞無時間戳：視為近期、依來源順序排列，使其貼近榜首
      it.effectiveTime = now - undatedIdx * 60_000;
    }
    it.related = relatedCodes(it.title);
  }
  return { asOf: new Date().toISOString(), sources, items: all };
}

async function getFeed(live) {
  if (!live) {
    const c = cache.get(FEED_KEY);
    // 注意：cache.get() 回傳的是 { value, age, source, stale }，沒有 storedAt。
    // 過去用 Date.now() - c.storedAt 會得到 NaN，比較恆為 false → 每次請求都重抓 3 個 RSS。
    if (c.value !== undefined && c.source !== 'miss' && c.age < NEWS_TTL) {
      return c.value;
    }
  }
  const feed = await buildFeed();
  cache.set(FEED_KEY, feed, NEWS_TTL);
  return feed;
}

/**
 * 取得當日熱門要聞。
 * @param {{market?:'all'|'hk'|'us', limit?:number, live?:boolean}} opts
 */
export async function getTopNews({ market = 'all', limit = 10, live = false } = {}) {
  const feed = await getFeed(live);
  let items = feed.items.slice();
  if (market === 'hk' || market === 'us') {
    items = items.filter((i) => i.market === market);
  }

  items.sort((a, b) => b.effectiveTime - a.effectiveTime);

  // 去重（同一標題只留最新一筆）
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const n = normTitle(it.title);
    if (seen.has(n)) continue;
    seen.add(n);
    deduped.push(it);
  }

  // 「全部」模式：單一市場最多佔 60%，保證港股／美股都會出現
  let chosen = deduped;
  if (market === 'all' && deduped.length > limit) {
    const cap = Math.max(3, Math.round(limit * 0.6));
    const counts = {};
    const picked = [];
    const overflow = [];
    for (const it of deduped) {
      const c = (counts[it.market] = (counts[it.market] || 0) + 1);
      if (c <= cap && picked.length < limit) picked.push(it);
      else overflow.push(it);
    }
    while (picked.length < limit && overflow.length) picked.push(overflow.shift());
    chosen = picked;
  }

  const top = chosen.slice(0, limit).map((it, i) => ({
    rank: i + 1,
    title: it.title,
    link: it.link,
    source: it.source,
    summary: it.summary || '',
    image: it.image || null,
    market: it.market,
    publishedAt: it.publishedAt,
    related: it.related || [],
  }));

  return {
    asOf: feed.asOf,
    market,
    limit,
    total: deduped.length,
    sources: feed.sources,
    items: top,
  };
}
