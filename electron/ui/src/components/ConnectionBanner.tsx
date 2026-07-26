import { AlertTriangle, ClipboardCopy, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const STATUS_META: Record<string, { title: string; tone: string }> = {
  'no-process': { title: '未选择游戏进程', tone: 'border-amber-500/40 bg-amber-500/10' },
  'process-gone': { title: '游戏进程已退出', tone: 'border-red-500/40 bg-red-500/10' },
  'attach-error': { title: '挂接失败', tone: 'border-red-500/40 bg-red-500/10' },
  connecting: { title: '正在连接…', tone: 'border-amber-500/30 bg-amber-500/5' },
};

export function ConnectionBanner() {
  const { state, reconnectGame, copyDiagnostics, refreshProcesses, showToast } = useEco();
  const health = state.connectionHealth;
  if (!health) return null;
  const meta = STATUS_META[health.status || ''];
  if (!meta && health.elevated !== false) return null;
  // Always show when elevated is false or problem status
  const show = Boolean(meta) || health.elevated === false;
  if (!show) return null;

  const title = meta?.title
    || (health.elevated === false ? '建议以管理员身份运行' : '连接提示');
  const tone = meta?.tone || 'border-amber-500/30 bg-amber-500/5';
  const hints = health.hints || [];

  return (
    <Card className={cn('border px-3.5 py-3', tone)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {health.status === 'process-gone' ? (
              <WifiOff className="h-4 w-4 text-[var(--red)]" />
            ) : health.elevated === false ? (
              <ShieldAlert className="h-4 w-4 text-[var(--amber)]" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-[var(--amber)]" />
            )}
            {title}
          </div>
          {health.serviceMessage ? (
            <p className="m-0 text-xs text-[var(--muted-foreground)]">
              {health.serviceMessage}
              {state.services?.damage?.errorCode || state.services?.translator?.errorCode ? (
                <span className="ml-2 font-mono text-[10px] text-[var(--amber)]">
                  {state.services?.damage?.errorCode || state.services?.translator?.errorCode}
                </span>
              ) : null}
            </p>
          ) : null}
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {hints.slice(0, 3).map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void refreshProcesses()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新进程
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              const result = await reconnectGame();
              showToast(result.ok ? '已尝试重新连接' : result.error || '重连失败');
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新连接
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              const result = await copyDiagnostics();
              showToast(result.ok ? '诊断信息已复制' : result.error || '复制失败');
            }}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            复制诊断
          </Button>
        </div>
      </div>
    </Card>
  );
}
