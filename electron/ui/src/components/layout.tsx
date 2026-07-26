import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function PageStack({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('page-stack', className)} {...props} />;
}

export function PageToolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('page-toolbar-row', className)} {...props} />;
}

export function SectionHeader({
  title,
  description,
  action,
  className,
  compact = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3',
        compact
          ? 'min-h-[54px] border-b border-[var(--line-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,.03),transparent)] px-4 py-2'
          : 'rounded-[var(--radius)] border border-[var(--line-soft)] bg-[rgba(16,12,22,.32)] px-3 py-2.5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="m-0 text-sm font-semibold tracking-wide text-[var(--foreground)]">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-[52ch] text-[10px] leading-relaxed text-[var(--muted-foreground)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function DataCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
  bare = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  bare?: boolean;
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      {(title || action) && (
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 py-2.5">
          <div className="min-w-0">
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {action}
        </CardHeader>
      )}
      <CardContent className={cn(bare ? 'p-0' : undefined, contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-[120px] items-center justify-center px-4 py-8 text-center text-xs text-[var(--muted-foreground)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  accent,
  disabled,
  action,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'amber' | 'white' | 'green' | 'red' | 'blue';
  disabled?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  const accentClass = {
    amber: 'text-[var(--amber)]',
    white: 'text-[#e9eceb]',
    green: 'text-[var(--green)]',
    red: 'text-[var(--red)]',
    blue: 'text-[var(--blue)]',
  }[accent || 'white'];

  const barClass = {
    amber: 'bg-[var(--amber)]',
    white: 'bg-[#d8dce0]',
    green: 'bg-[var(--green)]',
    red: 'bg-[var(--red)]',
    blue: 'bg-[var(--blue)]',
  }[accent || 'white'];

  return (
    <Card
      className={cn(
        'relative min-h-[104px] overflow-hidden p-4 transition-colors hover:bg-white/[0.02]',
        disabled && 'opacity-60',
        className,
      )}
    >
      <div className={cn('absolute inset-y-0 left-0 w-[3px]', barClass)} />
      <div className="flex items-start justify-between gap-2">
        <span className={cn('text-[11px] font-bold', accentClass)}>{label}</span>
        {action}
      </div>
      <div className={cn('mt-2.5 text-2xl font-semibold tabular-nums tracking-tight', disabled && 'opacity-50')}>
        {value}
      </div>
      {hint ? <div className={cn('mt-1.5 text-[10px] text-[var(--muted-foreground)]', disabled && 'opacity-50')}>{hint}</div> : null}
    </Card>
  );
}

export function ServiceCard({
  icon,
  label,
  status,
  message,
  action,
  tone = 'amber',
}: {
  icon: ReactNode;
  label: string;
  status: ReactNode;
  message?: ReactNode;
  action?: ReactNode;
  tone?: 'amber' | 'green' | 'teal' | 'blue';
}) {
  const toneClass = {
    amber: 'bg-[var(--amber-dark)] text-[var(--amber)]',
    green: 'bg-[rgba(25,51,41,.9)] text-[var(--green)]',
    teal: 'bg-[rgba(24,51,47,.9)] text-[var(--teal)]',
    blue: 'bg-[rgba(28,45,59,.9)] text-[var(--blue)]',
  }[tone];

  return (
    <Card className="grid min-h-[86px] grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 p-3.5 transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--surface-2)]">
      <div className={cn('grid h-[38px] w-[38px] place-items-center rounded-[11px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)]', toneClass)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] text-[var(--muted-foreground)]">{label}</div>
        <div className="mt-0.5 truncate text-[13px] font-semibold">{status}</div>
        {message ? <div className="mt-0.5 truncate text-[10px] text-[#737c81]">{message}</div> : null}
      </div>
      <div className="shrink-0">{action}</div>
    </Card>
  );
}

export function TextLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <Button type="button" variant="link" size="sm" className="h-auto gap-1 px-0 text-[11px]" onClick={onClick}>
      {children}
    </Button>
  );
}

export function TypeBadge({ type }: { type: 'skill' | 'normal' | 'pet' | 'taken' | string }) {
  const variant =
    type === 'skill' ? 'skill'
      : type === 'pet' ? 'pet'
        : type === 'taken' ? 'taken'
          : type === 'normal' ? 'normal'
            : 'secondary';
  return <Badge variant={variant as 'skill'}>{type}</Badge>;
}
