import type { CustomBuffEntry } from '@/types/eco';

export function positiveSeconds(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number;
}

export function skillIdFromCustomKey(key: unknown) {
  let text = String(key || '').trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  for (const prefix of ['skill:', 'cd:']) {
    if (lowered.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }
  if (!/^\d+$/.test(text)) return null;
  const skillId = Number(text);
  return Number.isInteger(skillId) && skillId > 0 ? skillId : null;
}

export function looksLikeSkillKey(key: unknown) {
  const text = String(key || '').trim();
  if (!text) return false;
  const lowered = text.toLowerCase();
  if (lowered.startsWith('skill:') || lowered.startsWith('cd:')) return true;
  return /^\d+$/.test(text);
}

export function normalizeCustomEntry(key: string, value: unknown): CustomBuffEntry | null {
  const name = String(key || '').trim();
  if (!name) return null;
  let duration: number | null = null;
  let cooldown: number | null = null;
  let skillId: number | null = null;
  let label: string | null = null;
  let overlay: boolean | null = null;

  if (
    typeof value === 'number'
    || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  ) {
    const seconds = positiveSeconds(value);
    if (seconds == null) return null;
    if (looksLikeSkillKey(name)) {
      cooldown = seconds;
      skillId = skillIdFromCustomKey(name);
    } else {
      duration = seconds;
    }
  } else if (value && typeof value === 'object') {
    const obj = value as CustomBuffEntry & { cd?: number; name?: string };
    duration = positiveSeconds(obj.duration);
    cooldown = positiveSeconds(obj.cooldown ?? obj.cd);
    const rawSkill = Number(obj.skill_id);
    skillId = Number.isInteger(rawSkill) && rawSkill > 0 ? rawSkill : null;
    label = String(obj.label || obj.name || '').trim() || null;
    if (Object.prototype.hasOwnProperty.call(obj, 'overlay')) {
      overlay = Boolean(obj.overlay);
    }
  } else {
    return null;
  }

  if (skillId == null) skillId = skillIdFromCustomKey(name);
  if (duration == null && cooldown == null) return null;
  const entry: CustomBuffEntry = {};
  if (duration != null) entry.duration = duration;
  if (cooldown != null) entry.cooldown = cooldown;
  if (skillId != null) entry.skill_id = skillId;
  if (label) entry.label = label;
  if (skillId != null) entry.overlay = overlay == null ? true : Boolean(overlay);
  return entry;
}

export function normalizeCustomDurations(raw: Record<string, unknown> | null | undefined) {
  const cleaned: Record<string, CustomBuffEntry> = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const entry = normalizeCustomEntry(key, value);
    if (!entry) continue;
    cleaned[String(key).trim()] = entry;
  }
  return cleaned;
}

export type EditableCustomBuff = {
  id: string;
  key: string;
  duration: string;
  cooldown: string;
  skill_id: string;
  label: string;
  overlay: boolean;
};

export function entriesToEditable(custom: Record<string, CustomBuffEntry>): EditableCustomBuff[] {
  return Object.keys(custom)
    .sort()
    .map((key, index) => {
      const entry = custom[key] || {};
      return {
        id: `${key}-${index}`,
        key,
        duration: entry.duration != null ? String(entry.duration) : '',
        cooldown: entry.cooldown != null ? String(entry.cooldown) : '',
        skill_id: entry.skill_id != null ? String(entry.skill_id) : '',
        label: entry.label || '',
        overlay: entry.skill_id != null ? entry.overlay !== false : false,
      };
    });
}

export function editableToPayload(rows: EditableCustomBuff[]) {
  const result: Record<string, CustomBuffEntry> = {};
  for (const row of rows) {
    const key = String(row.key || '').trim();
    if (!key) continue;
    const duration = positiveSeconds(row.duration);
    const cooldown = positiveSeconds(row.cooldown);
    if (duration == null && cooldown == null) continue;
    const entry: CustomBuffEntry = {};
    if (duration != null) entry.duration = duration;
    if (cooldown != null) entry.cooldown = cooldown;
    const skillId = Number(row.skill_id || skillIdFromCustomKey(key));
    if (Number.isInteger(skillId) && skillId > 0) {
      entry.skill_id = skillId;
      entry.overlay = Boolean(row.overlay);
    }
    const label = String(row.label || '').trim();
    if (label) entry.label = label;
    result[key] = entry;
  }
  return result;
}
