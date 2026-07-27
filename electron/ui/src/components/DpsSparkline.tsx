import { cn } from '@/lib/utils';

/** Tiny SVG sparkline for battle-report DPS history (no chart library). */
export function DpsSparkline({
  points,
  className,
  height = 36,
  width = 160,
}: {
  points?: Array<{ t?: number; dps?: number; dealt?: number }> | null;
  className?: string;
  height?: number;
  width?: number;
}) {
  const series = (points || [])
    .map((p) => Number(p.dps) || 0)
    .filter((v) => Number.isFinite(v));

  if (series.length < 2) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-[var(--line-soft)] bg-black/10 text-[10px] text-[var(--muted-foreground)]',
          className,
        )}
        style={{ height, width }}
      >
        采样不足
      </div>
    );
  }

  const max = Math.max(...series, 0.001);
  const min = Math.min(...series);
  const span = Math.max(max - min, max * 0.08, 0.001);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const coords = series.map((v, i) => {
    const x = pad + (i / (series.length - 1)) * w;
    const y = pad + h - ((v - min) / span) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(' ');
  const area = `${pad},${pad + h} ${line} ${pad + w},${pad + h}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <polygon points={area} fill="rgba(242,184,75,0.12)" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--amber)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
