'use strict';

/** IPC domain: xiaoya — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('xiaoya:get-config', () => {
    if (!ctx.xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
    try {
      return { ok: true, skills: ctx.xiaoyaService.readConfig(), state: ctx.xiaoyaService.snapshot() };
    } catch (error) {
      return { ok: false, error: error.message, state: ctx.xiaoyaService.snapshot() };
    }
  });
  
  ipcMain.handle('xiaoya:save-config', (_event, skills) => {
    if (!ctx.xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
    try {
      const normalized = ctx.xiaoyaService.writeConfig(skills);
      ctx.addLog('xiaoya', 'success', '小雅技能配置已保存');
      return { ok: true, skills: normalized, state: ctx.xiaoyaService.snapshot() };
    } catch (error) {
      ctx.addLog('xiaoya', 'error', `保存小雅配置失败：${error.message}`);
      return { ok: false, error: error.message, state: ctx.xiaoyaService.snapshot() };
    }
  });
  
  ipcMain.handle('xiaoya:start', async () => {
    if (!ctx.xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
    const result = await ctx.xiaoyaService.start();
    ctx.addLog('xiaoya', result.ok ? 'info' : 'error', result.ok ? '正在启动小雅' : result.error);
    return result;
  });
  
  ipcMain.handle('xiaoya:stop', async () => {
    if (!ctx.xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
    const result = await ctx.xiaoyaService.stop();
    ctx.addLog('xiaoya', result.ok ? 'info' : 'error', result.ok ? '小雅停止请求已发送' : result.error);
    return result;
  });
  
  ipcMain.handle('xiaoya:toggle-ss', async () => {
    if (!ctx.xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
    const result = await ctx.xiaoyaService.toggleSs();
    ctx.addLog('xiaoya', result.ok ? 'info' : 'error', result.ok ? 'SS 模式切换已发送' : result.error);
    return result;
  });
  
  ipcMain.handle('xiaoya:toggle-visibility', async () => {
    if (!ctx.xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
    const result = await ctx.xiaoyaService.toggleVisibility();
    ctx.addLog(
      'xiaoya',
      result.ok ? 'info' : 'error',
      result.ok ? (result.visible ? 'ECO 窗口已显示' : 'ECO 窗口已隐藏') : result.error
    );
    return result;
  });
  
  ipcMain.handle('xiaoya:open-folder', () => {
  
    if (!ctx.xiaoyaService) return { ok: false, error: '小雅服务尚未就绪' };
    try {
      ctx.xiaoyaService.ensureRuntime();
      ctx.shell.openPath(ctx.xiaoyaService.runtimeDir);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  }

module.exports = { register };
