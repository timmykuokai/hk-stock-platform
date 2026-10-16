/**
 * logger.js — 極簡分級日誌（可關閉），供伺服器端模組共用。
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 20;

const ts = () => new Date().toISOString().slice(11, 19);
function emit(level, tag, msg, extra) {
  if (LEVELS[level] < current) return;
  const head = `${ts()} ${level.toUpperCase().padEnd(5)} [${tag}]`;
  if (extra !== undefined) console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](head, msg, extra ?? '');
  else console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](head, msg);
}

export const log = {
  setLevel: (l) => { current = LEVELS[l] ?? current; },
  debug: (tag, m, e) => emit('debug', tag, m, e),
  info: (tag, m, e) => emit('info', tag, m, e),
  warn: (tag, m, e) => emit('warn', tag, m, e),
  error: (tag, m, e) => emit('error', tag, m, e),
  child: (tag) => ({
    debug: (m, e) => emit('debug', tag, m, e),
    info: (m, e) => emit('info', tag, m, e),
    warn: (m, e) => emit('warn', tag, m, e),
    error: (m, e) => emit('error', tag, m, e),
  }),
};
export default log;
