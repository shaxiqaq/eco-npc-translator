import { useEffect, useMemo, useRef, useState } from 'react';
import { historyType } from '@/lib/damage';
import { formatNumber } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { SkillIcon, SkillName } from '@/components/SkillIcon';
import { EmptyState } from '@/components/layout';
import type { DamageHistoryItem } from '@/types/eco';

const ROW_HEIGHT = 40;
const OVERSCAN = 10;

export function VirtualDamageList({ items }: { items: DamageHistoryItem[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 360);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = items.length;
  const visibleCount = Math.ceil(viewport / ROW_HEIGHT) + OVERSCAN * 2;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(total, start + visibleCount);
  const slice = useMemo(() => items.slice(start, end), [items, start, end]);
  const offsetY = start * ROW_HEIGHT;

  if (!total) {
    return <EmptyState className="min-h-[160px]">暂无对应伤害数据</EmptyState>;
  }

  return (
    <div
      ref={scrollerRef}
      className="max-h-[480px] min-h-[220px] overflow-auto"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <table className="w-full border-collapse text-left text-xs">
        <thead className="sticky top-0 z-10 bg-[var(--surface)]">
          <tr className="border-b border-[var(--line-soft)] text-[var(--muted-foreground)]">
            <th className="px-2 py-2 font-medium">时间</th>
            <th className="px-2 py-2 font-medium">类型</th>
            <th className="px-2 py-2 font-medium">来源</th>
            <th className="px-2 py-2 font-medium">目标</th>
            <th className="px-2 py-2 font-medium">技能</th>
            <th className="px-2 py-2 text-right font-medium">伤害</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ height: offsetY }}>
            <td colSpan={6} />
          </tr>
          {slice.map((item, index) => {
            const type = historyType(item);
            return (
              <tr
                key={`${start + index}-${item.time}-${item.damage}`}
                className="border-b border-[var(--line-soft)]"
                style={{ height: ROW_HEIGHT }}
              >
                <td className="px-2 py-1.5 tabular-nums text-[var(--muted-foreground)]">{item.time || ''}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={type.cls === '' ? 'normal' : type.cls as 'skill'}>{type.text}</Badge>
                </td>
                <td className="max-w-[120px] truncate px-2 py-1.5" title={item.source}>{item.source}</td>
                <td className="max-w-[120px] truncate px-2 py-1.5" title={item.target}>{item.target}</td>
                <td className="px-2 py-1.5">
                  <div className="skill-cell">
                    <SkillIcon skillId={item.skill_id} fallback={item.skill_id == null ? 'sword' : 'sparkles'} />
                    {item.skill_id == null ? <span>普通攻击</span> : <SkillName skillId={item.skill_id} />}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{formatNumber(item.damage)}</td>
              </tr>
            );
          })}
          <tr style={{ height: Math.max(0, (total - end) * ROW_HEIGHT) }}>
            <td colSpan={6} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
