/**
 * errors.js — 對外可顯示的錯誤型別。
 *
 * 背景：過去錯誤處理直接把 `err.message` 回給前端，而供應商層的錯誤訊息含有
 * 外部 URL（例：HTTP 403 https://query1.finance.yahoo.com/...），會把內部實作細節曝露出去。
 *
 * 約定：
 *   - 只有 PublicError（或帶 expose=true）的訊息會原樣回給前端，通常是參數／狀態類提示；
 *   - 其餘一律回傳統一口徑，詳細內容只進伺服器日誌。
 */
export class PublicError extends Error {
  /**
   * @param {string} message 可安全顯示給使用者的訊息
   * @param {number} status HTTP 狀態碼
   */
  constructor(message, status = 400) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.expose = true;
  }
}

/** 判斷錯誤訊息是否可安全回傳給前端 */
export function isPublicError(err) {
  return Boolean(err && (err instanceof PublicError || err.expose === true));
}

export default PublicError;
