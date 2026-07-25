const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const pageMeta = {
  overview: ['总览', '游戏连接与实时运行状态'],
  damage: ['伤害统计', '技能、普攻、宠物与受到伤害明细'],
  buffs: ['状态监控', '自己角色的增益、减益与异常状态'],
  translation: ['NPC 翻译', '游戏原生对话框实时翻译'],
  xiaoya: ['小雅助手', 'F1–F6 技能按键与延迟配置'],
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
let logRenderKey = null;
let logRenderPending = false;
let overlayEditing = false;
let toastTimer = null;
let dismissedUpdateVersion = null;
let downloadedPromptVersion = null;
let iconProcessPid = null;
let xiaoyaSkills = null;
const skillIconCache = new Map();
const captureKeys = ['skill', 'normal', 'pet', 'taken'];
const captureLabels = { skill: '技能造成', normal: '普通攻击造成', pet: '宠物造成', taken: '受到伤害' };

function createIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function syncIconProcess() {
  const pid = Number(state.selectedGamePid) || null;
  if (pid === iconProcessPid) return;
  iconProcessPid = pid;
  skillIconCache.clear();
}

function skillIconMarkup(skillId, fallback = 'sparkles', expiring = false) {
  const normalized = Number(skillId);
  const attribute = Number.isInteger(normalized) && normalized > 0
    ? ` data-skill-icon="${normalized}"`
    : '';
  return `<span class="skill-icon${expiring ? ' expiring' : ''}"${attribute}><i data-lucide="${fallback}"></i></span>`;
}

function skillNameMarkup(skillId, statusKey = '') {
  const normalized = Number(skillId);
  if (Number.isInteger(normalized) && normalized > 0) {
    return `<span data-skill-name="${normalized}">技能#${normalized}</span>`;
  }
  return `<span>状态 ${escapeHtml(statusKey || '未知')}</span>`;
}

function isPlaceholderName(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (value.startsWith('未命名') || value.startsWith('未确认')) return true;
  if (/^状态\s/i.test(value)) return true;
  if (/^技能#\d+$/.test(value)) return true;
  return false;
}

function isLocalizedChineseName(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return /[\u4e00-\u9fff]/.test(value);
}

/** Prefer game-internal labels (source_name / client skill name), not localized Chinese. */
function pickGameFacingName(item = {}) {
  const skillId = Number(item.skill_id);
  const hasSkill = Number.isInteger(skillId) && skillId > 0;
  const name = String(item.name || item.skill || '').trim();
  const source = String(item.source_name || '').trim();
  const key = String(item.key || '').trim();
  if (source && !isPlaceholderName(source)) return source;
  if (name && !isPlaceholderName(name) && !isLocalizedChineseName(name)) return name;
  if (hasSkill) return `技能#${skillId}`;
  if (name && !isPlaceholderName(name)) return name;
  return key ? `状态 ${key}` : '未知状态';
}

function buffLabelMarkup(item = {}) {
  const skillId = Number(item.skill_id);
  const hasSkill = Number.isInteger(skillId) && skillId > 0;
  const mainText = pickGameFacingName(item);
  const source = String(item.source_name || '').trim();
  const name = String(item.name || '').trim();
  const key = String(item.key || '').trim();
  const title = [mainText, source !== mainText ? source : '', name !== mainText ? name : '', hasSkill ? `#${skillId}` : '', key]
    .filter(Boolean)
    .join(' · ');
  const keepName = source && source === mainText && !isLocalizedChineseName(source) ? '1' : '0';
  const nameAttr = hasSkill
    ? ` data-skill-name="${skillId}" data-keep-name="${keepName}"`
    : '';
  return `<span class="status-main"${nameAttr} title="${escapeHtml(title)}">${escapeHtml(mainText)}</span>`;
}

function hydrateSkillIcons(root = document) {
  const skillIds = new Set(
    [...root.querySelectorAll('[data-skill-icon], [data-skill-name]')]
      .map((element) => Number(element.dataset.skillIcon || element.dataset.skillName))
      .filter((skillId) => Number.isInteger(skillId) && skillId > 0)
  );
  skillIds.forEach((skillId) => {
    if (!skillIconCache.has(skillId)) skillIconCache.set(skillId, window.eco.getSkillIcon(skillId));
    skillIconCache.get(skillId).then((result) => {
      root.querySelectorAll(`.skill-icon[data-skill-icon="${skillId}"]`).forEach((element) => {
        if (!element.isConnected) return;
        if (!result?.ok || !result.dataUrl) {
          element.dataset.iconState = 'fallback';
          return;
        }
        element.innerHTML = `<img src="${result.dataUrl}" alt="" draggable="false">`;
        element.dataset.iconState = 'loaded';
      });
      if (!result?.ok || !result.name) return;
      const gameName = String(result.name).trim();
      if (!gameName) return;
      root.querySelectorAll(`[data-skill-name="${skillId}"]`).forEach((element) => {
        if (!element.isConnected) return;
        if (element.dataset.keepName === '1') return;
        element.textContent = gameName;
        element.title = gameName;
      });
    }).catch(() => {
      root.querySelectorAll(`.skill-icon[data-skill-icon="${skillId}"]`).forEach((element) => {
        element.dataset.iconState = 'fallback';
      });
    });
  });
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
  if (page === 'damage') {
    renderDamageTable();
    renderSkillCasts();
  }
  if (page === 'buffs') {
    renderBuffs();
    renderCustomBuffConfig();
  }
  if (page === 'xiaoya') renderXiaoya();
  if (page === 'settings') renderCustomBuffConfig();
  if (page === 'overview' || page === 'logs' || page === 'translation') {
    scheduleRenderLogs(true);
  }
}

function applyXiaoyaSkills(skills) {
  if (!Array.isArray(skills)) return;
  xiaoyaSkills = skills;
  $$('.xiaoya-skill-row').forEach((row) => {
    const skill = skills[Number(row.dataset.skillIndex)] || {};
    row.querySelector('[data-field="enabled"]').checked = Boolean(skill.enabled);
    row.querySelector('[data-field="skillTime"]').value = Number(skill.skillTime || 0);
    row.querySelector('[data-field="mouse"]').checked = Boolean(skill.mouse);
    row.querySelector('[data-field="delay"]').value = Number(skill.delay || 0);
  });
}

function readXiaoyaSkills() {
  return $$('.xiaoya-skill-row').map((row) => ({
    enabled: row.querySelector('[data-field="enabled"]').checked,
    skillTime: Number(row.querySelector('[data-field="skillTime"]').value || 0),
    mouse: row.querySelector('[data-field="mouse"]').checked,
    delay: Number(row.querySelector('[data-field="delay"]').value || 0)
  }));
}

function renderXiaoya() {
  const service = state.xiaoya || {};
  const active = ['starting', 'running', 'stopping'].includes(service.state);
  const running = service.state === 'running';
  const status = $('#xiaoya-state');
  status.className = `xiaoya-state ${service.state || 'stopped'}`;
  status.innerHTML = `<i data-lucide="${running ? 'circle-check' : service.state === 'error' ? 'triangle-alert' : active ? 'loader-circle' : 'circle-off'}"></i>${service.state === 'starting' ? '启动中' : service.state === 'stopping' ? '停止中' : running ? `运行中${service.pid ? ` · PID ${service.pid}` : ''}` : service.state === 'error' ? '启动失败' : '已停止'}`;
  $('#xiaoya-message').textContent = service.message || (service.available ? '尚未启动' : '未找到 XiaoyaCore.exe');
  const toggle = $('#xiaoya-toggle');
  toggle.disabled = service.state === 'stopping' || !service.available;
  toggle.innerHTML = `<i data-lucide="${active ? 'square' : 'play'}"></i><span>${active ? '停止小雅' : '启动小雅'}</span>`;
  createIcons();
}

async function saveXiaoyaConfig(showSuccess = true) {
  const result = await window.eco.saveXiaoyaConfig(readXiaoyaSkills());
  if (!result.ok) {
    showToast(result.error || '保存小雅配置失败');
    return false;
  }
  applyXiaoyaSkills(result.skills);
  if (showSuccess) showToast('小雅配置已保存');
  return true;
}

async function reloadXiaoyaConfig() {
  const result = await window.eco.getXiaoyaConfig();
  if (!result.ok) {
    showToast(result.error || '读取上次设置失败');
    return;
  }
  applyXiaoyaSkills(result.skills);
  showToast('已读取上次设置');
}

async function toggleXiaoya() {
  const active = ['starting', 'running', 'stopping'].includes(state.xiaoya?.state);
  if (!active && !(await saveXiaoyaConfig(false))) return;
  const result = active ? await window.eco.stopXiaoya() : await window.eco.startXiaoya();
  if (!result.ok) showToast(result.error || '操作小雅失败');
  if (result.state) {
    state.xiaoya = result.state;
    renderXiaoya();
  }
}

async function toggleXiaoyaSs() {
  const result = await window.eco.toggleXiaoyaSs();
  if (!result.ok) {
    showToast(result.error || 'SS 模式切换失败');
    return;
  }
  showToast('SS 模式切换已发送');
}

async function toggleXiaoyaVisibility() {
  const result = await window.eco.toggleXiaoyaVisibility();
  if (!result.ok) {
    showToast(result.error || '无法显示或隐藏 ECO 窗口');
    return;
  }
  showToast(result.visible ? 'ECO 窗口已显示' : 'ECO 窗口已隐藏');
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
    if (dot) {
      dot.className = `status-dot ${service.state || 'stopped'}`;
      $(`#${name}-mini`).textContent = serviceText(service);
    }
    $(`#${name}-service-label`).textContent = serviceText(service);
    $(`#${name}-service-message`).textContent = service.message || '尚未启动';
  }

  const monitoring = state.services?.monitoring || { state: 'stopped', message: '已关闭' };
  if ($('#monitoring-service-label')) {
    $('#monitoring-service-label').textContent = serviceText(monitoring);
  }
  if ($('#monitoring-service-message')) {
    $('#monitoring-service-message').textContent = monitoring.message || '可独立于伤害采集运行';
  }
  if ($('#monitoring-dot')) {
    $('#monitoring-dot').className = `status-dot ${monitoring.state || 'stopped'}`;
  }
  if ($('#monitoring-mini')) {
    $('#monitoring-mini').textContent = serviceText(monitoring);
  }
  const monitoringOn = state.settings?.overlay?.monitoring !== false;
  if ($('#overview-monitoring-toggle')) $('#overview-monitoring-toggle').checked = monitoringOn;

  const damageRunning = ['running', 'starting'].includes(state.services?.damage?.state);
  const translatorRunning = ['running', 'starting'].includes(state.services?.translator?.state);
  buttonForService($('#toggle-damage'), damageRunning, true);
  buttonForService($('#toggle-translator'), translatorRunning, true);
  buttonForService($('#translation-toggle'), translatorRunning, false);

  $('#translation-heading').textContent = translatorRunning ? '翻译正在运行' : state.services?.translator?.state === 'error' ? '翻译启动失败' : '服务已停止';
  $('#translation-message').textContent = state.services?.translator?.message || '完成翻译设置后即可启动';

  renderGameProcessSelector();
  const connectedPid = state.services?.damage?.pid
    || state.services?.monitoring?.pid
    || state.services?.translator?.pid;
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
  if ($('#damage-skill-casts')) {
    $('#damage-skill-casts').textContent = formatNumber(snap.skill_cast_total);
  }
  $('#damage-total-hits').textContent = `${formatNumber((snap.hits_skill_dealt || 0) + (snap.hits_normal_dealt || 0))} 次命中`;
  $('#damage-skill-hits').textContent = `${formatNumber(snap.hits_skill_dealt)} 次技能`;

  if (activePage === 'overview') renderOverviewHistory();
  if (activePage === 'damage') {
    renderDamageTable();
    renderSkillCasts();
  }
  if (activePage === 'buffs') renderBuffs();
}

function skillCastRoleLabel(role) {
  return { defensive: '防御', self: '自身', combat: '战斗' }[role] || '技能';
}

function renderSkillCasts() {
  const snap = snapshot || {};
  const casts = snap.skill_casts || [];
  const history = snap.skill_cast_history || [];
  const list = $('#skill-cast-list');
  const hist = $('#skill-cast-history');
  if ($('#skill-cast-count')) $('#skill-cast-count').textContent = `${casts.length} 种`;
  if ($('#skill-cast-history-count')) $('#skill-cast-history-count').textContent = `${history.length} 条`;
  if (list) {
    list.innerHTML = casts.length
      ? casts.map((item) => {
        const role = item.role || 'combat';
        return `<div class="skill-cast-row">${skillIconMarkup(item.skill_id, role === 'defensive' ? 'shield' : 'sparkles')}<strong>${skillNameMarkup(item.skill_id)} <span class="role-badge ${role}">${skillCastRoleLabel(role)}</span></strong><b>×${formatNumber(item.count)}</b></div>`;
      }).join('')
      : '<div class="empty-state">释放技能后显示在这里（含 パリイ 等防御技）</div>';
    createIcons();
    hydrateSkillIcons(list);
    // Prefer backend skill labels immediately (パリイ etc.)
    casts.forEach((item) => {
      if (!item.skill || !item.skill_id) return;
      list.querySelectorAll(`[data-skill-name="${item.skill_id}"]`).forEach((el) => {
        el.textContent = item.skill;
      });
    });
  }
  if (hist) {
    hist.innerHTML = history.length
      ? history.map((item) => {
        const role = item.role || 'combat';
        return `<div class="skill-cast-history-row"><time>${escapeHtml(item.time || '')}</time>${skillIconMarkup(item.skill_id, role === 'defensive' ? 'shield' : 'sparkles')}<strong>${escapeHtml(item.skill || `技能#${item.skill_id}`)} <span class="role-badge ${role}">${skillCastRoleLabel(role)}</span></strong><b>${escapeHtml(item.target_label || '')}</b></div>`;
      }).join('')
      : '<div class="empty-state">暂无释放记录</div>';
    createIcons();
    hydrateSkillIcons(hist);
  }
}

const buffCategories = {
  positive: { label: '增益', cls: 'positive' },
  negative: { label: '减益', cls: 'negative' },
  abnormal: { label: '异常', cls: 'abnormal' },
  cooldown: { label: '技能CD', cls: 'cooldown' },
  skill_duration: { label: '持续', cls: 'skill-duration' }
};

function buffCategory(item) {
  return buffCategories[item?.category] || { label: '状态', cls: 'unknown' };
}

function buffTime(item) {
  const now = Date.now() / 1000;
  if (item?.expires_at != null && Number.isFinite(Number(item.expires_at))) {
    const remaining = Math.max(0, Number(item.expires_at) - now);
    if (item?.category === 'cooldown') {
      return remaining > 0 ? `CD 剩余 ${formatDuration(remaining)}` : '技能可用';
    }
    if (item?.category === 'skill_duration') {
      return remaining > 0 ? `持续剩余 ${formatDuration(remaining)}` : '效果结束';
    }
    return remaining > 0 ? `预计剩余 ${formatDuration(remaining)}` : '等待状态移除';
  }
  const elapsed = Math.max(0, now - Number(item?.started_at || now));
  return `已持续 ${formatDuration(elapsed)}`;
}

function buffTimingSource(item) {
  if (item?.category === 'cooldown') return '自定义技能 CD';
  if (item?.category === 'skill_duration') return '自定义技能持续';
  if (item?.timing === 'custom') return '自定义持续时间';
  if (item?.timing === 'estimated_observed') return '实测预计';
  if (item?.timing === 'estimated_learned') return '本次运行学习';
  return '持续时间未知';
}

function filterActiveTimers(list = [], category) {
  const now = Date.now() / 1000;
  return [...list]
    .filter((item) => {
      const remaining = Number(item?.remaining);
      const expiresAt = Number(item?.expires_at);
      if (Number.isFinite(remaining)) return remaining > 0;
      if (Number.isFinite(expiresAt)) return expiresAt > now;
      return false;
    })
    .map((item) => ({
      ...item,
      key: item.key || `${category}:${item.skill_id}`,
      category: category || item.category,
      name: item.name || item.skill || `技能#${item.skill_id}`,
      skill_id: item.skill_id
    }));
}

function activeSkillCooldowns(source = snapshot) {
  return filterActiveTimers(source?.skill_cooldowns || [], 'cooldown');
}

function activeSkillEffectTimers(source = snapshot) {
  return filterActiveTimers(source?.skill_effect_timers || [], 'skill_duration');
}

function isBuffExpiring(item) {
  return window.ecoBuffWarning.isBuffExpiring(
    item,
    state.settings?.overlay?.expiryWarningSeconds
  );
}

function positiveSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

function skillIdFromCustomKey(key) {
  let text = String(key || '').trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  for (const prefix of ['skill:', 'cd:']) {
    if (lowered.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }
  if (!/^\d+$/.test(text)) return null;
  const skillId = Number(text);
  return Number.isInteger(skillId) && skillId > 0 ? skillId : null;
}

function looksLikeSkillKey(key) {
  const text = String(key || '').trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  if (lowered.startsWith('skill:') || lowered.startsWith('cd:')) return true;
  return /^\d+$/.test(text);
}

function normalizeCustomEntry(key, value) {
  const name = String(key || '').trim();
  if (!name) return null;
  let duration = null;
  let cooldown = null;
  let skillId = null;
  let label = null;
  let overlay = null;

  if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) {
    const seconds = positiveSeconds(value);
    if (seconds == null) return null;
    if (looksLikeSkillKey(name)) {
      cooldown = seconds;
      skillId = skillIdFromCustomKey(name);
    } else {
      duration = seconds;
    }
  } else if (value && typeof value === 'object') {
    duration = positiveSeconds(value.duration);
    cooldown = positiveSeconds(value.cooldown ?? value.cd);
    const rawSkill = Number(value.skill_id);
    skillId = Number.isInteger(rawSkill) && rawSkill > 0 ? rawSkill : null;
    label = String(value.label || value.name || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(value, 'overlay')) {
      overlay = Boolean(value.overlay);
    }
  } else {
    return null;
  }

  if (skillId == null) skillId = skillIdFromCustomKey(name);
  if (duration == null && cooldown == null) return null;
  const entry = {};
  if (duration != null) entry.duration = duration;
  if (cooldown != null) entry.cooldown = cooldown;
  if (skillId != null) entry.skill_id = skillId;
  if (label) entry.label = label;
  // Skill rows: default show on overlay until user unchecks.
  if (skillId != null) entry.overlay = overlay == null ? true : Boolean(overlay);
  return entry;
}

function normalizeCustomDurations(raw) {
  const cleaned = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const entry = normalizeCustomEntry(key, value);
    if (!entry) continue;
    cleaned[String(key).trim()] = entry;
  }
  return cleaned;
}

function collectCustomBuffDurationsFromDom(root) {
  if (!root) return {};
  const result = {};
  root.querySelectorAll('.custom-buff-row').forEach((row) => {
    const keyInput = row.querySelector('[data-field="key"]');
    const durationInput = row.querySelector('[data-field="duration"]');
    const cooldownInput = row.querySelector('[data-field="cooldown"]');
    const skillIdInput = row.querySelector('[data-field="skill_id"]');
    const labelInput = row.querySelector('[data-field="label"]');
    const overlayInput = row.querySelector('[data-field="overlay"]');
    const key = String(keyInput?.value || '').trim();
    if (!key) return;
    const duration = positiveSeconds(durationInput?.value);
    const cooldown = positiveSeconds(cooldownInput?.value);
    if (duration == null && cooldown == null) return;
    const entry = {};
    if (duration != null) entry.duration = duration;
    if (cooldown != null) entry.cooldown = cooldown;
    const skillId = Number(skillIdInput?.value || skillIdFromCustomKey(key));
    if (Number.isInteger(skillId) && skillId > 0) {
      entry.skill_id = skillId;
      entry.overlay = overlayInput ? Boolean(overlayInput.checked) : true;
    }
    const label = String(labelInput?.value || '').trim();
    if (label) entry.label = label;
    result[key] = entry;
  });
  return result;
}

function customBuffRowMarkup(key = '', entry = {}) {
  const normalized = normalizeCustomEntry(key, entry) || {};
  const durationValue = normalized.duration != null ? normalized.duration : '';
  const cooldownValue = normalized.cooldown != null ? normalized.cooldown : '';
  const skillId = normalized.skill_id || '';
  const label = normalized.label || '';
  const title = label || (skillId ? `技能 #${skillId}` : '');
  const isSkill = Boolean(skillId);
  const overlayChecked = isSkill ? normalized.overlay !== false : false;
  const icon = isSkill
    ? skillIconMarkup(skillId, 'sparkles')
    : '<span class="skill-icon skill-icon-status" title="状态标识"><i data-lucide="tag"></i></span>';
  return `<div class="custom-buff-row${isSkill ? ' is-skill' : ''}">
    <div class="custom-buff-identity">
      <div class="custom-buff-identity-main">
        ${icon}
        <div class="custom-buff-identity-copy">
          ${title ? `<strong class="custom-buff-title" ${isSkill ? `data-skill-name="${skillId}" data-keep-name="${label ? '1' : '0'}"` : ''}>${escapeHtml(title)}</strong>` : '<strong class="custom-buff-title is-empty">状态标识</strong>'}
          <input type="text" data-field="key" value="${escapeHtml(key)}" placeholder="magic_shield 或 skill:2100" spellcheck="false">
        </div>
      </div>
      <input type="hidden" data-field="skill_id" value="${escapeHtml(skillId)}">
      <input type="hidden" data-field="label" value="${escapeHtml(label)}">
    </div>
    <div class="number-field"><input type="number" data-field="duration" value="${escapeHtml(durationValue)}" min="0.1" step="0.1" placeholder="可选"><span>秒</span></div>
    <div class="number-field"><input type="number" data-field="cooldown" value="${escapeHtml(cooldownValue)}" min="0.1" step="0.1" placeholder="可选"><span>秒</span></div>
    <label class="custom-buff-overlay" title="勾选后，释放该技能会在悬浮窗显示持续/CD">
      <input type="checkbox" data-field="overlay" ${isSkill ? '' : 'disabled '} ${overlayChecked ? 'checked' : ''}>
      <span>悬浮窗</span>
    </label>
    <button type="button" class="btn danger-soft custom-buff-remove" title="删除此条">删除</button>
  </div>`;
}

function bindCustomBuffListEvents(root) {
  if (!root || root.dataset.bound === '1') return;
  root.dataset.bound = '1';
  root.addEventListener('click', (event) => {
    const button = event.target.closest('.custom-buff-remove');
    if (!button) return;
    const row = button.closest('.custom-buff-row');
    row?.remove();
    if (!root.querySelector('.custom-buff-row')) {
      root.innerHTML = '<div class="empty-state">暂无自定义倒计时，点击“添加一条”或从技能库选择</div>';
    }
    state.custom_durations = collectCustomBuffDurationsFromDom(root);
    scheduleAutoSaveCustomBuffs(`#${root.id}`);
  });
  root.addEventListener('change', () => {
    state.custom_durations = collectCustomBuffDurationsFromDom(root);
    scheduleAutoSaveCustomBuffs(`#${root.id}`);
  });
  root.addEventListener('input', () => {
    state.custom_durations = collectCustomBuffDurationsFromDom(root);
    scheduleAutoSaveCustomBuffs(`#${root.id}`);
  });
}

function renderCustomBuffConfig(force = false) {
  const custom = normalizeCustomDurations(state.custom_durations);
  state.custom_durations = custom;
  const keys = Object.keys(custom).sort();
  const html = keys.length
    ? keys.map((key) => customBuffRowMarkup(key, custom[key])).join('')
    : '<div class="empty-state">暂无自定义倒计时，点击“添加一条”或从技能库选择</div>';
  const renderKey = JSON.stringify(custom);

  ['#buff-page-custom-list', '#settings-custom-buff-list'].forEach((selector) => {
    const root = $(selector);
    if (!root) return;
    const editing = root.contains(document.activeElement);
    // Avoid wiping in-progress edits on unrelated state broadcasts.
    if (!force && (editing || root.dataset.renderKey === renderKey)) {
      bindCustomBuffListEvents(root);
      return;
    }
    root.dataset.renderKey = renderKey;
    root.innerHTML = html;
    bindCustomBuffListEvents(root);
    hydrateSkillIcons(root);
    createIcons();
  });
  renderSkillLibraryPickers();
}

function skillLibraryList() {
  const fromState = Array.isArray(state.skill_library) ? state.skill_library : [];
  if (fromState.length) return fromState;
  // Fallback: build from current snapshot casts while library is still empty.
  const map = new Map();
  for (const item of snapshot?.skill_casts || []) {
    const id = Number(item.skill_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    map.set(id, {
      skill_id: id,
      name: item.skill || `技能#${id}`,
      count: Number(item.count) || 0,
      last_used: Date.now() / 1000
    });
  }
  return [...map.values()];
}

function renderSkillLibraryPickers() {
  const configured = new Set(Object.keys(normalizeCustomDurations(state.custom_durations)));
  const library = skillLibraryList();
  const panels = [
    { root: '#buff-page-skill-library', filter: '#buff-page-skill-filter', listId: 'buff-page-custom-list' },
    { root: '#settings-skill-library', filter: '#settings-skill-filter', listId: 'settings-custom-buff-list' }
  ];
  panels.forEach(({ root, filter, listId }) => {
    const host = $(root);
    if (!host) return;
    const query = String($(filter)?.value || '').trim().toLowerCase();
    const items = library.filter((item) => {
      if (!query) return true;
      const name = String(item.name || '').toLowerCase();
      return name.includes(query) || String(item.skill_id).includes(query);
    }).slice(0, 40);
    if (!items.length) {
      host.innerHTML = `<div class="empty-state">${library.length ? '没有匹配的技能' : '释放技能后会自动收录到这里，点击即可添加设置'}</div>`;
      return;
    }
    host.innerHTML = items.map((item) => {
      const key = `skill:${item.skill_id}`;
      const added = configured.has(key) || configured.has(String(item.skill_id));
      const displayName = item.name || `技能#${item.skill_id}`;
      return `<button type="button" class="skill-chip${added ? ' added' : ''}" data-skill-id="${item.skill_id}" data-skill-name="${escapeHtml(displayName)}" data-list-id="${listId}" ${added ? 'disabled' : ''}>
        ${skillIconMarkup(item.skill_id, 'sparkles')}
        <span class="skill-chip-copy">
          <strong data-skill-chip-name="${item.skill_id}" data-skill-name="${item.skill_id}">${escapeHtml(displayName)}</strong>
          <span>#${item.skill_id}${item.count ? ` · ${item.count}次` : ''}</span>
        </span>
      </button>`;
    }).join('');
    createIcons();
    hydrateSkillIcons(host);
    // Prefer cached/client original names; fall back to skill-icon extract.
    const applyName = (skillId, gameName) => {
      const next = String(gameName || '').trim();
      if (!next || isLocalizedChineseName(next)) return;
      host.querySelectorAll(`[data-skill-chip-name="${skillId}"]`).forEach((node) => {
        if (node.textContent !== next) node.textContent = next;
      });
      host.querySelectorAll(`.skill-chip[data-skill-id="${skillId}"]`).forEach((chip) => {
        chip.dataset.skillName = next;
      });
      const entry = (state.skill_library || []).find((row) => Number(row.skill_id) === skillId);
      if (entry && entry.name !== next) entry.name = next;
    };
    const needsResolve = items.some((item) => isLocalizedChineseName(item.name) || isPlaceholderName(item.name));
    if (needsResolve && typeof window.eco.getSkillLibrary === 'function') {
      // One-shot rewrite from main-process skill-icon name cache (Heat / Magic Shield…).
      if (!host.dataset.resolveNamesPending) {
        host.dataset.resolveNamesPending = '1';
        window.eco.getSkillLibrary().then((result) => {
          host.dataset.resolveNamesPending = '';
          if (!result?.ok || !Array.isArray(result.skill_library)) return;
          state.skill_library = result.skill_library;
          for (const item of result.skill_library) {
            applyName(Number(item.skill_id), item.name);
          }
        }).catch(() => {
          host.dataset.resolveNamesPending = '';
        });
      }
    }
    items.forEach((item) => {
      const skillId = Number(item.skill_id);
      if (!Number.isInteger(skillId) || skillId <= 0) return;
      // Always fetch icon (and name when placeholder); icons work from disk cache without eco.exe.
      window.eco.getSkillIcon(skillId).then((result) => {
        if (isLocalizedChineseName(item.name) || isPlaceholderName(item.name)) {
          applyName(skillId, result?.name);
        }
      }).catch(() => {});
    });
  });
}

function addSkillFromLibrary(skillId, skillName, listId) {
  const id = Number(skillId);
  if (!Number.isInteger(id) || id <= 0) return;
  const key = `skill:${id}`;
  const custom = normalizeCustomDurations(state.custom_durations);
  if (custom[key] || custom[String(id)]) {
    showToast('该技能已在倒计时列表中');
    return;
  }
  custom[key] = {
    skill_id: id,
    label: String(skillName || '').trim() || `技能#${id}`,
    cooldown: 30,
    overlay: true
  };
  state.custom_durations = custom;
  renderCustomBuffConfig(true);
  scheduleAutoSaveCustomBuffs(`#${listId}`);
  showToast(`已添加 ${custom[key].label}，请填写持续/CD 秒数`);
  // Focus cooldown field of the new row.
  const root = $(`#${listId}`);
  const rows = [...(root?.querySelectorAll('.custom-buff-row') || [])];
  const row = rows.find((node) => node.querySelector('[data-field="key"]')?.value === key);
  row?.querySelector('[data-field="cooldown"]')?.focus();
}

let customBuffSaveTimer = null;

async function saveCustomBuffDurationsFromUi(sourceRootId, { quiet = false } = {}) {
  const source = sourceRootId ? $(sourceRootId) : null;
  // Prefer the focused editor list when both pages exist.
  const payload = source
    ? collectCustomBuffDurationsFromDom(source)
    : normalizeCustomDurations({
      ...state.custom_durations,
      ...collectCustomBuffDurationsFromDom($('#buff-page-custom-list')),
      ...collectCustomBuffDurationsFromDom($('#settings-custom-buff-list'))
    });
  const result = await window.eco.saveBuffCustomDurations(payload);
  if (!result?.ok) {
    if (!quiet) showToast(result?.error || '保存自定义倒计时失败');
    return false;
  }
  state.custom_durations = normalizeCustomDurations(result.custom_durations || payload);
  renderCustomBuffConfig(true);
  if (!quiet) {
    const count = Object.keys(state.custom_durations).length;
    showToast(count ? `已保存 ${count} 条到本地，重启后仍有效` : '已清空并保存到本地');
  }
  return true;
}

function scheduleAutoSaveCustomBuffs(sourceRootId) {
  clearTimeout(customBuffSaveTimer);
  customBuffSaveTimer = setTimeout(() => {
    saveCustomBuffDurationsFromUi(sourceRootId, { quiet: true });
  }, 800);
}

function addCustomBuffDurationRow(listId) {
  const root = $(listId);
  if (!root) return;
  const empty = root.querySelector('.empty-state');
  if (empty) empty.remove();
  root.insertAdjacentHTML('beforeend', customBuffRowMarkup('', { duration: 30 }));
  bindCustomBuffListEvents(root);
  const keyInput = root.querySelector('.custom-buff-row:last-child [data-field="key"]');
  keyInput?.focus();
}


function formatEventTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) return '--:--:--';
  return new Date(Number(timestamp) * 1000).toLocaleTimeString('zh-CN', { hour12: false });
}

function renderBuffs() {
  const monitoring = isStatusMonitoringEnabled();
  $('#page-buffs')?.classList.toggle('monitoring-off', !monitoring);
  if ($('#buff-monitoring-toggle')) $('#buff-monitoring-toggle').checked = monitoring;

  const items = monitoring ? [...(snapshot?.buffs || [])] : [];
  const cooldowns = monitoring ? activeSkillCooldowns(snapshot) : [];
  const skillEffects = monitoring ? activeSkillEffectTimers(snapshot) : [];
  const skillTimers = [...skillEffects, ...cooldowns];
  const history = monitoring ? [...(snapshot?.buff_history || [])].reverse() : [];
  const counts = { positive: 0, negative: 0, abnormal: 0 };
  items.forEach((item) => {
    if (Object.hasOwn(counts, item.category)) counts[item.category] += 1;
  });

  $('#buff-actor').textContent = !monitoring
    ? '状态监控已关闭'
    : (snapshot?.self_id ? `角色编号 ${snapshot.self_id}` : '等待识别角色');
  $('#buff-total').textContent = formatNumber(items.length);
  $('#buff-positive').textContent = formatNumber(counts.positive);
  $('#buff-negative').textContent = formatNumber(counts.negative);
  $('#buff-abnormal').textContent = formatNumber(counts.abnormal);
  if ($('#buff-cooldown-count')) $('#buff-cooldown-count').textContent = formatNumber(skillTimers.length);
  $('#buff-active-count').textContent = `${items.length} 项`;
  if ($('#buff-cd-active-count')) $('#buff-cd-active-count').textContent = `${skillTimers.length} 项`;
  $('#buff-history-count').textContent = `${history.length} 条`;
  // Do not rebuild the custom-duration editor every second; it would steal focus.
  renderSkillLibraryPickers();

  const activeRoot = $('#buff-active-list');
  if (!monitoring) {
    activeRoot.innerHTML = '<div class="empty-state">状态监控已关闭，打开右上角开关后恢复显示</div>';
  } else {
    activeRoot.innerHTML = items.length ? items.map((item) => {
      const category = buffCategory(item);
      return `<div class="buff-active-row ${category.cls}">${skillIconMarkup(item.skill_id, 'shield', isBuffExpiring(item))}<span class="buff-category">${category.label}</span><div class="buff-name"><strong>${buffLabelMarkup(item)}</strong></div><div class="buff-time"><strong>${buffTime(item)}</strong><span>${buffTimingSource(item)}</span></div></div>`;
    }).join('') : '<div class="empty-state">尚未检测到角色状态</div>';
  }

  const cdRoot = $('#buff-cooldown-list');
  if (cdRoot) {
    if (!monitoring) {
      cdRoot.innerHTML = '<div class="empty-state">状态监控已关闭</div>';
    } else {
      cdRoot.innerHTML = skillTimers.length ? skillTimers.map((item) => {
        const category = buffCategory(item);
        const icon = item.category === 'cooldown' ? 'timer' : 'hourglass';
        return `<div class="buff-active-row ${category.cls}">${skillIconMarkup(item.skill_id, icon, isBuffExpiring(item))}<span class="buff-category ${category.cls}">${category.label}</span><div class="buff-name"><strong>${buffLabelMarkup(item)}</strong><small>${item.category === 'cooldown' ? '技能 CD' : '技能持续'} · #${escapeHtml(item.skill_id)}</small></div><div class="buff-time"><strong>${buffTime(item)}</strong><span>${buffTimingSource(item)}</span></div></div>`;
      }).join('') : '<div class="empty-state">在自定义倒计时中填写持续/CD 后，释放对应技能即可显示</div>';
    }
    hydrateSkillIcons(cdRoot);
  }

  const historyRoot = $('#buff-history-list');
  const eventLabels = { gained: '获得', refreshed: '刷新', lost: '消失' };
  if (!monitoring) {
    historyRoot.innerHTML = '<div class="empty-state">状态监控已关闭</div>';
  } else {
    historyRoot.innerHTML = history.length ? history.map((item) => {
      const category = buffCategory(item);
      return `<div class="buff-history-row"><time>${formatEventTime(item.time)}</time>${skillIconMarkup(item.skill_id, 'shield')}<span class="buff-category ${category.cls}">${category.label}</span><strong>${buffLabelMarkup(item)}</strong><b class="buff-event ${escapeHtml(item.event)}">${eventLabels[item.event] || '变化'}</b></div>`;
    }).join('') : '<div class="empty-state">尚无状态变化记录</div>';
  }
  createIcons();
  hydrateSkillIcons(activeRoot);
  hydrateSkillIcons(historyRoot);
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
    return `<div class="recent-row"><time>${escapeHtml(item.time || '--:--:--')}</time><span class="type-badge ${type.cls}">${type.text}</span>${skillIconMarkup(item.skill_id, item.skill_id == null ? 'sword' : 'sparkles')}<span class="route">${escapeHtml(item.source)} → ${escapeHtml(item.target)} · ${item.skill_id == null ? '普通攻击' : skillNameMarkup(item.skill_id)}</span><strong>${formatNumber(item.damage)}</strong></div>`;
  }).join('');
  createIcons();
  hydrateSkillIcons(root);
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
    return `<tr><td>${escapeHtml(item.time || '')}</td><td><span class="type-badge ${type.cls}">${type.text}</span></td><td title="${escapeHtml(item.source)}">${escapeHtml(item.source)}</td><td title="${escapeHtml(item.target)}">${escapeHtml(item.target)}</td><td><div class="skill-cell">${skillIconMarkup(item.skill_id, item.skill_id == null ? 'sword' : 'sparkles')}${item.skill_id == null ? '<span>普通攻击</span>' : skillNameMarkup(item.skill_id)}</div></td><td class="number">${formatNumber(item.damage)}</td></tr>`;
  }).join('');
  createIcons();
  hydrateSkillIcons(root);
}

function scheduleRenderLogs(force = false) {
  if (force) {
    logRenderKey = null;
    renderLogs();
    return;
  }
  if (logRenderPending) return;
  logRenderPending = true;
  requestAnimationFrame(() => {
    logRenderPending = false;
    renderLogs();
  });
}

function renderLogs() {
  const all = state.logs || [];
  const last = all.length ? all[all.length - 1] : null;
  const key = `${activePage}|${logFilter}|${all.length}|${last?.time || ''}|${last?.message || ''}`;
  if (logRenderKey === key) return;
  logRenderKey = key;

  // Overview always shows a tiny tail of recent activity.
  if (activePage === 'overview' || activePage === 'logs' || activePage === 'translation') {
    const recent = all.slice(-5).reverse();
    const overviewRoot = $('#overview-logs');
    if (overviewRoot) {
      overviewRoot.innerHTML = recent.length
        ? recent.map((entry) => `<div class="activity-row"><i class="${escapeHtml(entry.level)}"></i><div><strong>${entry.service === 'damage' ? '伤害采集' : 'NPC 翻译'}</strong><span>${escapeHtml(entry.message)}</span></div><time>${escapeHtml(entry.time)}</time></div>`).join('')
        : '<div class="empty-state">等待服务启动</div>';
    }
  }

  if (activePage === 'translation' || activePage === 'logs') {
    const translation = all.filter((entry) => entry.service === 'translator').slice(-80).reverse();
    const translationRoot = $('#translation-log');
    if (translationRoot) {
      translationRoot.innerHTML = translation.length
        ? translation.map((entry) => `<div class="log-line"><time>${escapeHtml(entry.time)}</time>${escapeHtml(entry.message)}</div>`).join('')
        : '<div class="empty-state">尚无翻译日志</div>';
    }
  }

  if (activePage === 'logs') {
    const filtered = logFilter === 'all' ? all : all.filter((entry) => entry.service === logFilter);
    const consoleRoot = $('#log-console');
    if (consoleRoot) {
      consoleRoot.innerHTML = filtered.length
        ? filtered.slice(-500).map((entry) => `<div class="console-line ${escapeHtml(entry.level)}"><time>${escapeHtml(entry.time)}</time><b>${entry.service === 'damage' ? '伤害采集' : 'NPC 翻译'}</b><span>${escapeHtml(entry.message)}</span></div>`).join('')
        : '<div class="empty-state">暂无运行日志</div>';
      consoleRoot.scrollTop = consoleRoot.scrollHeight;
    }
  }
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
  const monitoring = overlay.monitoring !== false;
  if ($('#setting-overlay-monitoring')) $('#setting-overlay-monitoring').checked = monitoring;
  if ($('#buff-monitoring-toggle')) $('#buff-monitoring-toggle').checked = monitoring;
  if ($('#overview-monitoring-toggle')) $('#overview-monitoring-toggle').checked = monitoring;
  $('#page-buffs')?.classList.toggle('monitoring-off', !monitoring);
  $('#setting-overlay-scale').value = overlay.scale || 1;
  $('#setting-overlay-opacity').value = overlay.opacity ?? 1;
  $('#setting-buff-warning-seconds').value = window.ecoBuffWarning.normalizeWarningSeconds(overlay.expiryWarningSeconds);
  $('#scale-value').textContent = `${Math.round((overlay.scale || 1) * 100)}%`;
  $('#opacity-value').textContent = `${Math.round((overlay.opacity ?? 1) * 100)}%`;
  $('#setting-start-damage').checked = Boolean(startup.damage);
  if ($('#setting-start-monitoring')) $('#setting-start-monitoring').checked = startup.monitoring !== false;
  $('#setting-start-translator').checked = Boolean(startup.translator);
  $('#setting-start-overlay').checked = startup.overlay !== false;
  $('#setting-check-updates').checked = settings.updates?.checkOnStartup !== false;
  applyAppearance(settings.appearance || {}, { syncForm: true });
}

const ACCENT_PRESETS = ['amber', 'teal', 'violet', 'rose', 'cyan', 'slate'];
const OVERLAY_BG_MODES = ['follow', 'solid', 'custom'];

function normalizeOverlayBgMode(raw = {}) {
  const mode = String(raw.overlayBgMode || '').trim();
  if (OVERLAY_BG_MODES.includes(mode)) return mode;
  return raw.applyToOverlay === false ? 'solid' : 'follow';
}

function normalizeAppearance(raw = {}) {
  const dim = Number(raw.backgroundDim);
  const blur = Number(raw.backgroundBlur);
  const fit = String(raw.backgroundFit || 'cover');
  const accent = String(raw.accent || 'amber');
  const overlayDim = Number(raw.overlayBackgroundDim);
  const overlayBlur = Number(raw.overlayBackgroundBlur);
  const overlayFit = String(raw.overlayBackgroundFit || 'cover');
  const overlayBgMode = normalizeOverlayBgMode(raw);
  return {
    backgroundImage: String(raw.backgroundImage || '').trim(),
    backgroundDataUrl: String(raw.backgroundDataUrl || '').trim(),
    backgroundFileUrl: String(raw.backgroundFileUrl || '').trim(),
    backgroundUrl: String(raw.backgroundUrl || '').trim(),
    backgroundFit: ['cover', 'contain', 'fill'].includes(fit) ? fit : 'cover',
    backgroundDim: Number.isFinite(dim) ? Math.min(0.9, Math.max(0.1, dim)) : 0.52,
    backgroundBlur: Number.isFinite(blur) ? Math.min(24, Math.max(0, blur)) : 6,
    overlayBgMode,
    applyToOverlay: overlayBgMode !== 'solid',
    overlayBackgroundImage: String(raw.overlayBackgroundImage || '').trim(),
    overlayBackgroundUrl: String(raw.overlayBackgroundUrl || '').trim(),
    overlayBackgroundDataUrl: String(raw.overlayBackgroundDataUrl || '').trim(),
    overlayBackgroundFileUrl: String(raw.overlayBackgroundFileUrl || '').trim(),
    overlayBackgroundDim: Number.isFinite(overlayDim) ? Math.min(0.9, Math.max(0.1, overlayDim)) : 0.62,
    overlayBackgroundBlur: Number.isFinite(overlayBlur) ? Math.min(24, Math.max(0, overlayBlur)) : 4,
    overlayBackgroundFit: ['cover', 'contain', 'fill'].includes(overlayFit) ? overlayFit : 'cover',
    accent: ACCENT_PRESETS.includes(accent) ? accent : 'amber'
  };
}

function syncAccentPresetButtons(accent = 'amber') {
  $$('#accent-presets .accent-preset').forEach((button) => {
    const active = button.dataset.accent === accent;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function wallpaperCssUrl(appearance = {}) {
  const url = String(
    appearance.backgroundUrl
    || appearance.backgroundDataUrl
    || appearance.backgroundFileUrl
    || ''
  ).trim();
  if (!url) return 'none';
  // CSS url() needs quotes; escape embedded quotes just in case.
  return `url("${url.replace(/\\/g, '/').replace(/"/g, '\\"')}")`;
}

function applyAppearance(raw = {}, { syncForm = false } = {}) {
  const appearance = normalizeAppearance(raw);
  const root = document.documentElement;
  const shell = document.querySelector('.app-shell');
  const hasImage = Boolean(
    appearance.backgroundUrl
    || appearance.backgroundDataUrl
    || appearance.backgroundFileUrl
    || appearance.backgroundImage
  );
  const imageValue = wallpaperCssUrl(appearance);
  root.dataset.accent = appearance.accent;
  root.style.setProperty('--bg-image', imageValue);
  root.style.setProperty('--bg-fit', appearance.backgroundFit === 'fill' ? '100% 100%' : appearance.backgroundFit);
  root.style.setProperty('--bg-dim', String(appearance.backgroundDim));
  root.style.setProperty('--bg-blur', `${appearance.backgroundBlur}px`);
  shell?.classList.toggle('has-wallpaper', hasImage);

  const previewImage = $('#appearance-preview-image');
  const previewMask = $('#appearance-preview-mask');
  if (previewImage) {
    previewImage.style.backgroundImage = imageValue;
    previewImage.style.backgroundSize = appearance.backgroundFit === 'fill' ? '100% 100%' : appearance.backgroundFit;
    previewImage.style.filter = `blur(${Math.min(12, appearance.backgroundBlur)}px)`;
  }
  if (previewMask) {
    previewMask.style.background = `rgba(8, 6, 14, ${appearance.backgroundDim})`;
  }
  if ($('#appearance-preview-title')) {
    $('#appearance-preview-title').textContent = hasImage ? '自定义壁纸预览' : '默认深色主题';
  }
  if ($('#appearance-preview-hint')) {
    $('#appearance-preview-hint').textContent = hasImage
      ? '遮罩与模糊可实时调整，保存后立即生效'
      : '选择一张图片作为壁纸背景';
  }
  if ($('#appearance-path')) {
    $('#appearance-path').textContent = hasImage
      ? (appearance.backgroundImage || '已设置自定义背景')
      : '未设置自定义背景';
  }

  syncAccentPresetButtons(appearance.accent);
  syncOverlayBgModeUi(appearance, { syncForm });

  if (syncForm) {
    if ($('#setting-bg-dim')) $('#setting-bg-dim').value = appearance.backgroundDim;
    if ($('#setting-bg-blur')) $('#setting-bg-blur').value = appearance.backgroundBlur;
    if ($('#setting-bg-fit')) $('#setting-bg-fit').value = appearance.backgroundFit;
    if ($('#appearance-dim-value')) $('#appearance-dim-value').textContent = `${Math.round(appearance.backgroundDim * 100)}%`;
    if ($('#appearance-blur-value')) $('#appearance-blur-value').textContent = `${appearance.backgroundBlur}px`;
  }

  if (!state.settings) state.settings = {};
  state.settings.appearance = appearance;
}

function overlayBgModeHint(mode) {
  if (mode === 'solid') return '悬浮窗使用深色纯色底，不显示壁纸';
  if (mode === 'custom') return '使用单独选择的悬浮窗壁纸（可与主窗口不同）';
  return '使用主窗口壁纸，遮罩会略深以保证可读';
}

function syncOverlayBgModeUi(appearance = {}, { syncForm = false } = {}) {
  const mode = normalizeOverlayBgMode(appearance);
  $$('#overlay-bg-mode [data-overlay-bg-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.overlayBgMode === mode);
  });
  if ($('#overlay-bg-hint')) $('#overlay-bg-hint').textContent = overlayBgModeHint(mode);
  if ($('#overlay-bg-custom')) $('#overlay-bg-custom').hidden = mode !== 'custom';
  if ($('#overlay-bg-path')) {
    const hasCustom = Boolean(appearance.overlayBackgroundImage || appearance.overlayBackgroundUrl);
    $('#overlay-bg-path').textContent = hasCustom
      ? (appearance.overlayBackgroundImage || '已设置自定义悬浮窗背景')
      : '未设置自定义悬浮窗背景（将显示为纯色）';
  }
  if (syncForm) {
    if ($('#setting-overlay-bg-dim')) $('#setting-overlay-bg-dim').value = appearance.overlayBackgroundDim ?? 0.62;
    if ($('#setting-overlay-bg-blur')) $('#setting-overlay-bg-blur').value = appearance.overlayBackgroundBlur ?? 4;
    if ($('#setting-overlay-bg-fit')) $('#setting-overlay-bg-fit').value = appearance.overlayBackgroundFit || 'cover';
    if ($('#overlay-bg-dim-value')) {
      $('#overlay-bg-dim-value').textContent = `${Math.round((appearance.overlayBackgroundDim ?? 0.62) * 100)}%`;
    }
    if ($('#overlay-bg-blur-value')) {
      $('#overlay-bg-blur-value').textContent = `${appearance.overlayBackgroundBlur ?? 4}px`;
    }
  }
}

function collectAppearanceFromForm() {
  const selectedAccent = $('#accent-presets .accent-preset.active')?.dataset?.accent
    || state.settings?.appearance?.accent
    || 'amber';
  const current = state.settings?.appearance || {};
  const modeFromUi = $('#overlay-bg-mode [data-overlay-bg-mode].active')?.dataset?.overlayBgMode
    || current.overlayBgMode
    || 'follow';
  return normalizeAppearance({
    backgroundImage: current.backgroundImage || '',
    backgroundDataUrl: current.backgroundDataUrl || '',
    backgroundFileUrl: current.backgroundFileUrl || '',
    backgroundUrl: current.backgroundUrl || '',
    backgroundFit: $('#setting-bg-fit')?.value || 'cover',
    backgroundDim: Number($('#setting-bg-dim')?.value ?? 0.52),
    backgroundBlur: Number($('#setting-bg-blur')?.value ?? 6),
    overlayBgMode: modeFromUi,
    overlayBackgroundImage: current.overlayBackgroundImage || '',
    overlayBackgroundUrl: current.overlayBackgroundUrl || '',
    overlayBackgroundDataUrl: current.overlayBackgroundDataUrl || '',
    overlayBackgroundFileUrl: current.overlayBackgroundFileUrl || '',
    overlayBackgroundDim: Number($('#setting-overlay-bg-dim')?.value ?? current.overlayBackgroundDim ?? 0.62),
    overlayBackgroundBlur: Number($('#setting-overlay-bg-blur')?.value ?? current.overlayBackgroundBlur ?? 4),
    overlayBackgroundFit: $('#setting-overlay-bg-fit')?.value || current.overlayBackgroundFit || 'cover',
    accent: selectedAccent
  });
}

function serializableAppearance(appearance) {
  return {
    backgroundImage: appearance.backgroundImage || '',
    backgroundFit: appearance.backgroundFit,
    backgroundDim: appearance.backgroundDim,
    backgroundBlur: appearance.backgroundBlur,
    overlayBgMode: appearance.overlayBgMode,
    overlayBackgroundImage: appearance.overlayBackgroundImage || '',
    overlayBackgroundDim: appearance.overlayBackgroundDim,
    overlayBackgroundBlur: appearance.overlayBackgroundBlur,
    overlayBackgroundFit: appearance.overlayBackgroundFit,
    applyToOverlay: appearance.overlayBgMode !== 'solid',
    accent: appearance.accent
  };
}

function isStatusMonitoringEnabled() {
  return state.settings?.overlay?.monitoring !== false;
}

async function setStatusMonitoring(enabled) {
  const monitoring = Boolean(enabled);
  if ($('#buff-monitoring-toggle')) $('#buff-monitoring-toggle').checked = monitoring;
  if ($('#setting-overlay-monitoring')) $('#setting-overlay-monitoring').checked = monitoring;
  if ($('#overview-monitoring-toggle')) $('#overview-monitoring-toggle').checked = monitoring;
  $('#page-buffs')?.classList.toggle('monitoring-off', !monitoring);
  const result = await window.eco.saveAppSettings({ overlay: { monitoring } });
  state.settings = result.settings;
  // Backend may start/stop independently of damage collection; refresh service cards.
  const next = await window.eco.getState();
  state = { ...state, ...next };
  applySettingsToForm();
  renderServices();
  if (activePage === 'buffs') renderBuffs();
  const service = state.services?.monitoring;
  if (monitoring && service?.state === 'error') {
    showToast(service.message || '状态监控启动失败');
  } else {
    showToast(monitoring ? '状态监控已开启（无需伤害采集）' : '状态监控已关闭');
  }
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
  const labels = [$('#edit-overlay'), $('#buff-edit-overlay'), $('#settings-edit-overlay')];
  labels.forEach((button) => {
    if (!button) return;
    const idleLabel = button.id === 'settings-edit-overlay' ? '调整位置与大小' : '调整状态悬浮窗';
    button.innerHTML = `<i data-lucide="${overlayEditing ? 'check' : 'move'}"></i>${overlayEditing ? '完成调整' : idleLabel}`;
  });
  createIcons();
  showToast(overlayEditing ? '可拖动位置，拖右下角调整长宽' : '悬浮窗位置与大小已保存');
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
  $('#xiaoya-toggle').addEventListener('click', toggleXiaoya);
  $('#xiaoya-toggle-ss').addEventListener('click', toggleXiaoyaSs);
  $('#xiaoya-toggle-visibility').addEventListener('click', toggleXiaoyaVisibility);
  $('#xiaoya-reload-config').addEventListener('click', reloadXiaoyaConfig);
  $('#xiaoya-open-folder').addEventListener('click', async () => {
    const result = await window.eco.openXiaoyaFolder();
    if (!result.ok) showToast(result.error || '无法打开小雅目录');
  });
  $('#xiaoya-config').addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveXiaoyaConfig();
  });
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
  $('#buff-edit-overlay').addEventListener('click', setOverlayEditing);

  $('#buff-page-custom-save')?.addEventListener('click', () => saveCustomBuffDurationsFromUi('#buff-page-custom-list'));
  $('#settings-custom-buff-save')?.addEventListener('click', () => saveCustomBuffDurationsFromUi('#settings-custom-buff-list'));
  $('#buff-page-custom-add')?.addEventListener('click', () => addCustomBuffDurationRow('#buff-page-custom-list'));
  $('#settings-custom-buff-add')?.addEventListener('click', () => addCustomBuffDurationRow('#settings-custom-buff-list'));
  $('#buff-monitoring-toggle')?.addEventListener('change', (event) => {
    setStatusMonitoring(event.target.checked);
  });
  $('#setting-overlay-monitoring')?.addEventListener('change', (event) => {
    setStatusMonitoring(event.target.checked);
  });
  $('#overview-monitoring-toggle')?.addEventListener('change', (event) => {
    setStatusMonitoring(event.target.checked);
  });
  $('#buff-page-skill-filter')?.addEventListener('input', () => renderSkillLibraryPickers());
  $('#settings-skill-filter')?.addEventListener('input', () => renderSkillLibraryPickers());
  document.addEventListener('click', (event) => {
    const chip = event.target.closest('.skill-chip');
    if (!chip || chip.disabled) return;
    addSkillFromLibrary(chip.dataset.skillId, chip.dataset.skillName, chip.dataset.listId);
  });

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
    scheduleRenderLogs(true);
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

  const previewAppearanceLive = () => {
    const next = collectAppearanceFromForm();
    applyAppearance(next, { syncForm: false });
    if ($('#appearance-dim-value')) $('#appearance-dim-value').textContent = `${Math.round(next.backgroundDim * 100)}%`;
    if ($('#appearance-blur-value')) $('#appearance-blur-value').textContent = `${next.backgroundBlur}px`;
    if ($('#overlay-bg-dim-value')) $('#overlay-bg-dim-value').textContent = `${Math.round(next.overlayBackgroundDim * 100)}%`;
    if ($('#overlay-bg-blur-value')) $('#overlay-bg-blur-value').textContent = `${next.overlayBackgroundBlur}px`;
  };
  $('#setting-bg-dim')?.addEventListener('input', previewAppearanceLive);
  $('#setting-bg-blur')?.addEventListener('input', previewAppearanceLive);
  $('#setting-bg-fit')?.addEventListener('change', previewAppearanceLive);
  $('#setting-overlay-bg-dim')?.addEventListener('input', previewAppearanceLive);
  $('#setting-overlay-bg-blur')?.addEventListener('input', previewAppearanceLive);
  $('#setting-overlay-bg-fit')?.addEventListener('change', previewAppearanceLive);
  $('#accent-presets')?.addEventListener('click', (event) => {
    const button = event.target.closest('.accent-preset');
    if (!button) return;
    const accent = button.dataset.accent;
    if (!ACCENT_PRESETS.includes(accent)) return;
    const next = collectAppearanceFromForm();
    next.accent = accent;
    applyAppearance(next, { syncForm: false });
    if ($('#appearance-save-status')) $('#appearance-save-status').textContent = '强调色已预览，记得保存';
  });
  $('#overlay-bg-mode')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-overlay-bg-mode]');
    if (!button) return;
    const mode = button.dataset.overlayBgMode;
    if (!OVERLAY_BG_MODES.includes(mode)) return;
    const next = collectAppearanceFromForm();
    next.overlayBgMode = mode;
    next.applyToOverlay = mode !== 'solid';
    applyAppearance(next, { syncForm: false });
    if ($('#overlay-save-status')) $('#overlay-save-status').textContent = '背景模式已预览，记得保存';
  });
  $('#appearance-pick-bg')?.addEventListener('click', async () => {
    const live = collectAppearanceFromForm();
    const result = await window.eco.pickBackgroundImage('main');
    if (!result?.ok) {
      if (!result?.cancelled) showToast(result?.error || '选择背景失败');
      return;
    }
    state.settings = result.settings;
    applyAppearance({
      ...(result.settings?.appearance || {}),
      backgroundFit: live.backgroundFit,
      backgroundDim: live.backgroundDim,
      backgroundBlur: live.backgroundBlur,
      overlayBgMode: live.overlayBgMode,
      overlayBackgroundDim: live.overlayBackgroundDim,
      overlayBackgroundBlur: live.overlayBackgroundBlur,
      overlayBackgroundFit: live.overlayBackgroundFit,
      accent: live.accent
    }, { syncForm: true });
    $('#appearance-save-status').textContent = '背景已更新，可继续调遮罩后保存';
    showToast('背景图已应用');
    createIcons();
  });
  $('#appearance-clear-bg')?.addEventListener('click', async () => {
    const live = collectAppearanceFromForm();
    const result = await window.eco.clearBackgroundImage('main');
    if (!result?.ok) {
      showToast(result?.error || '清除背景失败');
      return;
    }
    state.settings = result.settings;
    applyAppearance({
      ...(result.settings?.appearance || {}),
      backgroundFit: live.backgroundFit,
      backgroundDim: live.backgroundDim,
      backgroundBlur: live.backgroundBlur,
      overlayBgMode: live.overlayBgMode,
      overlayBackgroundDim: live.overlayBackgroundDim,
      overlayBackgroundBlur: live.overlayBackgroundBlur,
      overlayBackgroundFit: live.overlayBackgroundFit,
      accent: live.accent
    }, { syncForm: true });
    $('#appearance-save-status').textContent = '已恢复默认背景';
    showToast('已清除自定义背景');
  });
  $('#overlay-pick-bg')?.addEventListener('click', async () => {
    const live = collectAppearanceFromForm();
    const result = await window.eco.pickBackgroundImage('overlay');
    if (!result?.ok) {
      if (!result?.cancelled) showToast(result?.error || '选择悬浮窗背景失败');
      return;
    }
    state.settings = result.settings;
    applyAppearance({
      ...(result.settings?.appearance || {}),
      backgroundFit: live.backgroundFit,
      backgroundDim: live.backgroundDim,
      backgroundBlur: live.backgroundBlur,
      overlayBackgroundDim: live.overlayBackgroundDim,
      overlayBackgroundBlur: live.overlayBackgroundBlur,
      overlayBackgroundFit: live.overlayBackgroundFit,
      accent: live.accent
    }, { syncForm: true });
    if ($('#overlay-save-status')) $('#overlay-save-status').textContent = '悬浮窗背景已更新，记得保存';
    showToast('悬浮窗背景已应用');
    createIcons();
  });
  $('#overlay-clear-bg')?.addEventListener('click', async () => {
    const live = collectAppearanceFromForm();
    const result = await window.eco.clearBackgroundImage('overlay');
    if (!result?.ok) {
      showToast(result?.error || '清除悬浮窗背景失败');
      return;
    }
    state.settings = result.settings;
    applyAppearance({
      ...(result.settings?.appearance || {}),
      backgroundFit: live.backgroundFit,
      backgroundDim: live.backgroundDim,
      backgroundBlur: live.backgroundBlur,
      overlayBackgroundDim: live.overlayBackgroundDim,
      overlayBackgroundBlur: live.overlayBackgroundBlur,
      overlayBackgroundFit: live.overlayBackgroundFit,
      accent: live.accent
    }, { syncForm: true });
    if ($('#overlay-save-status')) $('#overlay-save-status').textContent = '已改为纯色';
    showToast('悬浮窗已改为纯色背景');
  });
  $('#settings-appearance')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const appearance = collectAppearanceFromForm();
    const result = await window.eco.saveAppSettings({ appearance: serializableAppearance(appearance) });
    state.settings = result.settings;
    applyAppearance(result.settings?.appearance || appearance, { syncForm: true });
    $('#appearance-save-status').textContent = '已保存';
    showToast('外观设置已保存');
  });

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
      monitoring: $('#setting-overlay-monitoring')?.checked !== false,
      scale: Number($('#setting-overlay-scale').value),
      opacity: Number($('#setting-overlay-opacity').value),
      expiryWarningSeconds: window.ecoBuffWarning.normalizeWarningSeconds($('#setting-buff-warning-seconds').value)
    };
    const appearance = serializableAppearance(collectAppearanceFromForm());
    const result = await window.eco.saveAppSettings({ overlay, appearance });
    state.settings = result.settings;
    applyAppearance(result.settings?.appearance || appearance, { syncForm: true });
    await window.eco.setOverlayVisible(overlay.visible);
    $('#overview-overlay-toggle').checked = overlay.visible;
    $('#overlay-save-status').textContent = '已保存';
    showToast('悬浮窗设置已保存');
  });

  $('#settings-startup').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await window.eco.saveAppSettings({ startup: {
      damage: $('#setting-start-damage').checked,
      monitoring: $('#setting-start-monitoring')?.checked !== false,
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
  const xiaoyaConfig = await window.eco.getXiaoyaConfig();
  if (xiaoyaConfig.ok) {
    applyXiaoyaSkills(xiaoyaConfig.skills);
    state.xiaoya = xiaoyaConfig.state || state.xiaoya;
  } else if (xiaoyaConfig.error) {
    $('#xiaoya-message').textContent = xiaoyaConfig.error;
  }
  syncIconProcess();
  snapshot = state.snapshot;
  applySettingsToForm();
  applyAppearance(state.settings?.appearance || {}, { syncForm: true });
  renderServices();
  renderXiaoya();
  renderSnapshot();
  // Explicitly reload local custom buff durations so restart always restores them.
  try {
    const saved = await window.eco.getBuffCustomDurations();
    if (saved?.ok) {
      state.custom_durations = normalizeCustomDurations(saved.custom_durations);
    } else {
      state.custom_durations = normalizeCustomDurations(state.custom_durations);
    }
  } catch {
    state.custom_durations = normalizeCustomDurations(state.custom_durations);
  }
  try {
    const library = await window.eco.getSkillLibrary();
    if (library?.ok && Array.isArray(library.skill_library)) {
      state.skill_library = library.skill_library;
    }
  } catch {
    // keep state.skill_library from getState if present
  }
  renderCustomBuffConfig(true);
  scheduleRenderLogs(true);
  renderUpdate(state.update);

  window.eco.onState((next) => {
    const prevLogLen = (state.logs || []).length;
    const prevCustom = JSON.stringify(state.custom_durations || {});
    const prevLibrary = JSON.stringify(state.skill_library || []);
    state = { ...state, ...next };
    if (next.custom_durations) {
      state.custom_durations = normalizeCustomDurations(next.custom_durations);
    }
    if (next.skill_library) {
      state.skill_library = next.skill_library;
    }
    syncIconProcess();
    if (next.snapshot) snapshot = next.snapshot;
    applySettingsToForm();
    if (next.settings?.appearance) {
      applyAppearance(next.settings.appearance, { syncForm: true });
    }
    renderServices();
    renderXiaoya();
    // Only re-render logs when the log buffer actually changed.
    if ((state.logs || []).length !== prevLogLen || next.logs) {
      scheduleRenderLogs();
    }
    if (JSON.stringify(state.custom_durations || {}) !== prevCustom
      || JSON.stringify(state.skill_library || []) !== prevLibrary) {
      renderCustomBuffConfig();
    }
  });
  window.eco.onSnapshot((next) => {
    snapshot = next;
    // Keep skill library chips fresh without waiting for full state broadcasts.
    const map = new Map((state.skill_library || []).map((item) => [Number(item.skill_id), item]));
    const preferName = (...parts) => {
      const cleaned = parts.map((v) => String(v || '').trim()).filter(Boolean);
      const gameLike = cleaned.find((v) => !isPlaceholderName(v) && !isLocalizedChineseName(v));
      if (gameLike) return gameLike;
      return cleaned.find((v) => !isPlaceholderName(v)) || cleaned[0] || '';
    };
    for (const item of next?.skill_casts || []) {
      const id = Number(item.skill_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const prev = map.get(id) || { skill_id: id, name: `技能#${id}`, count: 0, last_used: 0 };
      map.set(id, {
        skill_id: id,
        // Never overwrite client English/original names with Chinese dictionary labels.
        name: preferName(prev.name, item.skill, `技能#${id}`) || prev.name,
        count: Math.max(Number(prev.count) || 0, Number(item.count) || 0),
        last_used: Date.now() / 1000
      });
    }
    state.skill_library = [...map.values()].sort((a, b) => (b.last_used || 0) - (a.last_used || 0));
    renderSnapshot();
    if (activePage === 'buffs' || activePage === 'settings') renderSkillLibraryPickers();
  });
  window.eco.onLog((entry) => {
    const logs = state.logs || [];
    logs.push(entry);
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    state.logs = logs;
    // Batch rapid log lines into one paint frame.
    scheduleRenderLogs();
  });
  window.eco.onUpdate((update) => renderUpdate(update, true));
  setInterval(() => {
    if (activePage === 'buffs') renderBuffs();
  }, 1000);
}

init();
