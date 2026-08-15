const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveBackendRuntime, agentAvailable } = require('../lib/backend-runtime');

test('agentAvailable is true for unpackaged when script exists', () => {
  const srcDir = 'C:\\src';
  const ok = agentAvailable({
    isPackaged: false,
    srcDir,
    fsImpl: { existsSync: (p) => p === path.join(srcDir, 'eco_capture_agent.py') },
    env: {}
  });
  assert.equal(ok, true);
});

test('ECO_SPLIT_BACKENDS disables the unified agent', () => {
  const ok = agentAvailable({
    isPackaged: false,
    srcDir: 'C:\\src',
    fsImpl: { existsSync: () => true },
    env: { ECO_SPLIT_BACKENDS: '1' }
  });
  assert.equal(ok, false);
});

test('resolveBackendRuntime agent includes feature flags', () => {
  const runtime = resolveBackendRuntime({
    name: 'agent',
    selectedGamePid: 4242,
    isPackaged: false,
    srcDir: 'C:\\src',
    extraArgs: ['--damage', '--translate']
  });
  assert.equal(runtime.args[1], path.join('C:\\src', 'eco_capture_agent.py'));
  assert.ok(runtime.args.includes('--pid'));
  assert.ok(runtime.args.includes('4242'));
  assert.ok(runtime.args.includes('--damage'));
  assert.ok(runtime.args.includes('--translate'));
});
