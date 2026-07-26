'use strict';

const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('./json-store');
const { cacheNamespace } = require('./skill-icons');

function isLocalizedChineseLabel(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}

function isPlaceholderSkillLabel(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/^技能#\d+$/.test(value)) return true;
  if (value.startsWith('未命名') || value.startsWith('未确认')) return true;
  return false;
}

function preferredSkillLibraryName(...candidates) {
  const cleaned = candidates
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const gameLike = cleaned.find((value) => !isPlaceholderSkillLabel(value) && !isLocalizedChineseLabel(value));
  if (gameLike) return gameLike;
  const any = cleaned.find((value) => !isPlaceholderSkillLabel(value));
  return any || cleaned[0] || '';
}

function readSkillNameFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const name = fs.readFileSync(filePath, 'utf8').replace(/\0/g, '').trim();
    return name || null;
  } catch {
    return null;
  }
}

function sortLibraryList(list) {
  return [...list].sort((a, b) => {
    if ((b.last_used || 0) !== (a.last_used || 0)) return (b.last_used || 0) - (a.last_used || 0);
    return (b.count || 0) - (a.count || 0);
  });
}

/**
 * Recent skill chips library under userData/skill_library.json.
 */
function createSkillLibraryStore({
  localDataDir,
  dataDir,
  getSkillIconService,
  getSelectedGamePath,
  getAnyGamePath
}) {
  let listCache = null;

  function filePath() {
    return path.join(localDataDir(), 'skill_library.json');
  }

  function iconCacheRoot() {
    return path.join(dataDir(), 'skill-icons');
  }

  function resolveGameSkillNameSync(skillId) {
    const id = Number(skillId);
    if (!Number.isInteger(id) || id <= 0) return null;
    try {
      const skillIconService = getSkillIconService?.();
      if (skillIconService?.memory) {
        for (const [key, cached] of skillIconService.memory.entries()) {
          if (!key.endsWith(`|${id}`)) continue;
          if (cached?.ok && cached.name) {
            const name = String(cached.name).trim();
            if (name) return name;
          }
        }
      }
      const root = iconCacheRoot();
      if (fs.existsSync(root)) {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const name = readSkillNameFile(path.join(root, entry.name, `${id}.txt`));
          if (name) return name;
        }
      }
      let gamePath = getSelectedGamePath?.() || '';
      if (!gamePath) gamePath = getAnyGamePath?.() || '';
      if (gamePath) {
        const name = readSkillNameFile(path.join(root, cacheNamespace(gamePath), `${id}.txt`));
        if (name) return name;
      }
    } catch {
      // ignore
    }
    return null;
  }

  function normalize(raw) {
    const cleaned = {};
    for (const [key, value] of Object.entries(raw || {})) {
      const skillId = Number(value?.skill_id ?? key);
      if (!Number.isInteger(skillId) || skillId <= 0) continue;
      const gameName = resolveGameSkillNameSync(skillId);
      const name = preferredSkillLibraryName(
        gameName,
        value?.name,
        value?.skill,
        `技能#${skillId}`
      ) || `技能#${skillId}`;
      const count = Math.max(0, Math.floor(Number(value?.count) || 0));
      const lastUsed = Number(value?.last_used);
      cleaned[String(skillId)] = {
        skill_id: skillId,
        name,
        count,
        last_used: Number.isFinite(lastUsed) ? lastUsed : 0
      };
    }
    return cleaned;
  }

  function load() {
    return normalize(readJson(filePath(), {}));
  }

  function save(library) {
    const cleaned = normalize(library);
    writeJson(filePath(), cleaned);
    listCache = null;
    return cleaned;
  }

  function invalidateListCache() {
    listCache = null;
  }

  function rewriteWithCachedGameNames() {
    const library = load();
    let changed = false;
    for (const item of Object.values(library)) {
      const gameName = resolveGameSkillNameSync(item.skill_id);
      if (!gameName) continue;
      const next = preferredSkillLibraryName(gameName, item.name);
      if (next && next !== item.name) {
        item.name = next;
        changed = true;
      }
    }
    if (changed) save(library);
    return Object.values(library);
  }

  function listSorted() {
    if (listCache) return listCache;
    rewriteWithCachedGameNames();
    listCache = sortLibraryList(Object.values(load()));
    return listCache;
  }

  function rememberFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return load();
    const library = load();
    const now = Date.now() / 1000;
    const upsert = (skillId, name, { count, lastUsed } = {}) => {
      const id = Number(skillId);
      if (!Number.isInteger(id) || id <= 0) return;
      const prev = library[String(id)] || { skill_id: id, name: `技能#${id}`, count: 0, last_used: 0 };
      const gameName = resolveGameSkillNameSync(id);
      library[String(id)] = {
        skill_id: id,
        name: preferredSkillLibraryName(gameName, prev.name, name, `技能#${id}`) || prev.name,
        count: Math.max(Number(prev.count) || 0, Number(count) || 0),
        last_used: Math.max(Number(prev.last_used) || 0, Number(lastUsed) || 0)
      };
    };
    for (const item of snapshot.skill_casts || []) {
      upsert(item.skill_id, item.skill, { count: item.count, lastUsed: now });
    }
    for (const item of snapshot.skill_cast_history || []) {
      upsert(item.skill_id, item.skill, { count: 1, lastUsed: Number(item.ts) || now });
    }
    const ranked = sortLibraryList(Object.values(library)).slice(0, 200);
    const trimmed = {};
    for (const item of ranked) trimmed[String(item.skill_id)] = item;
    return save(trimmed);
  }

  async function enrichNames(libraryList) {
    const list = Array.isArray(libraryList) ? libraryList : Object.values(load());
    rewriteWithCachedGameNames();
    for (const item of list) {
      const gameName = resolveGameSkillNameSync(item.skill_id);
      if (gameName) item.name = preferredSkillLibraryName(gameName, item.name) || item.name;
    }

    let gamePath = getSelectedGamePath?.() || '';
    if (!gamePath) gamePath = getAnyGamePath?.() || '';
    const skillIconService = getSkillIconService?.();
    if (!gamePath || !skillIconService) {
      return sortLibraryList(Object.values(load()));
    }

    const library = load();
    let changed = false;
    await Promise.all(list.slice(0, 80).map(async (item) => {
      const id = Number(item?.skill_id);
      if (!Number.isInteger(id) || id <= 0) return;
      try {
        const result = await skillIconService.getIcon(id, gamePath);
        const gameName = String(result?.name || '').trim() || resolveGameSkillNameSync(id);
        if (!gameName) return;
        const prev = library[String(id)] || { skill_id: id, name: `技能#${id}`, count: 0, last_used: 0 };
        const nextName = preferredSkillLibraryName(gameName, prev.name, item.name);
        if (nextName && nextName !== prev.name) {
          library[String(id)] = { ...prev, name: nextName };
          changed = true;
        }
        item.name = nextName || item.name;
      } catch {
        // ignore
      }
    }));
    if (changed) save(library);
    return sortLibraryList(Object.values(load()));
  }

  return {
    filePath,
    load,
    save,
    listSorted,
    invalidateListCache,
    rememberFromSnapshot,
    rewriteWithCachedGameNames,
    enrichNames,
    resolveGameSkillNameSync,
    preferredSkillLibraryName
  };
}

module.exports = {
  createSkillLibraryStore,
  preferredSkillLibraryName,
  isLocalizedChineseLabel,
  isPlaceholderSkillLabel
};
