const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeBackgroundRel,
  backgroundProtocolUrl,
  clampDim,
  clampBlur,
  clampFit,
  normalizeOverlayBgMode,
  stripAppearanceRuntimeFields
} = require('../lib/wallpaper');

test('safeBackgroundRel blocks path traversal', () => {
  assert.equal(safeBackgroundRel('backgrounds/a.jpg'), 'backgrounds/a.jpg');
  assert.equal(safeBackgroundRel('../secret'), '');
  assert.equal(safeBackgroundRel(''), '');
});

test('backgroundProtocolUrl encodes segments', () => {
  const url = backgroundProtocolUrl('backgrounds/my file.jpg');
  assert.ok(url.startsWith('eco-bg://local/'));
  assert.ok(url.includes('my%20file.jpg'));
});

test('clamp helpers bound values', () => {
  assert.equal(clampDim(2), 0.9);
  assert.equal(clampDim(-1), 0.1);
  assert.equal(clampBlur(100), 24);
  assert.equal(clampFit('fill'), 'fill');
  assert.equal(clampFit('nope'), 'cover');
});

test('normalizeOverlayBgMode migrates legacy applyToOverlay', () => {
  assert.equal(normalizeOverlayBgMode({ overlayBgMode: 'custom' }), 'custom');
  assert.equal(normalizeOverlayBgMode({ applyToOverlay: false }), 'solid');
  assert.equal(normalizeOverlayBgMode({}), 'follow');
});

test('stripAppearanceRuntimeFields removes payload urls', () => {
  const appearance = {
    backgroundImage: 'backgrounds/a.jpg',
    backgroundDataUrl: 'data:image/jpeg;base64,xx',
    backgroundUrl: 'eco-bg://local/backgrounds/a.jpg',
    overlayBackgroundFileUrl: 'file:///x'
  };
  stripAppearanceRuntimeFields(appearance);
  assert.equal(appearance.backgroundImage, 'backgrounds/a.jpg');
  assert.equal(appearance.backgroundDataUrl, undefined);
  assert.equal(appearance.backgroundUrl, undefined);
  assert.equal(appearance.overlayBackgroundFileUrl, undefined);
});
