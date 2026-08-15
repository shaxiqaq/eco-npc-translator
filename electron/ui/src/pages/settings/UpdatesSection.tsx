import { Download, RefreshCw, RotateCcw, LoaderCircle } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type UpdateState = {
  phase?: string;
  progress?: { percent?: number; transferred?: number; total?: number };
  message?: string;
  releaseNotes?: string;
  currentVersion?: string;
  availableVersion?: string;
  enabled?: boolean;
};

type Props = {
  update: UpdateState;
  checkOnStartup: boolean;
  setCheckOnStartup: React.Dispatch<React.SetStateAction<boolean>>;
  showToast: (message: string) => void;
  checkForUpdates: () => void | Promise<void>;
  downloadUpdate: () => void | Promise<void>;
  installUpdate: () => void | Promise<void>;
};

const UPDATE_META: Record<string, [string, string]> = {
  idle: ['等待检查更新', '可随时手动检查'],
  checking: ['正在检查更新', '正在连接 GitHub Releases'],
  available: ['发现新版本', '点击下载后才会开始传输'],
  downloading: ['正在下载更新', '程序可以继续使用'],
  downloaded: ['更新已下载', '重启程序完成安装'],
  'not-available': ['当前已是最新版本', '没有可用更新'],
  error: ['检查更新失败', '请检查网络后重试'],
  unsupported: ['开发模式不检查更新', '请使用正式安装版'],
};

export function UpdatesSection({
  update,
  checkOnStartup,
  setCheckOnStartup,
  showToast,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
}: Props) {
  const phase = update.phase || 'idle';
  const progress = update.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const updateMeta = UPDATE_META[phase] || UPDATE_META.idle;

  return (
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
  );
}
