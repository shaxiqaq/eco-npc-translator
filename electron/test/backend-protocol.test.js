const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBackendLine, classifyTranslatorText, writeCommand } = require('../lib/backend-protocol');

test('parseBackendLine distinguishes json and text', () => {
  assert.equal(parseBackendLine('').kind, 'empty');
  assert.equal(parseBackendLine('hello attach').kind, 'text');
  const json = parseBackendLine('{"type":"status","state":"running"}');
  assert.equal(json.kind, 'json');
  assert.equal(json.message.state, 'running');
});

test('classifyTranslatorText maps legacy log lines', () => {
  assert.equal(classifyTranslatorText('还没有配置翻译服务').kind, 'translator-config');
  assert.equal(classifyTranslatorText('[*] attach 1234').state, 'running');
  assert.equal(classifyTranslatorText('指定的 eco.exe 进程不存在').kind, 'process-gone');
  assert.equal(classifyTranslatorText('普通日志'), null);
});

test('writeCommand no-ops without a writable stdin', () => {
  assert.equal(writeCommand(null, { action: 'reset' }), false);
  assert.equal(writeCommand({ stdin: { writable: false } }, { action: 'reset' }), false);
  const chunks = [];
  assert.equal(writeCommand({ stdin: { writable: true, write: (s) => chunks.push(s) } }, { action: 'reset' }), true);
  assert.equal(chunks[0], '{"action":"reset"}\n');
});
