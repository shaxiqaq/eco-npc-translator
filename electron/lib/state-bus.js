'use strict';

/**
 * Throttled multi-window IPC broadcaster.
 * Heavy payloads (snapshot / logs) must use dedicated channels, not app:state.
 */
function createStateBus({ getWindows, buildLightState, buildFullState }) {
  let timer = null;
  let pendingForce = false;
  const THROTTLE_MS = 80;

  function windows() {
    return (getWindows() || []).filter((win) => win && !win.isDestroyed());
  }

  function send(channel, payload) {
    for (const win of windows()) {
      try {
        win.webContents.send(channel, payload);
      } catch {
        // ignore destroyed races
      }
    }
  }

  function flush() {
    timer = null;
    const force = pendingForce;
    pendingForce = false;
    send('app:state', force ? buildFullState() : buildLightState());
  }

  /** Lightweight state (services / pids / settings summary). Throttled. */
  function broadcastState({ immediate = false } = {}) {
    if (immediate) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingForce = false;
      send('app:state', buildLightState());
      return;
    }
    if (timer) return;
    timer = setTimeout(flush, THROTTLE_MS);
  }

  function broadcastFullState() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pendingForce = false;
    send('app:state', buildFullState());
  }

  function broadcastSnapshot(snapshot) {
    if (!snapshot) return;
    send('damage:snapshot', snapshot);
  }

  function broadcastLog(entry) {
    if (!entry) return;
    send('service:log', entry);
  }

  function broadcastUpdate(update) {
    send('update:state', update);
  }

  return {
    send,
    broadcastState,
    broadcastFullState,
    broadcastSnapshot,
    broadcastLog,
    broadcastUpdate
  };
}

module.exports = { createStateBus };
