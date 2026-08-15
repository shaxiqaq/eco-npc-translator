'use strict';

/** IPC domain: capture — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('game-processes:refresh', () => ctx.refreshGameProcesses());
  
  ipcMain.handle('game-processes:select', async (_event, pid, options = {}) => ctx.selectGameProcess(pid, options));
  
  ipcMain.handle('game-processes:select-xiaoya', (_event, pid) => ctx.selectXiaoyaProcess(pid));
  
  ipcMain.handle('service:start', (_event, name) => ctx.startService(name));
  
  ipcMain.handle('service:stop', (_event, name) => ctx.stopService(name));
  
  ipcMain.handle('service:prestart', () => ctx.prestartServices());
  
  ipcMain.handle('damage:reset', () => ctx.resetDamage());
  
  ipcMain.handle('damage:reidentify-self', () => ctx.reidentifySelf());
  
  ipcMain.handle('battle:get-report', () => ({ ok: true, report: ctx.battleReport.snapshot() }));
  
  ipcMain.handle('battle:reset-report', () => {
    ctx.battleReport.reset();
    ctx.broadcastState();
    return { ok: true, report: ctx.battleReport.snapshot() };
  });
  
  ipcMain.handle('battle:export-report', async (_event, options = {}) => {
    const format = String(options.format || 'txt').toLowerCase() === 'json' ? 'json' : 'txt';
    const report = ctx.battleReport.snapshot();
    if (!report.samples && !report.last) {
      return { ok: false, error: '暂无战斗数据可导出（请先开启伤害采集一段时间）' };
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `eco-battle-report-${stamp}.${format}`;
    const result = await ctx.dialog.showSaveDialog(ctx.mainWindow || undefined, {
      title: '导出战斗报告',
      defaultPath: ctx.path.join(ctx.app.getPath('documents'), defaultName),
      filters: format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: '文本', extensions: ['txt', 'log'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    let outPath = result.filePath;
    if (format === 'json' && !outPath.toLowerCase().endsWith('.json')) outPath += '.json';
    if (format === 'txt' && !/\.(txt|log)$/i.test(outPath)) outPath += '.txt';
    const body = format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : ctx.battleReport.formatText(report, { characterTitle: ctx.rememberedProcessTitle });
    ctx.fs.writeFileSync(outPath, body, 'utf8');
    ctx.addLog('damage', 'info', `战斗报告已导出 → ${outPath}`);
    return { ok: true, path: outPath, report };
  });
  
  ipcMain.handle('battle:copy-report', () => {
    const report = ctx.battleReport.snapshot();
    if (!report.samples && !report.last) {
      return { ok: false, error: '暂无战斗数据可复制' };
    }
    const text = ctx.battleReport.formatText(report, { characterTitle: ctx.rememberedProcessTitle });
    ctx.clipboard.writeText(text);
    ctx.addLog('damage', 'info', '战斗报告已复制到剪贴板');
    return { ok: true, text };
  });
  }

module.exports = { register };
