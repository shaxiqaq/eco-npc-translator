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
const {
  collectDiagnostics,
  formatDiagnosticsText,
  collectCaptureLogTails,
  collectNamedLogTails,
  writeDiagnosticPack,
  buildSnapshotSummary,
  zipDirectory,
  defaultDiagnosticLogDirs
} = require('./lib/diagnostics');
const { ensureSyncConfig, cloneDefaults: cloneSyncDefaults } = require('./lib/sync-defaults');
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
  stopChildGracefully: stopChildGracefullyImpl,
  sleep: lifecycleSleep
} = require('./lib/child-lifecycle');
const { createAppShutdown } = require('./lib/app-shutdown');
const { applyOverlayVisibility } = require('./lib/overlay-window');
const { resolveBackendRuntime, launchLabel, agentAvailable } = require('./lib/backend-runtime');
const { planPrestartOnGame } = require('./lib/prestart');
const { resolveSelectedPids } = require('./lib/process-selection');
const { createBattleReportTracker } = require('./lib/battle-report');
const { createDisplayNameService } = require('./lib/display-names');
const { filterLogs: filterLogsImpl, formatLogsExportBody } = require('./lib/logs-service');
const {
  OVERLAY_MIN_WIDTH,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_DEFAULT_HEIGHT,
  clampOverlayOpacity,
  overlayBounds: computeOverlayBounds
} = require('./lib/overlay-geometry');
const { demoSnapshot } = require('./lib/demo-snapshot');
const { createCaptureHost } = require('./lib/capture-host');
const { createTranslatorHost } = require('./lib/translator-host');
const { createAgentHost } = require('./lib/agent-host');
const { writeCommand } = require('./lib/backend-protocol');

const log = createLogger('main');

if (process.platform === 'win32') {
  // Must match package.json build.appId so the installed shortcut owns this process
  // and Windows shows a normal taskbar button.
  app.setAppUserModelId('com.eco.toolbox');
}

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
let translatorWanted = false;
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
let appShutdown = null;
function getAppShutdown() {
  if (!appShutdown) {
    appShutdown = createAppShutdown({
      getMainWindow: () => mainWindow,
      getOverlayWindow: () => overlayWindow,
      setMainWindow: (w) => { mainWindow = w; },
      setOverlayWindow: (w) => { overlayWindow = w; },
      services,
      stopChildGracefully,
      setServiceState,
      addLog,
      stopDemo,
      flushSettings: () => getSettingsStore().flush(),
      stopXiaoya: async () => {
        if (xiaoyaService) await xiaoyaService.stop();
      },
      disposeXiaoya: () => {
        if (xiaoyaService) xiaoyaService.dispose();
      },
      isDemo,
      sleep: lifecycleSleep,
      quitApp: () => app.quit()
    });
  }
  return appShutdown;
}
function gracefulQuitStarted() {
  return getAppShutdown().isQuitStarted();
}
function gracefulQuitComplete() {
  return getAppShutdown().isQuitComplete();
}
let appTray = null;
let processWatchTimer = null;
let elevatedCache = null;
let selectedProcessAlive = null;
let lastReconnectAt = 0;
let rememberedProcessTitle = '';
let rememberedXiaoyaTitle = '';
const battleReport = createBattleReportTracker();
const displayNames = createDisplayNameService({
  dataDir: () => localDataDir(),
  resDir: () => (app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..'))
});

const defaultAppSettings = {
  game: {
    pid: null,
    // Separate from main toolbox PID: Xiaoya is usually bound to a multi-client alt.
    xiaoyaPid: null,
    // Window titles survive relaunch better than PIDs (multi-client).
    lastTitle: '',
    xiaoyaTitle: ''
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
    autoReconnect: true,
    prestartOnGame: true
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
    accent: 'amber', // amber | teal | violet | rose | cyan | slate
    // client | ja | dual — skill label preference (wiki-aligned JA table when available)
    skillNameMode: 'client'
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
  fs.mkdirSync(root, { recursive: true });
  const translation = readJson(path.join(root, 'translate_config.json'));
  // Public shared dictionary is on by default for all users.
  const sync = ensureSyncConfig(path.join(root, 'sync_config.json'), { readJson, writeJson });
  return {
    provider: translation.provider || 'deepseek',
    model: translation.model || 'deepseek-chat',
    base_url: translation.base_url || 'https://api.deepseek.com',
    api_key: translation.api_key || '',
    first_wait: Number(translation.first_wait || 0),
    target_lang: translation.target_lang || 'zh-CN',
    source_lang: translation.source_lang || 'auto',
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

function captureAttachedPid() {
  const attached = serviceState.damage?.pid;
  if (attached != null && Number(attached) > 0) return Number(attached);
  return selectedGamePid;
}

function captureRoleMessage() {
  const mon = isMonitoringWanted();
  const dmg = damageCollectionWanted;
  const attached = captureAttachedPid();
  const selected = selectedGamePid;
  let pidText = attached != null ? String(attached) : '—';
  if (
    attached != null
    && selected != null
    && Number(attached) !== Number(selected)
  ) {
    pidText = `${attached}≠选中${selected}`;
  }
  if (dmg && mon) return `伤害采集与状态监控运行中（进程 ${pidText}）`;
  if (dmg) return `伤害采集运行中（进程 ${pidText}）`;
  if (mon) return `状态监控运行中（进程 ${pidText}）`;
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
    characterPresets: characterPresets.loadAll(),
    battleReport: (() => {
      const r = battleReport.snapshot();
      return {
        peakDps: r.peakDps,
        peakDealt: r.peakDealt,
        samples: r.samples,
        startedAt: r.startedAt,
        last: r.last,
        // Compact trail for overview sparkline (last ~40 samples).
        history: Array.isArray(r.history) ? r.history.slice(-40) : []
      };
    })(),
    rememberedTitles: {
      main: rememberedProcessTitle || null,
      xiaoya: rememberedXiaoyaTitle || null
    }
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
  getOverlayWindow: () => overlayWindow,
  buildLightState,
  buildFullState
});

function persistSelectedGamePid(pid, title) {
  const settings = appSettings();
  const nextTitle = title != null ? String(title || '').trim() : rememberedProcessTitle;
  settings.game = {
    ...(settings.game || {}),
    pid,
    lastTitle: nextTitle || settings.game?.lastTitle || ''
  };
  if (nextTitle) rememberedProcessTitle = nextTitle;
  persistAppSettings(settings);
}

function persistSelectedXiaoyaPid(pid, title) {
  const settings = appSettings();
  const nextTitle = title != null ? String(title || '').trim() : rememberedXiaoyaTitle;
  settings.game = {
    ...(settings.game || {}),
    xiaoyaPid: pid,
    xiaoyaTitle: nextTitle || settings.game?.xiaoyaTitle || ''
  };
  if (nextTitle) rememberedXiaoyaTitle = nextTitle;
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
    if (!rememberedProcessTitle && settings.game?.lastTitle) {
      rememberedProcessTitle = String(settings.game.lastTitle);
    }
    if (!rememberedXiaoyaTitle && settings.game?.xiaoyaTitle) {
      rememberedXiaoyaTitle = String(settings.game.xiaoyaTitle);
    }
    gameProcesses = found;

    ({ selectedGamePid, selectedXiaoyaPid } = resolveSelectedPids({
      processes: gameProcesses,
      previousMainPid: previousPid,
      previousXiaoyaPid,
      configuredMainPid: configuredPid,
      configuredXiaoyaPid,
      rememberedMainTitle: rememberedProcessTitle || settings.game?.lastTitle,
      rememberedXiaoyaTitle: rememberedXiaoyaTitle || settings.game?.xiaoyaTitle
    }));

    const mainProc = gameProcesses.find((p) => p.pid === selectedGamePid);
    const xiaoyaProc = gameProcesses.find((p) => p.pid === selectedXiaoyaPid);
    if (mainProc?.title) rememberedProcessTitle = mainProc.title;
    if (xiaoyaProc?.title) rememberedXiaoyaTitle = xiaoyaProc.title;

    if (!isDemo && (selectedGamePid !== configuredPid || rememberedProcessTitle !== settings.game?.lastTitle)) {
      persistSelectedGamePid(selectedGamePid, rememberedProcessTitle);
    }
    if (!isDemo && (selectedXiaoyaPid !== configuredXiaoyaPid || rememberedXiaoyaTitle !== settings.game?.xiaoyaTitle)) {
      persistSelectedXiaoyaPid(selectedXiaoyaPid, rememberedXiaoyaTitle);
    }
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

/**
 * Switch main eco.exe target.
 * options.autoRestart (default true): stop capture/translator if running, switch, then restart
 * whatever was wanted so multi-client users need not manually stop first.
 */
async function selectGameProcess(pid, options = {}) {
  const autoRestart = options.autoRestart !== false;
  const normalized = Number(pid);
  if (!gameProcesses.some((process) => process.pid === normalized)) {
    return { ok: false, error: '所选游戏进程已经退出，请刷新列表' };
  }
  if (selectedGamePid === normalized) {
    return {
      ok: true,
      selectedPid: selectedGamePid,
      title: rememberedProcessTitle,
      unchanged: true
    };
  }

  const wantDamageCollection = Boolean(damageCollectionWanted);
  const wantMonitoring = isMonitoringWanted();
  const wantCapture = wantDamageCollection || wantMonitoring
    || Boolean(services.damage)
    || ['running', 'starting'].includes(serviceState.damage?.state || '');
  const translatorWasRunning = Boolean(translatorWanted)
    || Boolean(services.translator)
    || ['running', 'starting'].includes(serviceState.translator?.state || '');

  if (autoRestart && processSelectionLocked()) {
    addLog('app', 'info', `切换进程 ${selectedGamePid || '—'} → ${normalized}，正在安全重挂…`);
    try {
      if (services.damage || ['running', 'starting'].includes(serviceState.damage?.state || '')) {
        // Force detach from old PID even if monitoring intent remains.
        await stopCaptureBackend({ waitMs: 8000, force: true });
      }
      if (services.translator || translatorWasRunning) {
        await stopService('translator');
      }
    } catch (error) {
      addLog('app', 'warn', `切换前停止服务：${error.message || error}`);
    }
  } else if (processSelectionLocked()) {
    return { ok: false, error: '请先停止伤害采集和 NPC 翻译，再切换游戏进程' };
  }

  selectedGamePid = normalized;
  latestSnapshot = null;
  const proc = gameProcesses.find((p) => p.pid === normalized);
  rememberedProcessTitle = proc?.title || rememberedProcessTitle || '';
  selectedProcessAlive = true;
  if (!isDemo) persistSelectedGamePid(selectedGamePid, rememberedProcessTitle);
  broadcastState();

  // Auto-apply character preset bound to this window title (multi-client QoL).
  tryMaybeApplyPresetForTitle(rememberedProcessTitle);

  let restarted = [];
  if (autoRestart) {
    // Restore intents after forced stop.
    damageCollectionWanted = wantDamageCollection;
    if (wantCapture) {
      const r = await reconcileCaptureBackend();
      if (r?.ok) restarted.push(wantDamageCollection ? 'damage' : 'monitoring');
    }
    if (translatorWasRunning) {
      const r = await startService('translator');
      if (r?.ok) restarted.push('translator');
    }
    // Soft reidentify so next auto-attack rebinds self_id for the new window.
    try {
      reidentifySelf();
    } catch {
      /* optional */
    }
  }

  addLog(
    'app',
    'success',
    `已选择主进程 ${selectedGamePid}${rememberedProcessTitle ? `（${rememberedProcessTitle}）` : ''}`
      + (restarted.length ? `，已重挂：${restarted.join('+')}` : '')
  );
  broadcastState();
  return {
    ok: true,
    selectedPid: selectedGamePid,
    title: rememberedProcessTitle,
    restarted
  };
}

function tryMaybeApplyPresetForTitle(title) {
  const t = String(title || '').trim();
  if (!t) return null;
  const presets = characterPresets.loadAll();
  const match = presets.find((p) => {
    const bind = String(p.windowTitle || p.note || '').trim();
    if (!bind) return false;
    return bind === t || t.includes(bind) || bind.includes(t);
  });
  if (!match) return null;
  // Reuse apply path without double-logging noise.
  const current = appSettings();
  if (match.capture) current.capture = { ...(current.capture || {}), ...match.capture };
  if (match.overlay) {
    current.overlay = {
      ...(current.overlay || {}),
      density: match.overlay.density || current.overlay?.density,
      expiryWarningSeconds: match.overlay.expiryWarningSeconds ?? current.overlay?.expiryWarningSeconds
    };
  }
  persistAppSettings(current);
  if (match.custom_durations) {
    saveCustomBuffDurations(match.custom_durations);
    notifyDamageReloadCustomBuffs(match.custom_durations);
  }
  addLog('app', 'info', `已按窗口标题自动应用预设「${match.name}」`);
  return match;
}

function selectXiaoyaProcess(pid) {
  const normalized = Number(pid);
  if (!gameProcesses.some((process) => process.pid === normalized)) {
    return { ok: false, error: '所选游戏进程已经退出，请刷新列表' };
  }
  selectedXiaoyaPid = normalized;
  const proc = gameProcesses.find((p) => p.pid === normalized);
  rememberedXiaoyaTitle = proc?.title || rememberedXiaoyaTitle || '';
  if (!isDemo) persistSelectedXiaoyaPid(selectedXiaoyaPid, rememberedXiaoyaTitle);

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

function runtimeFor(name, extraArgs = []) {
  return resolveBackendRuntime({
    name,
    selectedGamePid,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    srcDir: srcDir(),
    backendDir: backendDir(),
    extraArgs
  });
}

function useUnifiedAgent() {
  return agentAvailable({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    srcDir: srcDir()
  });
}

function handleDamageMessage(message) {
  if (message.type === 'snapshot') {
    latestSnapshot = message.data;
    battleReport.ingest(latestSnapshot);
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

function classifiedResult(classified) {
  return { ok: false, error: classified.message, errorCode: classified.code };
}

const captureHost = createCaptureHost({
  spawnImpl: spawn,
  createInterface: readline.createInterface.bind(readline),
  fs,
  getSelectedPid: () => selectedGamePid,
  getGameProcesses: () => gameProcesses,
  isDemo: () => isDemo,
  startDemo,
  stopDemo,
  hasDemoTimer: () => Boolean(demoTimer),
  resolveRuntime: (name) => runtimeFor(name),
  buildEnv: buildBackendEnv,
  getSrcDir: () => srcDir(),
  getDataDir: () => localDataDir(),
  getCaptureSettings: () => ({
    categories: appSettings().capture,
    skillNameMode: appSettings().appearance?.skillNameMode || 'client'
  }),
  setDamageState: (state, message, extra = {}) => {
    if (extra.keepError && serviceState.damage?.state === 'error' && state === 'stopped') return;
    if (extra.refresh) {
      setServiceState('damage', 'running', message, {
        pid: extra.pid,
        log: serviceState.damage?.log
      });
      return;
    }
    setServiceState('damage', state, message, extra.pid != null ? { pid: extra.pid } : {});
  },
  reportDamageError: (raw, context) => classifiedResult(reportServiceError('damage', raw, context)),
  log: addCaptureLog,
  onMessage: handleDamageMessage,
  stopChildGracefully,
  getChild: () => services.damage,
  setChild: (child) => { services.damage = child; },
  captureNeeded: captureBackendNeeded,
  captureRoleMessage,
  getAttachedPid: () => serviceState.damage?.pid,
  broadcastIdle: () => broadcastState()
});

const translatorHost = createTranslatorHost({
  spawnImpl: spawn,
  createInterface: readline.createInterface.bind(readline),
  fs,
  getSelectedPid: () => selectedGamePid,
  resolveRuntime: (name) => runtimeFor(name),
  buildEnv: buildBackendEnv,
  getSrcDir: () => srcDir(),
  getDataDir: () => localDataDir(),
  isPackaged: () => app.isPackaged,
  setTranslatorState: (state, message, extra = {}) => {
    if (extra.keepError && serviceState.translator?.state === 'error' && state === 'stopped') return;
    if (extra.onlyIfStarting && serviceState.translator?.state !== 'starting') return;
    setServiceState('translator', state, message, extra.pid != null ? { pid: extra.pid } : {});
  },
  reportTranslatorError: (raw, context) => classifiedResult(reportServiceError('translator', raw, context)),
  log: (level, message) => addLog('translator', level, message),
  stopChildGracefully,
  getChild: () => services.translator,
  setChild: (child) => { services.translator = child; }
});

function handleTranslatorMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'status') {
    if (message.state === 'error') {
      reportServiceError('translator', message.message || '翻译失败', {
        kind: message.error_kind || message.error_code === 'ECO_E03' ? 'access' : undefined
      });
      return;
    }
    setServiceState(
      'translator',
      message.state,
      message.message || '',
      message.pid != null ? { pid: message.pid } : {}
    );
    return;
  }
  if (message.message) addLog('translator', message.level || 'info', message.message);
}

const agentHost = createAgentHost({
  spawnImpl: spawn,
  createInterface: readline.createInterface.bind(readline),
  fs,
  getSelectedPid: () => selectedGamePid,
  getGameProcesses: () => gameProcesses,
  resolveRuntime: (name, extraArgs) => runtimeFor(name, extraArgs),
  buildEnv: buildBackendEnv,
  getSrcDir: () => srcDir(),
  getDataDir: () => localDataDir(),
  getCaptureSettings: () => ({
    categories: appSettings().capture,
    skillNameMode: appSettings().appearance?.skillNameMode || 'client'
  }),
  captureNeeded: captureBackendNeeded,
  translateWanted: () => translatorWanted,
  captureRoleMessage,
  setDamageState: (state, message, extra = {}) => {
    if (extra.keepError && serviceState.damage?.state === 'error' && state === 'stopped') return;
    if (extra.refresh) {
      setServiceState('damage', 'running', message, {
        pid: extra.pid,
        log: serviceState.damage?.log
      });
      return;
    }
    setServiceState('damage', state, message, extra.pid != null ? { pid: extra.pid } : {});
  },
  setTranslatorState: (state, message, extra = {}) => {
    if (extra.keepError && serviceState.translator?.state === 'error' && state === 'stopped') return;
    setServiceState('translator', state, message, extra.pid != null ? { pid: extra.pid } : {});
  },
  reportDamageError: (raw, context) => classifiedResult(reportServiceError('damage', raw, context)),
  reportTranslatorError: (raw, context) => classifiedResult(reportServiceError('translator', raw, context)),
  onDamageMessage: handleDamageMessage,
  onTranslatorMessage: handleTranslatorMessage,
  log: addCaptureLog,
  stopChildGracefully,
  setDamageChild: (next) => { services.damage = next; },
  setTranslatorChild: (next) => { services.translator = next; },
  getAttachedPid: () => serviceState.damage?.pid || serviceState.translator?.pid,
  broadcastIdle: () => broadcastState()
});

function startCaptureBackend() {
  if (useUnifiedAgent()) return agentHost.reconcile();
  return captureHost.start();
}

async function stopCaptureBackend({ waitMs = 12000, force = false } = {}) {
  if (useUnifiedAgent()) return agentHost.stop({ waitMs, force });
  return captureHost.stop({ waitMs, force });
}

function capturePidMismatch() {
  if (useUnifiedAgent()) return agentHost.pidMismatch();
  return captureHost.pidMismatch();
}

async function reconcileCaptureBackend({ waitMs = 12000, forceRestart = false } = {}) {
  if (useUnifiedAgent()) return agentHost.reconcile({ waitMs, forceRestart });
  return captureHost.reconcile({ waitMs, forceRestart });
}

function startService(name) {
  if (!['damage', 'translator'].includes(name)) return { ok: false, error: '未知服务' };
  if (name === 'damage') {
    damageCollectionWanted = true;
    return reconcileCaptureBackend();
  }
  translatorWanted = true;
  if (useUnifiedAgent()) return agentHost.reconcile();
  return translatorHost.start();
}

function requestTranslatorWarmup() {
  const child = services.translator || services.damage;
  if (writeCommand(child, { action: 'warmup' })) {
    addLog('translator', 'info', '已请求预热翻译引擎');
    return true;
  }
  return false;
}

async function maybePrestartOnGame() {
  const settings = appSettings();
  const plan = planPrestartOnGame({
    enabled: settings.startup?.prestartOnGame !== false,
    processBecameAlive: true,
    selectedPid: selectedGamePid,
    startupTranslator: Boolean(settings.startup?.translator),
    translatorUp: ['running', 'starting'].includes(serviceState.translator?.state || ''),
    captureNeeded: captureBackendNeeded(),
    captureUp: Boolean(services.damage) || ['running', 'starting'].includes(serviceState.damage?.state || '')
  });
  if (plan.capture) {
    addLog('app', 'info', '发现游戏进程，正在预启动采集…');
    await reconcileCaptureBackend();
  }
  if (plan.translator) {
    addLog('translator', 'info', '发现游戏进程，正在预启动 NPC 翻译并预热引擎…');
    translatorWanted = true;
    const result = useUnifiedAgent() ? await agentHost.reconcile() : translatorHost.start();
    if (result?.ok !== false) requestTranslatorWarmup();
  }
}

async function prestartServices() {
  if (!selectedGamePid) {
    return { ok: false, error: '请先选择游戏进程' };
  }
  if (!selectedProcessAlive && !isDemo) {
    await checkSelectedProcessAlive();
  }
  translatorWanted = true;
  const started = useUnifiedAgent() ? await agentHost.reconcile() : await Promise.resolve(translatorHost.start());
  if (started && started.ok === false) return started;
  requestTranslatorWarmup();
  addLog('translator', 'success', '预启动已发出：挂钩 + 引擎预热');
  return { ok: true };
}

function stopChildGracefully(name, child, options = {}) {
  const { waitMs = 12000, forceKill = true, settleMs = 400 } = options;
  const logFn = name === 'damage' ? addCaptureLog : (level, message) => addLog(name, level, message);
  return stopChildGracefullyImpl({
    name,
    child,
    waitMs,
    forceKill,
    settleMs,
    log: logFn,
    setStopping: (state, message) => setServiceState(name, state, message)
  });
}

function stopService(name, { waitMs = 12000, forceKill = true, settleMs = 400 } = {}) {
  if (name === 'damage') {
    // Only release damage-collection intent; status monitoring may keep the backend alive.
    damageCollectionWanted = false;
    return reconcileCaptureBackend({ waitMs });
  }
  if (name === 'translator') {
    translatorWanted = false;
    if (useUnifiedAgent()) return agentHost.reconcile({ waitMs });
    return translatorHost.stop({ waitMs, forceKill, settleMs });
  }
  const child = services[name];
  if (!child) return Promise.resolve({ ok: true });
  return stopChildGracefully(name, child, { waitMs, forceKill, settleMs }).finally(() => {
    if (services[name] === child) services[name] = null;
  });
}

async function stopAllBackends({ waitMs = 12000 } = {}) {
  damageCollectionWanted = false;
  translatorWanted = false;
  if (useUnifiedAgent()) {
    await agentHost.stop({ waitMs });
    return { ok: true };
  }
  // Force-stop capture even if monitoring intent is still set (app is quitting).
  await stopCaptureBackend({ waitMs, force: true });
  await stopService('translator', { waitMs });
  return { ok: true };
}

async function stopAllBackendsForQuit() {
  damageCollectionWanted = false;
  translatorWanted = false;
  return getAppShutdown().stopAllBackendsForQuit();
}

function resetDamage() {
  const child = services.damage;
  if (child) writeCommand(child, { action: 'reset' });
  battleReport.reset();
  if (isDemo) {
    latestSnapshot = demoSnapshot(0);
    battleReport.ingest(latestSnapshot);
  }
  broadcastState();
  return { ok: Boolean(child || isDemo) };
}

/** Soft reidentify: next local combat may rebind; keep last self_id on screen. */
function reidentifySelf() {
  const child = services.damage;
  if (child && child.stdin?.writable) {
    try {
      writeCommand(child, { action: 'reidentify-self' });
    } catch (error) {
      return { ok: false, error: error.message || '无法通知采集后端' };
    }
    const cur = latestSnapshot?.self_id;
    addCaptureLog(
      'info',
      cur != null
        ? `已请求确认角色（当前仍显示 #${cur}），请攻击或放技能一次`
        : '已请求识别角色，请攻击或放技能一次'
    );
    // Do NOT wipe UI self_id — soft reidentify keeps last id until combat rebinds.
    if (latestSnapshot && typeof latestSnapshot === 'object') {
      latestSnapshot = { ...latestSnapshot, rebind_pending: true };
      stateBus.broadcastSnapshot(latestSnapshot);
    }
    broadcastState({ immediate: true });
    return { ok: true };
  }
  if (isDemo) {
    if (latestSnapshot && typeof latestSnapshot === 'object') {
      latestSnapshot = { ...latestSnapshot, self_id: null };
      stateBus.broadcastSnapshot(latestSnapshot);
    }
    broadcastState({ immediate: true });
    addLog('damage', 'info', '演示模式：已清除角色识别，下一帧会重新带上演示角色');
    setTimeout(() => {
      latestSnapshot = demoSnapshot(0);
      battleReport.ingest(latestSnapshot);
      stateBus.broadcastSnapshot(latestSnapshot);
      broadcastState();
    }, 400);
    return { ok: true };
  }
  return {
    ok: false,
    error: '采集后端未运行。请先开启伤害采集或状态监控，再重新识别角色。'
  };
}

async function prepareForUpdateInstall() {
  stopDemo();
  // Same safe order as app quit so update install does not tear Frida mid-hook.
  await stopAllBackendsForQuit();
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
    const visible = appSettings().overlay?.visible !== false;
    applyOverlayVisibility(overlayWindow, visible);
  }
  broadcastState();
  return true;
}

function appIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.ico'),
    app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : '',
    app.isPackaged ? path.join(process.resourcesPath, 'build', 'icon.ico') : ''
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || undefined;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (typeof mainWindow.setSkipTaskbar === 'function') {
    mainWindow.setSkipTaskbar(false);
  }
  if (typeof mainWindow.isMinimized === 'function' && mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
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
  // Intercept the X button / Alt+F4.
  // Default: minimize to tray (if enabled). Real quit always goes through delayed
  // graceful shutdown so Frida hooks leave eco.exe before the toolbox dies.
  mainWindow.on('close', (event) => {
    if (gracefulQuitComplete()) return;
    if (gracefulQuitStarted()) {
      event.preventDefault();
      return;
    }
    const minimizeToTray = appSettings().startup?.minimizeToTray !== false
      && appSettings().startup?.tray !== false
      && appTray;
    if (minimizeToTray) {
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
  stateBus.broadcastSnapshot(latestSnapshot);
  demoTimer = setInterval(() => {
    seed += 1;
    latestSnapshot = demoSnapshot(seed);
    rememberSkillsFromSnapshot(latestSnapshot);
    stateBus.broadcastSnapshot(latestSnapshot);
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
    if (match?.pid && Number(match.pid) !== Number(selectedGamePid)) {
      // Capture may be running — allow PID retarget for reconnect only.
      selectedGamePid = Number(match.pid);
      latestSnapshot = null;
      rememberedProcessTitle = match.title || rememberedProcessTitle;
      selectedProcessAlive = true;
      if (!isDemo) persistSelectedGamePid(selectedGamePid, rememberedProcessTitle);
    }
  }
  await checkSelectedProcessAlive();
  if (captureBackendNeeded()) {
    // Always restart capture on reconnect so Frida re-attaches to the live PID.
    const result = await reconcileCaptureBackend({ waitMs: 8000, forceRestart: true });
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
      // Live process list may point at a new eco.exe while capture still hooks the old one.
      if (wanted && capturePidMismatch()) {
        addLog(
          'app',
          'warn',
          `检测到采集 PID 漂移（挂接 ${serviceState.damage?.pid} / 选中 ${selectedGamePid}），自动重新挂接…`
        );
        await reconcileCaptureBackend({ forceRestart: true });
        return;
      }
      if (prevAlive === false && selectedProcessAlive && selectedGamePid) {
        await maybePrestartOnGame();
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
    showMainWindow();
  }
}

function toggleOverlayVisibleHotkey() {
  const current = appSettings();
  const next = !(current.overlay?.visible !== false);
  current.overlay = { ...(current.overlay || {}), visible: next };
  persistAppSettings(current);
  applyOverlayVisibility(overlayWindow, next);
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
        click: () => showMainWindow()
      },
      { label: '显示/隐藏悬浮窗', click: () => toggleOverlayVisibleHotkey() },
      { label: '刷新游戏进程', click: () => { void refreshGameProcesses(); } },
      { label: '重新连接', click: () => { void reconnectGameProcess({ reason: 'tray' }); } },
      { type: 'separator' },
      { label: '安全退出（先关功能）', click: () => beginGracefulShutdown('tray-quit') }
    ]));
    appTray.on('double-click', () => showMainWindow());
  } catch (error) {
    log.warn('tray create failed', error?.message || error);
  }
}

function getDiagnosticsPayload() {
  const snap = latestSnapshot && typeof latestSnapshot === 'object' ? latestSnapshot : {};
  const damageState = publicServices()?.damage || {};
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
    logs,
    identity: {
      self_id: snap.self_id ?? null,
      candidates: snap.candidates ?? '',
      captureRunning: damageState.state === 'running',
      attached_pid: damageState.pid ?? null,
      selected_pid: selectedGamePid,
      pid_mismatch: Boolean(
        damageState.pid != null
        && selectedGamePid != null
        && Number(damageState.pid) !== Number(selectedGamePid)
      ),
      total_dealt: snap.total_dealt ?? snap.dealt ?? null,
      total_taken: snap.total_taken ?? snap.taken ?? null,
      skill_cast_total: snap.skill_cast_total ?? null,
      packet_count: snap.packet_count ?? null,
      last_packet_age: snap.last_packet_age ?? null,
      ride_mode: Boolean(snap.ride_mode),
      ride_mount_id: snap.ride_mount_id ?? null,
      possession_host_id: snap.possession_host_id ?? null
    },
    snapshotSummary: buildSnapshotSummary(snap),
    connectionHealth: currentConnectionHealth()
  });
}

function buildDiagnosticsText() {
  const diag = getDiagnosticsPayload();
  const health = diag.connectionHealth || currentConnectionHealth();
  const lines = [
    formatDiagnosticsText(diag),
    '',
    '## hints'
  ];
  for (const hint of health.hints || []) lines.push(`- ${hint}`);
  if (diag.identity?.pid_mismatch) {
    lines.push(
      `- 采集挂接 PID ${diag.identity.attached_pid} 与当前选中 ${diag.identity.selected_pid} 不一致，请点「重新连接」。`
    );
  }
  const dealt = Number(diag.identity?.total_dealt) || 0;
  const packets = diag.identity?.packet_count;
  if (diag.identity?.captureRunning && diag.identity?.self_id == null && dealt <= 0) {
    lines.push('- 采集已运行但尚未识别角色：请攻击或释放一次技能。');
  }
  if (diag.identity?.captureRunning && diag.identity?.self_id == null && dealt > 0) {
    lines.push(
      '- 有伤害数字但 self_id 为空：多半刚点过「重新识别」；请再普攻一次，勿重复点重新识别。'
    );
  }
  if (
    diag.identity?.captureRunning
    && dealt <= 0
    && (packets === 0 || packets == null)
  ) {
    lines.push('- 尚未收到战斗封包：确认已进游戏地图，并尝试以管理员身份运行工具箱。');
  }
  lines.push('');
  return lines.join('\n');
}

const { registerIpcHandlers } = require('./lib/ipc/register-handlers');
registerIpcHandlers(ipcMain, {
  dialog,
  clipboard,
  shell,
  app,
  path,
  fs,
  screen,
  publicState,
  settingsPublic,
  buildDiagnosticsText,
  currentConnectionHealth,
  getDiagnosticsPayload,
  addLog,
  localDataDir,
  backendDir,
  defaultDiagnosticLogDirs,
  collectCaptureLogTails,
  collectNamedLogTails,
  writeDiagnosticPack,
  zipDirectory,
  get latestSnapshot() { return latestSnapshot; },
  set latestSnapshot(v) { latestSnapshot = v; },
  reconnectGameProcess,
  mergeDeep,
  appSettings,
  persistAppSettings,
  characterPresets,
  selectGameProcess,
  selectXiaoyaProcess,
  refreshGameProcesses,
  startService,
  stopService,
  prestartServices,
  resetDamage,
  reidentifySelf,
  battleReport,
  get updateService() { return updateService; },
  setOverlayEditing,
  persistOverlayBounds,
  get skillIconService() { return skillIconService; },
  // skill-icon:get free names — without these, with(ctx) throws and icons never load
  selectedGameProcess,
  get gameProcesses() { return gameProcesses; },
  displayNames,
  loadSkillLibrary,
  saveSkillLibrary,
  enrichSkillLibraryNames,
  importWallpaperImage,
  resolveAppearanceBackground,
  wallpaper,
  loadBackgroundImagePayload,
  stripAppearanceRuntimeFields,
  buildConfigBundle,
  parseConfigBundle,
  translationSettings,
  ensureSyncConfig,
  cloneSyncDefaults,
  readJson,
  writeJson,
  dataDir,
  filterLogs,
  formatLogsExportBody,
  get xiaoyaService() { return xiaoyaService; },
  saveCustomBuffDurations,
  loadCustomBuffDurations,
  customBuffsPath,
  notifyDamageReloadCustomBuffs,
  broadcastState,
  prepareForUpdateInstall,
  registerAppHotkeys,
  createAppTray,
  get rememberedProcessTitle() { return rememberedProcessTitle; },
  get rememberedXiaoyaTitle() { return rememberedXiaoyaTitle; },
  get elevatedCache() { return elevatedCache; },
  get overlayEditing() { return overlayEditing; },
  services,
  OVERLAY_MIN_WIDTH,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_DEFAULT_HEIGHT,
  clampOverlayOpacity,
  clampDim,
  clampBlur,
  clampFit,
  normalizeOverlayBgMode,
  safeBackgroundRel,
  defaultAppSettings,
  overlayBounds,
  buildLightState,
  reconcileCaptureBackend,
  get mainWindow() { return mainWindow; },
  get overlayWindow() { return overlayWindow; },
});

app.whenReady().then(async () => {
  registerBackgroundProtocol();
  migrateLegacyWallpaperIfNeeded();
  // Ensure public shared NPC dictionary is available for all installs.
  try {
    ensureSyncConfig(path.join(localDataDir(), 'sync_config.json'), { readJson, writeJson });
  } catch (error) {
    log.warn('ensureSyncConfig failed', error?.message || error);
  }
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

/** Single exit path — see electron/lib/app-shutdown.js */
function beginGracefulShutdown(reason = 'quit') {
  damageCollectionWanted = false;
  translatorWanted = false;
  return getAppShutdown().beginGracefulShutdown(reason);
}

app.on('before-quit', (event) => {
  if (gracefulQuitComplete()) return;
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
  if (gracefulQuitComplete()) return;
  if (process.platform !== 'darwin') beginGracefulShutdown('window-all-closed');
});
