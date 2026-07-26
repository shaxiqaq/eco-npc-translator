const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettingsCache } = require('../lib/settings-cache');

test('settings cache avoids re-read until invalidated and patches merge', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-settings-'));
  const defaults = { a: 1, nested: { x: 1, y: 2 } };
  const store = createSettingsCache({
    dataDir: () => dir,
    defaults
  });

  const first = store.get();
  assert.equal(first.a, 1);
  assert.equal(first.nested.x, 1);

  store.patch({ nested: { x: 9 } });
  store.persistSync();
  assert.equal(store.get().nested.x, 9);
  assert.equal(store.get().nested.y, 2);

  // Disk contains patched value
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'app_settings.json'), 'utf8'));
  assert.equal(disk.nested.x, 9);

  store.invalidate();
  assert.equal(store.get().nested.x, 9);
});
