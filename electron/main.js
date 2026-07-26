const { app, BrowserWindow, ipcMain, shell, screen, dialog, nativeImage, protocol, net, Tray, Menu, globalShortcut, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
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
const { createSettingsCache } = require('./lib/settings-cache');
const { createStateBus } = require('./lib/state-bus');
const { collectDiagnostics, formatDiagnosticsText } = require('./lib/diagnostics');
const { buildBackendEnv } = require('./lib/backend-env');
const { isProcessElevated, buildConnectionHealth } = require('./lib/system-health');
const { createCharacterPresetStore } = require('./lib/character-presets');
const { buildConfigBundle, parseConfigBundle } = require('./lib/config-bundle');
const { classifyError } = require('./lib/error-codes');
const { installCrashHandlers } = require('./lib/crash-log');
const {
  createWallpaperService,
  safeBackgroundRel,
  clampDim,
  clampBlur,
  clampFit,
  normalizeOverlayBgMode,
  stripAppearanceRuntimeFields,
  WALLPAPER_INLINE_MAX_BYTES
} = require('./lib/wallpaper');
const { createCustomBuffStore } = require('./lib/custom-buffs-store');
const { createSkillLibraryStore } = require('./lib/skill-library-store');
const {
  stopChildGracefully: stopChildGracefullyImpl
} = require('./lib/child-lifecycle');
const { resolveBackendRuntime, launchLabel } = require('./lib/backend-runtime');
const { resolveSelectedPids } = require('./lib/process-selection');
const { filterLogs: filterLogsImpl, formatLogsExportBody } = require('./lib/logs-service');
const {
  OVERLAY_MIN_WIDTH,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_DEFAULT_HEIGHT,
  clampOverlayOpacity,
  overlayBounds: computeOverlayBounds
} = require('./lib/overlay-geometry');
const { demoSnapshot } = require('./lib/demo-snapshot');

const log = createLogger('main');

// Local crash dumps under userData/logs/crash (path resolved after app ready).
installCrashHandlers({
  getDataDir: () => {
    try {
      return app.isReady() ? app.getPath('userData') : path.join(process.cwd(), 'data');
    } catch {
      return path.join(process.cwd(), 'data');
    }
  },
  onCrash: (kind, reason, file) => {
    log.error('crash', `${kind}${file ? ` → ${file}` : ''}`, reason?.message || reason);
  }
});

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
/** Independent target for Xiaoya (often a secondary eco.exe). */
let selectedXiaoyaPid = null;
let updateService = null;
let skillIconService = null;
let xiaoyaService = null;
let gracefulQuitStarted = false;
let gracefulQuitComplete = false;
let appTray = null;
let processWatchTimer = null;
let elevatedCache = null;
let selectedProcessAlive = null;
let lastReconnectAt = 0;
let rememberedProcessTitle = '';

const defaultAppSettings = {
  game: {
    pid: null,
    // Separate from main toolbox PID: Xiaoya is usually bound to a multi-client alt.
    xiaoyaPid: null
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
    expiryWarningSeconds: 10,
    // comfortable | compact | large | expiring
    density: 'comfortable'
  },
  startup: {
    damage: false,
    translator: false,
    overlay: true,
    monitoring: true,
    tray: true,
    minimizeToTray: true,
    autoReconnect: true
  },
  hotkeys: {
    toggleOverlay: 'CommandOrControl+Shift+O',
    toggleWindow: 'CommandOrControl+Shift+E'
  },
  onboarding: {
    seenGuide: false
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

let settingsStore = null;
function getSettingsStore() {
  if (!settingsStore) {
    settingsStore = createSettingsCache({ dataDir, defaults: defaultAppSettings });
  }
  return settingsStore;
}

function appSettings() {
  return getSettingsStore().get();
}

function persistAppSettings(next, options) {
  return getSettingsStore().persist(next, options);
}

const wallpaper = createWallpaperService({
  dataDir,
  nativeImage,
  log
});

const customBuffStore = createCustomBuffStore({ localDataDir });
const skillLibraryStore = createSkillLibraryStore({
  localDataDir,
  dataDir,
  getSkillIconService: () => skillIconService,
  getSelectedGamePath: () => selectedGameProcess()?.path || '',
  getAnyGamePath: () => gameProcesses.find((item) => item.path)?.path || ''
});
const characterPresets = createCharacterPresetStore({ localDataDir });

function backgroundsDir() {
  return wallpaper.backgroundsDir();
}

function importWallpaperImage(srcPath, kind = 'main') {
  return wallpaper.importWallpaperImage(srcPath, kind);
}

function loadBackgroundImagePayload(rel) {
  return wallpaper.loadBackgroundImagePayload(rel);
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
    persistAppSettings(current);
    wallpaper.clearImageCache();
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
  return customBuffStore.filePath();
}

function skillLibraryPath() {
  return skillLibraryStore.filePath();
}

function loadCustomBuffDurations() {
  return customBuffStore.load();
}

function saveCustomBuffDurations(durations) {
  return customBuffStore.save(durations);
}

function loadSkillLibrary() {
  return skillLibraryStore.load();
}

function saveSkillLibrary(library) {
  return skillLibraryStore.save(library);
}

function skillLibraryListSorted() {
  return skillLibraryStore.listSorted();
}

function rememberSkillsFromSnapshot(snapshot) {
  return skillLibraryStore.rememberFromSnapshot(snapshot);
}

async function enrichSkillLibraryNames(libraryList) {
  return skillLibraryStore.enrichNames(libraryList);
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
      pid: backend.pid || null,
      errorCode: backend.errorCode || null,
      errorHint: backend.errorHint || null
    };
  };

  return {
    damage: mapIntent(dmgWanted, '尚未启动'),
    monitoring: mapIntent(monWanted, '已关闭'),
    translator: serviceState.translator || { state: 'stopped', message: '尚未启动' }
  };
}

function xiaoyaPublicSnapshot() {
  return xiaoyaService?.snapshot() || {
    available: false,
    state: 'stopped',
    message: '小雅服务尚未就绪',
    pid: null,
    running: false
  };
}

function settingsPublic(settings = appSettings()) {
  return {
    ...settings,
    appearance: resolveAppearanceBackground(settings)
  };
}

/**
 * Frequent broadcasts: no snapshot / logs (dedicated channels).
 * custom_durations + skill_library stay here but are memory-cached.
 */
function currentConnectionHealth() {
  return buildConnectionHealth({
    elevated: elevatedCache,
    selectedGamePid,
    selectedXiaoyaPid,
    gameProcesses,
    processAlive: selectedProcessAlive,
    services: publicServices(),
    damageWanted: damageCollectionWanted,
    monitoringWanted: isMonitoringWanted()
  });
}

function buildLightState() {
  return {
    services: publicServices(),
    captureIntents: {
      damage: damageCollectionWanted,
      monitoring: isMonitoringWanted()
    },
    gameProcesses,
    selectedGamePid,
    selectedXiaoyaPid,
    processSelectionLocked: processSelectionLocked(),
    settings: settingsPublic(),
    custom_durations: loadCustomBuffDurations(),
    skill_library: skillLibraryListSorted(),
    xiaoya: xiaoyaPublicSnapshot(),
    update: updateService?.snapshot() || initialUpdateState(app.getVersion(), false),
    connectionHealth: currentConnectionHealth(),
    characterPresets: characterPresets.loadAll()
  };
}

/** Initial hydrate via app:get-state. */
function buildFullState() {
  return {
    ...buildLightState(),
    snapshot: latestSnapshot,
    translation: translationSettings(),
    logs: logs.slice(-300)
  };
}

function publicState(options = {}) {
  return options.full === false ? buildLightState() : buildFullState();
}

const stateBus = createStateBus({
  getWindows: () => [mainWindow, overlayWindow],
  buildLightState,
  buildFullState
});

function persistSelectedGamePid(pid) {
  const settings = appSettings();
  settings.game = { ...(settings.game || {}), pid };
  persistAppSettings(settings);
}

function persistSelectedXiaoyaPid(pid) {
  const settings = appSettings();
  settings.game = { ...(settings.game || {}), xiaoyaPid: pid };
  persistAppSettings(settings);
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
    const previousXiaoyaPid = selectedXiaoyaPid;
    const settings = appSettings();
    const configuredPid = Number(settings.game?.pid) || null;
    const configuredXiaoyaPid = Number(settings.game?.xiaoyaPid) || null;
    gameProcesses = found;

    ({ selectedGamePid, selectedXiaoyaPid } = resolveSelectedPids({
      processes: gameProcesses,
      previousMainPid: previousPid,
      previousXiaoyaPid,
      configuredMainPid: configuredPid,
      configuredXiaoyaPid
    }));

    if (!isDemo && selectedGamePid !== configuredPid) persistSelectedGamePid(selectedGamePid);
    if (!isDemo && selectedXiaoyaPid !== configuredXiaoyaPid) persistSelectedXiaoyaPid(selectedXiaoyaPid);
    if (previousPid && selectedGamePid !== previousPid) latestSnapshot = null;
    broadcastState();
    return {
      ok: true,
      processes: gameProcesses,
      selectedPid: selectedGamePid,
      selectedXiaoyaPid
    };
  } catch (error) {
    gameProcesses = [];
    selectedGamePid = null;
    selectedXiaoyaPid = null;
    broadcastState();
    const classified = classifyError(`读取游戏进程失败：${error.message}`, { kind: 'enumerate' });
    return { ok: false, error: classified.message, errorCode: classified.code, processes: [] };
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
  const proc = gameProcesses.find((p) => p.pid === normalized);
  rememberedProcessTitle = proc?.title || rememberedProcessTitle || '';
  selectedProcessAlive = true;
  if (!isDemo) persistSelectedGamePid(selectedGamePid);
  broadcastState();
  return { ok: true, selectedPid: selectedGamePid };
}

function selectXiaoyaProcess(pid) {
  const normalized = Number(pid);
  if (!gameProcesses.some((process) => process.pid === normalized)) {
    return { ok: false, error: '所选游戏进程已经退出，请刷新列表' };
  }
  selectedXiaoyaPid = normalized;
  if (!isDemo) persistSelectedXiaoyaPid(selectedXiaoyaPid);

  // Hot-swap target while Xiaoya is already running.
  if (xiaoyaService && ['running', 'starting'].includes(xiaoyaService.state)) {
    xiaoyaService.applyTargetPidChange()
      .then((result) => {
        if (!result?.ok) addLog('xiaoya', 'error', result?.error || '切换小雅目标进程失败');
        else addLog('xiaoya', 'info', `小雅目标进程已切换为 ${selectedXiaoyaPid}`);
        broadcastState();
      })
      .catch((error) => {
        addLog('xiaoya', 'error', `切换小雅目标进程失败：${error.message}`);
        broadcastState();
      });
  } else {
    broadcastState();
  }
  return { ok: true, selectedXiaoyaPid };
}

function broadcast(channel, payload) {
  stateBus.send(channel, payload);
}

function broadcastState(options = {}) {
  stateBus.broadcastState({ immediate: Boolean(options.immediate) });
}

function addLog(service, level, message, options = {}) {
  const primary = String(service || 'app');
  const also = Array.isArray(options.also) ? options.also.map(String).filter(Boolean) : [];
  const channels = [...new Set([primary, ...also])];
  const entry = {
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    service: primary,
    channels,
    level,
    message
  };
  logs.push(entry);
  if (logs.length > 1000) logs.splice(0, logs.length - 1000);
  if (level === 'error') log.error(primary, message);
  else if (level === 'warn' || level === 'warning') log.warn(primary, message);
  else log.debug(primary, message);
  stateBus.broadcastLog(entry);
}

/** Shared capture backend can serve damage and/or monitoring — tag logs for both filters. */
function addCaptureLog(level, message) {
  const mon = isMonitoringWanted();
  const dmg = damageCollectionWanted;
  if (dmg && mon) return addLog('damage', level, message, { also: ['monitoring'] });
  if (mon && !dmg) return addLog('monitoring', level, message);
  return addLog('damage', level, message);
}

function filterLogs(filter = 'all') {
  return filterLogsImpl(logs, filter);
}

function setServiceState(name, state, message, extra = {}) {
  serviceState[name] = { state, message, ...extra };
  broadcastState();
}

/** Attach stable ECO_Exx code to service errors for remote support. */
function reportServiceError(name, rawMessage, context = {}) {
  const classified = classifyError(rawMessage, context);
  const extra = {
    errorCode: classified.code,
    errorHint: classified.hint,
    ...(context.extra || {})
  };
  setServiceState(name, 'error', classified.message, extra);
  if (name === 'damage') addCaptureLog('error', classified.message);
  else addLog(name, 'error', classified.message);
  return classified;
}

function runtimeFor(name) {
  return resolveBackendRuntime({
    name,
    selectedGamePid,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    srcDir: srcDir(),
    backendDir: backendDir()
  });
}

function handleDamageMessage(message) {
  if (message.type === 'snapshot') {
    latestSnapshot = message.data;
    rememberSkillsFromSnapshot(latestSnapshot);
    skillLibraryStore.invalidateListCache();
    stateBus.broadcastSnapshot(latestSnapshot);
    return;
  }
  if (message.type === 'status') {
    let statusMessage = message.message || '';
    if (message.state === 'running') statusMessage = captureRoleMessage();
    if (message.state === 'error') {
      reportServiceError('damage', statusMessage || message.state, {
        kind: message.error_code === 'ECO_E03' ? 'access' : undefined,
        extra: { pid: message.pid, log: message.log }
      });
      return;
    }
    setServiceState('damage', message.state, statusMessage, { pid: message.pid, log: message.log });
    addCaptureLog('info', statusMessage || message.state);
    return;
  }
  if (message.type === 'notice') addCaptureLog(message.level || 'info', message.message || '');
}

function startCaptureBackend() {
  if (services.damage) return { ok: true };
  if (!selectedGamePid) {
    const classified = reportServiceError(
      'damage',
      '没有可用的游戏进程，请启动游戏并刷新顶部进程列表',
      { kind: 'no-process' }
    );
    return { ok: false, error: classified.message, errorCode: classified.code };
  }
  if (!(gameProcesses || []).some((process) => process.pid === selectedGamePid)) {
    const classified = reportServiceError(
      'damage',
      `所选进程 ${selectedGamePid} 已不在列表中，请刷新后重新选择`,
      { kind: 'process-gone' }
    );
    return { ok: false, error: classified.message, errorCode: classified.code };
  }
  if (isDemo) {
    startDemo();
    return { ok: true };
  }

  const runtime = runtimeFor('damage');
  setServiceState('damage', 'starting', isMonitoringWanted() && !damageCollectionWanted
    ? '正在启动状态监控…'
    : '正在启动伤害采集…');
  const label = launchLabel(runtime, app.isPackaged);
  addCaptureLog('info', `启动 ${label}，连接游戏进程 ${selectedGamePid}`);
  try {
    if (!app.isPackaged) {
      const scriptPath = runtime.args?.[1];
      if (scriptPath && !fs.existsSync(scriptPath)) {
        const classified = reportServiceError('damage', `找不到后端脚本：${scriptPath}`, { kind: 'script-missing' });
        return { ok: false, error: classified.message, errorCode: classified.code };
      }
    }
    const child = spawn(runtime.command, runtime.args, {
      cwd: runtime.cwd || srcDir(),
      windowsHide: true,
      env: buildBackendEnv({
        srcDir: srcDir(),
        backendDir: backendDir(),
        dataDir: localDataDir()
      }),
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
        if (line.trim()) addCaptureLog('info', line.trim());
      }
    });

    const errors = readline.createInterface({ input: child.stderr });
    errors.on('line', (line) => line.trim() && addCaptureLog('error', line.trim()));

    child.on('error', (error) => {
      reportServiceError('damage', error.message, { kind: 'spawn' });
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
    const classified = reportServiceError('damage', error.message, { kind: 'spawn' });
    return { ok: false, error: classified.message, errorCode: classified.code };
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
    const classified = reportServiceError(name, '没有可用的 eco.exe，请启动游戏并刷新进程列表', { kind: 'no-process' });
    return { ok: false, error: classified.message, errorCode: classified.code };
  }

  const runtime = runtimeFor(name);
  setServiceState(name, 'starting', '正在启动');
  const label = launchLabel(runtime, app.isPackaged);
  addLog(name, 'info', `启动 ${label}，连接游戏进程 ${selectedGamePid}`);
  try {
    if (!app.isPackaged) {
      const scriptPath = runtime.args?.[1];
      if (scriptPath && !fs.existsSync(scriptPath)) {
        const classified = reportServiceError(name, `找不到后端脚本：${scriptPath}`, { kind: 'script-missing' });
        return { ok: false, error: classified.message, errorCode: classified.code };
      }
    }
    const child = spawn(runtime.command, runtime.args, {
      cwd: runtime.cwd || srcDir(),
      windowsHide: true,
      env: buildBackendEnv({
        srcDir: srcDir(),
        backendDir: backendDir(),
        dataDir: localDataDir()
      }),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    services[name] = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (line.trim()) addLog(name, 'info', line.trim());
      if (line.includes('attach')) setServiceState(name, 'running', `NPC 翻译正在运行（进程 ${selectedGamePid}）`, { pid: selectedGamePid });
      if (line.includes('没有运行中的 eco.exe')) {
        reportServiceError(name, '没有找到 eco.exe，请先进入游戏', { kind: 'no-process' });
      }
      if (line.includes('指定的 eco.exe 进程不存在')) {
        reportServiceError(name, '所选游戏进程已经退出，请刷新后重选', { kind: 'process-gone' });
      }
      if (line.includes('还没有配置翻译服务')) {
        reportServiceError(name, '请先完成翻译设置', { kind: 'translator-config' });
      }
    });

    const errors = readline.createInterface({ input: child.stderr });
    errors.on('line', (line) => line.trim() && addLog(name, 'error', line.trim()));

    child.on('error', (error) => {
      reportServiceError(name, error.message, { kind: 'spawn' });
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
    const classified = reportServiceError(name, error.message, { kind: 'spawn' });
    return { ok: false, error: classified.message, errorCode: classified.code };
  }
}

function stopChildGracefully(name, child, { waitMs = 12000 } = {}) {
  const logFn = name === 'damage' ? addCaptureLog : (level, message) => addLog(name, level, message);
  return stopChildGracefullyImpl({
    name,
    child,
    waitMs,
    log: logFn,
    setStopping: (state, message) => setServiceState(name, state, message)
  });
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

function overlayBounds(settings = {}) {
  return computeOverlayBounds(settings, screen.getPrimaryDisplay().workArea);
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

let overlayBoundsTimer = null;
function persistOverlayBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  // Drag/resize fires often — debounce disk writes via settings cache.
  if (overlayBoundsTimer) clearTimeout(overlayBoundsTimer);
  overlayBoundsTimer = setTimeout(() => {
    overlayBoundsTimer = null;
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
    persistAppSettings(current, { debounceMs: 120 });
  }, 180);
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

function appIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.ico')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
}

function createMainWindow() {
  const icon = appIconPath();
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 790,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#111315',
    title: 'ECO 工具箱',
    show: false,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    if (process.env.ECO_UI_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }
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
    const minimizeToTray = appSettings().startup?.minimizeToTray !== false
      && appSettings().startup?.tray !== false
      && appTray;
    if (minimizeToTray && !gracefulQuitStarted) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    event.preventDefault();
    beginGracefulShutdown('window-close');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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

async function refreshElevation() {
  elevatedCache = await isProcessElevated();
  return elevatedCache;
}

async function checkSelectedProcessAlive() {
  if (!selectedGamePid) {
    selectedProcessAlive = null;
    return null;
  }
  if (isDemo) {
    selectedProcessAlive = true;
    return true;
  }
  const inList = (gameProcesses || []).some((p) => Number(p.pid) === Number(selectedGamePid));
  if (inList) {
    selectedProcessAlive = true;
    return true;
  }
  try {
    const { execFile } = require('child_process');
    const alive = await new Promise((resolve) => {
      execFile(
        'tasklist',
        ['/FI', `PID eq ${selectedGamePid}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          resolve(String(stdout || '').includes(String(selectedGamePid)));
        }
      );
    });
    selectedProcessAlive = alive;
    return alive;
  } catch {
    selectedProcessAlive = inList;
    return inList;
  }
}

async function reconnectGameProcess({ reason = 'manual' } = {}) {
  const now = Date.now();
  if (now - lastReconnectAt < 1500) {
    return { ok: false, error: '重连过于频繁，请稍候' };
  }
  lastReconnectAt = now;
  addLog('app', 'info', `尝试重新连接游戏进程（${reason}）…`);
  const refresh = await refreshGameProcesses();
  if (!refresh.ok) {
    return { ok: false, error: refresh.error || '刷新进程失败' };
  }
  if (rememberedProcessTitle) {
    const match = (gameProcesses || []).find(
      (p) => String(p.title || '') === rememberedProcessTitle
    );
    if (match?.pid) {
      const selected = selectGameProcess(match.pid);
      if (!selected.ok) return selected;
    }
  }
  await checkSelectedProcessAlive();
  if (captureBackendNeeded()) {
    if (services.damage) {
      await stopCaptureBackend({ waitMs: 8000 });
    }
    const result = await reconcileCaptureBackend();
    if (!result?.ok) return result;
  }
  broadcastState({ immediate: true });
  return {
    ok: true,
    selectedPid: selectedGamePid,
    processAlive: selectedProcessAlive,
    health: currentConnectionHealth()
  };
}

function startProcessWatch() {
  if (processWatchTimer) clearInterval(processWatchTimer);
  processWatchTimer = setInterval(async () => {
    try {
      const prevAlive = selectedProcessAlive;
      await checkSelectedProcessAlive();
      const settings = appSettings();
      const auto = settings.startup?.autoReconnect !== false;
      const wanted = captureBackendNeeded();
      if (selectedGamePid && selectedProcessAlive === false && wanted && auto) {
        addLog('app', 'warn', `游戏进程 ${selectedGamePid} 已退出，正在自动重连…`);
        await reconnectGameProcess({ reason: 'auto' });
        return;
      }
      if (prevAlive !== selectedProcessAlive) {
        broadcastState();
      }
    } catch (error) {
      log.warn('process watch failed', error?.message || error);
    }
  }, 4000);
}

function toggleMainWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function toggleOverlayVisibleHotkey() {
  const current = appSettings();
  const next = !(current.overlay?.visible !== false);
  current.overlay = { ...(current.overlay || {}), visible: next };
  persistAppSettings(current);
  if (next) overlayWindow?.showInactive();
  else overlayWindow?.hide();
  broadcastState({ immediate: true });
}

function registerAppHotkeys() {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // ignore
  }
  const hotkeys = appSettings().hotkeys || {};
  const overlayAccel = String(hotkeys.toggleOverlay || '').trim();
  const windowAccel = String(hotkeys.toggleWindow || '').trim();
  if (overlayAccel) {
    try {
      globalShortcut.register(overlayAccel, () => toggleOverlayVisibleHotkey());
    } catch (error) {
      addLog('app', 'warn', `注册悬浮窗热键失败：${overlayAccel}（${error.message}）`);
    }
  }
  if (windowAccel) {
    try {
      globalShortcut.register(windowAccel, () => toggleMainWindowVisible());
    } catch (error) {
      addLog('app', 'warn', `注册主窗口热键失败：${windowAccel}（${error.message}）`);
    }
  }
}

function createAppTray() {
  if (appTray) {
    try { appTray.destroy(); } catch { /* ignore */ }
    appTray = null;
  }
  const settings = appSettings();
  if (settings.startup?.tray === false) return;
  const icon = appIconPath();
  if (!icon) return;
  try {
    appTray = new Tray(icon);
    appTray.setToolTip('ECO 工具箱');
    appTray.setContextMenu(Menu.buildFromTemplate([
      {
        label: '显示主窗口',
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
          else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { label: '显示/隐藏悬浮窗', click: () => toggleOverlayVisibleHotkey() },
      { label: '刷新游戏进程', click: () => { void refreshGameProcesses(); } },
      { label: '重新连接', click: () => { void reconnectGameProcess({ reason: 'tray' }); } },
      { type: 'separator' },
      { label: '退出', click: () => beginGracefulShutdown('tray-quit') }
    ]));
    appTray.on('double-click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    log.warn('tray create failed', error?.message || error);
  }
}

function getDiagnosticsPayload() {
  return collectDiagnostics({
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    selectedGamePid,
    selectedXiaoyaPid,
    gameProcesses,
    captureIntents: {
      damage: damageCollectionWanted,
      monitoring: isMonitoringWanted()
    },
    services: publicServices(),
    logs
  });
}

function buildDiagnosticsText() {
  const diag = getDiagnosticsPayload();
  const health = currentConnectionHealth();
  const lines = [
    formatDiagnosticsText(diag),
    '## connection health',
    JSON.stringify(health, null, 2),
    '',
    '## hints'
  ];
  for (const hint of health.hints || []) lines.push(`- ${hint}`);
  lines.push('');
  return lines.join('\n');
}

ipcMain.handle('app:get-state', () => publicState());
ipcMain.handle('app:get-diagnostics', () => ({
  ok: true,
  text: buildDiagnosticsText(),
  health: currentConnectionHealth(),
  diagnostics: getDiagnosticsPayload()
}));
ipcMain.handle('app:copy-diagnostics', () => {
  const text = buildDiagnosticsText();
  clipboard.writeText(text);
  addLog('app', 'info', '诊断信息已复制到剪贴板');
  return { ok: true, text };
});
ipcMain.handle('app:reconnect', async () => reconnectGameProcess({ reason: 'manual' }));
ipcMain.handle('app:set-onboarding-seen', (_event, seen = true) => {
  const current = appSettings();
  current.onboarding = { ...(current.onboarding || {}), seenGuide: Boolean(seen) };
  persistAppSettings(current);
  broadcastState();
  return { ok: true, settings: settingsPublic(current) };
});
ipcMain.handle('config:export', async (_event, options = {}) => {
  const bundle = buildConfigBundle({
    settings: appSettings(),
    custom_durations: loadCustomBuffDurations(),
    translation: translationSettings(),
    includeSecrets: Boolean(options.includeSecrets),
    appVersion: app.getVersion()
  });
  const result = await dialog.showSaveDialog(mainWindow || undefined, {
    title: '导出工具箱配置',
    defaultPath: path.join(app.getPath('documents'), `eco-toolbox-config-${Date.now()}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
  fs.writeFileSync(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  addLog('app', 'info', `配置已导出 → ${result.filePath}`);
  return { ok: true, path: result.filePath };
});
ipcMain.handle('config:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '导入工具箱配置',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) return { ok: false, cancelled: true };
  try {
    const parsed = parseConfigBundle(fs.readFileSync(result.filePaths[0], 'utf8'));
    if (parsed.settings && Object.keys(parsed.settings).length) {
      const next = mergeDeep(appSettings(), parsed.settings);
      stripAppearanceRuntimeFields(next.appearance || {});
      persistAppSettings(next);
    }
    if (parsed.custom_durations && Object.keys(parsed.custom_durations).length) {
      saveCustomBuffDurations(parsed.custom_durations);
      notifyDamageReloadCustomBuffs(parsed.custom_durations);
    }
    if (parsed.translation) {
      const root = localDataDir();
      writeJson(path.join(root, 'translate_config.json'), {
        provider: parsed.translation.provider || 'deepseek',
        model: parsed.translation.model || '',
        base_url: parsed.translation.base_url || '',
        api_key: parsed.translation.api_key || '',
        first_wait: Number(parsed.translation.first_wait || 0),
        target_lang: parsed.translation.target_lang || 'zh-CN',
        player_names: Array.isArray(parsed.translation.player_names) ? parsed.translation.player_names : [],
        toggle_hotkey: parsed.translation.toggle_hotkey || '',
        skip_hotkey: parsed.translation.skip_hotkey || ''
      });
      if (parsed.translation.sync_url != null || parsed.translation.sync_enabled != null) {
        writeJson(path.join(root, 'sync_config.json'), {
          enabled: Boolean(parsed.translation.sync_enabled),
          url: parsed.translation.sync_url || '',
          token: parsed.translation.sync_token || ''
        });
      }
    }
    registerAppHotkeys();
    createAppTray();
    broadcastState({ immediate: true });
    addLog('app', 'success', '配置已导入');
    return { ok: true, settings: settingsPublic() };
  } catch (error) {
    return { ok: false, error: error.message || '导入失败' };
  }
});
ipcMain.handle('presets:list', () => ({ ok: true, presets: characterPresets.loadAll() }));
ipcMain.handle('presets:save', (_event, payload = {}) => {
  const name = String(payload.name || '').trim() || '未命名预设';
  const result = characterPresets.upsert({
    id: payload.id || `preset-${Date.now()}`,
    name,
    note: payload.note || '',
    capture: payload.capture || appSettings().capture || {},
    custom_durations: payload.custom_durations || loadCustomBuffDurations(),
    overlay: {
      density: appSettings().overlay?.density || 'comfortable',
      expiryWarningSeconds: appSettings().overlay?.expiryWarningSeconds,
      ...(payload.overlay || {})
    }
  });
  broadcastState();
  addLog('app', 'info', `角色预设已保存：${name}`);
  return { ok: true, ...result };
});
ipcMain.handle('presets:apply', (_event, id) => {
  const preset = characterPresets.loadAll().find((p) => p.id === id);
  if (!preset) return { ok: false, error: '预设不存在' };
  const current = appSettings();
  if (preset.capture) current.capture = { ...(current.capture || {}), ...preset.capture };
  if (preset.overlay) {
    current.overlay = {
      ...(current.overlay || {}),
      density: preset.overlay.density || current.overlay?.density,
      expiryWarningSeconds: preset.overlay.expiryWarningSeconds ?? current.overlay?.expiryWarningSeconds
    };
  }
  persistAppSettings(current);
  if (preset.custom_durations) {
    saveCustomBuffDurations(preset.custom_durations);
    notifyDamageReloadCustomBuffs(preset.custom_durations);
  }
  if (services.damage?.stdin?.writable && preset.capture) {
    try {
      services.damage.stdin.write(`${JSON.stringify({ action: 'set-categories', categories: current.capture })}\n`);
    } catch { /* ignore */ }
  }
  broadcastState({ immediate: true });
  addLog('app', 'info', `已应用角色预设：${preset.name}`);
  return {
    ok: true,
    preset,
    settings: settingsPublic(current),
    custom_durations: loadCustomBuffDurations()
  };
});
ipcMain.handle('presets:delete', (_event, id) => {
  const result = characterPresets.remove(id);
  broadcastState();
  return { ok: true, ...result };
});
ipcMain.handle('game-processes:refresh', () => refreshGameProcesses());
ipcMain.handle('game-processes:select', (_event, pid) => selectGameProcess(pid));
ipcMain.handle('game-processes:select-xiaoya', (_event, pid) => selectXiaoyaProcess(pid));
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
  persistAppSettings(current);
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
  persistAppSettings(current);
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
    overlayWindow.webContents.send('app:state', buildLightState());
  }
  // Status monitoring can start/stop the shared capture backend independently of damage collection.
  if (incoming?.overlay && Object.prototype.hasOwnProperty.call(incoming.overlay, 'monitoring')) {
    reconcileCaptureBackend();
  } else {
    broadcastState();
  }
  if (incoming?.hotkeys || incoming?.startup) {
    registerAppHotkeys();
    createAppTray();
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
  wallpaper.clearImageCache();
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
  persistAppSettings(current);
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
  wallpaper.clearImageCache();
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
  persistAppSettings(current);
  wallpaper.cleanupWallpaperFiles(kind);
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

ipcMain.handle('logs:export', async (_event, options = {}) => {
  const filter = String(options.filter || 'all');
  const format = String(options.format || 'txt').toLowerCase() === 'json' ? 'json' : 'txt';
  const selected = filterLogs(filter);
  if (!selected.length) {
    return { ok: false, error: '当前筛选下没有可导出的日志' };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filterSlug = filter === 'all' ? 'all' : filter;
  const defaultName = `eco-toolbox-logs-${filterSlug}-${stamp}.${format}`;
  const result = await dialog.showSaveDialog(mainWindow || undefined, {
    title: '导出运行日志',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: format === 'json'
      ? [{ name: 'JSON', extensions: ['json'] }, { name: '文本', extensions: ['txt', 'log'] }]
      : [{ name: '文本', extensions: ['txt', 'log'] }, { name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) {
    return { ok: false, cancelled: true };
  }

  let outPath = result.filePath;
  const lower = outPath.toLowerCase();
  if (format === 'json' && !lower.endsWith('.json')) outPath += '.json';
  if (format === 'txt' && !/\.(txt|log)$/i.test(outPath)) outPath += '.txt';

  try {
    const exportFormat = outPath.toLowerCase().endsWith('.json') ? 'json' : 'txt';
    const body = formatLogsExportBody(selected, { filter, format: exportFormat });
    fs.writeFileSync(outPath, body, 'utf8');

    // Also write a companion diagnostic sidecar for remote support.
    try {
      const diag = collectDiagnostics({
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        selectedGamePid,
        selectedXiaoyaPid,
        gameProcesses,
        captureIntents: {
          damage: damageCollectionWanted,
          monitoring: isMonitoringWanted()
        },
        services: publicServices(),
        logs: selected
      });
      const diagPath = outPath.replace(/\.(txt|log|json)$/i, '') + '.diag.json';
      fs.writeFileSync(diagPath, `${JSON.stringify(diag, null, 2)}\n`, 'utf8');
      addLog('app', 'info', `已导出 ${selected.length} 条日志 → ${outPath}`);
      return { ok: true, path: outPath, diagPath, count: selected.length };
    } catch {
      addLog('app', 'info', `已导出 ${selected.length} 条日志 → ${outPath}`);
      return { ok: true, path: outPath, count: selected.length };
    }
  } catch (error) {
    return { ok: false, error: error.message || '导出日志失败' };
  }
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
    addLog('monitoring', 'error', `保存自定义倒计时失败：${e.message}`);
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
    getTargetPid: () => selectedXiaoyaPid,
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
  createAppTray();
  registerAppHotkeys();
  await refreshElevation();
  await refreshGameProcesses();
  await checkSelectedProcessAlive();
  const settings = appSettings();
  // Damage collection and status monitoring are independent intents sharing one backend.
  if (settings.startup.damage) damageCollectionWanted = true;
  if (settings.startup.monitoring === false && settings.overlay?.monitoring !== false) {
    // Auto-start disabled: leave monitoring off until the user turns the switch on.
    const next = mergeDeep(settings, { overlay: { monitoring: false } });
    persistAppSettings(next);
  }
  reconcileCaptureBackend();
  startProcessWatch();
  if (!isDemo) {
    if (settings.startup.translator) startService('translator');
    if (settings.updates.checkOnStartup) {
      setTimeout(() => updateService.check(), 3500);
    }
  }
  broadcastState({ immediate: true });
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

  try {
    getSettingsStore().flush();
  } catch {
    // ignore
  }

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

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  try { if (processWatchTimer) clearInterval(processWatchTimer); } catch { /* ignore */ }
  try { if (appTray) appTray.destroy(); } catch { /* ignore */ }
});

app.on('window-all-closed', () => {
  // Main window close is already handled; do not quit twice.
  if (gracefulQuitComplete) return;
  if (process.platform !== 'darwin') beginGracefulShutdown('window-all-closed');
});
