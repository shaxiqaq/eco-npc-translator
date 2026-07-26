import { useCallback } from 'react';
import type { EcoAppState, XiaoyaSkill } from '@/types/eco';
import { defaultXiaoyaSkills } from '@/context/eco-helpers';

type ShowToast = (message: string) => void;

export function useXiaoyaActions(options: {
  state: EcoAppState;
  xiaoyaSkills: XiaoyaSkill[];
  setXiaoyaSkills: React.Dispatch<React.SetStateAction<XiaoyaSkill[]>>;
  showToast: ShowToast;
  refreshState: () => Promise<void>;
}) {
  const { state, xiaoyaSkills, setXiaoyaSkills, showToast, refreshState } = options;

  const applySkills = useCallback((incoming?: XiaoyaSkill[] | null) => {
    if (!incoming) return;
    const skills = [...defaultXiaoyaSkills()];
    incoming.forEach((skill, index) => {
      if (index < 6) skills[index] = { ...skills[index], ...skill };
    });
    setXiaoyaSkills(skills);
  }, [setXiaoyaSkills]);

  const saveXiaoyaConfig = useCallback(async () => {
    const result = await window.eco.saveXiaoyaConfig(xiaoyaSkills);
    if (!result.ok) {
      showToast(result.error || '保存失败');
      return;
    }
    applySkills(result.skills as XiaoyaSkill[] | undefined);
    showToast('小雅配置已保存');
  }, [xiaoyaSkills, showToast, applySkills]);

  const reloadXiaoyaConfig = useCallback(async () => {
    const result = await window.eco.getXiaoyaConfig();
    if (!result.ok) {
      showToast(result.error || '读取失败');
      return;
    }
    applySkills(result.skills as XiaoyaSkill[] | undefined);
    showToast('已读取上次设置');
  }, [showToast, applySkills]);

  const toggleXiaoya = useCallback(async () => {
    const active = ['starting', 'running', 'stopping'].includes(state.xiaoya?.state || '');
    const result = active ? await window.eco.stopXiaoya() : await window.eco.startXiaoya();
    if (!result.ok && result.error) showToast(result.error);
    await refreshState();
  }, [state.xiaoya?.state, showToast, refreshState]);

  const toggleXiaoyaSs = useCallback(async () => {
    const result = await window.eco.toggleXiaoyaSs();
    if (!result.ok && result.error) showToast(result.error);
    else showToast('已切换 SS');
  }, [showToast]);

  const toggleXiaoyaVisibility = useCallback(async () => {
    const result = await window.eco.toggleXiaoyaVisibility();
    if (!result.ok && result.error) showToast(result.error);
    else showToast('已切换 ECO 显示/隐藏');
  }, [showToast]);

  const openXiaoyaFolder = useCallback(async () => {
    const result = await window.eco.openXiaoyaFolder();
    if (!result.ok) showToast(result.error || '无法打开小雅目录');
  }, [showToast]);

  return {
    saveXiaoyaConfig,
    reloadXiaoyaConfig,
    toggleXiaoya,
    toggleXiaoyaSs,
    toggleXiaoyaVisibility,
    openXiaoyaFolder,
  };
}
