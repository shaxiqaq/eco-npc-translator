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

test('writeDiagnosticPack includes snapshot, capture tails, meter log and SUMMARY', () => {
  const {
    writeDiagnosticPack,
    collectCaptureLogTails,
    collectNamedLogTails,
    buildSnapshotSummary,
    buildRemoteSupportSummary
  } = require('../lib/diagnostics');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-pack-'));
  const logDir = path.join(dir, 'logs');
  fs.mkdirSync(logDir);
  const logPath = path.join(logDir, 'damage_electron_test.jsonl');
  fs.writeFileSync(logPath, `${JSON.stringify({ kind: 'damage', damage: 1 })}\n`, 'utf8');
  fs.writeFileSync(path.join(logDir, 'eco_damage_meter.log'), '[info] meter ready\nbind self=84\n', 'utf8');

  const snap = {
    self_id: 84,
    ride_mode: true,
    ride_mount_id: 20257,
    dealt: 100,
    grind: { ready: true, status: 'tracking', exp_packets: 3 }
  };
  const diag = collectDiagnostics({
    appVersion: '0.2.13',
    isPackaged: false,
    selectedGamePid: 9,
    selectedXiaoyaPid: null,
    gameProcesses: [{ pid: 9, title: 'ECO-Test', started: '12:00:00', path: 'C:\\eco.exe' }],
    captureIntents: { damage: true },
    services: { damage: { state: 'running', message: 'ok' } },
    logs: [{ time: '12:00:00', service: 'app', level: 'info', message: 'hi' }],
    identity: { self_id: 84, captureRunning: true, packet_count: 12, total_dealt: 100 },
    snapshotSummary: buildSnapshotSummary(snap)
  });
  const tails = collectCaptureLogTails([logDir], { prefix: 'damage_electron_', maxFiles: 1 });
  assert.equal(tails.tails.length, 1);
  assert.match(tails.tails[0].text, /"damage":\s*1/);

  const meterLogs = collectNamedLogTails([logDir], ['eco_damage_meter.log', 'eco_damage_capture.log'], {
    maxBytes: 10_000
  });
  assert.equal(meterLogs.tails.length, 2);
  assert.match(meterLogs.tails[0].text, /bind self=84/);
  assert.equal(meterLogs.tails[1].missing, true);

  const summary = buildRemoteSupportSummary({
    diag,
    snapshot: snap,
    captureTails: tails,
    meterLogs,
    hints: ['test hint']
  });
  assert.match(summary, /远程排障一键摘要/);
  assert.match(summary, /self_id: 84/);
  assert.match(summary, /eco_damage_meter\.log/);

  const outDir = path.join(dir, 'pack-out');
  const pack = writeDiagnosticPack(outDir, {
    diag,
    text: formatDiagnosticsText(diag),
    snapshot: snap,
    captureTails: tails,
    meterLogs,
    hints: ['test hint']
  });
  assert.ok(fs.existsSync(path.join(outDir, 'SUMMARY.txt')));
  assert.ok(fs.existsSync(path.join(outDir, 'README.txt')));
  assert.ok(fs.existsSync(path.join(outDir, 'diagnostic.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'snapshot.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'ui-logs.txt')));
  assert.ok(fs.existsSync(path.join(outDir, 'eco_damage_meter.log')));
  assert.ok(fs.existsSync(path.join(outDir, 'eco_damage_capture.log.MISSING.txt')));
  assert.ok(pack.files.length >= 6);
  const summaryBody = fs.readFileSync(path.join(outDir, 'SUMMARY.txt'), 'utf8');
  assert.match(summaryBody, /结论速览/);
});
