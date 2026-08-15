import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { HotkeysFormState, StartupFormState } from './constants';

const STARTUP_TOGGLES = [
  ['damage', '自动启动伤害采集', '游戏未运行时会保留错误提示'],
  ['monitoring', '自动启动状态监控', '与伤害采集独立，开启后读取 buff / 技能 CD'],
  ['translator', '自动启动 NPC 翻译', '使用已保存的翻译配置'],
  ['overlay', '自动显示状态悬浮窗', '工具箱启动后立即显示角色状态'],
  ['tray', '显示系统托盘图标', '双击托盘可重新打开主窗口'],
  ['minimizeToTray', '关闭窗口时最小化到托盘', '从托盘菜单可彻底退出'],
  ['autoReconnect', '进程掉线自动重连', 'eco.exe 退出后自动刷新并尝试重新挂接'],
  ['prestartOnGame', '发现游戏后预启动', '后进游戏时自动挂上已勾选的采集/翻译，并预热翻译引擎'],
] as const;

type Props = {
  startupForm: StartupFormState;
  setStartupForm: React.Dispatch<React.SetStateAction<StartupFormState>>;
  hotkeysForm: HotkeysFormState;
  setHotkeysForm: React.Dispatch<React.SetStateAction<HotkeysFormState>>;
  statusText: string;
  onSave: (startup: StartupFormState, hotkeys: HotkeysFormState) => Promise<void>;
  onSaved: () => void;
};

export function StartupSection({
  startupForm,
  setStartupForm,
  hotkeysForm,
  setHotkeysForm,
  statusText,
  onSave,
  onSaved,
}: Props) {
  return (
    <form
      className="settings-pane active"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(startupForm, hotkeysForm).then(onSaved);
      }}
    >
      <div className="settings-block space-y-3">
        <div className="form-heading">
          <h2>启动行为</h2>
          <p>打开 ECO 工具箱时自动运行的服务</p>
        </div>
        {STARTUP_TOGGLES.map(([key, title, desc]) => (
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
          <span className="save-status">{statusText || ''}</span>
          <Button type="submit">
            <Save className="h-4 w-4" />保存启动设置
          </Button>
        </div>
      </div>
    </form>
  );
}
