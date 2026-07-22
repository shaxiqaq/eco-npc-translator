(function exposeBuffWarning(root) {
  function normalizeWarningSeconds(value, fallback = 10) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) return fallback;
    return Math.min(300, Math.max(1, Math.round(seconds)));
  }

  function isBuffExpiring(item, warningSeconds, now = Date.now() / 1000) {
    const expiresAt = Number(item?.expires_at);
    if (item?.expires_at == null || !Number.isFinite(expiresAt)) return false;
    const remaining = expiresAt - Number(now);
    return remaining > 0 && remaining <= normalizeWarningSeconds(warningSeconds);
  }

  const api = { isBuffExpiring, normalizeWarningSeconds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ecoBuffWarning = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
