import { Download, FolderOpen } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useEco } from '@/context/EcoContext';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Card } from '@/components/ui/card';
import { PageStack, PageToolbar, EmptyState } from '@/components/layout';
import { VirtualLogList } from '@/components/VirtualLogList';

function matchesLogFilter(entry: { service?: string; channels?: string[] }, filter: string) {
  if (!filter || filter === 'all') return true;
  if (entry.service === filter) return true;
  if (Array.isArray(entry.channels) && entry.channels.includes(filter)) return true;
  if (filter === 'monitoring' && (entry.service === 'buffs' || entry.service === 'monitoring')) return true;
  return false;
}

export function LogsPage() {
  const { state, logFilter, setLogFilter, openLogs, exportLogs, showToast } = useEco();
  const [exporting, setExporting] = useState(false);
  const all = state.logs || [];
  const filtered = useMemo(
    () => all.filter((entry) => matchesLogFilter(entry, logFilter)),
    [all, logFilter],
  );

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportLogs(logFilter);
      if (result?.cancelled) return;
      if (!result?.ok) {
        showToast(result?.error || '导出失败');
        return;
      }
      showToast(`已导出 ${result.count || filtered.length} 条日志`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageStack>
      <PageToolbar>
        <ToggleGroup value={logFilter} onValueChange={setLogFilter}>
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="damage">伤害采集</ToggleGroupItem>
          <ToggleGroupItem value="monitoring">状态监控</ToggleGroupItem>
          <ToggleGroupItem value="translator">NPC 翻译</ToggleGroupItem>
          <ToggleGroupItem value="xiaoya">小雅助手</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => void handleExport()} disabled={exporting}>
            <Download />
            {exporting ? '导出中…' : '一键导出'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void openLogs()}>
            <FolderOpen />
            打开日志目录
          </Button>
        </div>
      </PageToolbar>

      <Card className="overflow-hidden p-0">
        {!filtered.length ? (
          <EmptyState className="min-h-[420px]">
            {logFilter === 'all' ? '暂无运行日志' : '当前分类下暂无日志'}
          </EmptyState>
        ) : (
          <VirtualLogList entries={filtered} />
        )}
      </Card>
    </PageStack>
  );
}
