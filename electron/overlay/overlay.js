const $ = (selector) => document.querySelector(selector);
let snapshot = {};
let selectedGamePid = null;
let warningSeconds = 10;
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

function hydrateSkillIcons(root) {
  root.querySelectorAll('.skill-icon[data-skill-icon]').forEach((element) => {
    const skillId = Number(element.dataset.skillIcon);
    if (!skillIconCache.has(skillId)) skillIconCache.set(skillId, window.eco.getSkillIcon(skillId));
    skillIconCache.get(skillId).then((result) => {
      if (!element.isConnected || !result?.ok || !result.dataUrl) return;
      element.innerHTML = `<img src="${result.dataUrl}" alt="" draggable="false">`;
    }).catch(() => {});
  });
}

function render(next = snapshot) {
  snapshot = next || {};
  const items = [...(snapshot.buffs || [])];
  $('#actor-label').textContent = snapshot.self_id ? `角色 ${snapshot.self_id}` : '等待识别角色';
  $('#active-count').textContent = `${items.length} 项`;
  const root = $('#status-list');
  root.innerHTML = items.length ? items.map((item) => {
    const category = categories[item.category] || { label: '状态', cls: 'unknown' };
    return `<div class="status-item ${category.cls}">${skillIconMarkup(item.skill_id, window.ecoBuffWarning.isBuffExpiring(item, warningSeconds))}<span>${category.label}</span><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong><b>${timeLabel(item)}</b></div>`;
  }).join('') : '<div class="empty">当前没有检测到状态</div>';
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  hydrateSkillIcons(root);
  resizeFor(items.length);
}

window.eco.getState().then((state) => {
  selectedGamePid = state.selectedGamePid || null;
  warningSeconds = window.ecoBuffWarning.normalizeWarningSeconds(state.settings?.overlay?.expiryWarningSeconds);
  render(state.snapshot || {});
});
window.eco.onState((state) => {
  const nextPid = state.selectedGamePid || null;
  if (nextPid !== selectedGamePid) {
    selectedGamePid = nextPid;
    skillIconCache.clear();
  }
  warningSeconds = window.ecoBuffWarning.normalizeWarningSeconds(state.settings?.overlay?.expiryWarningSeconds);
  render(state.snapshot || snapshot);
});
window.eco.onSnapshot(render);
window.eco.onOverlayEditing((editing) => $('#overlay').classList.toggle('editing', editing));
setInterval(() => render(snapshot), 1000);
