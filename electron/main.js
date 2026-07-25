const { app, BrowserWindow, ipcMain, shell, screen, dialog, nativeImage, protocol, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { pathToFileURL } = require('url');
const { listGameProcesses } = require('./lib/game-processes');
const { mergeDeep, readJson, writeJson } = require('./lib/json-store');
const { SkillIconService } = require('./lib/skill-icons');
const { UpdateService, initialUpdateState } = require('./lib/update-service');
const { XiaoyaCoreService } = require('./lib/xiaoya-core-service');
const { createLogger } = require('./lib/logger');

const log = createLogger('main');

// Must be registered before app is ready so renderer can load wallpapers without base64 IPC.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'eco-bg',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

const isDemo = process.env.ECO_UI_DEMO === '1';
const services = { damage: null, translator: null };
const serviceState = {
  damage: { state: 'stopped', message: '尚未启动' },
  translator: { state: 'stopped', message: '尚未启动' }
};
// Shared Frida capture backend can serve either damage collection or status monitoring.
// These intents are independent; the process stays up while either is wanted.
let damageCollectionWanted = false;
const logs = [];
let mainWindow = null;
let overlayWindow = null;
let latestSnapshot = null;
let overlayEditing = false;
let demoTimer = null;
let gameProcesses = [];
let selectedGamePid = null;
let updateService = null;
let skillIconService = null;
let xiaoyaService = null;
let gracefulQuitStarted = false;
let gracefulQuitComplete = false;

const defaultAppSettings = {
  game: {
    pid: null
  },
  capture: {
    skill: true,
    normal: true,
    pet: true,
    taken: true
  },
  overlay: {
    visible: true,
    monitoring: true,
    x: null,
    y: null,
    width: 430,
    height: 115,
    opacity: 1,
    scale: 1,
    expiryWarningSeconds: 10
  },
  startup: {
    damage: false,
    translator: false,
    overlay: true,
    monitoring: true
  },
  appearance: {
    // relative to userData; empty = solid theme
    backgroundImage: '',
    backgroundFit: 'cover', // cover | contain | fill
    backgroundDim: 0.52,
    backgroundBlur: 6,
    // Overlay wallpaper: follow main | solid dark | custom image
    overlayBgMode: 'follow', // follow | solid | custom
    overlayBackgroundImage: '',
    overlayBackgroundDim: 0.62,
    overlayBackgroundBlur: 4,
    overlayBackgroundFit: 'cover',
    // legacy (migrated into overlayBgMode)
    applyToOverlay: true,
    accent: 'amber' // amber | teal | violet | rose | cyan | slate
  },
  updates: {
    checkOnStartup: true
  }
};

function dataDir() {
  return app.getPath('userData');
}

function backendDir() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
}

/** Source Python/Frida scripts live under repo/src in development. */
function srcDir() {
  if (app.isPackaged) return backendDir();
  const candidate = path.join(backendDir(), 'src');
  return fs.existsSync(candidate) ? candidate : backendDir();
}

/** Writable toolbox data: packaged userData, or repo/data in development. */
function localDataDir() {
  if (app.isPackaged) return dataDir();
  const devData = path.join(backendDir(), 'data');
  try {
    if (fs.existsSync(devData)) return devData;
  } catch {
    // fall through
  }
  return backendDir();
}

function appSettings() {
  return mergeDeep(defaultAppSettings, readJson(path.join(dataDir(), 'app_settings.json')));
}

function backgroundsDir() {
  const dir = path.join(dataDir(), 'backgrounds');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}

function mimeFromExt(ext) {
  const value = String(ext || '').toLowerCase();
  if (value === '.png') return 'image/png';
  if (value === '.webp') return 'image/webp';
  if (value === '.gif') return 'image/gif';
  if (value === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

const WALLPAPER_MAX_EDGE = 1920;
const WALLPAPER_JPEG_QUALITY = 82;
const WALLPAPER_INLINE_MAX_BYTES = 350 * 1024;

function safeBackgroundRel(rel) {
  const normalized = String(rel || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('..')) return '';
  return normalized;
}

function backgroundProtocolUrl(rel) {
  const clean = safeBackgroundRel(rel);
  if (!clean) return '';
  // eco-bg://local/backgrounds/wallpaper.jpg
  return `eco-bg://local/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Import a user-selected image as a compressed wallpaper under userData/backgrounds.
 * Large PNG/JPEG sources are resized and saved as JPEG so UI + IPC stay responsive.
 * @param {string} srcPath
 * @param {'main'|'overlay'} kind
 */
function importWallpaperImage(srcPath, kind = 'main') {
  const src = String(srcPath || '');
  if (!src || !fs.existsSync(src)) {
    throw new Error('源图片不存在');
  }

  const dir = backgroundsDir();
  const prefix = kind === 'overlay' ? 'overlay-wallpaper' : 'wallpaper';
  // Unique name avoids Windows file locks / stale renderer cache when replacing.
  const stamp = Date.now().toString(36);
  let destName = `${prefix}-${stamp}.jpg`;
  let dest = path.join(dir, destName);

  let image = nativeImage.createFromPath(src);
  if (image.isEmpty()) {
    // nativeImage may fail on some formats; fall back to raw copy with unique name.
    const ext = path.extname(src).toLowerCase() || '.img';
    destName = `${prefix}-${stamp}${ext}`;
    dest = path.join(dir, destName);
    fs.copyFileSync(src, dest);
  } else {
    const size = image.getSize();
    const longest = Math.max(size.width || 0, size.height || 0);
    if (longest > WALLPAPER_MAX_EDGE) {
      const scale = WALLPAPER_MAX_EDGE / longest;
      image = image.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'best'
      });
    }
    const jpeg = image.toJPEG(WALLPAPER_JPEG_QUALITY);
    if (!jpeg || !jpeg.length) {
      throw new Error('图片压缩失败');
    }
    fs.writeFileSync(dest, jpeg);
  }

  // Clean older wallpaper files of the same kind only.
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file === destName) continue;
      const isOverlay = /^overlay-wallpaper/i.test(file);
      const isMain = /^(custom|wallpaper)[-_.]/i.test(file) && !isOverlay;
      if ((kind === 'overlay' && isOverlay) || (kind !== 'overlay' && isMain)) {
        try { fs.unlinkSync(path.join(dir, file)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  return path.join('backgrounds', destName).replace(/\\/g, '/');
}

/** Multi-entry cache so main + overlay wallpapers can resolve in one state pass. */
const appearanceImageCacheMap = new Map();

function loadBackgroundImagePayload(rel) {
  const normalized = safeBackgroundRel(rel);
  if (!normalized) {
    return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
  }
  const abs = path.isAbsolute(normalized) ? normalized : path.join(dataDir(), normalized);
  // Prevent path escape outside userData when relative.
  if (!path.isAbsolute(normalized)) {
    const root = path.resolve(dataDir()).toLowerCase();
    if (!path.resolve(abs).toLowerCase().startsWith(root)) {
      return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
    }
  }
  if (!fs.existsSync(abs)) {
    return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
  }
  try {
    const stat = fs.statSync(abs);
    const mtime = stat.mtimeMs;
    const protocolUrl = backgroundProtocolUrl(normalized);
    const cached = appearanceImageCacheMap.get(abs);
    if (cached && cached.mtime === mtime && cached.protocolUrl) {
      return {
        backgroundImage: normalized,
        backgroundDataUrl: cached.dataUrl,
        backgroundFileUrl: cached.fileUrl,
        backgroundUrl: cached.protocolUrl
      };
    }

    const fileUrl = pathToFileURL(abs).href;
    // Only inline tiny files as data URL (preview fallback); large files use eco-bg://.
    let dataUrl = '';
    if (stat.size > 0 && stat.size <= WALLPAPER_INLINE_MAX_BYTES) {
      const data = fs.readFileSync(abs);
      dataUrl = `data:${mimeFromExt(path.extname(abs))};base64,${data.toString('base64')}`;
    }
    appearanceImageCacheMap.set(abs, { mtime, dataUrl, fileUrl, protocolUrl });
    return {
      backgroundImage: normalized,
      backgroundDataUrl: dataUrl,
      backgroundFileUrl: fileUrl,
      backgroundUrl: protocolUrl
    };
  } catch (error) {
    log.warn('loadBackgroundImagePayload failed', error?.message || error);
    return { backgroundImage: '', backgroundDataUrl: '', backgroundFileUrl: '', backgroundUrl: '' };
  }
}

function normalizeOverlayBgMode(appearance = {}) {
  const mode = String(appearance.overlayBgMode || '').trim();
  if (mode === 'follow' || mode === 'solid' || mode === 'custom') return mode;
  // Migrate legacy boolean.
  if (appearance.applyToOverlay === false) return 'solid';
  return 'follow';
}

function clampDim(value, fallback = 0.52) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(0.9, Math.max(0.1, n)) : fallback;
}

function clampBlur(value, fallback = 6) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(24, Math.max(0, n)) : fallback;
}

function clampFit(value, fallback = 'cover') {
  const fit = String(value || fallback);
  return ['cover', 'contain', 'fill'].includes(fit) ? fit : fallback;
}

function resolveAppearanceBackground(settings = appSettings()) {
  const appearance = settings.appearance || {};
  const main = loadBackgroundImagePayload(appearance.backgroundImage);
  const overlay = loadBackgroundImagePayload(appearance.overlayBackgroundImage);
  const overlayBgMode = normalizeOverlayBgMode(appearance);
  return {
    ...defaultAppSettings.appearance,
    ...appearance,
    ...main,
    overlayBgMode,
    applyToOverlay: overlayBgMode !== 'solid',
    overlayBackgroundImage: overlay.backgroundImage,
    overlayBackgroundUrl: overlay.backgroundUrl,
    overlayBackgroundDataUrl: overlay.backgroundDataUrl,
    overlayBackgroundFileUrl: overlay.backgroundFileUrl,
    overlayBackgroundDim: clampDim(appearance.overlayBackgroundDim, 0.62),
    overlayBackgroundBlur: clampBlur(appearance.overlayBackgroundBlur, 4),
    overlayBackgroundFit: clampFit(appearance.overlayBackgroundFit, 'cover')
  };
}

function stripAppearanceRuntimeFields(appearance) {
  if (!appearance || typeof appearance !== 'object') return;
  delete appearance.backgroundDataUrl;
  delete appearance.backgroundFileUrl;
  delete appearance.backgroundUrl;
  delete appearance.overlayBackgroundDataUrl;
  delete appearance.overlayBackgroundFileUrl;
  delete appearance.overlayBackgroundUrl;
}

function registerBackgroundProtocol() {
  protocol.handle('eco-bg', async (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.replace(/^\/+/, '').split('/').map((part) => decodeURIComponent(part));
      const rel = parts.join('/');
      const clean = safeBackgroundRel(rel);
      if (!clean) return new Response('Not Found', { status: 404 });
      const abs = path.join(dataDir(), clean);
      const root = path.resolve(dataDir()).toLowerCase();
      if (!path.resolve(abs).toLowerCase().startsWith(root) || !fs.existsSync(abs)) {
        return new Response('Not Found', { status: 404 });
      }
      return net.fetch(pathToFileURL(abs).href);
    } catch (error) {
      return new Response(String(error?.message || 'error'), { status: 500 });
    }
  });
}

/** Recompress oversized legacy wallpapers once so old custom.png keeps working. */
function migrateLegacyWallpaperIfNeeded() {
  try {
    const current = appSettings();
    const rel = safeBackgroundRel(current.appearance?.backgroundImage);
    if (!rel) return;
    const abs = path.isAbsolute(rel) ? rel : path.join(dataDir(), rel);
    if (!fs.existsSync(abs)) return;
    const size = fs.statSync(abs).size;
    if (size <= WALLPAPER_INLINE_MAX_BYTES * 4) return; // ~1.4MB ok with protocol
    // Still recompress very large sources for faster decode.
    if (size < 2 * 1024 * 1024) return;
    const nextRel = importWallpaperImage(abs);
    current.appearance = {
      ...defaultAppSettings.appearance,
      ...(current.appearance || {}),
      backgroundImage: nextRel
    };
    delete current.appearance.backgroundDataUrl;
    delete current.appearance.backgroundFileUrl;
    delete current.appearance.backgroundUrl;
    writeJson(path.join(dataDir(), 'app_settings.json'), current);
    appearanceImageCacheMap.clear();
    log.info(`Migrated large wallpaper ${rel} -> ${nextRel}`);
  } catch (error) {
    log.warn('Wallpaper migrate skipped', error?.message || error);
  }
}

function translationSettings() {
  const root = localDataDir();
  const translation = readJson(path.join(root, 'translate_config.json'));
  const sync = readJson(path.join(root, 'sync_config.json'));
  return {
    provider: translation.provider || 'deepseek',
    model: translation.model || 'deepseek-chat',
    base_url: translation.base_url || 'https://api.deepseek.com',
    api_key: translation.api_key || '',
    first_wait: Number(translation.first_wait || 0),
    target_lang: translation.target_lang || 'zh-CN',
    player_names: Array.isArray(translation.player_names) ? translation.player_names : [],
    toggle_hotkey: translation.toggle_hotkey || 'f9',
    skip_hotkey: translation.skip_hotkey || 'f8',
    sync_enabled: Boolean(sync.enabled),
    sync_url: sync.url || '',
    sync_token: sync.token || ''
  };
}

function processSelectionLocked() {
  return Object.values(services).some(Boolean)
    || Object.values(serviceState).some((service) => ['starting', 'running', 'stopping'].includes(service.state));
}

function customBuffsPath() {
  // Per-user local file only — no cross-user / cross-path migration.
  // - installed app: %APPDATA%\eco-toolbox\custom_buffs.json
  // - source/dev:     <repo>\data\custom_buffs.json
  return path.join(localDataDir(), 'custom_buffs.json');
}

function skillLibraryPath() {
  return path.join(localDataDir(), 'skill_library.json');
}

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
    // Legacy: skill-like keys stored a bare number as CD; buff keys as duration.
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
  // Skill rows default to overlay=true so existing configs keep showing until unchecked.
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

function loadCustomBuffDurations() {
  // Only this install/user's own file.
  return normalizeCustomBuffMap(readJson(customBuffsPath(), {}));
}

function saveCustomBuffDurations(durations) {
  const cleaned = normalizeCustomBuffMap(durations);
  const target = customBuffsPath();
  writeJson(target, cleaned);
  return { durations: cleaned, path: target };
}

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
  // Prefer game-facing English/JP labels over localized Chinese dictionary names.
  const gameLike = cleaned.find((value) => !isPlaceholderSkillLabel(value) && !isLocalizedChineseLabel(value));
  if (gameLike) return gameLike;
  const any = cleaned.find((value) => !isPlaceholderSkillLabel(value));
  return any || cleaned[0] || '';
}

function skillIconCacheRoot() {
  return path.join(dataDir(), 'skill-icons');
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

function resolveGameSkillNameSync(skillId) {
  const id = Number(skillId);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    // 1) In-memory extracts from current session.
    if (skillIconService?.memory) {
      for (const [key, cached] of skillIconService.memory.entries()) {
        if (!key.endsWith(`|${id}`)) continue;
        if (cached?.ok && cached.name) {
          const name = String(cached.name).trim();
          if (name) return name;
        }
      }
    }
    // 2) Any on-disk client name cache, independent of whether eco.exe path is known.
    const root = skillIconCacheRoot();
    if (fs.existsSync(root)) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = readSkillNameFile(path.join(root, entry.name, `${id}.txt`));
        if (name) return name;
      }
    }
    // 3) Preferred cache namespace for current/selected game path.
    let gamePath = selectedGameProcess()?.path || '';
    if (!gamePath) {
      const fallback = gameProcesses.find((item) => item.path);
      gamePath = fallback?.path || '';
    }
    if (gamePath) {
      const { cacheNamespace } = require('./lib/skill-icons');
      const name = readSkillNameFile(path.join(root, cacheNamespace(gamePath), `${id}.txt`));
      if (name) return name;
    }
  } catch {
    // ignore cache read errors
  }
  return null;
}

function normalizeSkillLibrary(raw) {
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

function loadSkillLibrary() {
  return normalizeSkillLibrary(readJson(skillLibraryPath(), {}));
}

function saveSkillLibrary(library) {
  const cleaned = normalizeSkillLibrary(library);
  const target = skillLibraryPath();
  writeJson(target, cleaned);
  return cleaned;
}

function rememberSkillsFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return loadSkillLibrary();
  const library = loadSkillLibrary();
  const now = Date.now() / 1000;
  const upsert = (skillId, name, { count, lastUsed } = {}) => {
    const id = Number(skillId);
    if (!Number.isInteger(id) || id <= 0) return;
    const prev = library[String(id)] || { skill_id: id, name: `技能#${id}`, count: 0, last_used: 0 };
    const gameName = resolveGameSkillNameSync(id);
    // Never let Chinese dictionary labels overwrite a known game-client name.
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
  // Cap library size to recent / frequent skills.
  const ranked = Object.values(library).sort((a, b) => {
    if ((b.last_used || 0) !== (a.last_used || 0)) return (b.last_used || 0) - (a.last_used || 0);
    return (b.count || 0) - (a.count || 0);
  }).slice(0, 200);
  const trimmed = {};
  for (const item of ranked) trimmed[String(item.skill_id)] = item;
  return saveSkillLibrary(trimmed);
}

function rewriteSkillLibraryWithCachedGameNames() {
  const library = loadSkillLibrary();
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
  if (changed) saveSkillLibrary(library);
  return Object.values(library);
}

async function enrichSkillLibraryNames(libraryList) {
  const list = Array.isArray(libraryList) ? libraryList : Object.values(loadSkillLibrary());
  // First pass: apply any already-cached client names (no game path required).
  rewriteSkillLibraryWithCachedGameNames();
  for (const item of list) {
    const gameName = resolveGameSkillNameSync(item.skill_id);
    if (gameName) item.name = preferredSkillLibraryName(gameName, item.name) || item.name;
  }

  let gamePath = selectedGameProcess()?.path || '';
  if (!gamePath) {
    const fallback = gameProcesses.find((item) => item.path);
    gamePath = fallback?.path || '';
  }
  if (!gamePath || !skillIconService) {
    return Object.values(loadSkillLibrary()).sort((a, b) => {
      if ((b.last_used || 0) !== (a.last_used || 0)) return (b.last_used || 0) - (a.last_used || 0);
      return (b.count || 0) - (a.count || 0);
    });
  }

  const library = loadSkillLibrary();
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
      // ignore extract failures
    }
  }));
  if (changed) saveSkillLibrary(library);
  return Object.values(loadSkillLibrary()).sort((a, b) => {
    if ((b.last_used || 0) !== (a.last_used || 0)) return (b.last_used || 0) - (a.last_used || 0);
    return (b.count || 0) - (a.count || 0);
  });
}

function notifyDamageReloadCustomBuffs(durations) {
  const child = services.damage;
  if (!child?.stdin?.writable) return;
  try {
    const payload = durations && typeof durations === 'object' && !Array.isArray(durations)
      ? durations
      : loadCustomBuffDurations();
    child.stdin.write(`${JSON.stringify({
      action: 'reload-custom-buffs',
      durations: payload
    })}\n`);
  } catch (error) {
    log.warn('damage', `无法通知伤害服务重载自定义 buff: ${error.message}`);
  }
}

function isMonitoringWanted() {
  return appSettings().overlay?.monitoring !== false;
}

function captureBackendNeeded() {
  return Boolean(damageCollectionWanted || isMonitoringWanted());
}

function captureRoleMessage() {
  const mon = isMonitoringWanted();
  const dmg = damageCollectionWanted;
  const pid = selectedGamePid;
  if (dmg && mon) return `伤害采集与状态监控运行中（进程 ${pid}）`;
  if (dmg) return `伤害采集运行中（进程 ${pid}）`;
  if (mon) return `状态监控运行中（进程 ${pid}）`;
  return '已停止';
}

function publicServices() {
  const backend = serviceState.damage || { state: 'stopped', message: '尚未启动' };
  const monWanted = isMonitoringWanted();
  const dmgWanted = damageCollectionWanted;

  const mapIntent = (wanted, idleMessage) => {
    if (!wanted) {
      return {
        state: 'stopped',
        message: idleMessage,
        pid: null
      };
    }
    const message = backend.state === 'running'
      ? captureRoleMessage()
      : (backend.message || idleMessage);
    return {
      state: backend.state || 'stopped',
      message,
      pid: backend.pid || null
    };
  };

  return {
    damage: mapIntent(dmgWanted, '尚未启动'),
    monitoring: mapIntent(monWanted, '已关闭'),
    translator: serviceState.translator || { state: 'stopped', message: '尚未启动' }
  };
}

function publicState() {
  return {
    services: publicServices(),
    captureIntents: {
      damage: damageCollectionWanted,
      monitoring: isMonitoringWanted()
    },
    gameProcesses,
    selectedGamePid,
    processSelectionLocked: processSelectionLocked(),
    snapshot: latestSnapshot,
    settings: (() => {
      const settings = appSettings();
      return {
        ...settings,
        appearance: resolveAppearanceBackground(settings)
      };
    })(),
    translation: translationSettings(),
    custom_durations: loadCustomBuffDurations(),
    skill_library: (() => {
      rewriteSkillLibraryWithCachedGameNames();
      return Object.values(loadSkillLibrary()).sort((a, b) => {
        if ((b.last_used || 0) !== (a.last_used || 0)) return (b.last_used || 0) - (a.last_used || 0);
        return (b.count || 0) - (a.count || 0);
      });
    })(),
    xiaoya: xiaoyaService?.snapshot() || {
      available: false,
      state: 'stopped',
      message: '小雅服务尚未就绪',
      pid: null,
      running: false
    },
    update: updateService?.snapshot() || initialUpdateState(app.getVersion(), false),
    logs: logs.slice(-300)
  };
}

function persistSelectedGamePid(pid) {
  const settings = appSettings();
  settings.game.pid = pid;
  writeJson(path.join(dataDir(), 'app_settings.json'), settings);
}

async function refreshGameProcesses() {
  try {
    const found = isDemo
      ? [
          { pid: 1699, title: 'ECO - 角色一', started: '21:08:12', path: process.env.ECO_GAME_PATH || '' },
          { pid: 2840, title: 'ECO - 角色二', started: '21:16:45', path: process.env.ECO_GAME_PATH || '' }
        ]
      : await listGameProcesses();
    const previousPid = selectedGamePid;
    const configuredPid = Number(appSettings().game?.pid) || null;
    gameProcesses = found;
    selectedGamePid = [previousPid, configuredPid]
      .find((pid) => gameProcesses.some((process) => process.pid === pid))
      || gameProcesses.at(-1)?.pid
      || null;

    if (!isDemo && selectedGamePid !== configuredPid) persistSelectedGamePid(selectedGamePid);
    if (previousPid && selectedGamePid !== previousPid) latestSnapshot = null;
    broadcastState();
    return { ok: true, processes: gameProcesses, selectedPid: selectedGamePid };
  } catch (error) {
    gameProcesses = [];
    selectedGamePid = null;
    broadcastState();
    return { ok: false, error: `读取游戏进程失败：${error.message}`, processes: [] };
  }
}

function selectGameProcess(pid) {
  if (processSelectionLocked()) {
    return { ok: false, error: '请先停止伤害采集和 NPC 翻译，再切换游戏进程' };
  }
  const normalized = Number(pid);
  if (!gameProcesses.some((process) => process.pid === normalized)) {
    return { ok: false, error: '所选游戏进程已经退出，请刷新列表' };
  }
  selectedGamePid = normalized;
  latestSnapshot = null;
  if (!isDemo) persistSelectedGamePid(selectedGamePid);
  broadcastState();
  return { ok: true, selectedPid: selectedGamePid };
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, payload);
}

function broadcastState() {
  broadcast('app:state', publicState());
}

function addLog(service, level, message) {
  const entry = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), service, level, message };
  logs.push(entry);
  if (logs.length > 1000) logs.splice(0, logs.length - 1000);
  if (level === 'error') log.error(service, message);
  else if (level === 'warn' || level === 'warning') log.warn(service, message);
  else log.debug(service, message);
  broadcast('service:log', entry);
}

function setServiceState(name, state, message, extra = {}) {
  serviceState[name] = { state, message, ...extra };
  broadcastState();
}

function runtimeFor(name) {
  const processArgs = selectedGamePid ? ['--pid', String(selectedGamePid)] : [];
  if (!app.isPackaged) {
    const scriptName = name === 'damage' ? 'eco_damage_bridge.py' : 'eco_npc_mitm.py';
    const scriptPath = path.join(srcDir(), scriptName);
    return {
      command: process.env.ECO_PYTHON || 'python',
      args: ['-u', scriptPath, ...processArgs],
      cwd: srcDir()
    };
  }
  if (name === 'damage') {
    return {
      command: path.join(process.resourcesPath, 'backend', 'damage', 'eco_damage_bridge', 'eco_damage_bridge.exe'),
      args: processArgs,
      cwd: backendDir()
    };
  }
  return {
    command: path.join(process.resourcesPath, 'backend', 'translator', 'eco_npc_mitm', 'eco_npc_mitm.exe'),
    args: processArgs,
    cwd: backendDir()
  };
}

function handleDamageMessage(message) {
  if (message.type === 'snapshot') {
    latestSnapshot = message.data;
    rememberSkillsFromSnapshot(latestSnapshot);
    broadcast('damage:snapshot', latestSnapshot);
    return;
  }
  if (message.type === 'status') {
    let statusMessage = message.message || '';
    if (message.state === 'running') statusMessage = captureRoleMessage();
    setServiceState('damage', message.state, statusMessage, { pid: message.pid, log: message.log });
    addLog('damage', message.state === 'error' ? 'error' : 'info', statusMessage || message.state);
    return;
  }
  if (message.type === 'notice') addLog('damage', message.level || 'info', message.message || '');
}

function startCaptureBackend() {
  if (services.damage) return { ok: true };
  if (!selectedGamePid) {
    const error = '没有可用的 eco.exe，请启动游戏并刷新进程列表';
    setServiceState('damage', 'error', error);
    return { ok: false, error };
  }
  if (isDemo) {
    startDemo();
    return { ok: true };
  }

  const runtime = runtimeFor('damage');
  setServiceState('damage', 'starting', isMonitoringWanted() && !damageCollectionWanted
    ? '正在启动状态监控…'
    : '正在启动伤害采集…');
  const launchLabel = app.isPackaged
    ? path.basename(runtime.command)
    : path.basename(runtime.args?.[1] || runtime.command);
  addLog('damage', 'info', `启动 ${launchLabel}，连接游戏进程 ${selectedGamePid}`);
  try {
    if (!app.isPackaged) {
      const scriptPath = runtime.args?.[1];
      if (scriptPath && !fs.existsSync(scriptPath)) {
        const message = `找不到后端脚本：${scriptPath}`;
        setServiceState('damage', 'error', message);
        addLog('damage', 'error', message);
        return { ok: false, error: message };
      }
    }
    const pythonPath = [srcDir(), backendDir(), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const child = spawn(runtime.command, runtime.args, {
      cwd: runtime.cwd || srcDir(),
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        PYTHONPATH: pythonPath,
        ECO_DATA_DIR: localDataDir()
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    services.damage = child;

    if (child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({
        action: 'set-categories',
        categories: appSettings().capture
      })}\n`);
    }
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        handleDamageMessage(JSON.parse(line));
      } catch {
        if (line.trim()) addLog('damage', 'info', line.trim());
      }
    });

    const errors = readline.createInterface({ input: child.stderr });
    errors.on('line', (line) => line.trim() && addLog('damage', 'error', line.trim()));

    child.on('error', (error) => {
      addLog('damage', 'error', error.message);
      setServiceState('damage', 'error', error.message);
    });
    child.on('exit', (code) => {
      services.damage = null;
      if (serviceState.damage.state !== 'error') {
        setServiceState('damage', 'stopped', code === 0 ? '已停止' : `已退出（代码 ${code}）`);
      }
      // If an intent is still wanted (e.g. crash), leave state for UI; user can re-toggle.
    });
    return { ok: true };
  } catch (error) {
    services.damage = null;
    setServiceState('damage', 'error', error.message);
    return { ok: false, error: error.message };
  }
}

function stopCaptureBackend({ waitMs = 12000, force = false } = {}) {
  if (isDemo) {
    stopDemo();
    return Promise.resolve({ ok: true });
  }
  const child = services.damage;
  if (!child) {
    setServiceState('damage', 'stopped', '已停止');
    return Promise.resolve({ ok: true });
  }
  return stopChildGracefully('damage', child, { waitMs });
}

async function reconcileCaptureBackend({ waitMs = 12000 } = {}) {
  const needed = captureBackendNeeded();
  if (needed) {
    if (!services.damage && !(isDemo && demoTimer)) {
      return startCaptureBackend();
    }
    if (services.damage && serviceState.damage.state === 'running') {
      setServiceState('damage', 'running', captureRoleMessage(), { pid: selectedGamePid });
    } else {
      broadcastState();
    }
    return { ok: true };
  }
  if (services.damage || (isDemo && demoTimer)) {
    return stopCaptureBackend({ waitMs });
  }
  broadcastState();
  return { ok: true };
}

function startService(name) {
  if (!['damage', 'translator'].includes(name)) return { ok: false, error: '未知服务' };
  if (name === 'damage') {
    damageCollectionWanted = true;
    return reconcileCaptureBackend();
  }
  if (services[name]) return { ok: true };
  if (!selectedGamePid) {
    const error = '没有可用的 eco.exe，请启动游戏并刷新进程列表';
    setServiceState(name, 'error', error);
    return { ok: false, error };
  }

  const runtime = runtimeFor(name);
  setServiceState(name, 'starting', '正在启动');
  const launchLabel = app.isPackaged
    ? path.basename(runtime.command)
    : path.basename(runtime.args?.[1] || runtime.command);
  addLog(name, 'info', `启动 ${launchLabel}，连接游戏进程 ${selectedGamePid}`);
  try {
    if (!app.isPackaged) {
      const scriptPath = runtime.args?.[1];
      if (scriptPath && !fs.existsSync(scriptPath)) {
        const message = `找不到后端脚本：${scriptPath}`;
        setServiceState(name, 'error', message);
        addLog(name, 'error', message);
        return { ok: false, error: message };
      }
    }
    const pythonPath = [srcDir(), backendDir(), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const child = spawn(runtime.command, runtime.args, {
      cwd: runtime.cwd || srcDir(),
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        PYTHONPATH: pythonPath,
        ECO_DATA_DIR: localDataDir()
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    services[name] = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (line.trim()) addLog(name, 'info', line.trim());
      if (line.includes('attach')) setServiceState(name, 'running', `NPC 翻译正在运行（进程 ${selectedGamePid}）`, { pid: selectedGamePid });
      if (line.includes('没有运行中的 eco.exe')) setServiceState(name, 'error', '没有找到 eco.exe，请先进入游戏');
      if (line.includes('指定的 eco.exe 进程不存在')) setServiceState(name, 'error', '所选游戏进程已经退出，请刷新后重选');
      if (line.includes('还没有配置翻译服务')) setServiceState(name, 'error', '请先完成翻译设置');
    });

    const errors = readline.createInterface({ input: child.stderr });
    errors.on('line', (line) => line.trim() && addLog(name, 'error', line.trim()));

    child.on('error', (error) => {
      addLog(name, 'error', error.message);
      setServiceState(name, 'error', error.message);
    });
    child.on('exit', (code) => {
      services[name] = null;
      if (serviceState[name].state !== 'error') {
        setServiceState(name, 'stopped', code === 0 ? '已停止' : `已退出（代码 ${code}）`);
      }
    });
    setTimeout(() => {
      if (services[name] === child && serviceState[name].state === 'starting') {
        setServiceState(name, 'running', `NPC 翻译正在运行（进程 ${selectedGamePid}）`, { pid: selectedGamePid });
      }
    }, 1600);
    return { ok: true };
  } catch (error) {
    services[name] = null;
    setServiceState(name, 'error', error.message);
    return { ok: false, error: error.message };
  }
}

function requestGracefulStop(name, child) {
  // Prefer a cooperative stop so Frida can unload hooks before the agent dies.
  // IMPORTANT on Windows: Node's child.kill() is an unconditional process kill
  // (no POSIX SIGTERM). Never kill a Frida host mid-attach — that crashes eco.exe.
  try {
    if (child.stdin && child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({ action: 'stop' })}\n`);
      // Translator also accepts a bare "stop" line.
      if (name === 'translator') child.stdin.write('stop\n');
      // Closing stdin also signals EOF to Python bridges (extra stop path).
      try { child.stdin.end(); } catch { /* ignore */ }
    }
  } catch {
    // ignore broken pipe
  }
}

function forceKillChild(child) {
  // Last resort only. On Windows this aborts Python without running Frida teardown.
  if (!child || child.killed || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/f'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

function waitForChildExit(child, waitMs = 12000) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode != null) {
      resolve(true);
      return;
    }
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve(ok);
    };
    const onExit = () => done(true);
    child.once('exit', onExit);
    const poll = setInterval(() => {
      if (!child || child.killed || child.exitCode != null) done(true);
    }, 100);
    const timer = setTimeout(() => {
      try { child.removeListener('exit', onExit); } catch { /* ignore */ }
      done(false);
    }, waitMs);
  });
}

async function stopChildGracefully(name, child, { waitMs = 12000 } = {}) {
  if (!child) return { ok: true };
  setServiceState(name, 'stopping', '正在安全卸载抓包钩子…');
  addLog(name, 'info', '正在安全断开 Frida（Windows 上不会强杀后端，避免游戏闪退）…');
  requestGracefulStop(name, child);

  // Wait for Python to finish dispose()+unload()+detach() and exit by itself.
  // On Windows, child.kill() === force kill and must NOT be used while attached.
  const exited = await waitForChildExit(child, waitMs);
  if (exited) {
    addLog(name, 'info', '后端已安全退出，钩子应已卸载');
    return { ok: true };
  }

  // Still alive: send stop once more via a best-effort signal only on non-Windows.
  if (process.platform !== 'win32') {
    addLog(name, 'info', `后端 ${waitMs}ms 内未退出，发送 SIGTERM…`);
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const exitedSoft = await waitForChildExit(child, 3000);
    if (exitedSoft) {
      addLog(name, 'info', '后端已在 SIGTERM 后退出');
      return { ok: true };
    }
  }

  // Absolute last resort — may still risk the game if Frida is mid-teardown.
  addLog(name, 'warn', '后端仍未退出；最后尝试强制结束（仅后端，不杀游戏）。若仍闪退请先点停止采集再关工具箱。');
  forceKillChild(child);
  await waitForChildExit(child, 2000);
  // Extra settle so the game can recover packet IO if hooks were already detached.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { ok: true };
}

function stopService(name, { waitMs = 12000 } = {}) {
  if (name === 'damage') {
    // Only release damage-collection intent; status monitoring may keep the backend alive.
    damageCollectionWanted = false;
    return reconcileCaptureBackend({ waitMs });
  }
  const child = services[name];
  if (!child) return Promise.resolve({ ok: true });
  return stopChildGracefully(name, child, { waitMs });
}

async function stopAllBackends({ waitMs = 12000 } = {}) {
  damageCollectionWanted = false;
  // Force-stop capture even if monitoring intent is still set (app is quitting).
  await stopCaptureBackend({ waitMs, force: true });
  await stopService('translator', { waitMs });
  return { ok: true };
}

function resetDamage() {
  const child = services.damage;
  if (child && child.stdin.writable) child.stdin.write(`${JSON.stringify({ action: 'reset' })}\n`);
  if (isDemo) latestSnapshot = demoSnapshot(0);
  return { ok: Boolean(child || isDemo) };
}

async function prepareForUpdateInstall() {
  stopDemo();
  await stopAllBackends({ waitMs: 12000 });
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
}

const OVERLAY_MIN_WIDTH = 240;
const OVERLAY_MIN_HEIGHT = 90;
const OVERLAY_DEFAULT_WIDTH = 430;
const OVERLAY_DEFAULT_HEIGHT = 115;

function clampOverlayOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return 1;
  return Math.min(1, Math.max(0.2, opacity));
}

function overlayBounds(settings = {}) {
  const display = screen.getPrimaryDisplay().workArea;
  const scale = Math.min(1.4, Math.max(0.8, Number(settings.scale) || 1));
  let width = Number(settings.width);
  let height = Number(settings.height);
  if (!Number.isFinite(width) || width < OVERLAY_MIN_WIDTH) {
    width = Math.round(OVERLAY_DEFAULT_WIDTH * scale);
  }
  if (!Number.isFinite(height) || height < OVERLAY_MIN_HEIGHT) {
    height = Math.round(OVERLAY_DEFAULT_HEIGHT * scale);
  }
  width = Math.min(display.width, Math.max(OVERLAY_MIN_WIDTH, Math.round(width)));
  height = Math.min(display.height, Math.max(OVERLAY_MIN_HEIGHT, Math.round(height)));
  const x = Number.isFinite(settings.x) ? settings.x : display.x + display.width - width - 28;
  const y = Number.isFinite(settings.y) ? settings.y : display.y + 56;
  return { x, y, width, height };
}

function createOverlayWindow() {
  const settings = appSettings().overlay;
  overlayWindow = new BrowserWindow({
    ...overlayBounds(settings),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    hasShadow: false,
    minWidth: OVERLAY_MIN_WIDTH,
    minHeight: OVERLAY_MIN_HEIGHT,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setOpacity(clampOverlayOpacity(settings.opacity));
  overlayWindow.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  overlayWindow.once('ready-to-show', () => {
    if (settings.visible && appSettings().startup.overlay !== false) overlayWindow.showInactive();
  });
  if (process.env.ECO_CAPTURE_OVERLAY_PATH) {
    overlayWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      const image = await overlayWindow.webContents.capturePage();
      fs.writeFileSync(process.env.ECO_CAPTURE_OVERLAY_PATH, image.toPNG());
      app.quit();
    }, 1800));
  }
  overlayWindow.on('moved', persistOverlayBounds);
  overlayWindow.on('resized', persistOverlayBounds);
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function persistOverlayBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const current = appSettings();
  const bounds = overlayWindow.getBounds();
  current.overlay = {
    ...current.overlay,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
  writeJson(path.join(dataDir(), 'app_settings.json'), current);
}

function setOverlayEditing(editing) {
  if (!overlayWindow) return false;
  overlayEditing = Boolean(editing);
  overlayWindow.setIgnoreMouseEvents(!overlayEditing, { forward: true });
  overlayWindow.setFocusable(overlayEditing);
  // Only allow mouse resize while editing; keep click-through when idle.
  overlayWindow.setResizable(overlayEditing);
  overlayWindow.webContents.send('overlay:editing', overlayEditing);
  if (overlayEditing) {
    overlayWindow.show();
    overlayWindow.focus();
  } else {
    persistOverlayBounds();
    overlayWindow.showInactive();
  }
  broadcastState();
  return true;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 790,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#111315',
    title: 'ECO 工具箱',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (process.env.ECO_CAPTURE_PATH) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.ECO_CAPTURE_PAGE) {
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('[data-page="${process.env.ECO_CAPTURE_PAGE}"]')?.click()`
        );
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      if (process.env.ECO_CAPTURE_SETTINGS_TAB) {
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('[data-settings-tab="${process.env.ECO_CAPTURE_SETTINGS_TAB}"]')?.click()`
        );
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(process.env.ECO_CAPTURE_PATH, image.toPNG());
      beginGracefulShutdown('capture-done');
    }, 1800));
  }
  // Intercept the X button / Alt+F4: hide UI, unload Frida, THEN quit.
  // Closing the window without this race-kills the Python bridge and can crash eco.exe.
  mainWindow.on('close', (event) => {
    if (gracefulQuitComplete) return;
    event.preventDefault();
    beginGracefulShutdown('window-close');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function demoSnapshot(seed) {
  const now = new Date();
  const nowSeconds = Date.now() / 1000;
  const hits = [
    { side: 'dealt', skill_id: 3001, skill: '法箭', damage: 283, source: '自己#1699', target: '沙地爬行者#11460' },
    { side: 'normal_dealt', skill_id: null, skill: '普通攻击', damage: 21, source: '自己#1699', target: '沙地爬行者#11434' },
    { side: 'pet_dealt', skill_id: 7505, skill: '钝吧！', damage: 30, source: '宠物#4412', target: '沙地爬行者#11434' },
    { side: 'taken', skill_id: null, skill: '普通攻击', damage: 7, source: '沙地爬行者#11434', target: '自己#1699' }
  ].map((item, index) => ({
    ...item,
    side: item.side === 'normal_dealt' ? 'dealt' : item.side,
    time: new Date(now - index * 1100).toLocaleTimeString('zh-CN', { hour12: false }),
    source_kind: item.skill_id ? '技能结果包' : '伤害包'
  }));
  return {
    elapsed: 72 + seed,
    active: 48 + seed,
    self_id: 1699,
    dealt: 1159 + seed * 3,
    taken: 26,
    skill_dealt: 878 + seed * 2,
    normal_dealt: 281 + seed,
    skill_taken: 0,
    normal_taken: 26,
    pet_dealt: 146 + seed,
    pet_skill_dealt: 90,
    pet_normal_dealt: 56 + seed,
    hits_skill_dealt: 4,
    hits_normal_dealt: 23,
    hits_skill_taken: 0,
    hits_normal_taken: 6,
    hits_pet_dealt: 9,
    max_skill_dealt: 354,
    max_normal_dealt: 23,
    max_taken: 7,
    max_pet_dealt: 30,
    skill_dps: 18.29,
    normal_dps: 5.85,
    pet_dps: 3.04,
    dps: 24.14,
    tps: 0.54,
    skills_dealt: [[3127, 354], [3001, 283], [3123, 240]],
    skills_taken: [],
    pet_skills: [[7505, 90]],
    damage_history: hits,
    buffs: [
      { key: 'magic_shield', name: '魔法护盾', source_name: 'MAGIC_SHIELD', category: 'positive', skill_id: 3114, timing: 'estimated_observed', started_at: nowSeconds - 72, expires_at: nowSeconds + 828, elapsed: 72, remaining: 828 },
      { key: '3:0x00000020', name: '魔法攻击力上升', source_name: 'MAGIC_ATK_UP', category: 'positive', timing: 'elapsed_only', started_at: nowSeconds - 31, expires_at: null, elapsed: 31, remaining: null },
      { key: '4:0x00000008', name: '移动速度下降', source_name: 'SPEED_DOWN', category: 'negative', timing: 'elapsed_only', started_at: nowSeconds - 14, expires_at: null, elapsed: 14, remaining: null },
      { key: '0:0x00000004', name: '沉默', source_name: 'SILENCE', category: 'abnormal', timing: 'estimated_learned', started_at: nowSeconds - 5, expires_at: nowSeconds + 11, elapsed: 5, remaining: 11 }
    ],
    buff_history: [
      { event: 'gained', time: nowSeconds - 72, key: 'magic_shield', name: '魔法护盾', category: 'positive', skill_id: 3114 },
      { event: 'gained', time: nowSeconds - 31, key: '3:0x00000020', name: '魔法攻击力上升', category: 'positive' },
      { event: 'gained', time: nowSeconds - 14, key: '4:0x00000008', name: '移动速度下降', category: 'negative' },
      { event: 'gained', time: nowSeconds - 5, key: '0:0x00000004', name: '沉默', category: 'abnormal' }
    ],
    buff_version: 4,
    skill_cooldowns: [
      {
        key: 'skill_cd:2100',
        skill_id: 2100,
        skill: 'パリイ',
        name: 'パリイ',
        category: 'cooldown',
        timing: 'custom',
        started_at: nowSeconds - 8,
        expires_at: nowSeconds + 22,
        duration: 30,
        elapsed: 8,
        remaining: 22
      }
    ],
    skill_effect_timers: [
      {
        key: 'skill_effect:2100',
        skill_id: 2100,
        skill: 'パリイ',
        name: 'パリイ',
        category: 'skill_duration',
        timing: 'custom',
        started_at: nowSeconds - 1,
        expires_at: nowSeconds + 2,
        duration: 3,
        elapsed: 1,
        remaining: 2
      }
    ],
    skill_casts: [
      { skill_id: 2100, skill: 'パリイ', count: 4, role: 'defensive' },
      { skill_id: 3114, skill: '魔法护盾', count: 1, role: 'self' }
    ]
  };
}

function selectedGameProcess() {
  return gameProcesses.find((process) => process.pid === selectedGamePid) || null;
}

function startDemo() {
  if (demoTimer) return;
  let seed = 0;
  setServiceState('damage', 'running', '演示数据正在运行', { pid: selectedGamePid });
  latestSnapshot = demoSnapshot(seed);
  rememberSkillsFromSnapshot(latestSnapshot);
  broadcast('damage:snapshot', latestSnapshot);
  demoTimer = setInterval(() => {
    seed += 1;
    latestSnapshot = demoSnapshot(seed);
    rememberSkillsFromSnapshot(latestSnapshot);
    broadcast('damage:snapshot', latestSnapshot);
  }, 1000);
}

function stopDemo() {
  clearInterval(demoTimer);
  demoTimer = null;
  setServiceState('damage', 'stopped', '演示数据已停止');
}

ipcMain.handle('app:get-state', () => publicState());
ipcMain.handle('game-processes:refresh', () => refreshGameProcesses());
ipcMain.handle('game-processes:select', (_event, pid) => selectGameProcess(pid));
ipcMain.handle('service:start', (_event, name) => startService(name));
ipcMain.handle('service:stop', (_event, name) => stopService(name));
ipcMain.handle('damage:reset', () => resetDamage());
ipcMain.handle('update:check', () => updateService?.check() || { ok: false, error: '更新服务尚未就绪' });
ipcMain.handle('update:download', () => updateService?.download() || { ok: false, error: '更新服务尚未就绪' });
ipcMain.handle('update:install', async () => {
  if (!updateService) return { ok: false, error: '更新服务尚未就绪' };
  if (updateService.snapshot().phase !== 'downloaded') return { ok: false, error: '更新尚未下载完成' };
  await prepareForUpdateInstall();
  return updateService.install();
});
ipcMain.handle('overlay:set-visible', (_event, visible) => {
  const current = appSettings();
  current.overlay.visible = Boolean(visible);
  writeJson(path.join(dataDir(), 'app_settings.json'), current);
  if (visible) overlayWindow?.showInactive(); else overlayWindow?.hide();
  return { ok: true };
});
ipcMain.handle('overlay:set-editing', (_event, editing) => ({ ok: setOverlayEditing(editing) }));
ipcMain.handle('overlay:resize-content', (_event, requestedHeight) => {
  // Window size is user-controlled (drag resize in edit mode). Content scrolls inside.
  if (!overlayWindow || overlayWindow.isDestroyed() || overlayEditing) return { ok: true };
  const settings = appSettings().overlay;
  const hasCustomSize = Number.isFinite(Number(settings.width)) && Number.isFinite(Number(settings.height));
  if (hasCustomSize) return { ok: true, height: overlayWindow.getBounds().height };
  const scale = Math.min(1.4, Math.max(0.8, Number(settings.scale) || 1));
  const display = screen.getDisplayMatching(overlayWindow.getBounds()).workArea;
  const height = Math.min(
    display.height - 24,
    Math.max(OVERLAY_MIN_HEIGHT, Math.round(OVERLAY_DEFAULT_HEIGHT * scale), Math.round(Number(requestedHeight || OVERLAY_DEFAULT_HEIGHT) * scale))
  );
  const bounds = overlayWindow.getBounds();
  overlayWindow.setBounds({
    x: bounds.x,
    y: Math.min(bounds.y, display.y + display.height - height),
    width: bounds.width,
    height
  });
  return { ok: true, height };
});
ipcMain.handle('overlay:resize-delta', (_event, dx, dy) => {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayEditing) return { ok: false };
  const bounds = overlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(display.width, Math.max(OVERLAY_MIN_WIDTH, Math.round(bounds.width + Number(dx || 0))));
  const height = Math.min(display.height, Math.max(OVERLAY_MIN_HEIGHT, Math.round(bounds.height + Number(dy || 0))));
  if (width === bounds.width && height === bounds.height) return { ok: true, ...bounds };
  overlayWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  return { ok: true, x: bounds.x, y: bounds.y, width, height };
});
ipcMain.handle('skill-icon:get', (_event, skillId) => {
  // Prefer the selected process path; fall back to any known eco.exe path.
  // When eco is not running, SkillIconService still serves disk cache icons.
  let gamePath = selectedGameProcess()?.path || '';
  if (!gamePath) {
    const fallback = gameProcesses.find((item) => item.path);
    gamePath = fallback?.path || '';
  }
  return skillIconService?.getIcon(skillId, gamePath) || Promise.resolve({ ok: false, reason: 'unavailable' });
});
ipcMain.handle('settings:save-app', (_event, incoming) => {
  const current = mergeDeep(appSettings(), incoming || {});
  if (current.overlay) {
    current.overlay.opacity = clampOverlayOpacity(current.overlay.opacity);
    const scale = Math.min(1.4, Math.max(0.8, Number(current.overlay.scale) || 1));
    current.overlay.scale = scale;
    if (Number.isFinite(Number(current.overlay.width))) {
      current.overlay.width = Math.max(OVERLAY_MIN_WIDTH, Math.round(Number(current.overlay.width)));
    }
    if (Number.isFinite(Number(current.overlay.height))) {
      current.overlay.height = Math.max(OVERLAY_MIN_HEIGHT, Math.round(Number(current.overlay.height)));
    }
  }
  if (current.appearance) {
    current.appearance.backgroundDim = clampDim(current.appearance.backgroundDim, 0.52);
    current.appearance.backgroundBlur = clampBlur(current.appearance.backgroundBlur, 6);
    current.appearance.backgroundFit = clampFit(current.appearance.backgroundFit, 'cover');
    current.appearance.overlayBgMode = normalizeOverlayBgMode(current.appearance);
    current.appearance.applyToOverlay = current.appearance.overlayBgMode !== 'solid';
    current.appearance.overlayBackgroundDim = clampDim(current.appearance.overlayBackgroundDim, 0.62);
    current.appearance.overlayBackgroundBlur = clampBlur(current.appearance.overlayBackgroundBlur, 4);
    current.appearance.overlayBackgroundFit = clampFit(current.appearance.overlayBackgroundFit, 'cover');
    current.appearance.overlayBackgroundImage = safeBackgroundRel(current.appearance.overlayBackgroundImage);
    if (current.appearance.overlayBgMode !== 'custom') {
      // Keep custom image on disk/settings so switching back restores it.
    }
    const accent = String(current.appearance.accent || 'amber');
    current.appearance.accent = ['amber', 'teal', 'violet', 'rose', 'cyan', 'slate'].includes(accent)
      ? accent
      : 'amber';
    // Never persist runtime image payloads into settings.
    stripAppearanceRuntimeFields(current.appearance);
  }
  writeJson(path.join(dataDir(), 'app_settings.json'), current);
  if (incoming?.capture && services.damage?.stdin?.writable) {
    services.damage.stdin.write(`${JSON.stringify({
      action: 'set-categories',
      categories: current.capture
    })}\n`);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    const bounds = overlayWindow.getBounds();
    const next = overlayBounds(current.overlay);
    // Keep current position if user already placed the window; only apply size from settings.
    overlayWindow.setBounds({
      x: Number.isFinite(current.overlay.x) ? next.x : bounds.x,
      y: Number.isFinite(current.overlay.y) ? next.y : bounds.y,
      width: next.width,
      height: next.height
    });
    overlayWindow.setOpacity(clampOverlayOpacity(current.overlay.opacity));
    overlayWindow.webContents.send('app:state', publicState());
  }
  // Status monitoring can start/stop the shared capture backend independently of damage collection.
  if (incoming?.overlay && Object.prototype.hasOwnProperty.call(incoming.overlay, 'monitoring')) {
    reconcileCaptureBackend();
  } else {
    broadcastState();
  }
  return {
    ok: true,
    settings: {
      ...current,
      appearance: resolveAppearanceBackground(current)
    }
  };
});

ipcMain.handle('appearance:pick-background', async (_event, target = 'main') => {
  const kind = target === 'overlay' ? 'overlay' : 'main';
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: kind === 'overlay' ? '选择悬浮窗背景图片' : '选择背景图片',
    properties: ['openFile'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
    ]
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, cancelled: true };
  }
  let rel = '';
  try {
    rel = importWallpaperImage(result.filePaths[0], kind);
  } catch (error) {
    return { ok: false, error: error.message || '导入背景图失败' };
  }
  appearanceImageCacheMap.clear();
  const current = appSettings();
  if (kind === 'overlay') {
    current.appearance = {
      ...defaultAppSettings.appearance,
      ...(current.appearance || {}),
      overlayBgMode: 'custom',
      overlayBackgroundImage: rel,
      applyToOverlay: true
    };
  } else {
    current.appearance = {
      ...defaultAppSettings.appearance,
      ...(current.appearance || {}),
      backgroundImage: rel
    };
  }
  stripAppearanceRuntimeFields(current.appearance);
  writeJson(path.join(dataDir(), 'app_settings.json'), current);
  broadcastState();
  return {
    ok: true,
    settings: {
      ...current,
      appearance: resolveAppearanceBackground(current)
    }
  };
});

ipcMain.handle('appearance:clear-background', (_event, target = 'main') => {
  const kind = target === 'overlay' ? 'overlay' : 'main';
  appearanceImageCacheMap.clear();
  const current = appSettings();
  if (kind === 'overlay') {
    current.appearance = {
      ...defaultAppSettings.appearance,
      ...(current.appearance || {}),
      overlayBackgroundImage: '',
      // Stay on custom mode with empty image → solid until user picks again,
      // or switch to solid for clarity.
      overlayBgMode: 'solid',
      applyToOverlay: false
    };
  } else {
    current.appearance = {
      ...defaultAppSettings.appearance,
      ...(current.appearance || {}),
      backgroundImage: ''
    };
  }
  stripAppearanceRuntimeFields(current.appearance);
  writeJson(path.join(dataDir(), 'app_settings.json'), current);
  // Best-effort cleanup of previous custom files of this kind.
  try {
    for (const file of fs.readdirSync(backgroundsDir())) {
      const isOverlay = /^overlay-wallpaper/i.test(file);
      const isMain = /^(custom|wallpaper)/i.test(file) && !isOverlay;
      if ((kind === 'overlay' && isOverlay) || (kind !== 'overlay' && isMain)) {
        try { fs.unlinkSync(path.join(backgroundsDir(), file)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  broadcastState();
  return {
    ok: true,
    settings: {
      ...current,
      appearance: resolveAppearanceBackground(current)
    }
  };
});
ipcMain.handle('settings:save-translation', (_event, incoming) => {
  const root = app.isPackaged ? dataDir() : backendDir();
  const translation = {
    provider: incoming.provider,
    model: incoming.model,
    base_url: incoming.base_url || '',
    api_key: incoming.api_key || '',
    first_wait: Number(incoming.first_wait || 0),
    target_lang: incoming.target_lang || 'zh-CN',
    player_names: incoming.player_names || [],
    toggle_hotkey: incoming.toggle_hotkey || '',
    skip_hotkey: incoming.skip_hotkey || ''
  };
  const sync = readJson(path.join(root, 'sync_config.json'));
  Object.assign(sync, {
    enabled: Boolean(incoming.sync_enabled),
    url: incoming.sync_url || '',
    token: incoming.sync_token || ''
  });
  if (!('pull_interval' in sync)) sync.pull_interval = 300;
  if (!('flush_interval' in sync)) sync.flush_interval = 20;
  if (!('pull_on_start' in sync)) sync.pull_on_start = true;
  writeJson(path.join(root, 'translate_config.json'), translation);
  writeJson(path.join(root, 'sync_config.json'), sync);
  addLog('translator', 'success', '翻译设置已保存，重新启动翻译后生效');
  broadcastState();
  return { ok: true };
});
ipcMain.handle('logs:open-folder', () => {
  const folder = path.join(localDataDir(), 'logs');
  fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
  return { ok: true };
});
ipcMain.handle('xiaoya:get-config', () => {
  if (!xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
  try {
    return { ok: true, skills: xiaoyaService.readConfig(), state: xiaoyaService.snapshot() };
  } catch (error) {
    return { ok: false, error: error.message, state: xiaoyaService.snapshot() };
  }
});
ipcMain.handle('xiaoya:save-config', (_event, skills) => {
  if (!xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
  try {
    const normalized = xiaoyaService.writeConfig(skills);
    addLog('xiaoya', 'success', '小雅技能配置已保存');
    return { ok: true, skills: normalized, state: xiaoyaService.snapshot() };
  } catch (error) {
    addLog('xiaoya', 'error', `保存小雅配置失败：${error.message}`);
    return { ok: false, error: error.message, state: xiaoyaService.snapshot() };
  }
});
ipcMain.handle('xiaoya:start', async () => {
  if (!xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
  const result = await xiaoyaService.start();
  addLog('xiaoya', result.ok ? 'info' : 'error', result.ok ? '正在启动小雅' : result.error);
  return result;
});
ipcMain.handle('xiaoya:stop', async () => {
  if (!xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
  const result = await xiaoyaService.stop();
  addLog('xiaoya', result.ok ? 'info' : 'error', result.ok ? '小雅停止请求已发送' : result.error);
  return result;
});
ipcMain.handle('xiaoya:toggle-ss', async () => {
  if (!xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
  const result = await xiaoyaService.toggleSs();
  addLog('xiaoya', result.ok ? 'info' : 'error', result.ok ? 'SS 模式切换已发送' : result.error);
  return result;
});
ipcMain.handle('xiaoya:toggle-visibility', async () => {
  if (!xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
  const result = await xiaoyaService.toggleVisibility();
  addLog(
    'xiaoya',
    result.ok ? 'info' : 'error',
    result.ok ? (result.visible ? 'ECO 窗口已显示' : 'ECO 窗口已隐藏') : result.error
  );
  return result;
});

ipcMain.handle('buffs:save-custom-durations', (_event, durations) => {
  try {
    const saved = saveCustomBuffDurations(durations);
    notifyDamageReloadCustomBuffs(saved.durations);
    addLog(
      'buffs',
      'success',
      `自定义倒计时已保存到本地（${Object.keys(saved.durations).length} 条）`
    );
    broadcastState();
    return {
      ok: true,
      custom_durations: saved.durations,
      path: saved.path
    };
  } catch (e) {
    addLog('buffs', 'error', `保存失败：${e.message}`);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('buffs:get-custom-durations', () => {
  const custom_durations = loadCustomBuffDurations();
  return {
    ok: true,
    custom_durations,
    path: customBuffsPath()
  };
});

ipcMain.handle('skills:get-library', async () => {
  // Force English/original client names from skill-icon cache before returning chips.
  const skill_library = await enrichSkillLibraryNames();
  return { ok: true, skill_library };
});

ipcMain.handle('xiaoya:open-folder', () => {

  if (!xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
  try {
    xiaoyaService.ensureRuntime();
    shell.openPath(xiaoyaService.runtimeDir);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  registerBackgroundProtocol();
  migrateLegacyWallpaperIfNeeded();
  xiaoyaService = new XiaoyaCoreService({
    corePath: path.join(
      app.isPackaged ? process.resourcesPath : __dirname,
      app.isPackaged ? 'xiaoya-core' : 'dist-native/xiaoya-core',
      'XiaoyaCore.exe'
    ),
    runtimeDir: path.join(dataDir(), 'xiaoya'),
    legacyConfigPath: path.join(
      app.isPackaged ? process.resourcesPath : backendDir(),
      '小雅',
      '小雅身体配置.ini'
    ),
    getTargetPid: () => selectedGamePid,
    onState: () => broadcastState(),
    onLog: (level, message) => addLog('xiaoya', level, message),
    onEvent: (event) => broadcast('xiaoya:event', event)
  });
  skillIconService = new SkillIconService({
    helperPath: path.join(
      app.isPackaged ? process.resourcesPath : __dirname,
      app.isPackaged ? 'icon-helper' : 'dist-native/icon-helper',
      'EcoIconHelper.exe'
    ),
    cacheDir: path.join(dataDir(), 'skill-icons')
  });
  updateService = new UpdateService({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    enabled: app.isPackaged && !isDemo,
    onState: (next) => broadcast('update:state', next)
  });
  createMainWindow();
  createOverlayWindow();
  await refreshGameProcesses();
  const settings = appSettings();
  // Damage collection and status monitoring are independent intents sharing one backend.
  if (settings.startup.damage) damageCollectionWanted = true;
  if (settings.startup.monitoring === false && settings.overlay?.monitoring !== false) {
    // Auto-start disabled: leave monitoring off until the user turns the switch on.
    const next = mergeDeep(settings, { overlay: { monitoring: false } });
    writeJson(path.join(dataDir(), 'app_settings.json'), next);
  }
  reconcileCaptureBackend();
  if (!isDemo) {
    if (settings.startup.translator) startService('translator');
    if (settings.updates.checkOnStartup) {
      setTimeout(() => updateService.check(), 3500);
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createOverlayWindow();
    }
  });
});

/**
 * Single exit path used by window close / app.quit / tray.
 * Hides UI immediately, waits for Frida teardown, then destroys windows and quits.
 */
function beginGracefulShutdown(reason = 'quit') {
  if (gracefulQuitComplete) {
    app.quit();
    return;
  }
  if (gracefulQuitStarted) return;
  gracefulQuitStarted = true;

  // Hide immediately so the user sees the app "close", while we still own the process
  // long enough to unload ws2_32 hooks from eco.exe.
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle('ECO 工具箱 - 正在安全断开…');
      mainWindow.hide();
    }
  } catch { /* ignore */ }
  try {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  } catch { /* ignore */ }

  stopDemo();
  addLog('app', 'info', `安全退出（${reason}）：先卸载抓包钩子，请稍候…`);

  Promise.resolve()
    .then(async () => {
      const hasBackends = Boolean(services.damage || services.translator || xiaoyaService?.child);
      if (hasBackends) {
        await stopAllBackends({ waitMs: 12000 });
      }
      if (xiaoyaService) {
        try { await xiaoyaService.stop(); } catch { /* ignore */ }
        try { xiaoyaService.dispose(); } catch { /* ignore */ }
      }
      // Let the game resume packet IO after detach.
      await new Promise((resolve) => setTimeout(resolve, 600));
    })
    .catch((error) => {
      try { addLog('app', 'warn', `安全退出过程异常：${error?.message || error}`); } catch { /* ignore */ }
    })
    .finally(() => {
      gracefulQuitComplete = true;
      try {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.destroy();
          overlayWindow = null;
        }
      } catch { /* ignore */ }
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.removeAllListeners('close');
          mainWindow.destroy();
          mainWindow = null;
        }
      } catch { /* ignore */ }
      app.quit();
    });
}

app.on('before-quit', (event) => {
  if (gracefulQuitComplete) return;
  // Always take over quit while backends may still be attached.
  event.preventDefault();
  beginGracefulShutdown('before-quit');
});

app.on('window-all-closed', () => {
  // Main window close is already handled; do not quit twice.
  if (gracefulQuitComplete) return;
  if (process.platform !== 'darwin') beginGracefulShutdown('window-all-closed');
});
