import {
  AlertTriangle,
  ClipboardCopy,
  Package,
  Play,
  ShieldAlert,
  UserRoundSearch,
  WifiOff,
} from 'lucide-react';
import { useCombatIdentity, useEco } from '@/context/EcoContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Step =
  | 'no-process'
  | 'process-gone'
  | 'attach-error'
  | 'not-started'
  | 'waiting-identify'
  | 'admin-hint'
  | 'ok';

/**
 * Single next-step banner for overview: one primary action, less confusion.
 */
export function ActionBanner() {
  const {
    state,
    switchCharacter,
    startAll,
    refreshProcesses,
    copyDiagnostics,
    exportDiagnosticPack,
    showToast,
  } = useEco();
  const { selfId, rebindPending } = useCombatIdentity();

  const health = state.connectionHealth;
  const selectedPid = state.selectedGamePid;
  const damageState = state.services?.damage?.state || 'stopped';
  const monState = state.services?.monitoring?.state || 'stopped';
  const captureUp = ['running', 'starting'].includes(damageState)
    || ['running', 'starting'].includes(monState);
  const hasSelf = selfId != null && selfId !== '';
  const needsAdmin = health?.elevated === false;

  let step: Step = 'ok';
  if (health?.status === 'process-gone') step = 'process-gone';
  else if (health?.status === 'no-process' || !selectedPid) step = 'no-process';
  else if (health?.status === 'attach-error') step = 'attach-error';
  else if (!captureUp) step = 'not-started';
  else if (!hasSelf || rebindPending) step = 'waiting-identify';
  else if (needsAdmin) step = 'admin-hint';

  if (step === 'ok' && !needsAdmin) return null;

  const meta: Record<
    Exclude<Step, 'ok'>,
    { title: string; body: string; tone: string; primary: string; onPrimary: () => void }
  > = {
    'no-process': {
      title: '未选择游戏进程',
      body: '请启动 ECO，在顶栏刷新并选择正确的窗口（多开时看标题）。',
      tone: 'border-amber-500/40 bg-amber-500/10',
      primary: '刷新进程',
      onPrimary: () => void refreshProcesses(),
    },
    'process-gone': {
      title: '游戏进程已退出',
      body: '客户端已关闭或崩溃。重新进游戏后点「换号识别」自动重连。',
      tone: 'border-red-500/40 bg-red-500/10',
      primary: '换号识别',
      onPrimary: () => void switchCharacter(),
    },
    'attach-error': {
      title: '挂接失败',
      body: health?.hints?.[0] || '请尝试管理员运行，并确认选中了正确的 eco.exe。',
      tone: 'border-red-500/40 bg-red-500/10',
      primary: '换号识别',
      onPrimary: () => void switchCharacter(),
    },
    'not-started': {
      title: '采集未启动',
      body: '已选中进程，但伤害/状态采集未开。点下方启动后普攻一次即可识别角色。',
      tone: 'border-amber-500/30 bg-amber-500/5',
      primary: '全部启动',
      onPrimary: () => void startAll(),
    },
    'waiting-identify': {
      title: rebindPending ? '待确认角色' : '等待识别角色',
      body: '请对怪物普攻或放技能一次；成功后顶栏会显示角色编号。',
      tone: 'border-amber-500/30 bg-amber-500/5',
      primary: '换号识别',
      onPrimary: () => void switchCharacter(),
    },
    'admin-hint': {
      title: '建议以管理员身份运行',
      body: '未提权时 Frida 可能挂接失败或抓不到包。右键工具箱 → 以管理员身份运行。',
      tone: 'border-amber-500/30 bg-amber-500/5',
      primary: '复制诊断',
      onPrimary: async () => {
        const result = await copyDiagnostics();
        showToast(result.ok ? '诊断已复制' : result.error || '复制失败');
      },
    },
  };

  if (step === 'ok') return null;
  const m = meta[step];
  const Icon = step === 'process-gone'
    ? WifiOff
    : step === 'admin-hint'
      ? ShieldAlert
      : step === 'not-started'
        ? Play
        : step === 'waiting-identify'
          ? UserRoundSearch
          : AlertTriangle;

  return (
    <Card className={cn('border px-3.5 py-2.5', m.tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" />
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-semibold leading-tight">{m.title}</div>
            <p className="m-0 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{m.body}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" size="sm" className="h-8" onClick={m.onPrimary}>
            {m.primary}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 px-0"
            title="导出诊断包"
            onClick={async () => {
              if (!exportDiagnosticPack) return;
              const result = await exportDiagnosticPack();
              if (result?.cancelled) return;
              showToast(result.ok ? '诊断包已导出' : result.error || '导出失败');
            }}
          >
            <Package className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 w-8 px-0"
            title="复制诊断"
            onClick={async () => {
              const result = await copyDiagnostics();
              showToast(result.ok ? '诊断已复制' : result.error || '复制失败');
            }}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
