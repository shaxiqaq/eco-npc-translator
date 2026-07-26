import { useCallback } from 'react';
import { applyAppearanceToDocument, normalizeAppearance, serializableAppearance } from '@/lib/appearance';
import { CAPTURE_KEYS, CAPTURE_LABELS, PROVIDERS } from '@/lib/damage';
import {
  editableToPayload,
  entriesToEditable,
  normalizeCustomDurations,
  type EditableCustomBuff,
} from '@/lib/custom-buffs';
import { normalizeWarningSeconds } from '@/lib/buff-warning';
import type { AppearanceSettings, AppSettings, EcoAppState, TranslationSettings } from '@/types/eco';

type ShowToast = (message: string) => void;

export function useSettingsActions(options: {
  state: EcoAppState;
  customBuffRows: EditableCustomBuff[];
  setCustomBuffRows: React.Dispatch<React.SetStateAction<EditableCustomBuff[]>>;
  setState: React.Dispatch<React.SetStateAction<EcoAppState>>;
  showToast: ShowToast;
  overlayEditing: boolean;
  setOverlayEditing: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    state,
    customBuffRows,
    setCustomBuffRows,
    setState,
    showToast,
    overlayEditing,
    setOverlayEditing,
  } = options;

  const setOverlayVisible = useCallback(async (visible: boolean) => {
    await window.eco.setOverlayVisible(visible);
    const result = await window.eco.saveAppSettings({ overlay: { visible } });
    setState((prev) => ({ ...prev, settings: result.settings }));
  }, [setState]);

  const toggleOverlayEditing = useCallback(async () => {
    const next = !overlayEditing;
    setOverlayEditing(next);
    await window.eco.setOverlayEditing(next);
    showToast(next ? '可拖动位置，拖右下角调整长宽' : '悬浮窗位置与大小已保存');
  }, [overlayEditing, showToast, setOverlayEditing]);

  const saveCaptureSetting = useCallback(async (key: string, enabled: boolean) => {
    const capture = {
      ...Object.fromEntries(CAPTURE_KEYS.map((item) => [item, state.settings?.capture?.[item] !== false])),
      [key]: enabled,
    };
    const result = await window.eco.saveAppSettings({ capture });
    setState((prev) => ({ ...prev, settings: result.settings }));
    showToast(`${CAPTURE_LABELS[key as keyof typeof CAPTURE_LABELS] || key}采集已${enabled ? '开启' : '关闭'}`);
  }, [state.settings?.capture, showToast, setState]);

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
  }, [customBuffRows, showToast, setCustomBuffRows, setState]);

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
  }, [setCustomBuffRows]);

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
  }, [showToast, setCustomBuffRows]);

  const previewAppearance = useCallback((appearance: AppearanceSettings) => {
    applyAppearanceToDocument(appearance);
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        appearance: normalizeAppearance(appearance),
      },
    }));
  }, [setState]);

  const saveAppearance = useCallback(async (appearance: AppearanceSettings) => {
    const result = await window.eco.saveAppSettings({ appearance: serializableAppearance(appearance) });
    setState((prev) => ({ ...prev, settings: result.settings }));
    applyAppearanceToDocument(result.settings?.appearance || appearance);
    showToast('外观设置已保存');
  }, [showToast, setState]);

  const pickBackground = useCallback(async (target: 'main' | 'overlay' = 'main') => {
    const result = await window.eco.pickBackgroundImage(target);
    if (!result?.ok) {
      if (!result?.cancelled) showToast(result?.error || '选择背景失败');
      return;
    }
    setState((prev) => ({ ...prev, settings: result.settings }));
    if (result.settings?.appearance) applyAppearanceToDocument(result.settings.appearance);
    showToast(target === 'overlay' ? '悬浮窗背景已应用' : '背景图已应用');
  }, [showToast, setState]);

  const clearBackground = useCallback(async (target: 'main' | 'overlay' = 'main') => {
    const result = await window.eco.clearBackgroundImage(target);
    if (!result?.ok) {
      showToast(result?.error || '清除背景失败');
      return;
    }
    setState((prev) => ({ ...prev, settings: result.settings }));
    if (result.settings?.appearance) applyAppearanceToDocument(result.settings.appearance);
    showToast(target === 'overlay' ? '悬浮窗已改为纯色背景' : '已清除自定义背景');
  }, [showToast, setState]);

  const saveTranslation = useCallback(async (payload: TranslationSettings) => {
    await window.eco.saveTranslationSettings(payload);
    setState((prev) => ({ ...prev, translation: payload }));
    showToast('翻译设置已保存');
  }, [showToast, setState]);

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
  }, [showToast, setState]);

  const saveStartupSettings = useCallback(async (startup: NonNullable<AppSettings['startup']>) => {
    const result = await window.eco.saveAppSettings({ startup });
    setState((prev) => ({ ...prev, settings: result.settings }));
    showToast('启动设置已保存');
  }, [showToast, setState]);

  const checkForUpdates = useCallback(async (dismissedUpdateVersion: React.MutableRefObject<string | null>) => {
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

  const copyDiagnostics = useCallback(async () => {
    if (!window.eco.copyDiagnostics) return { ok: false, error: '当前版本不支持复制诊断' };
    return window.eco.copyDiagnostics();
  }, []);

  const reconnectGame = useCallback(async () => {
    if (!window.eco.reconnectGame) return { ok: false, error: '当前版本不支持重连' };
    return window.eco.reconnectGame();
  }, []);

  const setOnboardingSeen = useCallback(async (seen = true) => {
    if (!window.eco.setOnboardingSeen) return { ok: true };
    const result = await window.eco.setOnboardingSeen(seen);
    if (result.settings) setState((prev) => ({ ...prev, settings: result.settings }));
    return result;
  }, [setState]);

  const exportConfig = useCallback(async (includeSecrets = false) => {
    if (!window.eco.exportConfig) return { ok: false, error: '当前版本不支持导出配置' };
    return window.eco.exportConfig({ includeSecrets });
  }, []);

  const importConfig = useCallback(async () => {
    if (!window.eco.importConfig) return { ok: false, error: '当前版本不支持导入配置' };
    const result = await window.eco.importConfig();
    if (result.ok && result.settings) {
      setState((prev) => ({ ...prev, settings: result.settings }));
      if (result.settings?.appearance) applyAppearanceToDocument(result.settings.appearance);
    }
    return result;
  }, [setState]);

  const saveCharacterPreset = useCallback(async (name: string) => {
    if (!window.eco.savePreset) return { ok: false, error: '当前版本不支持预设' };
    return window.eco.savePreset({
      name,
      capture: state.settings?.capture,
      custom_durations: state.custom_durations as Record<string, never>,
      overlay: {
        density: state.settings?.overlay?.density,
        expiryWarningSeconds: state.settings?.overlay?.expiryWarningSeconds,
      },
    });
  }, [state.settings, state.custom_durations]);

  const applyCharacterPreset = useCallback(async (id: string) => {
    if (!window.eco.applyPreset) return { ok: false, error: '当前版本不支持预设' };
    const result = await window.eco.applyPreset(id);
    if (result.ok) {
      if (result.settings) setState((prev) => ({ ...prev, settings: result.settings }));
      if (result.custom_durations) {
        setCustomBuffRows(entriesToEditable(normalizeCustomDurations(result.custom_durations)));
        setState((prev) => ({ ...prev, custom_durations: result.custom_durations }));
      }
    }
    return result;
  }, [setState, setCustomBuffRows]);

  const deleteCharacterPreset = useCallback(async (id: string) => {
    if (!window.eco.deletePreset) return { ok: false, error: '当前版本不支持预设' };
    return window.eco.deletePreset(id);
  }, []);

  return {
    setOverlayVisible,
    toggleOverlayEditing,
    saveCaptureSetting,
    saveCustomBuffs,
    addCustomBuffRow,
    addSkillFromLibrary,
    previewAppearance,
    saveAppearance,
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
    copyDiagnostics,
    reconnectGame,
    setOnboardingSeen,
    exportConfig,
    importConfig,
    saveCharacterPreset,
    applyCharacterPreset,
    deleteCharacterPreset,
  };
}
