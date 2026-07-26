export function normalizeWarningSeconds(value: unknown, fallback = 10) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;
  return Math.min(300, Math.max(1, Math.round(seconds)));
}

export function isBuffExpiring(
  item: { expires_at?: number | null } | null | undefined,
  warningSeconds: unknown,
  now = Date.now() / 1000,
) {
  const expiresAt = Number(item?.expires_at);
  if (item?.expires_at == null || !Number.isFinite(expiresAt)) return false;
  const remaining = expiresAt - Number(now);
  return remaining > 0 && remaining <= normalizeWarningSeconds(warningSeconds);
}
