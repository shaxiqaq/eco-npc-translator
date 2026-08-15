'use strict';

const domains = [
  require('./app'),
  require('./config'),
  require('./capture'),
  require('./update'),
  require('./overlay'),
  require('./settings'),
  require('./logs'),
  require('./xiaoya'),
  require('./buffs')
];

/**
 * Register all IPC handlers. Handlers read live values from ctx
 * (including getters like mainWindow / skillIconService).
 */
function registerIpcHandlers(ipcMain, ctx) {
  if (!ipcMain || !ctx) throw new Error('registerIpcHandlers requires ipcMain and ctx');
  for (const domain of domains) domain.register(ipcMain, ctx);
}

module.exports = { registerIpcHandlers };
