import { RotateCcw, RadioTower, FileDown, ClipboardCopy } from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { formatNumber } from '@/lib/format';
import { skillCastRoleLabel } from '@/lib/damage';
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

export function DamagePage() {
  const {
    snapshot,
    historyFilter,
    setHistoryFilter,
    state,
    saveCaptureSetting,
    resetDamage,
    showToast,
  } = useEco();
  const report = state.battleReport;

  const capture = state.settings?.capture || {};
  const items = [...(snapshot?.damage_history || [])]
    .reverse()
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
        <div className="flex flex-wrap gap-2">
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

      {/* 采集项目唯一入口 */}
      <Card className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted-foreground)]">
          <RadioTower className="h-4 w-4 text-[var(--amber)]" />
          采集项目
        </div>
        {([
          ['skill', '技能造成', 'skill'],
          ['normal', '普通攻击', 'normal'],
          ['pet', '宠物造成', 'pet'],
          ['taken', '受到伤害', 'taken'],
        ] as const).map(([key, label, color]) => (
          <label key={key} className="flex items-center gap-2 rounded-lg border border-[var(--line-soft)] bg-black/10 px-2.5 py-1.5 text-xs">
            <span className={cn('capture-color', color)} />
            <b className="font-medium">{label}</b>
            <Switch checked={capture[key] !== false} onCheckedChange={(v) => void saveCaptureSetting(key, v)} />
          </label>
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="总计造成"
          value={formatNumber(snapshot?.dealt)}
          hint={`${formatNumber((snapshot?.hits_skill_dealt || 0) + (snapshot?.hits_normal_dealt || 0))} 次命中`}
          accent="amber"
        />
        <MetricCard
          label="综合秒伤"
          value={formatNumber(snapshot?.dps, 2)}
          hint="战斗期间"
          accent="white"
        />
        <MetricCard
          label="最大技能"
          value={formatNumber(snapshot?.max_skill_dealt)}
          hint={`${formatNumber(snapshot?.hits_skill_dealt)} 次技能`}
          accent="amber"
        />
        <MetricCard
          label="技能释放"
          value={formatNumber(snapshot?.skill_cast_total)}
          hint="含防御/自身技"
          accent="blue"
        />
      </div>

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
                      <SkillName skillId={item.skill_id} preferName={item.skill} />{' '}
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
