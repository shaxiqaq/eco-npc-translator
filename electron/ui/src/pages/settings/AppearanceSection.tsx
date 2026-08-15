import { ImagePlus, ImageOff, Save } from 'lucide-react';
import {
  ACCENT_PRESETS,
  type AccentId,
} from '@/lib/appearance';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { ACCENT_META } from './constants';

type Appearance = ReturnType<typeof import('@/lib/appearance').normalizeAppearance>;

type Props = {
  appearance: Appearance;
  statusText: string;
  previewAppearance: (next: Appearance) => void;
  pickBackground: (target: 'main' | 'overlay') => void | Promise<void>;
  clearBackground: (target: 'main' | 'overlay') => void | Promise<void>;
  onSave: (appearance: Appearance) => Promise<void>;
  onSaved: () => void;
  onStatus: (message: string) => void;
};

export function AppearanceSection({
  appearance,
  statusText,
  previewAppearance,
  pickBackground,
  clearBackground,
  onSave,
  onSaved,
  onStatus,
}: Props) {
  return (
    <form
      className="settings-pane active space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(appearance).then(onSaved);
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
                onStatus('强调色已预览，记得保存');
              }}
            >
              <i className="accent-preset-swatch" aria-hidden />
              <span>
                <strong>{ACCENT_META[accent as AccentId].title}</strong>
                <span>{ACCENT_META[accent as AccentId].desc}</span>
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
            onStatus('名称模式已预览，记得保存');
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
          <span className="save-status">{statusText || ''}</span>
          <Button type="submit"><Save className="h-4 w-4" />保存外观设置</Button>
        </div>
      </div>
    </form>
  );
}
