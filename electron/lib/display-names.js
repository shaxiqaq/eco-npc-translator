'use strict';

const fs = require('fs');
const path = require('path');

function isGarbageName(value) {
  const text = String(value || '');
  if (!text.trim()) return true;
  if (/[\x00-\x1f\x7f]/.test(text)) return true;
  let pua = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0xe000 && code <= 0xf8ff) pua += 1;
  }
  return pua >= 3;
}

function looksJapanese(value) {
  return /[\u3040-\u30ff]/.test(String(value || ''));
}

function loadIdMap(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw || typeof raw !== 'object') return new Map();
    const map = new Map();
    for (const [key, value] of Object.entries(raw)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id <= 0) continue;
      if (typeof value !== 'string' || isGarbageName(value)) continue;
      map.set(id, value.trim());
    }
    return map;
  } catch {
    return new Map();
  }
}

function createDisplayNameService({ dataDir, resDir }) {
  let zh = new Map();
  let ja = new Map();
  let loaded = false;

  function resolvePath(name) {
    const candidates = [
      path.join(dataDir(), name),
      path.join(resDir(), name),
      path.join(resDir(), 'data', name)
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }

  function reload() {
    zh = loadIdMap(resolvePath('skill_names.json'));
    ja = loadIdMap(resolvePath('skill_names_ja.json'));
    for (const [id, name] of zh.entries()) {
      if (!ja.has(id) && looksJapanese(name)) ja.set(id, name);
    }
    loaded = true;
    return { zh: zh.size, ja: ja.size };
  }

  function ensureLoaded() {
    if (!loaded) reload();
  }

  function formatSkill(skillId, mode = 'client', preferName = '') {
    ensureLoaded();
    const id = Number(skillId);
    if (!Number.isInteger(id) || id <= 0) return preferName || '未知';
    const client = zh.get(id) || '';
    const jp = ja.get(id) || '';
    const prefer = String(preferName || '').trim();
    const m = String(mode || 'client').toLowerCase();

    if (prefer && !isGarbageName(prefer)) {
      if (m === 'dual' && jp && jp !== prefer) return `${prefer} / ${jp}`;
      if (m === 'ja' && jp) return jp;
      return prefer;
    }
    if (m === 'ja') return jp || client || `技能#${id}`;
    if (m === 'dual') {
      if (client && jp && client !== jp) return `${client} / ${jp}`;
      return client || jp || `技能#${id}`;
    }
    return client || jp || `技能#${id}`;
  }

  function wikiSearchUrl(name) {
    const q = String(name || '').split(' / ')[0].trim();
    if (!q || q.startsWith('技能#')) return 'https://eco.lycolia.info/wiki/?Skill';
    return `https://eco.lycolia.info/wiki/?cmd=search&word=${encodeURIComponent(q)}`;
  }

  function statusWikiUrl() {
    return 'https://eco.lycolia.info/wiki/?StatusBuff';
  }

  function loadJobPresets() {
    ensureLoaded();
    try {
      const p = resolvePath('job_timer_presets.json');
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(raw?.presets)) return raw.presets;
      if (Array.isArray(raw)) return raw;
    } catch {
      // ignore
    }
    return [];
  }

  return {
    reload,
    formatSkill,
    wikiSearchUrl,
    statusWikiUrl,
    loadJobPresets,
    getZh: (id) => {
      ensureLoaded();
      return zh.get(Number(id)) || '';
    },
    getJa: (id) => {
      ensureLoaded();
      return ja.get(Number(id)) || '';
    }
  };
}

module.exports = {
  createDisplayNameService,
  isGarbageName,
  looksJapanese
};
