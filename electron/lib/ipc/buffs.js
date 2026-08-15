'use strict';

/** IPC domain: buffs — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('buffs:save-custom-durations', (_event, durations) => {
    try {
      const saved = ctx.saveCustomBuffDurations(durations);
      ctx.notifyDamageReloadCustomBuffs(saved.durations);
      ctx.addLog(
        'buffs',
        'success',
        `自定义倒计时已保存到本地（${Object.keys(saved.durations).length} 条）`
      );
      ctx.broadcastState();
      return {
        ok: true,
        custom_durations: saved.durations,
        path: saved.path
      };
    } catch (e) {
      ctx.addLog('monitoring', 'error', `保存自定义倒计时失败：${e.message}`);
      return { ok: false, error: String(e) };
    }
  });
  
  ipcMain.handle('buffs:get-custom-durations', () => {
    const custom_durations = ctx.loadCustomBuffDurations();
    return {
      ok: true,
      custom_durations,
      path: ctx.customBuffsPath()
    };
  });
  
  ipcMain.handle('skills:get-library', async () => {
    // Force English/original client names from skill-icon cache before returning chips.
    const skill_library = await ctx.enrichSkillLibraryNames();
    return { ok: true, skill_library };
  });
  }

module.exports = { register };
