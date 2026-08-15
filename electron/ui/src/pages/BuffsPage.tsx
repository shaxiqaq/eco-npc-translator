import { ShieldCheck } from 'lucide-react';
import { useEco, useSnapshot } from '@/context/EcoContext';
import { formatDuration, formatEventTime, formatNumber } from '@/lib/format';
import { isBuffExpiring } from '@/lib/buff-warning';
import { CustomBuffEditor } from '@/components/CustomBuffEditor';
import { SkillIcon } from '@/components/SkillIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  PageStack,
  PageToolbar,
  MetricCard,
  DataCard,
  EmptyState,
  TextLink,
} from '@/components/layout';
import { cn } from '@/lib/utils';

const buffCategories: Record<string, { label: string; cls: string }> = {
  positive: { label: '增益', cls: 'positive' },
  negative: { label: '减益', cls: 'negative' },
  abnormal: { label: '异常', cls: 'abnormal' },
  cooldown: { label: '技能CD', cls: 'cooldown' },
  skill_duration: { label: '持续', cls: 'skill-duration' },
};

function buffCategory(item: Record<string, unknown>) {
  return buffCategories[String(item?.category || '')] || { label: '状态', cls: 'unknown' };
}

function buffTime(item: Record<string, unknown>) {
  const now = Date.now() / 1000;
  if (item?.expires_at != null && Number.isFinite(Number(item.expires_at))) {
    const remaining = Math.max(0, Number(item.expires_at) - now);
    if (item?.category === 'cooldown') return remaining > 0 ? `CD 剩余 ${formatDuration(remaining)}` : '技能可用';
    if (item?.category === 'skill_duration') return remaining > 0 ? `持续剩余 ${formatDuration(remaining)}` : '效果结束';
    return remaining > 0 ? `预计剩余 ${formatDuration(remaining)}` : '等待状态移除';
  }
  const elapsed = Math.max(0, now - Number(item?.started_at || now));
  return `已持续 ${formatDuration(elapsed)}`;
}

function buffTimingSource(item: Record<string, unknown>) {
  if (item?.category === 'cooldown') return '自定义技能 CD';
  if (item?.category === 'skill_duration') return '自定义技能持续';
  if (item?.timing === 'custom') return '自定义持续时间';
  if (item?.timing === 'estimated_observed') return '实测预计';
  if (item?.timing === 'estimated_learned') return '本次运行学习';
  return '持续时间未知';
}

function pickGameFacingName(item: Record<string, unknown> = {}) {
  const skillId = Number(item.skill_id);
  const hasSkill = Number.isInteger(skillId) && skillId > 0;
  const name = String(item.name || item.skill || '').trim();
  const source = String(item.source_name || '').trim();
  const key = String(item.key || '').trim();
  const isPlaceholder = (text: string) => {
    if (!text) return true;
    if (text.startsWith('未命名') || text.startsWith('未确认')) return true;
    if (/^状态\s/i.test(text) || /^技能#\d+$/.test(text)) return true;
    return false;
  };
  const isZh = (text: string) => /[\u4e00-\u9fff]/.test(text);
  if (source && !isPlaceholder(source)) return source;
  if (name && !isPlaceholder(name) && !isZh(name)) return name;
  if (hasSkill) return `技能#${skillId}`;
  if (name && !isPlaceholder(name)) return name;
  return key ? `状态 ${key}` : '未知状态';
}

function filterActiveTimers(list: Array<Record<string, unknown>> = [], category: string) {
  const now = Date.now() / 1000;
  return [...list]
    .filter((item) => {
      const remaining = Number(item?.remaining);
      const expiresAt = Number(item?.expires_at);
      if (Number.isFinite(remaining)) return remaining > 0;
      if (Number.isFinite(expiresAt)) return expiresAt > now;
      return false;
    })
    .map((item) => ({
      ...item,
      key: item.key || `${category}:${item.skill_id}`,
      category: category || item.category,
      name: item.name || item.skill || `技能#${item.skill_id}`,
      skill_id: item.skill_id,
    }));
}

export function BuffsPage() {
  const {
    state,
    setPage,
    setStatusMonitoring,
  } = useEco();
  const snapshot = useSnapshot();

  const monitoring = state.settings?.overlay?.monitoring !== false;
  const items = monitoring ? [...(snapshot?.buffs || [])] as Array<Record<string, unknown>> : [];
  const cooldowns = monitoring ? filterActiveTimers((snapshot?.skill_cooldowns || []) as Array<Record<string, unknown>>, 'cooldown') : [];
  const skillEffects = monitoring ? filterActiveTimers((snapshot?.skill_effect_timers || []) as Array<Record<string, unknown>>, 'skill_duration') : [];
  const skillTimers = [...skillEffects, ...cooldowns];
  const history = monitoring ? [...(snapshot?.buff_history || [])].reverse() as Array<Record<string, unknown>> : [];
  const counts = { positive: 0, negative: 0, abnormal: 0 };
  items.forEach((item) => {
    const cat = String(item.category || '');
    if (cat in counts) counts[cat as keyof typeof counts] += 1;
  });
  const warning = state.settings?.overlay?.expiryWarningSeconds;
  const eventLabels: Record<string, string> = { gained: '获得', refreshed: '刷新', lost: '消失' };

  return (
    <PageStack className={cn(!monitoring && 'monitoring-off')}>
      <PageToolbar>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--amber-dark)] text-[var(--amber)]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">自己的角色状态</div>
            <div className="text-[11px] text-[var(--muted-foreground)]">
              {!monitoring
                ? '状态监控已关闭'
                : snapshot?.self_id
                  ? `角色编号 ${snapshot.self_id}`
                  : '等待识别角色'}
            </div>
          </div>
        </div>
        <TextLink onClick={() => { setPage('settings'); }}>
          悬浮窗外观在「设置」
        </TextLink>
      </PageToolbar>

      {!monitoring && (
        <Card className="border-[var(--accent-border)] bg-[var(--accent-soft-2)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="text-xs text-[var(--muted-foreground)]">
              状态监控已关闭，当前页不显示增益/减益与技能计时。可在总览页开关，或在此直接开启。
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPage('overview')}>
                去总览
              </Button>
              <Button type="button" size="sm" onClick={() => void setStatusMonitoring(true)}>
                开启监控
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live status first — same data source as the floating overlay */}
      <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-5">
        <MetricCard label="当前状态" value={formatNumber(items.length)} hint="与悬浮窗同一数据源" accent="white" />
        <MetricCard label="增益" value={formatNumber(counts.positive)} hint="对角色有利" accent="green" />
        <MetricCard label="减益" value={formatNumber(counts.negative)} hint="属性降低效果" accent="red" />
        <MetricCard label="异常" value={formatNumber(counts.abnormal)} hint="行动异常效果" accent="blue" />
        <MetricCard label="技能计时" value={formatNumber(skillTimers.length)} hint="持续 + CD" accent="amber" />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <DataCard
          title="当前生效（同悬浮窗）"
          description={
            monitoring
              ? `${items.length} 项 · 游戏状态包实时读取`
              : '监控已关闭'
          }
          action={<Badge variant="secondary" className="gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />实时</Badge>}
          bare
        >
          {!monitoring ? (
            <EmptyState>状态监控已关闭，打开右上角开关后恢复显示</EmptyState>
          ) : !items.length ? (
            <EmptyState>尚未检测到角色状态（进图、切图或释放技能后会刷新）</EmptyState>
          ) : (
            <div className="buff-active-list max-h-[min(420px,50vh)] overflow-auto">
              {items.map((item, index) => {
                const category = buffCategory(item);
                return (
                  <div key={`${item.key}-${index}`} className={cn('buff-active-row', category.cls)}>
                    <SkillIcon
                      skillId={Number(item.skill_id) || null}
                      fallback="shield"
                      expiring={isBuffExpiring(item as { expires_at?: number }, warning)}
                    />
                    <span className={cn('buff-category', category.cls)}>{category.label}</span>
                    <div className="buff-name">
                      <strong>{pickGameFacingName(item)}</strong>
                      {item.key ? <small>{String(item.key)}</small> : null}
                    </div>
                    <div className="buff-time">
                      <strong>{buffTime(item)}</strong>
                      <span>{buffTimingSource(item)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DataCard>

        <DataCard
          title="技能持续 / CD"
          description={`${skillTimers.length} 项 · 需在下方自定义倒计时里配置`}
          action={<Badge variant="secondary" className="gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />实时</Badge>}
          bare
        >
          {!monitoring ? (
            <EmptyState>状态监控已关闭</EmptyState>
          ) : !skillTimers.length ? (
            <EmptyState>在下方「自定义倒计时」填写持续/CD 秒数后，释放对应技能即可显示</EmptyState>
          ) : (
            <div className="buff-active-list max-h-[min(420px,50vh)] overflow-auto">
              {skillTimers.map((item, index) => {
                const category = buffCategory(item);
                return (
                  <div key={`${item.key}-${index}`} className={cn('buff-active-row', category.cls)}>
                    <SkillIcon
                      skillId={Number(item.skill_id) || null}
                      fallback={item.category === 'cooldown' ? 'timer' : 'hourglass'}
                      expiring={isBuffExpiring(item as { expires_at?: number }, warning)}
                    />
                    <span className={cn('buff-category', category.cls)}>{category.label}</span>
                    <div className="buff-name">
                      <strong>{pickGameFacingName(item)}</strong>
                      <small>{item.category === 'cooldown' ? '技能 CD' : '技能持续'} · #{String(item.skill_id)}</small>
                    </div>
                    <div className="buff-time">
                      <strong>{buffTime(item)}</strong>
                      <span>{buffTimingSource(item)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DataCard>

        <DataCard title="状态变化" description={`${history.length} 条`} bare>
          {!monitoring ? (
            <EmptyState>状态监控已关闭</EmptyState>
          ) : !history.length ? (
            <EmptyState>尚无状态变化记录</EmptyState>
          ) : (
            <div className="buff-history-list max-h-[min(420px,50vh)] overflow-auto">
              {history.map((item, index) => {
                const category = buffCategory(item);
                return (
                  <div key={`${item.time}-${index}`} className="buff-history-row">
                    <time>{formatEventTime(item.time)}</time>
                    <SkillIcon skillId={Number(item.skill_id) || null} fallback="shield" />
                    <span className={cn('buff-category', category.cls)}>{category.label}</span>
                    <strong>{pickGameFacingName(item)}</strong>
                    <b className={cn('buff-event', String(item.event || ''))}>
                      {eventLabels[String(item.event || '')] || '变化'}
                    </b>
                  </div>
                );
              })}
            </div>
          )}
        </DataCard>
      </div>

      {/* Config below live data so overlay-matching list is always visible first */}
      <CustomBuffEditor />
    </PageStack>
  );
}
