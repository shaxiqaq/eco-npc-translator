const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendCrashLog } = require('../lib/crash-log');

test('appendCrashLog writes json and index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eco-crash-'));
  const file = appendCrashLog(dir, 'unit', new Error('boom'));
  assert.ok(file && fs.existsSync(file));
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(body.kind, 'unit');
  assert.equal(body.message, 'boom');
  assert.ok(fs.existsSync(path.join(dir, 'logs', 'crash', 'crash-index.log')));
});
