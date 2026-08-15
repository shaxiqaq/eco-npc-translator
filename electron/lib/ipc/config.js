'use strict';

/** IPC domain: config — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('config:export', async (_event, options = {}) => {
    const bundle = ctx.buildConfigBundle({
      settings: ctx.appSettings(),
      custom_durations: ctx.loadCustomBuffDurations(),
      translation: ctx.translationSettings(),
      includeSecrets: Boolean(options.includeSecrets),
      appVersion: ctx.app.getVersion()
    });
    const result = await ctx.dialog.showSaveDialog(ctx.mainWindow || undefined, {
      title: '导出工具箱配置',
      defaultPath: ctx.path.join(ctx.app.getPath('documents'), `eco-toolbox-config-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    ctx.fs.writeFileSync(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
    ctx.addLog('app', 'info', `配置已导出 → ${result.filePath}`);
    return { ok: true, path: result.filePath };
  });
  
  ipcMain.handle('config:import', async () => {
    const result = await ctx.dialog.showOpenDialog(ctx.mainWindow || undefined, {
      title: '导入工具箱配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false, cancelled: true };
    try {
      const parsed = ctx.parseConfigBundle(ctx.fs.readFileSync(result.filePaths[0], 'utf8'));
      if (parsed.settings && Object.keys(parsed.settings).length) {
        const next = ctx.mergeDeep(ctx.appSettings(), parsed.settings);
        ctx.stripAppearanceRuntimeFields(next.appearance || {});
        ctx.persistAppSettings(next);
      }
      if (parsed.custom_durations && Object.keys(parsed.custom_durations).length) {
        ctx.saveCustomBuffDurations(parsed.custom_durations);
        ctx.notifyDamageReloadCustomBuffs(parsed.custom_durations);
      }
      if (parsed.translation) {
        const root = ctx.localDataDir();
        ctx.writeJson(ctx.path.join(root, 'translate_config.json'), {
          provider: parsed.translation.provider || 'deepseek',
          model: parsed.translation.model || '',
          base_url: parsed.translation.base_url || '',
          api_key: parsed.translation.api_key || '',
          first_wait: Number(parsed.translation.first_wait || 0),
          target_lang: parsed.translation.target_lang || 'zh-CN',
          source_lang: parsed.translation.source_lang || 'auto',
          player_names: Array.isArray(parsed.translation.player_names) ? parsed.translation.player_names : [],
          toggle_hotkey: parsed.translation.toggle_hotkey || '',
          skip_hotkey: parsed.translation.skip_hotkey || ''
        });
        if (parsed.translation.sync_url != null || parsed.translation.sync_enabled != null) {
          ctx.writeJson(ctx.path.join(root, 'sync_config.json'), {
            enabled: Boolean(parsed.translation.sync_enabled),
            url: parsed.translation.sync_url || '',
            token: parsed.translation.sync_token || ''
          });
        }
      }
      ctx.registerAppHotkeys();
      ctx.createAppTray();
      ctx.broadcastState({ immediate: true });
      ctx.addLog('app', 'success', '配置已导入');
      return { ok: true, settings: ctx.settingsPublic() };
    } catch (error) {
      return { ok: false, error: error.message || '导入失败' };
    }
  });
  
  ipcMain.handle('presets:list', () => ({ ok: true, presets: ctx.characterPresets.loadAll() }));
  
  ipcMain.handle('presets:save', (_event, payload = {}) => {
    const name = String(payload.name || '').trim() || '未命名预设';
    // Bind to current main window title by default (multi-client auto-apply).
    const windowTitle = String(
      payload.windowTitle != null ? payload.windowTitle : (ctx.rememberedProcessTitle || '')
    ).trim();
    const result = ctx.characterPresets.upsert({
      id: payload.id || `preset-${Date.now()}`,
      name,
      note: payload.note || '',
      windowTitle,
      capture: payload.capture || ctx.appSettings().capture || {},
      custom_durations: payload.custom_durations || ctx.loadCustomBuffDurations(),
      overlay: {
        density: ctx.appSettings().overlay?.density || 'comfortable',
        expiryWarningSeconds: ctx.appSettings().overlay?.expiryWarningSeconds,
        ...(payload.overlay || {})
      }
    });
    ctx.broadcastState();
    ctx.addLog(
      'app',
      'info',
      `角色预设已保存：${name}${windowTitle ? `（绑定窗口 ${windowTitle}）` : ''}`
    );
    return { ok: true, ...result };
  });
  
  ipcMain.handle('presets:apply', (_event, id) => {
    const preset = ctx.characterPresets.loadAll().find((p) => p.id === id);
    if (!preset) return { ok: false, error: '预设不存在' };
    const current = ctx.appSettings();
    if (preset.capture) current.capture = { ...(current.capture || {}), ...preset.capture };
    if (preset.overlay) {
      current.overlay = {
        ...(current.overlay || {}),
        density: preset.overlay.density || current.overlay?.density,
        expiryWarningSeconds: preset.overlay.expiryWarningSeconds ?? current.overlay?.expiryWarningSeconds
      };
    }
    ctx.persistAppSettings(current);
    if (preset.custom_durations) {
      ctx.saveCustomBuffDurations(preset.custom_durations);
      ctx.notifyDamageReloadCustomBuffs(preset.custom_durations);
    }
    if (ctx.services.damage?.stdin?.writable && preset.capture) {
      try {
        ctx.services.damage.stdin.write(`${JSON.stringify({ action: 'set-categories', categories: current.capture })}\n`);
      } catch { /* ignore */ }
    }
    ctx.broadcastState({ immediate: true });
    ctx.addLog('app', 'info', `已应用角色预设：${preset.name}`);
    return {
      ok: true,
      preset,
      settings: ctx.settingsPublic(current),
      custom_durations: ctx.loadCustomBuffDurations()
    };
  });
  
  ipcMain.handle('presets:delete', (_event, id) => {
    const result = ctx.characterPresets.remove(id);
    ctx.broadcastState();
    return { ok: true, ...result };
  });
  }

module.exports = { register };
