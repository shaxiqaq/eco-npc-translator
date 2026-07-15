const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { listGameProcesses } = require('./lib/game-processes');
const { mergeDeep, readJson, writeJson } = require('./lib/json-store');
const { UpdateService, initialUpdateState } = require('./lib/update-service');

const isDemo = process.env.ECO_UI_DEMO === '1';
const services = { damage: null, translator: null };
const serviceState = {
  damage: { state: 'stopped', message: '尚未启动' },
  translator: { state: 'stopped', message: '尚未启动' }
};
const logs = [];
let mainWindow = null;
let overlayWindow = null;
let latestSnapshot = null;
let overlayEditing = false;
let demoTimer = null;
let gameProcesses = [];
let selectedGamePid = null;
let updateService = null;

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
    x: null,
    y: null,
    width: 430,
    height: 258,
    opacity: 0.95,
    scale: 1,
    showDetails: true
  },
  startup: {
    damage: false,
    translator: false,
    overlay: true
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

function appSettings() {
  return mergeDeep(defaultAppSettings, readJson(path.join(dataDir(), 'app_settings.json')));
}

function translationSettings() {
  const root = app.isPackaged ? dataDir() : backendDir();
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

function publicState() {
  return {
    services: serviceState,
    gameProcesses,
    selectedGamePid,
    processSelectionLocked: processSelectionLocked(),
    snapshot: latestSnapshot,
    settings: appSettings(),
    translation: translationSettings(),
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
          { pid: 1699, title: 'ECO - 角色一', started: '21:08:12' },
          { pid: 2840, title: 'ECO - 角色二', started: '21:16:45' }
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
  broadcast('service:log', entry);
}

function setServiceState(name, state, message, extra = {}) {
  serviceState[name] = { state, message, ...extra };
  broadcastState();
}

function runtimeFor(name) {
  const processArgs = selectedGamePid ? ['--pid', String(selectedGamePid)] : [];
  if (!app.isPackaged) {
    const script = name === 'damage' ? 'eco_damage_bridge.py' : 'eco_npc_mitm.py';
    return { command: process.env.ECO_PYTHON || 'python', args: ['-u', path.join(backendDir(), script), ...processArgs] };
  }
  if (name === 'damage') {
    return {
      command: path.join(process.resourcesPath, 'backend', 'damage', 'eco_damage_bridge', 'eco_damage_bridge.exe'),
      args: processArgs
    };
  }
  return {
    command: path.join(process.resourcesPath, 'backend', 'translator', 'eco_npc_mitm', 'eco_npc_mitm.exe'),
    args: processArgs
  };
}

function handleDamageMessage(message) {
  if (message.type === 'snapshot') {
    latestSnapshot = message.data;
    broadcast('damage:snapshot', latestSnapshot);
    return;
  }
  if (message.type === 'damage-event') {
    broadcast('damage:event', message.event);
    return;
  }
  if (message.type === 'status') {
    setServiceState('damage', message.state, message.message || '', { pid: message.pid, log: message.log });
    addLog('damage', message.state === 'error' ? 'error' : 'info', message.message || message.state);
    return;
  }
  if (message.type === 'notice') addLog('damage', message.level || 'info', message.message || '');
}

function startService(name) {
  if (!['damage', 'translator'].includes(name)) return { ok: false, error: '未知服务' };
  if (services[name]) return { ok: true };
  if (!selectedGamePid) {
    const error = '没有可用的 eco.exe，请启动游戏并刷新进程列表';
    setServiceState(name, 'error', error);
    return { ok: false, error };
  }
  if (isDemo && name === 'damage') {
    startDemo();
    return { ok: true };
  }

  const runtime = runtimeFor(name);
  setServiceState(name, 'starting', '正在启动');
  addLog(name, 'info', `启动 ${path.basename(runtime.command)}，连接游戏进程 ${selectedGamePid}`);
  try {
    const child = spawn(runtime.command, runtime.args, {
      cwd: backendDir(),
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        ECO_DATA_DIR: app.isPackaged ? dataDir() : backendDir()
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    services[name] = child;

    if (name === 'damage') {
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
          if (line.trim()) addLog(name, 'info', line.trim());
        }
      });
    } else {
      const lines = readline.createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        if (line.trim()) addLog(name, 'info', line.trim());
        if (line.includes('attach')) setServiceState(name, 'running', `NPC 翻译正在运行（进程 ${selectedGamePid}）`, { pid: selectedGamePid });
        if (line.includes('没有运行中的 eco.exe')) setServiceState(name, 'error', '没有找到 eco.exe，请先进入游戏');
        if (line.includes('指定的 eco.exe 进程不存在')) setServiceState(name, 'error', '所选游戏进程已经退出，请刷新后重选');
        if (line.includes('还没有配置翻译服务')) setServiceState(name, 'error', '请先完成翻译设置');
      });
    }

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
    if (name === 'translator') setTimeout(() => {
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

function stopService(name) {
  if (isDemo && name === 'damage') {
    stopDemo();
    return { ok: true };
  }
  const child = services[name];
  if (!child) return { ok: true };
  setServiceState(name, 'stopping', '正在停止');
  if (name === 'damage' && child.stdin.writable) {
    child.stdin.write(`${JSON.stringify({ action: 'stop' })}\n`);
  }
  setTimeout(() => {
    if (!services[name] || child.killed) return;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGTERM');
    }
  }, 1200);
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
  for (const name of ['damage', 'translator']) stopService(name);
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  await new Promise((resolve) => setTimeout(resolve, 1700));
}

function overlayBounds(settings) {
  const display = screen.getPrimaryDisplay().workArea;
  const scale = Math.min(1.4, Math.max(0.8, Number(settings.scale) || 1));
  const width = Math.round(430 * scale);
  const height = Math.round(258 * scale);
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
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setOpacity(Math.min(1, Math.max(0.3, Number(settings.opacity) || 1)));
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
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

function persistOverlayBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const current = appSettings();
  current.overlay = { ...current.overlay, ...overlayWindow.getBounds() };
  writeJson(path.join(dataDir(), 'app_settings.json'), current);
}

function setOverlayEditing(editing) {
  if (!overlayWindow) return false;
  overlayEditing = Boolean(editing);
  overlayWindow.setIgnoreMouseEvents(!overlayEditing, { forward: true });
  overlayWindow.setFocusable(overlayEditing);
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
      app.quit();
    }, 1800));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
    app.quit();
  });
}

function demoSnapshot(seed) {
  const now = new Date();
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
    damage_history: hits
  };
}

function startDemo() {
  if (demoTimer) return;
  let seed = 0;
  setServiceState('damage', 'running', '演示数据正在运行', { pid: selectedGamePid });
  latestSnapshot = demoSnapshot(seed);
  broadcast('damage:snapshot', latestSnapshot);
  demoTimer = setInterval(() => {
    seed += 1;
    latestSnapshot = demoSnapshot(seed);
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
ipcMain.handle('settings:save-app', (_event, incoming) => {
  const current = mergeDeep(appSettings(), incoming || {});
  writeJson(path.join(dataDir(), 'app_settings.json'), current);
  if (incoming?.capture && services.damage?.stdin?.writable) {
    services.damage.stdin.write(`${JSON.stringify({
      action: 'set-categories',
      categories: current.capture
    })}\n`);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setBounds(overlayBounds(current.overlay));
    overlayWindow.setOpacity(Math.min(1, Math.max(0.3, Number(current.overlay.opacity) || 1)));
    overlayWindow.webContents.send('app:state', publicState());
  }
  broadcastState();
  return { ok: true, settings: current };
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
  const folder = path.join(app.isPackaged ? dataDir() : backendDir(), 'logs');
  fs.mkdirSync(folder, { recursive: true });
  shell.openPath(folder);
  return { ok: true };
});

app.whenReady().then(async () => {
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
  if (isDemo) startDemo();
  else {
    if (settings.startup.damage) startService('damage');
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

app.on('before-quit', () => {
  stopDemo();
  for (const name of ['damage', 'translator']) {
    const child = services[name];
    if (!child) continue;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGTERM');
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
