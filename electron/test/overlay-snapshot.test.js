const test = require('node:test');
const assert = require('node:assert/strict');
const { overlaySnapshot } = require('../lib/overlay-snapshot');

test('overlay snapshot keeps timer fields and drops combat history', () => {
  const slim = overlaySnapshot({
    self_id: 7,
    buffs: [{ key: 'poison' }],
    skill_cooldowns: [{ skill_id: 9 }],
    skill_effect_timers: [{ skill_id: 8 }],
    damage_history: [{ damage: 12 }],
    grind: { ready: true },
    events: ['x']
  });
  assert.deepEqual(slim, {
    self_id: 7,
    buffs: [{ key: 'poison' }],
    skill_cooldowns: [{ skill_id: 9 }],
    skill_effect_timers: [{ skill_id: 8 }]
  });
});

test('overlay snapshot passes through empty or non-objects', () => {
  assert.equal(overlaySnapshot(null), null);
  assert.equal(overlaySnapshot(undefined), undefined);
  assert.equal(overlaySnapshot('x'), 'x');
});
