const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAgentHost } = require('../lib/agent-host');

function fakeChild() {
  const child = new EventEmitter();
  child.writes = [];
  child.stdin = {
    writable: true,
    write(s) {
      child.writes.push(String(s));
      return true;
    }
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function makeHost(overrides = {}) {
  let damageChild = null;
  let translatorChild = null;
  let captureOn = true;
  let translateOn = false;
  const spawned = [];
  const host = createAgentHost({
    spawnImpl: (command, args) => {
      const child = fakeChild();
      spawned.push({ command, args, child });
      return child;
    },
    createInterface: () => new EventEmitter(),
    fs: { existsSync: () => true },
    getSelectedPid: () => 1001,
    getGameProcesses: () => [{ pid: 1001 }],
    resolveRuntime: (_name, extraArgs = []) => ({
      command: 'python',
      args: ['-u', 'eco_capture_agent.py', '--pid', '1001', ...extraArgs],
      cwd: '.'
    }),
    buildEnv: () => ({}),
    getSrcDir: () => '.',
    getDataDir: () => '.',
    getCaptureSettings: () => ({ categories: {}, skillNameMode: 'client' }),
    captureNeeded: () => captureOn,
    translateWanted: () => translateOn,
    captureRoleMessage: () => '采集中',
    setDamageState() {},
    setTranslatorState() {},
    reportDamageError: (msg) => ({ ok: false, error: msg }),
    reportTranslatorError: (msg) => ({ ok: false, error: msg }),
    onDamageMessage() {},
    onTranslatorMessage() {},
    log() {},
    stopChildGracefully: async (_name, child) => {
      child.exitCode = 0;
      child.emit('exit', 0);
    },
    setDamageChild: (c) => { damageChild = c; },
    setTranslatorChild: (c) => { translatorChild = c; },
    getAttachedPid: () => 1001,
    broadcastIdle() {},
    ...overrides
  });
  return {
    host,
    spawned,
    setCapture: (v) => { captureOn = v; },
    setTranslate: (v) => { translateOn = v; },
    get damageChild() { return damageChild; },
    get translatorChild() { return translatorChild; }
  };
}

test('agent host starts once with --damage', async () => {
  const ctx = makeHost();
  assert.equal((await ctx.host.reconcile()).ok, true);
  assert.equal(ctx.spawned.length, 1);
  assert.ok(ctx.spawned[0].args.includes('--damage'));
  assert.ok(!ctx.spawned[0].args.includes('--translate'));
  assert.ok(ctx.damageChild);
  assert.equal(ctx.translatorChild, null);
});

test('enabling translation keeps the same child and sends set-translate', async () => {
  const ctx = makeHost();
  await ctx.host.reconcile();
  ctx.setTranslate(true);
  await ctx.host.reconcile();
  assert.equal(ctx.spawned.length, 1);
  const writes = ctx.spawned[0].child.writes.join('');
  assert.match(writes, /set-translate/);
  assert.match(writes, /"enabled":true/);
  assert.ok(ctx.damageChild);
  assert.ok(ctx.translatorChild);
  assert.equal(ctx.damageChild, ctx.translatorChild);
});

test('disabling translation does not respawn the agent', async () => {
  const ctx = makeHost();
  await ctx.host.reconcile();
  ctx.setTranslate(true);
  await ctx.host.reconcile();
  ctx.setTranslate(false);
  await ctx.host.reconcile();
  assert.equal(ctx.spawned.length, 1);
  const writes = ctx.spawned[0].child.writes.join('');
  assert.match(writes, /"enabled":false/);
  assert.ok(ctx.damageChild);
  assert.equal(ctx.translatorChild, null);
});

test('changing capture still restarts the child', async () => {
  const ctx = makeHost();
  await ctx.host.reconcile();
  ctx.setCapture(false);
  ctx.setTranslate(true);
  await ctx.host.reconcile();
  assert.equal(ctx.spawned.length, 2);
  assert.ok(ctx.spawned[1].args.includes('--translate'));
  assert.ok(!ctx.spawned[1].args.includes('--damage'));
});

test('start is a no-op when the agent is already running', async () => {
  const ctx = makeHost();
  await ctx.host.reconcile();
  const again = ctx.host.start(ctx.host.liveFeatures());
  assert.equal(again.ok, true);
  assert.equal(ctx.spawned.length, 1);
});
