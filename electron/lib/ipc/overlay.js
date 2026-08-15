'use strict';

/** IPC domain: overlay — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('overlay:set-visible', (_event, visible) => {
    const current = ctx.appSettings();
    current.overlay.visible = Boolean(visible);
    ctx.persistAppSettings(current);
    if (visible) ctx.overlayWindow?.showInactive(); else ctx.overlayWindow?.hide();
    return { ok: true };
  });
  
  ipcMain.handle('overlay:set-editing', (_event, editing) => ({ ok: ctx.setOverlayEditing(editing) }));
  
  ipcMain.handle('overlay:resize-content', (_event, requestedHeight) => {
    // Window size is user-controlled (drag resize in edit mode). Content scrolls inside.
    if (!ctx.overlayWindow || ctx.overlayWindow.isDestroyed() || ctx.overlayEditing) return { ok: true };
    const settings = ctx.appSettings().overlay;
    const hasCustomSize = Number.isFinite(Number(settings.width)) && Number.isFinite(Number(settings.height));
    if (hasCustomSize) return { ok: true, height: ctx.overlayWindow.getBounds().height };
    const scale = Math.min(1.4, Math.max(0.8, Number(settings.scale) || 1));
    const display = ctx.screen.getDisplayMatching(ctx.overlayWindow.getBounds()).workArea;
    const height = Math.min(
      display.height - 24,
      Math.max(ctx.OVERLAY_MIN_HEIGHT, Math.round(ctx.OVERLAY_DEFAULT_HEIGHT * scale), Math.round(Number(requestedHeight || ctx.OVERLAY_DEFAULT_HEIGHT) * scale))
    );
    const bounds = ctx.overlayWindow.getBounds();
    ctx.overlayWindow.setBounds({
      x: bounds.x,
      y: Math.min(bounds.y, display.y + display.height - height),
      width: bounds.width,
      height
    });
    return { ok: true, height };
  });
  
  ipcMain.handle('overlay:resize-delta', (_event, dx, dy) => {
    if (!ctx.overlayWindow || ctx.overlayWindow.isDestroyed() || !ctx.overlayEditing) return { ok: false };
    const bounds = ctx.overlayWindow.getBounds();
    const display = ctx.screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(display.width, Math.max(ctx.OVERLAY_MIN_WIDTH, Math.round(bounds.width + Number(dx || 0))));
    const height = Math.min(display.height, Math.max(ctx.OVERLAY_MIN_HEIGHT, Math.round(bounds.height + Number(dy || 0))));
    if (width === bounds.width && height === bounds.height) return { ok: true, ...bounds };
    ctx.overlayWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
    return { ok: true, x: bounds.x, y: bounds.y, width, height };
  });
  
  ipcMain.handle('skill-icon:get', async (_event, skillId) => {
    // Prefer the selected process path; fall back to any known eco.exe path.
    // When eco is not running, SkillIconService still serves disk cache icons.
    let gamePath = ctx.selectedGameProcess()?.path || '';
    if (!gamePath) {
      const fallback = ctx.gameProcesses.find((item) => item.path);
      gamePath = fallback?.path || '';
    }
    const icon = await (ctx.skillIconService?.getIcon(skillId, gamePath)
      || Promise.resolve({ ok: false, reason: 'unavailable' }));
    const mode = ctx.appSettings().appearance?.skillNameMode || 'client';
    const nameClient = ctx.displayNames.getZh(skillId) || String(icon?.name || '').trim();
    const nameJa = ctx.displayNames.getJa(skillId) || '';
    const name = ctx.displayNames.formatSkill(skillId, mode, icon?.name || nameClient);
    return {
      ...icon,
      ok: Boolean(icon?.ok || nameClient || nameJa),
      name,
      nameClient,
      nameJa,
      wikiUrl: ctx.displayNames.wikiSearchUrl(nameJa || nameClient || name)
    };
  });
  
  ipcMain.handle('names:skill', (_event, skillId, preferName = '') => {
    const mode = ctx.appSettings().appearance?.skillNameMode || 'client';
    const name = ctx.displayNames.formatSkill(skillId, mode, preferName);
    return {
      ok: true,
      name,
      nameClient: ctx.displayNames.getZh(skillId),
      nameJa: ctx.displayNames.getJa(skillId),
      wikiUrl: ctx.displayNames.wikiSearchUrl(name)
    };
  });
  
  ipcMain.handle('presets:job-list', () => ({
    ok: true,
    presets: ctx.displayNames.loadJobPresets(),
    wiki: 'https://eco.lycolia.info/wiki/?Skill'
  }));
  
  ipcMain.handle('presets:job-apply', (_event, id) => {
    const preset = ctx.displayNames.loadJobPresets().find((p) => p.id === id);
    if (!preset) return { ok: false, error: '职业模板不存在' };
    const current = ctx.loadCustomBuffDurations();
    const merged = { ...current, ...(preset.custom_durations || {}) };
    const saved = ctx.saveCustomBuffDurations(merged);
    ctx.notifyDamageReloadCustomBuffs(saved.durations);
    ctx.broadcastState({ immediate: true });
    ctx.addLog('buffs', 'success', `已导入职业倒计时模板：${preset.name}`);
    return { ok: true, preset, custom_durations: saved.durations };
  });
  }

module.exports = { register };
