const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { mergeDeep, readJson, writeJson } = require('../lib/json-store');

test('mergeDeep preserves defaults and replaces supplied leaves', () => {
  const defaults = {
    capture: { skill: true, normal: true, pet: true, taken: true },
    overlay: { visible: true, opacity: 0.95 }
  };

  const result = mergeDeep(defaults, {
    capture: { skill: false, pet: false },
    overlay: { opacity: 0.7 }
  });

  assert.deepEqual(result, {
    capture: { skill: false, normal: true, pet: false, taken: true },
    overlay: { visible: true, opacity: 0.7 }
  });
  assert.equal(defaults.capture.skill, true);
});

test('mergeDeep replaces arrays instead of merging numeric keys', () => {
  assert.deepEqual(
    mergeDeep({ names: ['Alice'], nested: { enabled: true } }, { names: ['Bob'] }),
    { names: ['Bob'], nested: { enabled: true } }
  );
});

test('readJson returns fallback for missing or malformed files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-json-store-'));
  assert.deepEqual(readJson(path.join(root, 'missing.json'), { ok: false }), { ok: false });

  const malformed = path.join(root, 'malformed.json');
  fs.writeFileSync(malformed, '{bad json', 'utf8');
  assert.deepEqual(readJson(malformed, { ok: false }), { ok: false });
});

test('writeJson creates parent directories and round-trips UTF-8', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-json-store-'));
  const file = path.join(root, 'nested', 'settings.json');
  const value = { title: '伤害统计', capture: { taken: false } };

  writeJson(file, value);

  assert.deepEqual(readJson(file), value);
});
