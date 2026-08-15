'use strict';

/** IPC domain: app — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('app:get-state', () => ctx.publicState());
  
  ipcMain.handle('app:get-diagnostics', () => ({
    ok: true,
    text: ctx.buildDiagnosticsText(),
    health: ctx.currentConnectionHealth(),
    diagnostics: ctx.getDiagnosticsPayload()
  }));
  
  ipcMain.handle('app:copy-diagnostics', () => {
    const text = ctx.buildDiagnosticsText();
    ctx.clipboard.writeText(text);
    ctx.addLog('app', 'info', '诊断信息已复制到剪贴板');
    return { ok: true, text };
  });
  
  ipcMain.handle('app:export-diagnostic-pack', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `eco-toolbox-diag-${stamp}`;
    const result = await ctx.dialog.showSaveDialog(ctx.mainWindow || undefined, {
      title: '导出诊断包',
      defaultPath: ctx.path.join(ctx.app.getPath('documents'), defaultName),
      buttonLabel: '导出诊断包',
      // No extension — we create a folder of files for remote support.
      filters: [{ name: '诊断包文件夹', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true };
    }
  
    let outDir = result.filePath;
    // If the user picked something ending in .json/.txt, strip and use as folder.
    outDir = outDir.replace(/\.(json|txt|zip)$/i, '');
    try {
      ctx.fs.mkdirSync(outDir, { recursive: true });
      const diag = ctx.getDiagnosticsPayload();
      const text = ctx.buildDiagnosticsText();
      const health = diag.connectionHealth || ctx.currentConnectionHealth();
      const logDirs = ctx.defaultDiagnosticLogDirs({
        localDataDir: ctx.localDataDir,
        backendDir: ctx.backendDir
      });
      const captureTails = ctx.collectCaptureLogTails(logDirs, {
        prefix: 'damage_electron_',
        maxBytes: 160_000,
        maxFiles: 2
      });
      // Also try generic capture prefixes if electron logs are empty.
      if (!captureTails.tails.length) {
        const alt = ctx.collectCaptureLogTails(logDirs, {
          prefix: 'damage_',
          maxBytes: 120_000,
          maxFiles: 2
        });
        if (alt.tails.length) {
          captureTails.tails = alt.tails;
          captureTails.files = alt.files;
        }
      }
      // Python backend logs — essential for remote support.
      const meterLogs = ctx.collectNamedLogTails(
        logDirs,
        ['eco_damage_meter.log', 'eco_damage_capture.log', 'eco_npc_mitm.log'],
        { maxBytes: 100_000 }
      );
      const pack = ctx.writeDiagnosticPack(outDir, {
        diag,
        text,
        snapshot: ctx.latestSnapshot || null,
        captureTails,
        meterLogs,
        hints: health.hints || []
      });
  
      // Best-effort zip beside the folder for easier sharing.
      let zipPath = null;
      try {
        zipPath = await ctx.zipDirectory(outDir);
      } catch (zipErr) {
        ctx.addLog('app', 'warn', `诊断包压缩失败（仍有文件夹）：${zipErr.message || zipErr}`);
      }
  
      ctx.addLog(
        'app',
        'success',
        zipPath
          ? `已导出诊断包（含 SUMMARY + meter 日志）→ ${zipPath}`
          : `已导出诊断包（${pack.files.length} 个文件，含 SUMMARY）→ ${outDir}`
      );
      try {
        // Prefer SUMMARY for remote helpers when browsing the folder.
        ctx.shell.showItemInFolder(zipPath || ctx.path.join(outDir, 'SUMMARY.txt'));
      } catch {
        /* optional */
      }
      return {
        ok: true,
        path: zipPath || outDir,
        dir: outDir,
        zipPath,
        files: pack.files.length
      };
    } catch (error) {
      return { ok: false, error: error.message || '导出诊断包失败' };
    }
  });
  
  ipcMain.handle('app:reconnect', async () => ctx.reconnectGameProcess({ reason: 'manual' }));
  
  ipcMain.handle('app:set-onboarding-seen', (_event, seen = true) => {
    const current = ctx.appSettings();
    current.onboarding = { ...(current.onboarding || {}), seenGuide: Boolean(seen) };
    ctx.persistAppSettings(current);
    ctx.broadcastState();
    return { ok: true, settings: ctx.settingsPublic(current) };
  });
  
  ipcMain.handle('app:get-about', () => ({
    ok: true,
    about: {
      version: ctx.app.getVersion(),
      packaged: ctx.app.isPackaged,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      elevated: ctx.elevatedCache,
      hotkeys: ctx.appSettings().hotkeys || {},
      rememberedTitles: {
        main: ctx.rememberedProcessTitle || null,
        xiaoya: ctx.rememberedXiaoyaTitle || null
      },
      errorCodes: require('./lib/error-codes').ERROR_CATALOG
    }
  }));
  }

module.exports = { register };
