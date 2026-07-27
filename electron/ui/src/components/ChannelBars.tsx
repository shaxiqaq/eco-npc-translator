import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';

const ROWS: Array<{
  key: string;
  label: string;
  color: string;
  pick: (s: Record<string, number | undefined | null>) => number;
}> = [
  { key: 'self', label: '自身', color: 'bg-[var(--amber)]', pick: (s) => (s.self_skill || 0) + (s.self_normal || 0) },
  { key: 'ride', label: '骑宠', color: 'bg-[var(--blue)]', pick: (s) => (s.ride_skill || 0) + (s.ride_normal || 0) },
  { key: 'pet', label: '宠物', color: 'bg-[var(--green)]', pick: (s) => (s.pet_skill || 0) + (s.pet_normal || 0) },
  {
    key: 'pos',
    label: '依凭',
    color: 'bg-[rgba(200,180,255,.85)]',
    pick: (s) => (s.possession_skill || 0) + (s.possession_normal || 0),
  },
];

/** Horizontal share bars for outgoing damage channels. */
export function ChannelBars({
  totals,
  className,
}: {
  totals: {
    self_skill?: number | null;
    self_normal?: number | null;
    ride_skill?: number | null;
    ride_normal?: number | null;
    pet_skill?: number | null;
    pet_normal?: number | null;
    possession_skill?: number | null;
    possession_normal?: number | null;
  };
  className?: string;
}) {
  const values = ROWS.map((row) => ({
    ...row,
    value: Math.max(0, row.pick(totals as Record<string, number | undefined | null>)),
  }));
  const sum = values.reduce((a, b) => a + b.value, 0);

  if (sum <= 0) {
    return (
      <div className={cn('text-[11px] text-[var(--muted-foreground)]', className)}>
        暂无输出占比 · 进图打几下后显示
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-black/25">
        {values.map((row) => {
          if (row.value <= 0) return null;
          const pct = (row.value / sum) * 100;
          return (
            <div
              key={row.key}
              className={cn('h-full transition-all', row.color)}
              style={{ width: `${pct}%` }}
              title={`${row.label} ${formatNumber(row.value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--muted-foreground)]">
        {values.map((row) => {
          if (row.value <= 0) return null;
          const pct = (row.value / sum) * 100;
          return (
            <span key={row.key} className="inline-flex items-center gap-1">
              <span className={cn('inline-block h-1.5 w-1.5 rounded-full', row.color)} />
              {row.label} {pct.toFixed(0)}% · {formatNumber(row.value)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
