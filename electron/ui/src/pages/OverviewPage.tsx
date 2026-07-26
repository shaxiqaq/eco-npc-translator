import {
  Swords,
  ShieldCheck,
  Languages,
  PictureInPicture2,
  Play,
  Square,
  RotateCcw,
  ArrowRight,
} from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { formatDuration, formatNumber } from '@/lib/format';
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
import { ConnectionBanner } from '@/components/ConnectionBanner';
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
    resetDamage,
  } = useEco();

  const damageRunning = ['running', 'starting'].includes(state.services?.damage?.state || '');
  const translatorRunning = ['running', 'starting'].includes(state.services?.translator?.state || '');
  const monitoringOn = state.settings?.overlay?.monitoring !== false;
  const overlayVisible = state.settings?.overlay?.visible !== false;
  const capture = state.settings?.capture || {};
  const recent = [...(snapshot?.damage_history || [])].reverse().slice(0, 5);
  const recentLogs = [...(state.logs || [])].slice(-5).reverse();

  return (
    <PageStack>
      <ConnectionBanner />
      {/* 服务总控：单行四项，不占纵向空间 */}
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
          label="状态悬浮窗"
          status={overlayVisible ? '已显示' : '已隐藏'}
          action={<Switch checked={overlayVisible} onCheckedChange={(v) => void setOverlayVisible(v)} />}
        />
      </Card>

      <SectionHeader
        title="当前战斗"
        description={`战斗时间 ${formatDuration(snapshot?.active)} · 采集项目请到「伤害统计」调整`}
        action={(
          <div className="flex items-center gap-1">
            <TextLink onClick={() => setPage('damage')}>伤害详情</TextLink>
            <Button type="button" variant="ghost" size="icon-sm" title="清空伤害统计" onClick={() => void resetDamage()}>
              <RotateCcw />
            </Button>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ['skill', '技能造成', 'amber', snapshot?.skill_dealt, snapshot?.skill_dps, '秒伤'] as const,
          ['normal', '普通攻击', 'white', snapshot?.normal_dealt, snapshot?.normal_dps, '秒伤'] as const,
          ['pet', '宠物造成', 'green', snapshot?.pet_dealt, snapshot?.pet_dps, '秒伤'] as const,
          ['taken', '受到伤害', 'red', snapshot?.taken, snapshot?.tps, '秒均'] as const,
        ]).map(([key, label, accent, total, dps, unit]) => (
          <MetricCard
            key={key}
            label={label}
            accent={accent}
            value={formatNumber(total)}
            hint={<><b className="font-semibold text-[#cbd0d2]">{formatNumber(dps, 2)}</b> {unit}</>}
            disabled={capture[key] === false}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,.88fr)]">
        <DataCard
          title="最近伤害"
          action={(
            <TextLink onClick={() => setPage('damage')}>
              查看全部 <ArrowRight className="h-3.5 w-3.5" />
            </TextLink>
          )}
          bare
        >
          {!recent.length ? (
            <EmptyState>暂无战斗数据</EmptyState>
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

        <DataCard
          title="运行动态"
          action={(
            <TextLink onClick={() => setPage('logs')}>
              查看日志 <ArrowRight className="h-3.5 w-3.5" />
            </TextLink>
          )}
          bare
        >
          {!recentLogs.length ? (
            <EmptyState>等待服务启动</EmptyState>
          ) : (
            <div>
              {recentLogs.map((entry, index) => (
                <div key={`${entry.time}-${index}`} className="activity-row">
                  <i className={entry.level || 'info'} />
                  <div>
                    <strong>{entry.service === 'damage' ? '伤害采集' : 'NPC 翻译'}</strong>
                    <span>{entry.message}</span>
                  </div>
                  <time>{entry.time}</time>
                </div>
              ))}
            </div>
          )}
        </DataCard>
      </div>
    </PageStack>
  );
}
