import {
  Swords,
  ShieldCheck,
  Languages,
  PictureInPicture2,
  Play,
  Square,
  ArrowRight,
  UserRoundSearch,
  UserRound,
} from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { formatDuration, formatExpRate, formatNumber, formatPercent } from '@/lib/format';
import { historyType, serviceText } from '@/lib/damage';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SkillIcon, SkillName } from '@/components/SkillIcon';
import { Card } from '@/components/ui/card';
import {
  PageStack,
  SectionHeader,
  MetricCard,
  DataCard,
  EmptyState,
  TextLink,
} from '@/components/layout';
import { ActionBanner } from '@/components/ActionBanner';
import { ChannelBars } from '@/components/ChannelBars';
import { DpsSparkline } from '@/components/DpsSparkline';
import { cn } from '@/lib/utils';

function ServiceChip({
  icon,
  label,
  status,
  action,
  tone = 'amber',
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  action: React.ReactNode;
  tone?: 'amber' | 'green' | 'teal' | 'blue';
}) {
  const toneClass = {
    amber: 'bg-[var(--amber-dark)] text-[var(--amber)]',
    green: 'bg-[rgba(25,51,41,.9)] text-[var(--green)]',
    teal: 'bg-[rgba(24,51,47,.9)] text-[var(--teal)]',
    blue: 'bg-[rgba(28,45,59,.9)] text-[var(--blue)]',
  }[tone];

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5">
      <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)]', toneClass)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-[var(--muted-foreground)]">{label}</div>
        <div className="truncate text-xs font-semibold leading-tight">{status}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export function OverviewPage() {
  const {
    state,
    snapshot,
    setPage,
    toggleService,
    setStatusMonitoring,
    setOverlayVisible,
    switchCharacter,
  } = useEco();

  const damageRunning = ['running', 'starting'].includes(state.services?.damage?.state || '');
  const translatorRunning = ['running', 'starting'].includes(state.services?.translator?.state || '');
  const monitoringOn = state.settings?.overlay?.monitoring !== false;
  const overlayVisible = state.settings?.overlay?.visible !== false;
  const capture = state.settings?.capture || {};
  const recent = [...(snapshot?.damage_history || [])].reverse().slice(0, 5);
  const selfId = snapshot?.self_id;
  const hasSelf = selfId != null && selfId !== '';
  const rebindPending = Boolean(snapshot?.rebind_pending);
  const captureUp = damageRunning
    || ['running', 'starting'].includes(state.services?.monitoring?.state || '');

  return (
    <PageStack>
      {/* 角色条：换号只保留一个主按钮 */}
      <Card className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
            hasSelf
              ? 'bg-[rgba(25,51,41,.9)] text-[var(--green)]'
              : 'bg-[var(--amber-dark)] text-[var(--amber)]',
          )}
          >
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-[var(--muted-foreground)]">当前角色</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold tabular-nums">
                {hasSelf ? `#${selfId}` : (captureUp ? '等待识别' : '采集未开启')}
              </span>
              {rebindPending && hasSelf ? (
                <Badge variant="warning" className="text-[10px]">待确认 · 请普攻一次</Badge>
              ) : null}
              {!hasSelf && captureUp ? (
                <Badge variant="warning" className="text-[10px]">请普攻一次</Badge>
              ) : null}
              {snapshot?.ride_mode ? (
                <Badge variant="default" className="bg-[var(--blue)]/20 text-[var(--blue)] text-[10px]">
                  骑宠中{snapshot.ride_mount_id != null ? ` #${snapshot.ride_mount_id}` : ''}
                </Badge>
              ) : null}
              {snapshot?.possession_host_id != null ? (
                <Badge variant="secondary" className="text-[10px]">
                  依凭 → #{snapshot.possession_host_id}
                </Badge>
              ) : null}
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
              战斗 {formatDuration(snapshot?.active)} · 峰值 DPS {formatNumber(state.battleReport?.peakDps, 2)}
              {snapshot?.ride_mode && snapshot.ride_mode_remaining != null
                ? ` · 骑宠粘性 ${Math.max(0, Math.round(Number(snapshot.ride_mode_remaining)))}s`
                : ''}
            </div>
          </div>
        </div>
        <Button
          type="button"
          className="h-9 gap-1.5 px-3"
          title="一键：重连采集 + 清空本场伤害 + 准备识别新角色，然后普攻一次即可"
          onClick={() => void switchCharacter()}
        >
          <UserRoundSearch className="h-4 w-4" />
          换号识别
        </Button>
      </Card>

      <ActionBanner />

      <Card className="flex flex-row divide-x divide-[var(--line-soft)] overflow-hidden p-0">
        <ServiceChip
          tone="amber"
          icon={<Swords className="h-4 w-4" />}
          label="伤害采集"
          status={serviceText(state.services?.damage)}
          action={(
            <Button type="button" variant="ghost" size="icon-sm" className="h-8 w-8" onClick={() => void toggleService('damage')} title={damageRunning ? '停止' : '启动'}>
              {damageRunning ? <Square /> : <Play />}
            </Button>
          )}
        />
        <ServiceChip
          tone="green"
          icon={<ShieldCheck className="h-4 w-4" />}
          label="状态监控"
          status={serviceText(state.services?.monitoring)}
          action={<Switch checked={monitoringOn} onCheckedChange={(v) => void setStatusMonitoring(v)} />}
        />
        <ServiceChip
          tone="teal"
          icon={<Languages className="h-4 w-4" />}
          label="NPC 翻译"
          status={serviceText(state.services?.translator)}
          action={(
            <Button type="button" variant="ghost" size="icon-sm" className="h-8 w-8" onClick={() => void toggleService('translator')} title={translatorRunning ? '停止' : '启动'}>
              {translatorRunning ? <Square /> : <Play />}
            </Button>
          )}
        />
        <ServiceChip
          tone="blue"
          icon={<PictureInPicture2 className="h-4 w-4" />}
          label="悬浮窗"
          status={overlayVisible ? '显示' : '隐藏'}
          action={<Switch checked={overlayVisible} onCheckedChange={(v) => void setOverlayVisible(v)} />}
        />
      </Card>

      <SectionHeader
        title="肝度速览"
        description="本会话经验获取与效率（完整面板见「肝度统计」）"
        action={<TextLink onClick={() => setPage('grind')}>肝度详情</TextLink>}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard
          label="基础经验 %"
          value={formatPercent(snapshot?.grind?.session_cexp_pct)}
          hint={`${formatPercent(snapshot?.grind?.session_cexp_pct_per_hour)}/时`}
          accent="amber"
          disabled={!snapshot?.grind?.ready}
        />
        <MetricCard
          label="职业经验 %"
          value={formatPercent(snapshot?.grind?.session_jexp_pct)}
          hint={`${formatPercent(snapshot?.grind?.session_jexp_pct_per_hour)}/时`}
          disabled={!snapshot?.grind?.ready}
        />
        <MetricCard
          label="基础效率"
          value={formatExpRate(snapshot?.grind?.session_cexp_per_hour)}
          hint={
            snapshot?.grind?.session_cexp_abs
              ? `累计 ${formatNumber(snapshot.grind.session_cexp_abs)}`
              : '累计 —'
          }
          accent="green"
          disabled={!snapshot?.grind?.ready}
        />
        <MetricCard
          label="有效肝时"
          value={formatDuration(snapshot?.grind?.active)}
          hint={
            snapshot?.grind?.level != null
              ? `Lv.${snapshot.grind.level} · 条 ${formatPercent(snapshot.grind.cexp_pct)}`
              : '等待经验包'
          }
          disabled={!snapshot?.grind?.ready}
        />
      </div>

      <SectionHeader
        title="当前战斗"
        description="详细列表与清空统计请到「伤害统计」"
        action={<TextLink onClick={() => setPage('damage')}>伤害详情</TextLink>}
      />

      <Card className="grid gap-3 px-3.5 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0 space-y-2">
          <div className="text-[11px] font-medium text-[var(--muted-foreground)]">输出渠道占比</div>
          <ChannelBars
            totals={{
              self_skill: snapshot?.self_skill_dealt,
              self_normal: snapshot?.self_normal_dealt,
              ride_skill: snapshot?.ride_skill_dealt,
              ride_normal: snapshot?.ride_normal_dealt,
              pet_skill: snapshot?.pet_skill_dealt,
              pet_normal: snapshot?.pet_normal_dealt,
              possession_skill: snapshot?.possession_skill_dealt,
              possession_normal: snapshot?.possession_normal_dealt,
            }}
          />
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[11px] text-[var(--muted-foreground)]">
            DPS 趋势 · 现 {formatNumber(snapshot?.dps, 2)}
          </div>
          <DpsSparkline points={state.battleReport?.history} width={180} height={40} />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {(() => {
          const cards = [
            ['self_normal', '自身普攻', 'white', snapshot?.self_normal_dealt, snapshot?.self_normal_dps] as const,
            ['self_skill', '自身技能', 'amber', snapshot?.self_skill_dealt, snapshot?.self_skill_dps] as const,
            ['pet_normal', '宠物普攻', 'green', snapshot?.pet_normal_dealt, snapshot?.pet_normal_dps] as const,
            ['pet_skill', '宠物技能', 'green', snapshot?.pet_skill_dealt, snapshot?.pet_skill_dps] as const,
            ['ride_normal', '骑宠普攻', 'blue', snapshot?.ride_normal_dealt, snapshot?.ride_normal_dps] as const,
            ['ride_skill', '骑宠技能', 'blue', snapshot?.ride_skill_dealt, snapshot?.ride_skill_dps] as const,
            ['possession_normal', '依凭普攻', 'white', snapshot?.possession_normal_dealt, snapshot?.possession_normal_dps] as const,
            ['possession_skill', '依凭技能', 'amber', snapshot?.possession_skill_dealt, snapshot?.possession_skill_dps] as const,
            ['taken', '受到伤害', 'red', snapshot?.taken, snapshot?.tps] as const,
          ];
          const anyHit = cards.some(([, , , total]) => (Number(total) || 0) > 0);
          return cards
            .filter(([, , , total]) => !anyHit || (Number(total) || 0) > 0)
            .map(([key, label, accent, total, dps]) => (
              <MetricCard
                key={key}
                label={label}
                accent={accent}
                value={formatNumber(total)}
                hint={<><b className="font-semibold text-[#cbd0d2]">{formatNumber(dps, 2)}</b> 秒伤</>}
                disabled={capture[key] === false}
              />
            ));
        })()}
      </div>

      <DataCard
        title="最近伤害"
        action={(
          <TextLink onClick={() => setPage('damage')}>
            全部 <ArrowRight className="h-3.5 w-3.5" />
          </TextLink>
        )}
        bare
      >
        {!recent.length ? (
          <EmptyState>暂无战斗数据 · 进图普攻一次即可</EmptyState>
        ) : (
          <div>
            {recent.map((item, index) => {
              const type = historyType(item);
              return (
                <div key={`${item.time}-${index}`} className="recent-row">
                  <time>{item.time || '--:--:--'}</time>
                  <Badge variant={type.cls === '' ? 'normal' : type.cls as 'skill'}>{type.text}</Badge>
                  <SkillIcon skillId={item.skill_id} fallback={item.skill_id == null ? 'sword' : 'sparkles'} />
                  <span className="route">
                    {item.source} → {item.target} ·{' '}
                    {item.skill_id == null ? '普通攻击' : <SkillName skillId={item.skill_id} />}
                  </span>
                  <strong>{formatNumber(item.damage)}</strong>
                </div>
              );
            })}
          </div>
        )}
      </DataCard>
    </PageStack>
  );
}
