/**
 * Lightweight smoke checks without launching a full Electron window.
 * Run: node scripts/smoke.mjs
 */
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(electronRoot, '..');

const failures = [];

function ok(name) {
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failures.push(`${name}: ${err?.message || err}`);
  console.error(`  ✗ ${name}: ${err?.message || err}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

section('lib modules load');
try {
  const mods = [
    'settings-cache',
    'state-bus',
    'diagnostics',
    'error-codes',
    'crash-log',
    'config-bundle',
    'system-health',
    'character-presets',
    'custom-buffs-store',
    'process-selection',
    'logs-service',
    'backend-env',
    'wallpaper'
  ];
  for (const name of mods) {
    require(path.join(electronRoot, 'lib', `${name}.js`));
    ok(name);
  }
} catch (error) {
  fail('module load', error);
}

section('error-codes');
try {
  const { classifyError, parseErrorCode } = require(path.join(electronRoot, 'lib', 'error-codes.js'));
  const access = classifyError('Access is denied', { kind: 'access' });
  if (access.code !== 'ECO_E03') throw new Error(`expected ECO_E03 got ${access.code}`);
  if (!parseErrorCode(access.message)) throw new Error('parseErrorCode failed');
  ok('classify access → ECO_E03');
} catch (error) {
  fail('error-codes', error);
}

section('settings + crash log');
try {
  const { createSettingsCache } = require(path.join(electronRoot, 'lib', 'settings-cache.js'));
  const { appendCrashLog } = require(path.join(electronRoot, 'lib', 'crash-log.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-smoke-'));
  const store = createSettingsCache({
    dataDir: () => dir,
    defaults: { a: 1 }
  });
  store.patch({ a: 2 });
  store.persistSync();
  if (store.get().a !== 2) throw new Error('settings not persisted');
  const crashFile = appendCrashLog(dir, 'smoke', new Error('smoke-test'));
  if (!crashFile || !fs.existsSync(crashFile)) throw new Error('crash log missing');
  ok('settings persist + crash log write');
} catch (error) {
  fail('settings/crash', error);
}

section('unit tests');
{
  const testDir = path.join(electronRoot, 'test');
  const testFiles = fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => path.join(testDir, name));
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: electronRoot,
    encoding: 'utf8',
    shell: false
  });
  if (result.status === 0) ok('node --test');
  else fail('node --test', result.stderr || result.stdout || `exit ${result.status}`);
}

section('python eco_process (optional)');
{
  const env = { ...process.env, PYTHONPATH: path.join(repoRoot, 'src') };
  const result = spawnSync('python', ['-m', 'unittest', 'tests.test_eco_process', '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env
  });
  if (result.status === 0) ok('python eco_process');
  else if (result.error?.code === 'ENOENT') {
    console.log('  · python not found, skipped');
  } else {
    // Non-fatal for smoke when Python env missing modules
    console.log('  · python tests skipped or failed (non-fatal for JS smoke)');
    if (process.env.ECO_SMOKE_STRICT === '1') {
      fail('python eco_process', result.stderr || result.stdout);
    }
  }
}

console.log('');
if (failures.length) {
  console.error(`Smoke failed (${failures.length}):`);
  for (const line of failures) console.error(` - ${line}`);
  process.exit(1);
}
console.log('Smoke OK');
process.exit(0);
