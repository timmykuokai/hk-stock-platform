/**
 * market.js — 市場設定檔（一級抽象）。
 *
 * 背景：基準指數、基準標籤、幣別、etnet 適用性、中文名來源、評分母體
 * 過去散落在 api.js / report.js 各處的 `market === 'us' ? '^GSPC' : '^HSI'`，
 * 正是美股相關 Bug（基準錯置、報告缺 Beta、中文名抓錯來源）反覆發生的根因。
 * 現在集中成表，所有判斷一律查表；未來要加 A 股／台股只需在此新增一筆。
 */
import { detectMarket } from './code.js';

const PROFILES = {
  hk: {
    market: 'hk',
    label: '港股',
    benchmark: '^HSI',
    benchmarkLabel: '恒指',
    benchmarkName: '恆生指數',
    currency: 'HKD',
    /** etnet 成交二十大只涵蓋港股 */
    usesEtnet: true,
    /** 中文名來源：港股名單 + 使用者別名 */
    zhSource: 'hkex+alias',
    /** 可納入港股熱門池母體評分 */
    scoringUniverse: 'hk-popular',
  },
  us: {
    market: 'us',
    label: '美股',
    benchmark: '^GSPC',
    benchmarkLabel: '標普',
    benchmarkName: '標普 500',
    currency: 'USD',
    usesEtnet: false,
    /** 中文名來源：自維美股池 US_POPULAR（不應去 hk.yahoo 抓） */
    zhSource: 'us-universe',
    /** 跨市場評分失真，美股不納入港股母體 */
    scoringUniverse: null,
  },
};

/** 取得市場設定（未知市場一律視為港股，維持既有行為） */
export function marketProfile(market) {
  return PROFILES[market] ?? PROFILES.hk;
}

/** 由代號直接取得市場設定 */
export function profileForCode(code) {
  return marketProfile(detectMarket(code));
}

/** 基準指數代碼：可接受代號（AAPL/00700）或市場字串（us/hk） */
export function benchmarkSymbol(codeOrMarket) {
  if (PROFILES[codeOrMarket]) return PROFILES[codeOrMarket].benchmark;
  return profileForCode(codeOrMarket).benchmark;
}

/** Beta 標籤用語：「對恒指」／「對標普」 */
export function benchmarkLabel(market) {
  return marketProfile(market).benchmarkLabel;
}

export const MARKETS = Object.keys(PROFILES);

export default { marketProfile, profileForCode, benchmarkSymbol, benchmarkLabel, MARKETS, PROFILES };
