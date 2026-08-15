const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createAppShutdown } = require('../lib/app-shutdown');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('createAppShutdown', () => {
  it('stopAllBackendsForQuit stops translator before damage', async () => {
    const order = [];
    const services = {
      translator: { pid: 1, killed: false, exitCode: null },
      damage: { pid: 2, killed: false, exitCode: null }
    };
    const shutdown = createAppShutdown({
      getMainWindow: () => null,
      getOverlayWindow: () => null,
      services,
      stopChildGracefully: async (name, child) => {
        order.push(name);
        child.exitCode = 0;
      },
      setServiceState: () => {},
      addLog: () => {},
      stopDemo: () => {},
      sleep: async () => {},
      quitApp: () => {},
      isDemo: false
    });
    await shutdown.stopAllBackendsForQuit();
    assert.deepEqual(order.slice(0, 2), ['translator', 'damage']);
    assert.equal(services.translator, null);
    assert.equal(services.damage, null);
  });

  it('shared unified-agent child is stopped only once', async () => {
    const order = [];
    const child = { pid: 9, killed: false, exitCode: null };
    const services = { translator: child, damage: child };
    const shutdown = createAppShutdown({
      getMainWindow: () => null,
      getOverlayWindow: () => null,
      services,
      stopChildGracefully: async (name, proc) => {
        order.push(name);
        proc.exitCode = 0;
      },
      setServiceState: () => {},
      addLog: () => {},
      stopDemo: () => {},
      sleep: async () => {},
      quitApp: () => {},
      isDemo: false
    });
    await shutdown.stopAllBackendsForQuit();
    assert.deepEqual(order, ['agent']);
    assert.equal(services.translator, null);
    assert.equal(services.damage, null);
  });

  it('beginGracefulShutdown is idempotent while running', async () => {
    let quitCount = 0;
    const services = { translator: null, damage: null };
    const shutdown = createAppShutdown({
      getMainWindow: () => null,
      getOverlayWindow: () => null,
      services,
      stopChildGracefully: async () => {},
      setServiceState: () => {},
      addLog: () => {},
      stopDemo: () => {},
      sleep: (ms) => sleep(Math.min(ms, 20)),
      quitApp: () => {
        quitCount += 1;
      },
      isDemo: false
    });
    shutdown.beginGracefulShutdown('test');
    shutdown.beginGracefulShutdown('test-2');
    assert.equal(shutdown.isQuitStarted(), true);
    await sleep(80);
    assert.ok(quitCount >= 1);
  });
});
