import type { DamageHistoryItem } from '@/types/eco';

export function historyType(item: DamageHistoryItem) {
  if (item.side === 'pet_dealt') {
    return { key: 'pet' as const, text: item.skill_id == null ? '宠物普攻' : '宠物技能', cls: 'pet' as const };
  }
  if (item.side === 'taken') {
    return { key: 'taken' as const, text: item.skill_id == null ? '受到普攻' : '受到技能', cls: 'taken' as const };
  }
  if (item.skill_id == null) return { key: 'normal' as const, text: '普通攻击', cls: 'normal' as const };
  return { key: 'skill' as const, text: '技能造成', cls: 'skill' as const };
}

export function skillCastRoleLabel(role?: string) {
  return ({ defensive: '防御', self: '自身', combat: '战斗' } as Record<string, string>)[role || ''] || '技能';
}

export const CAPTURE_KEYS = ['skill', 'normal', 'pet', 'taken'] as const;
export const CAPTURE_LABELS: Record<(typeof CAPTURE_KEYS)[number], string> = {
  skill: '技能造成',
  normal: '普通攻击造成',
  pet: '宠物造成',
  taken: '受到伤害',
};

export const PROVIDERS: Record<string, { model: string; url: string }> = {
  deepseek: { model: 'deepseek-chat', url: 'https://api.deepseek.com' },
  openai: { model: 'gpt-4o-mini', url: '' },
  openrouter: { model: 'google/gemini-flash-1.5', url: 'https://openrouter.ai/api/v1' },
  gemini: { model: 'gemini-2.0-flash', url: '' },
  ollama: { model: 'qwen2.5:7b', url: 'http://127.0.0.1:11434' },
  deepl: { model: 'default', url: 'https://api-free.deepl.com/v2' },
};

export const PAGE_META: Record<string, [string, string]> = {
  overview: ['总览', '游戏连接与实时运行状态'],
  damage: ['伤害统计', '技能、普攻、宠物与受到伤害明细'],
  buffs: ['状态监控', '自己角色的增益、减益与异常状态'],
  translation: ['NPC 翻译', '游戏原生对话框实时翻译'],
  xiaoya: ['小雅助手', 'F1–F6 技能按键与延迟配置'],
  logs: ['运行日志', '采集器与翻译服务输出'],
  settings: ['设置', '翻译服务、悬浮窗与启动行为'],
  help: ['帮助', '错误码、热键与版本信息'],
};

export function serviceText(service?: { state?: string; errorCode?: string; message?: string } | null) {
  const labels: Record<string, string> = {
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    stopped: '已停止',
    error: '需要处理',
  };
  const base = labels[service?.state || ''] || '已停止';
  if (service?.state === 'error' && service.errorCode) {
    return `${base} ${service.errorCode}`;
  }
  return base;
}
