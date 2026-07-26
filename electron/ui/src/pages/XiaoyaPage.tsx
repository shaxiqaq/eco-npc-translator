import {
  Keyboard,
  Play,
  Square,
  Repeat2,
  Eye,
  FolderOpen,
  RefreshCw,
  Save,
  ShieldCheck,
  CircleCheck,
  CircleOff,
  LoaderCircle,
  TriangleAlert,
  MonitorDot,
} from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageStack } from '@/components/layout';
import { cn } from '@/lib/utils';

export function XiaoyaPage() {
  const {
    state,
    xiaoyaSkills,
    setXiaoyaSkills,
    toggleXiaoya,
    toggleXiaoyaSs,
    toggleXiaoyaVisibility,
    openXiaoyaFolder,
    saveXiaoyaConfig,
    reloadXiaoyaConfig,
    refreshProcesses,
    selectXiaoyaProcess,
  } = useEco();

  const service = state.xiaoya || {};
  const active = ['starting', 'running', 'stopping'].includes(service.state || '');
  const running = service.state === 'running';
  const targetPid = Number(service.targetPid || state.selectedXiaoyaPid) || null;
  const processes = state.gameProcesses || [];
  const selectedPid = Number(state.selectedXiaoyaPid) || null;
  const mainPid = Number(state.selectedGamePid) || null;
  const processValue = selectedPid
    ? String(selectedPid)
    : processes.find((p) => p.pid !== mainPid)?.pid
      ? String(processes.find((p) => p.pid !== mainPid)!.pid)
      : processes.length
        ? String(processes[processes.length - 1].pid)
        : '';

  let statusIcon = <CircleOff className="h-3.5 w-3.5" />;
  let statusText = '已停止';
  let badgeVariant: 'secondary' | 'success' | 'warning' = 'secondary';
  if (running) {
    statusIcon = <CircleCheck className="h-3.5 w-3.5" />;
    statusText = `运行中${targetPid ? ` · 目标 ${targetPid}` : ''}`;
    badgeVariant = 'success';
  } else if (service.state === 'error') {
    statusIcon = <TriangleAlert className="h-3.5 w-3.5" />;
    statusText = '启动失败';
    badgeVariant = 'warning';
  } else if (active) {
    statusIcon = <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
    statusText = service.state === 'starting' ? '启动中' : '停止中';
    badgeVariant = 'warning';
  }

  return (
    <PageStack>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--amber-dark)] text-[var(--amber)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)]">
              <Keyboard className="h-7 w-7" />
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted-foreground)]">ECO 后台技能辅助</div>
              <h2 className="m-0 mt-1 text-lg font-semibold">小雅助手</h2>
              <p className="m-0 mt-1 text-xs text-[var(--muted-foreground)]">
                {service.message || '正在读取程序和配置'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={badgeVariant} className="h-8 gap-1.5 px-2.5">
              {statusIcon}
              {statusText}
            </Badge>
            <Button type="button" variant="secondary" onClick={() => void toggleXiaoyaSs()}>
              <Repeat2 />切换 SS
            </Button>
            <Button type="button" variant="secondary" onClick={() => void toggleXiaoyaVisibility()}>
              <Eye />显示/隐藏 ECO
            </Button>
            <Button type="button" variant="secondary" onClick={() => void openXiaoyaFolder()}>
              <FolderOpen />打开目录
            </Button>
            <Button type="button" onClick={() => void toggleXiaoya()}>
              {active ? <Square /> : <Play />}
              {active ? '停止小雅' : '启动小雅'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="min-w-[240px] max-w-xl">
            <div className="text-sm font-semibold">小雅目标进程</div>
            <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
              独立于顶部主进程。多开时请把小雅指到副号；伤害采集 / 翻译 / 状态监控仍用顶部主进程。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] pl-2.5">
              <MonitorDot className="h-4 w-4 text-[var(--amber)]" />
              <Select
                value={processValue || undefined}
                onValueChange={(value) => void selectXiaoyaProcess(Number(value))}
                disabled={!processes.length}
              >
                <SelectTrigger className="h-8 min-w-[180px] border-0 bg-transparent px-1 text-[11px] shadow-none focus:ring-0">
                  <SelectValue placeholder={processes.length ? '选择进程' : '没有找到 eco.exe'} />
                </SelectTrigger>
                <SelectContent>
                  {processes.map((process) => {
                    const title = process.title && process.title.toLowerCase() !== 'eco' ? ` · ${process.title}` : '';
                    const started = process.started ? ` · ${process.started}` : '';
                    const sameAsMain = mainPid && process.pid === mainPid ? ' · 主进程' : '';
                    return (
                      <SelectItem key={process.pid} value={String(process.pid)}>
                        {`PID ${process.pid}${title}${started}${sameAsMain}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button type="button" variant="ghost" size="icon-sm" className="border-0 bg-transparent" onClick={() => void refreshProcesses()}>
                <RefreshCw />
              </Button>
            </div>
            <Badge variant="secondary" className="h-8">
              {targetPid
                ? mainPid && targetPid === mainPid
                  ? `当前目标 ${targetPid}（与主进程相同）`
                  : `当前目标 ${targetPid}`
                : '请选择小雅目标进程'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>F1–F6 自动技能配置</CardTitle>
            <CardDescription className="mt-1">
              按设定周期向「小雅目标进程」后台发送技能键；配置保存在工具箱用户数据目录。
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void reloadXiaoyaConfig()}>
              <RefreshCw />读取上次设置
            </Button>
            <Button type="button" onClick={() => void saveXiaoyaConfig()}>
              <Save />保存配置
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="xiaoya-skill-grid">
            <div className="xiaoya-grid-heading">
              <span>按键</span>
              <span>技能开关</span>
              <span>技能间隔（秒）</span>
              <span>鼠标点击</span>
              <span>技能后延迟（毫秒）</span>
            </div>
            {xiaoyaSkills.map((skill, index) => (
              <label key={index} className="xiaoya-skill-row">
                <b>F{index + 1}</b>
                <Switch
                  checked={Boolean(skill.enabled)}
                  onCheckedChange={(checked) => {
                    setXiaoyaSkills((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, enabled: checked } : row)),
                    );
                  }}
                />
                <Input
                  type="number"
                  min={0}
                  max={86400}
                  value={Number(skill.skillTime || 0)}
                  onChange={(event) => {
                    const value = Number(event.target.value || 0);
                    setXiaoyaSkills((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, skillTime: value } : row)),
                    );
                  }}
                />
                <Switch
                  checked={Boolean(skill.mouse)}
                  onCheckedChange={(checked) => {
                    setXiaoyaSkills((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, mouse: checked } : row)),
                    );
                  }}
                />
                <Input
                  type="number"
                  min={0}
                  max={60000}
                  value={Number(skill.delay || 0)}
                  onChange={(event) => {
                    const value = Number(event.target.value || 0);
                    setXiaoyaSkills((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, delay: value } : row)),
                    );
                  }}
                />
              </label>
            ))}
          </div>

          <div className={cn('flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-soft-2)] px-3 py-2.5 text-[11px] text-[var(--muted-foreground)]')}>
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" />
            <span>
              启动后会向「小雅目标进程」发送后台技能键和可选鼠标点击，与顶部主进程选择相互独立。多开时请确认副号 PID 正确。
            </span>
          </div>
        </CardContent>
      </Card>
    </PageStack>
  );
}
