'use strict';

const path = require('path');

/**
 * Shared environment for Frida Python / packaged backends.
 * Keeps snapshot history modest to limit IPC payload size.
 */
function buildBackendEnv({ srcDir, backendDir, dataDir, extra = {} } = {}) {
  const pythonPath = [srcDir, backendDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return {
    ...process.env,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    PYTHONPATH: pythonPath,
    ECO_DATA_DIR: dataDir || process.env.ECO_DATA_DIR || '',
    // Default 80; clamp is also enforced in eco_damage_bridge.py (20–200).
    ECO_SNAPSHOT_HISTORY: process.env.ECO_SNAPSHOT_HISTORY || '80',
    ...extra
  };
}

module.exports = { buildBackendEnv };
