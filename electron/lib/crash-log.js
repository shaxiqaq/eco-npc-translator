'use strict';

const fs = require('fs');
const path = require('path');

function crashDir(dataDir) {
  const dir = path.join(dataDir, 'logs', 'crash');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  return dir;
}

function serializeReason(reason) {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack
    };
  }
  if (typeof reason === 'string') return { message: reason };
  try {
    return { message: JSON.stringify(reason) };
  } catch {
    return { message: String(reason) };
  }
}

function appendCrashLog(dataDir, kind, reason) {
  const dir = crashDir(dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `crash-${stamp}-${kind}.json`);
  const payload = {
    kind,
    at: new Date().toISOString(),
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    versions: process.versions,
    ...serializeReason(reason)
  };
  try {
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    // Also append a one-line index for quick tailing.
    const index = path.join(dir, 'crash-index.log');
    fs.appendFileSync(
      index,
      `${payload.at}\t${kind}\t${payload.message || ''}\t${path.basename(file)}\n`,
      'utf8'
    );
    return file;
  } catch {
    return null;
  }
}

/**
 * Install process-level handlers. Safe to call once at startup.
 * @param {{ getDataDir: () => string, onCrash?: (kind: string, reason: unknown, file: string|null) => void }} options
 */
function installCrashHandlers({ getDataDir, onCrash } = {}) {
  if (global.__ecoCrashHandlersInstalled) return;
  global.__ecoCrashHandlersInstalled = true;

  const handle = (kind, reason) => {
    let file = null;
    try {
      const dir = typeof getDataDir === 'function' ? getDataDir() : '';
      if (dir) file = appendCrashLog(dir, kind, reason);
    } catch {
      // ignore secondary failures
    }
    try {
      if (onCrash) onCrash(kind, reason, file);
    } catch {
      // ignore
    }
  };

  process.on('uncaughtException', (error) => {
    handle('uncaughtException', error);
    // Do not exit: Electron main may still recover enough to show UI / export logs.
    console.error('[eco-crash] uncaughtException', error);
  });

  process.on('unhandledRejection', (reason) => {
    handle('unhandledRejection', reason);
    console.error('[eco-crash] unhandledRejection', reason);
  });
}

module.exports = {
  appendCrashLog,
  installCrashHandlers,
  crashDir
};
