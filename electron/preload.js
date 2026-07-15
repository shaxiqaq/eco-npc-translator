const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eco', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  refreshGameProcesses: () => ipcRenderer.invoke('game-processes:refresh'),
  selectGameProcess: (pid) => ipcRenderer.invoke('game-processes:select', pid),
  startService: (name) => ipcRenderer.invoke('service:start', name),
  stopService: (name) => ipcRenderer.invoke('service:stop', name),
  resetDamage: () => ipcRenderer.invoke('damage:reset'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  saveTranslationSettings: (settings) => ipcRenderer.invoke('settings:save-translation', settings),
  saveAppSettings: (settings) => ipcRenderer.invoke('settings:save-app', settings),
  setOverlayVisible: (visible) => ipcRenderer.invoke('overlay:set-visible', visible),
  setOverlayEditing: (editing) => ipcRenderer.invoke('overlay:set-editing', editing),
  openLogs: () => ipcRenderer.invoke('logs:open-folder'),
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
  }
});
