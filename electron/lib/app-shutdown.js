'use strict';

/**
 * Graceful app shutdown: stop Frida-backed services in a safe order, then quit.
 * Pure orchestration — all I/O and process handles come from the injected API.
 */

/**
 * @param {object} api
 * @param {() => import('electron').BrowserWindow | null} api.getMainWindow
 * @param {() => import('electron').BrowserWindow | null} api.getOverlayWindow
 * @param {(w: import('electron').BrowserWindow | null) => void} [api.setMainWindow]
 * @param {(w: import('electron').BrowserWindow | null) => void} [api.setOverlayWindow]
 * @param {Record<string, import('child_process').ChildProcess | null>} api.services
 * @param {(name: string, child: any, options?: object) => Promise<any>} api.stopChildGracefully
 * @param {(name: string, state: string, message: string) => void} api.setServiceState
 * @param {(service: string, level: string, message: string) => void} api.addLog
 * @param {() => void} api.stopDemo
 * @param {() => void} [api.flushSettings]
 * @param {() => Promise<void> | void} [api.stopXiaoya]
 * @param {() => void} [api.disposeXiaoya]
 * @param {boolean} [api.isDemo]
 * @param {(ms: number) => Promise<void>} api.sleep
 * @param {() => void} api.quitApp
 */
function createAppShutdown(api) {
  let gracefulQuitStarted = false;
  let gracefulQuitComplete = false;

  function showQuitProgressOverlay(message) {
    try {
      const mainWindow = api.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const safe = String(message || '')
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
      mainWindow.webContents.executeJavaScript(`
      (function () {
        var el = document.getElementById('eco-shutdown-overlay');
        if (!el) {
          el = document.createElement('div');
          el.id = 'eco-shutdown-overlay';
          el.setAttribute('style',
            'position:fixed;inset:0;z-index:2147483647;background:rgba(8,10,14,.92);' +
            'color:#f5f5f5;display:flex;align-items:center;justify-content:center;' +
            'flex-direction:column;gap:14px;font-family:system-ui,Segoe UI,sans-serif;' +
            'padding:24px;text-align:center');
          el.innerHTML =
            '<div style="font-size:20px;font-weight:650">正在安全退出</div>' +
            '<div id="eco-shutdown-msg" style="font-size:13px;line-height:1.55;max-width:420px;opacity:.9"></div>' +
            '<div style="font-size:12px;opacity:.65;max-width:420px">会先关闭翻译/伤害采集并卸载游戏内钩子，大约几秒到十几秒。请勿在任务管理器强杀，否则游戏可能闪退。</div>';
          document.body.appendChild(el);
        }
        var msg = document.getElementById('eco-shutdown-msg');
        if (msg) msg.textContent = \`${safe}\`;
      })();
    `).catch(() => {});
    } catch {
      // ignore
    }
  }

  async function stopAllBackendsForQuit() {
    const waitMs = 16000;
    const settle = (ms) => api.sleep(ms);
    const services = api.services;

    api.addLog('app', 'info', '安全退出：依次关闭 NPC 翻译 → 伤害/状态采集 → 小雅…');

    if (services.translator) {
      const child = services.translator;
      const shared = services.damage && services.damage === child;
      await api.stopChildGracefully(shared ? 'agent' : 'translator', child, {
        waitMs,
        forceKill: false,
        settleMs: 600
      });
      if (services.translator === child) services.translator = null;
      api.setServiceState('translator', 'stopped', '已停止');
      if (shared) {
        services.damage = null;
        api.setServiceState('damage', 'stopped', '已停止');
      }
    }
    await settle(700);

    if (services.damage) {
      const child = services.damage;
      await api.stopChildGracefully('damage', child, {
        waitMs,
        forceKill: false,
        settleMs: 600
      });
      if (services.damage === child) services.damage = null;
      api.setServiceState('damage', 'stopped', '已停止');
    } else if (api.isDemo) {
      api.stopDemo();
    }
    await settle(700);

    if (api.stopXiaoya) {
      try {
        await api.stopXiaoya();
      } catch {
        // ignore
      }
    }
    if (api.disposeXiaoya) {
      try {
        api.disposeXiaoya();
      } catch {
        // ignore
      }
    }
    await settle(700);

    for (const name of ['translator', 'damage']) {
      const child = services[name];
      if (!child || child.killed || child.exitCode != null) continue;
      api.addLog(name, 'warn', '退出兜底：仍在运行，强制结束后端');
      await api.stopChildGracefully(name, child, {
        waitMs: 2500,
        forceKill: true,
        settleMs: 400
      });
      if (services[name] === child) services[name] = null;
    }

    api.addLog('app', 'info', '钩子已卸载，等待游戏网络恢复后再退出…');
    await settle(1800);
    return { ok: true };
  }

  function beginGracefulShutdown(reason = 'quit') {
    if (gracefulQuitComplete) {
      api.quitApp();
      return;
    }
    if (gracefulQuitStarted) return;
    gracefulQuitStarted = true;

    try {
      api.flushSettings?.();
    } catch {
      // ignore
    }

    try {
      const mainWindow = api.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitle('ECO 工具箱 - 正在安全退出（请稍候）…');
        try {
          mainWindow.setClosable(false);
        } catch {
          /* ignore */
        }
        mainWindow.show();
        mainWindow.focus();
        showQuitProgressOverlay('正在关闭 NPC 翻译与伤害采集…');
      }
    } catch {
      /* ignore */
    }
    try {
      const overlayWindow = api.getOverlayWindow();
      if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
    } catch {
      /* ignore */
    }

    api.stopDemo();
    api.addLog('app', 'info', `安全退出（${reason}）：先关闭全部功能并卸载钩子，请稍候…`);

    const quitWork = Promise.resolve().then(async () => {
      showQuitProgressOverlay('正在卸载游戏内 Frida 钩子（翻译）…');
      await stopAllBackendsForQuit();
      showQuitProgressOverlay('全部功能已关闭，即将退出…');
      await api.sleep(500);
    });

    const timeoutWork = api.sleep(48000).then(() => {
      try {
        api.addLog('app', 'warn', '安全退出超时，仍将结束工具箱进程');
        showQuitProgressOverlay('等待超时，即将强制退出工具箱…');
      } catch {
        /* ignore */
      }
    });

    Promise.race([quitWork, timeoutWork])
      .catch((error) => {
        try {
          api.addLog('app', 'warn', `安全退出过程异常：${error?.message || error}`);
        } catch {
          /* ignore */
        }
      })
      .finally(() => {
        gracefulQuitComplete = true;
        try {
          const overlayWindow = api.getOverlayWindow();
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.destroy();
            api.setOverlayWindow?.(null);
          }
        } catch {
          /* ignore */
        }
        try {
          const mainWindow = api.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            try {
              mainWindow.setClosable(true);
            } catch {
              /* ignore */
            }
            mainWindow.removeAllListeners('close');
            mainWindow.destroy();
            api.setMainWindow?.(null);
          }
        } catch {
          /* ignore */
        }
        api.quitApp();
      });
  }

  return {
    beginGracefulShutdown,
    stopAllBackendsForQuit,
    showQuitProgressOverlay,
    isQuitStarted: () => gracefulQuitStarted,
    isQuitComplete: () => gracefulQuitComplete,
    /** @internal tests */
    _resetForTests() {
      gracefulQuitStarted = false;
      gracefulQuitComplete = false;
    }
  };
}

module.exports = {
  createAppShutdown
};
