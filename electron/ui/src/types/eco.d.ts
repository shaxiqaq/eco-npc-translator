export type PageId =
  | 'overview'
  | 'damage'
  | 'buffs'
  | 'translation'
  | 'xiaoya'
  | 'logs'
  | 'settings'
  | 'help';

export type ServiceName = 'damage' | 'translator';

export type ServiceState = {
  state?: string;
  message?: string;
  pid?: number | null;
  /** Stable remote-support code, e.g. ECO_E03 */
  errorCode?: string;
  errorHint?: string;
};

export type XiaoyaSkill = {
  enabled?: boolean;
  skillTime?: number;
  mouse?: boolean;
  delay?: number;
};

export type GameProcess = {
  pid: number;
  title?: string;
  started?: string;
};

export type EcoUpdateState = {
  phase?: string;
  enabled?: boolean;
  currentVersion?: string;
  availableVersion?: string;
  message?: string;
  releaseNotes?: string;
  progress?: {
    percent?: number;
    transferred?: number;
    total?: number;
  };
};

export type EcoLogEntry = {
  time?: string;
  service?: string;
  /** Extra filter channels (e.g. shared capture backend → damage + monitoring). */
  channels?: string[];
  level?: string;
  message?: string;
};

export type CustomBuffEntry = {
  duration?: number;
  cooldown?: number;
  skill_id?: number;
  label?: string;
  overlay?: boolean;
};

export type AppearanceSettings = {
  backgroundImage?: string;
  backgroundDataUrl?: string;
  backgroundFileUrl?: string;
  backgroundUrl?: string;
  backgroundFit?: string;
  backgroundDim?: number;
  backgroundBlur?: number;
  overlayBgMode?: string;
  applyToOverlay?: boolean;
  overlayBackgroundImage?: string;
  overlayBackgroundUrl?: string;
  overlayBackgroundDataUrl?: string;
  overlayBackgroundFileUrl?: string;
  overlayBackgroundDim?: number;
  overlayBackgroundBlur?: number;
  overlayBackgroundFit?: string;
  accent?: string;
};

export type AppSettings = {
  game?: { pid?: number | null; xiaoyaPid?: number | null };
  capture?: Record<string, boolean>;
  overlay?: {
    visible?: boolean;
    monitoring?: boolean;
    scale?: number;
    opacity?: number;
    expiryWarningSeconds?: number;
    density?: 'comfortable' | 'compact' | 'large' | 'expiring' | string;
    x?: number | null;
    y?: number | null;
    width?: number;
    height?: number;
  };
  startup?: {
    damage?: boolean;
    translator?: boolean;
    overlay?: boolean;
    monitoring?: boolean;
    tray?: boolean;
    minimizeToTray?: boolean;
    autoReconnect?: boolean;
  };
  hotkeys?: {
    toggleOverlay?: string;
    toggleWindow?: string;
  };
  onboarding?: {
    seenGuide?: boolean;
  };
  appearance?: AppearanceSettings;
  updates?: { checkOnStartup?: boolean };
};

export type ConnectionHealth = {
  status?: string;
  elevated?: boolean | null;
  selectedGamePid?: number | null;
  selectedXiaoyaPid?: number | null;
  processAlive?: boolean | null;
  processInList?: boolean;
  gameProcessCount?: number;
  hostname?: string;
  hints?: string[];
  serviceMessage?: string;
};

export type CharacterPreset = {
  id: string;
  name: string;
  updatedAt?: string;
  note?: string;
  capture?: Record<string, boolean>;
  custom_durations?: Record<string, CustomBuffEntry | number | string>;
  overlay?: AppSettings['overlay'];
};

export type TranslationSettings = {
  provider?: string;
  model?: string;
  base_url?: string;
  api_key?: string;
  target_lang?: string;
  first_wait?: number;
  player_names?: string[];
  toggle_hotkey?: string;
  skip_hotkey?: string;
  sync_enabled?: boolean;
  sync_url?: string;
  sync_token?: string;
};

export type DamageHistoryItem = {
  time?: string;
  side?: string;
  skill_id?: number | null;
  source?: string;
  target?: string;
  damage?: number;
  skill?: string;
};

export type Snapshot = {
  active?: number;
  skill_dealt?: number;
  normal_dealt?: number;
  pet_dealt?: number;
  taken?: number;
  skill_dps?: number;
  normal_dps?: number;
  pet_dps?: number;
  tps?: number;
  dealt?: number;
  dps?: number;
  max_skill_dealt?: number;
  skill_cast_total?: number;
  hits_skill_dealt?: number;
  hits_normal_dealt?: number;
  history_version?: number;
  damage_history?: DamageHistoryItem[];
  skill_casts?: Array<{ skill_id?: number; skill?: string; count?: number; role?: string }>;
  skill_cast_history?: Array<{
    time?: string;
    skill_id?: number;
    skill?: string;
    role?: string;
    target_label?: string;
  }>;
  buffs?: Array<Record<string, unknown>>;
  buff_history?: Array<Record<string, unknown>>;
  skill_cooldowns?: Array<Record<string, unknown>>;
  skill_effect_timers?: Array<Record<string, unknown>>;
  self_id?: number | string | null;
};

export type BattleReportSummary = {
  peakDps?: number;
  peakDealt?: number;
  samples?: number;
  startedAt?: string;
  last?: Record<string, unknown> | null;
  topSkills?: Array<{ skill_id?: number; skill?: string; count?: number }>;
};

export type EcoAppState = {
  services?: {
    damage?: ServiceState;
    translator?: ServiceState;
    monitoring?: ServiceState;
  };
  battleReport?: BattleReportSummary;
  rememberedTitles?: { main?: string | null; xiaoya?: string | null };
  settings?: AppSettings;
  translation?: TranslationSettings;
  update?: EcoUpdateState;
  logs?: EcoLogEntry[];
  gameProcesses?: GameProcess[];
  selectedGamePid?: number | null;
  selectedXiaoyaPid?: number | null;
  processSelectionLocked?: boolean;
  snapshot?: Snapshot | null;
  custom_durations?: Record<string, CustomBuffEntry | number | string>;
  skill_library?: Array<{ skill_id: number; name?: string; count?: number; last_used?: number }>;
  xiaoya?: ServiceState & { targetPid?: number | null };
  connectionHealth?: ConnectionHealth;
  characterPresets?: CharacterPreset[];
};

export type EcoApi = {
  getState: () => Promise<EcoAppState>;
  refreshGameProcesses: () => Promise<{ ok: boolean; processes?: GameProcess[]; error?: string }>;
  selectGameProcess: (pid: number) => Promise<{ ok: boolean; selectedPid?: number; error?: string }>;
  selectXiaoyaProcess: (pid: number) => Promise<{ ok: boolean; selectedXiaoyaPid?: number; error?: string }>;
  startService: (name: ServiceName) => Promise<{ ok: boolean; error?: string }>;
  stopService: (name: ServiceName) => Promise<{ ok: boolean; error?: string }>;
  resetDamage: () => Promise<unknown>;
  getBattleReport: () => Promise<{ ok: boolean; report?: BattleReportSummary }>;
  resetBattleReport: () => Promise<{ ok: boolean; report?: BattleReportSummary }>;
  exportBattleReport: (options?: { format?: 'txt' | 'json' }) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    path?: string;
    error?: string;
  }>;
  copyBattleReport: () => Promise<{ ok: boolean; text?: string; error?: string }>;
  getAbout: () => Promise<{
    ok: boolean;
    about?: {
      version?: string;
      packaged?: boolean;
      electron?: string;
      hotkeys?: { toggleOverlay?: string; toggleWindow?: string };
      elevated?: boolean | null;
      rememberedTitles?: { main?: string | null; xiaoya?: string | null };
      errorCodes?: Record<string, { title?: string; hint?: string }>;
    };
  }>;
  checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  saveTranslationSettings: (settings: TranslationSettings) => Promise<unknown>;
  saveAppSettings: (settings: Partial<AppSettings>) => Promise<{ settings: AppSettings }>;
  pickBackgroundImage: (target?: string) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    settings?: AppSettings;
  }>;
  clearBackgroundImage: (target?: string) => Promise<{ ok: boolean; error?: string; settings?: AppSettings }>;
  setOverlayVisible: (visible: boolean) => Promise<unknown>;
  setOverlayEditing: (editing: boolean) => Promise<unknown>;
  getSkillIcon: (skillId: number) => Promise<{ ok?: boolean; dataUrl?: string; name?: string }>;
  openLogs: () => Promise<unknown>;
  exportLogs: (options?: { filter?: string; format?: 'txt' | 'json' }) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    path?: string;
    count?: number;
  }>;
  getXiaoyaConfig: () => Promise<{ ok: boolean; skills?: XiaoyaSkill[]; state?: EcoAppState['xiaoya']; error?: string }>;
  saveXiaoyaConfig: (skills: XiaoyaSkill[]) => Promise<{ ok: boolean; error?: string; skills?: XiaoyaSkill[] }>;
  saveBuffCustomDurations: (
    durations: Record<string, CustomBuffEntry>,
  ) => Promise<{ ok: boolean; error?: string; custom_durations?: Record<string, CustomBuffEntry> }>;
  getBuffCustomDurations: () => Promise<{
    ok: boolean;
    custom_durations?: Record<string, CustomBuffEntry>;
  }>;
  getSkillLibrary: () => Promise<{
    ok?: boolean;
    skill_library?: Array<{ skill_id: number; name?: string; count?: number }>;
  }>;
  startXiaoya: () => Promise<{ ok: boolean; error?: string }>;
  stopXiaoya: () => Promise<{ ok: boolean; error?: string }>;
  toggleXiaoyaSs: () => Promise<{ ok: boolean; error?: string }>;
  toggleXiaoyaVisibility: () => Promise<{ ok: boolean; error?: string }>;
  openXiaoyaFolder: () => Promise<{ ok: boolean; error?: string }>;
  getDiagnostics: () => Promise<{ ok: boolean; text?: string; health?: ConnectionHealth; error?: string }>;
  copyDiagnostics: () => Promise<{ ok: boolean; text?: string; error?: string }>;
  reconnectGame: () => Promise<{ ok: boolean; error?: string; selectedPid?: number | null }>;
  setOnboardingSeen: (seen?: boolean) => Promise<{ ok: boolean; settings?: AppSettings }>;
  exportConfig: (options?: { includeSecrets?: boolean }) => Promise<{ ok: boolean; cancelled?: boolean; path?: string; error?: string }>;
  importConfig: () => Promise<{ ok: boolean; cancelled?: boolean; settings?: AppSettings; error?: string }>;
  listPresets: () => Promise<{ ok: boolean; presets?: CharacterPreset[] }>;
  savePreset: (payload: Partial<CharacterPreset> & { name?: string }) => Promise<{ ok: boolean; preset?: CharacterPreset; error?: string }>;
  applyPreset: (id: string) => Promise<{
    ok: boolean;
    preset?: CharacterPreset;
    settings?: AppSettings;
    custom_durations?: Record<string, CustomBuffEntry>;
    error?: string;
  }>;
  deletePreset: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onState: (callback: (state: EcoAppState) => void) => () => void;
  onSnapshot: (callback: (snapshot: Snapshot) => void) => () => void;
  onLog: (callback: (entry: EcoLogEntry) => void) => () => void;
  onUpdate: (callback: (update: EcoUpdateState) => void) => () => void;
  onOverlayEditing: (callback: (editing: boolean) => void) => () => void;
  onXiaoyaEvent: (callback: (payload: unknown) => void) => () => void;
};

declare global {
  interface Window {
    eco: EcoApi;
  }
}

export {};
