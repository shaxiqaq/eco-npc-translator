'use strict';

const { execFile } = require('child_process');
const os = require('os');

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 8000, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        error,
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    });
  });
}

/** Best-effort admin / elevated check on Windows. */
async function isProcessElevated() {
  if (process.platform !== 'win32') return null;
  try {
    // whoami /groups contains Mandatory Label\High or System when elevated.
    const { ok, stdout } = await execFileAsync('whoami', ['/groups']);
    if (!ok) return null;
    const text = stdout.toLowerCase();
    if (text.includes('s-1-16-12288') || text.includes('high mandatory level')) return true;
    if (text.includes('s-1-16-16384') || text.includes('system mandatory level')) return true;
    if (text.includes('s-1-16-8192') || text.includes('medium mandatory level')) return false;
    return null;
  } catch {
    return null;
  }
}

function summarizeAttachHints({
  elevated,
  selectedGamePid,
  processAlive,
  processInList,
  serviceMessage,
  gameProcessCount
}) {
  const hints = [];
  if (elevated === false) {
    hints.push('当前工具箱可能未以管理员运行。连接 eco.exe 失败时请右键「以管理员身份运行」。');
  }
  if (!selectedGamePid) {
    hints.push('尚未选择游戏进程：请先启动并登录 ECO，再点顶部刷新并选择角色窗口。');
  } else if (processAlive === false || processInList === false) {
    hints.push(`所选进程 ${selectedGamePid} 已退出或不在列表中。请刷新进程列表后重选，或点「重新连接」。`);
  }
  if (gameProcessCount === 0) {
    hints.push('未检测到 eco.exe。确认已进入游戏世界（不是仅登录器），且进程名仍为 eco.exe。');
  }
  const msg = String(serviceMessage || '');
  if (/access|denied|权限|administrator/i.test(msg)) {
    hints.push('权限不足：请关闭工具箱后，以管理员身份重新打开，再启动伤害采集/状态监控。');
  }
  if (/没有找到|不存在|已退出|enumerate|frida/i.test(msg)) {
    hints.push('Frida 挂接失败：确认已选中正确 PID；多开时主号/小雅目标进程不要选错。');
  }
  if (!hints.length) {
    hints.push('若仍无法显示角色状态，请导出日志或复制诊断信息以便远程排查。');
  }
  return hints;
}

function buildConnectionHealth({
  elevated,
  selectedGamePid,
  selectedXiaoyaPid,
  gameProcesses,
  processAlive,
  services,
  damageWanted,
  monitoringWanted
}) {
  const list = gameProcesses || [];
  const inList = selectedGamePid
    ? list.some((p) => Number(p.pid) === Number(selectedGamePid))
    : false;
  const alive = processAlive == null ? inList : processAlive;
  const backend = services?.damage || {};
  const err = backend.state === 'error';
  const running = ['running', 'starting'].includes(backend.state);
  let status = 'idle';
  if (!selectedGamePid) status = 'no-process';
  else if (!alive) status = 'process-gone';
  else if (err) status = 'attach-error';
  else if ((damageWanted || monitoringWanted) && running) status = 'connected';
  else if (damageWanted || monitoringWanted) status = 'connecting';
  else status = 'ready';

  const hints = summarizeAttachHints({
    elevated,
    selectedGamePid,
    processAlive: alive,
    processInList: inList,
    serviceMessage: backend.message,
    gameProcessCount: list.length
  });

  return {
    status,
    elevated,
    selectedGamePid: selectedGamePid || null,
    selectedXiaoyaPid: selectedXiaoyaPid || null,
    processAlive: alive,
    processInList: inList,
    gameProcessCount: list.length,
    hostname: os.hostname(),
    hints,
    serviceMessage: backend.message || ''
  };
}

module.exports = {
  isProcessElevated,
  summarizeAttachHints,
  buildConnectionHealth,
  execFileAsync
};
