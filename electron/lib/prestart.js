'use strict';

/**
 * Decide what to pre-start when a game process becomes alive.
 * Auto-start flags from settings; never restart something already up.
 */
function planPrestartOnGame({
  enabled = true,
  processBecameAlive = false,
  selectedPid = null,
  startupTranslator = false,
  translatorUp = false,
  captureNeeded = false,
  captureUp = false
} = {}) {
  if (!enabled || !processBecameAlive || !selectedPid) {
    return { capture: false, translator: false };
  }
  return {
    capture: Boolean(captureNeeded) && !captureUp,
    translator: Boolean(startupTranslator) && !translatorUp
  };
}

module.exports = { planPrestartOnGame };
