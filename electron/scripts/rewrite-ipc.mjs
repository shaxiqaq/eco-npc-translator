/**
 * Turn extracted ipcMain.handle source into domain modules that use ctx.*
 * instead of `with (ctx)`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'lib/ipc/_extracted-handlers.js'), 'utf8');

const PROVIDED = new Set([
  'dialog', 'clipboard', 'shell', 'app', 'path', 'fs', 'screen',
  'publicState', 'settingsPublic', 'buildDiagnosticsText', 'currentConnectionHealth',
  'getDiagnosticsPayload', 'addLog', 'localDataDir', 'backendDir', 'defaultDiagnosticLogDirs',
  'collectCaptureLogTails', 'collectNamedLogTails', 'writeDiagnosticPack', 'zipDirectory',
  'latestSnapshot', 'reconnectGameProcess', 'mergeDeep', 'appSettings', 'persistAppSettings',
  'characterPresets', 'selectGameProcess', 'selectXiaoyaProcess', 'refreshGameProcesses',
  'startService', 'stopService', 'resetDamage', 'reidentifySelf', 'battleReport',
  'updateService', 'setOverlayEditing', 'persistOverlayBounds', 'skillIconService',
  'selectedGameProcess', 'gameProcesses', 'displayNames',
  'loadSkillLibrary', 'saveSkillLibrary', 'enrichSkillLibraryNames',
  'importWallpaperImage', 'resolveAppearanceBackground', 'wallpaper', 'loadBackgroundImagePayload',
  'stripAppearanceRuntimeFields', 'buildConfigBundle', 'parseConfigBundle', 'translationSettings',
  'ensureSyncConfig', 'cloneSyncDefaults', 'readJson', 'writeJson', 'dataDir', 'filterLogs',
  'formatLogsExportBody', 'xiaoyaService', 'saveCustomBuffDurations', 'loadCustomBuffDurations',
  'customBuffsPath', 'notifyDamageReloadCustomBuffs', 'broadcastState', 'prepareForUpdateInstall',
  'registerAppHotkeys', 'createAppTray', 'rememberedProcessTitle', 'rememberedXiaoyaTitle',
  'elevatedCache', 'overlayEditing', 'services',
  'OVERLAY_MIN_WIDTH', 'OVERLAY_MIN_HEIGHT', 'OVERLAY_DEFAULT_HEIGHT',
  'clampOverlayOpacity', 'clampDim', 'clampBlur', 'clampFit',
  'normalizeOverlayBgMode', 'safeBackgroundRel', 'defaultAppSettings', 'overlayBounds',
  'buildLightState', 'reconcileCaptureBackend', 'mainWindow', 'overlayWindow'
]);

function rewrite(input) {
  let out = '';
  let i = 0;
  let prevIdentEnd = false;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '/' && input[i + 1] === '/') {
      const end = input.indexOf('\n', i);
      const slice = end === -1 ? input.slice(i) : input.slice(i, end + 1);
      out += slice;
      i += slice.length;
      prevIdentEnd = false;
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      const slice = end === -1 ? input.slice(i) : input.slice(i, end + 2);
      out += slice;
      i += slice.length;
      prevIdentEnd = false;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < input.length) {
        if (input[j] === '\\') {
          j += 2;
          continue;
        }
        if (input[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += input.slice(i, j);
      i = j;
      prevIdentEnd = false;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_$]/.test(input[j])) j += 1;
      const ident = input.slice(i, j);
      const before = out.replace(/\s+$/, '');
      const afterDot = before.endsWith('.');
      if (!afterDot && PROVIDED.has(ident)) out += `ctx.${ident}`;
      else out += ident;
      i = j;
      prevIdentEnd = true;
      continue;
    }
    out += ch;
    i += 1;
    if (!/\s/.test(ch)) prevIdentEnd = false;
  }
  return out;
}

const rewritten = rewrite(src);
const handles = [...rewritten.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]);

const GROUPS = {
  'app.js': (ch) => ch.startsWith('app:'),
  'config.js': (ch) => ch.startsWith('config:') || (ch.startsWith('presets:') && !ch.startsWith('presets:job')),
  'capture.js': (ch) =>
    ch.startsWith('game-processes:') ||
    ch.startsWith('service:') ||
    ch.startsWith('damage:') ||
    ch.startsWith('battle:'),
  'update.js': (ch) => ch.startsWith('update:'),
  'overlay.js': (ch) =>
    ch.startsWith('overlay:') ||
    ch.startsWith('skill-icon:') ||
    ch.startsWith('names:') ||
    ch.startsWith('presets:job'),
  'settings.js': (ch) => ch.startsWith('settings:') || ch.startsWith('appearance:'),
  'logs.js': (ch) => ch.startsWith('logs:'),
  'xiaoya.js': (ch) => ch.startsWith('xiaoya:'),
  'buffs.js': (ch) => ch.startsWith('buffs:') || ch.startsWith('skills:')
};

function splitByHandle(text) {
  const parts = [];
  const re = /ipcMain\.handle\(/g;
  const idxs = [];
  let m;
  while ((m = re.exec(text))) idxs.push(m.index);
  idxs.push(text.length);
  for (let i = 0; i < idxs.length - 1; i++) {
    parts.push(text.slice(idxs[i], idxs[i + 1]).trim() + '\n');
  }
  return parts;
}

const parts = splitByHandle(rewritten);
const buckets = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, []]));
const leftover = [];
for (const part of parts) {
  const ch = (part.match(/ipcMain\.handle\('([^']+)'/) || [])[1];
  const file = Object.keys(GROUPS).find((name) => GROUPS[name](ch));
  if (file) buckets[file].push(part);
  else leftover.push(part);
}
if (leftover.length) {
  console.error('unassigned handlers', leftover.map((p) => (p.match(/ipcMain\.handle\('([^']+)'/) || [])[1]));
  process.exit(1);
}

const header = (name) => `'use strict';

/** IPC domain: ${name.replace('.js', '')} — live values stay on ctx (getters). */
function register(ipcMain, ctx) {
`;

for (const [file, items] of Object.entries(buckets)) {
  const body = items.map((p) => p.replace(/^/gm, '  ')).join('\n');
  const text = `${header(file)}${body}}\n\nmodule.exports = { register };\n`;
  fs.writeFileSync(path.join(root, 'lib/ipc', file), text);
  console.log('wrote', file, items.length, 'handlers');
}

const register = `'use strict';

const domains = [
  require('./app'),
  require('./config'),
  require('./capture'),
  require('./update'),
  require('./overlay'),
  require('./settings'),
  require('./logs'),
  require('./xiaoya'),
  require('./buffs')
];

/**
 * Register all IPC handlers. Handlers read live values from ctx
 * (including getters like mainWindow / skillIconService).
 */
function registerIpcHandlers(ipcMain, ctx) {
  if (!ipcMain || !ctx) throw new Error('registerIpcHandlers requires ipcMain and ctx');
  for (const domain of domains) domain.register(ipcMain, ctx);
}

module.exports = { registerIpcHandlers };
`;
fs.writeFileSync(path.join(root, 'lib/ipc/register-handlers.js'), register);
console.log('handlers', handles.length);
