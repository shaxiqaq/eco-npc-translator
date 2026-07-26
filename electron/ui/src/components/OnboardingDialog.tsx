import { useEffect, useState } from 'react';
import { useEco } from '@/context/EcoContext';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function OnboardingDialog() {
  const { state, setOnboardingSeen, refreshProcesses, showToast } = useEco();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!state.settings) return;
    if (state.settings.onboarding?.seenGuide) {
      setOpen(false);
      return;
    }
    setOpen(true);
  }, [state.settings?.onboarding?.seenGuide, state.settings]);

  const health = state.connectionHealth;

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) void setOnboardingSeen(true);
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>欢迎使用 ECO 工具箱</DialogTitle>
          <DialogDescription>
            本地挂接 eco.exe，不改客户端。首次使用请按下面步骤：
          </DialogDescription>
        </DialogHeader>
        <ol className="m-0 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted-foreground)]">
          <li>启动并进入游戏（角色已登录，进程名为 eco.exe）。</li>
          <li>
            若挂接失败，请
            <b className="text-[var(--text)]"> 右键以管理员身份运行 </b>
            本工具箱。
            {health?.elevated === false ? '（当前可能未提权）' : ''}
          </li>
          <li>在顶部选择正确的角色窗口；多开时小雅可单独指定进程。</li>
          <li>总览中开启「状态监控」和/或「伤害采集」；需要时再开 NPC 翻译。</li>
          <li>出问题可点「复制诊断」发给协助者，或到运行日志页导出。</li>
        </ol>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await refreshProcesses();
              showToast('已刷新进程列表');
            }}
          >
            刷新进程
          </Button>
          <Button
            type="button"
            onClick={() => {
              void setOnboardingSeen(true);
              setOpen(false);
            }}
          >
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
