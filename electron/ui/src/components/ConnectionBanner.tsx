import { AlertTriangle, ClipboardCopy, ShieldAlert, WifiOff } from 'lucide-react';
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

/**
 * Connection / process problems only.
 * Recovery is folded into Overview「换号识别」(reconnect + reidentify).
 */
export function ConnectionBanner({ compact = false }: { compact?: boolean }) {
  const { state, switchCharacter, copyDiagnostics, showToast } = useEco();
  const health = state.connectionHealth;
  if (!health) return null;

  const meta = STATUS_META[health.status || ''];
  const needsAdmin = health.elevated === false;
  if (!meta && !needsAdmin) return null;

  const title = meta?.title
    || (needsAdmin ? '建议以管理员身份运行' : '连接提示');
  const tone = meta?.tone || 'border-amber-500/30 bg-amber-500/5';
  const hint = meta
    ? '点「换号识别」会自动重连采集并准备识别角色。'
    : (health.hints || [])[0] || '';

  return (
    <Card className={cn('border px-3.5 py-2.5', tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {health.status === 'process-gone' ? (
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" />
          ) : needsAdmin ? (
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" />
          )}
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-semibold leading-tight">{title}</div>
            {hint ? (
              <p className="m-0 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
                {hint}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {meta ? (
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={() => void switchCharacter()}
            >
              换号识别
            </Button>
          ) : null}
          {!compact ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 px-0"
              title="复制诊断"
              onClick={async () => {
                const result = await copyDiagnostics();
                showToast(result.ok ? '诊断信息已复制' : result.error || '复制失败');
              }}
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
