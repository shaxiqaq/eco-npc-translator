import { readJson, writeJson } from '../lib/json-store';
import type { AppSettings } from '../types/config';

export class StateManager {
  private dataDir: string;
  private configFile: string;
  private settings: AppSettings;

  constructor() {
    this.dataDir = require('electron').app.getPath('userData');
    this.configFile = path.join(this.dataDir, 'app_settings.json');
    this.settings = this.loadSettings();
  }

  private loadSettings(): AppSettings {
    if (fs.existsSync(this.configFile)) {
      try {
        return readJson(this.configFile) as AppSettings;
      } catch (e) {
        console.error('Failed to read app settings', e);
      }
    }
    return {};
  }

  saveSettings(newSettings: Partial<AppSettings>) {
    this.settings = mergeDeep(this.settings, newSettings) as AppSettings;
    writeJson(this.configFile, this.settings);
    return this.settings;
  }

  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }
}
