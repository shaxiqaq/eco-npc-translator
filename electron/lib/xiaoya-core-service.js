const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const iconv = require('iconv-lite');

const {
  DEFAULT_SKILLS,
  normalizeSkills,
  parseIniText
} = require('./xiaoya-service');

class XiaoyaCoreService {
  constructor({
    corePath,
    runtimeDir,
    legacyConfigPath = '',
    getTargetPid = () => null,
    onState = () => {},
    onLog = () => {},
    onEvent = () => {}
  }) {
    this.corePath = corePath;
    this.runtimeDir = runtimeDir;
    this.configPath = path.join(runtimeDir, 'config.json');
    this.legacyConfigPath = legacyConfigPath;
    this.getTargetPid = getTargetPid;
    this.onState = onState;
    this.onLog = onLog;
    this.onEvent = onEvent;
    this.child = null;
    this.state = 'stopped';
    this.message = '尚未启动';
    this.version = null;
    this.mode = 'native-background';
    this.lastEvent = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.helloWaiter = null;
    this.helloMessage = null;
  }

  ensureRuntime() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    if (!fs.existsSync(this.configPath)) {
      let skills = DEFAULT_SKILLS;
      if (this.legacyConfigPath && fs.existsSync(this.legacyConfigPath)) {
        const text = iconv.decode(fs.readFileSync(this.legacyConfigPath), 'gbk');
        skills = parseIniText(text);
      }
      this.writeConfig(skills);
    }
  }

  snapshot() {
    return {
      available: fs.existsSync(this.corePath),
      state: this.state,
      message: this.message,
      pid: this.child?.pid || null,
      running: Boolean(this.child),
      runtimeDir: this.runtimeDir,
      version: this.version,
      mode: this.mode,
      lastEvent: this.lastEvent
    };
  }

  emit(state, message) {
    this.state = state;
    this.message = message;
    this.onState(this.snapshot());
  }

  readConfig() {
    this.ensureRuntime();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return normalizeSkills(parsed.skills);
    } catch {
      return normalizeSkills(DEFAULT_SKILLS);
    }
  }

  writeConfig(skills) {
    const normalized = normalizeSkills(skills);
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    const temporary = `${this.configPath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({
      version: 1,
      skills: normalized
    }, null, 2)}\n`, 'utf8');
    fs.copyFileSync(temporary, this.configPath);
    fs.rmSync(temporary, { force: true });

    if (this.child && this.state === 'running') {
      this.request('configure', this.configurationPayload())
        .catch((error) => this.onLog('error', `更新小雅核心配置失败：${error.message}`));
    }
    return normalized;
  }

  configurationPayload() {
    return {
      targetPid: Number(this.getTargetPid()) || null,
      skills: this.readConfig()
    };
  }

  targetPidOrThrow() {
    const targetPid = Number(this.getTargetPid());
    if (!Number.isSafeInteger(targetPid) || targetPid <= 0)
      throw new Error('请先在进程管理中选择要控制的 ECO 进程');
    return targetPid;
  }

  async ensureConnected() {
    if (this.child) return;
    if (!fs.existsSync(this.corePath))
      throw new Error(`找不到原生核心：${this.corePath}`);

    this.ensureRuntime();
    const child = spawn(this.corePath, ['--parent-pid', String(process.pid)], {
      cwd: this.runtimeDir,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    this.attachChild(child);
    await this.waitForHello(5000);
  }

  async prepareTarget() {
    const targetPid = this.targetPidOrThrow();
    await this.ensureConnected();
    await this.request('configure', this.configurationPayload());
    return targetPid;
  }

  async start() {
    try {
      const targetPid = this.targetPidOrThrow();
      this.emit('starting', `正在连接 ECO 进程 ${targetPid}`);
      await this.prepareTarget();
      await this.request('start', {});
      this.emit('running', `后台技能循环正在运行（目标进程 ${targetPid}）`);
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      this.onLog('error', error.message);
      this.forceKill();
      this.emit('error', error.message);
      return { ok: false, error: error.message, state: this.snapshot() };
    }
  }

  async toggleSs() {
    try {
      await this.prepareTarget();
      const result = await this.request('toggle-ss', {});
      return { ok: true, state: this.snapshot(), result };
    } catch (error) {
      this.onLog('error', `SS 模式切换失败：${error.message}`);
      return { ok: false, error: error.message, state: this.snapshot() };
    }
  }

  async toggleVisibility() {
    try {
      await this.prepareTarget();
      const result = await this.request('toggle-visibility', {});
      return { ok: true, visible: result.visible, state: this.snapshot() };
    } catch (error) {
      this.onLog('error', `显示/隐藏目标窗口失败：${error.message}`);
      return { ok: false, error: error.message, state: this.snapshot() };
    }
  }

  async stop() {
    if (!this.child) return { ok: true, state: this.snapshot() };
    this.emit('stopping', '正在停止原生核心');
    try {
      await this.request('stop', {}, 2000);
      await this.request('shutdown', {}, 2000);
      await this.waitForExit(2500);
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      this.onLog('error', `正常停止失败，正在强制结束：${error.message}`);
      this.forceKill();
      this.emit('stopped', '已强制停止');
      return { ok: true, state: this.snapshot() };
    }
  }

  request(command, payload = {}, timeoutMs = 4000) {
    const child = this.child;
    if (!child || !child.stdin.writable)
      return Promise.reject(new Error('小雅核心未运行'));

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`小雅核心请求超时：${command}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, command });
      child.stdin.write(`${JSON.stringify({ id, command, payload })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  attachChild(child) {
    const output = readline.createInterface({ input: child.stdout });
    output.on('line', (line) => {
      try {
        this.handleMessage(JSON.parse(line));
      } catch (error) {
        this.onLog('error', `无法解析小雅核心消息：${error.message}`);
      }
    });

    const errors = readline.createInterface({ input: child.stderr });
    errors.on('line', (line) => line.trim() && this.onLog('error', line.trim()));

    child.once('error', (error) => {
      this.rejectAll(error);
      this.child = null;
      this.emit('error', error.message);
    });
    child.once('exit', (code) => {
      if (this.child === child) {
        this.child = null;
        this.helloMessage = null;
      }
      this.rejectAll(new Error(`小雅核心已退出（代码 ${code}）`));
      if (this.state !== 'error') {
        this.emit(code === 0 || code === null ? 'stopped' : 'error',
          code === 0 || code === null ? '已停止' : `核心异常退出（代码 ${code}）`);
      }
    });
  }

  handleMessage(message) {
    if (message.type === 'hello') {
      this.helloMessage = message;
      this.version = message.version || null;
      this.mode = message.mode || 'native-background';
      this.helloWaiter?.resolve(message);
      this.helloWaiter = null;
      this.onLog('info', `小雅核心 ${this.version || ''} 已连接（${message.architecture || 'unknown'}）`);
      return;
    }

    if (message.type === 'response') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.payload);
      else pending.reject(new Error(message.payload?.error || `${pending.command} 失败`));
      return;
    }

    if (message.type === 'event') {
      this.lastEvent = message;
      if (message.event === 'action') {
        this.onLog('info', `已向目标窗口发送 ${message.key}${message.mouse ? ' 和鼠标点击' : ''}`);
      } else if (message.event === 'status' && message.message) {
        this.message = message.message;
      } else if (['ss-toggle', 'visibility'].includes(message.event) && message.message) {
        this.message = message.message;
        this.onLog('info', message.message);
      } else if (message.event === 'target-lost') {
        this.emit('error', message.message || '目标 ECO 窗口已关闭');
      } else if (message.event === 'error') {
        this.emit('error', message.error || '小雅核心运行失败');
      }
      this.onEvent(message);
      this.onState(this.snapshot());
      return;
    }

    if (message.type === 'fatal' || message.type === 'protocol-error') {
      this.onLog('error', message.error || '小雅核心协议错误');
    }
  }

  waitForHello(timeoutMs) {
    if (this.helloMessage)
      return Promise.resolve(this.helloMessage);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.helloWaiter) this.helloWaiter = null;
        reject(new Error('等待小雅核心握手超时'));
      }, timeoutMs);
      this.helloWaiter = {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      };
    });
  }

  waitForExit(timeoutMs) {
    if (!this.child) return Promise.resolve();
    const child = this.child;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('等待小雅核心退出超时')), timeoutMs);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    if (this.helloWaiter) {
      this.helloWaiter.reject(error);
      this.helloWaiter = null;
    }
  }

  forceKill() {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.helloMessage = null;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGTERM');
    }
  }

  dispose() {
    this.forceKill();
  }
}

module.exports = { XiaoyaCoreService };
