const $ = (selector) => document.querySelector(selector);
let settings = { overlay: { showDetails: true } };
let detailsVersion = null;

function number(value, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function duration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function render(snapshot = {}) {
  $('#battle-time').textContent = duration(snapshot.active);
  $('#skill-total').textContent = number(snapshot.skill_dealt);
  $('#normal-total').textContent = number(snapshot.normal_dealt);
  $('#pet-total').textContent = number(snapshot.pet_dealt);
  $('#taken-total').textContent = number(snapshot.taken);
  $('#skill-dps').textContent = `${number(snapshot.skill_dps, 2)} 秒伤`;
  $('#normal-dps').textContent = `${number(snapshot.normal_dps, 2)} 秒伤`;
  $('#pet-dps').textContent = `${number(snapshot.pet_dps, 2)} 秒伤`;
  $('#taken-dps').textContent = `${number(snapshot.tps, 2)} 秒均`;

  const root = $('#details');
  if (settings.overlay?.showDetails === false) {
    root.innerHTML = '';
    detailsVersion = null;
    return;
  }
  const version = Number(snapshot.history_version || 0);
  if (detailsVersion === version) return;
  detailsVersion = version;
  const items = [...(snapshot.damage_history || [])].reverse().slice(0, 4);
  root.innerHTML = items.length ? items.map((item) => {
    const type = item.side === 'pet_dealt' ? 'pet' : item.side === 'taken' ? 'taken' : '';
    const label = item.side === 'pet_dealt' ? '宠物' : item.side === 'taken' ? '受到' : item.skill_id == null ? '普攻' : '技能';
    const peer = item.side === 'taken' ? item.source : item.target;
    return `<div class="hit ${type}"><span>${label}</span><b>${escapeHtml(item.skill)} · ${escapeHtml(peer)}</b><strong>${number(item.damage)}</strong></div>`;
  }).join('') : '<div class="empty">等待战斗数据</div>';
}

window.eco.getState().then((state) => {
  settings = state.settings || settings;
  render(state.snapshot || {});
});
window.eco.onState((state) => {
  settings = state.settings || settings;
  render(state.snapshot || {});
});
window.eco.onSnapshot(render);
window.eco.onOverlayEditing((editing) => $('#overlay').classList.toggle('editing', editing));
