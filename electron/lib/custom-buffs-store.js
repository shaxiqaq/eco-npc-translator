'use strict';

const path = require('path');
const { readJson, writeJson } = require('./json-store');

function positiveSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function skillIdFromKey(key) {
  let text = String(key || '').trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  for (const prefix of ['skill:', 'cd:']) {
    if (lowered.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }
  if (!/^\d+$/.test(text)) return null;
  const skillId = Number(text);
  return Number.isInteger(skillId) && skillId > 0 ? skillId : null;
}

function looksLikeSkillKey(key) {
  const text = String(key || '').trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  if (lowered.startsWith('skill:') || lowered.startsWith('cd:')) return true;
  return /^\d+$/.test(text);
}

function normalizeCustomBuffEntry(key, value) {
  const name = String(key || '').trim();
  if (!name) return null;
  let duration = null;
  let cooldown = null;
  let skillId = null;
  let label = null;
  let overlay = null;

  if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) {
    const seconds = positiveSeconds(value);
    if (seconds == null) return null;
    if (looksLikeSkillKey(name)) {
      cooldown = seconds;
      skillId = skillIdFromKey(name);
    } else {
      duration = seconds;
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    duration = positiveSeconds(value.duration);
    cooldown = positiveSeconds(value.cooldown ?? value.cd);
    const rawSkill = Number(value.skill_id);
    skillId = Number.isInteger(rawSkill) && rawSkill > 0 ? rawSkill : null;
    label = String(value.label || value.name || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(value, 'overlay')) {
      overlay = Boolean(value.overlay);
    }
  } else {
    return null;
  }

  if (skillId == null) skillId = skillIdFromKey(name);
  if (duration == null && cooldown == null) return null;

  const entry = {};
  if (duration != null) entry.duration = duration;
  if (cooldown != null) entry.cooldown = cooldown;
  if (skillId != null) entry.skill_id = skillId;
  if (label) entry.label = label;
  if (skillId != null) entry.overlay = overlay == null ? true : Boolean(overlay);
  return entry;
}

function normalizeCustomBuffMap(raw) {
  const cleaned = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const entry = normalizeCustomBuffEntry(key, value);
    if (!entry) continue;
    cleaned[String(key).trim()] = entry;
  }
  return cleaned;
}

/**
 * Local custom buff / skill CD overrides (per install userData).
 */
function createCustomBuffStore({ localDataDir }) {
  let cache = null;

  function filePath() {
    return path.join(localDataDir(), 'custom_buffs.json');
  }

  function load() {
    if (!cache) {
      cache = normalizeCustomBuffMap(readJson(filePath(), {}));
    }
    return cache;
  }

  function save(durations) {
    const cleaned = normalizeCustomBuffMap(durations);
    const target = filePath();
    writeJson(target, cleaned);
    cache = cleaned;
    return { durations: cleaned, path: target };
  }

  function invalidate() {
    cache = null;
    return load();
  }

  return {
    filePath,
    load,
    save,
    invalidate,
    normalize: normalizeCustomBuffMap
  };
}

module.exports = {
  createCustomBuffStore,
  normalizeCustomBuffEntry,
  normalizeCustomBuffMap,
  positiveSeconds,
  skillIdFromKey,
  looksLikeSkillKey
};
