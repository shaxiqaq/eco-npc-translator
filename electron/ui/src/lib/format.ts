export function formatNumber(value: unknown, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDuration(seconds: unknown) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function formatBytes(value: unknown) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export function formatEventTime(timestamp: unknown) {
  if (!Number.isFinite(Number(timestamp))) return '--:--:--';
  return new Date(Number(timestamp) * 1000).toLocaleTimeString('zh-CN', { hour12: false });
}

/** Format percent points, e.g. 12.5 → "12.5%" */
export function formatPercent(value: unknown, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

/** Compact EXP rate like 1.2万/时 */
export function formatExpRate(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0/时';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿/时`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 1 : 2)}万/时`;
  return `${formatNumber(Math.round(n))}/时`;
}

export function formatDurationLong(seconds: unknown) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}小时${String(m).padStart(2, '0')}分`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
