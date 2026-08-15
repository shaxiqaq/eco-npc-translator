'use strict';

const { parseBackendLine, classifyTranslatorText } = require('./backend-protocol');

/**
 * Owns the NPC translator child. Prefers JSON status lines; falls back to
 * legacy log-text heuristics so older packaged backends still work.
 */
function createTranslatorHost(deps) {
  const {
    spawnImpl,
    createInterface,
    fs,
    getSelectedPid,
    resolveRuntime,
    buildEnv,
    getSrcDir,
    getDataDir,
    setTranslatorState,
    reportTranslatorError,
    log,
    stopChildGracefully,
    getChild,
    setChild,
    isPackaged
  } = deps;

  function applyJson(message) {
    if (!message || message.type !== 'status') return false;
    const service = message.service || 'translator';
    if (service !== 'translator') return false;
    if (message.state === 'error') {
      reportTranslatorError(message.message || '翻译失败', {
        kind: message.error_code === 'ECO_E03' ? 'access' : (message.error_kind || undefined)
      });
      return true;
    }
    setTranslatorState(message.state, message.message || '', { pid: message.pid });
    return true;
  }

  function applyText(text) {
    const classified = classifyTranslatorText(text);
    if (!classified) return;
    if (classified.state === 'error') {
      reportTranslatorError(classified.message, { kind: classified.kind });
      return;
    }
    if (classified.state === 'running') {
      setTranslatorState('running', `NPC 翻译正在运行（进程 ${getSelectedPid()}）`, {
        pid: getSelectedPid()
      });
    }
  }

  function start() {
    if (getChild()) return { ok: true };
    const pid = getSelectedPid();
    if (!pid) {
      return reportTranslatorError('没有可用的 eco.exe，请启动游戏并刷新进程列表', { kind: 'no-process' });
    }
    const runtime = resolveRuntime('translator');
    setTranslatorState('starting', '正在启动');
    log('info', `启动翻译后端，连接游戏进程 ${pid}`);
    try {
      if (!isPackaged() && runtime.args?.[1] && !fs.existsSync(runtime.args[1])) {
        return reportTranslatorError(`找不到后端脚本：${runtime.args[1]}`, { kind: 'script-missing' });
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

      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        const parsed = parseBackendLine(line);
        if (parsed.kind === 'json') {
          if (!applyJson(parsed.message) && parsed.message?.message) {
            log('info', parsed.message.message);
          }
          return;
        }
        if (parsed.kind === 'text' && parsed.text) {
          log('info', parsed.text);
          applyText(parsed.text);
        }
      });
      const errors = createInterface({ input: child.stderr });
      errors.on('line', (line) => line.trim() && log('error', line.trim()));
      child.on('error', (error) => reportTranslatorError(error.message, { kind: 'spawn' }));
      child.on('exit', (code) => {
        if (getChild() === child) setChild(null);
        setTranslatorState('stopped', code === 0 ? '已停止' : `已退出（代码 ${code}）`, { keepError: true });
      });
      setTimeout(() => {
        if (getChild() === child) {
          setTranslatorState('running', `NPC 翻译正在运行（进程 ${pid}）`, {
            pid,
            onlyIfStarting: true
          });
        }
      }, 1600);
      return { ok: true };
    } catch (error) {
      setChild(null);
      return reportTranslatorError(error.message, { kind: 'spawn' });
    }
  }

  async function stop({ waitMs = 12000, forceKill = true, settleMs = 400 } = {}) {
    const child = getChild();
    if (!child) return { ok: true };
    await stopChildGracefully('translator', child, { waitMs, forceKill, settleMs });
    if (getChild() === child) setChild(null);
    return { ok: true };
  }

  return { start, stop };
}

module.exports = { createTranslatorHost };
