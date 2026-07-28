'use strict';

/**
 * Public shared NPC dictionary (Cloudflare Worker).
 * Enabled by default for all installs — users can turn off in Settings.
 */
const DEFAULT_SYNC_CONFIG = Object.freeze({
  enabled: true,
  url: 'https://eco-npc-dict.w3145965836.workers.dev',
  token: 'eco_NWODgbGAcW7Zd5EXsuf6P-Kq',
  pull_interval: 300,
  flush_interval: 20,
  pull_on_start: true
});

function cloneDefaults() {
  return {
    enabled: DEFAULT_SYNC_CONFIG.enabled,
    url: DEFAULT_SYNC_CONFIG.url,
    token: DEFAULT_SYNC_CONFIG.token,
    pull_interval: DEFAULT_SYNC_CONFIG.pull_interval,
    flush_interval: DEFAULT_SYNC_CONFIG.flush_interval,
    pull_on_start: DEFAULT_SYNC_CONFIG.pull_on_start
  };
}

/**
 * Normalize / migrate sync_config on disk.
 * - Missing or empty file → write public defaults (enabled)
 * - Empty url → fill public node and enable (old installs had enabled:false + empty url)
 * - User explicitly disabled with a non-empty url → keep offline
 */
function ensureSyncConfig(filePath, { readJson, writeJson } = {}) {
  if (typeof readJson !== 'function' || typeof writeJson !== 'function') {
    throw new Error('ensureSyncConfig requires readJson/writeJson');
  }

  const raw = readJson(filePath, null);
  const defaults = cloneDefaults();

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    writeJson(filePath, defaults);
    return defaults;
  }

  const url = String(raw.url || '').trim();
  const token = String(raw.token || '').trim();
  let enabled = Boolean(raw.enabled);

  // Unconfigured / broken installs: always point at the public node.
  if (!url) {
    const next = {
      ...defaults,
      pull_interval: Number(raw.pull_interval) > 0 ? Number(raw.pull_interval) : defaults.pull_interval,
      flush_interval: Number(raw.flush_interval) > 0 ? Number(raw.flush_interval) : defaults.flush_interval,
      pull_on_start: raw.pull_on_start !== false,
      enabled: true,
      url: defaults.url,
      token: token || defaults.token
    };
    writeJson(filePath, next);
    return next;
  }

  const next = {
    enabled,
    url: url.replace(/\/+$/, ''),
    token: token || defaults.token,
    pull_interval: Number(raw.pull_interval) > 0 ? Number(raw.pull_interval) : defaults.pull_interval,
    flush_interval: Number(raw.flush_interval) > 0 ? Number(raw.flush_interval) : defaults.flush_interval,
    pull_on_start: raw.pull_on_start !== false
  };

  // Persist token fill / interval defaults if they were missing.
  const needsWrite =
    !token
    || raw.pull_interval == null
    || raw.flush_interval == null
    || raw.pull_on_start == null
    || String(raw.url || '').endsWith('/');
  if (needsWrite) writeJson(filePath, next);
  return next;
}

module.exports = {
  DEFAULT_SYNC_CONFIG,
  cloneDefaults,
  ensureSyncConfig
};
