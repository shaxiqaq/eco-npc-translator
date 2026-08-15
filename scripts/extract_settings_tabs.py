# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
src_path = ROOT / "electron/ui/src/pages/SettingsPage.tsx"
lines = src_path.read_text(encoding="utf-8").splitlines(keepends=True)

# 1-based inclusive content of each tab (the form/div, not the condition wrapper)
tabs = [
    ("AppearanceSection", 212, 363),
    ("OverlaySection", 378, 534),
    ("StartupSection", 536, 597),
    ("DataSection", 599, 846),
    ("UpdatesSection", 848, 926),
]

imports = '''import {
  Save,
  ImagePlus,
  ImageOff,
  Move,
  Check,
  RefreshCw,
  RotateCcw,
  LoaderCircle,
  Download,
} from 'lucide-react';
import {
  ACCENT_PRESETS,
  type AccentId,
} from '@/lib/appearance';
import { formatBytes } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TextLink } from '@/components/layout';
import { cn } from '@/lib/utils';
import { ACCENT_META } from '@/pages/settings/constants';

'''

out_dir = ROOT / "electron/ui/src/pages/settings"
out_dir.mkdir(parents=True, exist_ok=True)

for name, a, b in tabs:
    body = "".join(lines[a - 1 : b])
    # body already is the form/div element
    content = f"""/* Split from SettingsPage.tsx — props bag for gradual typing */
{imports}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function {name}(props: any) {{
  const {{
    appearance,
    previewAppearance,
    saveAppearance,
    pickBackground,
    clearBackground,
    statusText,
    setStatusText,
    overlayForm,
    setOverlayForm,
    saveOverlaySettings,
    state,
    setPage,
    toggleOverlayEditing,
    overlayEditing,
    startupForm,
    setStartupForm,
    saveStartupSettings,
    hotkeysForm,
    setHotkeysForm,
    checkOnStartup,
    setCheckOnStartup,
    exportConfig,
    importConfig,
    saveCharacterPreset,
    applyCharacterPreset,
    deleteCharacterPreset,
    presetName,
    setPresetName,
    jobPresets,
    showToast,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    update,
    updateMeta,
    phase,
    percent,
    progress,
    copyDiagnostics,
  }} = props;

  return (
{body}  );
}}
"""
    path = out_dir / f"{name}.tsx"
    path.write_text(content, encoding="utf-8")
    print("wrote", path.name, "lines", b - a + 1)

# Rewrite SettingsPage as shell
shell = '''import { useEffect, useMemo, useState } from 'react';
import { useEco } from '@/context/EcoContext';
import { normalizeAppearance } from '@/lib/appearance';
import { normalizeWarningSeconds } from '@/lib/buff-warning';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SETTINGS_TABS, type TranslationFormState } from '@/pages/settings/constants';
import { TranslationSection } from '@/pages/settings/TranslationSection';
import { AppearanceSection } from '@/pages/settings/AppearanceSection';
import { OverlaySection } from '@/pages/settings/OverlaySection';
import { StartupSection } from '@/pages/settings/StartupSection';
import { DataSection } from '@/pages/settings/DataSection';
import { UpdatesSection } from '@/pages/settings/UpdatesSection';

const TABS = SETTINGS_TABS;
// normalizeWarningSeconds used in useEffect below

export function SettingsPage() {
  const {
    state,
    settingsTab,
    setPage,
    setSettingsTab,
    saveAppearance,
    previewAppearance,
    pickBackground,
    clearBackground,
    saveTranslation,
    saveOverlaySettings,
    saveStartupSettings,
    providerPreset,
    toggleOverlayEditing,
    overlayEditing,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    showToast,
    exportConfig,
    importConfig,
    saveCharacterPreset,
    applyCharacterPreset,
    deleteCharacterPreset,
    copyDiagnostics,
  } = useEco();

  const appearance = useMemo(
    () => normalizeAppearance(state.settings?.appearance || {}),
    [state.settings?.appearance],
  );

  const [showKey, setShowKey] = useState(false);
  const [translationForm, setTranslationForm] = useState<TranslationFormState>({
    provider: 'deepseek',
    model: '',
    base_url: '',
    api_key: '',
    target_lang: 'zh-CN',
    source_lang: 'auto',
    first_wait: 0,
    player_names: '',
    toggle_hotkey: '',
    skip_hotkey: '',
    sync_enabled: true,
    sync_url: 'https://eco-npc-dict.w3145965836.workers.dev',
    sync_token: '',
  });
  const [overlayForm, setOverlayForm] = useState({
    visible: true,
    monitoring: true,
    scale: 1,
    opacity: 1,
    expiryWarningSeconds: 10,
    density: 'comfortable',
  });
  const [startupForm, setStartupForm] = useState({
    damage: false,
    monitoring: true,
    translator: false,
    overlay: true,
    tray: true,
    minimizeToTray: true,
    autoReconnect: true,
  });
  const [hotkeysForm, setHotkeysForm] = useState({
    toggleOverlay: 'CommandOrControl+Shift+O',
    toggleWindow: 'CommandOrControl+Shift+E',
  });
  const [presetName, setPresetName] = useState('');
  const [jobPresets, setJobPresets] = useState<Array<Record<string, unknown>>>([]);
  const [checkOnStartup, setCheckOnStartup] = useState(true);
  const [statusText, setStatusText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settingsTab !== 'data') return;
    void (async () => {
      if (!window.eco.listJobPresets) return;
      const result = await window.eco.listJobPresets();
      if (result?.ok && Array.isArray(result.presets)) setJobPresets(result.presets);
    })();
  }, [settingsTab]);

  useEffect(() => {
    const t = state.translation || {};
    const provider = t.provider || 'deepseek';
    const preset = providerPreset(provider);
    setTranslationForm({
      provider,
      model: t.model || preset?.model || (provider === 'deepseek' ? 'deepseek-chat' : ''),
      base_url: t.base_url || preset?.url || '',
      api_key: t.api_key || '',
      target_lang: t.target_lang || 'zh-CN',
      source_lang: t.source_lang || 'auto',
      first_wait: Number(t.first_wait ?? 0),
      player_names: (t.player_names || []).join(', '),
      toggle_hotkey: t.toggle_hotkey || '',
      skip_hotkey: t.skip_hotkey || '',
      sync_enabled: Boolean(t.sync_enabled),
      sync_url: t.sync_url || '',
      sync_token: t.sync_token || '',
    });
    const o = state.settings?.overlay || {};
    setOverlayForm({
      visible: o.visible !== false,
      monitoring: o.monitoring !== false,
      scale: o.scale || 1,
      opacity: o.opacity ?? 1,
      expiryWarningSeconds: normalizeWarningSeconds(o.expiryWarningSeconds),
      density: String(o.density || 'comfortable'),
    });
    const s = state.settings?.startup || {};
    setStartupForm({
      damage: Boolean(s.damage),
      monitoring: s.monitoring !== false,
      translator: Boolean(s.translator),
      overlay: s.overlay !== false,
      tray: s.tray !== false,
      minimizeToTray: s.minimizeToTray !== false,
      autoReconnect: s.autoReconnect !== false,
    });
    const h = state.settings?.hotkeys || {};
    setHotkeysForm({
      toggleOverlay: h.toggleOverlay || 'CommandOrControl+Shift+O',
      toggleWindow: h.toggleWindow || 'CommandOrControl+Shift+E',
    });
    setCheckOnStartup(state.settings?.updates?.checkOnStartup !== false);
  }, [state.translation, state.settings, providerPreset]);

  const update = state.update || {};
  const phase = update.phase || 'idle';
  const progress = update.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const updateMeta = (() => {
    const map: Record<string, [string, string]> = {
      idle: ['等待检查更新', '可随时手动检查'],
      checking: ['正在检查更新', '正在连接 GitHub Releases'],
      available: ['发现新版本', '点击下载后才会开始传输'],
      downloading: ['正在下载更新', '程序可以继续使用'],
      downloaded: ['更新已下载', '重启程序完成安装'],
      'not-available': ['当前已是最新版本', '没有可用更新'],
      error: ['检查更新失败', '请检查网络后重试'],
      unsupported: ['开发模式不检查更新', '请使用正式安装版'],
    };
    return map[phase] || map.idle;
  })();

  const sectionProps = {
    appearance,
    previewAppearance,
    saveAppearance,
    pickBackground,
    clearBackground,
    statusText,
    setStatusText,
    overlayForm,
    setOverlayForm,
    saveOverlaySettings,
    state,
    setPage,
    toggleOverlayEditing,
    overlayEditing,
    startupForm,
    setStartupForm,
    saveStartupSettings,
    hotkeysForm,
    setHotkeysForm,
    checkOnStartup,
    setCheckOnStartup,
    exportConfig,
    importConfig,
    saveCharacterPreset,
    applyCharacterPreset,
    deleteCharacterPreset,
    presetName,
    setPresetName,
    jobPresets,
    showToast,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    update,
    updateMeta,
    phase,
    percent,
    progress,
    copyDiagnostics,
  };

  return (
    <div className="settings-layout">
      <Card className="settings-nav !flex !flex-col !gap-1 !p-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-transparent px-3 py-2.5 text-left text-xs transition-colors',
              settingsTab === id
                ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] font-semibold text-[var(--amber-hi)]'
                : 'text-[var(--muted-foreground)] hover:bg-white/[0.04] hover:text-[var(--foreground)]',
            )}
            data-settings-tab={id}
            onClick={() => setSettingsTab(id)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </Card>

      <div className="settings-content min-w-0">
        {settingsTab === 'appearance' && <AppearanceSection {...sectionProps} />}
        {settingsTab === 'translation' && (
          <TranslationSection
            form={translationForm}
            setForm={setTranslationForm}
            showKey={showKey}
            setShowKey={setShowKey}
            statusText={statusText.translation || ''}
            providerPreset={providerPreset}
            onSave={(payload) => saveTranslation(payload as never)}
            onSaved={() => setStatusText((s) => ({ ...s, translation: '已保存' }))}
          />
        )}
        {settingsTab === 'overlay' && <OverlaySection {...sectionProps} />}
        {settingsTab === 'startup' && <StartupSection {...sectionProps} />}
        {settingsTab === 'data' && <DataSection {...sectionProps} />}
        {settingsTab === 'updates' && <UpdatesSection {...sectionProps} />}
      </div>
    </div>
  );
}
'''

src_path = ROOT / "electron/ui/src/pages/SettingsPage.tsx"
src_path.write_text(shell, encoding="utf-8")
print("rewrote SettingsPage shell")
