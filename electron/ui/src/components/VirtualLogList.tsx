import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { EcoLogEntry } from '@/types/eco';

const ROW_HEIGHT = 28;
const OVERSCAN = 12;

const SERVICE_LABELS: Record<string, string> = {
  damage: '伤害采集',
  monitoring: '状态监控',
  translator: 'NPC 翻译',
  xiaoya: '小雅助手',
  buffs: '状态监控',
  app: '应用',
  update: '更新',
};

export function VirtualLogList({
  entries,
  className,
}: {
  entries: EcoLogEntry[];
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(420);
  const stickBottom = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 420);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const total = entries.length;
  const visibleCount = Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(total, start + visibleCount);
  const slice = useMemo(() => entries.slice(start, end), [entries, start, end]);
  const offsetY = start * ROW_HEIGHT;

  return (
    <div
      ref={scrollerRef}
      className={cn('log-console min-h-[420px] overflow-auto p-2', className)}
      onScroll={(event) => {
        const el = event.currentTarget;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickBottom.current = distance < 48;
        setScrollTop(el.scrollTop);
      }}
    >
      <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((entry, index) => (
            <div
              key={`${start + index}-${entry.time}-${entry.service}-${entry.message}`}
              className={cn('console-line', entry.level || 'info')}
              style={{ height: ROW_HEIGHT }}
            >
              <time>{entry.time}</time>
              <b>{SERVICE_LABELS[entry.service || ''] || entry.service || '未知'}</b>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
