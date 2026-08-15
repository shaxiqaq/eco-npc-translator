# -*- coding: utf-8 -*-
"""OBSOLETE: IPC now lives in electron/lib/ipc/*.js as real modules.

Kept only as a historical note. Do not regenerate register-handlers.js from main.js.
"""
raise SystemExit("extract_ipc.py is obsolete — edit electron/lib/ipc/*.js directly")
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
main_path = ROOT / "electron" / "main.js"
lines = main_path.read_text(encoding="utf-8").splitlines(True)

start = end = None
for i, line in enumerate(lines):
    if start is None and line.startswith("ipcMain.handle("):
        start = i
    if start is not None and line.startswith("app.whenReady"):
        end = i
        break

if start is None or end is None:
    raise SystemExit(f"ipc block not found: start={start} end={end}")

block = "".join(lines[start:end])
body_json = json.dumps(block)

out = ROOT / "electron" / "lib" / "ipc" / "register-handlers.js"
out.parent.mkdir(parents=True, exist_ok=True)

source = f'''"use strict";

/**
 * IPC handlers extracted from main.js (behavior-preserving mechanical extract).
 *
 * Handlers execute via `with (ctx)` inside a non-strict Function body so free
 * names resolve from the context bag supplied by main.js.
 *
 * @param {{ import("electron").IpcMain }} ipcMain
 * @param {{ Record<string, any> }} ctx
 */
function registerIpcHandlers(ipcMain, ctx) {{
  const sandbox = Object.assign(Object.create(null), ctx, {{ ipcMain }});
  // NOTE: deliberately no "use strict" inside runner — `with` is required for extract.
  const runner = new Function(
    "ipcMain",
    "ctx",
    "with (ctx) {{\\n" + HANDLER_SOURCE + "\\n}}\\n"
  );
  runner(ipcMain, sandbox);
}}

const HANDLER_SOURCE = {body_json};

module.exports = {{ registerIpcHandlers }};
'''

out.write_text(source, encoding="utf-8")
print("wrote", out, "handler_chars", len(block))

call = """const { registerIpcHandlers } = require('./lib/ipc/register-handlers');
registerIpcHandlers(ipcMain, {
  dialog,
  clipboard,
  shell,
  app,
  path,
  fs,
  publicState,
  buildDiagnosticsText,
  currentConnectionHealth,
  getDiagnosticsPayload,
  addLog,
  localDataDir,
  backendDir,
  defaultDiagnosticLogDirs,
  collectCaptureLogTails,
  collectNamedLogTails,
  writeDiagnosticPack,
  zipDirectory,
  get latestSnapshot() { return latestSnapshot; },
  set latestSnapshot(v) { latestSnapshot = v; },
  reconnectGameProcess,
  mergeDeep,
  appSettings,
  persistAppSettings,
  characterPresets,
  selectGameProcess,
  selectXiaoyaProcess,
  refreshGameProcesses,
  startService,
  stopService,
  resetDamage,
  reidentifySelf,
  battleReport,
  get updateService() { return updateService; },
  setOverlayEditing,
  persistOverlayBounds,
  get skillIconService() { return skillIconService; },
  displayNames,
  loadSkillLibrary,
  saveSkillLibrary,
  enrichSkillLibraryNames,
  importWallpaperImage,
  resolveAppearanceBackground,
  wallpaper,
  loadBackgroundImagePayload,
  translationSettings,
  ensureSyncConfig,
  cloneSyncDefaults,
  readJson,
  writeJson,
  dataDir,
  filterLogs,
  formatLogsExportBody,
  get xiaoyaService() { return xiaoyaService; },
  saveCustomBuffDurations,
  loadCustomBuffDurations,
  customBuffsPath,
  notifyDamageReloadCustomBuffs,
  broadcastState,
  prepareForUpdateInstall,
  OVERLAY_MIN_WIDTH,
  OVERLAY_MIN_HEIGHT,
  get mainWindow() { return mainWindow; },
  get overlayWindow() { return overlayWindow; },
});

"""

new_lines = lines[:start] + [call] + lines[end:]
main_path.write_text("".join(new_lines), encoding="utf-8")
print("main.js lines", len(new_lines), "removed_ipc_lines", end - start)
