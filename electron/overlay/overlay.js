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
  abnormal: { label: '异常', cls: 'abnormal' },
  cooldown: { label: 'CD', cls: 'cooldown' },
  skill_duration: { label: '持续', cls: 'skill-duration' }
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
    if (item?.category === 'cooldown') {
      return remaining > 0 ? `CD ${duration(remaining)}` : '可用';
    }
    if (item?.category === 'skill_duration') {
      return remaining > 0 ? `持续 ${duration(remaining)}` : '结束';
    }
    return remaining > 0 ? `预计 ${duration(remaining)}` : '等待移除';
  }
  return `已持续 ${duration(Math.max(0, now - Number(item?.started_at || now)))}`;
}

function activeSkillTimers(list = [], category, keyPrefix) {
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
      key: item.key || `${keyPrefix}:${item.skill_id}`,
      category,
      name: item.name || item.skill || `技能#${item.skill_id}`
    }));
}

let monitoringEnabled = true;

function activeOverlayItems(source = snapshot) {
  if (!monitoringEnabled) return [];
  const buffs = [...(source?.buffs || [])];
  const effects = activeSkillTimers(source?.skill_effect_timers || [], 'skill_duration', 'skill_effect');
  const cooldowns = activeSkillTimers(source?.skill_cooldowns || [], 'cooldown', 'skill_cd');
  // Skill timers first: effect duration, then CD, then buffs.
  return [...effects, ...cooldowns, ...buffs];
}

function resolveOverlayBgMode(appearance = {}) {
  const mode = String(appearance.overlayBgMode || '').trim();
  if (mode === 'follow' || mode === 'solid' || mode === 'custom') return mode;
  return appearance.applyToOverlay === false ? 'solid' : 'follow';
}

function cssUrl(value) {
  const url = String(value || '').trim();
  if (!url) return 'none';
  return `url("${url.replace(/\\/g, '/').replace(/"/g, '\\"')}")`;
}

function applyOverlayChrome(settings = {}, appearance = {}) {
  const scale = Math.min(1.4, Math.max(0.8, Number(settings.scale) || 1));
  document.documentElement.style.setProperty('--overlay-scale', String(scale));
  monitoringEnabled = settings.monitoring !== false;
  $('#overlay')?.classList.toggle('monitoring-off', !monitoringEnabled);

  const mode = resolveOverlayBgMode(appearance);
  let bgUrl = '';
  let dim = 0.92;
  let blur = 0;
  let fit = 'cover';
  let useBg = false;

  if (mode === 'follow') {
    bgUrl = String(
      appearance.backgroundUrl
      || appearance.backgroundDataUrl
      || appearance.backgroundFileUrl
      || ''
    ).trim();
    useBg = Boolean(bgUrl);
    const mainDim = Number(appearance.backgroundDim);
    const mainBlur = Number(appearance.backgroundBlur);
    dim = useBg
      ? Math.min(0.9, Math.max(0.35, (Number.isFinite(mainDim) ? mainDim : 0.52) + 0.1))
      : 0.92;
    blur = useBg ? Math.min(16, Math.max(0, Number.isFinite(mainBlur) ? mainBlur : 0)) : 0;
    fit = String(appearance.backgroundFit || 'cover');
  } else if (mode === 'custom') {
    bgUrl = String(
      appearance.overlayBackgroundUrl
      || appearance.overlayBackgroundDataUrl
      || appearance.overlayBackgroundFileUrl
      || ''
    ).trim();
    useBg = Boolean(bgUrl);
    const customDim = Number(appearance.overlayBackgroundDim);
    const customBlur = Number(appearance.overlayBackgroundBlur);
    dim = useBg
      ? Math.min(0.9, Math.max(0.2, Number.isFinite(customDim) ? customDim : 0.62))
      : 0.92;
    blur = useBg ? Math.min(16, Math.max(0, Number.isFinite(customBlur) ? customBlur : 4)) : 0;
    fit = String(appearance.overlayBackgroundFit || 'cover');
  } else {
    // solid
    useBg = false;
    dim = 0.92;
    blur = 0;
  }

  document.documentElement.style.setProperty('--overlay-bg-image', useBg ? cssUrl(bgUrl) : 'none');
  document.documentElement.style.setProperty(
    '--overlay-bg-fit',
    fit === 'fill' ? '100% 100%' : (['cover', 'contain'].includes(fit) ? fit : 'cover')
  );
  document.documentElement.style.setProperty('--overlay-bg-dim', String(dim));
  document.documentElement.style.setProperty('--overlay-bg-blur', useBg ? `${blur}px` : '0px');
  document.documentElement.style.setProperty('--overlay-bg', useBg ? 'transparent' : '#0d1012');
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

function isPlaceholderName(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (value.startsWith('未命名') || value.startsWith('未确认')) return true;
  if (/^状态\s/i.test(value)) return true;
  if (/^技能#\d+$/.test(value)) return true;
  return false;
}

/** Prefer game-internal labels (source_name / client skill name), not localized Chinese. */
function isLocalizedChineseName(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  // CJK unified ideographs — treat as localized display, not game-internal id.
  return /[\u4e00-\u9fff]/.test(value);
}

function pickGameFacingName(item = {}) {
  const skillId = Number(item.skill_id);
  const hasSkill = Number.isInteger(skillId) && skillId > 0;
  const name = String(item.name || item.skill || '').trim();
  const source = String(item.source_name || '').trim();
  const key = String(item.key || '').trim();
  // 1) Game source_name (Poison / heat / Magic Shield / ソリッドボディ)
  if (source && !isPlaceholderName(source)) return source;
  // 2) Non-Chinese name field
  if (name && !isPlaceholderName(name) && !isLocalizedChineseName(name)) return name;
  // 3) Skill id placeholder (client name filled by hydrate)
  if (hasSkill) return `技能#${skillId}`;
  // 4) Last resort: Chinese dict name, then key
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
  // Allow hydrate to replace with client skill name (game file), even if we already have source_name.
  // Only lock when main is already a non-placeholder, non-localized game-facing source_name.
  const keepName = source && source === mainText && !isLocalizedChineseName(source) ? '1' : '0';
  const nameAttr = hasSkill
    ? ` data-skill-name="${skillId}" data-keep-name="${keepName}"`
    : '';
  return `<span class="status-main"${nameAttr} title="${escapeHtml(title)}">${escapeHtml(mainText)}</span>`;
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
        // Prefer game client name unless current text is already a locked source_name.
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
  if (!monitoringEnabled) {
    $('#actor-label').textContent = '状态监控已关闭';
    $('#active-count').textContent = '已关闭';
    const root = $('#status-list');
    root.innerHTML = '<div class="empty">状态监控已关闭</div>';
    resizeFor(0);
    return;
  }
  $('#actor-label').textContent = snapshot.self_id ? `角色 ${snapshot.self_id}` : '等待识别角色';
  const skillTimerCount = items.filter((item) => item.category === 'cooldown' || item.category === 'skill_duration').length;
  const buffCount = items.length - skillTimerCount;
  if (skillTimerCount && buffCount) {
    $('#active-count').textContent = `${buffCount} 状态 · ${skillTimerCount} 技能`;
  } else if (skillTimerCount) {
    $('#active-count').textContent = `${skillTimerCount} 技能计时`;
  } else {
    $('#active-count').textContent = `${items.length} 项`;
  }
  const root = $('#status-list');
  root.innerHTML = items.length ? items.map((item) => {
    const category = categories[item.category] || { label: '状态', cls: 'unknown' };
    const expiring = window.ecoBuffWarning.isBuffExpiring(item, warningSeconds);
    return `<div class="status-item ${category.cls}" data-buff-key="${escapeHtml(item.key)}" data-skill-id="${escapeHtml(item.skill_id || '')}">${skillIconMarkup(item.skill_id, expiring)}<div class="status-copy"><strong class="status-name">${buffLabelMarkup(item)}</strong><b class="time-label">${timeLabel(item)}</b></div><span class="status-badge">${category.label}</span></div>`;
  }).join('') : '<div class="empty">当前没有检测到状态</div>';
  if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
  hydrateSkillIcons(root);
  resizeFor(items.length);
}

function render(next) {
  if (next) snapshot = next;
  snapshot = snapshot || {};
  const items = activeOverlayItems(snapshot);
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
  applyOverlayChrome(state.settings?.overlay, state.settings?.appearance);
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
  applyOverlayChrome(state.settings?.overlay, state.settings?.appearance);
  warningSeconds = window.ecoBuffWarning.normalizeWarningSeconds(state.settings?.overlay?.expiryWarningSeconds);
  scheduleRender(state.snapshot || snapshot);
});
window.eco.onSnapshot((next) => scheduleRender(next));
window.eco.onOverlayEditing((editing) => $('#overlay').classList.toggle('editing', editing));

// Corner drag resize (frameless window edges can be hard to grab when transparent).
(() => {
  const handle = $('#resize-handle');
  if (!handle || !window.eco?.resizeOverlayByDelta) return;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.screenX;
    lastY = event.screenY;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.screenX - lastX;
    const dy = event.screenY - lastY;
    lastX = event.screenX;
    lastY = event.screenY;
    if (dx || dy) window.eco.resizeOverlayByDelta(dx, dy);
  });
  const endDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
})();

// Tick countdown labels without rebuilding the whole DOM every second.
setInterval(() => {
  const items = activeOverlayItems(snapshot);
  if (!items.length) return;
  // Drop expired skill CDs from the list structure.
  const nextKey = buffStructureKey(items, snapshot.self_id);
  if (nextKey !== structureKey) {
    structureKey = nextKey;
    renderFull(items);
    return;
  }
  updateTimersOnly(items);
}, 1000);
