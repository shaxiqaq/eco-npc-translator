const test = require('node:test');
const assert = require('node:assert/strict');
const { pickPidFromList, pickPidByTitle, resolveSelectedPids } = require('../lib/process-selection');

test('pickPidFromList prefers first live preferred pid', () => {
  const processes = [{ pid: 10 }, { pid: 20 }, { pid: 30 }];
  assert.equal(pickPidFromList([99, 20, 10], processes), 20);
  assert.equal(pickPidFromList([1], processes), null);
});

test('pickPidByTitle matches exact then partial', () => {
  const processes = [
    { pid: 1, title: 'ECO - 法师' },
    { pid: 2, title: 'ECO - 战士' }
  ];
  assert.equal(pickPidByTitle(['ECO - 战士'], processes), 2);
  assert.equal(pickPidByTitle(['战士'], processes), 2);
  assert.equal(pickPidByTitle(['不存在'], processes), null);
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

test('resolveSelectedPids uses remembered title when pid gone', () => {
  const processes = [
    { pid: 9001, title: 'ECO - 法师' },
    { pid: 9002, title: 'ECO - 战士' }
  ];
  const { selectedGamePid, selectedXiaoyaPid } = resolveSelectedPids({
    processes,
    previousMainPid: 111, // dead
    previousXiaoyaPid: 222,
    configuredMainPid: 111,
    configuredXiaoyaPid: 222,
    rememberedMainTitle: 'ECO - 法师',
    rememberedXiaoyaTitle: 'ECO - 战士'
  });
  assert.equal(selectedGamePid, 9001);
  assert.equal(selectedXiaoyaPid, 9002);
});
