const test = require('node:test');
const assert = require('node:assert/strict');
const { planPrestartOnGame } = require('../lib/prestart');

test('prestart stays idle until a live game pid appears', () => {
  assert.deepEqual(planPrestartOnGame({
    enabled: true,
    processBecameAlive: false,
    selectedPid: 12,
    startupTranslator: true,
    captureNeeded: true
  }), { capture: false, translator: false });
});

test('prestart starts opted-in services when the game comes online', () => {
  assert.deepEqual(planPrestartOnGame({
    enabled: true,
    processBecameAlive: true,
    selectedPid: 12,
    startupTranslator: true,
    translatorUp: false,
    captureNeeded: true,
    captureUp: false
  }), { capture: true, translator: true });
});

test('prestart skips services that are already running', () => {
  assert.deepEqual(planPrestartOnGame({
    enabled: true,
    processBecameAlive: true,
    selectedPid: 12,
    startupTranslator: true,
    translatorUp: true,
    captureNeeded: true,
    captureUp: true
  }), { capture: false, translator: false });
});
