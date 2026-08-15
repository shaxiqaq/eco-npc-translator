const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eco', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  refreshGameProcesses: () => ipcRenderer.invoke('game-processes:refresh'),
  selectGameProcess: (pid, options) => ipcRenderer.invoke('game-processes:select', pid, options || {}),
  selectXiaoyaProcess: (pid) => ipcRenderer.invoke('game-processes:select-xiaoya', pid),
  startService: (name) => ipcRenderer.invoke('service:start', name),
  stopService: (name) => ipcRenderer.invoke('service:stop', name),
  prestartServices: () => ipcRenderer.invoke('service:prestart'),
  resetDamage: () => ipcRenderer.invoke('damage:reset'),
  reidentifySelf: () => ipcRenderer.invoke('damage:reidentify-self'),
  getBattleReport: () => ipcRenderer.invoke('battle:get-report'),
  resetBattleReport: () => ipcRenderer.invoke('battle:reset-report'),
  exportBattleReport: (options) => ipcRenderer.invoke('battle:export-report', options || {}),
  copyBattleReport: () => ipcRenderer.invoke('battle:copy-report'),
  getAbout: () => ipcRenderer.invoke('app:get-about'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  saveTranslationSettings: (settings) => ipcRenderer.invoke('settings:save-translation', settings),
  saveAppSettings: (settings) => ipcRenderer.invoke('settings:save-app', settings),
  pickBackgroundImage: (target = 'main') => ipcRenderer.invoke('appearance:pick-background', target),
  clearBackgroundImage: (target = 'main') => ipcRenderer.invoke('appearance:clear-background', target),
  setOverlayVisible: (visible) => ipcRenderer.invoke('overlay:set-visible', visible),
  setOverlayEditing: (editing) => ipcRenderer.invoke('overlay:set-editing', editing),
  resizeOverlayForContent: (height) => ipcRenderer.invoke('overlay:resize-content', height),
  resizeOverlayByDelta: (dx, dy) => ipcRenderer.invoke('overlay:resize-delta', dx, dy),
  getSkillIcon: (skillId) => ipcRenderer.invoke('skill-icon:get', skillId),
  resolveSkillName: (skillId, preferName) => ipcRenderer.invoke('names:skill', skillId, preferName || ''),
  listJobPresets: () => ipcRenderer.invoke('presets:job-list'),
  applyJobPreset: (id) => ipcRenderer.invoke('presets:job-apply', id),
  openLogs: () => ipcRenderer.invoke('logs:open-folder'),
  exportLogs: (options) => ipcRenderer.invoke('logs:export', options || {}),
  getDiagnostics: () => ipcRenderer.invoke('app:get-diagnostics'),
  copyDiagnostics: () => ipcRenderer.invoke('app:copy-diagnostics'),
  exportDiagnosticPack: () => ipcRenderer.invoke('app:export-diagnostic-pack'),
  reconnectGame: () => ipcRenderer.invoke('app:reconnect'),
  setOnboardingSeen: (seen) => ipcRenderer.invoke('app:set-onboarding-seen', seen),
  exportConfig: (options) => ipcRenderer.invoke('config:export', options || {}),
  importConfig: () => ipcRenderer.invoke('config:import'),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  savePreset: (payload) => ipcRenderer.invoke('presets:save', payload),
  applyPreset: (id) => ipcRenderer.invoke('presets:apply', id),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),
  getXiaoyaConfig: () => ipcRenderer.invoke('xiaoya:get-config'),
  saveXiaoyaConfig: (skills) => ipcRenderer.invoke('xiaoya:save-config', skills),
  saveBuffCustomDurations: (durations) => ipcRenderer.invoke('buffs:save-custom-durations', durations),
  getBuffCustomDurations: () => ipcRenderer.invoke('buffs:get-custom-durations'),
  getSkillLibrary: () => ipcRenderer.invoke('skills:get-library'),
  startXiaoya: () => ipcRenderer.invoke('xiaoya:start'),

  stopXiaoya: () => ipcRenderer.invoke('xiaoya:stop'),
  toggleXiaoyaSs: () => ipcRenderer.invoke('xiaoya:toggle-ss'),
  toggleXiaoyaVisibility: () => ipcRenderer.invoke('xiaoya:toggle-visibility'),
  openXiaoyaFolder: () => ipcRenderer.invoke('xiaoya:open-folder'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:state', listener);
    return () => ipcRenderer.removeListener('app:state', listener);
  },
  onSnapshot: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('damage:snapshot', listener);
    return () => ipcRenderer.removeListener('damage:snapshot', listener);
  },
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('service:log', listener);
    return () => ipcRenderer.removeListener('service:log', listener);
  },
  onUpdate: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  onOverlayEditing: (callback) => {
    const listener = (_event, editing) => callback(editing);
    ipcRenderer.on('overlay:editing', listener);
    return () => ipcRenderer.removeListener('overlay:editing', listener);
  },
  onXiaoyaEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('xiaoya:event', listener);
    return () => ipcRenderer.removeListener('xiaoya:event', listener);
  }
});
