import type { EcoLogEntry, XiaoyaSkill } from '@/types/eco';

export const defaultXiaoyaSkills = (): XiaoyaSkill[] =>
  Array.from({ length: 6 }, () => ({ enabled: false, skillTime: 0, mouse: false, delay: 0 }));

export function appendLog(prev: EcoLogEntry[] | undefined, entry: EcoLogEntry, cap = 1000) {
  return [...(prev || []), entry].slice(-cap);
}

export function mergeEcoState<T extends Record<string, unknown>>(prev: T, next: Partial<T>): T {
  // Light app:state payloads intentionally omit snapshot/logs — preserve local copies.
  const merged = { ...prev, ...next };
  if (!('logs' in next) && 'logs' in prev) {
    (merged as Record<string, unknown>).logs = (prev as Record<string, unknown>).logs;
  }
  if (!('snapshot' in next) && 'snapshot' in prev) {
    (merged as Record<string, unknown>).snapshot = (prev as Record<string, unknown>).snapshot;
  }
  if (!('translation' in next) && 'translation' in prev) {
    (merged as Record<string, unknown>).translation = (prev as Record<string, unknown>).translation;
  }
  return merged;
}
