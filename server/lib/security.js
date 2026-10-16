/**
 * security.js — 基本安全回應標頭（零依賴版）。
 *
 * 專案只依賴 express，不引入 helmet；這裡以最少程式碼補上最常用的防護標頭。
 * 若要更完整的 CSP / HSTS，日後可替換為 helmet（介面相容：都是 (req,res,next)）。
 */
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.removeHeader('X-Powered-By');
  next();
}

export default securityHeaders;
