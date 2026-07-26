const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBackendEnv } = require('../lib/backend-env');

test('buildBackendEnv sets snapshot history and python defaults', () => {
  const prev = process.env.ECO_SNAPSHOT_HISTORY;
  delete process.env.ECO_SNAPSHOT_HISTORY;
  try {
    const env = buildBackendEnv({
      srcDir: 'C:\\src',
      backendDir: 'C:\\backend',
      dataDir: 'C:\\data'
    });
    assert.equal(env.ECO_SNAPSHOT_HISTORY, '80');
    assert.equal(env.PYTHONUTF8, '1');
    assert.equal(env.ECO_DATA_DIR, 'C:\\data');
    assert.ok(String(env.PYTHONPATH).includes('C:\\src'));
  } finally {
    if (prev === undefined) delete process.env.ECO_SNAPSHOT_HISTORY;
    else process.env.ECO_SNAPSHOT_HISTORY = prev;
  }
});

test('buildBackendEnv honors ECO_SNAPSHOT_HISTORY override', () => {
  const prev = process.env.ECO_SNAPSHOT_HISTORY;
  process.env.ECO_SNAPSHOT_HISTORY = '40';
  try {
    const env = buildBackendEnv({ dataDir: 'D:\\x' });
    assert.equal(env.ECO_SNAPSHOT_HISTORY, '40');
  } finally {
    if (prev === undefined) delete process.env.ECO_SNAPSHOT_HISTORY;
    else process.env.ECO_SNAPSHOT_HISTORY = prev;
  }
});
