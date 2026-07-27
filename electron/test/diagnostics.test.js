const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectDiagnostics,
  formatDiagnosticsText,
  writeDiagnosticBundle
} = require('../lib/diagnostics');

test('collectDiagnostics includes selection, services and recent logs', () => {
  const diag = collectDiagnostics({
    appVersion: '0.2.7',
    isPackaged: false,
    selectedGamePid: 1234,
    selectedXiaoyaPid: 5678,
    gameProcesses: [{ pid: 1234, title: 'ECO', started: '10:00:00', path: 'C:\\eco.exe' }],
    captureIntents: { damage: true, monitoring: false },
    services: { damage: { state: 'running', message: 'ok' } },
    logs: [
      { time: '10:00:01', service: 'damage', level: 'info', message: 'hello' },
      { time: '10:00:02', service: 'app', level: 'warn', message: 'world' }
    ]
  });

  assert.equal(diag.app.version, '0.2.7');
  assert.equal(diag.selection.selectedGamePid, 1234);
  assert.equal(diag.selection.selectedXiaoyaPid, 5678);
  assert.equal(diag.captureIntents.damage, true);
  assert.equal(diag.services.damage.state, 'running');
  assert.equal(diag.recentLogs.length, 2);

  const text = formatDiagnosticsText(diag);
  assert.match(text, /ECO Toolbox diagnostic bundle/);
  assert.match(text, /selectedGamePid: 1234/);
  assert.match(text, /hello/);
});

test('writeDiagnosticBundle writes json + txt sidecar files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-diag-'));
  const diag = collectDiagnostics({
    appVersion: '0.2.7',
    isPackaged: true,
    selectedGamePid: 1,
    selectedXiaoyaPid: null,
    gameProcesses: [],
    captureIntents: {},
    services: {},
    logs: []
  });
  const { jsonPath, textPath } = writeDiagnosticBundle(dir, diag);
  assert.ok(fs.existsSync(jsonPath));
  assert.ok(fs.existsSync(textPath));
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(parsed.app.version, '0.2.7');
});

test('writeDiagnosticPack includes snapshot and capture tails', () => {
  const {
    writeDiagnosticPack,
    collectCaptureLogTails,
    buildSnapshotSummary
  } = require('../lib/diagnostics');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-pack-'));
  const logDir = path.join(dir, 'logs');
  fs.mkdirSync(logDir);
  const logPath = path.join(logDir, 'damage_electron_test.jsonl');
  fs.writeFileSync(logPath, `${JSON.stringify({ kind: 'damage', damage: 1 })}\n`, 'utf8');

  const diag = collectDiagnostics({
    appVersion: '0.2.12',
    isPackaged: false,
    selectedGamePid: 9,
    selectedXiaoyaPid: null,
    gameProcesses: [],
    captureIntents: { damage: true },
    services: {},
    logs: [{ time: '12:00:00', service: 'app', level: 'info', message: 'hi' }],
    snapshotSummary: buildSnapshotSummary({
      self_id: 84,
      ride_mode: true,
      ride_mount_id: 20257,
      dealt: 100,
      grind: { ready: true, status: 'tracking', exp_packets: 3 }
    })
  });
  const tails = collectCaptureLogTails([logDir], { prefix: 'damage_electron_', maxFiles: 1 });
  assert.equal(tails.tails.length, 1);
  assert.match(tails.tails[0].text, /"damage":\s*1/);

  const outDir = path.join(dir, 'pack-out');
  const pack = writeDiagnosticPack(outDir, {
    diag,
    text: formatDiagnosticsText(diag),
    snapshot: { self_id: 84, dealt: 100 },
    captureTails: tails
  });
  assert.ok(fs.existsSync(path.join(outDir, 'README.txt')));
  assert.ok(fs.existsSync(path.join(outDir, 'diagnostic.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'snapshot.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'ui-logs.txt')));
  assert.ok(pack.files.length >= 4);
});
