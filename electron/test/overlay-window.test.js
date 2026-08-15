const test = require('node:test');
const assert = require('node:assert/strict');
const { applyOverlayVisibility } = require('../lib/overlay-window');

test('applyOverlayVisibility shows and hides a live window', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    showInactive: () => calls.push('showInactive'),
    hide: () => calls.push('hide')
  };
  assert.equal(applyOverlayVisibility(win, true), true);
  assert.equal(applyOverlayVisibility(win, false), true);
  assert.deepEqual(calls, ['showInactive', 'hide']);
});

test('applyOverlayVisibility no-ops on missing or destroyed windows', () => {
  assert.equal(applyOverlayVisibility(null, true), false);
  assert.equal(applyOverlayVisibility({ isDestroyed: () => true, hide() {} }, false), false);
});
