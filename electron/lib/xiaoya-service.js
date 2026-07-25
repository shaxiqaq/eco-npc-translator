const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const SKILL_COUNT = 6;
const DEFAULT_SKILLS = [
  { enabled: true, skillTime: 8, mouse: true, delay: 2500 },
  { enabled: true, skillTime: 15, mouse: true, delay: 2300 },
  { enabled: true, skillTime: 15, mouse: true, delay: 2300 },
  { enabled: true, skillTime: 50, mouse: true, delay: 3000 },
  { enabled: false, skillTime: 15, mouse: true, delay: 3000 },
  { enabled: false, skillTime: 15, mouse: true, delay: 3000 }
];

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === '真' || value === 'true' || value === '1') return true;
  if (value === '假' || value === 'false' || value === '0') return false;
  return fallback;
}

function asInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSkills(skills) {
  return Array.from({ length: SKILL_COUNT }, (_, index) => {
    const fallback = DEFAULT_SKILLS[index];
    const incoming = Array.isArray(skills) ? skills[index] || {} : {};
    return {
      enabled: asBoolean(incoming.enabled, fallback.enabled),
      skillTime: asInteger(incoming.skillTime, fallback.skillTime, 0, 86400),
      mouse: asBoolean(incoming.mouse, fallback.mouse),
      delay: asInteger(incoming.delay, fallback.delay, 0, 60000)
    };
  });
}

function parseIniText(text) {
  const values = new Map();
  let section = '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    values.set(`${section}\0${key}`, value);
  }

  return normalizeSkills(Array.from({ length: SKILL_COUNT }, (_, index) => {
    const number = index + 1;
    const fallback = DEFAULT_SKILLS[index];
    return {
      enabled: asBoolean(values.get(`设置1\0F${number}`), fallback.enabled),
      skillTime: asInteger(values.get(`设置2\0技能时间${number}`), fallback.skillTime, 0, 86400),
      mouse: asBoolean(values.get(`设置3\0鼠标${number}`), fallback.mouse),
      delay: asInteger(values.get(`设置4\0延迟时间${number}`), fallback.delay, 0, 60000)
    };
  }));
}

function serializeIniText(skills) {
  const normalized = normalizeSkills(skills);
  const truth = (value) => value ? '真' : '假';
  const sections = [
    ['设置1', normalized.map((skill, index) => `F${index + 1}=${truth(skill.enabled)}`)],
    ['设置2', normalized.map((skill, index) => `技能时间${index + 1}=${skill.skillTime}`)],
    ['设置3', normalized.map((skill, index) => `鼠标${index + 1}=${truth(skill.mouse)}`)],
    ['设置4', normalized.map((skill, index) => `延迟时间${index + 1}=${skill.delay}`)]
  ];
  return `${sections.map(([name, lines]) => `[${name}]\r\n${lines.join('\r\n')}`).join('\r\n')}\r\n`;
}

class XiaoyaService {
  constructor({ sourceDir, runtimeDir, onState = () => {} }) {
    this.sourceDir = sourceDir;
    this.runtimeDir = runtimeDir;
    this.sourceExe = path.join(sourceDir, '小雅.exe');
    this.sourceConfig = path.join(sourceDir, '小雅身体配置.ini');
    this.exePath = path.join(runtimeDir, '小雅.exe');
    this.configPath = path.join(runtimeDir, '小雅身体配置.ini');
    this.onState = onState;
    this.child = null;
    this.state = 'stopped';
    this.message = '尚未启动';
  }

  ensureRuntime() {
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    if (!fs.existsSync(this.exePath)) {
      if (!fs.existsSync(this.sourceExe)) throw new Error(`找不到小雅程序：${this.sourceExe}`);
      fs.copyFileSync(this.sourceExe, this.exePath);
    }
    if (!fs.existsSync(this.configPath)) {
      if (fs.existsSync(this.sourceConfig)) fs.copyFileSync(this.sourceConfig, this.configPath);
      else this.writeConfig(DEFAULT_SKILLS);
    }
  }

  snapshot() {
    return {
      available: fs.existsSync(this.exePath) || fs.existsSync(this.sourceExe),
      state: this.state,
      message: this.message,
      pid: this.child?.pid || null,
      running: Boolean(this.child),
      runtimeDir: this.runtimeDir
    };
  }

  emit(state, message) {
    this.state = state;
    this.message = message;
    this.onState(this.snapshot());
  }

  readConfig() {
    this.ensureRuntime();
    const text = iconv.decode(fs.readFileSync(this.configPath), 'gbk');
    return normalizeSkills(parseIniText(text));
  }

  writeConfig(skills) {
    const normalized = normalizeSkills(skills);
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    if (fs.existsSync(this.configPath) && !fs.existsSync(`${this.configPath}.bak`)) {
      fs.copyFileSync(this.configPath, `${this.configPath}.bak`);
    }
    fs.writeFileSync(this.configPath, iconv.encode(serializeIniText(normalized), 'gbk'));
    return normalized;
  }

  start() {
    if (this.child) return { ok: true, state: this.snapshot() };
    this.ensureRuntime();
    this.emit('starting', '正在启动小雅');
    try {
      const child = spawn(this.exePath, [], {
        cwd: this.runtimeDir,
        windowsHide: false,
        stdio: 'ignore'
      });
      this.child = child;
      child.once('spawn', () => this.emit('running', '小雅正在运行'));
      child.once('error', (error) => {
        this.child = null;
        this.emit('error', error.message);
      });
      child.once('exit', (code) => {
        if (this.child === child) this.child = null;
        this.emit('stopped', code === 0 || code === null ? '已停止' : `已退出（代码 ${code}）`);
      });
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      this.child = null;
      this.emit('error', error.message);
      return { ok: false, error: error.message, state: this.snapshot() };
    }
  }

  stop() {
    const child = this.child;
    if (!child) return Promise.resolve({ ok: true, state: this.snapshot() });
    this.emit('stopping', '正在停止小雅');
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, (error) => {
          if (error && this.child === child) {
            this.emit('error', `停止失败：${error.message}`);
            resolve({ ok: false, error: error.message, state: this.snapshot() });
            return;
          }
          resolve({ ok: true, state: this.snapshot() });
        });
      } else {
        child.kill('SIGTERM');
        resolve({ ok: true, state: this.snapshot() });
      }
    });
  }

  dispose() {
    if (!this.child) return;
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true }, () => {});
    } else {
      this.child.kill('SIGTERM');
    }
  }
}

module.exports = {
  DEFAULT_SKILLS,
  XiaoyaService,
  normalizeSkills,
  parseIniText,
  serializeIniText
};
