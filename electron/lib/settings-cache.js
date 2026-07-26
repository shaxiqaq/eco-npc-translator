'use strict';

const path = require('path');
const { mergeDeep, readJson, writeJson } = require('./json-store');

/**
 * In-memory app settings cache to avoid re-reading app_settings.json on every
 * publicState() / broadcastState() call.
 */
function createSettingsCache({ dataDir, defaults }) {
  let cache = null;
  let writeTimer = null;
  let pendingWrite = null;

  function filePath() {
    return path.join(dataDir(), 'app_settings.json');
  }

  function load() {
    cache = mergeDeep(defaults, readJson(filePath(), {}));
    return cache;
  }

  function get() {
    if (!cache) return load();
    return cache;
  }

  function invalidate() {
    cache = null;
    return get();
  }

  function replace(next) {
    cache = mergeDeep(defaults, next || {});
    return cache;
  }

  function patch(partial) {
    cache = mergeDeep(get(), partial || {});
    return cache;
  }

  function persistSync(value = get()) {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    pendingWrite = null;
    // Strip non-persistable runtime fields if callers left them on appearance.
    const toWrite = JSON.parse(JSON.stringify(value));
    if (toWrite.appearance) {
      delete toWrite.appearance.backgroundDataUrl;
      delete toWrite.appearance.backgroundFileUrl;
      delete toWrite.appearance.backgroundUrl;
      delete toWrite.appearance.overlayBackgroundDataUrl;
      delete toWrite.appearance.overlayBackgroundFileUrl;
      delete toWrite.appearance.overlayBackgroundUrl;
    }
    writeJson(filePath(), toWrite);
    cache = mergeDeep(defaults, toWrite);
    return cache;
  }

  /** Debounced disk write — good for rapid toggles. */
  function persist(value = get(), { debounceMs = 0 } = {}) {
    if (!debounceMs) return persistSync(value);
    pendingWrite = value;
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      if (pendingWrite) persistSync(pendingWrite);
    }, debounceMs);
    return get();
  }

  function flush() {
    if (writeTimer && pendingWrite) {
      clearTimeout(writeTimer);
      writeTimer = null;
      return persistSync(pendingWrite);
    }
    return get();
  }

  return {
    get,
    load,
    invalidate,
    replace,
    patch,
    persist,
    persistSync,
    flush
  };
}

module.exports = { createSettingsCache };
