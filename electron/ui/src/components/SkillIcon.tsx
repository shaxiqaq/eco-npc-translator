import { ExternalLink, Sparkles, Sword, Shield, Timer, Hourglass, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSkillIcon } from '@/hooks/useSkillIcon';
import { useEco } from '@/context/EcoContext';

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

function pickDisplayName(options: {
  mode: string;
  preferName?: string;
  iconName?: string | null;
  nameClient?: string;
  nameJa?: string;
  skillId?: number | null;
  fallback?: string;
}) {
  const { mode, preferName, iconName, nameClient, nameJa, skillId, fallback } = options;
  const prefer = String(preferName || '').trim();
  const client = String(nameClient || iconName || '').trim();
  const ja = String(nameJa || '').trim();
  if (mode === 'ja') return ja || prefer || client || fallback || (skillId ? `技能#${skillId}` : '未知');
  if (mode === 'dual') {
    const left = prefer || client;
    if (left && ja && left !== ja) return `${left} / ${ja}`;
    return left || ja || fallback || (skillId ? `技能#${skillId}` : '未知');
  }
  return prefer || client || ja || fallback || (skillId ? `技能#${skillId}` : '未知');
}

export function SkillName({
  skillId,
  fallback,
  preferName,
  showWiki = false,
}: {
  skillId?: number | null;
  fallback?: string;
  preferName?: string;
  /** Show a small external link to lycolia wiki search */
  showWiki?: boolean;
}) {
  const { name, nameClient, nameJa, wikiUrl } = useSkillIcon(skillId);
  const { state } = useEco();
  const mode = String(state.settings?.appearance?.skillNameMode || 'client');
  const text = pickDisplayName({
    mode,
    preferName,
    iconName: name,
    nameClient,
    nameJa,
    skillId,
    fallback,
  });

  if (!showWiki || !wikiUrl) {
    return <span title={text}>{text}</span>;
  }

  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="truncate" title={text}>{text}</span>
      <a
        href={wikiUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 text-[var(--muted-foreground)] hover:text-[var(--amber)]"
        title="在 ECO Wiki 搜索"
        onClick={(event) => event.stopPropagation()}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </span>
  );
}
