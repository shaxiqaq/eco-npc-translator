const test = require('node:test');
const assert = require('node:assert/strict');
const { pickPidFromList, resolveSelectedPids } = require('../lib/process-selection');

test('pickPidFromList prefers first live preferred pid', () => {
  const processes = [{ pid: 10 }, { pid: 20 }, { pid: 30 }];
  assert.equal(pickPidFromList([99, 20, 10], processes), 20);
  assert.equal(pickPidFromList([1], processes), null);
});

test('resolveSelectedPids picks distinct xiaoya when possible', () => {
  const processes = [{ pid: 1 }, { pid: 2 }];
  const { selectedGamePid, selectedXiaoyaPid } = resolveSelectedPids({
    processes,
    previousMainPid: 1,
    previousXiaoyaPid: null,
    configuredMainPid: null,
    configuredXiaoyaPid: null
  });
  assert.equal(selectedGamePid, 1);
  assert.equal(selectedXiaoyaPid, 2);
});
