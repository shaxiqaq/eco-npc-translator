'use strict';

/** IPC domain: update — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('update:check', () => ctx.updateService?.check() || { ok: false, error: '更新服务尚未就绪' });
  
  ipcMain.handle('update:download', () => ctx.updateService?.download() || { ok: false, error: '更新服务尚未就绪' });
  
  ipcMain.handle('update:install', async () => {
    if (!ctx.updateService) return { ok: false, error: '更新服务尚未就绪' };
    if (ctx.updateService.snapshot().phase !== 'downloaded') return { ok: false, error: '更新尚未下载完成' };
    await ctx.prepareForUpdateInstall();
    return ctx.updateService.install();
  });
  }

module.exports = { register };
