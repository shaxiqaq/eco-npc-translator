import { Plus, Save, Tag } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useEco } from '@/context/EcoContext';
import { SkillIcon } from '@/components/SkillIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/layout';
import { cn } from '@/lib/utils';

export function CustomBuffEditor({ compact = false }: { compact?: boolean }) {
  const {
    state,
    snapshot,
    customBuffRows,
    setCustomBuffRows,
    saveCustomBuffs,
    addCustomBuffRow,
    addSkillFromLibrary,
  } = useEco();
  const [filter, setFilter] = useState('');

  const library = useMemo(() => {
    const fromState = Array.isArray(state.skill_library) ? state.skill_library : [];
    if (fromState.length) return fromState;
    const map = new Map<number, { skill_id: number; name?: string; count?: number }>();
    for (const item of snapshot?.skill_casts || []) {
      const id = Number(item.skill_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      map.set(id, {
        skill_id: id,
        name: item.skill || `技能#${id}`,
        count: Number(item.count) || 0,
      });
    }
    return [...map.values()];
  }, [state.skill_library, snapshot?.skill_casts]);

  const configured = new Set(customBuffRows.map((row) => row.key));
  const query = filter.trim().toLowerCase();
  const filteredLibrary = library
    .filter((item) => {
      if (!query) return true;
      const name = String(item.name || '').toLowerCase();
      return name.includes(query) || String(item.skill_id).includes(query);
    })
    .slice(0, 40);

  return (
    <Card>
      <CardHeader className={cn(compact && 'py-2.5')}>
        <CardTitle>自定义倒计时</CardTitle>
        <CardDescription>
          本地保存。技能勾选「悬浮窗」后，下次释放才会在悬浮窗显示持续/CD
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)]/60 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <strong className="text-sm">本地技能库</strong>
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="筛选技能名或 ID"
              className="h-8 max-w-xs"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {!filteredLibrary.length ? (
              <EmptyState className="min-h-[72px] w-full py-4">
                {library.length ? '没有匹配的技能' : '释放技能后会自动收录到这里，点击即可添加设置'}
              </EmptyState>
            ) : (
              filteredLibrary.map((item) => {
                const key = `skill:${item.skill_id}`;
                const added = configured.has(key) || configured.has(String(item.skill_id));
                return (
                  <button
                    key={item.skill_id}
                    type="button"
                    disabled={added}
                    className={cn('skill-chip', added && 'added')}
                    onClick={() => addSkillFromLibrary(item.skill_id, item.name || `技能#${item.skill_id}`)}
                  >
                    <SkillIcon skillId={item.skill_id} />
                    <span className="skill-chip-copy">
                      <strong>{item.name || `技能#${item.skill_id}`}</strong>
                      <span>#{item.skill_id}{item.count ? ` · ${item.count}次` : ''}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="custom-buff-header hidden md:grid">
          <span>标识 / 技能</span>
          <span>持续时间</span>
          <span>技能 CD</span>
          <span>悬浮窗</span>
          <span />
        </div>

        <div className="space-y-2">
          {!customBuffRows.length ? (
            <EmptyState className="min-h-[80px]">暂无自定义倒计时，点击“添加一条”或从技能库选择</EmptyState>
          ) : (
            customBuffRows.map((row) => {
              const isSkill = Boolean(row.skill_id);
              return (
                <div key={row.id} className={cn('custom-buff-row', isSkill && 'is-skill')}>
                  <div className="custom-buff-identity">
                    <div className="custom-buff-identity-main">
                      {isSkill ? (
                        <SkillIcon skillId={Number(row.skill_id)} />
                      ) : (
                        <span className="skill-icon skill-icon-status">
                          <Tag className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <div className="custom-buff-identity-copy">
                        <strong className={cn('custom-buff-title', !(row.label || row.skill_id) && 'is-empty')}>
                          {row.label || (row.skill_id ? `技能 #${row.skill_id}` : '状态标识')}
                        </strong>
                        <Input
                          value={row.key}
                          placeholder="magic_shield 或 skill:2100"
                          spellCheck={false}
                          onChange={(event) => {
                            const value = event.target.value;
                            setCustomBuffRows((rows) =>
                              rows.map((item) => (item.id === row.id ? { ...item, key: value } : item)),
                            );
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="number-field">
                    <Input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={row.duration}
                      placeholder="可选"
                      onChange={(event) => {
                        const value = event.target.value;
                        setCustomBuffRows((rows) =>
                          rows.map((item) => (item.id === row.id ? { ...item, duration: value } : item)),
                        );
                      }}
                    />
                    <span>秒</span>
                  </div>
                  <div className="number-field">
                    <Input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={row.cooldown}
                      placeholder="可选"
                      onChange={(event) => {
                        const value = event.target.value;
                        setCustomBuffRows((rows) =>
                          rows.map((item) => (item.id === row.id ? { ...item, cooldown: value } : item)),
                        );
                      }}
                    />
                    <span>秒</span>
                  </div>
                  <label className="custom-buff-overlay" title="勾选后，释放该技能会在悬浮窗显示持续/CD">
                    <Switch
                      checked={row.overlay}
                      disabled={!isSkill}
                      onCheckedChange={(checked) => {
                        setCustomBuffRows((rows) =>
                          rows.map((item) => (item.id === row.id ? { ...item, overlay: checked } : item)),
                        );
                      }}
                    />
                    <span>悬浮窗</span>
                  </label>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setCustomBuffRows((rows) => rows.filter((item) => item.id !== row.id))}
                  >
                    删除
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={addCustomBuffRow}>
            <Plus />
            添加一条
          </Button>
          <Button type="button" onClick={() => void saveCustomBuffs(false)}>
            <Save />
            保存自定义倒计时
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
