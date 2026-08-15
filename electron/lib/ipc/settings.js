'use strict';

const { applyOverlayVisibility } = require('../overlay-window');

/** IPC domain: settings — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('settings:save-app', (_event, incoming) => {
    const current = ctx.mergeDeep(ctx.appSettings(), incoming || {});
    if (current.overlay) {
      current.overlay.opacity = ctx.clampOverlayOpacity(current.overlay.opacity);
      const scale = Math.min(1.4, Math.max(0.8, Number(current.overlay.scale) || 1));
      current.overlay.scale = scale;
      if (Number.isFinite(Number(current.overlay.width))) {
        current.overlay.width = Math.max(ctx.OVERLAY_MIN_WIDTH, Math.round(Number(current.overlay.width)));
      }
      if (Number.isFinite(Number(current.overlay.height))) {
        current.overlay.height = Math.max(ctx.OVERLAY_MIN_HEIGHT, Math.round(Number(current.overlay.height)));
      }
    }
    if (current.appearance) {
      current.appearance.backgroundDim = ctx.clampDim(current.appearance.backgroundDim, 0.52);
      current.appearance.backgroundBlur = ctx.clampBlur(current.appearance.backgroundBlur, 6);
      current.appearance.backgroundFit = ctx.clampFit(current.appearance.backgroundFit, 'cover');
      current.appearance.overlayBgMode = ctx.normalizeOverlayBgMode(current.appearance);
      current.appearance.applyToOverlay = current.appearance.overlayBgMode !== 'solid';
      current.appearance.overlayBackgroundDim = ctx.clampDim(current.appearance.overlayBackgroundDim, 0.62);
      current.appearance.overlayBackgroundBlur = ctx.clampBlur(current.appearance.overlayBackgroundBlur, 4);
      current.appearance.overlayBackgroundFit = ctx.clampFit(current.appearance.overlayBackgroundFit, 'cover');
      current.appearance.overlayBackgroundImage = ctx.safeBackgroundRel(current.appearance.overlayBackgroundImage);
      if (current.appearance.overlayBgMode !== 'custom') {
        // Keep custom image on disk/settings so switching back restores it.
      }
      const accent = String(current.appearance.accent || 'amber');
      current.appearance.accent = ['amber', 'teal', 'violet', 'rose', 'cyan', 'slate'].includes(accent)
        ? accent
        : 'amber';
      const nameMode = String(current.appearance.skillNameMode || 'client');
      current.appearance.skillNameMode = ['client', 'ja', 'dual'].includes(nameMode) ? nameMode : 'client';
      // Never persist runtime image payloads into settings.
      ctx.stripAppearanceRuntimeFields(current.appearance);
    }
    ctx.persistAppSettings(current);
    if (incoming?.capture && ctx.services.damage?.stdin?.writable) {
      ctx.services.damage.stdin.write(`${JSON.stringify({
        action: 'set-categories',
        categories: current.capture
      })}\n`);
    }
    if (incoming?.appearance?.skillNameMode && ctx.services.damage?.stdin?.writable) {
      try {
        ctx.services.damage.stdin.write(`${JSON.stringify({
          action: 'set-skill-name-mode',
          mode: current.appearance.skillNameMode
        })}\n`);
      } catch { /* ignore */ }
    }
    if (ctx.overlayWindow && !ctx.overlayWindow.isDestroyed()) {
      const bounds = ctx.overlayWindow.getBounds();
      const next = ctx.overlayBounds(current.overlay);
      // Keep current position if user already placed the window; only apply size from settings.
      ctx.overlayWindow.setBounds({
        x: Number.isFinite(current.overlay.x) ? next.x : bounds.x,
        y: Number.isFinite(current.overlay.y) ? next.y : bounds.y,
        width: next.width,
        height: next.height
      });
      ctx.overlayWindow.setOpacity(ctx.clampOverlayOpacity(current.overlay.opacity));
      if (incoming?.overlay && Object.prototype.hasOwnProperty.call(incoming.overlay, 'visible')) {
        applyOverlayVisibility(ctx.overlayWindow, current.overlay.visible !== false);
      }
      ctx.overlayWindow.webContents.send('app:state', ctx.buildLightState());
    }
    // Status monitoring can start/stop the shared capture backend independently of damage collection.
    if (incoming?.overlay && Object.prototype.hasOwnProperty.call(incoming.overlay, 'monitoring')) {
      ctx.reconcileCaptureBackend();
    } else {
      ctx.broadcastState();
    }
    if (incoming?.hotkeys || incoming?.startup) {
      ctx.registerAppHotkeys();
      ctx.createAppTray();
    }
    return {
      ok: true,
      settings: {
        ...current,
        appearance: ctx.resolveAppearanceBackground(current)
      }
    };
  });
  
  ipcMain.handle('appearance:pick-background', async (_event, target = 'main') => {
    const kind = target === 'overlay' ? 'overlay' : 'main';
    const result = await ctx.dialog.showOpenDialog(ctx.mainWindow || undefined, {
      title: kind === 'overlay' ? '选择悬浮窗背景图片' : '选择背景图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
      ]
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, cancelled: true };
    }
    let rel = '';
    try {
      rel = ctx.importWallpaperImage(result.filePaths[0], kind);
    } catch (error) {
      return { ok: false, error: error.message || '导入背景图失败' };
    }
    ctx.wallpaper.clearImageCache();
    const current = ctx.appSettings();
    if (kind === 'overlay') {
      current.appearance = {
        ...ctx.defaultAppSettings.appearance,
        ...(current.appearance || {}),
        overlayBgMode: 'custom',
        overlayBackgroundImage: rel,
        applyToOverlay: true
      };
    } else {
      current.appearance = {
        ...ctx.defaultAppSettings.appearance,
        ...(current.appearance || {}),
        backgroundImage: rel
      };
    }
    ctx.stripAppearanceRuntimeFields(current.appearance);
    ctx.persistAppSettings(current);
    ctx.broadcastState();
    return {
      ok: true,
      settings: {
        ...current,
        appearance: ctx.resolveAppearanceBackground(current)
      }
    };
  });
  
  ipcMain.handle('appearance:clear-background', (_event, target = 'main') => {
    const kind = target === 'overlay' ? 'overlay' : 'main';
    ctx.wallpaper.clearImageCache();
    const current = ctx.appSettings();
    if (kind === 'overlay') {
      current.appearance = {
        ...ctx.defaultAppSettings.appearance,
        ...(current.appearance || {}),
        overlayBackgroundImage: '',
        // Stay on custom mode with empty image → solid until user picks again,
        // or switch to solid for clarity.
        overlayBgMode: 'solid',
        applyToOverlay: false
      };
    } else {
      current.appearance = {
        ...ctx.defaultAppSettings.appearance,
        ...(current.appearance || {}),
        backgroundImage: ''
      };
    }
    ctx.stripAppearanceRuntimeFields(current.appearance);
    ctx.persistAppSettings(current);
    ctx.wallpaper.cleanupWallpaperFiles(kind);
    ctx.broadcastState();
    return {
      ok: true,
      settings: {
        ...current,
        appearance: ctx.resolveAppearanceBackground(current)
      }
    };
  });
  
  ipcMain.handle('settings:save-translation', (_event, incoming) => {
    // Must match ECO_DATA_DIR / localDataDir so the Python mitm backend reads the same file.
    const root = ctx.localDataDir();
    ctx.fs.mkdirSync(root, { recursive: true });
    const translation = {
      provider: incoming.provider,
      model: incoming.model,
      base_url: incoming.base_url || '',
      api_key: incoming.api_key || '',
      first_wait: Number(incoming.first_wait || 0),
      target_lang: incoming.target_lang || 'zh-CN',
      source_lang: incoming.source_lang || 'auto',
      player_names: incoming.player_names || [],
      toggle_hotkey: incoming.toggle_hotkey || '',
      skip_hotkey: incoming.skip_hotkey || ''
    };
    // Shared dict is public for all users; empty URL falls back to the official node.
    const defaults = ctx.cloneSyncDefaults();
    const prev = ctx.readJson(ctx.path.join(root, 'sync_config.json'), defaults);
    const sync = {
      // Only an explicit false turns sync off; missing / true → on.
      enabled: incoming.sync_enabled === false ? false : true,
      url: String(incoming.sync_url || '').trim() || defaults.url,
      token: String(incoming.sync_token || '').trim() || defaults.token,
      pull_interval: Number(prev.pull_interval) > 0 ? Number(prev.pull_interval) : defaults.pull_interval,
      flush_interval: Number(prev.flush_interval) > 0 ? Number(prev.flush_interval) : defaults.flush_interval,
      pull_on_start: prev.pull_on_start !== false
    };
    ctx.writeJson(ctx.path.join(root, 'translate_config.json'), translation);
    ctx.writeJson(ctx.path.join(root, 'sync_config.json'), sync);
    ctx.addLog('translator', 'success', '翻译设置已保存，重新启动翻译后生效');
    ctx.broadcastState();
    return { ok: true };
  });
  }

module.exports = { register };
