const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyError,
  withErrorCode,
  parseErrorCode
} = require('../lib/error-codes');

test('classifies access denied as ECO_E03', () => {
  const result = classifyError('Access is denied when attaching', { kind: 'access' });
  assert.equal(result.code, 'ECO_E03');
  assert.match(result.message, /\[ECO_E03\]/);
});

test('classifies missing process as ECO_E01', () => {
  const result = classifyError('没有可用的游戏进程，请启动游戏');
  assert.equal(result.code, 'ECO_E01');
});

test('withErrorCode is idempotent', () => {
  const once = withErrorCode('hello', 'ECO_E04');
  const twice = withErrorCode(once, 'ECO_E04');
  assert.equal(once, twice);
  assert.equal(parseErrorCode(twice), 'ECO_E04');
});
