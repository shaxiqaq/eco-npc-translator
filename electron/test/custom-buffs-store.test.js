const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createCustomBuffStore,
  normalizeCustomBuffMap,
  skillIdFromKey
} = require('../lib/custom-buffs-store');

test('skillIdFromKey parses skill prefixes', () => {
  assert.equal(skillIdFromKey('skill:2100'), 2100);
  assert.equal(skillIdFromKey('cd:99'), 99);
  assert.equal(skillIdFromKey('not-a-skill'), null);
});

test('normalizeCustomBuffMap accepts duration and cooldown shapes', () => {
  const map = normalizeCustomBuffMap({
    '魔法护盾': 30,
    'skill:2100': 12,
    'buff:x': { duration: 15, cooldown: 5, label: 'X' }
  });
  assert.equal(map['魔法护盾'].duration, 30);
  assert.equal(map['skill:2100'].cooldown, 12);
  assert.equal(map['skill:2100'].skill_id, 2100);
  assert.equal(map['buff:x'].duration, 15);
  assert.equal(map['buff:x'].cooldown, 5);
});

test('custom buff store round-trips to disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-buffs-'));
  const store = createCustomBuffStore({ localDataDir: () => dir });
  store.save({ 'skill:1': { cooldown: 10, skill_id: 1, overlay: true } });
  store.invalidate();
  const loaded = store.load();
  assert.equal(loaded['skill:1'].cooldown, 10);
  assert.ok(fs.existsSync(path.join(dir, 'custom_buffs.json')));
});
