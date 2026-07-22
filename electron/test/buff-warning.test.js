const assert = require('node:assert/strict');
const test = require('node:test');

const { isBuffExpiring, normalizeWarningSeconds } = require('../lib/buff-warning');

test('normalizes configurable warning time', () => {
  assert.equal(normalizeWarningSeconds('15'), 15);
  assert.equal(normalizeWarningSeconds(0), 1);
  assert.equal(normalizeWarningSeconds(999), 300);
  assert.equal(normalizeWarningSeconds('bad'), 10);
});

test('warns only for active buffs inside the configured window', () => {
  assert.equal(isBuffExpiring({ expires_at: 109 }, 10, 100), true);
  assert.equal(isBuffExpiring({ expires_at: 111 }, 10, 100), false);
  assert.equal(isBuffExpiring({ expires_at: 100 }, 10, 100), false);
  assert.equal(isBuffExpiring({ expires_at: null }, 10, 100), false);
});
