'use strict';

/**
 * Central list of IPC channel names used by preload ↔ main.
 * Keep in sync with electron/preload.js and register handlers in main.js.
 * Future: handlers can migrate under electron/lib/ipc/*.js keyed by these names.
 */
const IPC_CHANNELS = Object.freeze({
  // app
  APP_GET_STATE: 'app:get-state',
  APP_GET_DIAGNOSTICS: 'app:get-diagnostics',
  APP_COPY_DIAGNOSTICS: 'app:copy-diagnostics',
  APP_EXPORT_DIAGNOSTIC_PACK: 'app:export-diagnostic-pack',
  APP_RECONNECT: 'app:reconnect',
  APP_SET_ONBOARDING_SEEN: 'app:set-onboarding-seen',
  APP_GET_ABOUT: 'app:get-about',
  // game / services
  GAME_PROCESSES_REFRESH: 'game-processes:refresh',
  GAME_PROCESSES_SELECT: 'game-processes:select',
  GAME_PROCESSES_SELECT_XIAOYA: 'game-processes:select-xiaoya',
  SERVICE_START: 'service:start',
  SERVICE_STOP: 'service:stop',
  SERVICE_PRESTART: 'service:prestart',
  DAMAGE_RESET: 'damage:reset',
  DAMAGE_REIDENTIFY: 'damage:reidentify-self',
  // settings
  SETTINGS_SAVE_APP: 'settings:save-app',
  SETTINGS_SAVE_TRANSLATION: 'settings:save-translation',
  CONFIG_EXPORT: 'config:export',
  CONFIG_IMPORT: 'config:import',
  PRESETS_LIST: 'presets:list',
  PRESETS_SAVE: 'presets:save',
  PRESETS_APPLY: 'presets:apply',
  PRESETS_DELETE: 'presets:delete',
  BATTLE_GET_REPORT: 'battle:get-report',
  BATTLE_RESET_REPORT: 'battle:reset-report',
  BATTLE_EXPORT_REPORT: 'battle:export-report',
  BATTLE_COPY_REPORT: 'battle:copy-report',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  OVERLAY_SET_VISIBLE: 'overlay:set-visible',
  OVERLAY_SET_EDITING: 'overlay:set-editing',
  OVERLAY_RESIZE_CONTENT: 'overlay:resize-content',
  OVERLAY_RESIZE_DELTA: 'overlay:resize-delta',
  SKILL_ICON_GET: 'skill-icon:get',
  NAMES_SKILL: 'names:skill',
  PRESETS_JOB_LIST: 'presets:job-list',
  PRESETS_JOB_APPLY: 'presets:job-apply',
  APPEARANCE_PICK_BACKGROUND: 'appearance:pick-background',
  APPEARANCE_CLEAR_BACKGROUND: 'appearance:clear-background',
  LOGS_OPEN_FOLDER: 'logs:open-folder',
  LOGS_EXPORT: 'logs:export',
  XIAOYA_GET_CONFIG: 'xiaoya:get-config',
  XIAOYA_SAVE_CONFIG: 'xiaoya:save-config',
  XIAOYA_START: 'xiaoya:start',
  XIAOYA_STOP: 'xiaoya:stop',
  XIAOYA_TOGGLE_SS: 'xiaoya:toggle-ss',
  XIAOYA_TOGGLE_VISIBILITY: 'xiaoya:toggle-visibility',
  XIAOYA_OPEN_FOLDER: 'xiaoya:open-folder',
  BUFFS_SAVE_CUSTOM: 'buffs:save-custom-durations',
  BUFFS_GET_CUSTOM: 'buffs:get-custom-durations',
  SKILLS_GET_LIBRARY: 'skills:get-library'
});

module.exports = { IPC_CHANNELS };
