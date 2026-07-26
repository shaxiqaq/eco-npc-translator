import { Languages, ArrowRight } from 'lucide-react';
import { useEco } from '@/context/EcoContext';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageStack, DataCard, EmptyState, TextLink } from '@/components/layout';
import { serviceText } from '@/lib/damage';

export function TranslationPage() {
  const { state, setPage, setSettingsTab } = useEco();
  const translator = state.services?.translator;
  const running = ['running', 'starting'].includes(translator?.state || '');
  const translation = state.translation || {};
  const logs = (state.logs || []).filter((entry) => entry.service === 'translator').slice(-80).reverse();

  return (
    <PageStack>
      <Card className="overflow-hidden">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[rgba(24,51,47,.9)] text-[var(--teal)] shadow-[inset_0_0_0_1px_rgba(255,255,255,.04)]">
              <Languages className="h-7 w-7" />
            </div>
            <div>
              <div className="text-[11px] text-[var(--muted-foreground)]">NPC 原生对话框翻译</div>
              <h2 className="m-0 mt-1 text-lg font-semibold">
                {running
                  ? '翻译正在运行'
                  : translator?.state === 'error'
                    ? '翻译启动失败'
                    : '服务已停止'}
              </h2>
              <p className="m-0 mt-1 text-xs text-[var(--muted-foreground)]">
                {translator?.message || '完成翻译设置后即可启动'}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant={running ? 'success' : translator?.state === 'error' ? 'warning' : 'secondary'}>
              {serviceText(translator)}
            </Badge>
            <TextLink onClick={() => setPage('overview')}>
              启停请到「总览」
            </TextLink>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <DataCard
          title="当前配置"
          action={(
            <TextLink
              onClick={() => {
                setSettingsTab('translation');
                setPage('settings');
              }}
            >
              修改设置 <ArrowRight className="h-3.5 w-3.5" />
            </TextLink>
          )}
        >
          <dl className="grid gap-3 text-xs">
            {([
              ['翻译服务', translation.provider || '未配置'],
              ['模型', translation.model || '-'],
              ['目标语言', translation.target_lang === 'zh-TW' ? '繁体中文' : '简体中文'],
              ['首屏等待', `${translation.first_wait || 0} 秒`],
              ['共享词库', translation.sync_enabled ? '开启' : '关闭'],
            ] as const).map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 border-b border-[var(--line-soft)] pb-2 last:border-0 last:pb-0">
                <dt className="text-[var(--muted-foreground)]">{label}</dt>
                <dd className="m-0 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </DataCard>

        <DataCard
          title="翻译动态"
          action={<Badge variant="secondary" className="gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />实时</Badge>}
          bare
        >
          {!logs.length ? (
            <EmptyState>尚无翻译日志</EmptyState>
          ) : (
            <div className="translation-log max-h-[320px] overflow-auto p-1">
              {logs.map((entry, index) => (
                <div key={`${entry.time}-${index}`} className="log-line">
                  <time>{entry.time}</time>
                  {entry.message}
                </div>
              ))}
            </div>
          )}
        </DataCard>
      </div>
    </PageStack>
  );
}
