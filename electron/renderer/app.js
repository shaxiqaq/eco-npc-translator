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

let state = { services: {}, settings: {}, translation: {}, logs: [] };
let snapshot = null;
let historyFilter = 'all';
let logFilter = 'all';
let overlayEditing = false;
let toastTimer = null;

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
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $$('.page').forEach((section) => section.classList.toggle('active', section.id === `page-${page}`));
  $('#page-title').textContent = pageMeta[page][0];
  $('#page-subtitle').textContent = pageMeta[page][1];
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

  const connected = Boolean(snapshot?.self_id || state.services?.damage?.pid);
  const game = $('#game-state');
  game.classList.toggle('connected', connected);
  game.innerHTML = `<i data-lucide="${connected ? 'circle-check' : 'circle-off'}"></i>${connected ? `已连接 eco.exe${snapshot?.self_id ? ` · 角色 ${snapshot.self_id}` : ''}` : '未连接游戏'}`;
  createIcons();
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

  renderOverviewHistory();
  renderDamageTable();
  renderServices();
}

function renderOverviewHistory() {
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
}

async function toggleService(name) {
  const running = ['running', 'starting'].includes(state.services?.[name]?.state);
  if (running) await window.eco.stopService(name); else await window.eco.startService(name);
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

function bindEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.page)));
  $$('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#toggle-damage').addEventListener('click', () => toggleService('damage'));
  $('#toggle-translator').addEventListener('click', () => toggleService('translator'));
  $('#translation-toggle').addEventListener('click', () => toggleService('translator'));
  $('#start-all').addEventListener('click', async () => {
    await Promise.all([window.eco.startService('damage'), window.eco.startService('translator')]);
  });
  $('#stop-all').addEventListener('click', async () => {
    await Promise.all([window.eco.stopService('damage'), window.eco.stopService('translator')]);
  });
  $('#overview-reset').addEventListener('click', async () => { await window.eco.resetDamage(); showToast('伤害统计已清空'); });
  $('#damage-reset').addEventListener('click', async () => { await window.eco.resetDamage(); showToast('伤害统计已清空'); });
  $('#edit-overlay').addEventListener('click', setOverlayEditing);
  $('#settings-edit-overlay').addEventListener('click', setOverlayEditing);
  $('#open-logs').addEventListener('click', () => window.eco.openLogs());

  $('#overview-overlay-toggle').addEventListener('change', async (event) => {
    await window.eco.setOverlayVisible(event.target.checked);
    $('#setting-overlay-visible').checked = event.target.checked;
    $('#overlay-service-label').textContent = event.target.checked ? '已显示' : '已隐藏';
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
}

init();
