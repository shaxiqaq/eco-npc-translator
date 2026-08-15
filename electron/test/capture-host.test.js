const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createCaptureHost } = require('../lib/capture-host');

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = { writable: true, write() { return true; } };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('capture host reports no-process before spawn', () => {
  let child = null;
  const host = createCaptureHost({
    spawnImpl: () => fakeChild(),
    createInterface: () => new EventEmitter(),
    fs: { existsSync: () => true },
    getSelectedPid: () => null,
    getGameProcesses: () => [],
    isDemo: () => false,
    startDemo() {},
    stopDemo() {},
    hasDemoTimer: () => false,
    resolveRuntime: () => ({ command: 'python', args: ['-u', 'x.py'] }),
    buildEnv: () => ({}),
    getSrcDir: () => '.',
    getDataDir: () => '.',
    getCaptureSettings: () => ({}),
    setDamageState() {},
    reportDamageError: (msg) => ({ ok: false, error: msg }),
    log() {},
    onMessage() {},
    stopChildGracefully: async () => {},
    getChild: () => child,
    setChild: (next) => { child = next; },
    captureNeeded: () => true,
    captureRoleMessage: () => 'ok'
  });
  const result = host.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /游戏进程/);
});
