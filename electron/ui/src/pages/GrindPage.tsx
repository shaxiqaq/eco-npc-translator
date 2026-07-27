import { RotateCcw, Flame, Gauge, Timer, TrendingUp, Sparkles } from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import {
  formatDurationLong,
  formatEventTime,
  formatExpRate,
  formatNumber,
  formatPercent,
} from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  PageStack,
  PageToolbar,
  MetricCard,
  DataCard,
  EmptyState,
  SectionHeader,
} from '@/components/layout';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import type { GrindWindowRate } from '@/types/eco';

function rateRow(label: string, win?: GrindWindowRate | null) {
  if (!win) {
    return (
      <tr className="border-t border-[var(--line-soft)]">
        <td className="px-3 py-2 text-[var(--muted-foreground)]">{label}</td>
        <td className="px-3 py-2 text-right">—</td>
        <td className="px-3 py-2 text-right">—</td>
        <td className="px-3 py-2 text-right">—</td>
        <td className="px-3 py-2 text-right">—</td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-[var(--line-soft)]">
      <td className="px-3 py-2 font-medium">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatPercent(win.cexp_pct_per_hour, 1)}
        <span className="text-[var(--muted-foreground)]">/时</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatPercent(win.jexp_pct_per_hour, 1)}
        <span className="text-[var(--muted-foreground)]">/时</span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{formatExpRate(win.cexp_per_hour)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatExpRate(win.jexp_per_hour)}</td>
    </tr>
  );
}

export function GrindPage() {
  const { snapshot, state, resetDamage, showToast } = useEco();
  const grind = snapshot?.grind;
  const damageRunning = ['running', 'starting'].includes(state.services?.damage?.state || '')
    || ['running', 'starting'].includes(state.services?.monitoring?.state || '');
  const ready = Boolean(grind?.ready);
  const estimated = grind?.session_cexp_abs_estimated !== false;
  const windows = grind?.windows || {};
  const gains = grind?.recent_gains || [];

  return (
    <PageStack>
      <ConnectionBanner />

      <PageToolbar>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Flame className="h-3.5 w-3.5 text-[var(--amber)]" />
          <span>
            {damageRunning
              ? ready
                ? '正在跟踪经验（依赖伤害/状态采集）'
                : '采集已开：打怪获得经验后会自动出现数据'
              : '请先启动伤害采集或状态监控'}
          </span>
          {grind?.table_source ? (
            <Badge variant="outline" className="font-normal">
              经验表: {grind.table_source}
            </Badge>
          ) : null}
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            await resetDamage();
            showToast('肝度统计与伤害统计已一并清空');
          }}
        >
          <RotateCcw />
          清空会话
        </Button>
      </PageToolbar>

      <SectionHeader
        title="当前进度"
        description="服务器下发的基础经验 / 职业经验进度条（百分比 ×10 精度）"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="角色等级"
          value={grind?.level != null ? `Lv.${grind.level}` : '—'}
          hint={
            grind?.level_ups
              ? `本会话升级 ×${grind.level_ups}`
              : '等待等级包'
          }
          accent="amber"
        />
        <MetricCard
          label="基础经验条"
          value={formatPercent(grind?.cexp_pct)}
          hint={
            grind?.job_level != null
              ? `职业 Lv.${grind.job_level}`
              : 'CEXP %'
          }
        />
        <MetricCard
          label="职业经验条"
          value={formatPercent(grind?.jexp_pct)}
          hint={
            grind?.job_level_ups
              ? `本会话职级 ×${grind.job_level_ups}`
              : 'JEXP %'
          }
        />
        <MetricCard
          label="有效肝时"
          value={formatDurationLong(grind?.active)}
          hint={`会话 ${formatDurationLong(grind?.elapsed)}`}
          accent="green"
        />
      </div>

      <SectionHeader
        title="本会话累计"
        description={
          estimated
            ? '百分比为精确值；绝对经验按内置等级表估算，可能与官服/私服略有差异'
            : '绝对经验来自协议字段'
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="获得基础经验 %"
          value={formatPercent(grind?.session_cexp_pct)}
          hint={`${formatPercent(grind?.session_cexp_pct_per_hour)}/时`}
          accent="amber"
          disabled={!ready}
        />
        <MetricCard
          label="获得职业经验 %"
          value={formatPercent(grind?.session_jexp_pct)}
          hint={`${formatPercent(grind?.session_jexp_pct_per_hour)}/时`}
          disabled={!ready}
        />
        <MetricCard
          label={estimated ? '基础经验(估)' : '基础经验'}
          value={formatNumber(grind?.session_cexp_abs || 0)}
          hint={formatExpRate(grind?.session_cexp_per_hour)}
          accent="green"
          disabled={!ready}
        />
        <MetricCard
          label={estimated ? '职业经验(估)' : '职业经验'}
          value={formatNumber(grind?.session_jexp_abs || 0)}
          hint={formatExpRate(grind?.session_jexp_per_hour)}
          disabled={!ready}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DataCard
          title={
            <span className="inline-flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[var(--amber)]" />
              时段效率
            </span>
          }
          description="按最近时间窗内的实际获得量折算每小时效率"
        >
          {!ready ? (
            <EmptyState>
              <div className="space-y-1">
                <div>暂无经验数据</div>
                <div className="text-[10px]">开启采集后击杀怪物即可开始统计</div>
              </div>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-[var(--muted-foreground)]">
                    <th className="px-3 py-2 text-left font-normal">时间窗</th>
                    <th className="px-3 py-2 text-right font-normal">基础%/时</th>
                    <th className="px-3 py-2 text-right font-normal">职业%/时</th>
                    <th className="px-3 py-2 text-right font-normal">基础经验</th>
                    <th className="px-3 py-2 text-right font-normal">职业经验</th>
                  </tr>
                </thead>
                <tbody>
                  {rateRow('近 5 分钟', windows['5m'])}
                  {rateRow('近 15 分钟', windows['15m'])}
                  {rateRow('近 1 小时', windows['1h'])}
                  {rateRow('本会话', windows.session)}
                </tbody>
              </table>
            </div>
          )}
        </DataCard>

        <DataCard
          title={
            <span className="inline-flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[var(--green)]" />
              最近获得
            </span>
          }
          description="每次经验包的增量（升级会把跨级部分算入）"
        >
          {!gains.length ? (
            <EmptyState>
              <div className="inline-flex items-center gap-2">
                <Timer className="h-4 w-4" />
                还没有经验增量记录
              </div>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--line-soft)]">
              {gains.slice(0, 12).map((g, idx) => {
                const cPct = (Number(g.cexp_pct_x10) || 0) / 10;
                const jPct = (Number(g.jexp_pct_x10) || 0) / 10;
                return (
                  <li
                    key={`${g.ts}-${idx}`}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium tabular-nums">
                        {formatEventTime(g.ts)}
                        {g.level != null ? (
                          <span className="ml-2 text-[var(--muted-foreground)]">
                            Lv.{g.level}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                        条 {formatPercent(g.cexp_pct_now != null ? Number(g.cexp_pct_now) / 10 : null)}
                        {' / '}
                        {formatPercent(g.jexp_pct_now != null ? Number(g.jexp_pct_now) / 10 : null)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-[var(--amber)]">
                        {cPct > 0 ? `+${cPct.toFixed(1)}%` : '—'}
                        {g.cexp_abs ? (
                          <span className="ml-1 text-[10px] text-[var(--muted-foreground)]">
                            ({formatNumber(g.cexp_abs)})
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[var(--teal)]">
                        {jPct > 0 ? `职+${jPct.toFixed(1)}%` : '—'}
                        {g.jexp_abs ? (
                          <span className="ml-1 text-[10px] text-[var(--muted-foreground)]">
                            ({formatNumber(g.jexp_abs)})
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DataCard>
      </div>

      <DataCard
        title={
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            说明
          </span>
        }
      >
        <ul className="space-y-1.5 px-1 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          <li>· 数据来自地图服下发的经验/等级包，与伤害采集共用后端，无需额外启动。</li>
          <li>· 「有效肝时」会在连续获得经验时累计，超过约 2 分钟无经验则视为休息，不计入效率分母。</li>
          <li>· 清空会话会同时重置伤害统计；当前等级与经验条会保留为新的起点。</li>
          <li>· 绝对经验优先用协议里的累计值；否则按内置 SagaECO 等级表从百分比估算。</li>
        </ul>
      </DataCard>
    </PageStack>
  );
}
