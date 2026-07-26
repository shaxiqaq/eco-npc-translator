import { Sparkles, Sword, Shield, Timer, Hourglass, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSkillIcon } from '@/hooks/useSkillIcon';

const FALLBACKS = {
  sparkles: Sparkles,
  sword: Sword,
  shield: Shield,
  timer: Timer,
  hourglass: Hourglass,
  tag: Tag,
} as const;

export function SkillIcon({
  skillId,
  fallback = 'sparkles',
  expiring = false,
  className,
}: {
  skillId?: number | null;
  fallback?: keyof typeof FALLBACKS;
  expiring?: boolean;
  className?: string;
}) {
  const { dataUrl } = useSkillIcon(skillId);
  const Icon = FALLBACKS[fallback] || Sparkles;
  return (
    <span className={cn('skill-icon inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--surface-2)] border border-[var(--line-soft)]', expiring && 'expiring ring-1 ring-[var(--red)]', className)}>
      {dataUrl ? (
        <img src={dataUrl} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <Icon className="h-3.5 w-3.5 text-[var(--muted)]" aria-hidden />
      )}
    </span>
  );
}

export function SkillName({
  skillId,
  fallback,
  preferName,
}: {
  skillId?: number | null;
  fallback?: string;
  preferName?: string;
}) {
  const { name } = useSkillIcon(skillId);
  if (preferName) return <span>{preferName}</span>;
  if (name) return <span>{name}</span>;
  if (fallback) return <span>{fallback}</span>;
  const id = Number(skillId);
  return <span>{Number.isInteger(id) && id > 0 ? `技能#${id}` : '未知'}</span>;
}
