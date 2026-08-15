const { EventEmitter } = require('node:events');

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

function decodeHtmlEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return Object.hasOwn(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match;
  });
}

function looksLikeHtml(value) {
  return /<\/?[a-z][a-z0-9]*\b[^>]*>/i.test(value);
}

function formatHtmlLink(href, innerHtml) {
  const label = String(innerHtml).replace(/<[^>]+>/g, '').trim();
  if (!label) return href;
  if (label === href) return href;
  // GitHub compare links render as <tt>v0.2.15...v0.2.16</tt>; keep the real URL.
  if (/v?\d+\.\d+.*\.\.\./i.test(label) && href.includes(label)) return href;
  return label;
}

function htmlToPlainText(html) {
  let text = String(html).replace(/\r\n?/g, '\n');
  text = text.replace(/<\s*br\s*\/?>/gi, '\n');
  text = text.replace(/<\s*hr\s*\/?>/gi, '\n');
  text = text.replace(/<\s*(?:p|div|h[1-6]|tr|table|blockquote|pre|ul|ol)\b[^>]*>/gi, '\n');
  text = text.replace(/<\s*\/\s*(?:p|div|h[1-6]|tr|table|blockquote|pre|ul|ol)\s*>/gi, '\n');
  text = text.replace(/<\s*li\b[^>]*>/gi, '• ');
  text = text.replace(/<\s*\/\s*li\s*>/gi, '\n');
  text = text.replace(
    /<\s*a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi,
    (_, href, inner) => formatHtmlLink(href, inner)
  );
  text = text.replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text);
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function normalizeNote(note) {
  if (typeof note !== 'string' || !note) return '';
  return looksLikeHtml(note) ? htmlToPlainText(note) : note;
}

function normalizeReleaseNotes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeNote(item?.note || item?.notes || ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return normalizeNote(value);
}

function updateErrorMessage(error) {
  const message = String(error?.message || error || '未知错误');
  return message.replace(/\s+/g, ' ').trim();
}

function initialUpdateState(currentVersion, enabled) {
  return {
    enabled: Boolean(enabled),
    currentVersion: String(currentVersion || ''),
    phase: enabled ? 'idle' : 'unsupported',
    availableVersion: null,
    releaseName: '',
    releaseNotes: '',
    progress: null,
    message: enabled ? '等待检查更新' : '请使用安装版检查更新'
  };
}

class UpdateService extends EventEmitter {
  constructor({ updater, currentVersion, enabled = true, onState = () => {} }) {
    super();
    this.updater = updater;
    this.onState = onState;
    this.state = initialUpdateState(currentVersion, enabled && Boolean(updater));
    this.checkPromise = null;
    this.downloadPromise = null;

    if (this.state.enabled) {
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = true;
      this.updater.allowPrerelease = false;
      this.bindUpdaterEvents();
    }
  }

  snapshot() {
    return { ...this.state, progress: this.state.progress ? { ...this.state.progress } : null };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    this.onState(snapshot);
    this.emit('state', snapshot);
    return snapshot;
  }

  bindUpdaterEvents() {
    this.updater.on('checking-for-update', () => {
      this.setState({ phase: 'checking', message: '正在检查更新', progress: null });
    });
    this.updater.on('update-available', (info = {}) => {
      this.setState({
        phase: 'available',
        availableVersion: info.version || null,
        releaseName: info.releaseName || '',
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        progress: null,
        message: `发现新版本 ${info.version || ''}`.trim()
      });
    });
    this.updater.on('update-not-available', () => {
      this.setState({
        phase: 'not-available',
        availableVersion: null,
        releaseName: '',
        releaseNotes: '',
        progress: null,
        message: '当前已是最新版本'
      });
    });
    this.updater.on('download-progress', (progress = {}) => {
      this.setState({
        phase: 'downloading',
        progress: {
          percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
          transferred: Number(progress.transferred) || 0,
          total: Number(progress.total) || 0,
          bytesPerSecond: Number(progress.bytesPerSecond) || 0
        },
        message: '正在下载更新'
      });
    });
    this.updater.on('update-downloaded', (info = {}) => {
      this.setState({
        phase: 'downloaded',
        availableVersion: info.version || this.state.availableVersion,
        progress: { ...(this.state.progress || {}), percent: 100 },
        message: '更新已下载，可以重启安装'
      });
    });
    this.updater.on('error', (error) => {
      this.setState({ phase: 'error', message: updateErrorMessage(error), progress: null });
    });
  }

  async check() {
    if (!this.state.enabled) return { ok: false, error: this.state.message };
    if (this.checkPromise) return this.checkPromise;
    if (['downloading', 'downloaded'].includes(this.state.phase)) return { ok: true, state: this.snapshot() };

    this.checkPromise = this.updater.checkForUpdates()
      .then(() => ({ ok: true, state: this.snapshot() }))
      .catch((error) => {
        const message = updateErrorMessage(error);
        this.setState({ phase: 'error', message, progress: null });
        return { ok: false, error: message, state: this.snapshot() };
      })
      .finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async download() {
    if (!this.state.enabled) return { ok: false, error: this.state.message };
    if (this.downloadPromise) return this.downloadPromise;
    if (this.state.phase !== 'available') return { ok: false, error: '当前没有可下载的更新' };

    this.setState({ phase: 'downloading', message: '正在准备下载', progress: { percent: 0 } });
    this.downloadPromise = this.updater.downloadUpdate()
      .then(() => ({ ok: true, state: this.snapshot() }))
      .catch((error) => {
        const message = updateErrorMessage(error);
        this.setState({ phase: 'error', message, progress: null });
        return { ok: false, error: message, state: this.snapshot() };
      })
      .finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  install() {
    if (!this.state.enabled) return { ok: false, error: this.state.message };
    if (this.state.phase !== 'downloaded') return { ok: false, error: '更新尚未下载完成' };
    this.updater.quitAndInstall(false, true);
    return { ok: true };
  }
}

module.exports = {
  UpdateService,
  initialUpdateState,
  normalizeReleaseNotes,
  updateErrorMessage
};
