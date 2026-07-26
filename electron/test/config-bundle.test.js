const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConfigBundle, parseConfigBundle } = require('../lib/config-bundle');

test('buildConfigBundle redacts secrets by default', () => {
  const bundle = buildConfigBundle({
    settings: { appearance: { backgroundUrl: 'eco-bg://x', accent: 'teal' } },
    custom_durations: { a: 1 },
    translation: { api_key: 'secret', sync_token: 'tok', provider: 'deepseek' },
    appVersion: '0.2.8'
  });
  assert.equal(bundle.format, 'eco-toolbox-config');
  assert.equal(bundle.translation.api_key, '');
  assert.equal(bundle.translation.sync_token, '');
  assert.equal(bundle.settings.appearance.backgroundUrl, undefined);
  assert.equal(bundle.settings.appearance.accent, 'teal');
});

test('parseConfigBundle accepts exported JSON', () => {
  const raw = JSON.stringify(buildConfigBundle({
    settings: { capture: { skill: true } },
    custom_durations: {},
    translation: null
  }));
  const parsed = parseConfigBundle(raw);
  assert.equal(parsed.settings.capture.skill, true);
});
