const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConnectionHealth, summarizeAttachHints } = require('../lib/system-health');

test('buildConnectionHealth reports process-gone', () => {
  const health = buildConnectionHealth({
    elevated: true,
    selectedGamePid: 123,
    selectedXiaoyaPid: null,
    gameProcesses: [],
    processAlive: false,
    services: { damage: { state: 'error', message: '连接失败' } },
    damageWanted: true,
    monitoringWanted: false
  });
  assert.equal(health.status, 'process-gone');
  assert.ok(health.hints.length > 0);
});

test('summarizeAttachHints mentions admin when not elevated', () => {
  const hints = summarizeAttachHints({
    elevated: false,
    selectedGamePid: 1,
    processAlive: true,
    processInList: true,
    serviceMessage: 'access denied',
    gameProcessCount: 1
  });
  assert.ok(hints.some((h) => /管理员/.test(h)));
});
