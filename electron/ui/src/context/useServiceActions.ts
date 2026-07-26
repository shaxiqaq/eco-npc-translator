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

  const resetDamage = useCallback(async () => {
    await window.eco.resetDamage();
    showToast('伤害统计已清空');
  }, [showToast]);

  const selectGameProcess = useCallback(async (pid: number) => {
    const result = await window.eco.selectGameProcess(pid);
    await refreshState();
    showToast(result.ok ? `已选择主进程 ${result.selectedPid}` : result.error || '选择失败');
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
    resetDamage,
    selectGameProcess,
    selectXiaoyaProcess,
    refreshProcesses,
    setStatusMonitoring,
  };
}
