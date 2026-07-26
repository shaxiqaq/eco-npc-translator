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
