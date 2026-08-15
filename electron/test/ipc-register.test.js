const test = require('node:test');
const assert = require('node:assert/strict');
const { registerIpcHandlers } = require('../lib/ipc/register-handlers');

test('registers domain handlers without with(ctx)', () => {
  const names = [];
  const ipcMain = {
    handle(name, fn) {
      names.push(name);
      assert.equal(typeof fn, 'function');
    }
  };
  registerIpcHandlers(ipcMain, {});
  assert.ok(names.length >= 51);
  assert.ok(names.includes('app:get-state'));
  assert.ok(names.includes('service:start'));
  assert.ok(names.includes('service:prestart'));
  assert.ok(names.includes('settings:save-translation'));
  assert.ok(names.includes('xiaoya:start'));
});
