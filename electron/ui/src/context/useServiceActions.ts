import { useCallback } from 'react';
import type { EcoAppState } from '@/types/eco';

type ShowToast = (message: string) => void;

/** Capture / translator service + game process selection actions. */
export function useServiceActions(options: {
  state: EcoAppState;
  showToast: ShowToast;
  refreshState: () => Promise<void>;
  setState: React.Dispatch<React.SetStateAction<EcoAppState>>;
}) {
  const { state, showToast, refreshState, setState } = options;

  const toggleService = useCallback(async (name: 'damage' | 'translator') => {
    const running = ['running', 'starting'].includes(state.services?.[name]?.state || '');
    const result = running ? await window.eco.stopService(name) : await window.eco.startService(name);
    if (!result.ok && result.error) showToast(result.error);
    await refreshState();
  }, [state.services, showToast, refreshState]);

  const startAll = useCallback(async () => {
    const results = await Promise.all([
      window.eco.startService('damage'),
      window.eco.startService('translator'),
    ]);
    const failed = results.find((result) => !result.ok);
    if (failed?.error) showToast(failed.error);
    await refreshState();
  }, [showToast, refreshState]);

  const stopAll = useCallback(async () => {
    await Promise.all([window.eco.stopService('damage'), window.eco.stopService('translator')]);
    await refreshState();
  }, [refreshState]);

  const prestartServices = useCallback(async () => {
    if (!window.eco.prestartServices) {
      showToast('当前版本不支持预启动');
      return;
    }
    const result = await window.eco.prestartServices();
    showToast(result?.ok ? '已预启动：挂钩中，引擎预热后即可对话' : result?.error || '预启动失败');
    await refreshState();
  }, [showToast, refreshState]);

  const resetDamage = useCallback(async () => {
    await window.eco.resetDamage();
    showToast('伤害统计已清空（角色识别保持不变）');
  }, [showToast]);

  const reidentifySelf = useCallback(async () => {
    if (!window.eco.reidentifySelf) {
      showToast('当前版本不支持重新识别角色');
      return;
    }
    const result = await window.eco.reidentifySelf();
    if (!result?.ok) {
      showToast(result?.error || '重新识别失败');
      return;
    }
    showToast('请普攻或放技能一次以确认角色（识别成功后无需再点）');
    await refreshState();
  }, [showToast, refreshState]);

  /**
   * One-shot for account/character switch (and casual recovery):
   * reconnect Frida to current eco.exe → clear meter → soft reidentify.
   * Users only need this button + one auto-attack.
   */
  const switchCharacter = useCallback(async () => {
    showToast('正在重连采集…');
    if (window.eco.reconnectGame) {
      const rec = await window.eco.reconnectGame();
      // Throttle "重连过于频繁" is ok to ignore; real failures surface below if identify also fails.
      if (!rec?.ok && rec?.error && !String(rec.error).includes('频繁')) {
        // Keep going: capture may already be up; identify still helps.
        console.warn('switchCharacter reconnect:', rec.error);
      }
    }
    try {
      await window.eco.resetDamage();
    } catch {
      // ignore
    }
    if (!window.eco.reidentifySelf) {
      showToast('已尝试重连；请普攻一次。当前版本无单独识别接口');
      await refreshState();
      return;
    }
    const result = await window.eco.reidentifySelf();
    await refreshState();
    if (!result?.ok) {
      showToast(result?.error || '换号识别未完成，请确认游戏已打开后再点一次');
      return;
    }
    showToast('已就绪：请普攻或放技能一次完成识别');
  }, [showToast, refreshState]);

  const selectGameProcess = useCallback(async (pid: number) => {
    showToast('正在切换游戏进程…');
    const result = await window.eco.selectGameProcess(pid, { autoRestart: true });
    await refreshState();
    if (!result?.ok) {
      showToast(result?.error || '选择失败');
      return;
    }
    if (result.unchanged) {
      showToast(`当前已是进程 ${result.selectedPid}`);
      return;
    }
    const restarted = Array.isArray(result.restarted) && result.restarted.length
      ? `，已重挂 ${result.restarted.join('+')}`
      : '';
    const title = result.title ? `（${result.title}）` : '';
    showToast(`已选择主进程 ${result.selectedPid}${title}${restarted} · 请普攻一次`);
  }, [refreshState, showToast]);

  const selectXiaoyaProcess = useCallback(async (pid: number) => {
    const result = await window.eco.selectXiaoyaProcess(pid);
    await refreshState();
    showToast(result.ok ? `小雅目标进程 ${result.selectedXiaoyaPid}` : result.error || '选择失败');
  }, [refreshState, showToast]);

  const refreshProcesses = useCallback(async () => {
    const result = await window.eco.refreshGameProcesses();
    await refreshState();
    showToast(result.ok ? `找到 ${result.processes?.length || 0} 个游戏进程` : result.error || '刷新失败');
  }, [refreshState, showToast]);

  const setStatusMonitoring = useCallback(async (enabled: boolean) => {
    const result = await window.eco.saveAppSettings({ overlay: { monitoring: enabled } });
    setState((prev) => ({ ...prev, settings: result.settings }));
    await refreshState();
    const service = (await window.eco.getState()).services?.monitoring;
    if (enabled && service?.state === 'error') {
      showToast(service.message || '状态监控启动失败');
    } else {
      showToast(enabled ? '状态监控已开启（无需伤害采集）' : '状态监控已关闭');
    }
  }, [refreshState, showToast, setState]);

  return {
    toggleService,
    startAll,
    stopAll,
    prestartServices,
    resetDamage,
    reidentifySelf,
    switchCharacter,
    selectGameProcess,
    selectXiaoyaProcess,
    refreshProcesses,
    setStatusMonitoring,
  };
}
