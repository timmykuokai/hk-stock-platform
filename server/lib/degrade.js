/**
 * degrade.js — 降級取數記錄器。
 *
 * 背景：程式庫裡有大量 `.catch(() => null)` / `.catch(() => [])`。
 * 當 Yahoo 掛掉或被限流時，指標會「靜默」變成 null／空陣列，
 * 使用者只看到「—」卻不知道是資料來源故障，伺服器日誌也完全沒記錄。
 *
 * 用法：
 *   const dg = new Degrade('api');
 *   const quote = await dg.run('即時報價', getQuote(code), null);
 *   ...
 *   res.json({ ..., _degraded: dg.degraded ? dg.items : undefined });
 */
import log from './logger.js';

export class Degrade {
  /** @param {string} tag 日誌標籤 */
  constructor(tag = 'api') {
    this.tag = tag;
    this.items = [];
  }

  /** 是否曾發生降級 */
  get degraded() {
    return this.items.length > 0;
  }

  /**
   * 執行一個 Promise，失敗時記錄並回傳 fallback（不拋出）。
   * @param {string} label 人類可讀的資料項目名稱
   * @param {Promise<any>} promise
   * @param {any} fallback
   */
  async run(label, promise, fallback = null) {
    try {
      return await promise;
    } catch (e) {
      const message = e?.message ?? String(e);
      log.warn(this.tag, `降級：${label}`, message);
      this.items.push({ label, message });
      return fallback;
    }
  }

  /** 同步版本（用於已完成的運算） */
  runSync(label, fn, fallback = null) {
    try {
      return fn();
    } catch (e) {
      const message = e?.message ?? String(e);
      log.warn(this.tag, `降級：${label}`, message);
      this.items.push({ label, message });
      return fallback;
    }
  }

  toJSON() {
    return this.items;
  }
}

export default Degrade;
