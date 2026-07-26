import { Download, RotateCcw, LoaderCircle } from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { formatBytes } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function UpdateDialog() {
  const {
    state,
    updateDialogOpen,
    setUpdateDialogOpen,
    downloadUpdate,
    installUpdate,
  } = useEco();
  const update = state.update || {};
  const phase = update.phase || 'idle';
  const downloaded = phase === 'downloaded';
  const downloading = phase === 'downloading';
  const progress = update.progress || {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const hasProgress = downloading || downloaded;

  return (
    <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{downloaded ? '更新已准备完成' : '发现新版本'}</DialogTitle>
          <DialogDescription>
            {`当前 ${update.currentVersion || '-'}  →  新版 ${update.availableVersion || '-'}`}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-40 overflow-auto rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 text-xs whitespace-pre-wrap text-[var(--muted)]">
          {update.releaseNotes || '本次更新说明请查看 GitHub Release。'}
        </pre>
        {hasProgress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>
                {progress.total
                  ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`
                  : downloaded
                    ? '下载完成'
                    : '正在连接下载服务器'}
              </span>
              <b>{percent.toFixed(0)}%</b>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="h-full bg-[var(--amber)] transition-all" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setUpdateDialogOpen(false)}>
            稍后
          </Button>
          <Button
            type="button"
            disabled={downloading}
            onClick={() => {
              if (downloaded) void installUpdate();
              else if (phase === 'available') void downloadUpdate();
            }}
          >
            {downloaded ? (
              <>
                <RotateCcw className="h-4 w-4" />
                重启并安装
              </>
            ) : downloading ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                正在下载
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                下载更新
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
