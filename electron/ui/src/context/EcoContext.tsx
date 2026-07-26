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
import { applyAppearanceToDocument } from '@/lib/appearance';
import {
  entriesToEditable,
  normalizeCustomDurations,
  type EditableCustomBuff,
} from '@/lib/custom-buffs';
import { clearSkillIconCache } from '@/hooks/useSkillIcon';
import type {
  EcoAppState,
  EcoLogEntry,
  EcoUpdateState,
  PageId,
  Snapshot,
  XiaoyaSkill,
} from '@/types/eco';
import { appendLog, defaultXiaoyaSkills, mergeEcoState } from '@/context/eco-helpers';
import type { EcoContextValue, ToastState } from '@/context/eco-types';
import { useServiceActions } from '@/context/useServiceActions';
import { useXiaoyaActions } from '@/context/useXiaoyaActions';
import { useSettingsActions } from '@/context/useSettingsActions';

const EcoContext = createContext<EcoContextValue | null>(null);

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
    setState((prev) => mergeEcoState(prev, next as Partial<EcoAppState>));
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
          setState((prev) => mergeEcoState(prev, next as Partial<EcoAppState>));
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
            logs: appendLog(prev.logs, entry),
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

  const serviceActions = useServiceActions({ state, showToast, refreshState, setState });
  const xiaoyaActions = useXiaoyaActions({
    state,
    xiaoyaSkills,
    setXiaoyaSkills,
    showToast,
    refreshState,
  });
  const settingsActions = useSettingsActions({
    state,
    customBuffRows,
    setCustomBuffRows,
    setState,
    showToast,
    overlayEditing,
    setOverlayEditing,
  });

  const saveCustomBuffs = settingsActions.saveCustomBuffs;
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
  }, [customBuffRows, ready, saveCustomBuffs]);

  const checkForUpdates = useCallback(async () => {
    await settingsActions.checkForUpdates(dismissedUpdateVersion);
  }, [settingsActions.checkForUpdates]);

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
    ...serviceActions,
    ...xiaoyaActions,
    setOverlayVisible: settingsActions.setOverlayVisible,
    toggleOverlayEditing: settingsActions.toggleOverlayEditing,
    saveCaptureSetting: settingsActions.saveCaptureSetting,
    saveCustomBuffs: settingsActions.saveCustomBuffs,
    addCustomBuffRow: settingsActions.addCustomBuffRow,
    addSkillFromLibrary: settingsActions.addSkillFromLibrary,
    saveAppearance: settingsActions.saveAppearance,
    previewAppearance: settingsActions.previewAppearance,
    pickBackground: settingsActions.pickBackground,
    clearBackground: settingsActions.clearBackground,
    saveTranslation: settingsActions.saveTranslation,
    saveOverlaySettings: settingsActions.saveOverlaySettings,
    saveStartupSettings: settingsActions.saveStartupSettings,
    checkForUpdates,
    downloadUpdate: settingsActions.downloadUpdate,
    installUpdate: settingsActions.installUpdate,
    openLogs: settingsActions.openLogs,
    exportLogs: settingsActions.exportLogs,
    providerPreset: settingsActions.providerPreset,
    copyDiagnostics: settingsActions.copyDiagnostics,
    reconnectGame: settingsActions.reconnectGame,
    setOnboardingSeen: settingsActions.setOnboardingSeen,
    exportConfig: settingsActions.exportConfig,
    importConfig: settingsActions.importConfig,
    saveCharacterPreset: settingsActions.saveCharacterPreset,
    applyCharacterPreset: settingsActions.applyCharacterPreset,
    deleteCharacterPreset: settingsActions.deleteCharacterPreset,
  }), [
    ready, page, state, snapshot, toast, showToast, historyFilter, logFilter, overlayEditing,
    settingsTab, xiaoyaSkills, customBuffRows, updateDialogOpen, refreshState,
    serviceActions, xiaoyaActions, settingsActions, checkForUpdates,
  ]);

  return <EcoContext.Provider value={value}>{children}</EcoContext.Provider>;
}

export function useEco() {
  const ctx = useContext(EcoContext);
  if (!ctx) throw new Error('useEco must be used within EcoProvider');
  return ctx;
}
