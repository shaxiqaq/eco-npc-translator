'use strict';

function applyOverlayVisibility(win, visible) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
  if (visible) {
    if (typeof win.showInactive === 'function') win.showInactive();
    else win.show();
  } else if (typeof win.hide === 'function') {
    win.hide();
  }
  return true;
}

module.exports = { applyOverlayVisibility };
