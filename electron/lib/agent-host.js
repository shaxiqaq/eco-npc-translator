'use strict';

const { parseBackendLine, writeCommand } = require('./backend-protocol');

/**
 * One child = one Frida attach. Features are --damage / --translate flags.
 * Restart the child when the desired feature set or PID changes.
 */
function createAgentHost(deps) {
  const {
    spawnImpl,
    createInterface,
    fs,
    getSelectedPid,
    getGameProcesses,
    resolveRuntime,
    buildEnv,
    getSrcDir,
    getDataDir,
    getCaptureSettings,
    captureNeeded,
    translateWanted,
    captureRoleMessage,
    setDamageState,
    setTranslatorState,
    reportDamageError,
    reportTranslatorError,
    onDamageMessage,
    onTranslatorMessage,
    log,
    stopChildGracefully,
    setDamageChild,
    setTranslatorChild,
    getAttachedPid,
    broadcastIdle
  } = deps;

  let child = null;
  let live = { capture: false, translate: false };

  function desired() {
    return {
      capture: Boolean(captureNeeded()),
      translate: Boolean(translateWanted())
    };
  }

  function publishHandles() {
    setDamageChild(live.capture ? child : null);
    setTranslatorChild(live.translate ? child : null);
  }

  function sendInitialCommands() {
    if (!live.capture || !child?.stdin?.writable) return;
    const settings = getCaptureSettings() || {};
    writeCommand(child, { action: 'set-categories', categories: settings.categories || {} });
    writeCommand(child, {
      action: 'set-skill-name-mode',
      mode: settings.skillNameMode || 'client'
    });
  }

  function handleLine(line) {
    const parsed = parseBackendLine(line);
    if (parsed.kind === 'json') {
      const msg = parsed.message || {};
      const service = String(msg.service || '');
      if (msg.type === 'snapshot' || service === 'damage') {
        onDamageMessage(msg);
        return;
      }
      if (service === 'translator') {
        onTranslatorMessage(msg);
        return;
      }
      if (msg.type === 'notice') {
        log(msg.level || 'info', msg.message || '');
        return;
      }
      if (service === 'agent' && msg.state === 'error') {
        if (live.capture) reportDamageError(msg.message || '采集代理失败', {});
        if (live.translate) reportTranslatorError(msg.message || '采集代理失败', {});
        return;
      }
      if (msg.message) log('info', msg.message);
      return;
    }
    if (parsed.kind === 'text' && parsed.text) log('info', parsed.text);
  }

  function applyLiveFeatures(want) {
    if (!child || !child.stdin?.writable) return null;
    if (Boolean(want.capture) !== Boolean(live.capture)) return null;
    if (Boolean(want.translate) === Boolean(live.translate)) return { ok: true };
    const sent = writeCommand(child, {
      action: 'set-translate',
      enabled: Boolean(want.translate)
    });
    if (!sent) return null;
    live.translate = Boolean(want.translate);
    publishHandles();
    if (live.translate) {
      setTranslatorState('starting', '正在启用 NPC 翻译…', { pid: getSelectedPid() });
      log('info', '已请求启用翻译（不重挂采集）');
    } else {
      setTranslatorState('stopped', '已停止');
      log('info', '已请求关闭翻译（不拆采集会话）');
    }
    return { ok: true };
  }

  function start(want) {
    if (child && child.exitCode == null) {
      log('warn', '统一代理已在运行，忽略重复启动');
      const applied = applyLiveFeatures(want);
      return applied || { ok: true };
    }
    const pid = getSelectedPid();
    if (!pid) {
      const err = '没有可用的游戏进程，请启动游戏并刷新顶部进程列表';
      if (want.capture) return reportDamageError(err, { kind: 'no-process' });
      return reportTranslatorError(err, { kind: 'no-process' });
    }
    const processes = getGameProcesses() || [];
    if (!processes.some((process) => process.pid === pid)) {
      const err = `所选进程 ${pid} 已不在列表中，请刷新后重新选择`;
      if (want.capture) return reportDamageError(err, { kind: 'process-gone' });
      return reportTranslatorError(err, { kind: 'process-gone' });
    }

    const extraArgs = [
      ...(want.capture ? ['--damage'] : []),
      ...(want.translate ? ['--translate'] : [])
    ];
    const runtime = resolveRuntime('agent', extraArgs);
    if (want.capture) setDamageState('starting', '正在启动统一采集…');
    if (want.translate) setTranslatorState('starting', '正在启动统一翻译…');
    log('info', `统一挂接进程 ${pid}（采集=${want.capture ? '开' : '关'} 翻译=${want.translate ? '开' : '关'}）`);

    try {
      const scriptPath = runtime.args?.[1];
      if (scriptPath && scriptPath.endsWith('.py') && !fs.existsSync(scriptPath)) {
        return reportDamageError(`找不到后端脚本：${scriptPath}`, { kind: 'script-missing' });
      }
      const spawned = spawnImpl(runtime.command, runtime.args, {
        cwd: runtime.cwd || getSrcDir(),
        windowsHide: true,
        env: buildEnv({
          srcDir: getSrcDir(),
          backendDir: runtime.cwd,
          dataDir: getDataDir()
        }),
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child = spawned;
      live = { ...want };
      publishHandles();
      sendInitialCommands();

      const lines = createInterface({ input: spawned.stdout });
      lines.on('line', handleLine);
      const errors = createInterface({ input: spawned.stderr });
      errors.on('line', (line) => line.trim() && log('error', line.trim()));
      spawned.on('error', (error) => {
        if (live.capture) reportDamageError(error.message, { kind: 'spawn' });
        if (live.translate) reportTranslatorError(error.message, { kind: 'spawn' });
      });
      spawned.on('exit', (code) => {
        if (child === spawned) {
          child = null;
          const was = live;
          live = { capture: false, translate: false };
          publishHandles();
          if (was.capture) {
            setDamageState('stopped', code === 0 ? '已停止' : `已退出（代码 ${code}）`, { keepError: true });
          }
          if (was.translate) {
            setTranslatorState('stopped', code === 0 ? '已停止' : `已退出（代码 ${code}）`, { keepError: true });
          }
        }
      });
      return { ok: true };
    } catch (error) {
      child = null;
      live = { capture: false, translate: false };
      publishHandles();
      return reportDamageError(error.message, { kind: 'spawn' });
    }
  }

  async function stop({ waitMs = 12000 } = {}) {
    if (!child) {
      live = { capture: false, translate: false };
      publishHandles();
      return { ok: true };
    }
    const current = child;
    try {
      await stopChildGracefully('agent', current, { waitMs });
    } finally {
      if (child === current) child = null;
      live = { capture: false, translate: false };
      publishHandles();
      setDamageState('stopped', '已停止', { keepError: true });
      setTranslatorState('stopped', '已停止', { keepError: true });
    }
    return { ok: true };
  }

  function pidMismatch() {
    const attached = getAttachedPid?.();
    const selected = getSelectedPid();
    if (!child || attached == null || selected == null) return false;
    return Number(attached) !== Number(selected);
  }

  async function reconcile({ waitMs = 12000, forceRestart = false } = {}) {
    const want = desired();
    if (!want.capture && !want.translate) {
      if (child) return stop({ waitMs });
      broadcastIdle?.();
      return { ok: true };
    }
    if (child && (forceRestart || pidMismatch())) {
      if (pidMismatch()) log('warn', '统一代理 PID 与当前游戏不一致，正在重新挂接…');
      await stop({ waitMs });
    }
    if (!child) return start(want);
    const featureChange = want.capture !== live.capture || want.translate !== live.translate;
    if (featureChange) {
      const applied = applyLiveFeatures(want);
      if (applied) return applied;
      await stop({ waitMs });
      return start(want);
    }
    if (want.capture) {
      setDamageState('running', captureRoleMessage(), {
        pid: getAttachedPid?.() != null ? getAttachedPid() : getSelectedPid(),
        refresh: true
      });
    }
    return { ok: true };
  }

  return {
    start,
    stop,
    reconcile,
    pidMismatch,
    getChild: () => child,
    liveFeatures: () => ({ ...live })
  };
}

module.exports = { createAgentHost };
