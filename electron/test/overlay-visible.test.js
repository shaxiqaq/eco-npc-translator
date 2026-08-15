const test = require('node:test');
const assert = require('node:assert/strict');
const { register } = require('../lib/ipc/overlay');
const { register: registerSettings } = require('../lib/ipc/settings');

function collectHandlers(registerFn, ctx) {
  const handlers = {};
  registerFn({ handle(name, fn) { handlers[name] = fn; } }, ctx);
  return handlers;
}

function baseSettings() {
  return {
    overlay: { visible: true, opacity: 1, scale: 1, x: 10, y: 20, width: 360, height: 240 },
    appearance: { accent: 'amber', skillNameMode: 'client' }
  };
}

test('overlay:set-visible persists, hides/shows, and broadcasts', () => {
  const settings = baseSettings();
  const calls = [];
  const overlayWindow = {
    isDestroyed: () => false,
    showInactive: () => calls.push('show'),
    hide: () => calls.push('hide')
  };
  const handlers = collectHandlers(register, {
    appSettings: () => settings,
    persistAppSettings: (next) => { Object.assign(settings, next); },
    overlayWindow,
    broadcastState: (opts) => calls.push(['broadcast', opts])
  });
  const hidden = handlers['overlay:set-visible'](null, false);
  assert.equal(hidden.ok, true);
  assert.equal(settings.overlay.visible, false);
  assert.ok(calls.includes('hide'));
  const shown = handlers['overlay:set-visible'](null, true);
  assert.equal(shown.visible, true);
  assert.ok(calls.includes('show'));
});

test('settings:save-app uses ctx.overlayWindow instead of a free identifier', () => {
  const settings = baseSettings();
  const calls = [];
  const overlayWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 10, y: 20, width: 360, height: 240 }),
    setBounds: (bounds) => calls.push(['setBounds', bounds]),
    setOpacity: (opacity) => calls.push(['setOpacity', opacity]),
    showInactive: () => calls.push('show'),
    hide: () => calls.push('hide'),
    webContents: { send() {} }
  };
  const handlers = collectHandlers(registerSettings, {
    mergeDeep: (current, incoming) => ({
      ...current,
      ...incoming,
      overlay: { ...current.overlay, ...(incoming.overlay || {}) },
      appearance: { ...current.appearance, ...(incoming.appearance || {}) }
    }),
    appSettings: () => settings,
    persistAppSettings() {},
    overlayWindow,
    overlayBounds: (overlay) => ({
      x: overlay.x, y: overlay.y, width: overlay.width, height: overlay.height
    }),
    clampOverlayOpacity: (value) => value,
    clampDim: (value, fallback) => value ?? fallback,
    clampBlur: (value, fallback) => value ?? fallback,
    clampFit: (value) => value,
    normalizeOverlayBgMode: () => 'follow',
    safeBackgroundRel: (value) => value || '',
    stripAppearanceRuntimeFields() {},
    broadcastState() {},
    reconcileCaptureBackend() {},
    registerAppHotkeys() {},
    createAppTray() {},
    resolveAppearanceBackground: (current) => current.appearance,
    buildLightState: () => ({ overlay: settings.overlay }),
    defaultAppSettings: { appearance: {} },
    OVERLAY_MIN_WIDTH: 200,
    OVERLAY_MIN_HEIGHT: 120
  });
  assert.doesNotThrow(() => {
    const result = handlers['settings:save-app'](null, { overlay: { visible: false } });
    assert.equal(result.ok, true);
  });
  assert.ok(calls.some((item) => item[0] === 'setBounds'));
  assert.ok(calls.includes('hide'));
});
