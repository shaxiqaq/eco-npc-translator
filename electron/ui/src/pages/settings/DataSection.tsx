import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CharacterPreset, PageId } from '@/types/eco';
import type { JobPreset } from './constants';

type Props = {
  presetName: string;
  setPresetName: React.Dispatch<React.SetStateAction<string>>;
  jobPresets: JobPreset[];
  characterPresets: CharacterPreset[];
  mainWindowTitle?: string | null;
  setPage: (page: PageId) => void;
  showToast: (message: string) => void;
  exportConfig: (includeSecrets?: boolean) => Promise<{ ok?: boolean; cancelled?: boolean; error?: string }>;
  importConfig: () => Promise<{ ok?: boolean; cancelled?: boolean; error?: string }>;
  copyDiagnostics: () => Promise<{ ok?: boolean; error?: string }>;
  saveCharacterPreset: (name: string) => Promise<{ ok?: boolean; error?: string }>;
  applyCharacterPreset: (id: string) => Promise<{ ok?: boolean; error?: string }>;
  deleteCharacterPreset: (id: string) => Promise<{ ok?: boolean; error?: string }>;
};

export function DataSection({
  presetName,
  setPresetName,
  jobPresets,
  characterPresets,
  mainWindowTitle,
  setPage,
  showToast,
  exportConfig,
  importConfig,
  copyDiagnostics,
  saveCharacterPreset,
  applyCharacterPreset,
  deleteCharacterPreset,
}: Props) {
  return (
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
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              if (!window.eco.exportDiagnosticPack) {
                showToast('当前版本不支持诊断包');
                return;
              }
              const result = await window.eco.exportDiagnosticPack();
              if (result?.cancelled) return;
              showToast(result.ok ? '诊断包已导出' : result.error || '导出失败');
            }}
          >
            导出诊断包
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              // Recommended defaults: show overlay, monitoring on, amber accent, client skill names.
              try {
                const result = await window.eco.saveAppSettings({
                  appearance: {
                    accent: 'amber',
                    skillNameMode: 'client',
                    backgroundDim: 0.52,
                    backgroundBlur: 6,
                    overlayBgMode: 'follow',
                  },
                  overlay: {
                    visible: true,
                    monitoring: true,
                    density: 'comfortable',
                    expiryWarningSeconds: 10,
                    opacity: 1,
                    scale: 1,
                  },
                  capture: {
                    skill: true,
                    normal: true,
                    pet: true,
                    taken: true,
                    self_skill: true,
                    self_normal: true,
                    pet_skill: true,
                    pet_normal: true,
                    ride_skill: true,
                    ride_normal: true,
                    possession_skill: true,
                    possession_normal: true,
                  },
                  startup: {
                    damage: false,
                    translator: false,
                    overlay: true,
                    monitoring: true,
                    tray: true,
                    minimizeToTray: true,
                    autoReconnect: true,
                    prestartOnGame: true,
                  },
                });
                if (result?.settings) {
                  showToast('已恢复推荐默认（翻译 Key 未改动）');
                } else {
                  showToast('恢复失败');
                }
              } catch (err) {
                showToast(err instanceof Error ? err.message : '恢复失败');
              }
            }}
          >
            <RotateCcw className="h-4 w-4" />
            恢复推荐默认
          </Button>
        </div>
        <p className="m-0 text-[11px] text-[var(--muted-foreground)]">
          错误码说明见
          <button
            type="button"
            className="ml-1 text-[var(--amber)] underline"
            onClick={() => setPage('help')}
          >
            帮助页
          </button>
        </p>
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
          <p>
            保存当前采集开关 + 自定义倒计时 + 悬浮窗密度。
            会绑定当前主窗口标题，多开切换进程时自动匹配应用。
          </p>
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
        {mainWindowTitle ? (
          <p className="m-0 text-[11px] text-[var(--muted-foreground)]">
            当前主窗口：{mainWindowTitle}
          </p>
        ) : null}
        <div className="space-y-2">
          {(characterPresets || []).length === 0 ? (
            <p className="m-0 text-xs text-[var(--muted-foreground)]">暂无预设</p>
          ) : (
            characterPresets.map((preset) => (
              <div
                key={preset.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{preset.name}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">
                    {preset.windowTitle ? `绑定：${preset.windowTitle} · ` : ''}
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
  );
}
