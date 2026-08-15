'use strict';

const { parseBackendLine, writeCommand } = require('./backend-protocol');

/**
 * Owns the combat capture child (damage / status monitoring).
 * JSON protocol: snapshot | status | notice.
 */
function createCaptureHost(deps) {
  const {
    spawnImpl,
    createInterface,
    fs,
    getSelectedPid,
    getGameProcesses,
    isDemo,
    startDemo,
    stopDemo,
    hasDemoTimer,
    resolveRuntime,
    buildEnv,
    getSrcDir,
    getDataDir,
    getCaptureSettings,
    setDamageState,
    reportDamageError,
    log,
    onMessage,
    stopChildGracefully,
    getChild,
    setChild,
    captureNeeded,
    captureRoleMessage
  } = deps;

  function runningChild() {
    return getChild();
  }

  function write(command) {
    return writeCommand(runningChild(), command);
  }

  function sendInitialCommands(child) {
    if (!child?.stdin?.writable) return;
    const settings = getCaptureSettings() || {};
    writeCommand(child, { action: 'set-categories', categories: settings.categories || {} });
    writeCommand(child, {
      action: 'set-skill-name-mode',
      mode: settings.skillNameMode || 'client'
    });
  }

  function wireChild(child) {
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const parsed = parseBackendLine(line);
      if (parsed.kind === 'json') {
        onMessage(parsed.message);
        return;
      }
      if (parsed.kind === 'text' && parsed.text) log('info', parsed.text);
    });
    const errors = createInterface({ input: child.stderr });
    errors.on('line', (line) => line.trim() && log('error', line.trim()));
    child.on('error', (error) => {
      reportDamageError(error.message, { kind: 'spawn' });
    });
    child.on('exit', (code) => {
      if (getChild() === child) setChild(null);
      setDamageState('stopped', code === 0 ? '已停止' : `已退出（代码 ${code}）`, { keepError: true });
    });
  }

  function start() {
    if (runningChild()) return { ok: true };
    const pid = getSelectedPid();
    if (!pid) {
      return reportDamageError('没有可用的游戏进程，请启动游戏并刷新顶部进程列表', { kind: 'no-process' });
    }
    const processes = getGameProcesses() || [];
    if (!processes.some((process) => process.pid === pid)) {
      return reportDamageError(
        `所选进程 ${pid} 已不在列表中，请刷新后重新选择`,
        { kind: 'process-gone' }
      );
    }
    if (isDemo()) {
      startDemo();
      return { ok: true };
    }

    const runtime = resolveRuntime('damage');
    setDamageState('starting', '正在启动采集…');
    log('info', `启动采集后端，连接游戏进程 ${pid}`);
    try {
      if (runtime.args?.[1] && !fs.existsSync(runtime.args[1]) && runtime.command === 'python') {
        return reportDamageError(`找不到后端脚本：${runtime.args[1]}`, { kind: 'script-missing' });
      }
      const child = spawnImpl(runtime.command, runtime.args, {
        cwd: runtime.cwd || getSrcDir(),
        windowsHide: true,
        env: buildEnv({
          srcDir: getSrcDir(),
          backendDir: runtime.cwd,
          dataDir: getDataDir()
        }),
        stdio: ['pipe', 'pipe', 'pipe']
      });
      setChild(child);
      sendInitialCommands(child);
      wireChild(child);
      return { ok: true };
    } catch (error) {
      setChild(null);
      return reportDamageError(error.message, { kind: 'spawn' });
    }
  }

  async function stop({ waitMs = 12000 } = {}) {
    if (isDemo()) {
      stopDemo();
      return { ok: true };
    }
    const child = runningChild();
    if (!child) {
      setChild(null);
      setDamageState('stopped', '已停止');
      return { ok: true };
    }
    try {
      await stopChildGracefully('damage', child, { waitMs });
    } finally {
      if (getChild() === child) setChild(null);
      setDamageState('stopped', '已停止', { keepError: true });
    }
    return { ok: true };
  }

  function pidMismatch() {
    const attached = deps.getAttachedPid?.();
    const selected = getSelectedPid();
    if (!runningChild() || attached == null || selected == null) return false;
    return Number(attached) !== Number(selected);
  }

  async function reconcile({ waitMs = 12000, forceRestart = false } = {}) {
    const needed = captureNeeded();
    if (needed) {
      const mismatch = pidMismatch();
      if ((forceRestart || mismatch) && (runningChild() || (isDemo() && hasDemoTimer()))) {
        if (mismatch) {
          log('warn', `采集挂接 PID 与当前游戏不一致，正在重新挂接…`);
        }
        await stop({ waitMs });
      }
      if (!runningChild() && !(isDemo() && hasDemoTimer())) {
        return start();
      }
      if (runningChild()) {
        const pid = deps.getAttachedPid?.() != null ? deps.getAttachedPid() : getSelectedPid();
        setDamageState('running', captureRoleMessage(), { pid, refresh: true });
      }
      return { ok: true };
    }
    if (runningChild() || (isDemo() && hasDemoTimer())) {
      return stop({ waitMs });
    }
    deps.broadcastIdle?.();
    return { ok: true };
  }

  return {
    start,
    stop,
    reconcile,
    write,
    pidMismatch,
    sendInitialCommands
  };
}

module.exports = { createCaptureHost };
