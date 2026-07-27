/** Human-readable label for multi-client eco.exe rows. */
export function formatProcessLabel(process: {
  pid?: number | null;
  title?: string | null;
  started?: string | null;
  path?: string | null;
}): string {
  const pid = process.pid != null ? `PID ${process.pid}` : 'PID ?';
  const title = String(process.title || '').trim();
  const started = String(process.started || '').trim();
  const pathStr = String(process.path || '').trim();
  const pathTail = pathStr
    ? pathStr.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')
    : '';

  const parts = [pid];
  if (title && title.toLowerCase() !== 'eco') {
    parts.push(title);
  } else if (pathTail) {
    parts.push(pathTail);
  } else {
    parts.push('（无窗口标题）');
  }
  if (started) parts.push(started);
  return parts.join(' · ');
}

export function processShortTitle(process: {
  title?: string | null;
  path?: string | null;
  pid?: number | null;
}): string {
  const title = String(process.title || '').trim();
  if (title && title.toLowerCase() !== 'eco') return title;
  const pathStr = String(process.path || '').trim();
  if (pathStr) {
    const base = pathStr.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    if (base) return base;
  }
  return process.pid != null ? `PID ${process.pid}` : '未知窗口';
}
