import {
  LayoutDashboard,
  Swords,
  Flame,
  ShieldCheck,
  Languages,
  Keyboard,
  ScrollText,
  Settings2,
  MonitorDot,
  RefreshCw,
  CircleOff,
  CircleCheck,
  CircleDot,
  Play,
  Square,
  CircleHelp,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGE_META, serviceText } from '@/lib/damage';
import { formatProcessLabel } from '@/lib/process-label';
import { useCombatIdentity, useEco } from '@/context/EcoContext';
import type { PageId } from '@/types/eco';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NAV: Array<{ id: PageId; icon: React.ComponentType<{ className?: string }>; label: string }> = [
  { id: 'overview', icon: LayoutDashboard, label: '总览' },
  { id: 'damage', icon: Swords, label: '伤害统计' },
  { id: 'grind', icon: Flame, label: '肝度统计' },
  { id: 'buffs', icon: ShieldCheck, label: '状态监控' },
  { id: 'translation', icon: Languages, label: 'NPC 翻译' },
  { id: 'xiaoya', icon: Keyboard, label: '小雅助手' },
  { id: 'logs', icon: ScrollText, label: '运行日志' },
  { id: 'settings', icon: Settings2, label: '设置' },
  { id: 'help', icon: CircleHelp, label: '帮助' },
];

function StatusDot({ state }: { state?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full bg-[#5f666a]',
        state === 'running' && 'bg-[var(--green)] shadow-[0_0_0_3px_rgba(105,197,139,.12)]',
        (state === 'starting' || state === 'stopping') && 'bg-[var(--amber)] shadow-[0_0_0_3px_rgba(242,184,75,.12)]',
        state === 'error' && 'bg-[var(--red)] shadow-[0_0_0_3px_rgba(240,120,114,.12)]',
      )}
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    page,
    setPage,
    state,
    startAll,
    stopAll,
    prestartServices,
    refreshProcesses,
    selectGameProcess,
  } = useEco();
  const { selfId } = useCombatIdentity();

  const [title, subtitle] = PAGE_META[page] || PAGE_META.overview;
  const processes = state.gameProcesses || [];
  const selectedPid = Number(state.selectedGamePid) || null;
  const connectedPid =
    state.services?.damage?.pid
    || state.services?.monitoring?.pid
    || state.services?.translator?.pid;
  const connected = Boolean(connectedPid);
  const processValue = selectedPid
    ? String(selectedPid)
    : processes.length
      ? String(processes[processes.length - 1].pid)
      : '';

  const hasWallpaper = Boolean(
    state.settings?.appearance?.backgroundUrl
    || state.settings?.appearance?.backgroundDataUrl
    || state.settings?.appearance?.backgroundFileUrl
    || state.settings?.appearance?.backgroundImage,
  );

  return (
    <div className={cn('app-shell', hasWallpaper && 'has-wallpaper')}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">E</div>
          <div>
            <strong>ECO 工具箱</strong>
            <span>本地辅助面板</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {NAV.map(({ id, icon: Icon, label }) => {
            const active = page === id;
            return (
              <button
                key={id}
                type="button"
                className={cn(
                  'flex w-full min-h-[42px] items-center gap-3 rounded-[var(--radius-sm)] border border-transparent px-3 text-left text-[13px] text-[#c4bccf] transition-colors',
                  active
                    ? 'border-[var(--accent-border)] bg-[linear-gradient(135deg,var(--amber-hi),var(--amber))] font-bold text-[var(--accent-ink)] shadow-[0_8px_18px_var(--accent-glow)]'
                    : 'hover:bg-white/[0.06] hover:text-[var(--text)]',
                )}
                onClick={() => setPage(id)}
                data-page={id}
              >
                <Icon className={cn('h-4 w-4', active ? 'opacity-100' : 'opacity-90')} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto grid gap-2.5 border-t border-[var(--line-soft)] px-2 pt-3.5">
          {([
            ['伤害采集', state.services?.damage],
            ['状态监控', state.services?.monitoring],
            ['NPC 翻译', state.services?.translator],
          ] as const).map(([label, service]) => (
            <div
              key={label}
              className="grid grid-cols-[8px_1fr_auto] items-center gap-2 rounded-lg bg-black/15 px-2 py-1.5 text-[11px] text-[var(--muted)]"
            >
              <StatusDot state={service?.state} />
              <span>{label}</span>
              <b className="font-medium text-[#d8d2e0]">{serviceText(service)}</b>
            </div>
          ))}
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="flex items-center gap-2.5">
            {/* 小雅页只用页内「小雅目标进程」，顶栏主进程选择隐藏以免混淆 */}
            {page !== 'xiaoya' && (
              <>
                <div className="flex h-[38px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--card)] pl-2.5 shadow-[var(--shadow)] backdrop-blur-md">
                  <MonitorDot className="h-4 w-4 text-[var(--amber)]" />
                  <Select
                    value={processValue || undefined}
                    onValueChange={(value) => void selectGameProcess(Number(value))}
                    disabled={!processes.length}
                  >
                    <SelectTrigger
                      className="h-8 min-w-[200px] max-w-[280px] border-0 bg-transparent px-1 text-[11px] shadow-none focus:ring-0"
                      title={state.processSelectionLocked ? '切换时会自动停采并重挂' : '选择主号 eco.exe'}
                    >
                      <SelectValue placeholder={processes.length ? '选择进程' : '没有找到 eco.exe'} />
                    </SelectTrigger>
                    <SelectContent>
                      {processes.map((process) => (
                        <SelectItem key={process.pid} value={String(process.pid)}>
                          {formatProcessLabel(process)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Separator orientation="vertical" className="h-5" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-l-none border-0 bg-transparent"
                    title="刷新游戏进程"
                    onClick={() => void refreshProcesses()}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>

                <Badge
                  variant={connected ? 'success' : selectedPid ? 'warning' : 'secondary'}
                  className="h-8 gap-1.5 px-2.5 text-[11px] font-medium"
                >
                  {connected ? (
                    <CircleCheck className="h-3.5 w-3.5" />
                  ) : selectedPid ? (
                    <CircleDot className="h-3.5 w-3.5" />
                  ) : (
                    <CircleOff className="h-3.5 w-3.5" />
                  )}
                  {connected
                    ? `已连接 ${connectedPid}${selfId ? ` · 角色 ${selfId}` : ''}`
                    : selectedPid
                      ? `已选择 ${selectedPid}`
                      : '未找到游戏'}
                </Badge>
                {state.rememberedTitles?.main ? (
                  <span
                    className="hidden max-w-[140px] truncate text-[10px] text-[var(--muted-foreground)] xl:inline"
                    title={`记忆窗口：${state.rememberedTitles.main}`}
                  >
                    记忆: {state.rememberedTitles.main}
                  </span>
                ) : null}
              </>
            )}

            <Button type="button" variant="secondary" onClick={() => void stopAll()}>
              <Square />
              全部停止
            </Button>
            <Button
              type="button"
              variant="secondary"
              title="挂钩 NPC 翻译并预热接口，进对话前点一次"
              onClick={() => void prestartServices()}
            >
              <Zap />
              预热翻译
            </Button>
            <Button type="button" onClick={() => void startAll()}>
              <Play />
              全部启动
            </Button>
          </div>
        </header>

        <div className="page-host">{children}</div>
      </main>
    </div>
  );
}
