const $ = (selector) => document.querySelector(selector);
let snapshot = {};
let selectedGamePid = null;
let warningSeconds = 10;
let renderPending = false;
let structureKey = null;
let lastItemCount = -1;
const skillIconCache = new Map();

const categories = {
  positive: { label: '增益', cls: 'positive' },
  negative: { label: '减益', cls: 'negative' },
  abnormal: { label: '异常', cls: 'abnormal' }
};

function duration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function timeLabel(item) {
  const now = Date.now() / 1000;
  if (item?.expires_at != null && Number.isFinite(Number(item.expires_at))) {
    const remaining = Math.max(0, Number(item.expires_at) - now);
    return remaining > 0 ? `预计 ${duration(remaining)}` : '等待移除';
  }
  return `已持续 ${duration(Math.max(0, now - Number(item?.started_at || now)))}`;
}

function resizeFor(count) {
  if (count === lastItemCount) return;
  lastItemCount = count;
  const rows = Math.max(1, Math.ceil(count / 2));
  window.eco.resizeOverlayForContent(58 + rows * 45 + 12);
}

function skillIconMarkup(skillId, expiring) {
  const normalized = Number(skillId);
  const attribute = Number.isInteger(normalized) && normalized > 0
    ? ` data-skill-icon="${normalized}"`
    : '';
  return `<span class="skill-icon${expiring ? ' expiring' : ''}"${attribute}><i data-lucide="shield"></i></span>`;
}

function skillNameMarkup(skillId, statusKey) {
  const normalized = Number(skillId);
  if (Number.isInteger(normalized) && normalized > 0) {
    return `<span data-skill-name="${normalized}">技能#${normalized}</span>`;
  }
  return `<span>状态 ${escapeHtml(statusKey || '未知')}</span>`;
}

function buffLabelMarkup(item = {}) {
  const skillId = Number(item.skill_id);
  const hasSkill = Number.isInteger(skillId) && skillId > 0;
  const name = String(item.name || '').trim();
  const source = String(item.source_name || '').trim();
  const key = String(item.key || '').trim();
  const usableName = name
    && !name.startsWith('未命名')
    && !name.startsWith('未确认')
    && !/^状态\s/i.test(name)
    ? name
    : '';
  if (hasSkill) {
    const text = usableName || `技能#${skillId}`;
    return `<span data-skill-name="${skillId}" title="${escapeHtml(key || source || text)}">${escapeHtml(text)}</span>`;
  }
  if (usableName) return `<span title="${escapeHtml(key || source || usableName)}">${escapeHtml(usableName)}</span>`;
  if (source) return `<span title="${escapeHtml(key)}">${escapeHtml(source)}</span>`;
  return `<span>状态 ${escapeHtml(key || '未知')}</span>`;
}

function hydrateSkillIcons(root) {
  const skillIds = new Set(
    [...root.querySelectorAll('[data-skill-icon], [data-skill-name]')]
      .map((element) => Number(element.dataset.skillIcon || element.dataset.skillName))
      .filter((skillId) => Number.isInteger(skillId) && skillId > 0)
  );
  skillIds.forEach((skillId) => {
    if (!skillIconCache.has(skillId)) skillIconCache.set(skillId, window.eco.getSkillIcon(skillId));
    skillIconCache.get(skillId).then((result) => {
      root.querySelectorAll(`.skill-icon[data-skill-icon="${skillId}"]`).forEach((element) => {
        if (!element.isConnected || !result?.ok || !result.dataUrl) return;
        element.innerHTML = `<img src="${result.dataUrl}" alt="" draggable="false">`;
      });
      if (result?.ok && result.name) {
        root.querySelectorAll(`[data-skill-name="${skillId}"]`).forEach((element) => {
          element.textContent = result.name;
        });
      }
    }).catch(() => {});
  });
}

function buffStructureKey(items, selfId) {
  // Identity of the buff list (not ticking countdown values).
  return `${selfId || ''}|${items.map((item) => [
    item.key,
    item.skill_id,
    item.category,
    item.expires_at == null ? '' : Math.floor(Number(item.expires_at)),
    item.started_at == null ? '' : Math.floor(Number(item.started_at))
  ].join(':')).join(';')}`;
}

function updateTimersOnly(items) {
  const root = $('#status-list');
  if (!root) return;
  root.querySelectorAll('.status-item[data-buff-key]').forEach((node) => {
    const key = node.dataset.buffKey;
    const item = items.find((entry) => String(entry.key) === key);
    if (!item) return;
    const timeNode = node.querySelector('.time-label');
    if (timeNode) timeNode.textContent = timeLabel(item);
    const icon = node.querySelector('.skill-icon');
    if (icon) {
      icon.classList.toggle('expiring', window.ecoBuffWarning.isBuffExpiring(item, warningSeconds));
    }
  });
}

function renderFull(items) {
  $('#actor-label').textContent = snapshot.self_id ? `角色 ${snapshot.self_id}` : '等待识别角色';
  $('#active-count').textContent = `${items.length} 项`;
  const root = $('#status-list');
  root.innerHTML = items.length ? items.map((item) => {
    const category = categories[item.category] || { label: '状态', cls: 'unknown' };
    const expiring = window.ecoBuffWarning.isBuffExpiring(item, warningSeconds);
    return `<div class="status-item ${category.cls}" data-buff-key="${escapeHtml(item.key)}">${skillIconMarkup(item.skill_id, expiring)}<span>${category.label}</span><strong>${buffLabelMarkup(item)}</strong><b class="time-label">${timeLabel(item)}</b></div>`;
  }).join('') : '<div class="empty">当前没有检测到状态</div>';
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  hydrateSkillIcons(root);
  resizeFor(items.length);
}

function render(next) {
  if (next) snapshot = next;
  snapshot = snapshot || {};
  const items = [...(snapshot.buffs || [])];
  const nextKey = buffStructureKey(items, snapshot.self_id);
  if (nextKey === structureKey) {
    updateTimersOnly(items);
    return;
  }
  structureKey = nextKey;
  renderFull(items);
}

function scheduleRender(next) {
  if (next) snapshot = next;
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render(snapshot);
  });
}

window.eco.getState().then((state) => {
  selectedGamePid = state.selectedGamePid || null;
  warningSeconds = window.ecoBuffWarning.normalizeWarningSeconds(state.settings?.overlay?.expiryWarningSeconds);
  scheduleRender(state.snapshot || {});
});
window.eco.onState((state) => {
  const nextPid = state.selectedGamePid || null;
  if (nextPid !== selectedGamePid) {
    selectedGamePid = nextPid;
    skillIconCache.clear();
    structureKey = null;
  }
  warningSeconds = window.ecoBuffWarning.normalizeWarningSeconds(state.settings?.overlay?.expiryWarningSeconds);
  scheduleRender(state.snapshot || snapshot);
});
window.eco.onSnapshot((next) => scheduleRender(next));
window.eco.onOverlayEditing((editing) => $('#overlay').classList.toggle('editing', editing));
// Tick countdown labels without rebuilding the whole DOM every second.
setInterval(() => {
  if (!snapshot?.buffs?.length) return;
  updateTimersOnly(snapshot.buffs);
}, 1000);
