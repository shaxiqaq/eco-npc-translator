'use strict';

/** Fields the status overlay actually renders. Everything else is main-window only. */
const OVERLAY_SNAPSHOT_KEYS = [
  'self_id',
  'buffs',
  'skill_cooldowns',
  'skill_effect_timers'
];

function overlaySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const slim = {};
  for (const key of OVERLAY_SNAPSHOT_KEYS) {
    if (snapshot[key] !== undefined) slim[key] = snapshot[key];
  }
  return slim;
}

module.exports = {
  OVERLAY_SNAPSHOT_KEYS,
  overlaySnapshot
};
