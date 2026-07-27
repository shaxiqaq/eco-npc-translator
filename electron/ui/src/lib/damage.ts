import type { DamageHistoryItem } from '@/types/eco';

const CHANNEL_META: Record<string, { key: string; text: string; cls: 'skill' | 'normal' | 'pet' | 'taken' }> = {
  self_skill: { key: 'self_skill', text: '自身技能', cls: 'skill' },
  self_normal: { key: 'self_normal', text: '自身普攻', cls: 'normal' },
  pet_skill: { key: 'pet_skill', text: '宠物技能', cls: 'pet' },
  pet_normal: { key: 'pet_normal', text: '宠物普攻', cls: 'pet' },
  ride_skill: { key: 'ride_skill', text: '骑宠技能', cls: 'skill' },
  ride_normal: { key: 'ride_normal', text: '骑宠普攻', cls: 'normal' },
  possession_skill: { key: 'possession_skill', text: '依凭技能', cls: 'skill' },
  possession_normal: { key: 'possession_normal', text: '依凭普攻', cls: 'normal' },
};

/** Map fine channel / side to history filter bucket (all | skill | normal | pet | taken). */
function filterBucket(channelKey: string, cls: string): 'skill' | 'normal' | 'pet' | 'taken' {
  if (channelKey === 'taken' || cls === 'taken') return 'taken';
  if (channelKey.startsWith('pet_') || cls === 'pet') return 'pet';
  if (channelKey.endsWith('_skill') || cls === 'skill') return 'skill';
  return 'normal';
}

export function historyType(item: DamageHistoryItem) {
  const ch = (item as { channel?: string }).channel;
  if (ch && CHANNEL_META[ch]) {
    const meta = CHANNEL_META[ch];
    return { ...meta, key: filterBucket(ch, meta.cls) };
  }
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

/** Capture switches — 1:1 with damage metric cards */
export const CAPTURE_KEYS = [
  'self_normal',
  'self_skill',
  'pet_normal',
  'pet_skill',
  'ride_normal',
  'ride_skill',
  'possession_normal',
  'possession_skill',
  'taken',
] as const;

export type CaptureKey = (typeof CAPTURE_KEYS)[number];

export const CAPTURE_LABELS: Record<CaptureKey, string> = {
  self_normal: '自身普攻',
  self_skill: '自身技能',
  pet_normal: '宠物普攻',
  pet_skill: '宠物技能',
  ride_normal: '骑宠普攻',
  ride_skill: '骑宠技能',
  possession_normal: '依凭普攻',
  possession_skill: '依凭技能',
  taken: '受到伤害',
};

/** Color token for switch strip / badges */
export const CAPTURE_COLORS: Record<CaptureKey, string> = {
  self_normal: 'normal',
  self_skill: 'skill',
  pet_normal: 'pet',
  pet_skill: 'pet',
  ride_normal: 'normal',
  ride_skill: 'skill',
  possession_normal: 'normal',
  possession_skill: 'skill',
  taken: 'taken',
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
  damage: ['伤害统计', '分渠道伤害与明细'],
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
