import { useEffect, useMemo, useState } from 'react';
import {
  Palette,
  Languages,
  PictureInPicture2,
  Power,
  Download,
  Save,
  ImagePlus,
  ImageOff,
  Move,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  RotateCcw,
  LoaderCircle,
} from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import {
  ACCENT_PRESETS,
  normalizeAppearance,
  overlayBgModeHint,
  type AccentId,
} from '@/lib/appearance';
import { formatBytes } from '@/lib/format';
import { normalizeWarningSeconds } from '@/lib/buff-warning';
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

const TABS = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'translation', label: '翻译服务', icon: Languages },
  { id: 'overlay', label: '悬浮窗', icon: PictureInPicture2 },
  { id: 'startup', label: '启动行为', icon: Power },
  { id: 'data', label: '配置与预设', icon: Save },
  { id: 'updates', label: '软件更新', icon: Download },
] as const;

const ACCENT_META: Record<AccentId, { title: string; desc: string }> = {
  amber: { title: '琥珀金', desc: '默认温暖强调' },
  teal: { title: '青绿', desc: '清爽辅助感' },
  violet: { title: '紫罗兰', desc: '偏夜间氛围' },
  rose: { title: '玫瑰粉', desc: '柔和对比' },
  cyan: { title: '青蓝', desc: '信息向冷色' },
  slate: { title: '石板灰', desc: '低饱和克制' },
};

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
  const [translationForm, setTranslationForm] = useState({
    provider: 'deepseek',
    model: '',
    base_url: '',
    api_key: '',
    target_lang: 'zh-CN',
    first_wait: 0,
    player_names: '',
    toggle_hotkey: '',
    skip_hotkey: '',
    sync_enabled: false,
    sync_url: '',
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
    setTranslationForm({
      provider: t.provider || 'deepseek',
      model: t.model || '',
      base_url: t.base_url || '',
      api_key: t.api_key || '',
      target_lang: t.target_lang || 'zh-CN',
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
  }, [state.translation, state.settings]);

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
        {settingsTab === 'appearance' && (
          <form
            className="settings-pane active space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveAppearance(appearance).then(() => {
                setStatusText((s) => ({ ...s, appearance: '已保存' }));
              });
            }}
          >
            <div className="settings-block">
              <div className="form-heading">
                <h2>强调色主题</h2>
                <p>一键切换界面主色；导航高亮、主按钮、焦点环会同步变化</p>
              </div>
              <div className="accent-presets">
                {ACCENT_PRESETS.map((accent) => (
                  <button
                    key={accent}
                    type="button"
                    className={cn('accent-preset', appearance.accent === accent && 'active')}
                    data-accent={accent}
                    onClick={() => {
                      previewAppearance({ ...appearance, accent });
                      setStatusText((s) => ({ ...s, appearance: '强调色已预览，记得保存' }));
                    }}
                  >
                    <i className="accent-preset-swatch" aria-hidden />
                    <span>
                      <strong>{ACCENT_META[accent].title}</strong>
                      <span>{ACCENT_META[accent].desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-block space-y-3">
              <div className="form-heading">
                <h2>技能名称显示</h2>
                <p>
                  对照客户端表与日文名称（lycolia Wiki / 客户端片假名）。
                  数据源见帮助页。
                </p>
              </div>
              <ToggleGroup
                fullWidth
                value={String(appearance.skillNameMode || 'client')}
                onValueChange={(mode) => {
                  previewAppearance({ ...appearance, skillNameMode: mode });
                  setStatusText((s) => ({ ...s, appearance: '名称模式已预览，记得保存' }));
                }}
              >
                <ToggleGroupItem value="client">客户端/中文</ToggleGroupItem>
                <ToggleGroupItem value="ja">日文</ToggleGroupItem>
                <ToggleGroupItem value="dual">双显</ToggleGroupItem>
              </ToggleGroup>
              <p className="m-0 text-[11px] text-[var(--muted-foreground)]">
                双显示例：击援手 / アタックアシスト。采集后端在保存后会同步此模式。
              </p>
            </div>

            <div className="settings-block">
              <div className="form-heading">
                <h2>外观与背景</h2>
                <p>主窗口壁纸。悬浮窗背景请到「悬浮窗」里单独选择</p>
              </div>
              <div className="appearance-preview">
                <div
                  className="appearance-preview-image"
                  style={{
                    backgroundImage:
                      appearance.backgroundUrl
                      || appearance.backgroundDataUrl
                      || appearance.backgroundFileUrl
                        ? `url("${String(appearance.backgroundUrl || appearance.backgroundDataUrl || appearance.backgroundFileUrl).replace(/"/g, '\\"')}")`
                        : 'none',
                    backgroundSize: appearance.backgroundFit === 'fill' ? '100% 100%' : appearance.backgroundFit,
                    filter: `blur(${Math.min(12, appearance.backgroundBlur)}px)`,
                  }}
                />
                <div
                  className="appearance-preview-mask"
                  style={{ background: `rgba(8, 6, 14, ${appearance.backgroundDim})` }}
                />
                <div className="appearance-preview-copy">
                  <strong>
                    {appearance.backgroundImage || appearance.backgroundUrl
                      ? '自定义壁纸预览'
                      : '默认深色主题'}
                  </strong>
                  <span>
                    {appearance.backgroundImage || appearance.backgroundUrl
                      ? '遮罩与模糊可实时调整，保存后立即生效'
                      : '选择一张图片作为壁纸背景'}
                  </span>
                </div>
              </div>
              <div className="appearance-actions">
                <Button type="button" onClick={() => void pickBackground('main')}>
                  <ImagePlus className="h-4 w-4" />选择背景图
                </Button>
                <Button type="button" variant="secondary" onClick={() => void clearBackground('main')}>
                  <ImageOff className="h-4 w-4" />清除背景
                </Button>
              </div>
              <div className="appearance-path">
                {appearance.backgroundImage || appearance.backgroundUrl
                  ? appearance.backgroundImage || '已设置自定义背景'
                  : '未设置自定义背景'}
              </div>
              <label className="range-row">
                <div><strong>遮罩强度</strong><span>{Math.round(appearance.backgroundDim * 100)}%</span></div>
                <Slider
                  min={0.15}
                  max={0.85}
                  step={0.01}
                  value={[appearance.backgroundDim]}
                  onValueChange={([value]) => previewAppearance({ ...appearance, backgroundDim: value })}
                />
              </label>
              <label className="range-row">
                <div><strong>背景模糊</strong><span>{appearance.backgroundBlur}px</span></div>
                <Slider
                  min={0}
                  max={20}
                  step={1}
                  value={[appearance.backgroundBlur]}
                  onValueChange={([value]) => previewAppearance({ ...appearance, backgroundBlur: value })}
                />
              </label>
              <label className="toggle-row">
                <div><strong>适应方式</strong><span>cover 铺满 · contain 完整显示 · fill 拉伸</span></div>
                <Select
                  value={appearance.backgroundFit}
                  onValueChange={(value) => previewAppearance({ ...appearance, backgroundFit: value })}
                >
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">覆盖铺满</SelectItem>
                    <SelectItem value="contain">完整显示</SelectItem>
                    <SelectItem value="fill">拉伸填满</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <div className="form-actions">
                <span className="save-status">{statusText.appearance || ''}</span>
                <Button type="submit"><Save className="h-4 w-4" />保存外观设置</Button>
              </div>
            </div>
          </form>
        )}

        {settingsTab === 'translation' && (
          <form
            className="settings-pane active"
            onSubmit={(event) => {
              event.preventDefault();
              void saveTranslation({
                provider: translationForm.provider,
                model: translationForm.model.trim(),
                base_url: translationForm.base_url.trim(),
                api_key: translationForm.api_key.trim(),
                target_lang: translationForm.target_lang,
                first_wait: Number(translationForm.first_wait || 0),
                player_names: translationForm.player_names.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
                toggle_hotkey: translationForm.toggle_hotkey.trim(),
                skip_hotkey: translationForm.skip_hotkey.trim(),
                sync_enabled: translationForm.sync_enabled,
                sync_url: translationForm.sync_url.trim(),
                sync_token: translationForm.sync_token.trim(),
              }).then(() => setStatusText((s) => ({ ...s, translation: '已保存' })));
            }}
          >
            <div className="settings-block">
              <div className="form-heading">
                <h2>翻译服务</h2>
                <p>NPC 对话翻译使用的连接参数</p>
              </div>
              <div className="form-grid">
                <label>
                  <span>服务商</span>
                  <Select
                    value={translationForm.provider}
                    onValueChange={(value) => {
                      const preset = providerPreset(value);
                      setTranslationForm((form) => ({
                        ...form,
                        provider: value,
                        model: preset?.model || form.model,
                        base_url: preset?.url ?? form.base_url,
                      }));
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deepseek">DeepSeek</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="openrouter">OpenRouter</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                      <SelectItem value="ollama">本地 Ollama</SelectItem>
                      <SelectItem value="deepl">DeepL</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span>模型</span>
                  <Input value={translationForm.model} onChange={(e) => setTranslationForm((f) => ({ ...f, model: e.target.value }))} />
                </label>
                <label className="wide">
                  <span>接口地址</span>
                  <Input value={translationForm.base_url} onChange={(e) => setTranslationForm((f) => ({ ...f, base_url: e.target.value }))} />
                </label>
                <label className="wide">
                  <span>API Key</span>
                  <div className="password-field">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={translationForm.api_key}
                      onChange={(e) => setTranslationForm((f) => ({ ...f, api_key: e.target.value }))}
                    />
                    <Button type="button" variant="ghost" size="icon" onClick={() => setShowKey((v) => !v)}>
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </label>
                <label>
                  <span>目标语言</span>
                  <Select value={translationForm.target_lang} onValueChange={(v) => setTranslationForm((f) => ({ ...f, target_lang: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zh-CN">简体中文</SelectItem>
                      <SelectItem value="zh-TW">繁体中文</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label>
                  <span>首屏等待（秒）</span>
                  <Input
                    type="number"
                    min={0}
                    max={3}
                    step={0.5}
                    value={translationForm.first_wait}
                    onChange={(e) => setTranslationForm((f) => ({ ...f, first_wait: Number(e.target.value || 0) }))}
                  />
                </label>
                <label className="wide">
                  <span>角色名</span>
                  <Input
                    value={translationForm.player_names}
                    placeholder="多个名称用逗号分隔"
                    onChange={(e) => setTranslationForm((f) => ({ ...f, player_names: e.target.value }))}
                  />
                </label>
                <label>
                  <span>中英切换热键</span>
                  <Input value={translationForm.toggle_hotkey} onChange={(e) => setTranslationForm((f) => ({ ...f, toggle_hotkey: e.target.value }))} />
                </label>
                <label>
                  <span>跳过对话热键</span>
                  <Input value={translationForm.skip_hotkey} onChange={(e) => setTranslationForm((f) => ({ ...f, skip_hotkey: e.target.value }))} />
                </label>
              </div>
              <div className="sub-settings">
                <label className="toggle-row">
                  <div><strong>共享词库</strong><span>自动同步已有译文</span></div>
                  <Switch checked={translationForm.sync_enabled} onCheckedChange={(v) => setTranslationForm((f) => ({ ...f, sync_enabled: v }))} />
                </label>
                <div className="form-grid sync-fields">
                  <label className="wide">
                    <span>节点地址</span>
                    <Input value={translationForm.sync_url} onChange={(e) => setTranslationForm((f) => ({ ...f, sync_url: e.target.value }))} />
                  </label>
                  <label className="wide">
                    <span>访问口令</span>
                    <Input type="password" value={translationForm.sync_token} onChange={(e) => setTranslationForm((f) => ({ ...f, sync_token: e.target.value }))} />
                  </label>
                </div>
              </div>
              <div className="form-actions">
                <span className="save-status">{statusText.translation || ''}</span>
                <Button type="submit"><Save className="h-4 w-4" />保存翻译设置</Button>
              </div>
            </div>
          </form>
        )}

        {settingsTab === 'overlay' && (
          <div className="settings-pane active space-y-4">
            <Card className="border-[var(--line-soft)] bg-black/10">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-xs text-[var(--muted-foreground)]">
                <span>
                  显示/隐藏悬浮窗、开关状态监控请在「总览」操作。
                  自定义技能倒计时请在「状态监控」配置。
                </span>
                <div className="flex gap-3">
                  <TextLink onClick={() => setPage('overview')}>去总览</TextLink>
                  <TextLink onClick={() => setPage('buffs')}>去状态监控</TextLink>
                </div>
              </CardContent>
            </Card>
            <form
              className="settings-block space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                // 开关类选项在总览维护，这里只保存外观参数并保留当前开关状态
                void saveOverlaySettings({
                  visible: state.settings?.overlay?.visible !== false,
                  monitoring: state.settings?.overlay?.monitoring !== false,
                  scale: overlayForm.scale,
                  opacity: overlayForm.opacity,
                  expiryWarningSeconds: overlayForm.expiryWarningSeconds,
                  density: overlayForm.density,
                }, appearance).then(() => {
                  setStatusText((s) => ({ ...s, overlay: '已保存' }));
                });
              }}
            >
              <div className="form-heading">
                <h2>悬浮窗外观</h2>
                <p>比例、透明度、位置与背景；开关类选项不在此重复</p>
              </div>
              <label className="range-row">
                <div><strong>内容比例</strong><span>{Math.round(overlayForm.scale * 100)}%</span></div>
                <Slider min={0.8} max={1.4} step={0.05} value={[overlayForm.scale]} onValueChange={([v]) => setOverlayForm((f) => ({ ...f, scale: v }))} />
              </label>
              <label className="range-row">
                <div><strong>不透明度</strong><span>{Math.round(overlayForm.opacity * 100)}%</span></div>
                <Slider min={0.2} max={1} step={0.05} value={[overlayForm.opacity]} onValueChange={([v]) => setOverlayForm((f) => ({ ...f, opacity: v }))} />
              </label>
              <label className="number-row">
                <div><strong>到期闪烁提醒</strong><span>所有带倒计时的状态在剩余时间内闪烁</span></div>
                <div className="number-field">
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={overlayForm.expiryWarningSeconds}
                    onChange={(e) => setOverlayForm((f) => ({ ...f, expiryWarningSeconds: Number(e.target.value || 10) }))}
                  />
                  <span>秒</span>
                </div>
              </label>
              <div className="space-y-2">
                <div className="text-xs font-semibold">可读性预设</div>
                <ToggleGroup
                  fullWidth
                  value={overlayForm.density}
                  onValueChange={(density) => setOverlayForm((f) => ({ ...f, density }))}
                >
                  <ToggleGroupItem value="comfortable">标准</ToggleGroupItem>
                  <ToggleGroupItem value="compact">紧凑</ToggleGroupItem>
                  <ToggleGroupItem value="large">大字</ToggleGroupItem>
                  <ToggleGroupItem value="expiring">仅即将到期</ToggleGroupItem>
                </ToggleGroup>
                <p className="m-0 text-[11px] text-[var(--muted-foreground)]">
                  「仅即将到期」只显示剩余时间进入闪烁窗口的状态/技能计时。
                </p>
              </div>
              <div className="overlay-position-row">
                <div><strong>位置与大小</strong><span>进入调整模式后拖动移动，拖右下角改长宽</span></div>
                <Button type="button" variant="secondary" onClick={() => void toggleOverlayEditing()}>
                  {overlayEditing ? <Check className="h-4 w-4" /> : <Move className="h-4 w-4" />}
                  {overlayEditing ? '完成调整' : '调整位置与大小'}
                </Button>
              </div>

              <div className="mt-2 border-t border-[var(--line-soft)] pt-4">
                <div className="form-heading !m-0 !border-0 !bg-transparent !p-0">
                  <h2>悬浮窗背景</h2>
                  <p>三选一：跟随主窗口壁纸、纯色底、或单独自定义图片</p>
                </div>
                <div className="mt-3 space-y-3">
                  <ToggleGroup
                    fullWidth
                    value={appearance.overlayBgMode || 'follow'}
                    onValueChange={(mode) => {
                      previewAppearance({
                        ...appearance,
                        overlayBgMode: mode,
                        applyToOverlay: mode !== 'solid',
                      });
                      setStatusText((s) => ({ ...s, overlay: '背景模式已预览，记得保存' }));
                    }}
                  >
                    <ToggleGroupItem value="follow">跟随主窗口</ToggleGroupItem>
                    <ToggleGroupItem value="solid">纯色</ToggleGroupItem>
                    <ToggleGroupItem value="custom">自定义</ToggleGroupItem>
                  </ToggleGroup>
                  <p className="m-0 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                    {overlayBgModeHint(appearance.overlayBgMode)}
                  </p>
                  {appearance.overlayBgMode === 'custom' && (
                    <div className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-black/15 p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={() => void pickBackground('overlay')}>
                          <ImagePlus className="h-4 w-4" />选择悬浮窗背景
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => void clearBackground('overlay')}>
                          <ImageOff className="h-4 w-4" />清除并改纯色
                        </Button>
                      </div>
                      <div className="appearance-path !m-0">
                        {appearance.overlayBackgroundImage || appearance.overlayBackgroundUrl
                          ? appearance.overlayBackgroundImage || '已设置自定义悬浮窗背景'
                          : '未设置自定义悬浮窗背景（将显示为纯色）'}
                      </div>
                      <label className="range-row !min-h-0 !border-0 !py-1">
                        <div>
                          <strong>遮罩强度</strong>
                          <span>{Math.round(appearance.overlayBackgroundDim * 100)}%</span>
                        </div>
                        <Slider
                          min={0.2}
                          max={0.9}
                          step={0.01}
                          value={[appearance.overlayBackgroundDim]}
                          onValueChange={([v]) => previewAppearance({ ...appearance, overlayBackgroundDim: v })}
                        />
                      </label>
                      <label className="range-row !min-h-0 !border-0 !py-1">
                        <div>
                          <strong>背景模糊</strong>
                          <span>{appearance.overlayBackgroundBlur}px</span>
                        </div>
                        <Slider
                          min={0}
                          max={16}
                          step={1}
                          value={[appearance.overlayBackgroundBlur]}
                          onValueChange={([v]) => previewAppearance({ ...appearance, overlayBackgroundBlur: v })}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
              <div className="form-actions">
                <span className="save-status">{statusText.overlay || ''}</span>
                <Button type="submit"><Save className="h-4 w-4" />保存悬浮窗设置</Button>
              </div>
            </form>
          </div>
        )}

        {settingsTab === 'startup' && (
          <form
            className="settings-pane active"
            onSubmit={(event) => {
              event.preventDefault();
              void (async () => {
                await saveStartupSettings(startupForm);
                await window.eco.saveAppSettings({ hotkeys: hotkeysForm });
                setStatusText((s) => ({ ...s, startup: '已保存' }));
                showToast('启动与热键设置已保存');
              })();
            }}
          >
            <div className="settings-block space-y-3">
              <div className="form-heading">
                <h2>启动行为</h2>
                <p>打开 ECO 工具箱时自动运行的服务</p>
              </div>
              {([
                ['damage', '自动启动伤害采集', '游戏未运行时会保留错误提示'],
                ['monitoring', '自动启动状态监控', '与伤害采集独立，开启后读取 buff / 技能 CD'],
                ['translator', '自动启动 NPC 翻译', '使用已保存的翻译配置'],
                ['overlay', '自动显示状态悬浮窗', '工具箱启动后立即显示角色状态'],
                ['tray', '显示系统托盘图标', '双击托盘可重新打开主窗口'],
                ['minimizeToTray', '关闭窗口时最小化到托盘', '从托盘菜单可彻底退出'],
                ['autoReconnect', '进程掉线自动重连', 'eco.exe 退出后自动刷新并尝试重新挂接'],
              ] as const).map(([key, title, desc]) => (
                <label key={key} className="toggle-row">
                  <div><strong>{title}</strong><span>{desc}</span></div>
                  <Switch
                    checked={Boolean(startupForm[key])}
                    onCheckedChange={(v) => setStartupForm((f) => ({ ...f, [key]: v }))}
                  />
                </label>
              ))}
              <div className="form-grid mt-2">
                <label className="wide">
                  <span>显示/隐藏悬浮窗热键</span>
                  <Input
                    value={hotkeysForm.toggleOverlay}
                    placeholder="例如 CommandOrControl+Shift+O，留空禁用"
                    onChange={(e) => setHotkeysForm((f) => ({ ...f, toggleOverlay: e.target.value }))}
                  />
                </label>
                <label className="wide">
                  <span>显示/隐藏主窗口热键</span>
                  <Input
                    value={hotkeysForm.toggleWindow}
                    placeholder="例如 CommandOrControl+Shift+E，留空禁用"
                    onChange={(e) => setHotkeysForm((f) => ({ ...f, toggleWindow: e.target.value }))}
                  />
                </label>
              </div>
              <div className="form-actions">
                <span className="save-status">{statusText.startup || ''}</span>
                <Button type="submit">
                  <Save className="h-4 w-4" />保存启动设置
                </Button>
              </div>
            </div>
          </form>
        )}

        {settingsTab === 'data' && (
          <div className="settings-pane active space-y-4">
            <div className="settings-block space-y-3">
              <div className="form-heading">
                <h2>配置导入导出</h2>
                <p>迁移外观、采集开关、倒计时与翻译设置（默认不含 API Key）</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={async () => {
                    const result = await exportConfig(false);
                    if (result.cancelled) return;
                    showToast(result.ok ? '配置已导出' : result.error || '导出失败');
                  }}
                >
                  导出配置
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    const result = await importConfig();
                    if (result.cancelled) return;
                    showToast(result.ok ? '配置已导入' : result.error || '导入失败');
                  }}
                >
                  导入配置
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    const result = await copyDiagnostics();
                    showToast(result.ok ? '诊断信息已复制' : result.error || '复制失败');
                  }}
                >
                  复制诊断信息
                </Button>
              </div>
            </div>
            <div className="settings-block space-y-3">
              <div className="form-heading">
                <h2>职业倒计时模板（Wiki 对照）</h2>
                <p>
                  从日文 Wiki 技能体系整理的起始模板，导入后写入自定义倒计时（可再改秒数）。
                  来源：
                  <a
                    className="ml-1 text-[var(--amber)] underline"
                    href="https://eco.lycolia.info/wiki/?Skill"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Skill
                  </a>
                </p>
              </div>
              <div className="space-y-2">
                {(jobPresets || []).length === 0 ? (
                  <p className="m-0 text-xs text-[var(--muted-foreground)]">未加载到职业模板</p>
                ) : (
                  jobPresets.map((preset) => (
                    <div
                      key={String(preset.id)}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] px-3 py-2"
                    >
                      <div className="min-w-0 text-xs">
                        <div className="font-semibold">{String(preset.name)}</div>
                        <div className="text-[var(--muted-foreground)]">{String(preset.note || '')}</div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={async () => {
                          if (!window.eco.applyJobPreset) {
                            showToast('当前版本不支持职业模板');
                            return;
                          }
                          const result = await window.eco.applyJobPreset(String(preset.id));
                          showToast(result.ok ? `已导入「${preset.name}」` : result.error || '导入失败');
                        }}
                      >
                        导入倒计时
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="settings-block space-y-3">
              <div className="form-heading">
                <h2>多角色预设</h2>
                <p>保存当前采集开关 + 自定义倒计时 + 悬浮窗密度，切换角色时一键应用</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="预设名称，如 法师主号"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <Button
                  type="button"
                  onClick={async () => {
                    const name = presetName.trim() || '未命名预设';
                    const result = await saveCharacterPreset(name);
                    showToast(result.ok ? `已保存预设「${name}」` : result.error || '保存失败');
                    if (result.ok) setPresetName('');
                  }}
                >
                  保存当前为预设
                </Button>
              </div>
              <div className="space-y-2">
                {(state.characterPresets || []).length === 0 ? (
                  <p className="m-0 text-xs text-[var(--muted-foreground)]">暂无预设</p>
                ) : (
                  (state.characterPresets || []).map((preset) => (
                    <div
                      key={preset.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{preset.name}</div>
                        <div className="text-[11px] text-[var(--muted-foreground)]">
                          {preset.updatedAt ? new Date(preset.updatedAt).toLocaleString('zh-CN', { hour12: false }) : ''}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={async () => {
                            const result = await applyCharacterPreset(preset.id);
                            showToast(result.ok ? `已应用「${preset.name}」` : result.error || '应用失败');
                          }}
                        >
                          应用
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            const result = await deleteCharacterPreset(preset.id);
                            showToast(result.ok ? '预设已删除' : result.error || '删除失败');
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {settingsTab === 'updates' && (
          <div className="settings-pane active">
            <div className="settings-block space-y-3">
              <div className="form-heading">
                <h2>软件更新</h2>
                <p>通过 GitHub Releases 获取正式版本</p>
              </div>
              <label className="toggle-row">
                <div><strong>启动时检查更新</strong><span>仅检查版本，不会自动下载</span></div>
                <Switch
                  checked={checkOnStartup}
                  onCheckedChange={async (v) => {
                    setCheckOnStartup(v);
                    await window.eco.saveAppSettings({ updates: { checkOnStartup: v } });
                    showToast(`启动检查更新已${v ? '开启' : '关闭'}`);
                  }}
                />
              </label>
              <div className="update-version-row">
                <span>当前版本</span>
                <strong>{update.currentVersion || '-'}</strong>
              </div>
              <div className="update-status-row">
                <div className={cn('update-status-icon', phase === 'checking' && 'spinning')}>
                  {phase === 'checking' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                </div>
                <div>
                  <strong>
                    {phase === 'available' && update.availableVersion
                      ? `发现版本 ${update.availableVersion}`
                      : updateMeta[0]}
                  </strong>
                  <span>{update.message || updateMeta[1]}</span>
                </div>
              </div>
              {(phase === 'downloading' || phase === 'downloaded') && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>
                      {progress.total
                        ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`
                        : phase === 'downloaded'
                          ? '下载完成'
                          : '正在连接下载服务器'}
                    </span>
                    <b>{percent.toFixed(0)}%</b>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full bg-[var(--amber)]" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              )}
              {update.releaseNotes && (
                <div className="update-notes">
                  <strong>更新说明</strong>
                  <pre>{update.releaseNotes}</pre>
                </div>
              )}
              <div className="form-actions update-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={phase === 'checking' || phase === 'downloading' || phase === 'downloaded' || !update.enabled}
                  onClick={() => void checkForUpdates()}
                >
                  <RefreshCw className="h-4 w-4" />检查更新
                </Button>
                {phase === 'available' && (
                  <Button type="button" onClick={() => void downloadUpdate()}>
                    <Download className="h-4 w-4" />下载更新
                  </Button>
                )}
                {phase === 'downloaded' && (
                  <Button type="button" onClick={() => void installUpdate()}>
                    <RotateCcw className="h-4 w-4" />重启并安装
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
