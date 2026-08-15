import type {
  EcoAppState,
  EcoLogEntry,
  EcoUpdateState,
  PageId,
  Snapshot,
  XiaoyaSkill,
  AppearanceSettings,
  TranslationSettings,
  AppSettings,
} from '@/types/eco';
import type { EditableCustomBuff } from '@/lib/custom-buffs';

export type ToastState = { message: string; id: number } | null;

export type EcoContextValue = {
  ready: boolean;
  page: PageId;
  setPage: (page: PageId) => void;
  state: EcoAppState;
  toast: ToastState;
  showToast: (message: string) => void;
  historyFilter: string;
  setHistoryFilter: (filter: string) => void;
  logFilter: string;
  setLogFilter: (filter: string) => void;
  overlayEditing: boolean;
  settingsTab: string;
  setSettingsTab: (tab: string) => void;
  xiaoyaSkills: XiaoyaSkill[];
  setXiaoyaSkills: React.Dispatch<React.SetStateAction<XiaoyaSkill[]>>;
  customBuffRows: EditableCustomBuff[];
  setCustomBuffRows: React.Dispatch<React.SetStateAction<EditableCustomBuff[]>>;
  updateDialogOpen: boolean;
  setUpdateDialogOpen: (open: boolean) => void;
  refreshState: () => Promise<void>;
  toggleService: (name: 'damage' | 'translator') => Promise<void>;
  startAll: () => Promise<void>;
  stopAll: () => Promise<void>;
  prestartServices: () => Promise<void>;
  resetDamage: () => Promise<void>;
  reidentifySelf: () => Promise<void>;
  /** Reconnect capture + clear meter + soft reidentify — one button for switch/account recovery. */
  switchCharacter: () => Promise<void>;
  selectGameProcess: (pid: number) => Promise<void>;
  selectXiaoyaProcess: (pid: number) => Promise<void>;
  refreshProcesses: () => Promise<void>;
  setStatusMonitoring: (enabled: boolean) => Promise<void>;
  setOverlayVisible: (visible: boolean) => Promise<void>;
  toggleOverlayEditing: () => Promise<void>;
  saveCaptureSetting: (key: string, enabled: boolean) => Promise<void>;
  saveXiaoyaConfig: () => Promise<void>;
  reloadXiaoyaConfig: () => Promise<void>;
  toggleXiaoya: () => Promise<void>;
  toggleXiaoyaSs: () => Promise<void>;
  toggleXiaoyaVisibility: () => Promise<void>;
  openXiaoyaFolder: () => Promise<void>;
  saveCustomBuffs: (quiet?: boolean) => Promise<void>;
  addCustomBuffRow: () => void;
  addSkillFromLibrary: (skillId: number, skillName: string) => void;
  saveAppearance: (appearance: AppearanceSettings) => Promise<void>;
  previewAppearance: (appearance: AppearanceSettings) => void;
  pickBackground: (target?: 'main' | 'overlay') => Promise<void>;
  clearBackground: (target?: 'main' | 'overlay') => Promise<void>;
  saveTranslation: (payload: TranslationSettings) => Promise<void>;
  saveOverlaySettings: (
    overlay: NonNullable<AppSettings['overlay']>,
    appearance?: AppearanceSettings,
  ) => Promise<void>;
  saveStartupSettings: (startup: NonNullable<AppSettings['startup']>) => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openLogs: () => Promise<void>;
  exportLogs: (filter?: string) => Promise<{
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    path?: string;
    count?: number;
  }>;
  providerPreset: (provider: string) => { model: string; url: string } | null;
  copyDiagnostics: () => Promise<{ ok: boolean; text?: string; error?: string }>;
  exportDiagnosticPack: () => Promise<{
    ok: boolean;
    cancelled?: boolean;
    path?: string;
    files?: number;
    error?: string;
  }>;
  reconnectGame: () => Promise<{ ok: boolean; error?: string; selectedPid?: number | null }>;
  setOnboardingSeen: (seen?: boolean) => Promise<{ ok: boolean }>;
  exportConfig: (includeSecrets?: boolean) => Promise<{ ok: boolean; cancelled?: boolean; path?: string; error?: string }>;
  importConfig: () => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
  saveCharacterPreset: (name: string) => Promise<{ ok: boolean; error?: string }>;
  applyCharacterPreset: (id: string) => Promise<{ ok: boolean; error?: string }>;
  deleteCharacterPreset: (id: string) => Promise<{ ok: boolean; error?: string }>;
};

// Re-export commonly used types for hooks
export type {
  EcoAppState,
  EcoLogEntry,
  EcoUpdateState,
  PageId,
  Snapshot,
  XiaoyaSkill,
  AppearanceSettings,
  TranslationSettings,
  AppSettings,
};
