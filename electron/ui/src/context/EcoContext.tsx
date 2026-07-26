import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { applyAppearanceToDocument, normalizeAppearance, serializableAppearance } from '@/lib/appearance';
import { CAPTURE_KEYS, CAPTURE_LABELS, PROVIDERS } from '@/lib/damage';
import {
  editableToPayload,
  entriesToEditable,
  normalizeCustomDurations,
  type EditableCustomBuff,
} from '@/lib/custom-buffs';
import { clearSkillIconCache } from '@/hooks/useSkillIcon';
import { normalizeWarningSeconds } from '@/lib/buff-warning';
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

type ToastState = { message: string; id: number } | null;

type EcoContextValue = {
  ready: boolean;
  page: PageId;
  setPage: (page: PageId) => void;
  state: EcoAppState;
  snapshot: Snapshot | null;
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
  resetDamage: () => Promise<void>;
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
  saveOverlaySettings: (overlay: NonNullable<AppSettings['overlay']>, appearance?: AppearanceSettings) => Promise<void>;
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
};

const EcoContext = createContext<EcoContextValue | null>(null);

const defaultXiaoyaSkills = (): XiaoyaSkill[] =>
  Array.from({ length: 6 }, () => ({ enabled: false, skillTime: 0, mouse: false, delay: 0 }));

export function EcoProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<PageId>('overview');
  const [state, setState] = useState<EcoAppState>({});
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [logFilter, setLogFilter] = useState('all');
  const [overlayEditing, setOverlayEditing] = useState(false);
  const [settingsTab, setSettingsTab] = useState('appearance');
  const [xiaoyaSkills, setXiaoyaSkills] = useState<XiaoyaSkill[]>(defaultXiaoyaSkills);
  const [customBuffRows, setCustomBuffRows] = useState<EditableCustomBuff[]>([]);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const customSaveTimer = useRef<number | null>(null);
  const dismissedUpdateVersion = useRef<string | null>(null);
  const downloadedPromptVersion = useRef<string | null>(null);
  const iconProcessPid = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast({ message, id: Date.now() });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const syncCustomRows = useCallback((raw: Record<string, unknown> | undefined) => {
    const normalized = normalizeCustomDurations(raw);
    setCustomBuffRows(entriesToEditable(normalized));
    return normalized;
  }, []);

  const refreshState = useCallback(async () => {
    const next = await window.eco.getState();
    setState((prev) => ({ ...prev, ...next }));
    if (next.snapshot) setSnapshot(next.snapshot);
    if (next.settings?.appearance) applyAppearanceToDocument(next.settings.appearance);
    const pid = Number(next.selectedGamePid) || null;
    if (pid !== iconProcessPid.current) {
      iconProcessPid.current = pid;
      clearSkillIconCache();
    }
  }, []);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    (async () => {
      if (!window.eco) {
        console.error('window.eco is missing — preload bridge not available');
        setReady(true);
        return;
      }
      const initial = await window.eco.getState();
      setState(initial);
      setSnapshot(initial.snapshot || null);
      if (initial.settings?.appearance) applyAppearanceToDocument(initial.settings.appearance);
      iconProcessPid.current = Number(initial.selectedGamePid) || null;

      try {
        const saved = await window.eco.getBuffCustomDurations();
        if (saved?.ok) syncCustomRows(saved.custom_durations as Record<string, unknown>);
        else syncCustomRows(initial.custom_durations as Record<string, unknown>);
      } catch {
        syncCustomRows(initial.custom_durations as Record<string, unknown>);
      }

      try {
        const xiaoyaConfig = await window.eco.getXiaoyaConfig();
        if (xiaoyaConfig.ok && Array.isArray(xiaoyaConfig.skills)) {
          const skills = [...defaultXiaoyaSkills()];
          xiaoyaConfig.skills.forEach((skill, index) => {
            if (index < 6) skills[index] = { ...skills[index], ...skill };
          });
          setXiaoyaSkills(skills);
          if (xiaoyaConfig.state) {
            setState((prev) => ({ ...prev, xiaoya: xiaoyaConfig.state }));
          }
        }
      } catch {
        // ignore
      }

      unsubs = [
        window.eco.onState((next) => {
          setState((prev) => {
            const merged = { ...prev, ...next };
            if (next.custom_durations) {
              // Keep local editor rows if user is typing — only update when not focused on custom editor.
              // Handled separately via explicit reloads.
            }
            return merged;
          });
          if (next.settings?.appearance) applyAppearanceToDocument(next.settings.appearance);
          const pid = Number(next.selectedGamePid) || null;
          if (pid !== iconProcessPid.current) {
            iconProcessPid.current = pid;
            clearSkillIconCache();
          }
        }),
        window.eco.onSnapshot((snap) => setSnapshot(snap)),
        window.eco.onLog((entry: EcoLogEntry) => {
          setState((prev) => ({
            ...prev,
            logs: [...(prev.logs || []), entry].slice(-1000),
          }));
        }),
        window.eco.onUpdate((update: EcoUpdateState) => {
          setState((prev) => ({ ...prev, update }));
          if (update.phase === 'available' && update.availableVersion !== dismissedUpdateVersion.current) {
            setUpdateDialogOpen(true);
          }
          if (update.phase === 'downloaded' && update.availableVersion !== downloadedPromptVersion.current) {
            downloadedPromptVersion.current = update.availableVersion || null;
            setUpdateDialogOpen(true);
          }
        }),
        window.eco.onOverlayEditing((editing) => setOverlayEditing(Boolean(editing))),
      ];
      setReady(true);
    })();

    return () => {
      unsubs.forEach((fn) => fn());
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (customSaveTimer.current) window.clearTimeout(customSaveTimer.current);
    };
  }, [syncCustomRows]);

  const toggleService = useCallback(async (name: 'damage' | 'translator') => {
    const running = ['running', 'starting'].includes(state.services?.[name]?.state || '');
    const result = running ? await window.eco.stopService(name) : await window.eco.startService(name);
    if (!result.ok && result.error) showToast(result.error);
    await refreshState();
  }, [state.services, showToast, refreshState]);

  const startAll = useCallback(async () => {
    const results = await Promise.all([
      window.eco.startService('damage'),
      window.eco.startService('translator'),
    ]);
    const failed = results.find((result) => !result.ok);
    if (failed?.error) showToast(failed.error);
    await refreshState();
  }, [showToast, refreshState]);

  const stopAll = useCallback(async () => {
    await Promise.all([window.eco.stopService('damage'), window.eco.stopService('translator')]);
    await refreshState();
  }, [refreshState]);

  const resetDamage = useCallback(async () => {
    await window.eco.resetDamage();
    showToast('伤害统计已清空');
  }, [showToast]);

  const selectGameProcess = useCallback(async (pid: number) => {
    const result = await window.eco.selectGameProcess(pid);
    await refreshState();
    showToast(result.ok ? `已选择主进程 ${result.selectedPid}` : result.error || '选择失败');
  }, [refreshState, showToast]);

  const selectXiaoyaProcess = useCallback(async (pid: number) => {
    const result = await window.eco.selectXiaoyaProcess(pid);
    await refreshState();
    showToast(result.ok ? `小雅目标进程 ${result.selectedXiaoyaPid}` : result.error || '选择失败');
  }, [refreshState, showToast]);

  const refreshProcesses = useCallback(async () => {
    const result = await window.eco.refreshGameProcesses();
    await refreshState();
    showToast(result.ok ? `找到 ${result.processes?.length || 0} 个游戏进程` : result.error || '刷新失败');
  }, [refreshState, showToast]);

  const setStatusMonitoring = useCallback(async (enabled: boolean) => {
    const result = await window.eco.saveAppSettings({ overlay: { monitoring: enabled } });
    setState((prev) => ({ ...prev, settings: result.settings }));
    await refreshState();
    const service = (await window.eco.getState()).services?.monitoring;
    if (enabled && service?.state === 'error') {
      showToast(service.message || '状态监控启动失败');
    } else {
      showToast(enabled ? '状态监控已开启（无需伤害采集）' : '状态监控已关闭');
    }
  }, [refreshState, showToast]);

  const setOverlayVisible = useCallback(async (visible: boolean) => {
    await window.eco.setOverlayVisible(visible);
    const result = await window.eco.saveAppSettings({ overlay: { visible } });
    setState((prev) => ({ ...prev, settings: result.settings }));
  }, []);

  const toggleOverlayEditing = useCallback(async () => {
    const next = !overlayEditing;
    setOverlayEditing(next);
    await window.eco.setOverlayEditing(next);
    showToast(next ? '可拖动位置，拖右下角调整长宽' : '悬浮窗位置与大小已保存');
  }, [overlayEditing, showToast]);

  const saveCaptureSetting = useCallback(async (key: string, enabled: boolean) => {
    const capture = {
      ...Object.fromEntries(CAPTURE_KEYS.map((item) => [item, state.settings?.capture?.[item] !== false])),
      [key]: enabled,
    };
    const result = await window.eco.saveAppSettings({ capture });
    setState((prev) => ({ ...prev, settings: result.settings }));
    showToast(`${CAPTURE_LABELS[key as keyof typeof CAPTURE_LABELS] || key}采集已${enabled ? '开启' : '关闭'}`);
  }, [state.settings?.capture, showToast]);

  const saveXiaoyaConfig = useCallback(async () => {
    const result = await window.eco.saveXiaoyaConfig(xiaoyaSkills);
    if (!result.ok) {
      showToast(result.error || '保存失败');
      return;
    }
    if (result.skills) {
      const skills = [...defaultXiaoyaSkills()];
      result.skills.forEach((skill, index) => {
        if (index < 6) skills[index] = { ...skills[index], ...skill };
      });
      setXiaoyaSkills(skills);
    }
    showToast('小雅配置已保存');
  }, [xiaoyaSkills, showToast]);

  const reloadXiaoyaConfig = useCallback(async () => {
    const result = await window.eco.getXiaoyaConfig();
    if (!result.ok) {
      showToast(result.error || '读取失败');
      return;
    }
    if (result.skills) {
      const skills = [...defaultXiaoyaSkills()];
      result.skills.forEach((skill, index) => {
        if (index < 6) skills[index] = { ...skills[index], ...skill };
      });
      setXiaoyaSkills(skills);
    }
    showToast('已读取上次设置');
  }, [showToast]);

  const toggleXiaoya = useCallback(async () => {
    const active = ['starting', 'running', 'stopping'].includes(state.xiaoya?.state || '');
    const result = active ? await window.eco.stopXiaoya() : await window.eco.startXiaoya();
    if (!result.ok && result.error) showToast(result.error);
    await refreshState();
  }, [state.xiaoya?.state, showToast, refreshState]);

  const toggleXiaoyaSs = useCallback(async () => {
    const result = await window.eco.toggleXiaoyaSs();
    if (!result.ok && result.error) showToast(result.error);
    else showToast('已切换 SS');
  }, [showToast]);

  const toggleXiaoyaVisibility = useCallback(async () => {
    const result = await window.eco.toggleXiaoyaVisibility();
    if (!result.ok && result.error) showToast(result.error);
    else showToast('已切换 ECO 显示/隐藏');
  }, [showToast]);

  const openXiaoyaFolder = useCallback(async () => {
    const result = await window.eco.openXiaoyaFolder();
    if (!result.ok) showToast(result.error || '无法打开小雅目录');
  }, [showToast]);

  const saveCustomBuffs = useCallback(async (quiet = false) => {
    const payload = editableToPayload(customBuffRows);
    const result = await window.eco.saveBuffCustomDurations(payload);
    if (!result?.ok) {
      if (!quiet) showToast(result?.error || '保存自定义倒计时失败');
      return;
    }
    const next = normalizeCustomDurations(result.custom_durations || payload);
    setCustomBuffRows(entriesToEditable(next));
    setState((prev) => ({ ...prev, custom_durations: next }));
    if (!quiet) {
      const count = Object.keys(next).length;
      showToast(count ? `已保存 ${count} 条到本地，重启后仍有效` : '已清空并保存到本地');
    }
  }, [customBuffRows, showToast]);

  const customBuffHydrated = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (!customBuffHydrated.current) {
      customBuffHydrated.current = true;
      return;
    }
    if (customSaveTimer.current) window.clearTimeout(customSaveTimer.current);
    customSaveTimer.current = window.setTimeout(() => {
      void saveCustomBuffs(true);
    }, 900);
    return () => {
      if (customSaveTimer.current) window.clearTimeout(customSaveTimer.current);
    };
  }, [customBuffRows, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const addCustomBuffRow = useCallback(() => {
    setCustomBuffRows((rows) => [
      ...rows,
      {
        id: `new-${Date.now()}`,
        key: '',
        duration: '30',
        cooldown: '',
        skill_id: '',
        label: '',
        overlay: false,
      },
    ]);
  }, []);

  const addSkillFromLibrary = useCallback((skillId: number, skillName: string) => {
    const id = Number(skillId);
    if (!Number.isInteger(id) || id <= 0) return;
    const key = `skill:${id}`;
    setCustomBuffRows((rows) => {
      if (rows.some((row) => row.key === key || row.key === String(id))) {
        showToast('该技能已在倒计时列表中');
        return rows;
      }
      showToast(`已添加 ${skillName || `技能#${id}`}，请填写持续/CD 秒数`);
      return [
        ...rows,
        {
          id: `${key}-${Date.now()}`,
          key,
          duration: '',
          cooldown: '30',
          skill_id: String(id),
          label: String(skillName || '').trim() || `技能#${id}`,
          overlay: true,
        },
      ];
    });
  }, [showToast]);

  const previewAppearance = useCallback((appearance: AppearanceSettings) => {
    applyAppearanceToDocument(appearance);
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        appearance: normalizeAppearance(appearance),
      },
    }));
  }, []);

  const saveAppearance = useCallback(async (appearance: AppearanceSettings) => {
    const result = await window.eco.saveAppSettings({ appearance: serializableAppearance(appearance) });
    setState((prev) => ({ ...prev, settings: result.settings }));
    applyAppearanceToDocument(result.settings?.appearance || appearance);
    showToast('外观设置已保存');
  }, [showToast]);

  const pickBackground = useCallback(async (target: 'main' | 'overlay' = 'main') => {
    const result = await window.eco.pickBackgroundImage(target);
    if (!result?.ok) {
      if (!result?.cancelled) showToast(result?.error || '选择背景失败');
      return;
    }
    setState((prev) => ({ ...prev, settings: result.settings }));
    if (result.settings?.appearance) applyAppearanceToDocument(result.settings.appearance);
    showToast(target === 'overlay' ? '悬浮窗背景已应用' : '背景图已应用');
  }, [showToast]);

  const clearBackground = useCallback(async (target: 'main' | 'overlay' = 'main') => {
    const result = await window.eco.clearBackgroundImage(target);
    if (!result?.ok) {
      showToast(result?.error || '清除背景失败');
      return;
    }
    setState((prev) => ({ ...prev, settings: result.settings }));
    if (result.settings?.appearance) applyAppearanceToDocument(result.settings.appearance);
    showToast(target === 'overlay' ? '悬浮窗已改为纯色背景' : '已清除自定义背景');
  }, [showToast]);

  const saveTranslation = useCallback(async (payload: TranslationSettings) => {
    await window.eco.saveTranslationSettings(payload);
    setState((prev) => ({ ...prev, translation: payload }));
    showToast('翻译设置已保存');
  }, [showToast]);

  const saveOverlaySettings = useCallback(async (
    overlay: NonNullable<AppSettings['overlay']>,
    appearance?: AppearanceSettings,
  ) => {
    const payload: Partial<AppSettings> = {
      overlay: {
        ...overlay,
        expiryWarningSeconds: normalizeWarningSeconds(overlay.expiryWarningSeconds),
      },
    };
    if (appearance) payload.appearance = serializableAppearance(appearance);
    const result = await window.eco.saveAppSettings(payload);
    setState((prev) => ({ ...prev, settings: result.settings }));
    if (result.settings?.appearance) applyAppearanceToDocument(result.settings.appearance);
    await window.eco.setOverlayVisible(overlay.visible !== false);
    showToast('悬浮窗设置已保存');
  }, [showToast]);

  const saveStartupSettings = useCallback(async (startup: NonNullable<AppSettings['startup']>) => {
    const result = await window.eco.saveAppSettings({ startup });
    setState((prev) => ({ ...prev, settings: result.settings }));
    showToast('启动设置已保存');
  }, [showToast]);

  const checkForUpdates = useCallback(async () => {
    dismissedUpdateVersion.current = null;
    const result = await window.eco.checkForUpdates();
    if (!result.ok && result.error) showToast(result.error);
  }, [showToast]);

  const downloadUpdate = useCallback(async () => {
    const result = await window.eco.downloadUpdate();
    if (!result.ok && result.error) showToast(result.error);
  }, [showToast]);

  const installUpdate = useCallback(async () => {
    const result = await window.eco.installUpdate();
    if (!result.ok && result.error) showToast(result.error);
  }, [showToast]);

  const openLogs = useCallback(async () => {
    await window.eco.openLogs();
  }, []);

  const exportLogs = useCallback(async (filter = 'all') => {
    if (!window.eco.exportLogs) {
      return { ok: false, error: '当前版本不支持导出日志' };
    }
    return window.eco.exportLogs({ filter, format: 'txt' });
  }, []);

  const providerPreset = useCallback((provider: string) => PROVIDERS[provider] || null, []);

  const value = useMemo<EcoContextValue>(() => ({
    ready,
    page,
    setPage,
    state,
    snapshot,
    toast,
    showToast,
    historyFilter,
    setHistoryFilter,
    logFilter,
    setLogFilter,
    overlayEditing,
    settingsTab,
    setSettingsTab,
    xiaoyaSkills,
    setXiaoyaSkills,
    customBuffRows,
    setCustomBuffRows,
    updateDialogOpen,
    setUpdateDialogOpen: (open) => {
      if (!open) dismissedUpdateVersion.current = state.update?.availableVersion || null;
      setUpdateDialogOpen(open);
    },
    refreshState,
    toggleService,
    startAll,
    stopAll,
    resetDamage,
    selectGameProcess,
    selectXiaoyaProcess,
    refreshProcesses,
    setStatusMonitoring,
    setOverlayVisible,
    toggleOverlayEditing,
    saveCaptureSetting,
    saveXiaoyaConfig,
    reloadXiaoyaConfig,
    toggleXiaoya,
    toggleXiaoyaSs,
    toggleXiaoyaVisibility,
    openXiaoyaFolder,
    saveCustomBuffs,
    addCustomBuffRow,
    addSkillFromLibrary,
    saveAppearance,
    previewAppearance,
    pickBackground,
    clearBackground,
    saveTranslation,
    saveOverlaySettings,
    saveStartupSettings,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    openLogs,
    exportLogs,
    providerPreset,
  }), [
    ready, page, state, snapshot, toast, showToast, historyFilter, logFilter, overlayEditing,
    settingsTab, xiaoyaSkills, customBuffRows, updateDialogOpen, refreshState, toggleService,
    startAll, stopAll, resetDamage, selectGameProcess, selectXiaoyaProcess, refreshProcesses,
    setStatusMonitoring, setOverlayVisible, toggleOverlayEditing, saveCaptureSetting,
    saveXiaoyaConfig, reloadXiaoyaConfig, toggleXiaoya, toggleXiaoyaSs, toggleXiaoyaVisibility,
    openXiaoyaFolder, saveCustomBuffs, addCustomBuffRow, addSkillFromLibrary, saveAppearance,
    previewAppearance, pickBackground, clearBackground, saveTranslation, saveOverlaySettings,
    saveStartupSettings, checkForUpdates, downloadUpdate, installUpdate, openLogs, exportLogs, providerPreset,
  ]);

  return <EcoContext.Provider value={value}>{children}</EcoContext.Provider>;
}

export function useEco() {
  const ctx = useContext(EcoContext);
  if (!ctx) throw new Error('useEco must be used within EcoProvider');
  return ctx;
}
