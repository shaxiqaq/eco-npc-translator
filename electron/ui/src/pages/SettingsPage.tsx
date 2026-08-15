import { useEffect, useMemo, useState } from 'react';
import { useEco } from '@/context/EcoContext';
import { normalizeAppearance } from '@/lib/appearance';
import { normalizeWarningSeconds } from '@/lib/buff-warning';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  SETTINGS_TABS,
  type HotkeysFormState,
  type JobPreset,
  type OverlayFormState,
  type StartupFormState,
  type TranslationFormState,
} from '@/pages/settings/constants';
import { AppearanceSection } from '@/pages/settings/AppearanceSection';
import { TranslationSection } from '@/pages/settings/TranslationSection';
import { OverlaySection } from '@/pages/settings/OverlaySection';
import { StartupSection } from '@/pages/settings/StartupSection';
import { DataSection } from '@/pages/settings/DataSection';
import { UpdatesSection } from '@/pages/settings/UpdatesSection';

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
  const [overlayForm, setOverlayForm] = useState<OverlayFormState>({
    visible: true,
    monitoring: true,
    scale: 1,
    opacity: 1,
    expiryWarningSeconds: 10,
    density: 'comfortable',
  });
  const [startupForm, setStartupForm] = useState<StartupFormState>({
    damage: false,
    monitoring: true,
    translator: false,
    overlay: true,
    tray: true,
    minimizeToTray: true,
    autoReconnect: true,
    prestartOnGame: true,
  });
  const [hotkeysForm, setHotkeysForm] = useState<HotkeysFormState>({
    toggleOverlay: 'CommandOrControl+Shift+O',
    toggleWindow: 'CommandOrControl+Shift+E',
  });
  const [presetName, setPresetName] = useState('');
  const [jobPresets, setJobPresets] = useState<JobPreset[]>([]);
  const [checkOnStartup, setCheckOnStartup] = useState(true);
  const [statusText, setStatusText] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settingsTab !== 'data') return;
    void (async () => {
      if (!window.eco.listJobPresets) return;
      const result = await window.eco.listJobPresets();
      if (result?.ok && Array.isArray(result.presets)) setJobPresets(result.presets as JobPreset[]);
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
      prestartOnGame: s.prestartOnGame !== false,
    });
    const h = state.settings?.hotkeys || {};
    setHotkeysForm({
      toggleOverlay: h.toggleOverlay || 'CommandOrControl+Shift+O',
      toggleWindow: h.toggleWindow || 'CommandOrControl+Shift+E',
    });
    setCheckOnStartup(state.settings?.updates?.checkOnStartup !== false);
  }, [state.translation, state.settings, providerPreset]);

  return (
    <div className="settings-layout">
      <Card className="settings-nav !flex !flex-col !gap-1 !p-2">
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
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
        {settingsTab === 'appearance' && (
          <AppearanceSection
            appearance={appearance}
            statusText={statusText.appearance || ''}
            previewAppearance={previewAppearance}
            pickBackground={pickBackground}
            clearBackground={clearBackground}
            onSave={(next) => saveAppearance(next)}
            onSaved={() => setStatusText((s) => ({ ...s, appearance: '已保存' }))}
            onStatus={(message) => setStatusText((s) => ({ ...s, appearance: message }))}
          />
        )}

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

        {settingsTab === 'overlay' && (
          <OverlaySection
            form={overlayForm}
            setForm={setOverlayForm}
            appearance={appearance}
            statusText={statusText.overlay || ''}
            overlayEditing={overlayEditing}
            overlayVisible={state.settings?.overlay?.visible !== false}
            overlayMonitoring={state.settings?.overlay?.monitoring !== false}
            previewAppearance={previewAppearance}
            pickBackground={pickBackground}
            clearBackground={clearBackground}
            toggleOverlayEditing={toggleOverlayEditing}
            setPage={setPage}
            onSave={(overlay, nextAppearance) => saveOverlaySettings(overlay as never, nextAppearance)}
            onSaved={() => setStatusText((s) => ({ ...s, overlay: '已保存' }))}
            onStatus={(message) => setStatusText((s) => ({ ...s, overlay: message }))}
          />
        )}

        {settingsTab === 'startup' && (
          <StartupSection
            startupForm={startupForm}
            setStartupForm={setStartupForm}
            hotkeysForm={hotkeysForm}
            setHotkeysForm={setHotkeysForm}
            statusText={statusText.startup || ''}
            onSave={async (startup, hotkeys) => {
              await saveStartupSettings(startup);
              await window.eco.saveAppSettings({ hotkeys });
              showToast('启动与热键设置已保存');
            }}
            onSaved={() => setStatusText((s) => ({ ...s, startup: '已保存' }))}
          />
        )}

        {settingsTab === 'data' && (
          <DataSection
            presetName={presetName}
            setPresetName={setPresetName}
            jobPresets={jobPresets}
            characterPresets={state.characterPresets || []}
            mainWindowTitle={state.rememberedTitles?.main}
            setPage={setPage}
            showToast={showToast}
            exportConfig={exportConfig}
            importConfig={importConfig}
            copyDiagnostics={copyDiagnostics}
            saveCharacterPreset={saveCharacterPreset}
            applyCharacterPreset={applyCharacterPreset}
            deleteCharacterPreset={deleteCharacterPreset}
          />
        )}

        {settingsTab === 'updates' && (
          <UpdatesSection
            update={state.update || {}}
            checkOnStartup={checkOnStartup}
            setCheckOnStartup={setCheckOnStartup}
            showToast={showToast}
            checkForUpdates={checkForUpdates}
            downloadUpdate={downloadUpdate}
            installUpdate={installUpdate}
          />
        )}
      </div>
    </div>
  );
}
