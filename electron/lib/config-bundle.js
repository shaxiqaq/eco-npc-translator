'use strict';

/**
 * Export / import portable toolbox config (settings + buffs + translation optional).
 * Secrets (api_key / sync_token) are redacted on export unless includeSecrets=true.
 */
function buildConfigBundle({
  settings,
  custom_durations,
  translation,
  includeSecrets = false,
  appVersion
}) {
  const settingsCopy = JSON.parse(JSON.stringify(settings || {}));
  if (settingsCopy.appearance) {
    delete settingsCopy.appearance.backgroundDataUrl;
    delete settingsCopy.appearance.backgroundFileUrl;
    delete settingsCopy.appearance.backgroundUrl;
    delete settingsCopy.appearance.overlayBackgroundDataUrl;
    delete settingsCopy.appearance.overlayBackgroundFileUrl;
    delete settingsCopy.appearance.overlayBackgroundUrl;
  }

  let translationCopy = translation ? JSON.parse(JSON.stringify(translation)) : null;
  if (translationCopy && !includeSecrets) {
    if (translationCopy.api_key) translationCopy.api_key = '';
    if (translationCopy.sync_token) translationCopy.sync_token = '';
  }

  return {
    format: 'eco-toolbox-config',
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: appVersion || null,
    settings: settingsCopy,
    custom_durations: custom_durations || {},
    translation: translationCopy
  };
}

function parseConfigBundle(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    data = JSON.parse(raw);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('配置文件格式无效');
  }
  if (data.format && data.format !== 'eco-toolbox-config') {
    throw new Error('不是 ECO 工具箱配置文件');
  }
  return {
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
    custom_durations: data.custom_durations && typeof data.custom_durations === 'object'
      ? data.custom_durations
      : {},
    translation: data.translation && typeof data.translation === 'object' ? data.translation : null
  };
}

module.exports = {
  buildConfigBundle,
  parseConfigBundle
};
