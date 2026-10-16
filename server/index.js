/**
 * index.js — 伺服器進入點：Express + 靜態前端 + API + 快取家務。
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import api from './routes/api.js';
import { refreshPool } from './data/marketData.js';
import log from './lib/logger.js';
import securityHeaders from './lib/security.js';
import { isPublicError } from './lib/errors.js';
import { WEB_DIR, VENDOR_DIR, CACHE_DIR, SNAPSHOT_DIR } from './lib/paths.js';

/**
 * 預設只監聽本機（127.0.0.1）：這是單人使用的本機學習平台，
 * 綁 0.0.0.0 會讓區網任何人都能操作破壞性端點（刪持股／清快取）。
 * 需要區網存取時再以環境變數開啟：HOST=0.0.0.0 node server/index.js
 */
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.use(securityHeaders);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(WEB_DIR, { extensions: ['html'] }));

// 靜態資源：Vue ESM
app.use('/vendor', express.static(VENDOR_DIR));

app.use('/api', api);

app.get('/', (req, res) => {
  const f = path.join(WEB_DIR, 'index.html');
  if (fs.existsSync(f)) res.sendFile(f);
  else res.status(404).send('前端未建置');
});

app.use((err, req, res, next) => {
  void next;
  // 詳細錯誤（含供應商 URL 等內部訊息）只進日誌；
  // 對外僅回傳 PublicError 的訊息，其餘一律統一文案，避免洩漏內部實作。
  log.error('http', `${req.method} ${req.originalUrl}`, err.stack || err.message);
  const status = err.status >= 400 && err.status <= 599 ? err.status : 500;
  const publicError = isPublicError(err);
  res.status(publicError ? status : 500)
    .json({ error: publicError ? err.message : '伺服器內部錯誤，請稍後再試' });
});

const server = app.listen(PORT, HOST, () => {
  log.info('server', `港股篩選分析平台已啟動： http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  // 啟動時若無熱門池快照，背景建立一次
  const snapFile = path.join(SNAPSHOT_DIR, 'popular.json');
  if (!fs.existsSync(snapFile)) {
    log.info('server', '首次啟動：背景建立熱門池快照');
    refreshPool('popular', { range: '3y' }).catch((e) => log.warn('server', '初始快照失敗', e.message));
  }
});

// 每 15 分鐘清理過期磁碟快取（超過 3 天）
setInterval(() => {
  try {
    const now = Date.now();
    let removed = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      const p = path.join(CACHE_DIR, f);
      const st = fs.statSync(p);
      if (now - st.mtimeMs > 3 * 24 * 3600_000) { fs.unlinkSync(p); removed++; }
    }
    if (removed) log.info('cache', `清除過期快取 ${removed} 個檔案`);
  } catch (e) {
    // 目錄尚未建立等情況不影響服務，但過去完全靜默，現改為 debug 留痕
    log.debug('cache', '快取清理略過', e.message);
  }
}, 15 * 60_000).unref();

export { app, server };
