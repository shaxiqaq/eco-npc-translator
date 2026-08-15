'use strict';

/** IPC domain: logs — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
  ipcMain.handle('logs:open-folder', () => {
    const folder = ctx.path.join(ctx.localDataDir(), 'logs');
    ctx.fs.mkdirSync(folder, { recursive: true });
    ctx.shell.openPath(folder);
    return { ok: true };
  });
  
  ipcMain.handle('logs:export', async (_event, options = {}) => {
    const filter = String(options.filter || 'all');
    const format = String(options.format || 'txt').toLowerCase() === 'json' ? 'json' : 'txt';
    const selected = ctx.filterLogs(filter);
    if (!selected.length) {
      return { ok: false, error: '当前筛选下没有可导出的日志' };
    }
  
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filterSlug = filter === 'all' ? 'all' : filter;
    const defaultName = `eco-toolbox-logs-${filterSlug}-${stamp}.${format}`;
    const result = await ctx.dialog.showSaveDialog(ctx.mainWindow || undefined, {
      title: '导出运行日志',
      defaultPath: ctx.path.join(ctx.app.getPath('documents'), defaultName),
      filters: format === 'json'
        ? [{ name: 'JSON', extensions: ['json'] }, { name: '文本', extensions: ['txt', 'log'] }]
        : [{ name: '文本', extensions: ['txt', 'log'] }, { name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true };
    }
  
    let outPath = result.filePath;
    const lower = outPath.toLowerCase();
    if (format === 'json' && !lower.endsWith('.json')) outPath += '.json';
    if (format === 'txt' && !/\.(txt|log)$/i.test(outPath)) outPath += '.txt';
  
    try {
      const exportFormat = outPath.toLowerCase().endsWith('.json') ? 'json' : 'txt';
      let body = ctx.formatLogsExportBody(selected, { filter, format: exportFormat });
      // Append a compact combat/exp snapshot so sparse UI ring logs are still useful.
      try {
        const snap = ctx.latestSnapshot || null;
        if (snap && exportFormat === 'txt') {
          const grind = snap.grind || {};
          const lines = [
            '',
            '# --- 采集快照（导出时） ---',
            `# self_id=${snap.self_id ?? 'null'} ride_mode=${Boolean(snap.ride_mode)} ride_mount=${snap.ride_mount_id ?? 'null'} possession_host=${snap.possession_host_id ?? 'null'}`,
            `# dealt=${snap.dealt || 0} self_skill=${snap.self_skill_dealt || 0} self_normal=${snap.self_normal_dealt || 0} ride_skill=${snap.ride_skill_dealt || 0} ride_normal=${snap.ride_normal_dealt || 0} pet=${snap.pet_dealt || 0}`,
            `# packets=${snap.packet_count || 0} last_packet_age=${snap.last_packet_age ?? 'n/a'}`,
            `# grind_ready=${Boolean(grind.ready)} level=${grind.level ?? 'n/a'} cexp%=${grind.cexp_pct ?? 'n/a'} jexp%=${grind.jexp_pct ?? 'n/a'} session_cexp%=${grind.session_cexp_pct ?? 0}`,
          ];
          const events = Array.isArray(snap.events) ? snap.events.slice(0, 12) : [];
          for (const ev of events) {
            if (Array.isArray(ev)) lines.push(`# event ${ev[0] || ''} ${ev[1] || ''}`);
          }
          body += `${lines.join('\n')}\n`;
        }
      } catch {
        /* snapshot optional */
      }
      ctx.fs.writeFileSync(outPath, body, 'utf8');
  
      // Also write a companion diagnostic sidecar for remote support.
      try {
        const diag = ctx.getDiagnosticsPayload();
        // Prefer the filtered export log slice in the sidecar.
        diag.recentLogs = selected.slice(-80);
        if (ctx.latestSnapshot) {
          diag.snapshotSummary = {
            self_id: ctx.latestSnapshot.self_id,
            ride_mode: ctx.latestSnapshot.ride_mode,
            ride_mount_id: ctx.latestSnapshot.ride_mount_id,
            possession_host_id: ctx.latestSnapshot.possession_host_id,
            dealt: ctx.latestSnapshot.dealt,
            self_skill_dealt: ctx.latestSnapshot.self_skill_dealt,
            self_normal_dealt: ctx.latestSnapshot.self_normal_dealt,
            ride_skill_dealt: ctx.latestSnapshot.ride_skill_dealt,
            ride_normal_dealt: ctx.latestSnapshot.ride_normal_dealt,
            pet_dealt: ctx.latestSnapshot.pet_dealt,
            packet_count: ctx.latestSnapshot.packet_count,
            grind: ctx.latestSnapshot.grind || null,
            events: (ctx.latestSnapshot.events || []).slice(0, 20),
          };
        }
        const diagPath = outPath.replace(/\.(txt|log|json)$/i, '') + '.diag.json';
        ctx.fs.writeFileSync(diagPath, `${JSON.stringify(diag, null, 2)}\n`, 'utf8');
        ctx.addLog('app', 'info', `已导出 ${selected.length} 条日志 → ${outPath}`);
        return { ok: true, path: outPath, diagPath, count: selected.length };
      } catch {
        ctx.addLog('app', 'info', `已导出 ${selected.length} 条日志 → ${outPath}`);
        return { ok: true, path: outPath, count: selected.length };
      }
    } catch (error) {
      return { ok: false, error: error.message || '导出日志失败' };
    }
  });
  }

module.exports = { register };
