import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '../lib/ipc');
const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js') && name !== 'register-handlers.js');
const src = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');

// keywords / locals that aren't free ctx names
const KW = new Set([
  'true', 'false', 'null', 'undefined', 'async', 'await', 'return', 'const', 'let', 'var',
  'if', 'else', 'try', 'catch', 'finally', 'for', 'of', 'in', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'new', 'typeof', 'instanceof', 'void', 'this', 'function', 'class',
  'throw', 'delete', 'default', 'extends', 'import', 'export', 'from', 'as', 'with',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'Error',
  'Promise', 'Map', 'Set', 'RegExp', 'Buffer', 'process', 'console', 'require',
  'ipcMain', 'ctx', 'event', '_event', 'options', 'payload', 'incoming', 'current', 'next',
  'result', 'error', 'zipErr', 'e', 'name', 'id', 'pid', 'visible', 'editing', 'dx', 'dy',
  'requestedHeight', 'skillId', 'preferName', 'durations', 'skills', 'filter', 'format',
  'selected', 'stamp', 'filterSlug', 'defaultName', 'outPath', 'lower', 'exportFormat',
  'body', 'snap', 'grind', 'lines', 'events', 'ev', 'diag', 'diagPath', 'text', 'health',
  'logDirs', 'captureTails', 'alt', 'meterLogs', 'pack', 'zipPath', 'outDir', 'bundle',
  'parsed', 'root', 'translation', 'defaults', 'prev', 'sync', 'windowTitle', 'preset',
  'report', 'scale', 'bounds', 'display', 'width', 'height', 'settings', 'hasCustomSize',
  'icon', 'gamePath', 'fallback', 'mode', 'nameClient', 'nameJa', 'kind', 'rel',
  'normalized', 'saved', 'folder', 'accent', 'nameMode', 'key', 'item', 'p', 'seen',
  'target', 'action', 'categories', 'services',
]);

const provided = new Set([
  'dialog', 'clipboard', 'shell', 'app', 'path', 'fs', 'screen',
  'publicState', 'settingsPublic', 'buildDiagnosticsText', 'currentConnectionHealth',
  'getDiagnosticsPayload', 'addLog', 'localDataDir', 'backendDir', 'defaultDiagnosticLogDirs',
  'collectCaptureLogTails', 'collectNamedLogTails', 'writeDiagnosticPack', 'zipDirectory',
  'latestSnapshot', 'reconnectGameProcess', 'mergeDeep', 'appSettings', 'persistAppSettings',
  'characterPresets', 'selectGameProcess', 'selectXiaoyaProcess', 'refreshGameProcesses',
  'startService', 'stopService', 'resetDamage', 'reidentifySelf', 'battleReport',
  'updateService', 'setOverlayEditing', 'persistOverlayBounds', 'skillIconService',
  'displayNames', 'loadSkillLibrary', 'saveSkillLibrary', 'enrichSkillLibraryNames',
  'importWallpaperImage', 'resolveAppearanceBackground', 'wallpaper', 'loadBackgroundImagePayload',
  'stripAppearanceRuntimeFields', 'buildConfigBundle', 'parseConfigBundle', 'translationSettings',
  'ensureSyncConfig', 'cloneSyncDefaults', 'readJson', 'writeJson', 'dataDir', 'filterLogs',
  'formatLogsExportBody', 'xiaoyaService', 'saveCustomBuffDurations', 'loadCustomBuffDurations',
  'customBuffsPath', 'notifyDamageReloadCustomBuffs', 'broadcastState', 'prepareForUpdateInstall',
  'registerAppHotkeys', 'createAppTray', 'rememberedProcessTitle', 'services',
  'OVERLAY_MIN_WIDTH', 'OVERLAY_MIN_HEIGHT', 'clampOverlayOpacity', 'mainWindow', 'overlayWindow',
  'ipcMain',
]);

const ids = src.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
const used = new Set(ids.filter((x) => !KW.has(x) && !/^\d/.test(x)));
const missing = [...used].filter((x) => !provided.has(x)).sort();
console.log('Potential free names missing from ctx:');
for (const name of missing) console.log(' -', name);
