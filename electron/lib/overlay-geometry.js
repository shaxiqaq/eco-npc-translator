'use strict';

const OVERLAY_MIN_WIDTH = 240;
const OVERLAY_MIN_HEIGHT = 90;
const OVERLAY_DEFAULT_WIDTH = 430;
const OVERLAY_DEFAULT_HEIGHT = 115;

function clampOverlayOpacity(value) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return 1;
  return Math.min(1, Math.max(0.2, opacity));
}

function overlayBounds(settings = {}, workArea) {
  const display = workArea || { x: 0, y: 0, width: 1920, height: 1080 };
  const scale = Math.min(1.4, Math.max(0.8, Number(settings.scale) || 1));
  let width = Number(settings.width);
  let height = Number(settings.height);
  if (!Number.isFinite(width) || width < OVERLAY_MIN_WIDTH) {
    width = Math.round(OVERLAY_DEFAULT_WIDTH * scale);
  }
  if (!Number.isFinite(height) || height < OVERLAY_MIN_HEIGHT) {
    height = Math.round(OVERLAY_DEFAULT_HEIGHT * scale);
  }
  width = Math.min(display.width, Math.max(OVERLAY_MIN_WIDTH, Math.round(width)));
  height = Math.min(display.height, Math.max(OVERLAY_MIN_HEIGHT, Math.round(height)));
  const x = Number.isFinite(settings.x) ? settings.x : display.x + display.width - width - 28;
  const y = Number.isFinite(settings.y) ? settings.y : display.y + 56;
  return { x, y, width, height };
}

module.exports = {
  OVERLAY_MIN_WIDTH,
  OVERLAY_MIN_HEIGHT,
  OVERLAY_DEFAULT_WIDTH,
  OVERLAY_DEFAULT_HEIGHT,
  clampOverlayOpacity,
  overlayBounds
};
