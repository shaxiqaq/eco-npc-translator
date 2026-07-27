import { useMemo, useState } from 'react';
import {
  RotateCcw,
  RadioTower,
  FileDown,
  ClipboardCopy,
  UserRoundSearch,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { formatNumber } from '@/lib/format';
import {
  CAPTURE_COLORS,
  CAPTURE_KEYS,
  CAPTURE_LABELS,
  type CaptureKey,
  historyType,
  skillCastRoleLabel,
} from '@/lib/damage';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Card } from '@/components/ui/card';
import { SkillIcon, SkillName } from '@/components/SkillIcon';
import {
  PageStack,
  PageToolbar,
  MetricCard,
  DataCard,
  EmptyState,
} from '@/components/layout';
import { VirtualDamageList } from '@/components/VirtualDamageList';
import { cn } from '@/lib/utils';
import type { DamageHistoryItem, Snapshot } from '@/types/eco';

const CHANNEL_DEFS: {
  key: CaptureKey;
  accent: 'white' | 'amber' | 'green' | 'blue' | 'red';
  total: (s: Snapshot | null) => number | undefined;
  hits: (s: Snapshot | null) => number | undefined;
  dps?: (s: Snapshot | null) => number | undefined;
}[] = [
  {
    key: 'self_normal',
    accent: 'white',
    total: (s) => s?.self_normal_dealt,
    hits: (s) => s?.hits_self_normal_dealt,
    dps: (s) => s?.self_normal_dps,
  },
  {
    key: 'self_skill',
    accent: 'amber',
    total: (s) => s?.self_skill_dealt,
    hits: (s) => s?.hits_self_skill_dealt,
    dps: (s) => s?.self_skill_dps,
  },
  {
    key: 'pet_normal',
    accent: 'green',
    total: (s) => s?.pet_normal_dealt,
    hits: (s) => s?.hits_pet_normal_dealt,
    dps: (s) => s?.pet_normal_dps,
  },
  {
    key: 'pet_skill',
    accent: 'green',
    total: (s) => s?.pet_skill_dealt,
    hits: (s) => s?.hits_pet_skill_dealt,
    dps: (s) => s?.pet_skill_dps,
  },
  {
    key: 'ride_normal',
    accent: 'blue',
    total: (s) => s?.ride_normal_dealt,
    hits: (s) => s?.hits_ride_normal_dealt,
    dps: (s) => s?.ride_normal_dps,
  },
  {
    key: 'ride_skill',
    accent: 'blue',
    total: (s) => s?.ride_skill_dealt,
    hits: (s) => s?.hits_ride_skill_dealt,
    dps: (s) => s?.ride_skill_dps,
  },
  {
    key: 'possession_normal',
    accent: 'white',
    total: (s) => s?.possession_normal_dealt,
    hits: (s) => s?.hits_possession_normal_dealt,
    dps: (s) => s?.possession_normal_dps,
  },
  {
    key: 'possession_skill',
    accent: 'amber',
    total: (s) => s?.possession_skill_dealt,
    hits: (s) => s?.hits_possession_skill_dealt,
    dps: (s) => s?.possession_skill_dps,
  },
  {
    key: 'taken',
    accent: 'red',
    total: (s) => s?.taken,
    hits: (s) => s?.hits_taken,
    dps: (s) => s?.tps,
  },
];

/** Infer capture channel for a history row (handles older rows without channel). */
function itemChannel(item: DamageHistoryItem): CaptureKey | null {
  const ch = item.channel;
  if (ch && (CAPTURE_KEYS as readonly string[]).includes(ch)) {
    return ch as CaptureKey;
  }
  if (item.side === 'taken') return 'taken';
  if (item.side === 'pet_dealt') {
    return item.skill_id == null ? 'pet_normal' : 'pet_skill';
  }
  if (item.side === 'dealt') {
    return item.skill_id == null ? 'self_normal' : 'self_skill';
  }
  return null;
}

const accentText: Record<string, string> = {
  amber: 'text-[var(--amber)]',
  green: 'text-[var(--green)]',
  red: 'text-[var(--red)]',
  blue: 'text-[var(--blue)]',
  white: 'text-[#e9eceb]',
};

export function DamagePage() {
  const {
    snapshot,
    historyFilter,
    setHistoryFilter,
    state,
    saveCaptureSetting,
    resetDamage,
    switchCharacter,
    showToast,
  } = useEco();
  const report = state.battleReport;
  const capture = state.settings?.capture || {};
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hideEmptyChannels, setHideEmptyChannels] = useState(true);

  const historyNewestFirst = useMemo(
    () => [...(snapshot?.damage_history || [])].reverse(),
    [snapshot?.damage_history],
  );

  const byChannel = useMemo(() => {
    const map: Record<string, DamageHistoryItem[]> = {};
    for (const key of CAPTURE_KEYS) map[key] = [];
    for (const item of historyNewestFirst) {
      const ch = itemChannel(item);
      if (ch) map[ch].push(item);
    }
    return map;
  }, [historyNewestFirst]);

  const items = historyNewestFirst
    .filter((item) => historyFilter === 'all' || historyType(item).key === historyFilter)
    .slice(0, 500);
  const casts = snapshot?.skill_casts || [];
  const castHistory = snapshot?.skill_cast_history || [];
  const labels: Record<string, string> = {
    all: '全部伤害流水',
    skill: '技能造成流水',
    normal: '普通攻击造成流水',
    pet: '宠物造成流水',
    taken: '受到伤害流水',
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <PageStack>
      <PageToolbar>
        <ToggleGroup value={historyFilter} onValueChange={setHistoryFilter}>
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="skill">技能造成</ToggleGroupItem>
          <ToggleGroupItem value="normal">普攻造成</ToggleGroupItem>
          <ToggleGroupItem value="pet">宠物造成</ToggleGroupItem>
          <ToggleGroupItem value="taken">受到伤害</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex flex-wrap items-center gap-2">
          {snapshot?.ride_mode ? (
            <Badge className="bg-[var(--blue)]/20 text-[var(--blue)] font-normal">
              骑宠中
              {snapshot.ride_mount_id != null ? ` #${snapshot.ride_mount_id}` : ''}
              {snapshot.ride_mode_remaining != null
                ? ` · ${Math.max(0, Math.round(Number(snapshot.ride_mode_remaining)))}s`
                : ''}
            </Badge>
          ) : null}
          {snapshot?.possession_host_id != null ? (
            <Badge variant="secondary" className="font-normal">
              依凭 #{snapshot.possession_host_id}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              if (!window.eco.copyBattleReport) {
                showToast('当前版本不支持复制战斗报告');
                return;
              }
              const result = await window.eco.copyBattleReport();
              showToast(result?.ok ? '报告已复制' : result?.error || '复制失败');
            }}
          >
            <ClipboardCopy />
            复制报告
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              if (!window.eco.exportBattleReport) {
                showToast('当前版本不支持导出战斗报告');
                return;
              }
              const result = await window.eco.exportBattleReport({ format: 'txt' });
              if (result?.cancelled) return;
              showToast(result?.ok ? '战斗报告已导出' : result?.error || '导出失败');
            }}
          >
            <FileDown />
            导出报告
          </Button>
          <Button
            type="button"
            title="换号后点此，再普攻一次"
            onClick={() => void switchCharacter()}
          >
            <UserRoundSearch />
            换号识别
          </Button>
          <Button type="button" variant="secondary" onClick={() => void resetDamage()}>
            <RotateCcw />
            清空统计
          </Button>
        </div>
      </PageToolbar>

      {(report?.samples || report?.peakDps) ? (
        <Card className="grid grid-cols-2 gap-2 px-3.5 py-3 sm:grid-cols-4">
          <div className="text-xs">
            <div className="text-[var(--muted-foreground)]">会话峰值 DPS</div>
            <div className="text-lg font-bold tabular-nums text-[var(--amber)]">{formatNumber(report?.peakDps, 2)}</div>
          </div>
          <div className="text-xs">
            <div className="text-[var(--muted-foreground)]">会话峰值总伤</div>
            <div className="text-lg font-bold tabular-nums">{formatNumber(report?.peakDealt)}</div>
          </div>
          <div className="text-xs">
            <div className="text-[var(--muted-foreground)]">采样次数</div>
            <div className="text-lg font-bold tabular-nums">{formatNumber(report?.samples)}</div>
          </div>
          <div className="text-xs">
            <div className="text-[var(--muted-foreground)]">记忆角色窗口</div>
            <div className="truncate text-sm font-semibold" title={state.rememberedTitles?.main || ''}>
              {state.rememberedTitles?.main || '（未记忆）'}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard
          label="总计造成"
          value={formatNumber(snapshot?.dealt)}
          hint={`宠物 ${formatNumber(snapshot?.pet_dealt)} · 命中 ${formatNumber((snapshot?.hits_dealt || 0) + (snapshot?.hits_pet_dealt || 0))}`}
          accent="amber"
        />
        <MetricCard label="综合秒伤" value={formatNumber(snapshot?.dps, 2)} hint="自身+骑宠+依凭" accent="white" />
        <MetricCard label="最大技能" value={formatNumber(snapshot?.max_skill_dealt)} hint={`${formatNumber(snapshot?.hits_skill_dealt)} 次技能`} accent="amber" />
        <MetricCard label="技能释放" value={formatNumber(snapshot?.skill_cast_total)} hint="含防御/自身技" accent="blue" />
      </div>

      {/* 分渠道：汇总 + 开关 + 可展开明细 */}
      <Card className="space-y-2 px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted-foreground)]">
            <RadioTower className="h-4 w-4 text-[var(--amber)]" />
            分渠道统计 · 点击卡片展开每次伤害明细
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
              <Switch
                checked={hideEmptyChannels}
                onCheckedChange={setHideEmptyChannels}
              />
              隐藏空渠道
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                const visible = CHANNEL_DEFS.filter((d) => {
                  if (!hideEmptyChannels) return true;
                  return (d.total(snapshot) || 0) > 0 || (byChannel[d.key] || []).length > 0;
                });
                const allOpen = visible.every((d) => expanded[d.key]);
                const next: Record<string, boolean> = { ...expanded };
                for (const d of visible) next[d.key] = !allOpen;
                setExpanded(next);
              }}
            >
              {CHANNEL_DEFS.every((d) => expanded[d.key]) ? '全部收起' : '全部展开'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {CHANNEL_DEFS.map((def) => {
            const key = def.key;
            const label = CAPTURE_LABELS[key];
            const on = capture[key] !== false;
            const total = def.total(snapshot) || 0;
            const hits = def.hits(snapshot) || 0;
            const dps = def.dps?.(snapshot);
            const rows = byChannel[key] || [];
            const open = Boolean(expanded[key]);
            const maxHit = rows.reduce((m, r) => Math.max(m, Number(r.damage) || 0), 0);
            const avg = hits > 0 ? total / hits : 0;
            if (hideEmptyChannels && total <= 0 && rows.length === 0) return null;

            return (
              <div
                key={key}
                className={cn(
                  'overflow-hidden rounded-xl border transition-colors',
                  on ? 'border-[var(--line-soft)] bg-black/10' : 'border-[var(--line-soft)] bg-black/5 opacity-70',
                )}
              >
                <div className="flex items-stretch gap-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left hover:bg-white/[0.03]"
                    onClick={() => toggleExpand(key)}
                  >
                    <span className="mt-1 text-[var(--muted-foreground)]">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
                        <span className={cn('capture-color', CAPTURE_COLORS[key])} />
                        <span className="font-medium text-[var(--foreground)]">{label}</span>
                        {!on ? <Badge variant="secondary" className="text-[9px]">已关闭采集</Badge> : null}
                        <span className="text-[10px]">{rows.length} 条记录</span>
                      </div>
                      <div className={cn('mt-0.5 text-xl font-bold tabular-nums', accentText[def.accent])}>
                        {formatNumber(total)}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--muted-foreground)]">
                        <span>{formatNumber(hits)} 次</span>
                        <span>最大 {formatNumber(maxHit || undefined)}</span>
                        <span>均伤 {formatNumber(avg, 1)}</span>
                        {dps != null ? <span>秒伤 {formatNumber(dps, 2)}</span> : null}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center border-l border-[var(--line-soft)] px-2.5">
                    <Switch
                      checked={on}
                      onCheckedChange={(v) => void saveCaptureSetting(key, v)}
                      title={on ? `关闭「${label}」采集` : `开启「${label}」采集`}
                    />
                  </div>
                </div>

                {open ? (
                  <div className="border-t border-[var(--line-soft)] bg-black/15">
                    {!rows.length ? (
                      <div className="px-3 py-4 text-center text-[11px] text-[var(--muted-foreground)]">
                        暂无「{label}」明细 · 产生伤害后会显示在这里
                      </div>
                    ) : (
                      <div className="max-h-[240px] overflow-auto">
                        <table className="w-full border-collapse text-left text-[11px]">
                          <thead className="sticky top-0 z-[1] bg-[var(--surface)]">
                            <tr className="border-b border-[var(--line-soft)] text-[var(--muted-foreground)]">
                              <th className="px-2 py-1.5 font-medium">时间</th>
                              <th className="px-2 py-1.5 font-medium">来源</th>
                              <th className="px-2 py-1.5 font-medium">目标</th>
                              <th className="px-2 py-1.5 font-medium">技能</th>
                              <th className="px-2 py-1.5 text-right font-medium">伤害</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.slice(0, 120).map((item, index) => (
                              <tr
                                key={`${key}-${item.time}-${item.damage}-${index}`}
                                className="border-b border-[var(--line-soft)]/80"
                              >
                                <td className="whitespace-nowrap px-2 py-1 tabular-nums text-[var(--muted-foreground)]">
                                  {item.time || '—'}
                                </td>
                                <td className="max-w-[100px] truncate px-2 py-1" title={item.source}>
                                  {item.source || '—'}
                                </td>
                                <td className="max-w-[100px] truncate px-2 py-1" title={item.target}>
                                  {item.target || '—'}
                                </td>
                                <td className="px-2 py-1">
                                  <div className="skill-cell">
                                    <SkillIcon
                                      skillId={item.skill_id}
                                      fallback={item.skill_id == null ? 'sword' : 'sparkles'}
                                    />
                                    {item.skill_id == null ? (
                                      <span>普通攻击</span>
                                    ) : (
                                      <SkillName skillId={item.skill_id} preferName={item.skill} />
                                    )}
                                  </div>
                                </td>
                                <td className={cn('px-2 py-1 text-right font-semibold tabular-nums', accentText[def.accent])}>
                                  {formatNumber(item.damage)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {rows.length > 120 ? (
                          <div className="px-2 py-1.5 text-center text-[10px] text-[var(--muted-foreground)]">
                            仅显示最近 120 条 · 完整流水见下方列表
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <DataCard
          title="技能释放统计"
          description={`${casts.length} 种 · 含 パリイ 等 0 伤害技能`}
          bare
        >
          {!casts.length ? (
            <EmptyState>释放技能后显示在这里（含 パリイ 等防御技）</EmptyState>
          ) : (
            <div className="skill-cast-list max-h-[280px] overflow-auto">
              {casts.map((item) => {
                const role = item.role || 'combat';
                return (
                  <div key={item.skill_id} className="skill-cast-row">
                    <SkillIcon skillId={item.skill_id} fallback={role === 'defensive' ? 'shield' : 'sparkles'} />
                    <strong>
                      <SkillName skillId={item.skill_id} preferName={item.skill} showWiki />{' '}
                      <span className={cn('role-badge', role)}>{skillCastRoleLabel(role)}</span>
                    </strong>
                    <b>×{formatNumber(item.count)}</b>
                  </div>
                );
              })}
            </div>
          )}
        </DataCard>

        <DataCard title="最近释放" description={`${castHistory.length} 条`} bare>
          {!castHistory.length ? (
            <EmptyState>暂无释放记录</EmptyState>
          ) : (
            <div className="skill-cast-history max-h-[280px] overflow-auto">
              {castHistory.map((item, index) => {
                const role = item.role || 'combat';
                return (
                  <div key={`${item.time}-${item.skill_id}-${index}`} className="skill-cast-history-row">
                    <time>{item.time || ''}</time>
                    <SkillIcon skillId={item.skill_id} fallback={role === 'defensive' ? 'shield' : 'sparkles'} />
                    <strong>
                      {item.skill || `技能#${item.skill_id}`}{' '}
                      <span className={cn('role-badge', role)}>{skillCastRoleLabel(role)}</span>
                    </strong>
                    <b>{item.target_label || ''}</b>
                  </div>
                );
              })}
            </div>
          )}
        </DataCard>
      </div>

      <DataCard
        title={labels[historyFilter]}
        description={`${items.length} 条`}
        action={<Badge variant="secondary" className="gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />实时更新</Badge>}
        bare
      >
        <VirtualDamageList items={items} />
      </DataCard>
    </PageStack>
  );
}
