const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeGameProcesses, parseGameProcesses } = require('../lib/game-processes');

test('parseGameProcesses accepts a PowerShell JSON array', () => {
  const result = parseGameProcesses(
    '[{"pid":3200,"title":"ECO - 角色二","started":"10:02:03","path":"D:\\\\ECO\\\\eco.exe"},{"pid":1200,"title":"","started":"09:01:02"}]'
  );

  assert.deepEqual(result, [
    { pid: 1200, title: '', started: '09:01:02', path: '' },
    { pid: 3200, title: 'ECO - 角色二', started: '10:02:03', path: 'D:\\ECO\\eco.exe' }
  ]);
});

test('parseGameProcesses accepts one object and an empty response', () => {
  assert.deepEqual(parseGameProcesses('{"pid":42,"title":"ECO","started":null}'), [
    { pid: 42, title: 'ECO', started: '', path: '' }
  ]);
  assert.deepEqual(parseGameProcesses(''), []);
});

test('normalizeGameProcesses removes invalid process identifiers', () => {
  assert.deepEqual(
    normalizeGameProcesses([{ pid: 0 }, { pid: '55', title: null }, { pid: 'bad' }]),
    [{ pid: 55, title: '', started: '', path: '' }]
  );
});
