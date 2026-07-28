'use strict';

const { execFile } = require('child_process');

/**
 * Cooperative stop for Frida Python hosts.
 * On Windows Node's child.kill() is force-kill — avoid it while attached.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestGracefulStop(name, child, { endStdin = false } = {}) {
  try {
    if (child.stdin && child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({ action: 'stop' })}\n`);
      if (name === 'translator') child.stdin.write('stop\n');
      // Do not end stdin immediately on quit — dispose needs the process alive.
      if (endStdin) {
        try {
          child.stdin.end();
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore broken pipe
  }
}

function forceKillChild(child) {
  if (!child || child.killed || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/f'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

function waitForChildExit(child, waitMs = 12000) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode != null) {
      resolve(true);
      return;
    }
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve(ok);
    };
    const onExit = () => done(true);
    child.once('exit', onExit);
    const poll = setInterval(() => {
      if (!child || child.killed || child.exitCode != null) done(true);
    }, 100);
    const timer = setTimeout(() => {
      try {
        child.removeListener('exit', onExit);
      } catch {
        // ignore
      }
      done(false);
    }, waitMs);
  });
}

/**
 * @param {object} options
 * @param {string} options.name
 * @param {import('child_process').ChildProcess} options.child
 * @param {number} [options.waitMs]
 * @param {boolean} [options.forceKill] — force-kill after timeout (default true)
 * @param {number} [options.settleMs] — pause after stop so game can resume IO
 * @param {(level: string, message: string) => void} options.log
 * @param {(state: string, message: string) => void} options.setStopping
 */
async function stopChildGracefully({
  name,
  child,
  waitMs = 12000,
  forceKill = true,
  settleMs = 400,
  log,
  setStopping
}) {
  if (!child) return { ok: true, exited: true, forced: false };
  if (setStopping) setStopping('stopping', '正在安全卸载抓包钩子…');
  if (log) log('info', '正在安全断开 Frida（先卸载钩子，避免游戏闪退）…');

  requestGracefulStop(name, child, { endStdin: false });

  let exited = await waitForChildExit(child, waitMs);
  let forced = false;

  if (!exited) {
    // Second chance: close stdin so watchers/EOF paths can finish dispose.
    try {
      if (child.stdin && child.stdin.writable) child.stdin.end();
    } catch {
      // ignore
    }
    exited = await waitForChildExit(child, Math.min(4000, Math.max(1500, Math.floor(waitMs / 3))));
  }

  if (!exited && forceKill) {
    if (log) {
      log(
        'warn',
        '后端未在时限内退出，强制结束后端进程（不杀游戏）。若仍闪退请先点「全部停止」再退出。'
      );
    }
    forceKillChild(child);
    forced = true;
    exited = await waitForChildExit(child, 2500);
  } else if (!exited && !forceKill) {
    if (log) log('warn', '后端仍在运行且已禁用强杀；将再等待片刻…');
    exited = await waitForChildExit(child, 5000);
    if (!exited) {
      if (log) log('warn', '最终仍未退出，兜底强杀后端（仅后端）。');
      forceKillChild(child);
      forced = true;
      await waitForChildExit(child, 2000);
    }
  }

  if (exited && log) {
    log('info', forced ? '后端已结束（含兜底强杀）' : '后端已安全退出，钩子应已卸载');
  }

  if (settleMs > 0) await sleep(settleMs);
  return { ok: true, exited: Boolean(exited || forced), forced };
}

module.exports = {
  requestGracefulStop,
  forceKillChild,
  waitForChildExit,
  stopChildGracefully,
  sleep
};
