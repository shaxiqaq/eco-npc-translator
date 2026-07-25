const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('../lib/json-store');

class StateManager {
  constructor() {
    this.dataDir = path.join(require('electron').app.getPath('userData'));
    this.configFile = path.join(this.dataDir, 'app_settings.json');
    this.settings = this.loadSettings();
  }

  loadSettings() {
    if (fs.existsSync(this.configFile)) {
      try {
        return readJson(this.configFile);
      } catch (e) {
        console.error('Failed to read app settings', e);
      }
    }
    return {};
  }

  saveSettings(newSettings) {
    this.settings = require('electron').mergeDeep(this.settings, newSettings);
    writeJson(this.configFile, this.settings);
    return this.settings;
  }

  getSetting(key) {
    return this.settings[key];
  }
}

module.exports = StateManager;
