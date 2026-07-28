const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureSyncConfig, DEFAULT_SYNC_CONFIG } = require('../lib/sync-defaults');
const { readJson, writeJson } = require('../lib/json-store');

test('ensureSyncConfig writes defaults when missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-sync-'));
  const file = path.join(dir, 'sync_config.json');
  const cfg = ensureSyncConfig(file, { readJson, writeJson });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.url, DEFAULT_SYNC_CONFIG.url);
  assert.ok(cfg.token);
  assert.ok(fs.existsSync(file));
});

test('ensureSyncConfig upgrades empty-url disabled install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-sync-'));
  const file = path.join(dir, 'sync_config.json');
  writeJson(file, { enabled: false, url: '', token: '', pull_interval: 300 });
  const cfg = ensureSyncConfig(file, { readJson, writeJson });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.url, DEFAULT_SYNC_CONFIG.url);
  assert.equal(cfg.token, DEFAULT_SYNC_CONFIG.token);
});

test('ensureSyncConfig keeps explicit offline with custom url', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-sync-'));
  const file = path.join(dir, 'sync_config.json');
  writeJson(file, {
    enabled: false,
    url: 'https://private.example/dict',
    token: 'secret',
    pull_interval: 120
  });
  const cfg = ensureSyncConfig(file, { readJson, writeJson });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.url, 'https://private.example/dict');
  assert.equal(cfg.token, 'secret');
});
