'use strict';

const { execFile } = require('child_process');

/**
 * Cooperative stop for Frida Python hosts.
 * On Windows Node's child.kill() is force-kill — avoid it while attached.
 */
function requestGracefulStop(name, child) {
  try {
    if (child.stdin && child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({ action: 'stop' })}\n`);
      if (name === 'translator') child.stdin.write('stop\n');
      try {
        child.stdin.end();
      } catch {
        // ignore
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
 * @param {(level: string, message: string) => void} options.log
 * @param {(state: string, message: string) => void} options.setStopping
 */
async function stopChildGracefully({ name, child, waitMs = 12000, log, setStopping }) {
  if (!child) return { ok: true };
  if (setStopping) setStopping('stopping', '正在安全卸载抓包钩子…');
  log('info', '正在安全断开 Frida（Windows 上不会强杀后端，避免游戏闪退）…');
  requestGracefulStop(name, child);

  const exited = await waitForChildExit(child, waitMs);
  if (exited) {
    log('info', '后端已安全退出，钩子应已卸载');
    return { ok: true };
  }

  if (process.platform !== 'win32') {
    log('info', `后端 ${waitMs}ms 内未退出，发送 SIGTERM…`);
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    const exitedSoft = await waitForChildExit(child, 3000);
    if (exitedSoft) {
      log('info', '后端已在 SIGTERM 后退出');
      return { ok: true };
    }
  }

  log('warn', '后端仍未退出；最后尝试强制结束（仅后端，不杀游戏）。若仍闪退请先点停止采集再关工具箱。');
  forceKillChild(child);
  await waitForChildExit(child, 2000);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { ok: true };
}

module.exports = {
  requestGracefulStop,
  forceKillChild,
  waitForChildExit,
  stopChildGracefully
};
