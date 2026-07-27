'use strict';

const path = require('path');
const { readJson, writeJson } = require('./json-store');

/**
 * Named presets for multi-character setups:
 * custom buffs + capture toggles + overlay density/warning.
 */
function createCharacterPresetStore({ localDataDir }) {
  function filePath() {
    return path.join(localDataDir(), 'character_presets.json');
  }

  function loadAll() {
    const raw = readJson(filePath(), { presets: [] });
    const list = Array.isArray(raw.presets) ? raw.presets : [];
    return list
      .map((item) => normalizePreset(item))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function normalizePreset(item) {
    if (!item || typeof item !== 'object') return null;
    const id = String(item.id || '').trim() || `preset-${Date.now()}`;
    const name = String(item.name || '').trim() || '未命名预设';
    return {
      id,
      name,
      updatedAt: item.updatedAt || new Date().toISOString(),
      capture: item.capture && typeof item.capture === 'object' ? item.capture : {},
      custom_durations: item.custom_durations && typeof item.custom_durations === 'object'
        ? item.custom_durations
        : {},
      overlay: item.overlay && typeof item.overlay === 'object' ? item.overlay : {},
      note: String(item.note || '').trim(),
      // Window title used for multi-client auto-apply when selecting a process.
      windowTitle: String(item.windowTitle || '').trim()
    };
  }

  function saveAll(presets) {
    const cleaned = (presets || []).map(normalizePreset).filter(Boolean);
    writeJson(filePath(), { presets: cleaned });
    return cleaned;
  }

  function upsert(preset) {
    const next = normalizePreset({
      ...preset,
      updatedAt: new Date().toISOString()
    });
    const all = loadAll();
    const idx = all.findIndex((p) => p.id === next.id);
    if (idx >= 0) all[idx] = next;
    else all.unshift(next);
    return { presets: saveAll(all), preset: next };
  }

  function remove(id) {
    const target = String(id || '');
    const all = loadAll().filter((p) => p.id !== target);
    return { presets: saveAll(all) };
  }

  return {
    filePath,
    loadAll,
    upsert,
    remove
  };
}

module.exports = { createCharacterPresetStore };
