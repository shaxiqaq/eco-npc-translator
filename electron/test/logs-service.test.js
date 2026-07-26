const test = require('node:test');
const assert = require('node:assert/strict');
const { filterLogs, formatLogsExportBody } = require('../lib/logs-service');

test('filterLogs matches service and channels', () => {
  const logs = [
    { service: 'damage', channels: ['damage', 'monitoring'], message: 'a' },
    { service: 'xiaoya', message: 'b' },
    { service: 'buffs', message: 'c' }
  ];
  assert.equal(filterLogs(logs, 'all').length, 3);
  assert.equal(filterLogs(logs, 'damage').length, 1);
  assert.equal(filterLogs(logs, 'monitoring').length, 2);
  assert.equal(filterLogs(logs, 'xiaoya').length, 1);
});

test('formatLogsExportBody writes txt header', () => {
  const body = formatLogsExportBody(
    [{ time: '12:00:00', service: 'app', level: 'info', message: 'hi' }],
    { filter: 'all', format: 'txt' }
  );
  assert.match(body, /ECO 工具箱运行日志导出/);
  assert.match(body, /hi/);
});
