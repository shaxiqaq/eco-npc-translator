const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const pageMeta = {
  overview: ['总览', '游戏连接与实时运行状态'],
  damage: ['伤害统计', '技能、普攻、宠物与受到伤害明细'],
  translation: ['NPC 翻译', '游戏原生对话框实时翻译'],
  logs: ['运行日志', '采集器与翻译服务输出'],
  settings: ['设置', '翻译服务、悬浮窗与启动行为']
};

const providers = {
  deepseek: { model: 'deepseek-chat', url: 'https://api.deepseek.com' },
  openai: { model: 'gpt-4o-mini', url: '' },
  openrouter: { model: 'google/gemini-flash-1.5', url: 'https://openrouter.ai/api/v1' },
  gemini: { model: 'gemini-2.0-flash', url: '' },
  ollama: { model: 'qwen2.5:7b', url: 'http://127.0.0.1:11434' },
  deepl: { model: 'default', url: 'https://api-free.deepl.com/v2' }
};

let state = { services: {}, settings: {}, translation: {}, update: {}, logs: [] };
let snapshot = null;
let historyFilter = 'all';
let logFilter = 'all';
let activePage = 'overview';
let overviewHistoryVersion = null;
let damageHistoryRenderKey = null;
let overlayEditing = false;
let toastTimer = null;
let dismissedUpdateVersion = null;
let downloadedPromptVersion = null;
const captureKeys = ['skill', 'normal', 'pet', 'taken'];
const captureLabels = { skill: '技能造成', normal: '普通攻击造成', pet: '宠物造成', taken: '受到伤害' };

function createIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function showToast(message) {
  const toast = $('#toast');
  toast.querySelector('span').textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function navigate(page) {
  activePage = page;
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $$('.page').forEach((section) => section.classList.toggle('active', section.id === `page-${page}`));
  $('#page-title').textContent = pageMeta[page][0];
  $('#page-subtitle').textContent = pageMeta[page][1];
  if (page === 'overview') renderOverviewHistory();
  if (page === 'damage') renderDamageTable();
}

function serviceText(service) {
  const labels = {
    running: '运行中', starting: '启动中', stopping: '停止中', stopped: '已停止', error: '需要处理'
  };
  return labels[service?.state] || '已停止';
}

function renderServices() {
  for (const name of ['damage', 'translator']) {
    const service = state.services?.[name] || { state: 'stopped', message: '尚未启动' };
    const dot = $(`#${name}-dot`);
    dot.className = `status-dot ${service.state || 'stopped'}`;
    $(`#${name}-mini`).textContent = serviceText(service);
    $(`#${name}-service-label`).textContent = serviceText(service);
    $(`#${name}-service-message`).textContent = service.message || '尚未启动';
  }

  const damageRunning = ['running', 'starting'].includes(state.services?.damage?.state);
  const translatorRunning = ['running', 'starting'].includes(state.services?.translator?.state);
  buttonForService($('#toggle-damage'), damageRunning, true);
  buttonForService($('#toggle-translator'), translatorRunning, true);
  buttonForService($('#translation-toggle'), translatorRunning, false);

  $('#translation-heading').textContent = translatorRunning ? '翻译正在运行' : state.services?.translator?.state === 'error' ? '翻译启动失败' : '服务已停止';
  $('#translation-message').textContent = state.services?.translator?.message || '完成翻译设置后即可启动';

  renderGameProcessSelector();
  const connectedPid = state.services?.damage?.pid || state.services?.translator?.pid;
  const connected = Boolean(connectedPid);
  const selectedPid = Number(state.selectedGamePid) || null;
  const game = $('#game-state');
  game.classList.toggle('connected', connected);
  game.classList.toggle('ready', !connected && Boolean(selectedPid));
  game.innerHTML = `<i data-lucide="${connected ? 'circle-check' : selectedPid ? 'circle-dot' : 'circle-off'}"></i>${connected ? `已连接进程 ${connectedPid}${snapshot?.self_id ? ` · 角色 ${snapshot.self_id}` : ''}` : selectedPid ? `已选择进程 ${selectedPid}` : '未找到游戏'}`;
  createIcons();
}

function renderGameProcessSelector() {
  const select = $('#game-process-select');
  const processes = state.gameProcesses || [];
  const selectedPid = Number(state.selectedGamePid) || null;
  select.replaceChildren();

  if (!processes.length) {
    select.add(new Option('没有找到 eco.exe', ''));
  } else {
    processes.forEach((process) => {
      const title = process.title && process.title.toLowerCase() !== 'eco' ? ` · ${process.title}` : '';
      const started = process.started ? ` · ${process.started}` : '';
      select.add(new Option(`PID ${process.pid}${title}${started}`, String(process.pid)));
    });
    select.value = String(selectedPid || processes.at(-1).pid);
  }

  select.disabled = Boolean(state.processSelectionLocked) || !processes.length;
  select.title = state.processSelectionLocked ? '请先停止伤害采集和 NPC 翻译' : '选择要连接的游戏窗口';
}

function buttonForService(button, running, iconOnly) {
  if (!button) return;
  const icon = running ? 'square' : 'play';
  const label = running ? '停止' : '启动';
  if (iconOnly) {
    button.innerHTML = `<i data-lucide="${icon}"></i>`;
    button.title = label;
  } else {
    button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}翻译</span>`;
  }
}

function historyType(item) {
  if (item.side === 'pet_dealt') return { key: 'pet', text: item.skill_id == null ? '宠物普攻' : '宠物技能', cls: 'pet' };
  if (item.side === 'taken') return { key: 'taken', text: item.skill_id == null ? '受到普攻' : '受到技能', cls: 'taken' };
  if (item.skill_id == null) return { key: 'normal', text: '普通攻击', cls: '' };
  return { key: 'skill', text: '技能造成', cls: 'skill' };
}

function filteredHistory() {
  const items = [...(snapshot?.damage_history || [])].reverse();
  if (historyFilter === 'all') return items;
  return items.filter((item) => historyType(item).key === historyFilter);
}

function renderSnapshot() {
  const snap = snapshot || {};
  $('#battle-time').textContent = `战斗时间 ${formatDuration(snap.active)}`;
  $('#metric-skill').textContent = formatNumber(snap.skill_dealt);
  $('#metric-normal').textContent = formatNumber(snap.normal_dealt);
  $('#metric-pet').textContent = formatNumber(snap.pet_dealt);
  $('#metric-taken').textContent = formatNumber(snap.taken);
  $('#metric-skill-dps').textContent = formatNumber(snap.skill_dps, 2);
  $('#metric-normal-dps').textContent = formatNumber(snap.normal_dps, 2);
  $('#metric-pet-dps').textContent = formatNumber(snap.pet_dps, 2);
  $('#metric-tps').textContent = formatNumber(snap.tps, 2);

  $('#damage-total').textContent = formatNumber(snap.dealt);
  $('#damage-dps').textContent = formatNumber(snap.dps, 2);
  $('#damage-max-skill').textContent = formatNumber(snap.max_skill_dealt);
  $('#damage-max-normal').textContent = formatNumber(snap.max_normal_dealt);
  $('#damage-total-hits').textContent = `${formatNumber((snap.hits_skill_dealt || 0) + (snap.hits_normal_dealt || 0))} 次命中`;
  $('#damage-skill-hits').textContent = `${formatNumber(snap.hits_skill_dealt)} 次技能`;
  $('#damage-normal-hits').textContent = `${formatNumber(snap.hits_normal_dealt)} 次普攻`;

  if (activePage === 'overview') renderOverviewHistory();
  if (activePage === 'damage') renderDamageTable();
}

function renderOverviewHistory() {
  const version = Number(snapshot?.history_version || 0);
  if (overviewHistoryVersion === version) return;
  overviewHistoryVersion = version;
  const items = [...(snapshot?.damage_history || [])].reverse().slice(0, 5);
  const root = $('#overview-history');
  if (!items.length) {
    root.innerHTML = '<div class="empty-state">暂无战斗数据</div>';
    return;
  }
  root.innerHTML = items.map((item) => {
    const type = historyType(item);
    return `<div class="recent-row"><time>${escapeHtml(item.time || '--:--:--')}</time><span class="type-badge ${type.cls}">${type.text}</span><span class="route">${escapeHtml(item.source)} → ${escapeHtml(item.target)} · ${escapeHtml(item.skill)}</span><strong>${formatNumber(item.damage)}</strong></div>`;
  }).join('');
}

function renderDamageTable() {
  const renderKey = `${historyFilter}:${Number(snapshot?.history_version || 0)}`;
  if (damageHistoryRenderKey === renderKey) return;
  damageHistoryRenderKey = renderKey;
  const items = filteredHistory();
  const labels = { all: '全部伤害流水', skill: '技能造成流水', normal: '普通攻击造成流水', pet: '宠物造成流水', taken: '受到伤害流水' };
  $('#history-title').textContent = labels[historyFilter];
  $('#history-count').textContent = `${items.length} 条`;
  const root = $('#damage-table');
  if (!items.length) {
    root.innerHTML = '<tr><td colspan="6"><div class="empty-state">暂无对应伤害数据</div></td></tr>';
    return;
  }
  root.innerHTML = items.slice(0, 500).map((item) => {
    const type = historyType(item);
    return `<tr><td>${escapeHtml(item.time || '')}</td><td><span class="type-badge ${type.cls}">${type.text}</span></td><td title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</td><td title="${escapeHtml(item.target)}">${escapeHtml(item.target)}</td><td>${escapeHtml(item.skill)}</td><td class="number">${formatNumber(item.damage)}</td></tr>`;
  }).join('');
}

function renderLogs() {
  const all = state.logs || [];
  const recent = all.slice(-5).reverse();
  $('#overview-logs').innerHTML = recent.length ? recent.map((entry) => `<div class="activity-row"><i class="${escapeHtml(entry.level)}"></i><div><strong>${entry.service === 'damage' ? '伤害采集' : 'NPC 翻译'}</strong><span>${escapeHtml(entry.message)}</span></div><time>${escapeHtml(entry.time)}</time></div>`).join('') : '<div class="empty-state">等待服务启动</div>';

  const translation = all.filter((entry) => entry.service === 'translator').slice(-80).reverse();
  $('#translation-log').innerHTML = translation.length ? translation.map((entry) => `<div class="log-line"><time>${escapeHtml(entry.time)}</time>${escapeHtml(entry.message)}</div>`).join('') : '<div class="empty-state">尚无翻译日志</div>';

  const filtered = logFilter === 'all' ? all : all.filter((entry) => entry.service === logFilter);
  $('#log-console').innerHTML = filtered.length ? filtered.slice(-500).map((entry) => `<div class="console-line ${escapeHtml(entry.level)}"><time>${escapeHtml(entry.time)}</time><b>${entry.service === 'damage' ? '伤害采集' : 'NPC 翻译'}</b><span>${escapeHtml(entry.message)}</span></div>`).join('') : '<div class="empty-state">暂无运行日志</div>';
  $('#log-console').scrollTop = $('#log-console').scrollHeight;
}

function updateStatusMeta(phase) {
  return {
    idle: ['等待检查更新', '可随时手动检查', 'refresh-cw'],
    checking: ['正在检查更新', '正在连接 GitHub Releases', 'loader-circle'],
    available: ['发现新版本', '点击下载后才会开始传输', 'sparkles'],
    downloading: ['正在下载更新', '程序可以继续使用', 'download'],
    downloaded: ['更新已下载', '重启程序完成安装', 'circle-check'],
    'not-available': ['当前已是最新版本', '没有可用更新', 'circle-check'],
    error: ['检查更新失败', '请检查网络后重试', 'circle-alert'],
    unsupported: ['开发模式不检查更新', '请使用正式安装版', 'info']
  }[phase] || ['等待检查更新', '-', 'refresh-cw'];
}

function showUpdateDialog(update) {
  const dialog = $('#update-dialog');
  const downloaded = update.phase === 'downloaded';
  $('#update-dialog-title').textContent = downloaded ? '更新已准备完成' : '发现新版本';
  $('#update-dialog-version').textContent = `当前 ${update.currentVersion || '-'}  →  新版 ${update.availableVersion || '-'}`;
  $('#update-dialog-notes').textContent = update.releaseNotes || '本次更新说明请查看 GitHub Release。';
  const action = $('#update-dialog-action');
  action.disabled = update.phase === 'downloading';
  action.innerHTML = downloaded
    ? '<i data-lucide="rotate-ccw"></i><span>重启并安装</span>'
    : update.phase === 'downloading'
      ? '<i data-lucide="loader-circle"></i><span>正在下载</span>'
      : '<i data-lucide="download"></i><span>下载更新</span>';
  if (!dialog.open) dialog.showModal();
  createIcons();
}

function renderUpdate(update = state.update || {}, announce = false) {
  state.update = update;
  const phase = update.phase || 'idle';
  const [title, fallbackMessage, icon] = updateStatusMeta(phase);
  $('#update-current-version').textContent = update.currentVersion || '-';
  $('#update-status-title').textContent = phase === 'available' && update.availableVersion
    ? `发现版本 ${update.availableVersion}`
    : title;
  $('#update-status-message').textContent = update.message || fallbackMessage;
  $('.update-status-icon').innerHTML = `<i data-lucide="${icon}"></i>`;
  $('.update-status-icon').classList.toggle('spinning', phase === 'checking');

  const checking = phase === 'checking';
  const downloading = phase === 'downloading';
  $('#check-updates').disabled = checking || downloading || phase === 'downloaded' || !update.enabled;
  $('#download-update').hidden = phase !== 'available';
  $('#download-update').disabled = downloading;
  $('#install-update').hidden = phase !== 'downloaded';

  const progress = update.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const hasProgress = downloading || phase === 'downloaded';
  $('#update-progress').hidden = !hasProgress;
  $('#update-progress-percent').textContent = `${percent.toFixed(0)}%`;
  $('#update-progress-bar').value = percent;
  $('#update-progress-label').textContent = progress.total
    ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`
    : phase === 'downloaded' ? '下载完成' : '正在连接下载服务器';
  $('#update-dialog-progress').hidden = !hasProgress;
  $('#update-dialog-percent').textContent = `${percent.toFixed(0)}%`;
  $('#update-dialog-progress-bar').value = percent;

  const notes = update.releaseNotes || '';
  $('#update-notes').hidden = !notes;
  $('#update-notes-content').textContent = notes;

  if (announce && phase === 'available' && update.availableVersion !== dismissedUpdateVersion) {
    showUpdateDialog(update);
  }
  if (phase === 'downloaded' && update.availableVersion !== downloadedPromptVersion) {
    downloadedPromptVersion = update.availableVersion;
    showUpdateDialog(update);
  }
  if ($('#update-dialog').open && ['available', 'downloading', 'downloaded'].includes(phase)) {
    showUpdateDialog(update);
  }
  createIcons();
}

function applySettingsToForm() {
  const translation = state.translation || {};
  $('#setting-provider').value = translation.provider || 'deepseek';
  $('#setting-model').value = translation.model || '';
  $('#setting-base-url').value = translation.base_url || '';
  $('#setting-api-key').value = translation.api_key || '';
  $('#setting-target-lang').value = translation.target_lang || 'zh-CN';
  $('#setting-first-wait').value = translation.first_wait ?? 0;
  $('#setting-player-names').value = (translation.player_names || []).join(', ');
  $('#setting-toggle-hotkey').value = translation.toggle_hotkey || '';
  $('#setting-skip-hotkey').value = translation.skip_hotkey || '';
  $('#setting-sync-enabled').checked = Boolean(translation.sync_enabled);
  $('#setting-sync-url').value = translation.sync_url || '';
  $('#setting-sync-token').value = translation.sync_token || '';
  $('#summary-provider').textContent = translation.provider || '未配置';
  $('#summary-model').textContent = translation.model || '-';
  $('#summary-language').textContent = translation.target_lang === 'zh-TW' ? '繁体中文' : '简体中文';
  $('#summary-wait').textContent = `${translation.first_wait || 0} 秒`;
  $('#summary-sync').textContent = translation.sync_enabled ? '开启' : '关闭';

  const settings = state.settings || {};
  const capture = settings.capture || {};
  applyCaptureSettings(capture);
  const overlay = settings.overlay || {};
  const startup = settings.startup || {};
  $('#setting-overlay-visible').checked = overlay.visible !== false;
  $('#overview-overlay-toggle').checked = overlay.visible !== false;
  $('#overlay-service-label').textContent = overlay.visible !== false ? '已显示' : '已隐藏';
  $('#setting-overlay-scale').value = overlay.scale || 1;
  $('#setting-overlay-opacity').value = overlay.opacity ?? 0.95;
  $('#setting-overlay-details').checked = overlay.showDetails !== false;
  $('#scale-value').textContent = `${Math.round((overlay.scale || 1) * 100)}%`;
  $('#opacity-value').textContent = `${Math.round((overlay.opacity ?? 0.95) * 100)}%`;
  $('#setting-start-damage').checked = Boolean(startup.damage);
  $('#setting-start-translator').checked = Boolean(startup.translator);
  $('#setting-start-overlay').checked = startup.overlay !== false;
  $('#setting-check-updates').checked = settings.updates?.checkOnStartup !== false;
}

function applyCaptureSettings(capture = {}) {
  captureKeys.forEach((key) => {
    const enabled = capture[key] !== false;
    $$(`[data-capture-key="${key}"]`).forEach((input) => {
      input.checked = enabled;
      input.closest('.metric')?.classList.toggle('capture-disabled', !enabled);
    });
  });
}

async function saveCaptureSetting(key, enabled) {
  const capture = {
    ...Object.fromEntries(captureKeys.map((item) => [item, state.settings?.capture?.[item] !== false])),
    [key]: enabled
  };
  applyCaptureSettings(capture);
  const result = await window.eco.saveAppSettings({ capture });
  state.settings = result.settings;
  applyCaptureSettings(result.settings?.capture);
  showToast(`${captureLabels[key]}采集已${enabled ? '开启' : '关闭'}`);
}

async function toggleService(name) {
  const running = ['running', 'starting'].includes(state.services?.[name]?.state);
  const result = running ? await window.eco.stopService(name) : await window.eco.startService(name);
  if (!result.ok && result.error) showToast(result.error);
}

async function setOverlayEditing() {
  overlayEditing = !overlayEditing;
  await window.eco.setOverlayEditing(overlayEditing);
  const labels = [$('#edit-overlay'), $('#settings-edit-overlay')];
  labels.forEach((button) => {
    if (!button) return;
    button.innerHTML = `<i data-lucide="${overlayEditing ? 'check' : 'move'}"></i>${overlayEditing ? '完成调整' : '调整悬浮窗'}`;
  });
  createIcons();
  showToast(overlayEditing ? '现在可以拖动悬浮窗' : '悬浮窗位置已保存');
}

async function checkForUpdates() {
  dismissedUpdateVersion = null;
  const result = await window.eco.checkForUpdates();
  if (!result.ok && result.error) showToast(result.error);
}

async function downloadUpdate() {
  const result = await window.eco.downloadUpdate();
  if (!result.ok && result.error) showToast(result.error);
}

async function installUpdate() {
  const result = await window.eco.installUpdate();
  if (!result.ok && result.error) showToast(result.error);
}

function bindEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#toggle-damage').addEventListener('click', () => toggleService('damage'));
  $('#toggle-translator').addEventListener('click', () => toggleService('translator'));
  $('#translation-toggle').addEventListener('click', () => toggleService('translator'));
  $('#refresh-game-processes').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.classList.add('refreshing');
    button.disabled = true;
    const result = await window.eco.refreshGameProcesses();
    state = { ...state, ...(await window.eco.getState()) };
    renderServices();
    button.classList.remove('refreshing');
    button.disabled = false;
    showToast(result.ok ? `找到 ${result.processes.length} 个游戏进程` : result.error);
  });
  $('#game-process-select').addEventListener('change', async (event) => {
    const result = await window.eco.selectGameProcess(Number(event.target.value));
    state = { ...state, ...(await window.eco.getState()) };
    renderServices();
    showToast(result.ok ? `已选择游戏进程 ${result.selectedPid}` : result.error);
  });
  $('#start-all').addEventListener('click', async () => {
    const results = await Promise.all([window.eco.startService('damage'), window.eco.startService('translator')]);
    const failed = results.find((result) => !result.ok);
    if (failed?.error) showToast(failed.error);
  });
  $('#stop-all').addEventListener('click', async () => {
    await Promise.all([window.eco.stopService('damage'), window.eco.stopService('translator')]);
  });
  $('#overview-reset').addEventListener('click', async () => { await window.eco.resetDamage(); showToast('伤害统计已清空'); });
  $('#damage-reset').addEventListener('click', async () => { await window.eco.resetDamage(); showToast('伤害统计已清空'); });
  $('#edit-overlay').addEventListener('click', setOverlayEditing);
  $('#settings-edit-overlay').addEventListener('click', setOverlayEditing);
  $('#open-logs').addEventListener('click', () => window.eco.openLogs());
  $('#check-updates').addEventListener('click', checkForUpdates);
  $('#download-update').addEventListener('click', downloadUpdate);
  $('#install-update').addEventListener('click', installUpdate);
  $('#setting-check-updates').addEventListener('change', async (event) => {
    const result = await window.eco.saveAppSettings({ updates: { checkOnStartup: event.target.checked } });
    state.settings = result.settings;
    showToast(`启动检查更新已${event.target.checked ? '开启' : '关闭'}`);
  });
  $('#update-dialog-close').addEventListener('click', () => {
    dismissedUpdateVersion = state.update?.availableVersion || null;
    $('#update-dialog').close();
  });
  $('#update-dialog-later').addEventListener('click', () => {
    dismissedUpdateVersion = state.update?.availableVersion || null;
    $('#update-dialog').close();
  });
  $('#update-dialog-action').addEventListener('click', () => {
    if (state.update?.phase === 'downloaded') installUpdate();
    else if (state.update?.phase === 'available') downloadUpdate();
  });

  $('#overview-overlay-toggle').addEventListener('change', async (event) => {
    await window.eco.setOverlayVisible(event.target.checked);
    $('#setting-overlay-visible').checked = event.target.checked;
    $('#overlay-service-label').textContent = event.target.checked ? '已显示' : '已隐藏';
  });

  $$('[data-capture-key]').forEach((input) => {
    input.addEventListener('change', (event) => {
      saveCaptureSetting(event.target.dataset.captureKey, event.target.checked);
    });
  });

  $$('#damage-filter button').forEach((button) => button.addEventListener('click', () => {
    historyFilter = button.dataset.filter;
    $$('#damage-filter button').forEach((item) => item.classList.toggle('active', item === button));
    renderDamageTable();
  }));
  $$('[data-log-filter]').forEach((button) => button.addEventListener('click', () => {
    logFilter = button.dataset.logFilter;
    $$('[data-log-filter]').forEach((item) => item.classList.toggle('active', item === button));
    renderLogs();
  }));
  $$('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.settingsTab;
    $$('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === button));
    $$('.settings-pane').forEach((pane) => pane.classList.toggle('active', pane.id === `settings-${tab}`));
  }));

  $('#setting-provider').addEventListener('change', (event) => {
    const preset = providers[event.target.value];
    if (!preset) return;
    $('#setting-model').value = preset.model;
    $('#setting-base-url').value = preset.url;
  });
  $('#show-api-key').addEventListener('click', () => {
    const input = $('#setting-api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('#show-api-key').innerHTML = `<i data-lucide="${input.type === 'password' ? 'eye' : 'eye-off'}"></i>`;
    createIcons();
  });
  $('#setting-overlay-scale').addEventListener('input', (event) => { $('#scale-value').textContent = `${Math.round(event.target.value * 100)}%`; });
  $('#setting-overlay-opacity').addEventListener('input', (event) => { $('#opacity-value').textContent = `${Math.round(event.target.value * 100)}%`; });

  $('#settings-translation').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      provider: $('#setting-provider').value,
      model: $('#setting-model').value.trim(),
      base_url: $('#setting-base-url').value.trim(),
      api_key: $('#setting-api-key').value.trim(),
      target_lang: $('#setting-target-lang').value,
      first_wait: Number($('#setting-first-wait').value || 0),
      player_names: $('#setting-player-names').value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
      toggle_hotkey: $('#setting-toggle-hotkey').value.trim(),
      skip_hotkey: $('#setting-skip-hotkey').value.trim(),
      sync_enabled: $('#setting-sync-enabled').checked,
      sync_url: $('#setting-sync-url').value.trim(),
      sync_token: $('#setting-sync-token').value.trim()
    };
    await window.eco.saveTranslationSettings(payload);
    state.translation = payload;
    applySettingsToForm();
    $('#translation-save-status').textContent = '已保存';
    showToast('翻译设置已保存');
  });

  $('#settings-overlay').addEventListener('submit', async (event) => {
    event.preventDefault();
    const overlay = {
      visible: $('#setting-overlay-visible').checked,
      scale: Number($('#setting-overlay-scale').value),
      opacity: Number($('#setting-overlay-opacity').value),
      showDetails: $('#setting-overlay-details').checked
    };
    const result = await window.eco.saveAppSettings({ overlay });
    state.settings = result.settings;
    await window.eco.setOverlayVisible(overlay.visible);
    $('#overview-overlay-toggle').checked = overlay.visible;
    $('#overlay-save-status').textContent = '已保存';
    showToast('悬浮窗设置已保存');
  });

  $('#settings-startup').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await window.eco.saveAppSettings({ startup: {
      damage: $('#setting-start-damage').checked,
      translator: $('#setting-start-translator').checked,
      overlay: $('#setting-start-overlay').checked
    }});
    state.settings = result.settings;
    $('#startup-save-status').textContent = '已保存';
    showToast('启动设置已保存');
  });
}

async function init() {
  createIcons();
  bindEvents();
  state = await window.eco.getState();
  snapshot = state.snapshot;
  applySettingsToForm();
  renderServices();
  renderSnapshot();
  renderLogs();
  renderUpdate(state.update);

  window.eco.onState((next) => {
    state = { ...state, ...next };
    if (next.snapshot) snapshot = next.snapshot;
    applySettingsToForm();
    renderServices();
    renderLogs();
  });
  window.eco.onSnapshot((next) => {
    snapshot = next;
    renderSnapshot();
  });
  window.eco.onLog((entry) => {
    state.logs = [...(state.logs || []), entry].slice(-1000);
    renderLogs();
  });
  window.eco.onUpdate((update) => renderUpdate(update, true));
}

init();
