import { ImagePlus, ImageOff, Save, Move, Check } from 'lucide-react';
import { overlayBgModeHint } from '@/lib/appearance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TextLink } from '@/components/layout';
import type { PageId } from '@/types/eco';
import type { OverlayFormState } from './constants';

type Appearance = ReturnType<typeof import('@/lib/appearance').normalizeAppearance>;

type Props = {
  form: OverlayFormState;
  setForm: React.Dispatch<React.SetStateAction<OverlayFormState>>;
  appearance: Appearance;
  statusText: string;
  overlayEditing: boolean;
  overlayVisible: boolean;
  overlayMonitoring: boolean;
  previewAppearance: (next: Appearance) => void;
  pickBackground: (target: 'main' | 'overlay') => void | Promise<void>;
  clearBackground: (target: 'main' | 'overlay') => void | Promise<void>;
  toggleOverlayEditing: () => void | Promise<void>;
  setPage: (page: PageId) => void;
  onSave: (overlay: Record<string, unknown>, appearance: Appearance) => Promise<void>;
  onSaved: () => void;
  onStatus: (message: string) => void;
};

export function OverlaySection({
  form,
  setForm,
  appearance,
  statusText,
  overlayEditing,
  overlayVisible,
  overlayMonitoring,
  previewAppearance,
  pickBackground,
  clearBackground,
  toggleOverlayEditing,
  setPage,
  onSave,
  onSaved,
  onStatus,
}: Props) {
  return (
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
          void onSave({
            visible: overlayVisible,
            monitoring: overlayMonitoring,
            scale: form.scale,
            opacity: form.opacity,
            expiryWarningSeconds: form.expiryWarningSeconds,
            density: form.density,
          }, appearance).then(onSaved);
        }}
      >
        <div className="form-heading">
          <h2>悬浮窗外观</h2>
          <p>比例、透明度、位置与背景；开关类选项不在此重复</p>
        </div>
        <label className="range-row">
          <div><strong>内容比例</strong><span>{Math.round(form.scale * 100)}%</span></div>
          <Slider
            min={0.8}
            max={1.4}
            step={0.05}
            value={[form.scale]}
            onValueChange={([v]) => setForm((f) => ({ ...f, scale: v }))}
          />
        </label>
        <label className="range-row">
          <div><strong>不透明度</strong><span>{Math.round(form.opacity * 100)}%</span></div>
          <Slider
            min={0.2}
            max={1}
            step={0.05}
            value={[form.opacity]}
            onValueChange={([v]) => setForm((f) => ({ ...f, opacity: v }))}
          />
        </label>
        <label className="number-row">
          <div><strong>到期闪烁提醒</strong><span>所有带倒计时的状态在剩余时间内闪烁</span></div>
          <div className="number-field">
            <Input
              type="number"
              min={1}
              max={300}
              value={form.expiryWarningSeconds}
              onChange={(e) => setForm((f) => ({ ...f, expiryWarningSeconds: Number(e.target.value || 10) }))}
            />
            <span>秒</span>
          </div>
        </label>
        <div className="space-y-2">
          <div className="text-xs font-semibold">可读性预设</div>
          <ToggleGroup
            fullWidth
            value={form.density}
            onValueChange={(density) => setForm((f) => ({ ...f, density }))}
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
                onStatus('背景模式已预览，记得保存');
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
          <span className="save-status">{statusText || ''}</span>
          <Button type="submit"><Save className="h-4 w-4" />保存悬浮窗设置</Button>
        </div>
      </form>
    </div>
  );
}
